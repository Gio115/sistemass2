// Entrega la página, los estilos y el programa comprimidos (gzip) y con "versión" para que cada aparato los guarde.
//
// 1) Compresión: los 300 KB de archivos viajan como ~65 KB (usa lo que ya trae Node; si el aparato no acepta gzip, se envía normal).
// 2) Versión: a cada estilo y programa se le agrega ?v=<huella del contenido> (en la página y en la importación interna del programa).
//    Con esa huella el aparato lo guarda 1 año y ya NO pregunta "¿cambió algo?" en cada apertura (antes eran ~30 pedidos por apertura,
//    cada uno costaba un viaje de ida y vuelta: con WiFi flojo se notaba). Si se sube una versión nueva, la huella cambia sola
//    y el aparato baja lo nuevo en la primera apertura. La página (index.html) SIEMPRE pregunta si hay versión nueva.
import { gzipSync } from 'node:zlib';
import { statSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, normalize, sep, extname } from 'node:path';

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8'
};

const UN_ANIO = 'public, max-age=31536000, immutable';

const huellas = new Map();   // archivo -> { firma, huella }
const memoria = new Map();   // archivo -> { sig, body, etag }

const firmaDe = (st) => `${Math.floor(st.mtimeMs)}-${st.size}`;

// Huella corta del CONTENIDO de un archivo (cambia solo si el archivo cambia de verdad)
function huellaDe(archivo) {
  const st = statSync(archivo, { throwIfNoEntry: false });
  if (!st || !st.isFile()) return null;
  const firma = firmaDe(st);
  let h = huellas.get(archivo);
  if (!h || h.firma !== firma) {
    h = { firma, huella: createHash('sha1').update(readFileSync(archivo)).digest('hex').slice(0, 10) };
    huellas.set(archivo, h);
  }
  return h.huella;
}

// Agrega ?v=huella a lo que carga la página y al programa. Devuelve el texto nuevo y los archivos de los que depende.
function versionar(ruta, texto, publicDir) {
  const deps = [];
  const conVersion = (url) => {
    const archivo = normalize(join(publicDir, url));
    const h = huellaDe(archivo);
    if (!h) return null;
    deps.push(archivo);
    return `${url}?v=${h}`;
  };
  if (ruta === '/index.html') {
    texto = texto.replace(/(href|src)="(\/(?:css\/[\w.-]+\.css|js\/(?:app|escpos)\.js))"/g, (m, attr, url) => {
      const nueva = conVersion(url);
      return nueva ? `${attr}="${nueva}"` : m;
    });
  } else if (ruta === '/js/app.js') {
    texto = texto.replace(/(from\s+')(\.\/escpos\.js)(')/g, (m, a, rel, c) => {
      const nueva = conVersion('/js/escpos.js');
      return nueva ? `${a}${rel}?v=${nueva.split('?v=')[1]}${c}` : m;
    });
  }
  return { texto, deps };
}

export function gzipStatic(publicDir) {
  const raiz = normalize(publicDir + sep);

  return (req, res, next) => {
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      if (!/\bgzip\b/.test(req.headers['accept-encoding'] || '')) return next();

      let ruta = decodeURIComponent(req.path);
      if (ruta === '/') ruta = '/index.html';
      const tipo = TIPOS[extname(ruta).toLowerCase()];
      if (!tipo) return next();

      const archivo = normalize(join(publicDir, ruta));
      if (!archivo.startsWith(raiz)) return next(); // nunca salir de la carpeta public

      const st = statSync(archivo, { throwIfNoEntry: false });
      if (!st || !st.isFile()) return next();

      // ¿Sigue valiendo lo que ya se preparó? (el archivo y los que usa no cambiaron)
      let e = memoria.get(archivo);
      const sigDe = (f, deps) => [f, ...deps].map((a) => { const s = statSync(a, { throwIfNoEntry: false }); return s ? firmaDe(s) : 'x'; }).join('|');
      if (!e || e.sig !== sigDe(archivo, e.deps)) {
        let crudo = readFileSync(archivo);
        let deps = [];
        if (ruta === '/index.html' || ruta === '/js/app.js') {
          const v = versionar(ruta, crudo.toString('utf8'), publicDir);
          crudo = Buffer.from(v.texto, 'utf8'); deps = v.deps;
        }
        const body = gzipSync(crudo, { level: 9 });
        e = { deps, sig: sigDe(archivo, deps), body, etag: `W/"gz-${createHash('sha1').update(crudo).digest('hex').slice(0, 16)}"` };
        memoria.set(archivo, e);
      }

      res.setHeader('Content-Type', tipo);
      res.setHeader('Content-Encoding', 'gzip');
      res.setHeader('Vary', 'Accept-Encoding');
      res.setHeader('ETag', e.etag);
      res.setHeader('Last-Modified', st.mtime.toUTCString());
      // - Con ?v=huella (lo pide la página nueva): se guarda 1 año, no vuelve a preguntar.
      // - Las gráficas (casi nunca cambian): 7 días.
      // - La página y lo que no trae versión: siempre pregunta si hay una nueva (y responde "sin cambios" si no la hay).
      if (/^\/js\/vendor\//.test(ruta)) res.setHeader('Cache-Control', 'public, max-age=604800');
      else if (ruta !== '/index.html' && typeof req.query.v === 'string' && req.query.v === huellaDe(archivo)) res.setHeader('Cache-Control', UN_ANIO); // solo si la versión pedida ES la del archivo
      else res.setHeader('Cache-Control', 'no-cache');

      if (req.headers['if-none-match'] === e.etag) {
        res.statusCode = 304;
        return res.end();
      }
      res.setHeader('Content-Length', e.body.length);
      if (req.method === 'HEAD') return res.end();
      return res.end(e.body);
    } catch {
      return next(); // ante cualquier duda, que lo sirva el método normal
    }
  };
}
