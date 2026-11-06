// Evita que un reintento duplique un cobro (o una compra, o un traspaso...).
//
// El problema: con WiFi flojo, el aparato manda el cobro, el servidor lo guarda, pero la respuesta se pierde por el camino.
// La pantalla dice "no se pudo cobrar", el cajero vuelve a tocar COBRAR y la venta se guardaba dos veces (se descontaba el inventario
// dos veces y la caja contaba el dinero dos veces).
//
// La solución: cada intento de cobro lleva una clave (cabecera "X-Idempotency-Key") que inventa la pantalla. El servidor anota la
// respuesta que dio a esa clave; si la MISMA clave llega otra vez con lo MISMO, no vuelve a hacer nada: devuelve la respuesta de antes.
//  - Solo se anotan las respuestas buenas (2xx): si algo falló, el reintento se hace de verdad.
//  - Si llega la misma clave pero con otro contenido (otro carrito, otro usuario, otra sucursal), se trata como un pedido nuevo.
//  - Las claves se borran a los 2 días. Sin la cabecera, todo funciona exactamente igual que antes.
import { createHash } from 'node:crypto';
import { db } from './db.js';
import { verifyToken } from './auth.js';

const CLAVE_VALIDA = /^[A-Za-z0-9_-]{8,80}$/;
const sha = (t) => createHash('sha1').update(String(t)).digest('hex');

let sentencias = null;
const s = () => sentencias || (sentencias = {
  buscar: db.prepare('SELECT auth, body_hash, method, path, status, response FROM idempotency_keys WHERE key = ?'),
  guardar: db.prepare('INSERT OR REPLACE INTO idempotency_keys (key, auth, body_hash, method, path, status, response) VALUES (?, ?, ?, ?, ?, ?, ?)'),
  purgar: db.prepare("DELETE FROM idempotency_keys WHERE created_at < datetime('now', '-2 days')")
});

export function idempotencia(req, res, next) {
  const clave = req.headers['x-idempotency-key'];
  if (clave === undefined || req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  if (typeof clave !== 'string' || !CLAVE_VALIDA.test(clave)) return next();   // clave rara: se ignora y la petición se hace normal
  try {
    const ruta = req.originalUrl.split('?')[0];   // se fija ahora: más adelante cada router recorta el camino y "req.path" cambia
    // La clave se amarra a la PERSONA (no al texto de la sesión): si la sesión se renueva entre un intento y su reintento, sigue valiendo.
    const cabecera = String(req.headers.authorization || req.headers['x-auth-token'] || '');
    const payload = verifyToken(cabecera.startsWith('Bearer ') ? cabecera.substring(7) : cabecera);
    if (!payload || payload.id === undefined) return next();   // sin sesión válida la petición se rechaza más adelante; aquí no se anota nada
    const auth = 'u' + String(payload.id);
    const contenido = sha(JSON.stringify(req.body === undefined ? null : req.body) + '|' + (req.headers['x-branch-id'] || ''));
    const q = s();
    const previo = q.buscar.get(clave);
    if (previo && previo.auth === auth && previo.body_hash === contenido && previo.method === req.method && previo.path === ruta) {
      res.setHeader('X-Idempotent-Replay', '1');
      return res.status(previo.status).type('application/json').send(previo.response);
    }
    const json = res.json.bind(res);
    res.json = (obj) => {
      try {
        if (res.statusCode >= 200 && res.statusCode < 300) q.guardar.run(clave, auth, contenido, req.method, ruta, res.statusCode, JSON.stringify(obj));
      } catch (e) { console.warn('[IDEMPOTENCIA] No se pudo anotar la respuesta:', e.message); }
      return json(obj);
    };
  } catch (e) {
    console.warn('[IDEMPOTENCIA] Se omitió la revisión:', e.message);
  }
  next();
}

// Borra las claves viejas (al arrancar y cada 6 horas). El temporizador no impide que el sistema se apague.
export function limpiarClavesViejas() {
  const limpiar = () => { try { s().purgar.run(); } catch (e) { console.warn('[IDEMPOTENCIA] No se pudieron limpiar las claves viejas:', e.message); } };
  limpiar();
  const t = setInterval(limpiar, 6 * 60 * 60 * 1000);
  if (typeof t.unref === 'function') t.unref();
}
