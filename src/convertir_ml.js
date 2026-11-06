// "Pasar a ml": cambia un insumo (piezas, litros u onzas) a mililitros SIN cambiar lo que vale nada.
//
//  - Existencias (de TODAS las sucursales), "avisar cuando quede menos de", costo, botella/caja,
//    cantidades de las recetas, presentaciones (vidrio / lata...) y el historial de movimientos
//    se multiplican por el mismo número (ml por pieza, 1000 por litro, 29.5735 por onza),
//    y el costo por unidad se divide entre ese número. El costo de cada bebida queda igual.
//  - Un producto que "se vende tal cual" con este insumo pasa a llevar una receta de la cantidad
//    de ml de una pieza (la venta sigue descontando exactamente lo mismo que antes).
//  - Antes de tocar nada se guarda una copia de seguridad completa; todo se hace en una sola
//    transacción y, si algo no cuadra (costos, valor del inventario), se deshace todo.
//  - El historial viejo se convierte también para que anular una venta de antes devuelva los ml correctos.
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { db, DATA_DIR, rutaLibre } from './db.js';
import { r6, r8, aplicarConversion } from './ml_nucleo.js';

const FACTOR_FIJO = { L: 1000, oz: 29.5735 };   // 1 litro = 1000 ml; 1 onza líquida = 29.5735 ml (igual que la pantalla)
const MAX_ML_POR_PIEZA = 100000;
const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

function fallo(status, error, extra = {}) { return { status, error, ...extra }; }

// Calcula todo lo que cambiaría (sin tocar la base). Devuelve { plan } o { error, status }.
export function prepararConversion(itemId, mlPorPieza) {
  const item = Number.isInteger(itemId) ? db.prepare('SELECT * FROM inventory_items WHERE id = ?').get(itemId) : null;
  if (!item) return fallo(404, 'Insumo no encontrado');
  if (item.unit === 'ml') return fallo(400, `“${item.name}” ya se mide en ml.`);

  let factor = null, pideMl = false;
  if (FACTOR_FIJO[item.unit]) {
    factor = FACTOR_FIJO[item.unit];
  } else if (item.unit === 'pza') {
    pideMl = true;
    const vacio = mlPorPieza === undefined || mlPorPieza === null || String(mlPorPieza).trim() === '';
    if (!vacio) {
      const v = Number(mlPorPieza);
      if (!Number.isFinite(v) || v <= 0 || v > MAX_ML_POR_PIEZA) {
        return fallo(400, 'Escribe cuántos ml trae cada pieza con un número mayor que 0 (por ejemplo 500).', { pide_ml: true });
      }
      factor = v;
    }
  } else {
    const medida = item.unit === 'g' ? 'gramos' : item.unit;
    return fallo(400, `“${item.name}” se mide en ${medida}: eso es peso, no se puede pasar a ml.`);
  }

  const sucursales = db.prepare(`
    SELECT s.branch_id, b.name AS sucursal, s.current_stock, s.min_stock
    FROM inventory_stock s JOIN branches b ON b.id = s.branch_id
    WHERE s.inventory_item_id = ? ORDER BY s.branch_id
  `).all(itemId);
  const recetas = db.prepare(`
    SELECT r.id, r.quantity, p.id AS product_id, p.name AS producto, p.archived
    FROM recipe_items r JOIN products p ON p.id = r.product_id
    WHERE r.inventory_item_id = ? ORDER BY p.archived, p.name
  `).all(itemId);
  const opciones = db.prepare(`
    SELECT o.id, o.label, o.quantity, p.id AS product_id, p.name AS producto, p.archived
    FROM product_options o JOIN products p ON p.id = o.product_id
    WHERE o.inventory_item_id = ? ORDER BY p.archived, p.name, o.sort_order, o.id
  `).all(itemId);
  const directos = db.prepare(`
    SELECT p.id, p.name AS producto, p.price, p.archived,
      (SELECT COUNT(*) FROM product_options o WHERE o.product_id = p.id) AS n_opciones,
      (SELECT COUNT(*) FROM recipe_items r WHERE r.product_id = p.id) AS n_receta
    FROM products p WHERE p.direct_inventory_item_id = ? ORDER BY p.archived, p.name
  `).all(itemId);
  const nMovimientos = db.prepare('SELECT COUNT(*) AS c FROM inventory_movements WHERE inventory_item_id = ?').get(itemId).c;

  // Un producto "tal cual" con una receta vieja guardada de otros insumos pasaría a descontarlos también: se pide revisarlo antes.
  const conRecetaVieja = directos.find((d) => d.n_receta > 0 && d.n_opciones === 0);
  if (conRecetaVieja) {
    return fallo(400, `“${conRecetaVieja.producto}” se vende tal cual pero tiene una receta guardada de antes. Ábrelo en el Menú, guárdalo otra vez y vuelve a intentar.`);
  }

  const plan = {
    item: { id: item.id, name: item.name, unit_antes: item.unit },
    pide_ml_por_pieza: pideMl,
    factor,                       // null mientras no escriban los ml por pieza
    ml_por_pieza: pideMl ? factor : null,
    tiene_presentacion: item.pack_size > 0,
    presentacion: item.pack_size > 0 ? { nombre: item.pack_name || 'botella', antes: item.pack_size } : null,
    n_movimientos: nMovimientos,
    sucursales: sucursales.map((s) => ({ branch_id: s.branch_id, sucursal: s.sucursal, existencias_antes: s.current_stock, minimo_antes: s.min_stock })),
    recetas: recetas.map((r) => ({ id: r.id, product_id: r.product_id, producto: r.producto, oculto: !!r.archived, antes: r.quantity })),
    opciones: opciones.map((o) => ({ id: o.id, product_id: o.product_id, producto: o.producto, presentacion: o.label, oculto: !!o.archived, antes: o.quantity })),
    directos: directos.map((d) => ({ product_id: d.id, producto: d.producto, precio: d.price, oculto: !!d.archived, con_presentaciones: d.n_opciones > 0 })),
    costo_antes: item.cost_per_unit,
    unidad_despues: 'ml',
    _item: item,
  };

  if (factor !== null) {
    for (const s of plan.sucursales) { s.existencias_despues = r6(s.existencias_antes * factor); s.minimo_despues = r6(s.minimo_antes * factor); }
    for (const r of plan.recetas) r.despues = r6(r.antes * factor);
    for (const o of plan.opciones) o.despues = r6(o.antes * factor);
    for (const d of plan.directos) d.despues = d.con_presentaciones ? null : r6(factor);   // cantidad de ml que descontará cada venta
    plan.costo_despues = r8(item.cost_per_unit / factor);
    if (plan.presentacion) plan.presentacion.despues = r6(item.pack_size * factor);
    plan.min_global_despues = r6(item.min_stock * factor);
  }
  return { plan };
}

