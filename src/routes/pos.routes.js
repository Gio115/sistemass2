import { Router } from 'express';
import { db } from '../db.js';
import { authenticate, requireAdmin } from '../auth.js';
import { branchContext, branchesForUser, moveStock, isPausedInBranch } from '../branches.js';
import { cleanText, parseQuantity } from '../validate.js';
import { pickOption, labelWithCustomization, deductOption } from '../options.js';
import { anotarDisponibilidad, revisarStock, reservadoEnMesas } from '../stock-venta.js';
import { voidSale, whyCannotVoid, VOID_REASON_MIN } from '../voids.js';
import { recargoPorMetodo } from '../recargo.js';
import { miniaturaDe } from '../miniaturas.js';

const PAYMENT_METHODS = ['efectivo', 'tarjeta', 'transferencia', 'mixto'];

const router = Router();

// Cuántos tickets lleva el día (TK-AAAAMMDD-XXXX). Se cuenta por rango de texto, que usa el índice del número de ticket
// y da exactamente el mismo número que contar con LIKE 'TK-AAAAMMDD-%' (la "." va justo después del "-" en el abecedario).
function ticketsDelDia(dateStr) {
  return db.prepare('SELECT COUNT(*) AS count FROM sales WHERE ticket_number >= ? AND ticket_number < ?')
    .get(`TK-${dateStr}-`, `TK-${dateStr}.`).count;
}

// Casi todas las rutas necesitan saber en qué sucursal se trabaja (cabecera X-Branch-Id, validada por el servidor).
const guard = [authenticate, branchContext()];

// GET /api/pos/catalog - Products and categories for the POS terminal
router.get('/catalog', ...guard, (req, res) => {
  try {
    const categories = db.prepare(`
      SELECT id, name, icon, display_order 
      FROM categories 
      ORDER BY display_order ASC, name ASC
    `).all();

    // IMPORTANTE: columnas explícitas. Nunca usar p.* en este endpoint: incluiría `cost`
    // (costo y margen) y el catálogo lo consume también el rol vendedor.
    // Tampoco se envían las recetas (son información interna del negocio).
    const products = db.prepare(`
      SELECT p.id, p.category_id, p.name, p.description, p.price,
        p.is_direct_sale, p.direct_inventory_item_id, p.badge, p.is_active,
        c.name as category_name,
        CASE WHEN inv.id IS NULL THEN NULL ELSE COALESCE(stk.current_stock, 0) END as direct_stock,
        inv.unit as direct_unit,
        (SELECT version FROM product_images WHERE product_id = p.id) as image_v
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN inventory_items inv ON p.direct_inventory_item_id = inv.id
      LEFT JOIN inventory_stock stk ON stk.inventory_item_id = inv.id AND stk.branch_id = ?
      WHERE p.is_active = 1
        AND NOT EXISTS (SELECT 1 FROM branch_paused_products bp WHERE bp.branch_id = ? AND bp.product_id = p.id)
      ORDER BY p.name ASC
    `).all(req.branchId, req.branchId);

    // Presentaciones que el cliente elige (vidrio / lata...). Solo se envía el nombre y cuánto queda en ESTA sucursal
    // (si el insumo se mide en ml, se cuenta cuántas ventas alcanzan: 2000 ml con 355 ml por venta = 5);
    // qué insumo descuenta cada una y en qué cantidad es información interna.
    const optionRows = db.prepare(`
      SELECT po.id, po.product_id, po.label,
        CASE WHEN inv.unit = 'ml' AND po.quantity > 0 THEN CAST(COALESCE(stk.current_stock, 0) / po.quantity AS INTEGER) ELSE COALESCE(stk.current_stock, 0) END as stock,
        CASE WHEN inv.unit = 'ml' THEN 'pza' ELSE inv.unit END as unit
      FROM product_options po
      JOIN inventory_items inv ON inv.id = po.inventory_item_id
      LEFT JOIN inventory_stock stk ON stk.inventory_item_id = inv.id AND stk.branch_id = ?
      ORDER BY po.product_id ASC, po.sort_order ASC, po.id ASC
    `).all(req.branchId);
    const optionsByProduct = {};
    for (const o of optionRows) {
      (optionsByProduct[o.product_id] ||= []).push({ id: o.id, label: o.label, stock: o.stock, unit: o.unit });
    }
    for (const p of products) p.options = optionsByProduct[p.id] || [];
    // Lo que no tiene stock en ESTA sucursal sale marcado y no se puede vender (solo lee el inventario)
    anotarDisponibilidad(req.branchId, products);

    const settings = db.prepare('SELECT business_name, tagline, address, phone, tax_id, currency_symbol, escarchados, salsas, card_surcharge_percent FROM system_settings WHERE id = 1').get() || {};

    res.json({
      categories,
      products,
      settings,
      branch: { id: req.branch.id, name: req.branch.name }
    });
  } catch (error) {
    console.error('Error al obtener catálogo POS:', error);
    res.status(500).json({ error: 'Error al cargar catálogo de productos' });
  }
});

// GET /api/pos/product-image/:id - Foto de un producto del menú.
// Es pública a propósito: la etiqueta <img> no puede enviar la contraseña, y una foto del menú no es información privada.
// La dirección lleva ?v=<versión>, así que el aparato la guarda mucho tiempo y baja la nueva apenas cambia.
router.get('/product-image/:id', (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  const row = Number.isInteger(id) ? db.prepare('SELECT data FROM product_images WHERE product_id = ?').get(id) : null;
  if (!row) return res.status(404).end();
  let body = Buffer.from(row.data.buffer, row.data.byteOffset, row.data.byteLength);
  // ?m=1 -> copia chica para mostrar en las tarjetas (la original no se toca; si no se puede reducir, va la original)
  if (req.query.m === '1') body = miniaturaDe(body) || body;
  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.setHeader('Content-Length', body.length);
  res.end(body);
});

