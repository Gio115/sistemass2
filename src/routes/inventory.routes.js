import { Router } from 'express';
import { db } from '../db.js';
import { authenticate, requireAdmin } from '../auth.js';
import { branchContext, getStock, moveStock, ensureStockRowsForItem } from '../branches.js';
import { prepararConversion, planParaPantalla, convertirAMl } from '../convertir_ml.js';

const router = Router();

// Todas las rutas son solo del administrador y trabajan sobre UNA sucursal (la que eligió arriba).
// La lista de insumos (nombre, tipo, unidad, costo, proveedor) es la misma en todas las sucursales;
// lo que cambia por sucursal son las existencias, el mínimo para avisar, las compras, las mermas y el historial.
const guard = [authenticate, requireAdmin, branchContext()];

const text = (v) => (v === undefined || v === null) ? undefined : String(v).trim();
const round = (n, d = 2) => { const f = 10 ** d; return Math.round((Number(n) + Number.EPSILON) * f) / f; };
const num = (n) => Number(round(n, 2));   // para mensajes: 25.36 en vez de 25.360000001
const packPlural = (w, n) => (n === 1 ? w : (/[aeiouáéíóú]$/i.test(w) ? w + 's' : w + 'es'));   // botella → botellas, barril → barriles

// Presentación de compra ("botella" de 25.36 oz). Sin tamaño no hay presentación.
function normalizePack(name, size) {
  const sz = parseFloat(size);
  if (!Number.isFinite(sz) || sz <= 0) return { pack_name: '', pack_size: 0 };
  return { pack_name: (text(name) || 'botella').slice(0, 30), pack_size: sz };
}

// Cuántos productos del Menú (no ocultos) usan este insumo: en una receta, "tal cual" o como opción.
function usesInMenu(itemId) {
  const inRecipe = db.prepare('SELECT COUNT(*) as count FROM recipe_items r JOIN products p ON p.id = r.product_id WHERE r.inventory_item_id = ? AND p.archived = 0').get(itemId).count;
  const inDirect = db.prepare('SELECT COUNT(*) as count FROM products WHERE direct_inventory_item_id = ? AND archived = 0').get(itemId).count;
  const inOption = db.prepare('SELECT COUNT(*) as count FROM product_options o JOIN products p ON p.id = o.product_id WHERE o.inventory_item_id = ? AND p.archived = 0').get(itemId).count;
  return inRecipe + inDirect + inOption;
}

// Un insumo con las existencias de la sucursal actual (forma que usa la pantalla).
function itemInBranch(itemId, branchId) {
  return db.prepare(`
    SELECT i.id, i.name, i.category, i.unit,
      COALESCE(s.current_stock, 0) AS current_stock,
      COALESCE(s.min_stock, i.min_stock) AS min_stock,
      i.cost_per_unit, i.supplier, i.pack_name, i.pack_size, i.updated_at
    FROM inventory_items i
    LEFT JOIN inventory_stock s ON s.inventory_item_id = i.id AND s.branch_id = ?
    WHERE i.id = ?
  `).get(branchId, itemId);
}

