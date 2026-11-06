import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { initDatabase, baseEstado, db } from './db.js';
import { gzipStatic } from './static-gzip.js';
import { precalentarMiniaturas } from './miniaturas.js';
import { gzipApi } from './api-gzip.js';
import { idempotencia, limpiarClavesViejas } from './idempotencia.js';
import { revisarEntrada } from './entrada.js';
import { medirVelocidad, paginaVelocidad } from './velocidad.js';

import authRoutes from './routes/auth.routes.js';
import posRoutes from './routes/pos.routes.js';
import inventoryRoutes from './routes/inventory.routes.js';
import traspasosRoutes from './routes/traspasos.routes.js';
import adminRoutes from './routes/admin.routes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

// Initialize database & tables
initDatabase();

const app = express();
const PORT = process.env.PORT || 3000;
// Detrás del proxy del hospedaje, la red real de cada aparato viene en una cabecera (se usa para frenar intentos de adivinar contraseñas)
app.set('trust proxy', 1);

// Middleware
app.disable('x-powered-by');
app.use((req, res, next) => {
  // Cabeceras de seguridad que no cambian cómo se ve ni cómo funciona nada: que el navegador no "adivine" tipos de archivo,
  // que nadie meta el sistema dentro de otra página (clickjacking) y que no se mande la dirección completa a otros sitios.
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});
app.use(cors());
app.use(express.json());

// Archivos de la página (se envían comprimidos cuando el aparato lo permite)
const publicDir = join(rootDir, 'public');
app.use(gzipStatic(publicDir));
app.use(express.static(publicDir, {
  setHeaders(res, filePath) {
    // Letra y gráficas casi nunca cambian: el aparato las guarda y no las vuelve a bajar cada vez
    if (/[\\/](fonts|vendor)[\\/]/.test(filePath)) res.setHeader('Cache-Control', 'public, max-age=604800');
    else if (/logo(-small)?\.jpg$/i.test(filePath)) res.setHeader('Cache-Control', 'public, max-age=86400');
    else if (/[\\/]icons[\\/]/.test(filePath)) res.setHeader('Cache-Control', 'public, max-age=86400');
    // Dibujos de las bebidas: se guardan 1 hora (si se cambia uno, se ve en menos de una hora o con Ctrl+F5)
    else if (/[\\/]img[\\/]/.test(filePath)) res.setHeader('Cache-Control', 'public, max-age=3600');
  }
}));

// Aviso en el registro del servidor cuando algo tarda más de 1.5 s (así se ve cuál pantalla se atora y con cuántos datos)
app.use('/api', (req, res, next) => {
  const t0 = process.hrtime.bigint();
  // Cuánto tardó el SERVIDOR en responder (el navegador lo muestra aparte del tiempo de la red): sirve para saber de quién es el atraso
  const escribir = res.writeHead;
  res.writeHead = function (...args) {
    try { if (!res.headersSent) res.setHeader('Server-Timing', `app;dur=${(Number(process.hrtime.bigint() - t0) / 1e6).toFixed(1)}`); } catch (e) { /* nada */ }
    return escribir.apply(this, args);
  };
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    if (ms > 1500) console.warn(`[LENTO] ${req.method} ${req.originalUrl.split('?')[0]} tardó ${Math.round(ms)} ms`);
  });
  next();
});
app.use('/api', gzipApi);
app.use('/api', revisarEntrada);
app.use('/api', idempotencia);

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/pos', posRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/transfers', traspasosRoutes);
app.use('/api/admin', adminRoutes);

// Health check
app.get('/api/health', (req, res) => {
  if (req.query.velocidad !== undefined) {
    // En el navegador (tableta/celular) se muestra la página de la prueba; las pruebas automáticas piden el JSON (?json=1 o sin "text/html")
    if (req.query.json === undefined && /text\/html/.test(req.headers.accept || '')) {
      res.setHeader('Cache-Control', 'no-store');
      return res.type('html').send(paginaVelocidad());
    }
    try { return res.json({ velocidad: medirVelocidad() }); }
    catch (err) { return res.status(500).json({ error: 'No se pudo medir la velocidad: ' + err.message }); }
  }
  res.json({ status: 'ok', system: 'Micheladas El Mismísimo POS', timestamp: new Date(), base_datos: baseEstado.ok ? 'ok' : 'REVISAR: la base está dañada o mezclada (mira el registro del servidor)' });
});