// POST /api/pos/sale - Register a sale and automatically deduct liquid & bottle inventory
router.post('/sale', ...guard, (req, res) => {
  try {
    const { items, payment_method, amount_paid } = req.body;
    const notes = cleanText(req.body.notes, 300);

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'La venta debe contener al menos un producto' });
    }
    if (items.length > 100) {
      return res.status(400).json({ error: 'Demasiados productos en una sola venta' });
    }

    if (!PAYMENT_METHODS.includes(payment_method)) {
      return res.status(400).json({ error: 'Método de pago no válido' });
    }

    // Turno de caja abierto de este cajero EN ESTA sucursal
    const activeShift = db.prepare(`
      SELECT * FROM cash_shifts 
      WHERE user_id = ? AND branch_id = ? AND status = 'open' 
      ORDER BY id DESC LIMIT 1
    `).get(req.user.id, req.branchId);

    // Calculate totals
    let subtotal = 0;
    const validatedItems = [];

    for (const item of items) {
      const prod = db.prepare('SELECT * FROM products WHERE id = ? AND is_active = 1').get(item.product_id);
      if (!prod) {
        return res.status(400).json({ error: `Producto no encontrado: ID ${item.product_id}` });
      }
      if (isPausedInBranch(prod.id, req.branchId)) {
        return res.status(400).json({ error: `“${prod.name}” está pausado en esta sucursal. Quítalo del pedido.` });
      }

      const qty = parseQuantity(item.quantity);
      if (qty === null) {
        return res.status(400).json({ error: `Cantidad inválida para producto ${prod.name}` });
      }

      const picked = pickOption(prod, item.option_id);
      if (picked.error) {
        return res.status(400).json({ error: picked.error });
      }

      const itemSubtotal = prod.price * qty;
      subtotal += itemSubtotal;

      validatedItems.push({
        product_id: prod.id,
        product_name: prod.name,
        unit_price: prod.price,
        quantity: qty,
        subtotal: itemSubtotal,
        customization: labelWithCustomization(picked.option, item.customization),
        option: picked.option,
        is_direct_sale: prod.is_direct_sale,
        direct_inventory_item_id: prod.direct_inventory_item_id
      });
    }

    // Ya no se permiten descuentos a mano (se prestaban a abusos): lo que se cobra es la suma de los productos.
    // Las promociones (cubetazos, combos) se venden como productos con su propio precio.
    const discountVal = 0;
    // Pagar con tarjeta suma el recargo (5 % por defecto, se cambia en Ajustes); con efectivo o transferencia no se suma nada.
    const cardSurcharge = recargoPorMetodo(payment_method, subtotal - discountVal);
    const total = Math.round((subtotal - discountVal + cardSurcharge) * 100) / 100;
    let paid = parseFloat(amount_paid);

    if (isNaN(paid)) {
      return res.status(400).json({ error: 'Monto pagado inválido' });
    }
    // La tarjeta cobra exactamente el total (no hay "con cuánto paga" ni cambio)
    if (payment_method === 'tarjeta') paid = total;
    if (paid < total) {
      return res.status(400).json({
        error: `El monto pagado (Q ${paid.toFixed(2)}) es menor al total a pagar (Q ${total.toFixed(2)})`
      });
    }

    const change_given = Math.max(0, paid - total);

    // Lo que no tiene stock en esta sucursal no se vende (se revisa el pedido completo, sumando lo que comparten los productos)
    const sinStock = revisarStock(req.branchId, validatedItems.map(it => ({
      prod: { id: it.product_id, name: it.product_name, is_direct_sale: it.is_direct_sale, direct_inventory_item_id: it.direct_inventory_item_id },
      option: it.option, qty: it.quantity
    })), { reservado: reservadoEnMesas(req.branchId) });
    if (sinStock) return res.status(400).json(sinStock);

    // Generate ticket number: TK-YYYYMMDD-XXXX
    const today = new Date();
    const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '');
    const dailyCount = ticketsDelDia(dateStr);
    
    const seq = String(dailyCount + 1).padStart(4, '0');
    const ticket_number = `TK-${dateStr}-${seq}`;

    // Execute in transaction
    const saleInsert = db.prepare(`
      INSERT INTO sales (
        ticket_number, cash_shift_id, cashier_id, cashier_name,
        subtotal, discount, total, payment_method, amount_paid, change_given, notes, branch_id, card_surcharge
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const saleItemInsert = db.prepare(`
      INSERT INTO sale_items (sale_id, product_id, product_name, unit_price, quantity, subtotal, customization)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    db.exec('BEGIN TRANSACTION;');

    try {
      const saleResult = saleInsert.run(
        ticket_number,
        activeShift ? activeShift.id : null,
        req.user.id,
        req.user.full_name || req.user.username,
        subtotal,
        discountVal,
        total,
        payment_method,
        paid,
        change_given,
        notes,
        req.branchId,
        cardSurcharge
      );

      const saleId = Number(saleResult.lastInsertRowid);

      // Process items and inventory deduction
      for (const item of validatedItems) {
        saleItemInsert.run(
          saleId,
          item.product_id,
          item.product_name,
          item.unit_price,
          item.quantity,
          item.subtotal,
          item.customization
        );

        // Si el cliente eligió una presentación (vidrio / lata...), baja el insumo de esa presentación.
        deductOption(req.branchId, item.option, item.quantity, {
          reference: ticket_number,
          userId: req.user.id,
          notes: `Venta Ticket ${ticket_number} - ${item.product_name} (${item.option?.label})`
        });

        if (item.is_direct_sale && item.direct_inventory_item_id && !item.option) {
          // Producto que se vende tal cual: baja 1 por unidad, en el inventario de ESTA sucursal
          // (si tiene presentaciones, la que eligió el cliente ya reemplaza a este insumo)
          moveStock(req.branchId, item.direct_inventory_item_id, -item.quantity, {
            type: 'venta',
            reference: ticket_number,
            userId: req.user.id,
            notes: `Venta Ticket ${ticket_number} - ${item.product_name}`
          });
        } else {
          // Bebida preparada: baja los ingredientes de la receta (líquidos, salsas, escarchados) de ESTA sucursal
          const recipeItems = db.prepare(`
            SELECT inventory_item_id, quantity 
            FROM recipe_items 
            WHERE product_id = ?
          `).all(item.product_id);

          for (const ing of recipeItems) {
            moveStock(req.branchId, ing.inventory_item_id, -(ing.quantity * item.quantity), {
              type: 'venta',
              reference: ticket_number,
              userId: req.user.id,
              notes: `Venta Ticket ${ticket_number} - Receta ${item.product_name} x${item.quantity}`
            });
          }
        }
      }

      // Update active shift totals if present
      if (activeShift) {
        db.prepare(`
          UPDATE cash_shifts
          SET total_sales_count = total_sales_count + 1,
              total_sales_amount = total_sales_amount + ?
          WHERE id = ?
        `).run(total, activeShift.id);
      }

      db.exec('COMMIT;');

      // Retrieve full ticket data for printing
      const settings = db.prepare('SELECT * FROM system_settings WHERE id = 1').get();
      const saleRecord = db.prepare('SELECT * FROM sales WHERE id = ?').get(saleId);
      const saleDetails = db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(saleId);

      res.status(201).json({
        success: true,
        message: '¡Venta registrada con éxito!',
        ticket: {
          ...saleRecord,
          items: saleDetails,
          settings,
          branch_name: req.branch.name
        }
      });
    } catch (err) {
      db.exec('ROLLBACK;');
      throw err;
    }
  } catch (error) {
    console.error('Error al procesar la venta:', error);
    res.status(500).json({ error: error.message || 'Error al registrar la venta' });
  }
});