// GET /api/inventory - Insumos con las existencias de la sucursal elegida (solo administrador: expone costos y valor)
router.get('/', ...guard, (req, res) => {
  try {
    const items = db.prepare(`
      SELECT
        i.id, i.name, i.category, i.unit,
        COALESCE(s.current_stock, 0) AS current_stock,
        COALESCE(s.min_stock, i.min_stock) AS min_stock,
        i.cost_per_unit, i.supplier, i.pack_name, i.pack_size, i.updated_at,
        ROUND(COALESCE(s.current_stock, 0) * i.cost_per_unit, 2) as total_value,
        CASE
          WHEN COALESCE(s.current_stock, 0) <= 0 THEN 'critical'
          WHEN COALESCE(s.current_stock, 0) <= COALESCE(s.min_stock, i.min_stock) THEN 'warning'
          ELSE 'ok'
        END as stock_status
      FROM inventory_items i
      LEFT JOIN inventory_stock s ON s.inventory_item_id = i.id AND s.branch_id = ?
      ORDER BY
        CASE
          WHEN COALESCE(s.current_stock, 0) <= 0 THEN 1
          WHEN COALESCE(s.current_stock, 0) <= COALESCE(s.min_stock, i.min_stock) THEN 2
          ELSE 3
        END,
        i.category ASC,
        i.name ASC
    `).all(req.branchId);

    const summary = {
      total_items: items.length,
      low_stock_count: items.filter(i => i.current_stock <= i.min_stock).length,
      total_inventory_cost: Math.round(items.reduce((sum, i) => sum + i.current_stock * i.cost_per_unit, 0) * 100) / 100
    };

    res.json({ items, summary, branch: req.branch });
  } catch (error) {
    console.error('Error al listar inventario:', error);
    res.status(500).json({ error: 'Error al consultar inventario' });
  }
});

// POST /api/inventory/item - Crear insumo (administrador). Existe en todas las sucursales;
// las existencias que escribas son las de la sucursal elegida (en las demás empieza en 0).
router.post('/item', ...guard, (req, res) => {
  try {
    const name = text(req.body.name);
    const category = text(req.body.category);
    const unit = text(req.body.unit);
    const supplier = text(req.body.supplier) || '';

    if (!name || !category || !unit) {
      return res.status(400).json({ error: 'Nombre, categoría y unidad de medida son obligatorios' });
    }

    const stock = Math.max(0, parseFloat(req.body.current_stock) || 0);
    const minStock = parseFloat(req.body.min_stock);
    const min = Number.isFinite(minStock) && minStock >= 0 ? minStock : 5;
    const cost = Math.max(0, parseFloat(req.body.cost_per_unit) || 0);
    const pack = normalizePack(req.body.pack_name, req.body.pack_size);

    db.exec('BEGIN TRANSACTION;');
    let newId;
    try {
      const result = db.prepare(`
        INSERT INTO inventory_items (name, category, unit, current_stock, min_stock, cost_per_unit, supplier, pack_name, pack_size)
        VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?)
      `).run(name, category, unit, min, cost, supplier, pack.pack_name, pack.pack_size);
      newId = Number(result.lastInsertRowid);

      ensureStockRowsForItem(newId, min, { [req.branchId]: stock });

      if (stock > 0) {
        db.prepare(`
          INSERT INTO inventory_movements (
            inventory_item_id, branch_id, type, quantity, previous_stock, new_stock, reference_id, user_id, notes
          ) VALUES (?, ?, 'ajuste', ?, 0, ?, 'STOCK_INICIAL', ?, 'Stock inicial registrado al dar de alta el insumo')
        `).run(newId, req.branchId, stock, stock, req.user.id);
      }
      db.exec('COMMIT;');
    } catch (err) {
      db.exec('ROLLBACK;');
      throw err;
    }

    res.status(201).json({
      success: true,
      message: 'Insumo de inventario creado exitosamente',
      item: itemInBranch(newId, req.branchId)
    });
  } catch (error) {
    console.error('Error al crear insumo:', error);
    res.status(500).json({ error: 'Error al registrar insumo en inventario' });
  }
});

