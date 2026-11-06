import { Router } from 'express';
import { db } from '../db.js';
import { authenticate, requireAdmin } from '../auth.js';
import { branchContext, getStock, moveStock } from '../branches.js';

const router = Router();

// Solo el administrador mueve mercadería entre sucursales.
// El traspaso NO depende de la sucursal elegida arriba: se dice de cuál a cuál en la propia petición.
const guardMover = [authenticate, requireAdmin];

const TOLERANCIA = 0.0005;   // para que "pasar todo lo que hay" no falle por centésimas de decimales
const redondeo = (n, d = 4) => { const f = 10 ** d; return Math.round((Number(n) + Number.EPSILON) * f) / f; };
const num = (n) => Number(redondeo(n, 2));
const plural = (w, n) => (Number(n) === 1 ? w : (/[aeiouáéíóú]$/i.test(w) ? w + 's' : w + 'es'));
const folioDe = (id) => 'TR-' + String(id).padStart(4, '0');

// "2 botellas (50.72 oz)" o "12 pza"
function textoCantidad(item, qty, enPack) {
  if (enPack && item.pack_size > 0) {
    const n = redondeo(qty / item.pack_size, 2);
    return `${n} ${plural(item.pack_name || 'botella', n)} (${num(qty)} ${item.unit})`;
  }
  return `${num(qty)} ${item.unit}`;
}

function sucursal(id) {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) return null;
  return db.prepare('SELECT id, name, is_active FROM branches WHERE id = ?').get(n) || null;
}

