// Los cambios de "Pasar a ml" sobre la base (sin copia de seguridad ni transacción: las pone quien lo llama).
// Lo usan el botón "🔄 Pasar a ml" (convertir_ml.js) y la conversión que se hace sola con la base del dueño (db.js).
// Este archivo no importa nada de db.js a propósito (así db.js puede usarlo sin dar vueltas).

export const r6 = (n) => Math.round((Number(n) + Number.EPSILON) * 1e6) / 1e6;
export const r8 = (n) => Math.round((Number(n) + Number.EPSILON) * 1e8) / 1e8;

// Lo que vale cada bebida que usa el insumo (suma cantidad × costo), cada opción y el valor del inventario de ese insumo
export function fotoDeCostos(db, itemId) {
  const bebidas = db.prepare(`
    SELECT r.product_id AS id, ROUND(SUM(r.quantity * i.cost_per_unit), 4) AS costo
    FROM recipe_items r JOIN inventory_items i ON i.id = r.inventory_item_id
    WHERE r.product_id IN (SELECT product_id FROM recipe_items WHERE inventory_item_id = ?)
    GROUP BY r.product_id
  `).all(itemId);
  const opciones = db.prepare(`
    SELECT o.id, ROUND(o.quantity * i.cost_per_unit, 4) AS costo
    FROM product_options o JOIN inventory_items i ON i.id = o.inventory_item_id
    WHERE o.inventory_item_id = ?
  `).all(itemId);
  const valor = db.prepare(`
    SELECT ROUND(COALESCE(SUM(s.current_stock * i.cost_per_unit), 0), 4) AS v
    FROM inventory_stock s JOIN inventory_items i ON i.id = s.inventory_item_id WHERE i.id = ?
  `).get(itemId).v;
  return { bebidas, opciones, valor };
}

// 9.975 ml → 10 ml: si una cantidad ya convertida está a menos del 1 % de un número "redondo" (de medio en medio ml), se deja el redondo.
const bonito = (q) => {
  const m = Math.round(q * 2) / 2;
  return m > 0 && Math.abs(m - q) / q < 0.01 ? m : q;
};

// Convierte UN insumo (la fila tal como estaba, medida en piezas, litros u onzas) a ml, multiplicando todo por f.
// Debe llamarse dentro de una transacción. Si algo no cuadra (el costo de una bebida o el valor del inventario cambian), lanza un error.
// Opciones: presentacion = nombre para guardar "1 pieza" como botella cuando el insumo no tenía presentación; redondear = cantidades "bonitas".
export function aplicarConversion(db, item, f, { presentacion, redondear = false } = {}) {
  const itemId = item.id;
  const antes = fotoDeCostos(db, itemId);
  const directos = db.prepare(`
    SELECT p.id, p.name,
      (SELECT COUNT(*) FROM product_options o WHERE o.product_id = p.id) AS n_opciones,
      (SELECT COUNT(*) FROM recipe_items r WHERE r.product_id = p.id) AS n_receta
    FROM products p WHERE p.direct_inventory_item_id = ?
  `).all(itemId);
  const viejo = directos.find((d) => d.n_receta > 0 && d.n_opciones === 0);
  if (viejo) throw new Error(`“${viejo.name}” se vende tal cual pero tiene una receta guardada de antes`);

  // El insumo
  let packNombre = item.pack_name, packTam = item.pack_size;
  if (item.pack_size > 0) {
    packTam = r6(item.pack_size * f);
  } else if (item.unit === 'pza' && presentacion && String(presentacion).trim()) {
    packNombre = String(presentacion).trim().slice(0, 30); packTam = r6(f);   // "1 pieza" = 1 botella de f ml
  }
  db.prepare(`
    UPDATE inventory_items
    SET unit = 'ml', current_stock = ?, min_stock = ?, cost_per_unit = ?, pack_name = ?, pack_size = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(r6(item.current_stock * f), r6(item.min_stock * f), r8(item.cost_per_unit / f), packNombre, packTam, itemId);

  // Existencias y mínimo de cada sucursal
  db.prepare(`
    UPDATE inventory_stock
    SET current_stock = ROUND(current_stock * ?, 6), min_stock = ROUND(min_stock * ?, 6), updated_at = CURRENT_TIMESTAMP
    WHERE inventory_item_id = ?
  `).run(f, f, itemId);

  // Recetas y presentaciones (vidrio / lata...)
  db.prepare('UPDATE recipe_items SET quantity = ROUND(quantity * ?, 6) WHERE inventory_item_id = ?').run(f, itemId);
  db.prepare('UPDATE product_options SET quantity = ROUND(quantity * ?, 6) WHERE inventory_item_id = ?').run(f, itemId);
  if (redondear) {
    for (const [tabla, filas] of [
      ['recipe_items', db.prepare('SELECT id, quantity FROM recipe_items WHERE inventory_item_id = ?').all(itemId)],
      ['product_options', db.prepare('SELECT id, quantity FROM product_options WHERE inventory_item_id = ?').all(itemId)],
    ]) {
      for (const fila of filas) {
        const b = bonito(fila.quantity);
        if (b !== fila.quantity) db.prepare(`UPDATE ${tabla} SET quantity = ? WHERE id = ?`).run(b, fila.id);
      }
    }
  }

  // Historial: para que anular una venta de antes devuelva los ml correctos
  db.prepare(`
    UPDATE inventory_movements
    SET quantity = ROUND(quantity * ?, 6), previous_stock = ROUND(previous_stock * ?, 6), new_stock = ROUND(new_stock * ?, 6)
    WHERE inventory_item_id = ?
  `).run(f, f, f, itemId);

  // "Se vende tal cual" → receta de una pieza en ml (descuenta lo mismo que antes). Con presentaciones solo se quita el insumo base:
  // la presentación que elige el cliente ya es la que descuenta.
  for (const d of directos) {
    db.prepare('UPDATE products SET is_direct_sale = ?, direct_inventory_item_id = NULL WHERE id = ?').run(d.n_opciones > 0 ? 1 : 0, d.id);
    if (d.n_opciones === 0) db.prepare('INSERT INTO recipe_items (product_id, inventory_item_id, quantity) VALUES (?, ?, ?)').run(d.id, itemId, r6(f));
  }

  // Comprobación: lo que vale cada bebida, cada presentación y el inventario tiene que quedar igual
  const despues = fotoDeCostos(db, itemId);
  const dist = (a, b) => Math.abs((a || 0) - (b || 0));
  for (const b of antes.bebidas) {
    const nueva = despues.bebidas.find((x) => x.id === b.id);
    if (!nueva || dist(b.costo, nueva.costo) > 0.02) throw new Error(`el costo de una bebida (id ${b.id}) cambió de ${b.costo} a ${nueva ? nueva.costo : 'nada'}`);
  }
  for (const o of antes.opciones) {
    const nueva = despues.opciones.find((x) => x.id === o.id);
    if (!nueva || dist(o.costo, nueva.costo) > 0.02) throw new Error(`el costo de una presentación (id ${o.id}) cambió`);
  }
  if (dist(antes.valor, despues.valor) > Math.max(0.05, antes.valor * 0.0005)) throw new Error(`el valor del inventario cambió de ${antes.valor} a ${despues.valor}`);
  return { antes, despues, directos: directos.length };
}
