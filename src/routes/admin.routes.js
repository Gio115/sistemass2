import express, { Router } from 'express';
import { db, hashPassword } from '../db.js';
import { authenticate, requireAdmin } from '../auth.js';
import { branchContext, branchFilterSql, listBranches, ensureStockRowsForBranch } from '../branches.js';
import { optionsOfProduct, normalizeOptionsInput, saveProductOptions, costOfMostExpensiveOption } from '../options.js';

const router = Router();

// Apply auth + requireAdmin to all routes in this router.
// branchContext({ allowAll }): el administrador puede mirar una sucursal o "Ambas" (todas juntas) en reportes.
router.use(authenticate, requireAdmin, branchContext({ allowAll: true }));

// GET /api/admin/dashboard - Real-time executive metrics for admin accessible worldwide
router.get('/dashboard', (req, res) => {
  try {
    const todayStr = new Date().toISOString().slice(0, 10);
    const bf = branchFilterSql(req, 's.branch_id');       // solo la(s) sucursal(es) elegida(s)
    // El primer renglón solo descarta ventas de hace más de 2 días (hoy nunca puede ser más viejo), para que la base use su índice
    // en vez de revisar todo el historial. No cambia ningún resultado.
    const today = `(s.created_at >= datetime('now', '-2 days') AND (DATE(s.created_at, 'localtime') = DATE('now', 'localtime') OR DATE(s.created_at) = ?))`;

    // Sales today
    const todayStats = db.prepare(`
      SELECT 
        COUNT(*) as total_orders,
        COALESCE(SUM(s.total), 0) as total_revenue,
        COALESCE(AVG(s.total), 0) as average_ticket
      FROM sales s
      WHERE ${today} AND ${bf} AND s.status != 'anulada'
    `).get(todayStr);

    // Month stats
    const monthStats = db.prepare(`
      SELECT 
        COALESCE(SUM(s.total), 0) as month_revenue,
        COUNT(*) as month_orders
      FROM sales s
      WHERE s.created_at >= datetime('now', '-33 days') AND strftime('%Y-%m', s.created_at, 'localtime') = strftime('%Y-%m', 'now', 'localtime') AND ${bf} AND s.status != 'anulada'
    `).get();

    // Ventas anuladas hoy (no cuentan en nada de lo de arriba, pero el administrador debe verlas)
    const voidedToday = db.prepare(`
      SELECT COUNT(*) as count, COALESCE(SUM(s.total), 0) as total
      FROM sales s
      WHERE ${today} AND ${bf} AND s.status = 'anulada'
    `).get(todayStr);

    // Cost of goods sold today to calculate net profit
    const todayCost = db.prepare(`
      SELECT COALESCE(SUM(si.quantity * p.cost), 0) as total_cogs
      FROM sale_items si
      JOIN sales s ON si.sale_id = s.id
      JOIN products p ON si.product_id = p.id
      WHERE ${today} AND ${bf} AND s.status != 'anulada'
    `).get(todayStr);

    const netProfitToday = Math.max(0, todayStats.total_revenue - todayCost.total_cogs);

    // Sales by payment method today
    const paymentMethods = db.prepare(`
      SELECT s.payment_method, COUNT(*) as count, COALESCE(SUM(s.total), 0) as total
      FROM sales s
      WHERE ${today} AND ${bf} AND s.status != 'anulada'
      GROUP BY s.payment_method
    `).all(todayStr);

    // Hourly sales today (00:00 to 23:00)
    const hourlyData = db.prepare(`
      SELECT 
        strftime('%H:00', s.created_at, 'localtime') as hour,
        COUNT(*) as order_count,
        SUM(s.total) as revenue
      FROM sales s
      WHERE ${today} AND ${bf} AND s.status != 'anulada'
      GROUP BY hour
      ORDER BY hour ASC
    `).all(todayStr);

    // Top 5 selling products (all time)
    const topProducts = db.prepare(`
      SELECT 
        si.product_name,
        SUM(si.quantity) as total_quantity,
        SUM(si.subtotal) as total_revenue
      FROM sale_items si
      JOIN sales s ON si.sale_id = s.id
      WHERE ${bf} AND s.status != 'anulada'
      GROUP BY si.product_name
      ORDER BY total_quantity DESC
      LIMIT 5
    `).all();

    // Insumos por agotarse (en "Ambas" se indica en qué sucursal)
    const lowStockAlerts = db.prepare(`
      SELECT i.id, i.name, i.category, i.unit, st.current_stock, st.min_stock, b.name as branch_name
      FROM inventory_stock st
      JOIN inventory_items i ON i.id = st.inventory_item_id
      JOIN branches b ON b.id = st.branch_id
      WHERE ${branchFilterSql(req, 'st.branch_id')} AND st.current_stock <= st.min_stock AND st.min_stock > 0
      ORDER BY st.current_stock ASC
      LIMIT 8
    `).all();

    // Recent 8 sales
    const recentSales = db.prepare(`
      SELECT s.id, s.ticket_number, s.cashier_name, s.total, s.payment_method, s.created_at, s.status, b.name as branch_name
      FROM sales s
      LEFT JOIN branches b ON b.id = s.branch_id
      WHERE ${bf}
      ORDER BY s.id DESC
      LIMIT 8
    `).all();

    res.json({
      scope: { all: req.allBranches, branch: req.branch ? { id: req.branch.id, name: req.branch.name } : null },
      metrics: {
        today_revenue: todayStats.total_revenue,
        today_orders: todayStats.total_orders,
        average_ticket: todayStats.average_ticket,
        net_profit_today: netProfitToday,
        month_revenue: monthStats.month_revenue,
        month_orders: monthStats.month_orders,
        voided_today_count: voidedToday.count,
        voided_today_total: voidedToday.total
      },
      paymentMethods,
      hourlyData,
      topProducts,
      lowStockAlerts,
      recentSales
    });
  } catch (error) {
    console.error('Error al generar dashboard admin:', error);
    res.status(500).json({ error: 'Error al calcular métricas gerenciales' });
  }
});