// GET /api/pos/ticket/:ticketNumber - Retrieve single ticket
router.get('/ticket/:ticketNumber', authenticate, branchContext({ allowAll: true }), (req, res) => {
  try {
    const sale = db.prepare('SELECT * FROM sales WHERE ticket_number = ?').get(req.params.ticketNumber);
    // Un vendedor solo puede ver tickets de sus sucursales; el administrador, de todas.
    if (!sale || (req.user.role !== 'admin' && !branchesForUser(req.user).some(b => b.id === sale.branch_id))) {
      return res.status(404).json({ error: 'Ticket no encontrado' });
    }

    const items = db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(sale.id);
    const settings = db.prepare('SELECT * FROM system_settings WHERE id = 1').get();
    const branchRow = db.prepare('SELECT name FROM branches WHERE id = ?').get(sale.branch_id);

    res.json({
      ticket: {
        ...sale,
        items,
        settings,
        branch_name: branchRow ? branchRow.name : ''
      }
    });
  } catch (error) {
    console.error('Error al obtener ticket:', error);
    res.status(500).json({ error: 'Error al consultar ticket' });
  }
});

// GET /api/pos/shift/current - Current user active shift
router.get('/shift/current', ...guard, (req, res) => {
  try {
    const shift = db.prepare(`
      SELECT * FROM cash_shifts 
      WHERE user_id = ? AND branch_id = ? AND status = 'open' 
      ORDER BY id DESC LIMIT 1
    `).get(req.user.id, req.branchId);

    if (!shift) {
      return res.json({ active: false, shift: null });
    }

    // Calculate current shift sales breakdown
    const salesBreakdown = db.prepare(`
      SELECT 
        COUNT(*) as total_sales,
        COALESCE(SUM(total), 0) as total_amount,
        COALESCE(SUM(CASE WHEN payment_method = 'efectivo' THEN total ELSE 0 END), 0) as cash_total,
        COALESCE(SUM(CASE WHEN payment_method = 'tarjeta' THEN total ELSE 0 END), 0) as card_total,
        COALESCE(SUM(CASE WHEN payment_method = 'transferencia' THEN total ELSE 0 END), 0) as transfer_total
      FROM sales
      WHERE cash_shift_id = ? AND status != 'anulada'
    `).get(shift.id);

    res.json({
      active: true,
      shift,
      summary: salesBreakdown
    });
  } catch (error) {
    console.error('Error al obtener turno:', error);
    res.status(500).json({ error: 'Error al consultar turno activo' });
  }
});

// GET /api/pos/shift/sales - Ventas de MI caja abierta (para revisarlas o anular una por error)
router.get('/shift/sales', ...guard, (req, res) => {
  try {
    const shift = db.prepare(`
      SELECT id FROM cash_shifts
      WHERE user_id = ? AND branch_id = ? AND status = 'open'
      ORDER BY id DESC LIMIT 1
    `).get(req.user.id, req.branchId);
    if (!shift) return res.json({ active: false, sales: [] });

    const sales = db.prepare(`
      SELECT s.id, s.ticket_number, s.created_at, s.total, s.payment_method, s.table_name, s.status, s.void_reason,
        (SELECT GROUP_CONCAT(quantity || 'x ' || product_name, ', ') FROM sale_items WHERE sale_id = s.id) AS items_text
      FROM sales s
      WHERE s.cash_shift_id = ?
      ORDER BY s.id DESC
      LIMIT 200
    `).all(shift.id);

    res.json({ active: true, sales });
  } catch (error) {
    console.error('Error al listar ventas del turno:', error);
    res.status(500).json({ error: 'Error al consultar las ventas de tu caja' });
  }
});

