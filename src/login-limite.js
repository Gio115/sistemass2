// Frena a quien intenta adivinar una contraseña (o se equivoca muchas veces seguidas): después de varios intentos fallidos con el mismo usuario
// desde el mismo aparato/red, el sistema espera unos minutos antes de volver a probar. Todo vive en memoria y está acotado (no crece sin fin).
//  - Un intento correcto borra el contador.
//  - El tope es por usuario + red, así que un cajero que se equivoca no bloquea a los demás.
const INTENTOS = Number(process.env.LOGIN_INTENTOS) || 8;            // fallidos permitidos…
const VENTANA_MS = (Number(process.env.LOGIN_VENTANA_SEG) || 300) * 1000;   // …dentro de este tiempo (5 minutos)
const MAX_ENTRADAS = 2000;

const fallos = new Map();   // "red|usuario" -> [marcas de tiempo de intentos fallidos]

const clave = (ip, usuario) => `${String(ip || '')}|${String(usuario || '').trim().toLowerCase().slice(0, 60)}`;

function recientes(lista, ahora) {
  while (lista.length && ahora - lista[0] > VENTANA_MS) lista.shift();
  return lista;
}

// ¿Está bloqueado ahora? Devuelve los segundos que faltan (0 = puede intentar).
export function segundosDeEspera(ip, usuario) {
  const lista = fallos.get(clave(ip, usuario));
  if (!lista) return 0;
  const ahora = Date.now();
  recientes(lista, ahora);
  if (lista.length < INTENTOS) { if (!lista.length) fallos.delete(clave(ip, usuario)); return 0; }
  return Math.max(1, Math.ceil((VENTANA_MS - (ahora - lista[0])) / 1000));
}

export function anotarFallo(ip, usuario) {
  const k = clave(ip, usuario);
  const ahora = Date.now();
  if (fallos.size >= MAX_ENTRADAS && !fallos.has(k)) {
    for (const [kk, l] of fallos) { recientes(l, ahora); if (!l.length) fallos.delete(kk); }
    if (fallos.size >= MAX_ENTRADAS) fallos.clear();   // alguien está inundando con usuarios inventados: se empieza de cero antes que llenar la memoria
  }
  const lista = fallos.get(k) || [];
  lista.push(ahora);
  if (lista.length > INTENTOS + 2) lista.splice(0, lista.length - (INTENTOS + 2));
  fallos.set(k, lista);
}

export function limpiarFallos(ip, usuario) { fallos.delete(clave(ip, usuario)); }
export function totalEntradas() { return fallos.size; }