// GET /api/admin/sales - Filterable sales list
router.get('/sales', (req, res) => {
  try {
    const { start_date, end_date, payment_method, cashier_id, query, status } = req.query;

    // Primero se eligen las 100 ventas que tocan (solo por número), y recién a esas 100 se les cuenta los productos y se les pone
    // el nombre de la sucursal: antes se hacía eso con TODAS las ventas del historial y por eso tardaba varios segundos.
    let filtros = `WHERE ${branchFilterSql(req, 's.branch_id')}`;
    const params = [];

    // Fecha bien escrita (AAAA-MM-DD): se compara el texto de la hora directamente, que usa el índice y da lo mismo que DATE(...).
    const fechaValida = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
      && v < '9999-12-31' && !Number.isNaN(Date.parse(v + 'T00:00:00Z')) && new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v;

    if (start_date) {
      filtros += fechaValida(start_date) ? ` AND s.created_at >= ?` : ` AND DATE(s.created_at) >= ?`;
      params.push(start_date);
    }
    if (end_date) {
      filtros += fechaValida(end_date) ? ` AND s.created_at < date(?, '+1 day')` : ` AND DATE(s.created_at) <= ?`;
      params.push(end_date);
    }
    if (payment_method && payment_method !== 'todos') {
      filtros += ` AND s.payment_method = ?`;
      params.push(payment_method);
    }
    if (cashier_id && cashier_id !== 'todos') {
      filtros += ` AND s.cashier_id = ?`;
      params.push(cashier_id);
    }
    if (status === 'anulada' || status === 'completada') {
      filtros += ` AND s.status = ?`;
      params.push(status);
    }
    if (query) {
      filtros += ` AND (s.ticket_number LIKE ? OR s.cashier_name LIKE ?)`;
      params.push(`%${query}%`, `%${query}%`);
    }

    const sql = `
      SELECT s.*, b.name as branch_name,
        (SELECT COUNT(*) FROM sale_items WHERE sale_id = s.id) as item_count
      FROM sales s
      LEFT JOIN branches b ON b.id = s.branch_id
      WHERE s.id IN (SELECT s.id FROM sales s ${filtros} ORDER BY s.id DESC LIMIT 100)
      ORDER BY s.id DESC
    `;

    const sales = db.prepare(sql).all(...params);
    res.json({ sales });
  } catch (error) {
    console.error('Error al buscar ventas:', error);
    res.status(500).json({ error: 'Error al consultar historial de ventas' });
  }
});

// GET /api/admin/sales/export - Export sales to CSV format
router.get('/sales/export', (req, res) => {
  try {
    const sales = db.prepare(`
      SELECT s.ticket_number, s.created_at, s.cashier_name, s.subtotal, s.discount, s.card_surcharge, s.total, s.payment_method, s.notes, b.name as branch_name,
        s.status, s.voided_at, s.voided_by_name, s.void_reason
      FROM sales s
      LEFT JOIN branches b ON b.id = s.branch_id
      WHERE ${branchFilterSql(req, 's.branch_id')}
      ORDER BY s.id DESC
    `).all();

    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    let csv = 'Folio,Fecha y Hora,Sucursal,Cajero,Subtotal,Descuento,Recargo tarjeta,Total,Metodo de Pago,Notas,Estado,Anulada el,Anulada por,Motivo de la anulacion\r\n';
    for (const s of sales) {
      csv += `${q(s.ticket_number)},${q(s.created_at)},${q(s.branch_name)},${q(s.cashier_name)},${s.subtotal},${s.discount},${s.card_surcharge},${s.total},${q(s.payment_method)},${q(s.notes)},${q(s.status === 'anulada' ? 'ANULADA' : 'Valida')},${q(s.voided_at)},${q(s.voided_by_name)},${q(s.void_reason)}\r\n`;
    }

    res.header('Content-Type', 'text/csv; charset=utf-8');
    res.attachment(`Ventas_El_Mismisimo_${new Date().toISOString().slice(0, 10)}.csv`);
    res.send(csv);
  } catch (error) {
    console.error('Error exportando CSV:', error);
    res.status(500).json({ error: 'Error al exportar ventas' });
  }
});

// GET /api/admin/products - List products with recipe details and profit margins
router.get('/products', (req, res) => {
  try {
    const products = db.prepare(`
      SELECT p.*, c.name as category_name,
        inv.name as direct_item_name, inv.unit as direct_unit,
        (SELECT version FROM product_images WHERE product_id = p.id) as image_v
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN inventory_items inv ON p.direct_inventory_item_id = inv.id
      WHERE p.archived = 0
      ORDER BY p.category_id ASC, p.name ASC
    `).all();

    // Existencias de la sucursal elegida (en "Ambas" no hay una sola cantidad) y dónde está pausado cada producto
    const stockByItem = {};
    if (!req.allBranches) {
      for (const r of db.prepare('SELECT inventory_item_id, current_stock FROM inventory_stock WHERE branch_id = ?').all(req.branchId)) {
        stockByItem[r.inventory_item_id] = r.current_stock;
      }
    }
    const pausedMap = {};
    for (const r of db.prepare('SELECT product_id, branch_id FROM branch_paused_products').all()) {
      (pausedMap[r.product_id] ||= []).push(r.branch_id);
    }

    const recipes = db.prepare(`
      SELECT r.id, r.product_id, r.quantity, inv.id as inventory_item_id, inv.name as item_name, inv.unit, inv.cost_per_unit
      FROM recipe_items r
      JOIN inventory_items inv ON r.inventory_item_id = inv.id
    `).all();

    const recipeMap = {};
    for (const r of recipes) {
      if (!recipeMap[r.product_id]) recipeMap[r.product_id] = [];
      recipeMap[r.product_id].push(r);
    }

    // Presentaciones que elige el cliente (vidrio / lata...)
    const optionMap = {};
    for (const o of db.prepare(`
      SELECT po.id, po.product_id, po.label, po.inventory_item_id, po.quantity, inv.name as item_name, inv.unit
      FROM product_options po JOIN inventory_items inv ON inv.id = po.inventory_item_id
      ORDER BY po.product_id ASC, po.sort_order ASC, po.id ASC
    `).all()) {
      (optionMap[o.product_id] ||= []).push(o);
    }

    const enhanced = products.map(p => {
      const prodRecipes = recipeMap[p.id] || [];
      const margin = p.price > 0 ? (((p.price - p.cost) / p.price) * 100).toFixed(1) : 0;
      const pausedIn = (pausedMap[p.id] || []).filter(id => req.branchIds.includes(id));
      return {
        ...p,
        direct_stock: (!req.allBranches && p.direct_inventory_item_id) ? (stockByItem[p.direct_inventory_item_id] ?? 0) : null,
        // pausado "aquí" = en la sucursal elegida (o en todas, si se están viendo todas juntas)
        paused_here: pausedIn.length === req.branchIds.length ? 1 : 0,
        paused_some: pausedIn.length > 0 ? 1 : 0,
        paused_branch_ids: pausedIn,
        recipe: prodRecipes,
        options: optionMap[p.id] || [],
        profit_margin_percent: margin
      };
    });

    res.json({ products: enhanced });
  } catch (error) {
    console.error('Error al obtener productos admin:', error);
    res.status(500).json({ error: 'Error al cargar productos' });
  }
});

// Un insumo medido en ml no se puede vender "tal cual" (cada venta bajaría 1 ml en vez de la botella): se arma una receta en ml.
function directoEnMl(itemId) {
  if (!itemId) return null;
  const inv = db.prepare("SELECT name FROM inventory_items WHERE id = ? AND unit = 'ml'").get(itemId);
  return inv ? `“${inv.name}” se mide en ml, así que no puede ir como “se vende tal cual” (bajaría 1 ml por venta). Elige “Lleva receta” y escribe cuántos ml lleva (por ejemplo, 500 ml una botella).` : null;
}

