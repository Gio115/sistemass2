// =====================================================================
// Impresión directa en la térmica de 58 mm (Vektor VT-POS-58Y y parecidas)
// ---------------------------------------------------------------------
// Arma los bytes ESC/POS del ticket y de la cuenta, y el enlace que entiende la app RawBT
// (Android). RawBT recibe esos bytes y los manda por Bluetooth a la impresora: no se abre ningún
// cuadro de "Imprimir" de Android.
//
// Este archivo no toca la pantalla (salvo logoToRaster, que usa un <canvas>), así que se puede
// probar aparte con Node.
// =====================================================================

export const COLS = 32;                 // letras por renglón en papel de 58 mm (letra normal)
const ESC = 0x1b, GS = 0x1d, FS = 0x1c, LF = 0x0a;

// Letras con tilde que sí existen en la tabla de caracteres CP850 de la impresora
const CP850 = {
  'á': 0xA0, 'é': 0x82, 'í': 0xA1, 'ó': 0xA2, 'ú': 0xA3, 'ñ': 0xA4, 'Ñ': 0xA5, '¿': 0xA8, '¡': 0xAD,
  'Á': 0xB5, 'É': 0x90, 'Í': 0xD6, 'Ó': 0xE0, 'Ú': 0xE9, 'ü': 0x81, 'Ü': 0x9A, '°': 0xF8
};
// Símbolos que no se pueden imprimir → su parecido en letras simples
const SIMBOLOS = {
  '¿': '?', '¡': '!', '—': '-', '–': '-', '•': '*', '·': '-', '“': '"', '”': '"', '‘': "'", '’': "'",
  '…': '...', '×': 'x', '€': 'EUR', 'º': 'o', 'ª': 'a', '°': 'o', ' ': ' ', '\t': ' '
};

// Deja el texto listo para el papel: cada carácter ocupa exactamente una columna.
// Sin "tildes" todo sale en letras simples (á→a, ñ→n); con "tildes" se conservan las de CP850.
export function limpiar(texto, tildes) {
  let out = '';
  for (const ch of String(texto ?? '').normalize('NFC')) {
    const c = ch.codePointAt(0);
    if (c === 0x0a || c === 0x0d) { out += ' '; continue; }
    if (c >= 0x20 && c < 0x7f) { out += ch; continue; }
    if (tildes && CP850[ch] !== undefined) { out += ch; continue; }
    if (SIMBOLOS[ch] !== undefined) { out += SIMBOLOS[ch]; continue; }
    if (c > 0xffff || (c >= 0xfe00 && c <= 0xfe0f) || c === 0x200d || (c >= 0x2190 && c <= 0x2bff)) continue; // emojis y flechas: se omiten
    const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
    out += (base && base.charCodeAt(0) >= 0x20 && base.charCodeAt(0) < 0x7f) ? base[0] : '?';
  }
  return out;
}

// Parte un texto en renglones de a lo más "ancho" letras (corta por palabras)
export function partir(texto, ancho) {
  const w = Math.max(1, ancho);
  const lineas = [];
  let actual = '';
  for (let palabra of String(texto).split(/\s+/).filter(Boolean)) {
    while (palabra.length > w) {                         // palabra más larga que el renglón
      if (actual) { lineas.push(actual); actual = ''; }
      lineas.push(palabra.slice(0, w)); palabra = palabra.slice(w);
    }
    if (!actual) actual = palabra;
    else if (actual.length + 1 + palabra.length <= w) actual += ' ' + palabra;
    else { lineas.push(actual); actual = palabra; }
  }
  if (actual) lineas.push(actual);
  return lineas;
}

