/* Micheladas El Mismísimo — guardado de archivos en el aparato (permite instalarlo como app y abrirlo más rápido).
 *
 * Reglas (para que NUNCA se quede una versión vieja ni datos viejos):
 *  - Los DATOS (/api/...) NO pasan por aquí: siempre van directo al servidor. Nada de ventas, inventario ni caja se guarda en el aparato.
 *  - La PÁGINA se pide primero al servidor (así una actualización se ve en cuanto hay internet). Solo si el servidor tarda más de 5 s
 *    o no hay internet, se muestra la última página guardada.
 *  - Los estilos y el programa traen una "huella" (?v=...) que cambia sola cuando el archivo cambia: se guardan y se reutilizan
 *    sin preguntar; al cambiar la huella se baja el nuevo y se borra el viejo.
 *  - Letra, gráficas, íconos, logo y dibujos: se muestra lo guardado y se actualiza por detrás.
 */
const CACHE = 'mismisimo-v1';
const ESPERA_PAGINA_MS = 5000;

self.addEventListener('install', () => { self.skipWaiting(); });

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

const esArchivoDelSistema = (p) => /^\/(css|js|fonts|icons|img)\//.test(p) || /^\/logo(-small)?\.jpg$/.test(p);

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return;
  const p = url.pathname;
  if (p.startsWith('/api/') || p === '/sw.js' || p === '/manifest.webmanifest') return;   // directo al servidor, sin guardar nada
  if (req.mode === 'navigate') { event.respondWith(pagina(req)); return; }
  if (esArchivoDelSistema(p)) event.respondWith(archivo(req, url));
});

async function pagina(req) {
  const cache = await caches.open(CACHE);
  try {
    const resp = await Promise.race([
      fetch(req),
      new Promise((_, no) => setTimeout(() => no(new Error('lento')), ESPERA_PAGINA_MS))
    ]);
    if (resp && resp.ok && resp.status === 200) { try { await cache.put('/index.html', resp.clone()); } catch (e) { /* no pasa nada */ } }
    return resp;
  } catch (e) {
    const guardada = await cache.match('/index.html');
    return guardada || fetch(req);
  }
}

async function archivo(req, url) {
  const cache = await caches.open(CACHE);
  const guardado = await cache.match(req);
  const conHuella = url.searchParams.has('v') || /^\/fonts\//.test(url.pathname);
  if (conHuella && guardado) return guardado;   // con huella nunca cambia: no se pregunta al servidor
  const pedir = fetch(req).then(async (resp) => {
    if (resp && resp.ok && resp.status === 200) {
      try { await cache.put(req, resp.clone()); } catch (e) { /* no pasa nada */ }
      if (url.searchParams.has('v')) borrarVersionesViejas(cache, url);
    }
    return resp;
  });
  if (conHuella || !guardado) return pedir;
  pedir.catch(() => {});   // sin huella: se muestra lo guardado y se actualiza por detrás
  return guardado;
}

// Al llegar una versión nueva de un archivo, se borra la anterior (no se acumulan)
async function borrarVersionesViejas(cache, url) {
  try {
    for (const k of await cache.keys()) {
      const u = new URL(k.url);
      if (u.pathname === url.pathname && u.search !== url.search) await cache.delete(k);
    }
  } catch (e) { /* no pasa nada */ }
}