// POST /api/admin/products - Create product with recipe or direct item
router.post('/products', (req, res) => {
  try {
    const {
      category_id, name, description = '', price, cost, is_direct_sale = 1,
      direct_inventory_item_id, badge = '', recipe = []
    } = req.body;

    const enMl = is_direct_sale ? directoEnMl(direct_inventory_item_id) : null;
    if (enMl) return res.status(400).json({ error: enMl });

    if (!name || price === undefined) {
      return res.status(400).json({ error: 'Nombre y precio son obligatorios' });
    }

    const precioNuevo = parseFloat(price);
    if (!Number.isFinite(precioNuevo) || precioNuevo < 0) return res.status(400).json({ error: 'El precio debe ser un número (0 o más).' });
    if (!String(name).trim()) return res.status(400).json({ error: 'Nombre y precio son obligatorios' });
    if (category_id !== undefined && category_id !== null && category_id !== '' && !db.prepare('SELECT id FROM categories WHERE id = ?').get(category_id)) {
      return res.status(400).json({ error: 'Esa sección no existe. Elige otra.' });
    }

    const primeraSeccion = (db.prepare('SELECT id FROM categories ORDER BY display_order, id LIMIT 1').get() || {}).id;
    if (!(category_id || primeraSeccion)) return res.status(400).json({ error: 'Primero crea una sección del menú para poder agregar productos.' });

    const opt = normalizeOptionsInput(req.body.options);
    if (opt.error) return res.status(400).json({ error: opt.error });

    let calculatedCost = parseFloat(cost) || 0;

    // If recipe is provided, calculate ingredient costs
    if (!is_direct_sale && Array.isArray(recipe) && recipe.length > 0) {
      let sumCost = 0;
      for (const item of recipe) {
        const inv = db.prepare('SELECT cost_per_unit FROM inventory_items WHERE id = ?').get(item.inventory_item_id);
        if (inv) {
          sumCost += (parseFloat(item.quantity) || 0) * inv.cost_per_unit;
        }
      }
      calculatedCost = parseFloat(sumCost.toFixed(2));
    } else if (is_direct_sale && direct_inventory_item_id) {
      const inv = db.prepare('SELECT cost_per_unit FROM inventory_items WHERE id = ?').get(direct_inventory_item_id);
      if (inv) {
        calculatedCost = inv.cost_per_unit;
      }
    }

    // Con presentaciones (vidrio / lata...) se guarda como costo el de la más cara; si se vende "tal cual", la presentación reemplaza al insumo de arriba.
    if (opt.options && opt.options.length) {
      const extra = costOfMostExpensiveOption(opt.options);
      calculatedCost = parseFloat(((is_direct_sale ? 0 : calculatedCost) + extra).toFixed(2));
    }

    db.exec('BEGIN TRANSACTION;');
    try {
      const result = db.prepare(`
        INSERT INTO products (category_id, name, description, price, cost, is_direct_sale, direct_inventory_item_id, badge, is_active)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
      `).run(
        category_id || primeraSeccion,
        name.trim(),
        description.trim(),
        parseFloat(price),
        calculatedCost,
        is_direct_sale ? 1 : 0,
        direct_inventory_item_id || null,
        badge.trim()
      );

      const productId = Number(result.lastInsertRowid);

      if (!is_direct_sale && Array.isArray(recipe)) {
        const recipeStmt = db.prepare('INSERT INTO recipe_items (product_id, inventory_item_id, quantity) VALUES (?, ?, ?)');
        for (const ing of recipe) {
          if (ing.inventory_item_id && parseFloat(ing.quantity) > 0) {
            recipeStmt.run(productId, ing.inventory_item_id, parseFloat(ing.quantity));
          }
        }
      }

      if (opt.options && opt.options.length) saveProductOptions(productId, opt.options);

      db.exec('COMMIT;');

      res.status(201).json({
        success: true,
        message: 'Producto creado exitosamente',
        productId
      });
    } catch (err) {
      db.exec('ROLLBACK;');
      throw err;
    }
  } catch (error) {
    console.error('Error al crear producto:', error);
    res.status(500).json({ error: 'Error al registrar producto' });
  }
});

// PUT /api/admin/products/:id - Update product
router.put('/products/:id', (req, res) => {
  try {
    const { category_id, name, description, price, cost, is_direct_sale, direct_inventory_item_id, badge, is_active, recipe } = req.body;

    const enMl = is_direct_sale && direct_inventory_item_id ? directoEnMl(direct_inventory_item_id) : null;
    if (enMl) return res.status(400).json({ error: enMl });
    const prodId = req.params.id;

    const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(prodId);
    if (!existing) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }

    if (price !== undefined && price !== null && (!Number.isFinite(parseFloat(price)) || parseFloat(price) < 0)) return res.status(400).json({ error: 'El precio debe ser un número (0 o más).' });
    if (name !== undefined && !String(name).trim()) return res.status(400).json({ error: 'El nombre no puede quedar vacío.' });
    if (category_id !== undefined && category_id !== null && !db.prepare('SELECT id FROM categories WHERE id = ?').get(category_id)) {
      return res.status(400).json({ error: 'Esa sección no existe. Elige otra.' });
    }

    const opt = normalizeOptionsInput(req.body.options);
    if (opt.error) return res.status(400).json({ error: opt.error });

    let calculatedCost = cost !== undefined ? parseFloat(cost) : existing.cost;
    let costRecomputed = false; // ¿el costo base se volvió a calcular en esta llamada?

    if (is_direct_sale && direct_inventory_item_id) {
      const invDirecto = db.prepare('SELECT cost_per_unit FROM inventory_items WHERE id = ?').get(direct_inventory_item_id);
      if (invDirecto && cost === undefined) { calculatedCost = invDirecto.cost_per_unit; costRecomputed = true; }
    }

    if (recipe && Array.isArray(recipe) && !is_direct_sale) {
      let sumCost = 0;
      for (const item of recipe) {
        const inv = db.prepare('SELECT cost_per_unit FROM inventory_items WHERE id = ?').get(item.inventory_item_id);
        if (inv) {
          sumCost += (parseFloat(item.quantity) || 0) * inv.cost_per_unit;
        }
      }
      calculatedCost = parseFloat(sumCost.toFixed(2));
      costRecomputed = true;
    }

    // Presentaciones (vidrio / lata...): el costo guardado suma la más cara; si se vende "tal cual", la presentación reemplaza al insumo.
    // Si solo cambiaron las presentaciones (sin mandar receta), el costo base se vuelve a calcular con lo que ya tiene el producto.
    const effectiveOptions = opt.options !== null ? opt.options : optionsOfProduct(existing.id);
    const effectiveDirect = is_direct_sale !== undefined ? !!is_direct_sale : !!existing.is_direct_sale;
    if (opt.options !== null && !costRecomputed && cost === undefined) {
      if (effectiveDirect) {
        calculatedCost = 0;
      } else {
        const rows = db.prepare('SELECT r.quantity, inv.cost_per_unit FROM recipe_items r JOIN inventory_items inv ON inv.id = r.inventory_item_id WHERE r.product_id = ?').all(existing.id);
        calculatedCost = parseFloat(rows.reduce((s, r) => s + r.quantity * r.cost_per_unit, 0).toFixed(2));
      }
      costRecomputed = true;
    }
    if (costRecomputed && effectiveOptions.length) {
      const extra = costOfMostExpensiveOption(effectiveOptions);
      calculatedCost = parseFloat(((effectiveDirect ? 0 : calculatedCost) + extra).toFixed(2));
    }

    db.exec('BEGIN TRANSACTION;');
    try {
      db.prepare(`
        UPDATE products
        SET category_id = COALESCE(?, category_id),
            name = COALESCE(?, name),
            description = COALESCE(?, description),
            price = COALESCE(?, price),
            cost = COALESCE(?, cost),
            is_direct_sale = COALESCE(?, is_direct_sale),
            direct_inventory_item_id = ?,
            badge = COALESCE(?, badge),
            is_active = COALESCE(?, is_active)
        WHERE id = ?
      `).run(
        category_id !== undefined ? category_id : null,
        name !== undefined ? name.trim() : null,
        description !== undefined ? description.trim() : null,
        price !== undefined ? parseFloat(price) : null,
        calculatedCost,
        is_direct_sale !== undefined ? (is_direct_sale ? 1 : 0) : null,
        direct_inventory_item_id !== undefined ? direct_inventory_item_id : existing.direct_inventory_item_id,
        badge !== undefined ? badge.trim() : null,
        is_active !== undefined ? (is_active ? 1 : 0) : null,
        prodId
      );

      if (recipe && Array.isArray(recipe)) {
        db.prepare('DELETE FROM recipe_items WHERE product_id = ?').run(prodId);
        const recipeStmt = db.prepare('INSERT INTO recipe_items (product_id, inventory_item_id, quantity) VALUES (?, ?, ?)');
        for (const ing of recipe) {
          if (ing.inventory_item_id && parseFloat(ing.quantity) > 0) {
            recipeStmt.run(prodId, ing.inventory_item_id, parseFloat(ing.quantity));
          }
        }
      }

      // Presentaciones: se guardan conservando el número de las que ya existían (las cuentas de mesa abiertas las siguen usando)
      if (opt.options !== null) saveProductOptions(existing.id, opt.options);

      db.exec('COMMIT;');

      res.json({ success: true, message: 'Producto actualizado con éxito' });
    } catch (err) {
      db.exec('ROLLBACK;');
      throw err;
    }
  } catch (error) {
    console.error('Error al actualizar producto:', error);
    res.status(500).json({ error: 'Error al actualizar producto' });
  }
});