// POST /api/pos/sales/void - Anular una venta (devuelve el inventario y deja constancia de quién y por qué)
router.post('/sales/void', authenticate, (req, res) => {
  try {
    const ticketNumber = cleanText(req.body.ticket_number, 40);
    const reason = cleanText(req.body.reason, 200);

    if (!ticketNumber) {
      return res.status(400).json({ error: 'Falta el número de la venta que se quiere anular' });
    }
    if (reason.length < VOID_REASON_MIN) {
      return res.status(400).json({ error: 'Escribe el motivo de la anulación (por ejemplo: “error al cobrar”).' });
    }

    const sale = db.prepare('SELECT * FROM sales WHERE ticket_number = ?').get(ticketNumber);
    // Un vendedor solo encuentra ventas de sus sucursales; el administrador, de todas.
    if (!sale || (req.user.role !== 'admin' && !branchesForUser(req.user).some(b => b.id === sale.branch_id))) {
      return res.status(404).json({ error: 'Venta no encontrada' });
    }

    const why = whyCannotVoid(sale, req.user);
    if (why) {
      return res.status(sale.status === 'anulada' ? 400 : 403).json({ error: why });
    }

    const result = voidSale(sale, req.user, reason);
    if (!result.ok) return res.status(400).json({ error: result.error });

    res.json({
      success: true,
      message: `Venta ${sale.ticket_number} anulada. El inventario se devolvió.`,
      sale: result.sale,
      restocked: result.restocked
    });
  } catch (error) {
    console.error('Error al anular la venta:', error);
    res.status(500).json({ error: 'No se pudo anular la venta. No se cambió nada; inténtalo otra vez.' });
  }
});

// POST /api/pos/shift/open - Open a cash shift
router.post('/shift/open', ...guard, (req, res) => {
  try {
    const { initial_cash = 0, notes = '' } = req.body;

    // Check if already open
    const existing = db.prepare(`
      SELECT id FROM cash_shifts 
      WHERE user_id = ? AND branch_id = ? AND status = 'open'
    `).get(req.user.id, req.branchId);

    if (existing) {
      return res.status(400).json({ error: 'Ya tienes un turno de caja abierto en esta sucursal' });
    }

    const initAmount = Math.max(0, parseFloat(initial_cash) || 0);

    const result = db.prepare(`
      INSERT INTO cash_shifts (user_id, branch_id, initial_cash, notes, status)
      VALUES (?, ?, ?, ?, 'open')
    `).run(req.user.id, req.branchId, initAmount, notes);

    const shift = db.prepare('SELECT * FROM cash_shifts WHERE id = ?').get(Number(result.lastInsertRowid));

    res.json({
      success: true,
      message: 'Turno de caja abierto correctamente',
      shift
    });
  } catch (error) {
    console.error('Error al abrir turno:', error);
    res.status(500).json({ error: 'Error al abrir turno de caja' });
  }
});

// POST /api/pos/shift/close - Close a cash shift (Corte de caja)
router.post('/shift/close', ...guard, (req, res) => {
  try {
    const { actual_cash, notes = '' } = req.body;

    const shift = db.prepare(`
      SELECT * FROM cash_shifts 
      WHERE user_id = ? AND branch_id = ? AND status = 'open' 
      ORDER BY id DESC LIMIT 1
    `).get(req.user.id, req.branchId);

    if (!shift) {
      return res.status(400).json({ error: 'No se encontró ningún turno abierto para cerrar en esta sucursal' });
    }

    const countedCash = parseFloat(actual_cash);
    if (isNaN(countedCash) || countedCash < 0) {
      return res.status(400).json({ error: 'Debe ingresar el efectivo contado físico en caja' });
    }

    // Calculate cash sales in this shift
    const cashSales = db.prepare(`
      SELECT 
        COALESCE(SUM(CASE WHEN payment_method = 'efectivo' THEN total ELSE 0 END), 0) as total_cash_sales,
        COUNT(*) as count_sales,
        COALESCE(SUM(total), 0) as total_revenue
      FROM sales
      WHERE cash_shift_id = ? AND status != 'anulada'
    `).get(shift.id);

    const expectedCash = shift.initial_cash + cashSales.total_cash_sales;
    const difference = countedCash - expectedCash;

    db.prepare(`
      UPDATE cash_shifts
      SET closed_at = CURRENT_TIMESTAMP,
          expected_cash = ?,
          actual_cash = ?,
          difference = ?,
          total_sales_count = ?,
          total_sales_amount = ?,
          status = 'closed',
          notes = ?
      WHERE id = ?
    `).run(
      expectedCash,
      countedCash,
      difference,
      cashSales.count_sales,
      cashSales.total_revenue,
      notes,
      shift.id
    );

    const closedShift = db.prepare('SELECT * FROM cash_shifts WHERE id = ?').get(shift.id);

    res.json({
      success: true,
      message: 'Turno de caja cerrado con éxito',
      shift: closedShift,
      expectedCash,
      countedCash,
      difference
    });
  } catch (error) {
    console.error('Error al cerrar turno:', error);
    res.status(500).json({ error: 'Error al cerrar turno de caja' });
  }
});

// ===================================================
// CONTROL DE MESAS & COMANDAS
// ===================================================

// POST /api/pos/tables/create - Create new dining table
router.post('/tables/create', ...guard, (req, res) => {
  try {
    const name = cleanText(req.body.name, 40);
    const area = cleanText(req.body.area, 40) || 'Salón Principal';
    if (!name) return res.status(400).json({ error: 'El nombre de la mesa es requerido' });

    const maxOrder = db.prepare('SELECT MAX(display_order) as maxOrder FROM dining_tables WHERE branch_id = ?').get(req.branchId).maxOrder || 0;
    const result = db.prepare(`
      INSERT INTO dining_tables (name, area, status, display_order, branch_id)
      VALUES (?, ?, 'libre', ?, ?)
    `).run(name, area, maxOrder + 1, req.branchId);

    res.json({ success: true, message: `Mesa ${name} creada con éxito`, id: Number(result.lastInsertRowid) });
  } catch (err) {
    console.error('Error creating table:', err);
    res.status(500).json({ error: 'Error al crear la mesa' });
  }
});

