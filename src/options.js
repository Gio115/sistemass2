// Presentaciones que el CLIENTE elige al comprar (por ejemplo "Gallo de vidrio" o "Gallo de lata").
// Todas valen lo mismo; cada una descuenta su propio insumo de la sucursal donde se vende.
import { db } from './db.js';
import { moveStock } from './branches.js';
import { cleanText } from './validate.js';

export const MAX_OPTIONS = 6;

export function optionsOfProduct(productId) {
  return db.prepare(`
    SELECT id, product_id, label, inventory_item_id, quantity, sort_order
    FROM product_options WHERE product_id = ? ORDER BY sort_order ASC, id ASC
  `).all(productId);
}

// Comprueba lo que mandó la pantalla. Si el producto no tiene presentaciones, cualquier option_id suelto se ignora.
// Si las tiene, es obligatorio elegir una (así nunca se cobra sin saber qué cerveza descontar).
export function pickOption(prod, rawOptionId) {
  const opts = optionsOfProduct(prod.id);
  if (opts.length === 0) return { option: null };
  const id = Number(rawOptionId);
  if (rawOptionId === undefined || rawOptionId === null || rawOptionId === '' || !Number.isInteger(id)) {
    return { error: `Elige una presentación para “${prod.name}”: ${opts.map(o => o.label).join(' o ')}.` };
  }
  const option = opts.find(o => o.id === id);
  if (!option) return { error: `La presentación elegida no es válida para “${prod.name}”. Vuelve a elegirla.` };
  return { option };
}

// "Gallo de lata · Chamoy con Tajín": la presentación va delante del escarchado para que se vea en la comanda y en el ticket.
export function labelWithCustomization(option, customization) {
  const c = cleanText(customization, 200);
  if (!option) return c;
  return c ? `${option.label} · ${c}` : option.label;
}

// Baja del inventario de ESTA sucursal el insumo de la presentación elegida.
export function deductOption(branchId, option, qty, { reference, userId, notes }) {
  if (!option) return;
  moveStock(branchId, option.inventory_item_id, -(option.quantity * qty), { type: 'venta', reference, userId, notes });
}

// Lo que escribe el administrador en el Menú: se limpia y se valida. Devuelve { options } o { error }.
export function normalizeOptionsInput(raw) {
  if (!Array.isArray(raw)) return { options: null }; // no vino: no se toca lo que ya hay
  if (raw.length > MAX_OPTIONS) return { error: `Máximo ${MAX_OPTIONS} presentaciones por producto` };
  if (raw.length === 1) return { error: 'Una sola presentación no sirve para elegir: agrega otra o quita esa.' };
  const out = [];
  const seen = new Set();
  for (const o of raw) {
    const label = cleanText(o?.label, 40);
    const itemId = Number(o?.inventory_item_id);
    const qty = Number(o?.quantity === undefined || o?.quantity === '' ? 1 : o.quantity);
    if (!label) return { error: 'Cada presentación necesita un nombre (por ejemplo “Gallo de lata”)' };
    if (!Number.isInteger(itemId) || !db.prepare('SELECT 1 FROM inventory_items WHERE id = ?').get(itemId)) {
      return { error: `Elige qué se descuenta del inventario en “${label}”` };
    }
    if (!Number.isFinite(qty) || qty <= 0 || qty > 100000) {
      return { error: `La cantidad de “${label}” debe ser mayor que cero` };
    }
    const key = label.toLowerCase();
    if (seen.has(key)) return { error: `Hay dos presentaciones llamadas “${label}”` };
    seen.add(key);
    const id = Number(o?.id);
    out.push({ id: Number.isInteger(id) && id > 0 ? id : null, label, inventory_item_id: itemId, quantity: qty });
  }
  return { options: out };
}

// Guarda las presentaciones de un producto CONSERVANDO el número (id) de las que ya existían:
// así una cuenta de mesa abierta que ya eligió "Gallo de lata" sigue descontando bien aunque el administrador cambie el menú.
export function saveProductOptions(productId, options) {
  const current = new Map(optionsOfProduct(productId).map(o => [o.id, o]));
  const keep = new Set();
  const upd = db.prepare('UPDATE product_options SET label = ?, inventory_item_id = ?, quantity = ?, sort_order = ? WHERE id = ? AND product_id = ?');
  const ins = db.prepare('INSERT INTO product_options (product_id, label, inventory_item_id, quantity, sort_order) VALUES (?, ?, ?, ?, ?)');
  options.forEach((o, idx) => {
    if (o.id && current.has(o.id)) {
      upd.run(o.label, o.inventory_item_id, o.quantity, idx + 1, o.id, productId);
      keep.add(o.id);
    } else {
      const r = ins.run(productId, o.label, o.inventory_item_id, o.quantity, idx + 1);
      keep.add(Number(r.lastInsertRowid));
    }
  });
  for (const id of current.keys()) {
    if (!keep.has(id)) db.prepare('DELETE FROM product_options WHERE id = ?').run(id);
  }
}

// Costo que se guarda en el producto cuando tiene presentaciones: se toma la más cara, para no inflar el margen.
export function costOfMostExpensiveOption(options) {
  let max = 0;
  for (const o of options) {
    const inv = db.prepare('SELECT cost_per_unit FROM inventory_items WHERE id = ?').get(o.inventory_item_id);
    max = Math.max(max, (inv?.cost_per_unit || 0) * o.quantity);
  }
  return max;
}