// PUT /api/admin/products/:id/image - Pone o cambia la foto del producto.
// El navegador ya la recortó en cuadrado y la achicó a JPEG (~40 KB); aquí se comprueba de todos modos
// que de verdad sea un JPEG y que no sea enorme, para que nadie pueda llenar la base de datos.
const MAX_FOTO_BYTES = 300 * 1024;
router.put('/products/:id/image', express.raw({ type: 'image/jpeg', limit: MAX_FOTO_BYTES }), (req, res) => {
  try {
    const prodId = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(prodId) || !db.prepare('SELECT 1 FROM products WHERE id = ?').get(prodId)) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }
    const img = req.body;
    if (!Buffer.isBuffer(img) || img.length < 200) {
      return res.status(400).json({ error: 'La foto debe ser una imagen JPG. Prueba con otra foto.' });
    }
    const esJpeg = img[0] === 0xFF && img[1] === 0xD8 && img[2] === 0xFF && img[img.length - 2] === 0xFF && img[img.length - 1] === 0xD9;
    if (!esJpeg) {
      return res.status(400).json({ error: 'La foto no se pudo leer. Prueba con otra foto (JPG o PNG).' });
    }
    const version = Date.now();
    db.prepare(`
      INSERT INTO product_images (product_id, data, version) VALUES (?, ?, ?)
      ON CONFLICT(product_id) DO UPDATE SET data = excluded.data, version = excluded.version
    `).run(prodId, img, version);
    res.json({ success: true, image_v: version });
  } catch (error) {
    console.error('Error al guardar foto de producto:', error);
    res.status(500).json({ error: 'No se pudo guardar la foto' });
  }
});

// DELETE /api/admin/products/:id/image - Quita la foto (el menú vuelve a usar el dibujo)
router.delete('/products/:id/image', (req, res) => {
  try {
    const prodId = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(prodId)) return res.status(404).json({ error: 'Producto no encontrado' });
    db.prepare('DELETE FROM product_images WHERE product_id = ?').run(prodId);
    res.json({ success: true });
  } catch (error) {
    console.error('Error al quitar foto de producto:', error);
    res.status(500).json({ error: 'No se pudo quitar la foto' });
  }
});

// PUT /api/admin/products/:id/pause - Pausar o volver a vender un producto EN la sucursal elegida (o en todas, con "Ambas").
// Pausar solo afecta a esa sucursal. Volver a vender además lo devuelve al menú si había sido quitado (ya vendido).
router.put('/products/:id/pause', (req, res) => {
  try {
    const prodId = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(prodId) || !db.prepare('SELECT 1 FROM products WHERE id = ?').get(prodId)) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }
    const raw = req.body.paused;
    if (typeof raw !== 'boolean' && raw !== 0 && raw !== 1) {
      return res.status(400).json({ error: 'Indica si se pausa o se vuelve a vender' });
    }
    const paused = raw === true || raw === 1;

    db.exec('BEGIN TRANSACTION;');
    try {
      if (paused) {
        const ins = db.prepare('INSERT OR IGNORE INTO branch_paused_products (branch_id, product_id) VALUES (?, ?)');
        for (const b of req.branchIds) ins.run(b, prodId);
      } else {
        const del = db.prepare('DELETE FROM branch_paused_products WHERE branch_id = ? AND product_id = ?');
        for (const b of req.branchIds) del.run(b, prodId);
        db.prepare('UPDATE products SET is_active = 1 WHERE id = ?').run(prodId);
      }
      db.exec('COMMIT;');
    } catch (err) {
      db.exec('ROLLBACK;');
      throw err;
    }
    res.json({ success: true, paused });
  } catch (error) {
    console.error('Error al pausar producto:', error);
    res.status(500).json({ error: 'No se pudo cambiar el estado del producto' });
  }
});

// POST /api/admin/products/prices - Pone el precio a varios productos que todavía están en Q0 y los deja a la venta.
// (Productos cargados desde una lista, sin precio.) Solo toca productos que están en Q0: no sirve para cambiar precios ya puestos.
router.post('/products/prices', (req, res) => {
  try {
    const list = req.body && req.body.prices;
    if (!Array.isArray(list) || list.length === 0 || list.length > 500) {
      return res.status(400).json({ error: 'Escribe al menos un precio.' });
    }
    const clean = [];
    for (const row of list) {
      const id = Number(row && row.id);
      const price = Math.round(Number(row && row.price) * 100) / 100;
      if (!Number.isInteger(id) || !Number.isFinite(price) || price <= 0 || price > 99999.99) {
        return res.status(400).json({ error: 'Hay un precio que no es válido. Escribe solo números mayores que cero.' });
      }
      clean.push({ id, price });
    }

    let updated = 0, skipped = 0;
    db.exec('BEGIN TRANSACTION;');
    try {
      const upd = db.prepare('UPDATE products SET price = ?, is_active = 1 WHERE id = ? AND price <= 0');
      for (const { id, price } of clean) {
        const r = upd.run(price, id);
        if (Number(r.changes) === 1) updated++; else skipped++;
      }
      db.exec('COMMIT;');
    } catch (err) {
      db.exec('ROLLBACK;');
      throw err;
    }
    res.json({ success: true, updated, skipped });
  } catch (error) {
    console.error('Error al poner precios:', error);
    res.status(500).json({ error: 'No se pudieron guardar los precios' });
  }
});