// POST /api/pos/tables/delete - Quitar una mesa de la lista (solo administrador).
// No se borra de la base de datos: se oculta (is_active = 0) para no perder las ventas y cuentas
// que ya se hicieron en esa mesa. Una mesa con cuenta abierta no se puede quitar.
router.post('/tables/delete', authenticate, requireAdmin, branchContext(), (req, res) => {
  try {
    const rawId = req.body.table_id;
    const tableId = typeof rawId === 'number' ? rawId : (typeof rawId === 'string' && /^\d+$/.test(rawId) ? Number(rawId) : NaN);
    if (!Number.isInteger(tableId) || tableId <= 0) return res.status(400).json({ error: 'Mesa no válida' });

    const table = db.prepare('SELECT * FROM dining_tables WHERE id = ? AND is_active = 1 AND branch_id = ?').get(tableId, req.branchId);
    if (!table) return res.status(404).json({ error: 'Mesa no encontrada' });

    const openOrder = db.prepare("SELECT 1 FROM table_orders WHERE table_id = ? AND status IN ('open', 'billed') LIMIT 1").get(tableId);
    if (table.status !== 'libre' || openOrder) {
      return res.status(409).json({
        error: `La ${table.name} tiene una cuenta abierta. Cóbrala o cancélala y después la puedes quitar.`
      });
    }

    db.prepare('UPDATE dining_tables SET is_active = 0 WHERE id = ?').run(tableId);
    res.json({ success: true, message: `${table.name} quitada de la lista` });
  } catch (err) {
    console.error('Error deleting table:', err);
    res.status(500).json({ error: 'Error al quitar la mesa' });
  }
});

// Mesas de una sucursal con su cuenta abierta y sus productos (si se pide soloMesaId, solo esa mesa).
// La usan la lista de mesas y, al guardar productos en una mesa, la respuesta de "agregar" (así la pantalla no tiene que volver a pedir todo).
function armarMesas(branchId, soloMesaId = null) {
  const tables = db.prepare(`
    SELECT t.*,
      o.id as active_order_id,
      o.opened_at,
      o.customer_name,
      o.notes as order_notes,
      o.total as order_total,
      u.full_name as waiter_name
    FROM dining_tables t
    LEFT JOIN table_orders o ON t.id = o.table_id AND o.status IN ('open', 'billed')
    LEFT JOIN users u ON o.opened_by = u.id
    WHERE t.is_active = 1 AND t.branch_id = ?${soloMesaId !== null ? ' AND t.id = ?' : ''}
    ORDER BY t.display_order ASC, t.id ASC
  `).all(...(soloMesaId !== null ? [branchId, soloMesaId] : [branchId]));

  const orderIds = tables.filter(t => t.active_order_id).map(t => t.active_order_id);
  let itemsMap = {};
  if (orderIds.length > 0) {
    const placeholders = orderIds.map(() => '?').join(',');
    const items = db.prepare(`
      SELECT oi.*, p.name as product_name
      FROM table_order_items oi
      JOIN products p ON oi.product_id = p.id
      WHERE oi.table_order_id IN (${placeholders})
      ORDER BY oi.id ASC
    `).all(...orderIds);

    for (const it of items) {
      if (!itemsMap[it.table_order_id]) itemsMap[it.table_order_id] = [];
      itemsMap[it.table_order_id].push(it);
    }
  }

  return tables.map(t => {
    const items = t.active_order_id ? (itemsMap[t.active_order_id] || []) : [];
    let minutesElapsed = 0;
    if (t.opened_at) {
      const openedTime = new Date(t.opened_at).getTime();
      const now = Date.now();
      minutesElapsed = Math.max(0, Math.floor((now - openedTime) / 60000));
    }

    return {
      ...t,
      order: t.active_order_id ? {
        id: t.active_order_id,
        customer_name: t.customer_name,
        opened_at: t.opened_at,
        minutes_elapsed: minutesElapsed,
        notes: t.order_notes,
        total: t.order_total,
        waiter_name: t.waiter_name,
        items
      } : null
    };
  });
}

// GET /api/pos/tables - List all tables with active orders and items
router.get('/tables', ...guard, (req, res) => {
  try {
    res.json({ tables: armarMesas(req.branchId) });
  } catch (err) {
    console.error('Error fetching tables:', err);
    res.status(500).json({ error: 'Error al cargar las mesas' });
  }
});

// POST /api/pos/tables/open - Open a table account
router.post('/tables/open', ...guard, (req, res) => {
  try {
    const { table_id } = req.body;
    const customer_name = cleanText(req.body.customer_name, 80);
    const notes = cleanText(req.body.notes, 300);
    const table = db.prepare('SELECT * FROM dining_tables WHERE id = ? AND is_active = 1 AND branch_id = ?').get(table_id, req.branchId);
    if (!table) return res.status(404).json({ error: 'Mesa no encontrada' });
    if (table.status !== 'libre') {
      return res.status(400).json({ error: `La ${table.name} ya se encuentra ocupada` });
    }

    const orderResult = db.prepare(`
      INSERT INTO table_orders (table_id, opened_by, customer_name, notes, status, total)
      VALUES (?, ?, ?, ?, 'open', 0)
    `).run(table_id, req.user.id, customer_name, notes);

    const orderId = Number(orderResult.lastInsertRowid);
    db.prepare("UPDATE dining_tables SET status = 'ocupada' WHERE id = ?").run(table_id);

    res.json({ success: true, order_id: orderId, message: `Cuenta abierta para ${table.name}` });
  } catch (err) {
    console.error('Error opening table:', err);
    res.status(500).json({ error: 'Error al abrir la mesa' });
  }
});

