// Lo que no tiene stock en la tienda no se puede vender.
//
// Para saber si un producto "tiene stock" se usa EXACTAMENTE lo mismo que se descuenta al cobrar (ver pos.routes.js y options.js):
//   - si el cliente eligió una presentación (vidrio / lata...), se necesita el insumo de esa presentación;
//   - si el producto se vende tal cual (venta directa) y no tiene presentaciones, se necesita 1 del insumo directo por unidad;
//   - en cualquier otro caso se necesitan los ingredientes de la receta.
// Un producto que no está ligado a ningún insumo no tiene nada que revisar y siempre se puede vender.
//
// Este archivo SOLO LEE el inventario: no mueve ni cambia ninguna existencia.
import { db } from './db.js';

const EPS = 1e-6;   // para que 0.9999999 de una botella cuente como 1 (los ml y las medias botellas son decimales)

let sentencias = null;
const s = () => sentencias || (sentencias = {
  ajuste: db.prepare('SELECT block_no_stock FROM system_settings WHERE id = 1'),
  stock: db.prepare('SELECT inventory_item_id, current_stock FROM inventory_stock WHERE branch_id = ?'),
  nombres: db.prepare('SELECT id, name FROM inventory_items'),
  recetas: db.prepare('SELECT product_id, inventory_item_id, quantity FROM recipe_items'),
  receta: db.prepare('SELECT inventory_item_id, quantity FROM recipe_items WHERE product_id = ?'),
  opciones: db.prepare('SELECT id, product_id, label, inventory_item_id, quantity FROM product_options'),
  reservado: db.prepare(`
    SELECT oi.product_id, oi.quantity AS qty, p.is_direct_sale, p.direct_inventory_item_id,
      po.id AS opt_id, po.inventory_item_id AS opt_item, po.quantity AS opt_qty
    FROM table_order_items oi
    JOIN table_orders o ON o.id = oi.table_order_id AND o.status IN ('open', 'billed')
    JOIN dining_tables t ON t.id = o.table_id AND t.branch_id = ?
    JOIN products p ON p.id = oi.product_id
    LEFT JOIN product_options po ON po.id = oi.option_id AND po.product_id = oi.product_id
  `)
});

// ¿Está encendido el bloqueo? (Ajustes -> "No dejar vender lo que no tiene stock"). Viene encendido.
export function bloqueoActivo() {
  try {
    const r = s().ajuste.get();
    return !r || Number(r.block_no_stock) !== 0;
  } catch (e) { return true; }
}

// Lo que se necesita del inventario para vender UNA unidad: Map(insumo -> cantidad).
export function necesidades(prod, option, receta) {
  const m = new Map();
  const sumar = (id, q) => {
    const n = Number(q);
    if (Number.isInteger(id) && Number.isFinite(n) && n > 0) m.set(id, (m.get(id) || 0) + n);
  };
  if (option) sumar(option.inventory_item_id, option.quantity);
  if (prod.is_direct_sale && prod.direct_inventory_item_id && !option) sumar(prod.direct_inventory_item_id, 1);
  else for (const r of receta) sumar(r.inventory_item_id, r.quantity);
  return m;
}

const mapaStock = (branchId) => new Map(s().stock.all(branchId).map(r => [r.inventory_item_id, Number(r.current_stock) || 0]));
const mapaNombres = () => new Map(s().nombres.all().map(r => [r.id, r.name]));

// Cuántas unidades se pueden vender con lo que hay: { max (null = sin límite), falta (nombre del insumo que limita) }
function alcanza(need, disponible, nombres) {
  let max = Infinity, falta = null, faltaId = null;
  for (const [id, q] of need) {
    const hay = disponible(id);
    const n = Math.max(0, Math.floor((hay + EPS) / q));
    if (n < max) { max = n; falta = nombres.get(id) || null; faltaId = id; }
  }
  return { max: max === Infinity ? null : max, falta, faltaId };
}