// DELETE /api/admin/products/:id - Delete product
router.delete('/products/:id', (req, res) => {
  try {
    const prodId = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(prodId) || !db.prepare('SELECT 1 FROM products WHERE id = ?').get(prodId)) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }

    // Si ya aparece en ventas o en una cuenta de mesa, no se puede borrar sin perder esa historia:
    // se oculta (ya no sale en "Vender" ni en el Menú) y las ventas se conservan.
    // Importante: así deja de verse, pero NO se borra de la base de datos.
    const yaVendido = db.prepare('SELECT 1 FROM sale_items WHERE product_id = ? LIMIT 1').get(prodId)
      || db.prepare('SELECT 1 FROM table_order_items WHERE product_id = ? LIMIT 1').get(prodId);
    if (yaVendido) {
      db.prepare('UPDATE products SET is_active = 0, archived = 1 WHERE id = ?').run(prodId);
      return res.json({
        success: true,
        paused: true,
        archived: true,
        message: 'Producto quitado. Como ya tenía ventas, sus ventas se conservan en el historial, pero ya no aparece en el Menú ni en “Vender”.'
      });
    }

    db.exec('BEGIN TRANSACTION;');
    try {
      db.prepare('DELETE FROM recipe_items WHERE product_id = ?').run(prodId);
      db.prepare('DELETE FROM product_options WHERE product_id = ?').run(prodId);
      db.prepare('DELETE FROM product_images WHERE product_id = ?').run(prodId);
      db.prepare('DELETE FROM products WHERE id = ?').run(prodId);
      db.exec('COMMIT;');
      res.json({ success: true, message: 'Producto eliminado correctamente' });
    } catch (err) {
      db.exec('ROLLBACK;');
      throw err;
    }
  } catch (error) {
    console.error('Error al eliminar producto:', error);
    res.status(500).json({ error: 'Error al eliminar producto' });
  }
});

// GET /api/admin/categories - List categories
router.get('/categories', (req, res) => {
  try {
    const categories = db.prepare('SELECT * FROM categories ORDER BY display_order ASC, name ASC').all();
    res.json({ categories });
  } catch (error) {
    res.status(500).json({ error: 'Error al consultar categorías' });
  }
});

// POST /api/admin/categories - Create category
router.post('/categories', (req, res) => {
  try {
    const { name, icon = '🍽️', display_order = 0 } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Escribe el nombre de la sección' });
    }
    const result = db.prepare('INSERT INTO categories (name, icon, display_order) VALUES (?, ?, ?)')
      .run(name.trim(), (icon || '🍽️').trim(), parseInt(display_order, 10) || 0);
    res.status(201).json({ success: true, id: Number(result.lastInsertRowid), message: 'Categoría creada con éxito' });
  } catch (error) {
    res.status(500).json({ error: 'Error al crear categoría' });
  }
});

// PUT /api/admin/categories/:id - Update category
router.put('/categories/:id', (req, res) => {
  try {
    const { name, icon, display_order } = req.body;
    db.prepare(`
      UPDATE categories
      SET name = COALESCE(?, name),
          icon = COALESCE(?, icon),
          display_order = COALESCE(?, display_order)
      WHERE id = ?
    `).run(
      name !== undefined ? name.trim() : null,
      icon !== undefined ? icon.trim() : null,
      display_order !== undefined ? parseInt(display_order, 10) : null,
      req.params.id
    );
    res.json({ success: true, message: 'Categoría actualizada' });
  } catch (error) {
    res.status(500).json({ error: 'Error al modificar categoría' });
  }
});

// DELETE /api/admin/categories/:id - Delete category
router.delete('/categories/:id', (req, res) => {
  try {
    const catId = req.params.id;
    const prodCount = db.prepare('SELECT COUNT(*) as count FROM products WHERE category_id = ? AND archived = 0').get(catId).count;
    if (prodCount > 0) {
      return res.status(400).json({ error: `No se puede quitar esta sección porque tiene ${prodCount} producto(s). Pasa esos productos a otra sección (o quítalos) y vuelve a intentarlo.` });
    }
    // Los productos ocultos (quitados, con ventas) ya no necesitan sección: se les quita para poder borrar la sección
    db.prepare('UPDATE products SET category_id = NULL WHERE category_id = ? AND archived = 1').run(catId);
    db.prepare('DELETE FROM categories WHERE id = ?').run(catId);
    res.json({ success: true, message: 'Sección quitada' });
  } catch (error) {
    res.status(500).json({ error: 'Error al borrar categoría' });
  }
});

// Lista de sucursales válida (enteros que existan). Devuelve [] si no se mandó nada y null si alguna no existe.
function cleanBranchIds(raw) {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) return null;
  const ids = [...new Set(raw.map(Number))];
  if (ids.some(n => !Number.isInteger(n) || n <= 0)) return null;
  const valid = new Set(db.prepare('SELECT id FROM branches WHERE is_active = 1').all().map(b => b.id));
  return ids.every(n => valid.has(n)) ? ids : null;
}

function setUserBranches(userId, ids) {
  db.prepare('DELETE FROM user_branches WHERE user_id = ?').run(userId);
  const ins = db.prepare('INSERT OR IGNORE INTO user_branches (user_id, branch_id) VALUES (?, ?)');
  for (const id of ids) ins.run(userId, id);
}

// GET /api/admin/users - List users
router.get('/users', (req, res) => {
  try {
    const users = db.prepare(`
      SELECT id, username, full_name, role, is_active, created_at
      FROM users
      ORDER BY id ASC
    `).all();
    const map = {};
    for (const r of db.prepare('SELECT user_id, branch_id FROM user_branches').all()) {
      (map[r.user_id] ||= []).push(r.branch_id);
    }
    // El administrador entra a todas las sucursales; el vendedor, solo a las que se le asignaron.
    res.json({ users: users.map(u => ({ ...u, branch_ids: u.role === 'admin' ? [] : (map[u.id] || []) })) });
  } catch (error) {
    console.error('Error al obtener usuarios:', error);
    res.status(500).json({ error: 'Error al consultar usuarios' });
  }
});

