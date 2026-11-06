// Miniaturas de las fotos del menú.
// Las fotos se guardan a 480 px (calidad para el administrador), pero en la pantalla de Vender se ven a ~96 px.
// Mandar la foto completa a cada tableta/celular pesa 3 veces más de lo necesario (con 16 fotos: 560 KB en vez de ~210 KB).
// Aquí se prepara, SOLO PARA MOSTRAR, una copia más chica (máx. 256 px, que se ve igual en pantallas de alta definición).
// La foto original NO se toca: sigue guardada tal cual en la base de datos, y es la que se ve en el cuadro de edición.
// Si algo falla (foto rara, falta el programa que reduce), se manda la original y todo sigue funcionando.
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

// OJO: aquí NO se puede usar "await" al nivel principal del archivo. Hostinger arranca el sistema con require(), y require() se
// niega a cargar un módulo con await en su nivel principal (el sistema no abre y sale el error 503). Por eso se carga con createRequire.
let jpeg = null;
try { jpeg = createRequire(import.meta.url)('jpeg-js'); } catch { /* sin el programa: se mandan las fotos originales */ }

export const LADO_MINIATURA = 256;
const CALIDAD = 78;
const cache = new Map();   // huella de la foto original -> Buffer de la miniatura (o null si no conviene/ no se pudo)

function reducir(buf) {
  const img = jpeg.decode(buf, { useTArray: true, formatAsRGBA: false, maxMemoryUsageInMB: 96 });
  const { width: w, height: h, data } = img;
  const k = Math.min(1, LADO_MINIATURA / Math.max(w, h));
  if (k >= 1) return null;                       // ya es chica: se usa la original
  const nw = Math.max(1, Math.round(w * k)), nh = Math.max(1, Math.round(h * k));
  const out = new Uint8Array(nw * nh * 4);
  const sx = w / nw, sy = h / nh;                // promedio de áreas: queda suave, sin dientes de sierra
  for (let y = 0; y < nh; y++) {
    const y0 = y * sy, y1 = Math.min(h, (y + 1) * sy);
    for (let x = 0; x < nw; x++) {
      const x0 = x * sx, x1 = Math.min(w, (x + 1) * sx);
      let r = 0, g = 0, b = 0, peso = 0;
      for (let yy = Math.floor(y0); yy < Math.ceil(y1); yy++) {
        const wy = Math.min(yy + 1, y1) - Math.max(yy, y0);
        for (let xx = Math.floor(x0); xx < Math.ceil(x1); xx++) {
          const wx = Math.min(xx + 1, x1) - Math.max(xx, x0), p = wx * wy, i = (yy * w + xx) * 3;
          r += data[i] * p; g += data[i + 1] * p; b += data[i + 2] * p; peso += p;
        }
      }
      const o = (y * nw + x) * 4;
      out[o] = r / peso; out[o + 1] = g / peso; out[o + 2] = b / peso; out[o + 3] = 255;
    }
  }
  const mini = Buffer.from(jpeg.encode({ data: out, width: nw, height: nh }, CALIDAD).data);
  return mini.length < buf.length * 0.9 ? mini : null;   // si no ahorra al menos 10 %, no vale la pena
}

// Devuelve la miniatura (Buffer) de esa foto, o null si hay que mandar la original.
export function miniaturaDe(original) {
  if (!jpeg) return null;
  const huella = createHash('sha1').update(original).digest('hex');
  if (cache.has(huella)) return cache.get(huella);
  let mini = null;
  try { mini = reducir(original); } catch { mini = null; }
  if (cache.size > 400) cache.clear();           // tope de memoria (nunca se llega con un menú normal)
  cache.set(huella, mini);
  return mini;
}

// Al encender el servidor, deja listas las miniaturas de a una (sin trabar los primeros cobros)
export async function precalentarMiniaturas(db) {
  if (!jpeg) return;
  try {
    const ids = db.prepare('SELECT product_id FROM product_images').all().map((r) => r.product_id);
    for (const id of ids) {
      const row = db.prepare('SELECT data FROM product_images WHERE product_id = ?').get(id);
      if (row) miniaturaDe(Buffer.from(row.data.buffer, row.data.byteOffset, row.data.byteLength));
      await new Promise((r) => setTimeout(r, 25));
    }
  } catch { /* si algo falla, se prepararán cuando las pidan */ }
}
