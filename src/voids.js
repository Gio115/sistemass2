// Anulación de ventas.
//
// Reglas:
//  - La venta NO se borra: queda con estado 'anulada', quién la anuló, cuándo y por qué (queda constancia).
//  - El inventario se devuelve EXACTAMENTE con lo que esa venta bajó (se leen los movimientos de esa venta), así
//    que cuadra aunque después se haya cambiado una receta, una presentación (vidrio / lata) o un precio.
//  - Una venta anulada ya no cuenta en ventas del día, cortes de caja, ganancias ni "lo más vendido".
//  - Quién puede: el administrador, cualquier venta; el vendedor, solo SUS ventas de su caja que sigue abierta.
import { db } from './db.js';
import { branchesForUser, moveStock } from './branches.js';

export const VOID_REASON_MIN = 3;

// Texto fijo para filtrar en SQL: las ventas que sí cuentan.
export const SALE_COUNTS = "status != 'anulada'";

// null si este usuario puede anular la venta; si no, el mensaje que se le muestra.
export function whyCannotVoid(sale, user) {
  if (sale.status === 'anulada') return 'Esta venta ya estaba anulada.';
  if (user.role === 'admin') return null;

  if (!branchesForUser(user).some(b => b.id === sale.branch_id)) {
    return 'No tienes acceso a la sucursal de esta venta.';
  }
  if (sale.cashier_id !== user.id) {
    return 'Solo puedes anular tus propias ventas. Pídele al administrador que anule esta.';
  }
  const shift = sale.cash_shift_id
    ? db.prepare('SELECT status, user_id FROM cash_shifts WHERE id = ?').get(sale.cash_shift_id)
    : null;
  if (!shift || shift.status !== 'open' || shift.user_id !== user.id) {
    return 'Esta venta es de una caja que ya se cerró. Pídele al administrador que la anule.';
  }
  return null;
}

// Anula la venta y devuelve los insumos. Devuelve { ok: true, sale, restocked } o { ok: false, error }.
// Todo o nada: si algo falla a la mitad, no queda nada a medias.
export function voidSale(sale, user, reason) {
  db.exec('BEGIN TRANSACTION;');
  try {
    // Se vuelve a leer ya dentro de la transacción: si alguien tocó el botón dos veces, la segunda no hace nada.
    const current = db.prepare('SELECT * FROM sales WHERE id = ?').get(sale.id);
    if (!current || current.status === 'anulada') {
      db.exec('ROLLBACK;');
      return { ok: false, error: 'Esta venta ya estaba anulada.' };
    }

    // 1) Devolver al inventario lo que bajó esa venta (ingredientes de receta, producto directo o presentación elegida)
    const taken = db.prepare(`
      SELECT m.inventory_item_id AS item_id, i.name, i.unit, SUM(m.quantity) AS qty
      FROM inventory_movements m
      JOIN inventory_items i ON i.id = m.inventory_item_id
      WHERE m.type = 'venta' AND m.reference_id = ? AND m.branch_id = ?
      GROUP BY m.inventory_item_id
    `).all(current.ticket_number, current.branch_id);

    const restocked = [];
    for (const t of taken) {
      const back = Math.round(-t.qty * 1e6) / 1e6; // lo que bajó es negativo; se devuelve en positivo
      if (!(back > 0)) continue;
      moveStock(current.branch_id, t.item_id, back, {
        type: 'ajuste',
        reference: current.ticket_number,
        userId: user.id,
        notes: `ANULACIÓN de la venta ${current.ticket_number}: se devuelve al inventario (${reason})`
      });
      restocked.push({ name: t.name, unit: t.unit, quantity: back });
    }

    // 2) Marcar la venta (no se borra)
    const who = user.full_name || user.username;
    const upd = db.prepare(`
      UPDATE sales
      SET status = 'anulada', voided_at = CURRENT_TIMESTAMP, voided_by = ?, voided_by_name = ?, void_reason = ?
      WHERE id = ? AND status != 'anulada'
    `).run(user.id, who, reason, current.id);
    if (Number(upd.changes) !== 1) {
      db.exec('ROLLBACK;');
      return { ok: false, error: 'Esta venta ya estaba anulada.' };
    }

    // 3) Ajustar la caja a la que pertenecía
    if (current.cash_shift_id) {
      const shift = db.prepare('SELECT status FROM cash_shifts WHERE id = ?').get(current.cash_shift_id);
      if (shift) {
        db.prepare(`
          UPDATE cash_shifts
          SET total_sales_count = MAX(0, total_sales_count - 1),
              total_sales_amount = MAX(0, total_sales_amount - ?)
          WHERE id = ?
        `).run(current.total, current.cash_shift_id);

        if (shift.status === 'open') {
          // Caja abierta: el corte se calcula al cerrar con las ventas válidas. Solo las cuentas de mesa
          // suman "efectivo esperado" al cobrar, así que solo esas lo restan aquí.
          if (current.table_id && current.payment_method === 'efectivo') {
            db.prepare('UPDATE cash_shifts SET expected_cash = MAX(0, expected_cash - ?) WHERE id = ?')
              .run(current.total, current.cash_shift_id);
          }
        } else {
          // Caja ya cerrada: el conteo de ese día no se reescribe (ya se contó el dinero), pero queda anotado.
          db.prepare("UPDATE cash_shifts SET notes = TRIM(COALESCE(notes, '') || ' [Venta ' || ? || ' anulada después del cierre: Q' || ? || ']') WHERE id = ?")
            .run(current.ticket_number, Number(current.total).toFixed(2), current.cash_shift_id);
        }
      }
    }

    db.exec('COMMIT;');
    return { ok: true, sale: db.prepare('SELECT * FROM sales WHERE id = ?').get(current.id), restocked };
  } catch (err) {
    try { db.exec('ROLLBACK;'); } catch (e) { /* ya estaba cerrada */ }
    throw err;
  }
}