// POST /api/admin/users - Create new cashier / admin
router.post('/users', (req, res) => {
  try {
    const { username, password, full_name, role } = req.body;

    if (!username || !password || !full_name || !role) {
      return res.status(400).json({ error: 'Todos los campos son obligatorios' });
    }

    if (!['admin', 'vendedor'].includes(role)) {
      return res.status(400).json({ error: 'Rol inválido. Debe ser admin o vendedor' });
    }

    // Un vendedor necesita al menos una sucursal (solo verá y venderá en las que se le asignen).
    const branchIds = cleanBranchIds(req.body.branch_ids);
    if (branchIds === null) {
      return res.status(400).json({ error: 'Alguna de las sucursales elegidas no existe' });
    }
    if (role === 'vendedor' && branchIds.length === 0) {
      return res.status(400).json({ error: 'Elige al menos una sucursal para este vendedor' });
    }

    if (String(password).trim().length < 4) {
      return res.status(400).json({ error: 'La contraseña es muy corta: debe tener al menos 4 letras o números' });
    }

    const existing = db.prepare('SELECT id FROM users WHERE LOWER(username) = LOWER(?)').get(username.trim());
    if (existing) {
      return res.status(400).json({ error: 'El nombre de usuario ya está registrado' });
    }

    const { hash, salt } = hashPassword(password);

    const result = db.prepare(`
      INSERT INTO users (username, password_hash, salt, full_name, role)
      VALUES (?, ?, ?, ?, ?)
    `).run(username.trim().toLowerCase(), hash, salt, full_name.trim(), role);
    const newUserId = Number(result.lastInsertRowid);
    if (role === 'vendedor') setUserBranches(newUserId, branchIds);

    res.status(201).json({
      success: true,
      message: `Usuario ${role === 'admin' ? 'Administrador' : 'Vendedor'} creado exitosamente`,
      userId: newUserId
    });
  } catch (error) {
    console.error('Error al crear usuario:', error);
    res.status(500).json({ error: 'Error al registrar nuevo usuario' });
  }
});

// PUT /api/admin/users/:id - Update user status or password
router.put('/users/:id', (req, res) => {
  try {
    const { full_name, role, is_active, password } = req.body;
    const userId = req.params.id;

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    // Sucursales del vendedor (si no se mandan, no cambian)
    let newBranchIds = null;
    if (req.body.branch_ids !== undefined) {
      newBranchIds = cleanBranchIds(req.body.branch_ids);
      if (newBranchIds === null) {
        return res.status(400).json({ error: 'Alguna de las sucursales elegidas no existe' });
      }
    }
    if (role !== undefined && !['admin', 'vendedor'].includes(role)) return res.status(400).json({ error: 'Rol inválido. Debe ser admin o vendedor' });
    const finalRole = role !== undefined ? role : user.role;
    if (finalRole === 'vendedor') {
      const current = db.prepare('SELECT COUNT(*) AS c FROM user_branches WHERE user_id = ?').get(user.id).c;
      if ((newBranchIds !== null && newBranchIds.length === 0) || (newBranchIds === null && current === 0)) {
        return res.status(400).json({ error: 'Elige al menos una sucursal para este vendedor' });
      }
    }

    // No se le puede quitar una sucursal donde todavía tiene la caja abierta (nadie más podría cerrarla)
    if (newBranchIds !== null && finalRole === 'vendedor') {
      const openIds = db.prepare("SELECT branch_id FROM cash_shifts WHERE user_id = ? AND status = 'open'").all(user.id).map(r => r.branch_id);
      const blocked = openIds.filter(id => !newBranchIds.includes(id));
      if (blocked.length > 0) {
        const names = db.prepare(`SELECT name FROM branches WHERE id IN (${blocked.map(Number).join(',')})`).all().map(r => r.name).join(', ');
        return res.status(400).json({ error: `Tiene la caja abierta en ${names}. Pídele que la cierre antes de quitarle esa sucursal.` });
      }
    }

    // Prevent deactivating the last active admin
    if (user.role === 'admin' && is_active === 0) {
      const activeAdmins = db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'admin' AND is_active = 1").get().count;
      if (activeAdmins <= 1) {
        return res.status(400).json({ error: 'No puedes desactivar al único Administrador activo del sistema' });
      }
    }

    if (password && password.trim().length >= 4) {
      const { hash, salt } = hashPassword(password.trim());
      db.prepare('UPDATE users SET password_hash = ?, salt = ? WHERE id = ?').run(hash, salt, userId);
    }

    db.prepare(`
      UPDATE users
      SET full_name = COALESCE(?, full_name),
          role = COALESCE(?, role),
          is_active = COALESCE(?, is_active)
      WHERE id = ?
    `).run(
      full_name !== undefined ? full_name.trim() : null,
      role !== undefined ? role : null,
      is_active !== undefined ? (is_active ? 1 : 0) : null,
      userId
    );
    if (newBranchIds !== null) setUserBranches(user.id, newBranchIds);

    res.json({ success: true, message: 'Usuario actualizado correctamente' });
  } catch (error) {
    console.error('Error al actualizar usuario:', error);
    res.status(500).json({ error: 'Error al modificar usuario' });
  }
});

// GET /api/admin/shifts - List all cash shifts
router.get('/shifts', (req, res) => {
  try {
    const shifts = db.prepare(`
      SELECT cs.*, u.full_name as cashier_name, u.username, b.name as branch_name
      FROM cash_shifts cs
      JOIN users u ON cs.user_id = u.id
      LEFT JOIN branches b ON b.id = cs.branch_id
      WHERE ${branchFilterSql(req, 'cs.branch_id')}
      ORDER BY cs.id DESC
      LIMIT 50
    `).all();

    res.json({ shifts });
  } catch (error) {
    console.error('Error al consultar turnos:', error);
    res.status(500).json({ error: 'Error al consultar historial de turnos' });
  }
});

