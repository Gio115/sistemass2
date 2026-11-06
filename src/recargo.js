// Recargo por pagar con tarjeta: un porcentaje que se SUMA al total de la cuenta solo cuando se cobra con tarjeta
// (efectivo y transferencia cobran el precio normal). El porcentaje se cambia en Ajustes del negocio; 0 lo apaga.
import { db } from './db.js';

export const RECARGO_TARJETA_POR_DEFECTO = 5;

// Porcentaje vigente (0 a 50). Si el dato no existe o es raro, se usa 0 para no cobrar de más por error.
export function porcentajeRecargoTarjeta() {
  try {
    const fila = db.prepare('SELECT card_surcharge_percent AS p FROM system_settings WHERE id = 1').get();
    const p = Number(fila && fila.p);
    return Number.isFinite(p) && p >= 0 && p <= 50 ? p : 0;
  } catch (e) {
    return 0;
  }
}

// Cuánto se suma a una cuenta de `base` quetzales según cómo paga (redondeado a centavos)
export function recargoPorMetodo(metodo, base) {
  if (metodo !== 'tarjeta') return 0;
  const p = porcentajeRecargoTarjeta();
  if (!(p > 0) || !(base > 0)) return 0;
  return Math.round(base * p + 1e-9) / 100;
}