// Una dirección de la API que no existe responde con un error claro (antes devolvía la página principal con "todo bien" y la pantalla se confundía)
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Esa función no existe en esta versión del sistema. Actualiza la página (Ctrl+F5) e inténtalo otra vez.' });
});

// SPA Fallback: serve index.html for any other non-API route
app.use((req, res) => {
  res.sendFile(join(rootDir, 'public', 'index.html'));
});

// Errores inesperados (por ejemplo, algo enviado demasiado grande o mal escrito): siempre se responde en el mismo
// formato { error } que usa el resto del sistema, para que la pantalla pueda mostrar un mensaje claro.
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = Number(err.status || err.statusCode) || 500;
  if (status === 413) return res.status(413).json({ error: 'Lo que se intentó enviar pesa demasiado. Prueba con una foto más chica.' });
  if (status >= 400 && status < 500) return res.status(status).json({ error: 'No se pudo leer lo que se envió. Inténtalo otra vez.' });
  console.error('Error no controlado:', err);
  res.status(500).json({ error: 'Error del servidor. Inténtalo otra vez.' });
});

// Un error que nadie atendió no debe tumbar el sistema en plena venta: se anota en el registro y se sigue.
// (Si el sistema no puede ni abrir su puerto, ahí sí se apaga con un aviso claro: seguir "vivo" sin atender a nadie sería peor.)
process.on('unhandledRejection', (razon) => { console.error('[ERROR] Algo falló sin que nadie lo atendiera (el sistema sigue funcionando):', razon); });
process.on('uncaughtException', (err) => { console.error('[ERROR] Error inesperado (el sistema sigue funcionando):', err); });

// Start Server
const servidor = app.listen(PORT, '0.0.0.0', () => {
  console.log(`===================================================`);
  console.log(`🍹 MICHELADAS EL MISMÍSIMO - SISTEMA POS & BAR`);
  console.log(`🚀 Servidor Web Activo en: http://localhost:${PORT}`);
  console.log(`🌐 Acceso en Red Local / Remoto: http://0.0.0.0:${PORT}`);
  console.log(`===================================================`);
  // Deja listas las miniaturas de las fotos (de a una, sin molestar a los primeros cobros)
  if (baseEstado.ok) { precalentarMiniaturas(db); limpiarClavesViejas(); }
});
servidor.on('error', (err) => {
  console.error(`[ERROR] No se pudo abrir el puerto ${PORT}: ${err.message}. ¿Ya hay otro sistema encendido? Se apaga este.`);
  process.exit(1);
});

// Lo recién guardado vive primero en un archivo aparte (mismisimo.db-wal). Cada 5 minutos se pasa a la base principal, y al apagar
// el sistema se pasa todo y se cierra bien: así, copiar solo mismisimo.db (un respaldo) no deja afuera las ventas más nuevas.
const alPuntoDeControl = (modo) => { try { db.exec(`PRAGMA wal_checkpoint(${modo});`); } catch (e) { console.warn('[DB] No se pudo pasar lo nuevo a la base principal:', e.message); } };
const reloj = setInterval(() => alPuntoDeControl('PASSIVE'), 5 * 60 * 1000);
if (typeof reloj.unref === 'function') reloj.unref();
let apagando = false;
function apagar(senal) {
  if (apagando) return;
  apagando = true;
  console.log(`[SISTEMA] Apagando (${senal})…`);
  const forzar = setTimeout(() => process.exit(0), 4000);
  if (typeof forzar.unref === 'function') forzar.unref();
  servidor.close(() => {
    alPuntoDeControl('TRUNCATE');
    try { db.close(); } catch (e) { /* ya estaba cerrada */ }
    process.exit(0);
  });
  if (typeof servidor.closeIdleConnections === 'function') servidor.closeIdleConnections();
}
process.on('SIGTERM', () => apagar('SIGTERM'));
process.on('SIGINT', () => apagar('SIGINT'));