// GET /api/admin/shifts/:id - Detalle de UN corte de caja: dinero por forma de pago, anuladas,
// qué se vendió y cada venta con su hora. Todo se calcula en el momento con las ventas del turno.
router.get('/shifts/:id', (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Corte no válido' });

    const shift = db.prepare(`
      SELECT cs.*, u.full_name as cashier_name, u.username, b.name as branch_name
      FROM cash_shifts cs
      JOIN users u ON cs.user_id = u.id
      LEFT JOIN branches b ON b.id = cs.branch_id
      WHERE cs.id = ? AND ${branchFilterSql(req, 'cs.branch_id')}
    `).get(id);
    if (!shift) return res.status(404).json({ error: 'No se encontró ese corte de caja' });

    const sales = db.prepare(`
      SELECT id, ticket_number, created_at, cashier_name, payment_method, subtotal, discount, card_surcharge,
             total, amount_paid, change_given, status, table_name, notes, void_reason, voided_by_name, voided_at
      FROM sales
      WHERE cash_shift_id = ?
      ORDER BY id
    `).all(id);

    // Renglones de todas las ventas del turno (una sola consulta; sale_items tiene índice por venta)
    const renglones = db.prepare(`
      SELECT si.sale_id, si.product_name, si.quantity, si.subtotal, si.customization
      FROM sale_items si
      JOIN sales s ON s.id = si.sale_id
      WHERE s.cash_shift_id = ?
      ORDER BY si.id
    `).all(id);
    const porVenta = new Map();
    const vendido = new Map();
    for (const r of renglones) {
      if (!porVenta.has(r.sale_id)) porVenta.set(r.sale_id, []);
      porVenta.get(r.sale_id).push(`${r.quantity}× ${r.product_name}${r.customization ? ' (' + r.customization + ')' : ''}`);
    }

    const redondeo = (n) => Math.round((Number(n) || 0) * 100) / 100;
    const metodos = { efectivo: { cantidad: 0, total: 0 }, tarjeta: { cantidad: 0, total: 0 }, transferencia: { cantidad: 0, total: 0 }, mixto: { cantidad: 0, total: 0 } };
    let validas = 0, totalValidas = 0, recargo = 0, descuentos = 0;
    const anuladas = { cantidad: 0, total: 0 };
    let anuladasDespues = { cantidad: 0, total: 0 };
    const idsValidas = new Set();
    for (const v of sales) {
      if (v.status === 'anulada') {
        anuladas.cantidad++; anuladas.total += v.total;
        if (shift.closed_at && v.voided_at && v.voided_at > shift.closed_at) { anuladasDespues.cantidad++; anuladasDespues.total += v.total; }
        continue;
      }
      validas++; totalValidas += v.total; recargo += v.card_surcharge || 0; descuentos += v.discount || 0;
      idsValidas.add(v.id);
      const m = metodos[v.payment_method] || (metodos[v.payment_method] = { cantidad: 0, total: 0 });
      m.cantidad++; m.total += v.total;
    }
    for (const r of renglones) {
      if (!idsValidas.has(r.sale_id)) continue;
      const k = r.product_name;
      const x = vendido.get(k) || { producto: k, cantidad: 0, total: 0 };
      x.cantidad += r.quantity; x.total += r.subtotal;
      vendido.set(k, x);
    }
    for (const m of Object.values(metodos)) m.total = redondeo(m.total);

    const abierta = shift.status === 'open';
    const deberiaHaber = abierta ? redondeo(shift.initial_cash + metodos.efectivo.total) : redondeo(shift.expected_cash);

    res.json({
      shift: { ...shift, expected_cash: deberiaHaber },
      resumen: {
        ventas: validas,
        total: redondeo(totalValidas),
        recargo_tarjeta: redondeo(recargo),
        descuentos: redondeo(descuentos),
        ticket_promedio: validas ? redondeo(totalValidas / validas) : 0,
        por_metodo: metodos,
        anuladas: { cantidad: anuladas.cantidad, total: redondeo(anuladas.total) },
        anuladas_despues_del_cierre: { cantidad: anuladasDespues.cantidad, total: redondeo(anuladasDespues.total) },
        primera_venta: sales.find(v => v.status !== 'anulada')?.created_at || null,
        ultima_venta: [...sales].reverse().find(v => v.status !== 'anulada')?.created_at || null
      },
      vendido: [...vendido.values()].map(x => ({ ...x, total: redondeo(x.total) })).sort((a, b) => b.cantidad - a.cantidad || b.total - a.total),
      sales: sales.map(v => ({ ...v, items_text: (porVenta.get(v.id) || []).join(', ') }))
    });
  } catch (error) {
    console.error('Error al consultar el detalle del corte:', error);
    res.status(500).json({ error: 'No se pudo consultar el detalle del corte de caja' });
  }
});

// ===== Sucursales =====
// GET /api/admin/branches - Lista de sucursales
// Con ?all=1 también las ocultas (para Ajustes). Sin eso, solo las visibles.
router.get('/branches', (req, res) => {
  res.json({ branches: listBranches(String(req.query.all ?? '') !== '1') });
});

// POST /api/admin/branches - Agregar una sucursal. Nace con existencias en 0 y sin mesas; el menú y los precios son los mismos.
router.post('/branches', (req, res) => {
  try {
    const name = String(req.body.name ?? '').trim().replace(/\s+/g, ' ');
    if (name.length < 2 || name.length > 60) {
      return res.status(400).json({ error: 'Escribe el nombre de la sucursal (entre 2 y 60 letras)' });
    }
    const dup = db.prepare('SELECT 1 FROM branches WHERE LOWER(name) = LOWER(?)').get(name);
    if (dup) return res.status(400).json({ error: 'Ya existe una sucursal con ese nombre' });

    db.exec('BEGIN TRANSACTION;');
    let id;
    try {
      const maxOrder = db.prepare('SELECT COALESCE(MAX(display_order), 0) AS m FROM branches').get().m;
      const r = db.prepare('INSERT INTO branches (name, display_order) VALUES (?, ?)').run(name, maxOrder + 1);
      id = Number(r.lastInsertRowid);
      ensureStockRowsForBranch(id);
      db.exec('COMMIT;');
    } catch (err) {
      db.exec('ROLLBACK;');
      throw err;
    }
    res.status(201).json({ success: true, id, message: `Sucursal “${name}” creada` });
  } catch (error) {
    console.error('Error al crear sucursal:', error);
    res.status(500).json({ error: 'No se pudo crear la sucursal' });
  }
});

// PUT /api/admin/branches/:id - Cambiar el nombre de una sucursal y/o ocultarla / mostrarla (is_active).
// Ocultar no borra nada: sus ventas, cajas y existencias se conservan y se puede volver a mostrar.
router.put('/branches/:id', (req, res) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    const existing = Number.isInteger(id) ? db.prepare('SELECT * FROM branches WHERE id = ?').get(id) : null;
    if (!existing) return res.status(404).json({ error: 'Sucursal no encontrada' });

    const hasName = req.body.name !== undefined;
    const hasActive = req.body.is_active !== undefined;
    if (!hasName && !hasActive) return res.status(400).json({ error: 'No hay nada que cambiar' });

    let name = existing.name;
    if (hasName) {
      name = String(req.body.name ?? '').trim().replace(/\s+/g, ' ');
      if (name.length < 2 || name.length > 60) {
        return res.status(400).json({ error: 'Escribe el nombre de la sucursal (entre 2 y 60 letras)' });
      }
      const dup = db.prepare('SELECT 1 FROM branches WHERE LOWER(name) = LOWER(?) AND id != ?').get(name, id);
      if (dup) return res.status(400).json({ error: 'Ya existe una sucursal con ese nombre' });
    }

    let active = existing.is_active;
    if (hasActive) {
      const v = req.body.is_active;
      if (![true, false, 0, 1, '0', '1'].includes(v)) return res.status(400).json({ error: 'Dato no válido' });
      active = (v === true || v === 1 || v === '1') ? 1 : 0;
      if (active === 0 && existing.is_active === 1) {
        const visibles = db.prepare('SELECT COUNT(*) AS n FROM branches WHERE is_active = 1').get().n;
        if (visibles <= 1) return res.status(400).json({ error: 'Tiene que quedar al menos una sucursal visible.' });
        if (db.prepare("SELECT 1 FROM cash_shifts WHERE branch_id = ? AND status = 'open' LIMIT 1").get(id)) {
          return res.status(400).json({ error: `Primero cierra la caja que está abierta en “${existing.name}”.` });
        }
        if (db.prepare("SELECT 1 FROM dining_tables WHERE branch_id = ? AND is_active = 1 AND status != 'libre' LIMIT 1").get(id)) {
          return res.status(400).json({ error: `Hay mesas con cuenta abierta en “${existing.name}”. Cóbralas o cancélalas primero.` });
        }
      }
    }

    db.prepare('UPDATE branches SET name = ?, is_active = ? WHERE id = ?').run(name, active, id);
    let message = hasActive && active !== existing.is_active
      ? (active ? `“${name}” vuelve a aparecer` : `“${name}” quedó oculta (sus datos se conservan)`)
      : 'Nombre de la sucursal cambiado';
    // Al ocultar: avisar si algún vendedor activo se quedó sin ninguna sucursal para entrar
    let sinSucursal = [];
    if (hasActive && active === 0 && existing.is_active === 1) {
      sinSucursal = db.prepare(`
        SELECT full_name FROM users
        WHERE role = 'vendedor' AND is_active = 1
          AND id NOT IN (SELECT ub.user_id FROM user_branches ub JOIN branches b ON b.id = ub.branch_id WHERE b.is_active = 1)
      `).all().map(u => u.full_name);
      if (sinSucursal.length) message += `. Ojo: ${sinSucursal.join(', ')} ya no tiene a dónde entrar; asígnale otra sucursal en Personal`;
    }
    res.json({ success: true, message, users_without_branch: sinSucursal });
  } catch (error) {
    console.error('Error al cambiar sucursal:', error);
    res.status(500).json({ error: 'No se pudo cambiar la sucursal' });
  }
});