// Para el menú de Vender: a cada producto (y a cada presentación) se le agrega
//   max_venta  -> cuántas unidades alcanzan (null = no hay límite que revisar)
//   sin_stock  -> true si no alcanza ni para una (o el bloqueo está apagado: siempre false)
//   falta      -> el insumo que se acabó (solo cuando no tiene stock)
// Los campos que ya existían no se tocan.
export function anotarDisponibilidad(branchId, products) {
  const activo = bloqueoActivo();
  const stock = mapaStock(branchId);
  const nombres = mapaNombres();
  const recetas = new Map();
  for (const r of s().recetas.all()) { if (!recetas.has(r.product_id)) recetas.set(r.product_id, []); recetas.get(r.product_id).push(r); }
  const opciones = new Map();
  for (const o of s().opciones.all()) { if (!opciones.has(o.product_id)) opciones.set(o.product_id, new Map()); opciones.get(o.product_id).set(o.id, o); }
  const reservado = activo ? reservadoEnMesas(branchId) : new Map();
  const disponible = (id) => (stock.get(id) || 0) - (reservado.get(id) || 0);   // lo pedido en mesas ya está apartado

  for (const p of products) {
    const receta = recetas.get(p.id) || [];
    const marcar = (obj, opt) => {
      if (!activo) { obj.max_venta = null; obj.sin_stock = false; return; }
      const r = alcanza(necesidades(p, opt, receta), disponible, nombres);
      obj.max_venta = r.max;
      obj.sin_stock = r.max !== null && r.max <= 0;
      if (obj.sin_stock && r.falta) obj.falta = r.falta;
    };
    if (Array.isArray(p.options) && p.options.length) {
      for (const o of p.options) marcar(o, opciones.get(p.id)?.get(o.id) || null);
      p.max_venta = null;
      p.sin_stock = p.options.every(o => o.sin_stock);
    } else {
      marcar(p, null);
    }
  }
}

// Lo que ya está pedido en las cuentas abiertas de las mesas de esta tienda y todavía no se descuenta (se descuenta al cobrar):
// Map(insumo -> cantidad). Así dos mesas no pueden pedir la última botella.
export function reservadoEnMesas(branchId) {
  const m = new Map();
  const recetaDe = new Map();
  for (const r of s().reservado.all(branchId)) {
    if (!recetaDe.has(r.product_id)) recetaDe.set(r.product_id, s().receta.all(r.product_id));
    const option = r.opt_id ? { inventory_item_id: r.opt_item, quantity: r.opt_qty } : null;
    const need = necesidades({ is_direct_sale: r.is_direct_sale, direct_inventory_item_id: r.direct_inventory_item_id }, option, recetaDe.get(r.product_id));
    for (const [id, q] of need) m.set(id, (m.get(id) || 0) + q * r.qty);
  }
  return m;
}

// Revisa un pedido completo ANTES de guardarlo. lineas: [{ prod, option, qty }] (prod con id, name, is_direct_sale, direct_inventory_item_id).
// Devuelve null si todo alcanza (o si el bloqueo está apagado); si no, { error, code: 'SIN_STOCK', shortages }.
// Se suma lo de todas las líneas: dos micheladas distintas que usan el mismo clamato se revisan juntas.
export function revisarStock(branchId, lineas, { reservado = null } = {}) {
  if (!bloqueoActivo()) return null;
  const stock = mapaStock(branchId);
  const nombres = mapaNombres();
  const disponible = (id) => (stock.get(id) || 0) - ((reservado && reservado.get(id)) || 0);

  const demanda = new Map();
  const detalle = [];
  for (const l of lineas) {
    const receta = s().receta.all(l.prod.id);
    const need = necesidades(l.prod, l.option, receta);
    detalle.push({ l, need });
    for (const [id, q] of need) demanda.set(id, (demanda.get(id) || 0) + q * l.qty);
  }
  const faltan = new Set();
  for (const [id, total] of demanda) if (total > disponible(id) + EPS) faltan.add(id);
  if (faltan.size === 0) return null;

  const shortages = [];
  const textos = [];
  const vistos = new Set();
  for (const { l, need } of detalle) {
    if (![...need.keys()].some(id => faltan.has(id))) continue;
    const nombre = l.option ? `${l.prod.name} (${l.option.label})` : l.prod.name;
    if (vistos.has(nombre)) continue;
    vistos.add(nombre);
    const propio = alcanza(need, disponible, nombres);   // lo que alcanzaría para este producto solo
    const quedan = propio.max === null ? 0 : propio.max;
    shortages.push({ product_id: l.prod.id, name: nombre, available: quedan, insumo: propio.falta });
    const apartado = propio.faltaId !== null && reservado && (reservado.get(propio.faltaId) || 0) > 0 ? '; lo que queda ya está pedido en mesas' : '';
    if (quedan <= 0) textos.push(`«${nombre}» no tiene stock${propio.falta ? ` (falta ${propio.falta}${apartado})` : ''}`);
    else if (quedan < l.qty) textos.push(`de «${nombre}» solo quedan ${quedan}`);
    else textos.push(`«${nombre}» comparte insumos con otros productos del pedido y no alcanza para todo`);
  }
  return {
    error: `Sin stock: ${textos.join('; ')}. Quita eso del pedido o avisa al administrador para registrar la mercadería.`,
    code: 'SIN_STOCK',
    shortages
  };
}