export class Recibo {
  constructor({ tildes = false, cols = COLS } = {}) {
    this.tildes = !!tildes;
    this.cols = cols;
    this.buf = [];
    this.raw([ESC, 0x40]);                                // iniciar la impresora
    if (this.tildes) this.raw([FS, 0x2e, ESC, 0x74, 0x02]); // sin modo chino + tabla CP850 (español)
  }
  raw(arr) { for (const b of arr) this.buf.push(b & 0xff); return this; }
  texto(s) {
    for (const ch of limpiar(s, this.tildes)) {
      const c = ch.codePointAt(0);
      this.buf.push(c < 0x80 ? c : (CP850[ch] ?? 0x3f));
    }
    return this;
  }
  alinear(a) { return this.raw([ESC, 0x61, a === 'centro' ? 1 : a === 'derecha' ? 2 : 0]); }
  negrita(on) { return this.raw([ESC, 0x45, on ? 1 : 0]); }
  tamano(ancho, alto) { return this.raw([GS, 0x21, ((ancho - 1) << 4) | (alto - 1)]); }
  salto() { return this.raw([LF]); }
  avanzar(n) { return this.raw([ESC, 0x64, Math.min(255, Math.max(0, n))]); }
  // Un renglón ya armado (se alinea a la izquierda salvo que se pida otra cosa)
  linea(s, { alinear = 'izquierda', negrita = false, ancho = 1, alto = 1 } = {}) {
    this.alinear(alinear);
    if (negrita) this.negrita(true);
    if (ancho > 1 || alto > 1) this.tamano(ancho, alto);
    this.texto(s).salto();
    if (ancho > 1 || alto > 1) this.tamano(1, 1);
    if (negrita) this.negrita(false);
    return this;
  }
  centrado(s, op = {}) {
    const ancho = op.ancho || 1;
    for (const l of partir(limpiar(s, this.tildes), Math.floor(this.cols / ancho))) this.linea(l, { ...op, alinear: 'centro' });
    return this;
  }
  // "Etiqueta ........ valor" (el valor pegado a la derecha). Si no cabe, el valor baja a su renglón.
  fila(izq, der, op = {}) {
    const ancho = op.ancho || 1;
    const W = Math.floor(this.cols / ancho);
    const l = limpiar(izq, this.tildes), r = limpiar(der, this.tildes);
    if (l.length + 1 + r.length <= W) return this.linea(l + ' '.repeat(W - l.length - r.length) + r, op);
    for (const x of partir(l, W)) this.linea(x, op);
    for (const x of partir(r, W)) this.linea(x.padStart(W), op);
    return this;
  }
  separador(c = '-') { return this.linea(c.repeat(this.cols)); }
  // Lista de productos: Cant | Descripción | Importe
  productos(items) {
    const t = this.tildes;
    const montos = items.map(i => limpiar(i.monto, t));
    const wCant = 5;
    const wMonto = Math.max(8, ...montos.map(m => m.length + 1));
    const wNombre = this.cols - wCant - wMonto;
    this.linea('Cant '.padEnd(wCant) + limpiar(t ? 'Descripción' : 'Descripcion', t).padEnd(wNombre) + 'Importe'.padStart(wMonto), { negrita: true });
    items.forEach((it, n) => {
      const nombre = partir(limpiar(it.nombre, t), wNombre);
      const cant = (limpiar(it.cant, t) + 'x').padEnd(wCant);
      this.linea(cant + (nombre[0] || '').padEnd(wNombre) + montos[n].padStart(wMonto));
      for (const extra of nombre.slice(1)) this.linea(' '.repeat(wCant) + extra);
      if (it.nota) for (const extra of partir(limpiar(it.nota, t), wNombre - 1)) this.linea(' '.repeat(wCant + 1) + extra);
    });
    return this;
  }
  // Dibujo en blanco y negro (el logo). raster = { bytesPorFila, filas, datos }
  imagen(raster) {
    if (!raster || !raster.filas) return this;
    this.alinear('centro');
    const banda = 128;                                    // se manda por tiras para no saturar la memoria de la impresora
    for (let y = 0; y < raster.filas; y += banda) {
      const h = Math.min(banda, raster.filas - y);
      this.raw([GS, 0x76, 0x30, 0x00, raster.bytesPorFila & 0xff, (raster.bytesPorFila >> 8) & 0xff, h & 0xff, (h >> 8) & 0xff]);
      for (let i = y * raster.bytesPorFila; i < (y + h) * raster.bytesPorFila; i++) this.buf.push(raster.datos[i]);
    }
    return this;
  }
  bytes() { return Uint8Array.from(this.buf); }
}

// ---------------------------------------------------------------------
// Ticket de venta  (los datos ya vienen en texto, tal como se ven en el ticket de pantalla)
//   t = { negocio, lema, direccion, telefono, nit, sucursal, anulada:{motivo,por}|null,
//         filas:[[etiqueta, valor, {negrita}]], items:[{cant,nombre,nota,monto}],
//         subtotales:[[etiqueta, valor]], total:[etiqueta, valor], pagos:[[etiqueta, valor]], pie, firma }
// ---------------------------------------------------------------------
export function armarTicket(t, { tildes = false, logo = null } = {}) {
  const r = new Recibo({ tildes });
  if (logo) { r.imagen(logo); r.salto(); }
  r.centrado(t.negocio, { negrita: true });
  if (t.lema) r.centrado(t.lema);
  if (t.direccion) r.centrado(t.direccion);
  if (t.telefono) r.centrado(t.telefono);
  if (t.nit) r.centrado(t.nit);
  if (t.sucursal) r.centrado(t.sucursal, { negrita: true });
  if (t.anulada) {
    r.separador('*');
    r.centrado('*** VENTA ANULADA ***', { negrita: true });
    if (t.anulada.motivo) r.centrado('Motivo: ' + t.anulada.motivo);
    if (t.anulada.por) r.centrado(t.anulada.por);
    r.separador('*');
  }
  r.salto();
  for (const [e, v, op] of t.filas || []) r.fila(e, v, op || {});
  r.separador();
  r.productos(t.items || []);
  r.separador();
  for (const [e, v] of t.subtotales || []) r.fila(e, v);
  if (t.total) {
    const grande = limpiar(t.total[0], tildes).length + 1 + limpiar(t.total[1], tildes).length <= Math.floor(COLS / 2);
    r.fila(t.total[0], t.total[1], grande ? { negrita: true, ancho: 2, alto: 2 } : { negrita: true });
  }
  r.separador();
  for (const [e, v] of t.pagos || []) r.fila(e, v);
  if (t.pie) { r.salto(); r.centrado(t.pie); }
  if (t.firma) { r.salto(); r.centrado(t.firma, { negrita: true }); }
  r.avanzar(4);                                           // papel suficiente para romper el ticket sin comerse el texto
  return r.bytes();
}