// POST /api/transfers - Pasa mercadería de una sucursal a otra (todo o nada).
// body: { from_branch_id, to_branch_id, notes?, lines: [{ inventory_item_id, packs? | quantity? }] }
//   packs    = cuántas botellas/cajas (el servidor lo convierte con el tamaño de la presentación)
//   quantity = en la medida del insumo (oz, ml, piezas…)
router.post('/', ...guardMover, (req, res) => {
  try {
    const origen = sucursal(req.body.from_branch_id);
    const destino = sucursal(req.body.to_branch_id);
    if (!origen) return res.status(404).json({ error: 'Elige la sucursal de donde sale la mercadería.' });
    if (!destino) return res.status(404).json({ error: 'Elige la sucursal a donde va la mercadería.' });
    if (origen.id === destino.id) return res.status(400).json({ error: 'La sucursal de origen y la de destino son la misma. Elige una distinta.' });
    if (!origen.is_active || !destino.is_active) return res.status(400).json({ error: 'No se puede pasar mercadería de o hacia una sucursal que está quitada.' });

    const crudas = Array.isArray(req.body.lines) ? req.body.lines : [];
    if (crudas.length === 0) return res.status(400).json({ error: 'Agrega al menos un producto para pasar.' });
    if (crudas.length > 200) return res.status(400).json({ error: 'Son demasiados productos en un solo traspaso (máximo 200). Divídelo en dos.' });

    // 1) Entender cada renglón y juntar los repetidos
    const porInsumo = new Map();
    for (const l of crudas) {
      const id = Number(l && l.inventory_item_id);
      const item = Number.isInteger(id) ? db.prepare('SELECT * FROM inventory_items WHERE id = ?').get(id) : null;
      if (!item) return res.status(404).json({ error: 'Uno de los productos ya no existe en el inventario. Cierra y vuelve a abrir esta ventana.' });
      const enPack = l.packs !== undefined && l.packs !== null && l.packs !== '';
      let qty;
      if (enPack) {
        if (!(item.pack_size > 0)) return res.status(400).json({ error: `“${item.name}” no tiene botella o caja definida. Pásalo en ${item.unit}, o entra a ✏️ Cambiar y dile de cuánto viene cada una.` });
        const n = Number(l.packs);
        if (!Number.isFinite(n) || n <= 0) return res.status(400).json({ error: `La cantidad de ${plural(item.pack_name || 'botella', 2)} de “${item.name}” debe ser mayor a 0.` });
        qty = n * item.pack_size;
      } else {
        qty = Number(l.quantity);
        if (!Number.isFinite(qty) || qty <= 0) return res.status(400).json({ error: `La cantidad de “${item.name}” debe ser mayor a 0.` });
      }
      qty = redondeo(qty, 6);
      const previo = porInsumo.get(item.id);
      if (previo) { previo.qty = redondeo(previo.qty + qty, 6); previo.enPack = previo.enPack && enPack; }
      else porInsumo.set(item.id, { item, qty, enPack });
    }

    // 2) ¿Alcanza en el origen? Si algo no alcanza, NO se mueve nada y se dice qué falta
    const faltan = [];
    for (const l of porInsumo.values()) {
      const hay = getStock(origen.id, l.item.id).current_stock;
      if (l.qty > hay + TOLERANCIA) {
        faltan.push({ inventory_item_id: l.item.id, name: l.item.name, hay: redondeo(hay, 2), quieres: redondeo(l.qty, 2), unit: l.item.unit,
          hay_texto: textoCantidad(l.item, hay, l.item.pack_size > 0), quieres_texto: textoCantidad(l.item, l.qty, l.enPack) });
      }
    }
    if (faltan.length) {
      const f = faltan[0];
      return res.status(400).json({
        error: faltan.length === 1
          ? `En ${origen.name} no alcanza “${f.name}”: hay ${f.hay_texto} y quieres pasar ${f.quieres_texto}.`
          : `En ${origen.name} no alcanza la mercadería de ${faltan.length} productos (por ejemplo “${f.name}”: hay ${f.hay_texto} y quieres pasar ${f.quieres_texto}). No se movió nada.`,
        code: 'STOCK_INSUFICIENTE',
        shortages: faltan
      });
    }

    // 3) Mover todo en un solo paso (si algo falla, vuelve todo a como estaba)
    const nota = String(req.body.notes || '').trim().slice(0, 300);
    const resultado = { lines: [], bajos: [] };
    db.exec('BEGIN TRANSACTION;');
    try {
      const hdr = db.prepare(`
        INSERT INTO inventory_transfers (from_branch_id, to_branch_id, from_branch_name, to_branch_name, user_id, user_name, notes, lines_count)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(origen.id, destino.id, origen.name, destino.name, req.user.id, req.user.full_name || req.user.username || '', nota, porInsumo.size);
      const transferId = Number(hdr.lastInsertRowid);
      const folio = folioDe(transferId);
      db.prepare('UPDATE inventory_transfers SET folio = ? WHERE id = ?').run(folio, transferId);
      const insLinea = db.prepare('INSERT INTO inventory_transfer_lines (transfer_id, inventory_item_id, item_name, unit, quantity, pack_name, pack_size) VALUES (?, ?, ?, ?, ?, ?, ?)');

      for (const l of porInsumo.values()) {
        const { item } = l;
        const hay = getStock(origen.id, item.id).current_stock;
        const qty = Math.min(l.qty, hay);                 // si pasa "todo lo que hay" (dentro de la tolerancia), sale exactamente lo que hay
        const detalle = textoCantidad(item, qty, l.enPack);
        const sale = moveStock(origen.id, item.id, -qty, {
          type: 'ajuste', reference: folio, userId: req.user.id,
          notes: `Traspaso ${folio} a «${destino.name}» (−${detalle})${nota ? ' · ' + nota : ''}`
        });
        const entra = moveStock(destino.id, item.id, qty, {
          type: 'ajuste', reference: folio, userId: req.user.id,
          notes: `Traspaso ${folio} desde «${origen.name}» (+${detalle})${nota ? ' · ' + nota : ''}`
        });
        insLinea.run(transferId, item.id, item.name, item.unit, qty, item.pack_name || '', item.pack_size || 0);
        const minOrigen = getStock(origen.id, item.id).min_stock;
        resultado.lines.push({
          inventory_item_id: item.id, name: item.name, unit: item.unit, quantity: redondeo(qty, 4), texto: detalle,
          origen_antes: redondeo(sale.previous, 4), origen_despues: redondeo(sale.next, 4),
          destino_antes: redondeo(entra.previous, 4), destino_despues: redondeo(entra.next, 4)
        });
        if (sale.next <= minOrigen) resultado.bajos.push({ name: item.name, queda: redondeo(sale.next, 2), unit: item.unit, queda_texto: textoCantidad(item, sale.next, item.pack_size > 0) });
      }
      const fila = db.prepare('SELECT created_at FROM inventory_transfers WHERE id = ?').get(transferId);
      db.exec('COMMIT;');
      return res.status(201).json({
        success: true,
        message: `Listo: se pasaron ${porInsumo.size} ${porInsumo.size === 1 ? 'producto' : 'productos'} de ${origen.name} a ${destino.name}.`,
        transfer: { id: transferId, folio, created_at: fila && fila.created_at, from: { id: origen.id, name: origen.name }, to: { id: destino.id, name: destino.name }, notes: nota },
        lines: resultado.lines,
        low_after: resultado.bajos
      });
    } catch (err) {
      db.exec('ROLLBACK;');
      throw err;
    }
  } catch (error) {
    console.error('Error al pasar mercadería entre sucursales:', error);
    res.status(500).json({ error: 'No se pudo pasar la mercadería. No se movió nada. Intenta de nuevo.' });
  }
});

// GET /api/transfers - Traspasos recientes (los de la sucursal elegida arriba, o todos si eligió "Ambas").
router.get('/', authenticate, requireAdmin, branchContext({ allowAll: true }), (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 30, 1), 200);
    const traspasos = req.allBranches
      ? db.prepare('SELECT * FROM inventory_transfers ORDER BY id DESC LIMIT ?').all(limit)
      : db.prepare('SELECT * FROM inventory_transfers WHERE from_branch_id = ? OR to_branch_id = ? ORDER BY id DESC LIMIT ?').all(req.branchId, req.branchId, limit);
    if (traspasos.length) {
      const ids = traspasos.map(t => t.id);
      const lineas = db.prepare(`SELECT transfer_id, inventory_item_id, item_name, unit, quantity, pack_name, pack_size FROM inventory_transfer_lines WHERE transfer_id IN (${ids.map(() => '?').join(',')}) ORDER BY id`).all(...ids);
      const por = new Map();
      for (const l of lineas) { if (!por.has(l.transfer_id)) por.set(l.transfer_id, []); por.get(l.transfer_id).push(l); }
      for (const t of traspasos) t.lines = por.get(t.id) || [];
    }
    res.json({ transfers: traspasos });
  } catch (error) {
    console.error('Error al consultar traspasos:', error);
    res.status(500).json({ error: 'No se pudo consultar el historial de traspasos' });
  }
});

export default router;
