// Comprime (gzip) las respuestas grandes del sistema (listas de ventas, movimientos, el CSV...) cuando el aparato lo acepta.
// Una lista de 100 ventas pasa de ~44 KB a ~6 KB: en datos móviles o WiFi flojo se nota mucho.
// Se comprime FUERA del hilo principal (zlib asíncrono), así que no frena a los demás cobros. El contenido es idéntico al original.
import { gzip } from 'node:zlib';

const MINIMO = 1400; // menos que esto cabe en un solo paquete: comprimir no ayuda

export function gzipApi(req, res, next) {
  if (req.method === 'HEAD' || !/\bgzip\b/.test(req.headers['accept-encoding'] || '')) return next();
  const enviar = res.send.bind(res);

  res.send = (body) => {
    try {
      const tipo = String(res.get('Content-Type') || '');
      const esTexto = typeof body === 'string' || Buffer.isBuffer(body);
      if (!esTexto || res.get('Content-Encoding') || !/json|csv|text/i.test(tipo) || Buffer.byteLength(body) < MINIMO) {
        return enviar(body);
      }
      // Igual que Express: los textos llevan "charset=utf-8"
      if (!/charset/i.test(tipo)) res.set('Content-Type', `${tipo}; charset=utf-8`);
      gzip(body, { level: 5 }, (err, comprimido) => {
        if (err) { res.send = enviar; return enviar(body); }
        res.set('Content-Encoding', 'gzip');
        res.vary('Accept-Encoding');
        enviar(comprimido);
      });
      return res;
    } catch (e) {
      return enviar(body);
    }
  };
  next();
}