// ---------------------------------------------------------------------
// Cuenta para el cliente (todavía sin cobrar)
//   c = { negocio, lema, contacto, sucursal, titulo, subtitulo, filas:[[e,v]], items:[…], total:[e,v], pie }
// ---------------------------------------------------------------------
export function armarCuenta(c, { tildes = false, logo = null } = {}) {
  const r = new Recibo({ tildes });
  if (logo) { r.imagen(logo); r.salto(); }
  r.centrado(c.negocio, { negrita: true });
  if (c.lema) r.centrado(c.lema);
  if (c.contacto) r.centrado(c.contacto);
  if (c.sucursal) r.centrado(c.sucursal, { negrita: true });
  r.separador();
  r.centrado(c.titulo, { negrita: true, alto: 2 });
  if (c.subtitulo) r.centrado(c.subtitulo);
  r.separador();
  for (const [e, v] of c.filas || []) r.fila(e, v);
  r.separador();
  r.productos(c.items || []);
  r.separador();
  if (c.total) {
    const grande = limpiar(c.total[0], tildes).length + 1 + limpiar(c.total[1], tildes).length <= Math.floor(COLS / 2);
    r.fila(c.total[0], c.total[1], grande ? { negrita: true, ancho: 2, alto: 2 } : { negrita: true });
  }
  r.separador();
  if (c.pie) { r.salto(); r.centrado(c.pie); }
  r.avanzar(4);
  return r.bytes();
}

// ---------------------------------------------------------------------
// Enlace para la app RawBT (Android). Los bytes viajan en base64, "tal cual".
// ---------------------------------------------------------------------
export function aBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x2000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x2000));
  return btoa(bin);
}
export function enlaceRawBT(bytes) {
  return 'intent:base64,' + aBase64(bytes) + '#Intent;scheme=rawbt;package=ru.a402d.rawbtprinter;end;';
}

// ---------------------------------------------------------------------
// Logo → puntos blanco y negro (solo en el navegador). El logo es claro sobre fondo negro,
// por eso se invierte: lo claro se imprime y el fondo negro queda en blanco. El umbral (160) deja fuera el
// contorno naranja del logo para que las letras se lean limpias en el papel.
// ---------------------------------------------------------------------
export function logoARaster(url, anchoPuntos = 320, umbral = 160) {
  return new Promise((resolve) => {
    try {
      const img = new Image();
      img.onload = () => {
        try {
          const ancho = Math.floor(anchoPuntos / 8) * 8;
          const alto = Math.max(1, Math.round(img.naturalHeight * ancho / img.naturalWidth));
          const cv = document.createElement('canvas'); cv.width = ancho; cv.height = alto;
          const cx = cv.getContext('2d', { willReadFrequently: true });
          cx.fillStyle = '#000'; cx.fillRect(0, 0, ancho, alto);
          cx.imageSmoothingEnabled = true; cx.imageSmoothingQuality = 'high';
          cx.drawImage(img, 0, 0, ancho, alto);
          const px = cx.getImageData(0, 0, ancho, alto).data;
          const bytesPorFila = ancho / 8;
          const datos = new Uint8Array(bytesPorFila * alto);
          for (let y = 0; y < alto; y++) for (let x = 0; x < ancho; x++) {
            const i = (y * ancho + x) * 4;
            const lum = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
            if (lum > umbral) datos[y * bytesPorFila + (x >> 3)] |= 0x80 >> (x & 7);   // 1 = punto negro en el papel
          }
          resolve({ bytesPorFila, filas: alto, datos });
        } catch (e) { resolve(null); }
      };
      img.onerror = () => resolve(null);
      img.src = url;
    } catch (e) { resolve(null); }
  });
}
