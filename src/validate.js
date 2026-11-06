// Utilidades de validación para datos que vienen del cliente.
// Regla: el servidor guarda texto "limpio" pero NO escapa HTML; el escape se hace al mostrarlo (escapeHtml en el frontend).

// Convierte a texto, quita caracteres de control, recorta espacios y limita el largo.
export function cleanText(value, max = 200) {
  if (value === undefined || value === null) return '';
  return String(value).replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, max);
}

// Cantidad de unidades de un producto: entero entre min y max. Devuelve null si no es válida.
export function parseQuantity(value, { min = 1, max = 999 } = {}) {
  const q = typeof value === 'string' ? Number(value.trim()) : Number(value);
  if (!Number.isInteger(q) || q < min || q > max) return null;
  return q;
}