// Lo que se manda a la pantalla (sin datos internos)
export function planParaPantalla(plan) {
  const { _item, ...limpio } = plan;
  return limpio;
}

function nombreSeguro(t) {
  return String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30) || 'insumo';
}

// Hace la conversión. Devuelve { ok, respaldo, plan } o { error, status }.
// Opciones: { presentacion } = nombre para guardar "1 pieza" como botella/lata cuando el insumo no tenía presentación.
export function convertirAMl(itemId, mlPorPieza, { presentacion } = {}) {
  const prep = prepararConversion(itemId, mlPorPieza);
  if (prep.error) return prep;
  const plan = prep.plan;
  if (plan.factor === null) return fallo(400, 'Escribe cuántos ml trae cada pieza (por ejemplo 500).', { pide_ml: true });
  const f = plan.factor;
  const item = plan._item;

  // 1) Copia de seguridad completa ANTES de tocar nada (VACUUM INTO no puede ir dentro de una transacción)
  const fecha = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const rutaRespaldo = rutaLibre(join(DATA_DIR, `respaldo_antes_de_pasar_a_ml_${nombreSeguro(item.name)}_${fecha}.db`));
  const nombreRespaldo = rutaRespaldo.split(/[\\/]/).pop();
  try {
    db.exec(`VACUUM INTO '${rutaRespaldo.replace(/'/g, "''")}'`);
    if (!existsSync(rutaRespaldo)) throw new Error('el archivo no apareció');
  } catch (err) {
    console.error(`[ml] No se pasó "${item.name}" a ml: no se pudo guardar la copia de seguridad (${err.message}).`);
    return fallo(500, 'No se pudo guardar la copia de seguridad, así que NO se cambió nada. Inténtalo otra vez.');
  }

  db.exec('BEGIN TRANSACTION;');
  let hecho;
  try {
    hecho = aplicarConversion(db, item, f, { presentacion });
    db.exec('COMMIT;');
  } catch (err) {
    try { db.exec('ROLLBACK;'); } catch { /* ya estaba cerrada */ }
    console.error(`[ml] No se pasó "${item.name}" a ml; se deshizo todo (${err.message}). Respaldo: ${nombreRespaldo}`);
    return fallo(500, 'No se pudo pasar a ml y NO se cambió nada (las cuentas no cuadraban). Avísame para revisarlo.');
  }

  console.log(`[ml] "${item.name}" pasó de ${item.unit} a ml (×${f}). Respaldo: ${nombreRespaldo}`);
  return { ok: true, respaldo: nombreRespaldo, plan, resumen: { bebidas_revisadas: hecho.antes.bebidas.length, valor_inventario: r2(hecho.antes.valor) } };
}
