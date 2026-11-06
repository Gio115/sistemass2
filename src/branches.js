// Sucursales: qué sucursal está usando cada petición y funciones de apoyo para las existencias.
//
// Regla de oro: el navegador manda en cada petición la cabecera "X-Branch-Id" con la sucursal que el usuario
// eligió arriba, pero el servidor NUNCA se la cree sin revisar:
//   - un vendedor solo puede usar las sucursales que el administrador le asignó;
//   - el administrador puede usar cualquiera, y solo en reportes puede pedir "all" (todas juntas);
//   - si no llega la cabecera, se usa la primera sucursal permitida.
import { db } from './db.js';

export function listBranches(onlyActive = true) {
  return db.prepare(`SELECT id, name, is_active, display_order FROM branches ${onlyActive ? 'WHERE is_active = 1' : ''} ORDER BY display_order ASC, id ASC`).all();
}

// Sucursales a las que puede entrar un usuario.
export function branchesForUser(user) {
  if (user.role === 'admin') return listBranches(true);
  return db.prepare(`
    SELECT b.id, b.name, b.is_active, b.display_order
    FROM branches b
    JOIN user_branches ub ON ub.branch_id = b.id
    WHERE ub.user_id = ? AND b.is_active = 1
    ORDER BY b.display_order ASC, b.id ASC
  `).all(user.id);
}

// Middleware: deja en req.branchId (número, o null si es "todas"), req.branchIds (lista), req.allBranches y req.branch.
// Debe ir DESPUÉS de authenticate. { allowAll: true } solo para pantallas de reportes del administrador.
export function branchContext(opts = {}) {
  const allowAll = !!opts.allowAll;
  return (req, res, next) => {
    const allowed = branchesForUser(req.user);
    const allowedIds = allowed.map(b => b.id);
    const raw = String(req.headers['x-branch-id'] ?? '').trim().toLowerCase();

    if (allowedIds.length === 0) {
      return res.status(403).json({ error: 'No tienes ninguna sucursal asignada. Avisa al administrador para que te asigne una.' });
    }

    if (raw === 'all') {
      if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'No tienes permiso para ver todas las sucursales juntas.' });
      }
      if (!allowAll) {
        return res.status(400).json({ error: 'Elige una sucursal arriba (no “Ambas”) para usar esta pantalla.', code: 'BRANCH_REQUIRED' });
      }
      req.allBranches = true;
      req.branchId = null;
      req.branch = null;
      req.branchIds = allowedIds;
      return next();
    }

    let id;
    if (raw === '') {
      id = allowedIds[0];
    } else if (/^\d+$/.test(raw)) {
      id = Number(raw);
    } else {
      return res.status(400).json({ error: 'Sucursal no válida' });
    }

    if (!allowedIds.includes(id)) {
      return res.status(403).json({ error: 'No tienes acceso a esa sucursal.' });
    }

    req.allBranches = false;
    req.branchId = id;
    req.branch = allowed.find(b => b.id === id);
    req.branchIds = [id];
    next();
  };
}

// Condición SQL para filtrar por la(s) sucursal(es) de la petición: usa los ids ya validados (son enteros).
export function branchFilterSql(req, column) {
  return `${column} IN (${req.branchIds.map(n => Number(n)).join(',')})`;
}

// Existencias de un insumo en una sucursal (si por alguna razón no existe la fila, se crea en 0).
export function getStock(branchId, itemId) {
  let row = db.prepare('SELECT current_stock, min_stock FROM inventory_stock WHERE branch_id = ? AND inventory_item_id = ?').get(branchId, itemId);
  if (!row) {
    const item = db.prepare('SELECT min_stock FROM inventory_items WHERE id = ?').get(itemId);
    if (!item) return null;
    db.prepare('INSERT OR IGNORE INTO inventory_stock (branch_id, inventory_item_id, current_stock, min_stock) VALUES (?, ?, 0, ?)').run(branchId, itemId, item.min_stock);
    row = { current_stock: 0, min_stock: item.min_stock };
  }
  return row;
}

// Descuenta (qty positivo) o suma (qty negativo) existencias en UNA sucursal y deja el movimiento en el historial.
// Devuelve { previous, next } o null si el insumo no existe.
// Con setTo se deja la existencia EXACTAMENTE en ese número (lo usa el conteo físico, para no arrastrar decimales de sumas y restas).
export function moveStock(branchId, itemId, delta, { type, reference = '', userId = null, notes = '', clampAtZero = false, setTo = undefined }) {
  const row = getStock(branchId, itemId);
  if (!row) return null;
  const previous = row.current_stock;
  const next = setTo !== undefined ? setTo : (clampAtZero ? Math.max(0, previous + delta) : previous + delta);
  if (setTo !== undefined) delta = next - previous;
  db.prepare('UPDATE inventory_stock SET current_stock = ?, updated_at = CURRENT_TIMESTAMP WHERE branch_id = ? AND inventory_item_id = ?').run(next, branchId, itemId);
  db.prepare(`
    INSERT INTO inventory_movements (inventory_item_id, branch_id, type, quantity, previous_stock, new_stock, reference_id, user_id, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(itemId, branchId, type, delta, previous, next, reference, userId, notes);
  return { previous, next };
}

// Un producto pausado en esta sucursal no se puede vender aquí (aunque siga a la venta en las otras).
export function isPausedInBranch(productId, branchId) {
  return !!db.prepare('SELECT 1 FROM branch_paused_products WHERE branch_id = ? AND product_id = ?').get(branchId, productId);
}

// Después de crear un insumo o una sucursal: todas las sucursales tienen su fila de existencias.
export function ensureStockRowsForItem(itemId, minStock, stockByBranch = {}) {
  const ins = db.prepare('INSERT OR IGNORE INTO inventory_stock (branch_id, inventory_item_id, current_stock, min_stock) VALUES (?, ?, ?, ?)');
  for (const b of db.prepare('SELECT id FROM branches').all()) {
    ins.run(b.id, itemId, Number(stockByBranch[b.id]) || 0, minStock);
  }
}

export function ensureStockRowsForBranch(branchId) {
  db.prepare(`
    INSERT OR IGNORE INTO inventory_stock (branch_id, inventory_item_id, current_stock, min_stock)
    SELECT ?, id, 0, min_stock FROM inventory_items
  `).run(branchId);
}