// PUT /api/inventory/item/:id - Cambiar un insumo (administrador).
// Nombre, tipo, unidad, costo y proveedor cambian en todas las sucursales; "avisar cuando quede menos de" solo en la elegida.
router.put('/item/:id', ...guard, (req, res) => {
  try {
    const itemId = Number.parseInt(req.params.id, 10);
    const existing = Number.isInteger(itemId) ? db.prepare('SELECT * FROM inventory_items WHERE id = ?').get(itemId) : null;
    if (!existing) {
      return res.status(404).json({ error: 'Insumo no encontrado' });
    }

    const { min_stock, cost_per_unit } = req.body;
    const name = text(req.body.name), category = text(req.body.category), unit = text(req.body.unit), supplier = text(req.body.supplier);

    // Cambiar la medida (de piezas a onzas, por ejemplo) de un insumo que ya está en el Menú cambiaría en silencio lo que
    // significan las cantidades de las recetas y de "se vende tal cual" (1 botella pasaría a ser 1 onza). Se pide crear uno nuevo.
    const unitChanged = unit !== undefined && unit !== '' && unit !== existing.unit;
    if (unitChanged && unit === 'ml' && usesInMenu(itemId) > 0 && ['pza', 'L', 'oz'].includes(existing.unit)) {
      return res.status(400).json({
        error: `“${existing.name}” ya se usa en el Menú (recetas o “se vende tal cual”).\n\nPara medirlo en ml usa el botón “🔄 Pasar a ml”: ahí escribes cuántos ml trae cada pieza y el sistema convierte solo las existencias, el costo y las recetas, sin cambiar lo que cuesta cada bebida.`
      });
    }
    if (unitChanged && usesInMenu(itemId) > 0) {
      return res.status(400).json({
        error: `“${existing.name}” ya se usa en el Menú (recetas o “se vende tal cual”). Si le cambias la medida de ${existing.unit} a ${unit}, las cantidades de esos productos cambiarían de significado (1 botella pasaría a ser 1 ${unit}).\n\nLo seguro: crea un insumo nuevo medido en ${unit}, pásale las recetas y quita este.`
      });
    }

    // Presentación: si no viene en la petición se queda como estaba; si viene vacía o en 0, se quita.
    const packTouched = req.body.pack_size !== undefined || req.body.pack_name !== undefined;
    const pack = packTouched
      ? normalizePack(
          req.body.pack_name !== undefined ? req.body.pack_name : existing.pack_name,
          req.body.pack_size !== undefined ? req.body.pack_size : existing.pack_size)
      : { pack_name: existing.pack_name, pack_size: existing.pack_size };

    db.exec('BEGIN TRANSACTION;');
    try {
      db.prepare(`
        UPDATE inventory_items
        SET name = COALESCE(?, name),
            category = COALESCE(?, category),
            unit = COALESCE(?, unit),
            cost_per_unit = COALESCE(?, cost_per_unit),
            supplier = COALESCE(?, supplier),
            pack_name = ?,
            pack_size = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(
        name !== undefined ? name : null,
        category !== undefined ? category : null,
        unit !== undefined ? unit : null,
        cost_per_unit !== undefined && Number.isFinite(parseFloat(cost_per_unit)) ? Math.max(0, parseFloat(cost_per_unit)) : null,
        supplier !== undefined ? supplier : null,
        pack.pack_name,
        pack.pack_size,
        itemId
      );

      if (min_stock !== undefined && Number.isFinite(parseFloat(min_stock)) && parseFloat(min_stock) >= 0) {
        getStock(req.branchId, itemId); // por si la fila no existía
        db.prepare('UPDATE inventory_stock SET min_stock = ?, updated_at = CURRENT_TIMESTAMP WHERE branch_id = ? AND inventory_item_id = ?')
          .run(parseFloat(min_stock), req.branchId, itemId);
      }
      db.exec('COMMIT;');
    } catch (err) {
      db.exec('ROLLBACK;');
      throw err;
    }

    let warning;
    if (unitChanged && db.prepare('SELECT 1 FROM inventory_stock WHERE inventory_item_id = ? AND current_stock > 0 LIMIT 1').get(itemId)) {
      warning = `Cambiaste la medida de ${existing.unit} a ${unit}, pero las existencias siguen con el mismo número. Haz un 📋 Contar inventario para dejarlas bien.`;
    }
    res.json({
      success: true,
      message: 'Insumo actualizado correctamente',
      ...(warning ? { warning } : {}),
      item: itemInBranch(itemId, req.branchId)
    });
  } catch (error) {
    console.error('Error al actualizar insumo:', error);
    res.status(500).json({ error: 'Error al actualizar insumo' });
  }
});

// GET /api/inventory/item/:id/convert-ml?ml_per_unit=500 - Vista previa de "Pasar a ml": qué cambiaría, sin tocar nada.
router.get('/item/:id/convert-ml', ...guard, (req, res) => {
  try {
    const r = prepararConversion(Number.parseInt(req.params.id, 10), req.query.ml_per_unit);
    if (r.error) return res.status(r.status).json({ error: r.error, ...(r.pide_ml ? { pide_ml: true } : {}) });
    res.json({ preview: planParaPantalla(r.plan) });
  } catch (error) {
    console.error('Error en vista previa de ml:', error);
    res.status(500).json({ error: 'No se pudo preparar la conversión a ml' });
  }
});

// POST /api/inventory/item/:id/convert-ml { ml_per_unit, presentacion? } - Pasa el insumo a ml (copia de seguridad + todo o nada).
router.post('/item/:id/convert-ml', ...guard, (req, res) => {
  try {
    const r = convertirAMl(Number.parseInt(req.params.id, 10), req.body.ml_per_unit, { presentacion: req.body.presentacion });
    if (r.error) return res.status(r.status).json({ error: r.error, ...(r.pide_ml ? { pide_ml: true } : {}) });
    res.json({
      success: true,
      message: `“${r.plan.item.name}” ahora se mide en ml. Tus bebidas cuestan lo mismo que antes.`,
      respaldo: r.respaldo,
      item: itemInBranch(r.plan.item.id, req.branchId)
    });
  } catch (error) {
    console.error('Error al pasar a ml:', error);
    res.status(500).json({ error: 'No se pudo pasar a ml. No se cambió nada.' });
  }
});

// POST /api/inventory/purchase - Llegó mercadería: suma existencias en la sucursal elegida (administrador).
// Se puede registrar por unidad del insumo (quantity) o por presentación (packs = botellas/cajas; el servidor
// lo convierte con el tamaño de la presentación). cost_per_pack es lo que costó cada botella/caja.
router.post('/purchase', ...guard, (req, res) => {
  try {
    const { inventory_item_id, quantity, packs, cost_per_unit, cost_per_pack, invoice_number = '', notes = '' } = req.body;

    const item = db.prepare('SELECT * FROM inventory_items WHERE id = ?').get(inventory_item_id);
    if (!item) {
      return res.status(404).json({ error: 'Insumo no encontrado' });
    }

    const byPack = packs !== undefined && packs !== null && packs !== '';
    let qty, newCost, detail;
    if (byPack) {
      if (!(item.pack_size > 0)) {
        return res.status(400).json({ error: `“${item.name}” no tiene botella o caja definida. Entra a ✏️ Cambiar y dile de cuánto viene cada una.` });
      }
      const n = parseFloat(packs);
      if (!Number.isFinite(n) || n <= 0) {
        return res.status(400).json({ error: `La cantidad de ${packPlural(item.pack_name, 2)} debe ser mayor a 0` });
      }
      qty = n * item.pack_size;
      const perPack = parseFloat(cost_per_pack);
      newCost = Number.isFinite(perPack) && perPack > 0 ? perPack / item.pack_size : item.cost_per_unit;
      detail = `${num(n)} ${packPlural(item.pack_name, n)} (${num(qty)} ${item.unit})`;
    } else {
      qty = parseFloat(quantity);
      if (isNaN(qty) || qty <= 0) {
        return res.status(400).json({ error: 'La cantidad a ingresar debe ser mayor a 0' });
      }
      newCost = cost_per_unit !== undefined && parseFloat(cost_per_unit) > 0
        ? parseFloat(cost_per_unit)
        : item.cost_per_unit;
      detail = `${num(qty)} ${item.unit}`;
    }

    db.exec('BEGIN TRANSACTION;');
    try {
      db.prepare('UPDATE inventory_items SET cost_per_unit = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(newCost, item.id);

      const moved = moveStock(req.branchId, item.id, qty, {
        type: 'entrada_compra',
        reference: String(invoice_number || 'COMPRA'),
        userId: req.user.id,
        notes: String(notes || `Compra/Entrada de almacén (+${detail})`)
      });

      db.exec('COMMIT;');

      res.json({
        success: true,
        message: `Se agregaron ${detail} a ${item.name}`,
        added: qty,
        cost_per_unit: newCost,
        previous_stock: moved.previous,
        new_stock: moved.next
      });
    } catch (err) {
      db.exec('ROLLBACK;');
      throw err;
    }
  } catch (error) {
    console.error('Error al registrar compra:', error);
    res.status(500).json({ error: 'Error al registrar entrada en inventario' });
  }
});

// POST /api/inventory/waste - Merma / derrame / ajuste en la sucursal elegida (administrador)
router.post('/waste', ...guard, (req, res) => {
  try {
    const { inventory_item_id, quantity, reason, notes = '' } = req.body;

    const validReasons = ['merma_derrame', 'merma_rotura', 'merma_caducidad', 'ajuste'];
    if (!validReasons.includes(reason)) {
      return res.status(400).json({ error: 'Motivo de merma inválido' });
    }

    const item = db.prepare('SELECT * FROM inventory_items WHERE id = ?').get(inventory_item_id);
    if (!item) {
      return res.status(404).json({ error: 'Insumo no encontrado' });
    }

    const qty = parseFloat(quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      return res.status(400).json({ error: 'La cantidad de merma debe ser mayor a 0' });
    }

    db.exec('BEGIN TRANSACTION;');
    try {
      const noteText = notes ? `${String(notes)} (-${qty} ${item.unit})` : `Registro de merma/derrame (-${qty} ${item.unit})`;
      const moved = moveStock(req.branchId, item.id, -qty, {
        type: reason,
        reference: 'MERMA',
        userId: req.user.id,
        notes: noteText,
        clampAtZero: true
      });

      db.exec('COMMIT;');

      res.json({
        success: true,
        message: `Merma registrada con éxito (-${qty} ${item.unit})`,
        previous_stock: moved.previous,
        new_stock: moved.next
      });
    } catch (err) {
      db.exec('ROLLBACK;');
      throw err;
    }
  } catch (error) {
    console.error('Error al registrar merma:', error);
    res.status(500).json({ error: 'Error al registrar merma en inventario' });
  }
});

// GET /api/inventory/movements - Historial de movimientos de la sucursal elegida (administrador)
router.get('/movements', ...guard, (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 500);
    const movements = db.prepare(`
      SELECT
        m.id, m.type, m.quantity, m.previous_stock, m.new_stock, m.reference_id, m.notes, m.created_at,
        i.name as item_name, i.unit,
        u.username, u.full_name as user_full_name
      FROM inventory_movements m
      JOIN inventory_items i ON m.inventory_item_id = i.id
      LEFT JOIN users u ON m.user_id = u.id
      WHERE m.branch_id = ?
      ORDER BY m.id DESC
      LIMIT ?
    `).all(req.branchId, limit);

    res.json({ movements });
  } catch (error) {
    console.error('Error al consultar movimientos:', error);
    res.status(500).json({ error: 'Error al consultar historial de movimientos' });
  }
});

// POST /api/inventory/count - Conteo físico (administrador).
// Recibe lo que SE CONTÓ de cada insumo (en la unidad del insumo) y lo compara con lo que el sistema dice que debería haber.
// Solo se cuentan los insumos que vengan en la lista (se puede contar solo los licores, por ejemplo).
// Con adjust = true las existencias quedan EXACTAMENTE como se contaron (queda un movimiento "ajuste" por cada diferencia).
router.post('/count', ...guard, (req, res) => {
  try {
    const rawLines = Array.isArray(req.body.lines) ? req.body.lines : [];
    const adjust = req.body.adjust === true || req.body.adjust === 'true' || req.body.adjust === 1;
    const notes = (text(req.body.notes) || '').slice(0, 300);

    if (rawLines.length === 0) {
      return res.status(400).json({ error: 'No hay nada contado. Escribe lo que contaste de al menos un insumo.' });
    }
    if (rawLines.length > 2000) {
      return res.status(400).json({ error: 'Son demasiados insumos en un solo conteo.' });
    }

    const seen = new Set();
    const lines = [];
    for (const l of rawLines) {
      const id = Number.parseInt(l && l.inventory_item_id, 10);
      const item = Number.isInteger(id) ? db.prepare('SELECT id, name, unit, cost_per_unit FROM inventory_items WHERE id = ?').get(id) : null;
      if (!item) return res.status(404).json({ error: 'Uno de los insumos del conteo ya no existe. Vuelve a abrir el conteo.' });
      if (seen.has(id)) return res.status(400).json({ error: `“${item.name}” viene dos veces en el conteo.` });
      seen.add(id);
      const counted = Number(l.counted);
      if (l.counted === '' || l.counted === null || l.counted === undefined || !Number.isFinite(counted) || counted < 0) {
        return res.status(400).json({ error: `Lo contado de “${item.name}” no es un número válido (usa 0 si no queda nada).` });
      }
      lines.push({ item, counted });
    }

    db.exec('BEGIN TRANSACTION;');
    try {
      const who = req.user.full_name || req.user.username || '';
      const head = db.prepare(`
        INSERT INTO inventory_counts (branch_id, user_id, user_name, notes, adjusted) VALUES (?, ?, ?, ?, ?)
      `).run(req.branchId, req.user.id, who, notes, adjust ? 1 : 0);
      const countId = Number(head.lastInsertRowid);

      const insLine = db.prepare(`
        INSERT INTO inventory_count_lines (count_id, inventory_item_id, item_name, unit, expected, counted, difference, cost_per_unit, diff_value)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      let missing = 0, surplus = 0, adjustedLines = 0;
      const out = [];
      for (const { item, counted } of lines) {
        const expected = getStock(req.branchId, item.id).current_stock;
        let diff = round(counted - expected, 4);
        if (Math.abs(diff) < 0.0001) diff = 0;
        const value = round(diff * item.cost_per_unit, 2);
        if (value < 0) missing += -value; else surplus += value;
        insLine.run(countId, item.id, item.name, item.unit, expected, counted, diff, item.cost_per_unit, value);
        if (adjust && diff !== 0) {
          moveStock(req.branchId, item.id, diff, {
            type: 'ajuste',
            reference: `CONTEO-${countId}`,
            userId: req.user.id,
            notes: `Conteo físico: el sistema decía ${num(expected)} ${item.unit} y se contaron ${num(counted)} ${item.unit}`,
            setTo: counted
          });
          adjustedLines++;
        }
        out.push({ inventory_item_id: item.id, item_name: item.name, unit: item.unit, expected, counted, difference: diff, cost_per_unit: item.cost_per_unit, diff_value: value });
      }
      missing = round(missing, 2); surplus = round(surplus, 2);
      db.prepare('UPDATE inventory_counts SET lines_count = ?, missing_value = ?, surplus_value = ? WHERE id = ?')
        .run(lines.length, missing, surplus, countId);
      db.exec('COMMIT;');

      res.status(201).json({
        success: true,
        message: adjust
          ? `Conteo guardado. Se corrigieron ${adjustedLines} insumo${adjustedLines === 1 ? '' : 's'} para que el inventario quede como lo contaste.`
          : 'Conteo guardado. El inventario NO se cambió (solo quedó anotada la diferencia).',
        count: {
          id: countId, branch_id: req.branchId, user_name: who, notes, adjusted: adjust ? 1 : 0, lines_count: lines.length,
          missing_value: missing, surplus_value: surplus, net_value: round(surplus - missing, 2), adjusted_lines: adjustedLines
        },
        lines: out
      });
    } catch (err) {
      db.exec('ROLLBACK;');
      throw err;
    }
  } catch (error) {
    console.error('Error al guardar el conteo:', error);
    res.status(500).json({ error: 'Error al guardar el conteo de inventario' });
  }
});

// GET /api/inventory/counts - Conteos anteriores de la sucursal elegida (administrador)
router.get('/counts', ...guard, (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 30, 1), 200);
    const counts = db.prepare(`
      SELECT id, user_name, notes, adjusted, lines_count, missing_value, surplus_value,
             ROUND(surplus_value - missing_value, 2) AS net_value, created_at
      FROM inventory_counts WHERE branch_id = ? ORDER BY id DESC LIMIT ?
    `).all(req.branchId, limit);
    res.json({ counts });
  } catch (error) {
    console.error('Error al listar conteos:', error);
    res.status(500).json({ error: 'Error al consultar los conteos' });
  }
});

