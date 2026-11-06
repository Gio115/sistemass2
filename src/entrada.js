// Revisa lo que llega de las pantallas ANTES de que lo vea cada ruta, para que un dato absurdo (un número donde va un nombre, un
// "verdadero" donde va un número de mesa, un cuerpo vacío...) dé un mensaje claro y no un "Error al ..." genérico.
// Nuestras propias pantallas nunca mandan estas cosas; esto protege de pantallas viejas sin actualizar, de fallas de la red y de curiosos.
//  - El cuerpo debe ser un objeto (si viene vacío se toma como {}).
//  - Los campos de número de algo (id, table_id, product_id, branch_ids...) no pueden ser verdadero/falso, objetos ni listas (salvo listas en *_ids).
//  - "items", "lines", "recipe" y "options" deben ser listas de objetos.
//  - Los campos de texto conocidos (name, username, notes...): un número se convierte en texto; vacío (null) se toma como "no se mandó";
//    verdadero/falso, objetos y listas se rechazan.
const ID = /(^id$|_id$)/;
const IDS = /(^ids$|_ids$)/;
const LISTAS_DE_OBJETOS = new Set(['items', 'lines', 'recipe', 'options']);
const TEXTOS = new Set([
  'name', 'username', 'password', 'full_name', 'description', 'badge', 'icon', 'notes', 'customer_name', 'business_name', 'address', 'phone',
  'tax_id', 'tagline', 'ticket_footer', 'currency_symbol', 'escarchados', 'salsas', 'customization', 'invoice_number', 'area',
  'pack_name', 'category', 'unit', 'ticket_number'
]);
const REQUERIDOS = {
  '/pos/tables/open': ['table_id'], '/pos/tables/add-items': ['table_id'], '/pos/tables/request-bill': ['table_id'], '/pos/tables/checkout': ['table_id'],
  '/pos/tables/cancel': ['table_id'], '/pos/tables/transfer': ['from_table_id', 'to_table_id'], '/pos/tables/remove-item': ['table_order_item_id'],
  '/inventory/purchase': ['inventory_item_id'], '/inventory/waste': ['inventory_item_id']
};
const FORMATO = 'Lo que se envió no tiene el formato correcto. Actualiza la página e inténtalo otra vez.';

function revisar(obj, prof) {
  if (prof > 6) return null;
  for (const [k, v] of Object.entries(obj)) {
    if (TEXTOS.has(k)) {
      if (v === null) delete obj[k];
      else if (typeof v === 'number' && Number.isFinite(v)) obj[k] = String(v);
      else if (typeof v === 'boolean' || (v !== null && typeof v === 'object') || typeof v === 'number') return k;
    } else if (ID.test(k)) {
      if (typeof v === 'boolean' || (v !== null && typeof v === 'object')) return k;
    } else if (IDS.test(k)) {
      if (typeof v === 'boolean' || (v !== null && typeof v === 'object' && !Array.isArray(v))) return k;
      if (Array.isArray(v) && v.some(x => typeof x === 'boolean' || (x !== null && typeof x === 'object'))) return k;
    } else if (LISTAS_DE_OBJETOS.has(k) && v !== null && v !== undefined) {
      if (!Array.isArray(v) || v.some(x => x === null || typeof x !== 'object' || Array.isArray(x))) return k;
    }
    if (v && typeof v === 'object') {
      for (const x of (Array.isArray(v) ? v : [v])) {
        if (x && typeof x === 'object' && !Array.isArray(x)) { const r = revisar(x, prof + 1); if (r) return r; }
      }
    }
  }
  return null;
}

export function revisarEntrada(req, res, next) {
  if (req.method !== 'POST' && req.method !== 'PUT' && req.method !== 'PATCH' && req.method !== 'DELETE') return next();
  if (/^image\//i.test(String(req.headers['content-type'] || ''))) return next();   // fotos: se leen más adelante, no son datos
  if (req.body === undefined || req.body === null) req.body = {};
  if (typeof req.body !== 'object' || Array.isArray(req.body)) return res.status(400).json({ error: FORMATO });
  const mal = revisar(req.body, 0);
  if (mal) return res.status(400).json({ error: `El dato «${mal}» no es válido. Actualiza la página e inténtalo otra vez.` });
  if (req.method === 'POST') {
    const faltan = REQUERIDOS[req.path];   // dentro de app.use('/api', ...) el camino ya viene sin "/api"
    const falta = faltan && faltan.find(c => req.body[c] === undefined || req.body[c] === null || req.body[c] === '');
    if (falta) return res.status(400).json({ error: `Falta el dato «${falta}». Actualiza la página e inténtalo otra vez.` });
  }
  next();
}