// GET /api/admin/settings - System settings
router.get('/settings', (req, res) => {
  try {
    const settings = db.prepare('SELECT * FROM system_settings WHERE id = 1').get();
    res.json({ settings });
  } catch (error) {
    console.error('Error al obtener configuraciones:', error);
    res.status(500).json({ error: 'Error al obtener datos del negocio' });
  }
});

// PUT /api/admin/settings - Update system settings
router.put('/settings', (req, res) => {
  try {
    const { business_name, tagline, address, phone, tax_id, ticket_footer, currency_symbol, escarchados, salsas } = req.body;

    // Recargo por pagar con tarjeta (%): de 0 (sin recargo) a 50
    let recargoTarjeta = null;
    if (req.body.card_surcharge_percent !== undefined && req.body.card_surcharge_percent !== null && req.body.card_surcharge_percent !== '') {
      const crudo = req.body.card_surcharge_percent;
      recargoTarjeta = (typeof crudo === 'number' || (typeof crudo === 'string' && crudo.trim() !== '')) ? Number(crudo) : NaN;
      if (!Number.isFinite(recargoTarjeta) || recargoTarjeta < 0 || recargoTarjeta > 50) {
        return res.status(400).json({ error: 'El recargo por tarjeta debe ser un número entre 0 y 50 (0 = sin recargo).' });
      }
      recargoTarjeta = Math.round(recargoTarjeta * 100) / 100;
    }

    // "No dejar vender lo que no tiene stock": 1 = sí (normal), 0 = se puede vender aunque no haya
    let bloqueoStock = null;
    if (req.body.block_no_stock !== undefined && req.body.block_no_stock !== null && req.body.block_no_stock !== '') {
      const v = req.body.block_no_stock;
      if (v === true || v === 1 || v === '1' || v === 'true') bloqueoStock = 1;
      else if (v === false || v === 0 || v === '0' || v === 'false') bloqueoStock = 0;
      else return res.status(400).json({ error: 'La opción de no vender sin stock debe ser Sí o No.' });
    }

    db.prepare(`
      UPDATE system_settings
      SET business_name = COALESCE(?, business_name),
          tagline = COALESCE(?, tagline),
          address = COALESCE(?, address),
          phone = COALESCE(?, phone),
          tax_id = COALESCE(?, tax_id),
          ticket_footer = COALESCE(?, ticket_footer),
          currency_symbol = COALESCE(?, currency_symbol),
          escarchados = COALESCE(?, escarchados),
          salsas = COALESCE(?, salsas),
          card_surcharge_percent = COALESCE(?, card_surcharge_percent),
          block_no_stock = COALESCE(?, block_no_stock),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = 1
    `).run(
      business_name !== undefined ? business_name.trim() : null,
      tagline !== undefined ? tagline.trim() : null,
      address !== undefined ? address.trim() : null,
      phone !== undefined ? phone.trim() : null,
      tax_id !== undefined ? tax_id.trim() : null,
      ticket_footer !== undefined ? ticket_footer.trim() : null,
      currency_symbol !== undefined ? currency_symbol.trim() : null,
      escarchados !== undefined ? escarchados.trim() : null,
      salsas !== undefined ? salsas.trim() : null,
      recargoTarjeta,
      bloqueoStock
    );

    const updated = db.prepare('SELECT * FROM system_settings WHERE id = 1').get();
    res.json({ success: true, message: 'Configuración guardada exitosamente', settings: updated });
  } catch (error) {
    console.error('Error al actualizar configuración:', error);
    res.status(500).json({ error: 'Error al guardar configuración' });
  }
});

// POST /api/admin/reset-data - Reset demo data or clear sales
router.post('/reset-data', (req, res) => {
  try {
    const { type } = req.body; // 'sales_only' | 'catalog_only' | 'all'

    db.exec('BEGIN TRANSACTION;');
    try {
      if (type === 'sales_only' || type === 'all') {
        db.prepare('DELETE FROM sale_items').run();
        db.prepare('DELETE FROM sales').run();
        db.prepare('DELETE FROM cash_shifts').run();
        db.prepare("DELETE FROM inventory_movements WHERE type != 'ajuste'").run();
      }

      if (type === 'catalog_only' || type === 'all') {
        db.prepare('DELETE FROM recipe_items').run();
        db.prepare('DELETE FROM products').run();
        db.prepare('DELETE FROM inventory_movements').run();
        db.prepare('DELETE FROM inventory_count_lines').run();
        db.prepare('DELETE FROM inventory_counts').run();
        db.prepare('DELETE FROM inventory_transfer_lines').run();
        db.prepare('DELETE FROM inventory_transfers').run();
        db.prepare('DELETE FROM inventory_items').run();
        db.prepare('DELETE FROM categories').run();

        // Create standard categories ready for food, drinks, snacks
        const ins = db.prepare('INSERT INTO categories (name, icon, display_order) VALUES (?, ?, ?)');
        ins.run('Micheladas & Bebidas', '🍹', 1);
        ins.run('Cervezas Frías', '🍺', 2);
        ins.run('Comidas & Platillos', '🍔', 3);
        ins.run('Botanas & Snacks', '🥜', 4);
      }

      db.exec('COMMIT;');

      res.json({
        success: true,
        message: type === 'sales_only'
          ? '¡Ventas y turnos de prueba eliminados! El sistema quedó en cero listo para operar.'
          : type === 'catalog_only'
          ? '¡Catálogo e inventario vaciados! Ahora puedes crear tus propias categorías, productos e insumos.'
          : '¡Sistema completamente limpio y listo para operar desde cero!'
      });
    } catch (err) {
      db.exec('ROLLBACK;');
      if (/FOREIGN KEY/i.test(String(err.message))) {
        return res.status(409).json({ error: 'No se puede vaciar el menú y el inventario mientras haya ventas o cuentas guardadas que los usan. Primero borra las ventas (opción “solo ventas”), o usa la opción de dejar todo en cero.' });
      }
      throw err;
    }
  } catch (error) {
    console.error('Error al reiniciar datos:', error);
    res.status(500).json({ error: 'Error al reiniciar datos' });
  }
});

export default router;