// GET /api/inventory/counts/:id - Detalle de un conteo (administrador)
router.get('/counts/:id', ...guard, (req, res) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    const count = Number.isInteger(id)
      ? db.prepare(`
          SELECT id, user_name, notes, adjusted, lines_count, missing_value, surplus_value,
                 ROUND(surplus_value - missing_value, 2) AS net_value, created_at
          FROM inventory_counts WHERE id = ? AND branch_id = ?
        `).get(id, req.branchId)
      : null;
    if (!count) return res.status(404).json({ error: 'Conteo no encontrado' });
    const lines = db.prepare(`
      SELECT inventory_item_id, item_name, unit, expected, counted, difference, cost_per_unit, diff_value
      FROM inventory_count_lines WHERE count_id = ? ORDER BY diff_value ASC, item_name ASC
    `).all(id);
    res.json({ count, lines });
  } catch (error) {
    console.error('Error al consultar el conteo:', error);
    res.status(500).json({ error: 'Error al consultar el conteo' });
  }
});

// DELETE /api/inventory/item/:id - Quitar un insumo de TODAS las sucursales (administrador)
router.delete('/item/:id', ...guard, (req, res) => {
  try {
    const itemId = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(itemId) || !db.prepare('SELECT 1 FROM inventory_items WHERE id = ?').get(itemId)) {
      return res.status(404).json({ error: 'Insumo no encontrado' });
    }

    // Check if used in recipes or direct sales
    // (Los productos ocultos —quitados, con ventas— no cuentan: ya no están en el Menú.)
    if (usesInMenu(itemId) > 0) {
      return res.status(400).json({
        error: 'No se puede eliminar este insumo porque está asignado a uno o más productos o recetas de venta.'
      });
    }

    db.exec('BEGIN TRANSACTION;');
    try {
      // Los productos ocultos dejan de apuntar a este insumo
      db.prepare('DELETE FROM recipe_items WHERE inventory_item_id = ? AND product_id IN (SELECT id FROM products WHERE archived = 1)').run(itemId);
      db.prepare('DELETE FROM product_options WHERE inventory_item_id = ? AND product_id IN (SELECT id FROM products WHERE archived = 1)').run(itemId);
      db.prepare('UPDATE products SET direct_inventory_item_id = NULL, is_direct_sale = 0 WHERE direct_inventory_item_id = ? AND archived = 1').run(itemId);
      db.prepare('DELETE FROM inventory_movements WHERE inventory_item_id = ?').run(itemId);
      db.prepare('DELETE FROM inventory_stock WHERE inventory_item_id = ?').run(itemId);
      db.prepare('DELETE FROM inventory_items WHERE id = ?').run(itemId);
      db.exec('COMMIT;');
      res.json({ success: true, message: 'Insumo eliminado del inventario (de todas las sucursales)' });
    } catch (err) {
      db.exec('ROLLBACK;');
      throw err;
    }
  } catch (error) {
    console.error('Error al eliminar insumo:', error);
    res.status(500).json({ error: 'Error al eliminar insumo del inventario' });
  }
});

export default router;