// POST /api/pos/tables/add-items - Add items to a table's comanda
router.post('/tables/add-items', ...guard, (req, res) => {
  try {
    const { table_id, items } = req.body;
    const customer_name = cleanText(req.body.customer_name, 80);

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Debes incluir al menos un producto en la comanda' });
    }
    if (items.length > 100) {
      return res.status(400).json({ error: 'Demasiados productos en una sola comanda' });
    }

    const table = db.prepare('SELECT * FROM dining_tables WHERE id = ? AND is_active = 1 AND branch_id = ?').get(table_id, req.branchId);
    if (!table) return res.status(404).json({ error: 'Mesa no encontrada' });

    // 1) Validar TODOS los productos antes de escribir nada en la base de datos.
    //    Una cantidad negativa, cero o decimal se rechaza (antes se aceptaba y reducía la cuenta).
    const validated = [];
    for (const item of items) {
      const productId = Number(item?.product_id);
      if (!Number.isInteger(productId)) {
        return res.status(400).json({ error: 'Producto inválido en la comanda' });
      }
      const prod = db.prepare('SELECT id, name, price, is_direct_sale, direct_inventory_item_id FROM products WHERE id = ? AND is_active = 1').get(productId);
      if (!prod) {
        return res.status(400).json({ error: `Producto no encontrado o inactivo: ID ${productId}` });
      }
      if (isPausedInBranch(prod.id, req.branchId)) {
        return res.status(400).json({ error: `“${prod.name}” está pausado en esta sucursal.` });
      }
      const qty = parseQuantity(item.quantity);
      if (qty === null) {
        return res.status(400).json({ error: `Cantidad inválida para producto ${prod.name}` });
      }
      const picked = pickOption(prod, item.option_id);
      if (picked.error) {
        return res.status(400).json({ error: picked.error });
      }
      validated.push({ prod, qty, option: picked.option, customization: labelWithCustomization(picked.option, item.customization) });
    }

    // Lo que no tiene stock no se pide: se cuenta también lo que ya está pedido en las cuentas abiertas (aún no descontado)
    const sinStock = revisarStock(req.branchId, validated.map(v => ({ prod: v.prod, option: v.option, qty: v.qty })), { reservado: reservadoEnMesas(req.branchId) });
    if (sinStock) return res.status(400).json(sinStock);

    // 2) Escribir todo o nada.
    db.exec('BEGIN TRANSACTION;');
    try {
      let order = db.prepare("SELECT * FROM table_orders WHERE table_id = ? AND status IN ('open', 'billed')").get(table_id);
      if (!order) {
        const newOrder = db.prepare(`
          INSERT INTO table_orders (table_id, opened_by, customer_name, status, total)
          VALUES (?, ?, ?, 'open', 0)
        `).run(table_id, req.user.id, customer_name);
        order = { id: Number(newOrder.lastInsertRowid), total: 0 };
      }

      const itemInsert = db.prepare(`
        INSERT INTO table_order_items (table_order_id, product_id, product_name, unit_price, quantity, subtotal, customization, added_by, option_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      let addedTotal = 0;
      for (const { prod, qty, customization, option } of validated) {
        const subtotal = prod.price * qty;
        itemInsert.run(order.id, prod.id, prod.name, prod.price, qty, subtotal, customization, req.user.id, option ? option.id : null);
        addedTotal += subtotal;
      }

      db.prepare('UPDATE table_orders SET total = total + ? WHERE id = ?').run(addedTotal, order.id);
      db.prepare("UPDATE dining_tables SET status = 'ocupada' WHERE id = ?").run(table_id);

      db.exec('COMMIT;');

      // Además del aviso, se devuelve la mesa ya actualizada: la pantalla la usa directo y se ahorra pedir toda la lista otra vez
      res.json({ success: true, message: `Comanda de ${table.name} actualizada (+Q ${addedTotal.toFixed(2)})`, table: armarMesas(req.branchId, table.id)[0] || null });
    } catch (txErr) {
      db.exec('ROLLBACK;');
      throw txErr;
    }
  } catch (err) {
    console.error('Error adding items to table:', err);
    res.status(500).json({ error: 'Error al agregar productos a la mesa' });
  }
});

// POST /api/pos/tables/remove-item - Remove single item from comanda
router.post('/tables/remove-item', ...guard, (req, res) => {
  try {
    const { table_order_item_id } = req.body;
    if (table_order_item_id === undefined || table_order_item_id === null || table_order_item_id === '') return res.status(400).json({ error: 'Falta saber qué producto retirar. Actualiza la página e inténtalo otra vez.' });
    const item = db.prepare(`
      SELECT oi.* FROM table_order_items oi
      JOIN table_orders o ON o.id = oi.table_order_id
      JOIN dining_tables t ON t.id = o.table_id
      WHERE oi.id = ? AND t.branch_id = ?
    `).get(table_order_item_id, req.branchId);
    if (!item) return res.status(404).json({ error: 'Producto de comanda no encontrado' });

    // Solo se pueden retirar productos de cuentas que siguen abiertas (no de cuentas ya cobradas/canceladas).
    const activeOrder = db.prepare("SELECT id FROM table_orders WHERE id = ? AND status IN ('open', 'billed')").get(item.table_order_id);
    if (!activeOrder) {
      return res.status(400).json({ error: 'Esta cuenta ya fue cerrada; no se pueden retirar productos' });
    }

    db.prepare('UPDATE table_orders SET total = MAX(0, total - ?) WHERE id = ?').run(item.subtotal, item.table_order_id);
    db.prepare('DELETE FROM table_order_items WHERE id = ?').run(table_order_item_id);

    res.json({ success: true, message: 'Producto retirado de la comanda' });
  } catch (err) {
    console.error('Error removing item from comanda:', err);
    res.status(500).json({ error: 'Error al retirar producto' });
  }
});

// POST /api/pos/tables/request-bill - Mark as 'cuenta_pedida'
router.post('/tables/request-bill', ...guard, (req, res) => {
  try {
    const { table_id } = req.body;
    const table = db.prepare('SELECT * FROM dining_tables WHERE id = ? AND is_active = 1 AND branch_id = ?').get(table_id, req.branchId);
    if (!table) return res.status(404).json({ error: 'Mesa no encontrada' });

    db.prepare("UPDATE dining_tables SET status = 'cuenta_pedida' WHERE id = ?").run(table_id);
    db.prepare("UPDATE table_orders SET status = 'billed' WHERE table_id = ? AND status = 'open'").run(table_id);

    res.json({ success: true, message: `Pre-cuenta solicitada para ${table.name}` });
  } catch (err) {
    console.error('Error requesting bill:', err);
    res.status(500).json({ error: 'Error al solicitar cuenta' });
  }
});

// POST /api/pos/tables/transfer - Transfer order to another table
router.post('/tables/transfer', ...guard, (req, res) => {
  try {
    const { from_table_id, to_table_id } = req.body;
    if (from_table_id === to_table_id) return res.status(400).json({ error: 'Las mesas deben ser distintas' });

    const fromTable = db.prepare('SELECT * FROM dining_tables WHERE id = ? AND branch_id = ?').get(from_table_id, req.branchId);
    const toTable = db.prepare('SELECT * FROM dining_tables WHERE id = ? AND is_active = 1 AND branch_id = ?').get(to_table_id, req.branchId);
    if (!fromTable || !toTable) return res.status(404).json({ error: 'Mesa no encontrada' });
    if (toTable.status !== 'libre') return res.status(400).json({ error: `La mesa destino (${toTable.name}) está ocupada` });

    const order = db.prepare("SELECT * FROM table_orders WHERE table_id = ? AND status IN ('open', 'billed')").get(from_table_id);
    if (!order) return res.status(400).json({ error: 'No hay cuenta activa en la mesa de origen' });

    db.prepare('UPDATE table_orders SET table_id = ? WHERE id = ?').run(to_table_id, order.id);
    db.prepare("UPDATE dining_tables SET status = 'ocupada' WHERE id = ?").run(to_table_id);
    db.prepare("UPDATE dining_tables SET status = 'libre' WHERE id = ?").run(from_table_id);

    res.json({ success: true, message: `Cuenta transferida con éxito de ${fromTable.name} a ${toTable.name}` });
  } catch (err) {
    console.error('Error transferring table:', err);
    res.status(500).json({ error: 'Error al transferir mesa' });
  }
});

// POST /api/pos/tables/cancel - Cancel active order and free table
router.post('/tables/cancel', ...guard, (req, res) => {
  try {
    const { table_id } = req.body;
    const reason = cleanText(req.body.reason, 200);
    const table = db.prepare('SELECT * FROM dining_tables WHERE id = ? AND branch_id = ?').get(table_id, req.branchId);
    if (!table) return res.status(404).json({ error: 'Mesa no encontrada' });

    db.prepare("UPDATE table_orders SET status = 'closed', notes = notes || ' [Cancelada: ' || ? || ']' WHERE table_id = ? AND status IN ('open', 'billed')").run(reason, table_id);
    db.prepare("UPDATE dining_tables SET status = 'libre' WHERE id = ?").run(table_id);

    res.json({ success: true, message: `Mesa ${table.name} liberada con éxito` });
  } catch (err) {
    console.error('Error cancelling table:', err);
    res.status(500).json({ error: 'Error al liberar mesa' });
  }
});

// POST /api/pos/tables/checkout - Pay and close table order with full inventory deduction & ticket
router.post('/tables/checkout', ...guard, (req, res) => {
  try {
    const { table_id, payment_method, amount_paid } = req.body;
    const notes = cleanText(req.body.notes, 300);
    const table = db.prepare('SELECT * FROM dining_tables WHERE id = ? AND branch_id = ?').get(table_id, req.branchId);
    if (!table) return res.status(404).json({ error: 'Mesa no encontrada' });

    if (!PAYMENT_METHODS.includes(payment_method)) {
      return res.status(400).json({ error: 'Método de pago no válido' });
    }

    const order = db.prepare("SELECT * FROM table_orders WHERE table_id = ? AND status IN ('open', 'billed')").get(table_id);
    if (!order) return res.status(400).json({ error: `La ${table.name} no tiene ninguna cuenta abierta para cobrar` });

    const items = db.prepare(`
      SELECT oi.*, p.is_direct_sale, p.direct_inventory_item_id,
        po.id as opt_id, po.label as opt_label, po.inventory_item_id as opt_item_id, po.quantity as opt_quantity
      FROM table_order_items oi
      JOIN products p ON oi.product_id = p.id
      LEFT JOIN product_options po ON po.id = oi.option_id AND po.product_id = oi.product_id
      WHERE oi.table_order_id = ?
    `).all(order.id);

    if (items.length === 0) {
      return res.status(400).json({ error: 'La cuenta no tiene productos registrados' });
    }

    // Defensa extra: nunca cobrar una cuenta con cantidades inválidas (p. ej. registradas antes de esta corrección).
    if (items.some(it => !Number.isInteger(it.quantity) || it.quantity <= 0)) {
      return res.status(400).json({ error: 'La cuenta tiene cantidades inválidas. Retira esos productos y vuelve a intentar.' });
    }

    let subtotal = 0;
    for (const it of items) {
      subtotal += it.unit_price * it.quantity;
    }

    const discountVal = 0; // sin descuentos a mano (ver venta normal)
    // Igual que en la venta normal: con tarjeta se suma el recargo; la tarjeta cobra exactamente el total.
    const cardSurcharge = recargoPorMetodo(payment_method, subtotal - discountVal);
    const total = Math.round((subtotal - discountVal + cardSurcharge) * 100) / 100;
    let paid = parseFloat(amount_paid);
    if (payment_method === 'tarjeta' && !isNaN(paid)) paid = total;

    if (isNaN(paid) || paid < total) {
      return res.status(400).json({
        error: `El monto pagado (Q ${paid.toFixed(2)}) es menor al total a pagar (Q ${total.toFixed(2)})`
      });
    }

    const change_given = Math.max(0, paid - total);

    const activeShift = db.prepare(`
      SELECT * FROM cash_shifts 
      WHERE user_id = ? AND branch_id = ? AND status = 'open' 
      ORDER BY id DESC LIMIT 1
    `).get(req.user.id, req.branchId);

    const today = new Date();
    const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '');
    const dailyCount = ticketsDelDia(dateStr);
    const seq = String(dailyCount + 1).padStart(4, '0');
    const ticket_number = `TK-${dateStr}-${seq}`;

    db.exec('BEGIN TRANSACTION;');

    try {
      const saleInsert = db.prepare(`
        INSERT INTO sales (
          ticket_number, cash_shift_id, cashier_id, cashier_name,
          subtotal, discount, total, payment_method, amount_paid, change_given, notes,
          table_name, table_id, branch_id, card_surcharge
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const saleResult = saleInsert.run(
        ticket_number,
        activeShift ? activeShift.id : null,
        req.user.id,
        req.user.full_name || req.user.username,
        subtotal,
        discountVal,
        total,
        payment_method,
        paid,
        change_given,
        notes ? `${notes} (Mesa: ${table.name})` : `Mesa: ${table.name}`,
        table.name,
        table.id,
        req.branchId,
        cardSurcharge
      );

      const saleId = Number(saleResult.lastInsertRowid);

      const saleItemInsert = db.prepare(`
        INSERT INTO sale_items (sale_id, product_id, product_name, unit_price, quantity, subtotal, customization)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      for (const it of items) {
        saleItemInsert.run(
          saleId,
          it.product_id,
          it.product_name,
          it.unit_price,
          it.quantity,
          it.subtotal,
          it.customization
        );

        // Presentación que eligió el cliente al pedir (vidrio / lata...). Si el administrador la quitó del menú
        // mientras la cuenta seguía abierta, se cobra igual y solo se omite ese descuento.
        const option = it.opt_id ? { label: it.opt_label, inventory_item_id: it.opt_item_id, quantity: it.opt_quantity } : null;
        deductOption(req.branchId, option, it.quantity, {
          reference: ticket_number,
          userId: req.user.id,
          notes: `Venta Mesa ${table.name} #${ticket_number} (${it.opt_label})`
        });

        if (it.is_direct_sale && it.direct_inventory_item_id && !option) {
          moveStock(req.branchId, it.direct_inventory_item_id, -it.quantity, {
            type: 'venta',
            reference: ticket_number,
            userId: req.user.id,
            notes: `Venta Mesa ${table.name} #${ticket_number}`
          });
        } else {
          const recipes = db.prepare('SELECT inventory_item_id, quantity FROM recipe_items WHERE product_id = ?').all(it.product_id);
          for (const r of recipes) {
            moveStock(req.branchId, r.inventory_item_id, -(r.quantity * it.quantity), {
              type: 'venta',
              reference: ticket_number,
              userId: req.user.id,
              notes: `Receta Venta Mesa ${table.name} #${ticket_number}`
            });
          }
        }
      }

      if (activeShift) {
        db.prepare(`
          UPDATE cash_shifts
          SET total_sales_count = total_sales_count + 1,
              total_sales_amount = total_sales_amount + ?,
              expected_cash = expected_cash + ?
          WHERE id = ?
        `).run(total, payment_method === 'efectivo' ? total : 0, activeShift.id);
      }

      db.prepare("UPDATE table_orders SET status = 'closed', closed_at = CURRENT_TIMESTAMP WHERE id = ?").run(order.id);
      db.prepare("UPDATE dining_tables SET status = 'libre' WHERE id = ?").run(table.id);

      db.exec('COMMIT;');

      const settings = db.prepare('SELECT * FROM system_settings WHERE id = 1').get() || {};

      res.json({
        success: true,
        message: `Cuenta de ${table.name} cobrada con éxito. Mesa liberada.`,
        ticket: {
          ticket_number,
          date: new Date(),
          // mismo formato que la base de datos (hora UTC) para que el ticket muestre la fecha igual que una venta normal
          created_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
          table_name: table.name,
          customer_name: order.customer_name,
          status: 'completada',
          cash_shift_id: activeShift ? activeShift.id : null,
          cashier_id: req.user.id,
          cashier: req.user.full_name || req.user.username,
          // lo interno de la presentación (qué insumo baja y cuánto) no se manda: en el ticket ya va su nombre dentro de la personalización
          items: items.map(({ opt_id, opt_label, opt_item_id, opt_quantity, ...rest }) => rest),
          subtotal,
          discount: discountVal,
          card_surcharge: cardSurcharge,
          total,
          payment_method,
          amount_paid: paid,
          change_given,
          settings,
          branch_name: req.branch.name
        }
      });
    } catch (txErr) {
      db.exec('ROLLBACK;');
      throw txErr;
    }
  } catch (err) {
    console.error('Error checking out table:', err);
    res.status(500).json({ error: 'Error al cobrar la cuenta de la mesa' });
  }
});

export default router;
