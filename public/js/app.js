import { armarTicket, armarCuenta, enlaceRawBT, logoARaster } from './escpos.js';

// Escapa texto antes de insertarlo en HTML (previene XSS almacenado).
// Úsalo en TODA interpolación de datos de usuario dentro de innerHTML / atributos.
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}


// ---------------------------------------------------
// Utilidades: dinero, fechas y mensajes de error
// ---------------------------------------------------
const PAY_LABELS = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia', mixto: 'Mixto' };
const payLabel = (m) => PAY_LABELS[m] || String(m || '');
const TEXT_SIZE_LABELS = { 'normal': 'Letra normal', 'grande': 'Letra grande', 'muy-grande': 'Letra muy grande' };
// Motivos más comunes al anular una venta (el vendedor toca uno o escribe el suyo)
const VOID_REASONS = ['Error al cobrar', 'El cliente ya no la quiso', 'Producto equivocado', 'Cobro duplicado'];
const plural = (n, one, many) => (Number(n) === 1 ? one : many);
const money = (n) => 'Q ' + (Number(n) || 0).toFixed(2);
// 5 -> "5", 2.5 -> "2.5"
const fmtPercent = (p) => String(Math.round((Number(p) || 0) * 100) / 100);
// Texto del renglón de recargo en el ticket: "Recargo tarjeta 5%:" (el porcentaje sale de lo que realmente se cobró en esa venta)
const ticketRecargoEtiqueta = (t) => {
  const base = (Number(t.subtotal) || 0) - (Number(t.discount) || 0);
  const pct = base > 0 ? Math.round((Number(t.card_surcharge) || 0) / base * 1000) / 10 : 0;
  return pct > 0 ? `Recargo tarjeta ${fmtPercent(pct)}%:` : 'Recargo tarjeta:';
};

// ---------------------------------------------------
// Control de líquidos: botellas, conversiones y conteo
// ---------------------------------------------------
const VOL_ML = { ml: 1, L: 1000, oz: 29.5735 };   // 1 onza líquida = 29.5735 ml
const MASS_G = { g: 1, kg: 1000 };
// En qué medidas se puede decir "cuánto trae cada botella" según cómo se mide el insumo
const packUnitsFor = (unit) => (unit === 'ml' ? ['ml'] : unit in VOL_ML ? ['ml', 'L', 'oz'] : unit === 'g' ? ['g', 'kg'] : [unit]);
const convertAmount = (v, from, to) => {
  if (from === to) return v;
  const t = (from in VOL_ML && to in VOL_ML) ? VOL_ML : (from in MASS_G && to in MASS_G) ? MASS_G : null;
  return t ? (v * t[from]) / t[to] : v;
};
const fmtNum = (n, d = 2) => Number((Number(n) || 0).toFixed(d));   // 25.3600 → 25.36
const fmtBig = (n, d = 2) => fmtNum(n, d).toLocaleString('en-US', { maximumFractionDigits: d });   // 24450 → 24,450
// Dinero con los decimales que hagan falta (el costo de 1 ml es una fracción de centavo): 7.5 → "Q 7.50", 0.015 → "Q 0.015"
const moneyFine = (n) => {
  let t = String(Number((Number(n) || 0).toFixed(6)));
  if (!t.includes('.')) t += '.00'; else if (t.split('.')[1].length < 2) t += '0';
  return 'Q ' + t;
};
// Cuánto cuesta cada unidad del insumo, para la tabla de inventario ("Q 0.015 por ml")
// ¿Tiene sentido ofrecer "Pasar a ml"? Líquidos medidos en piezas, litros u onzas (no las botanas ni los polvos)
const puedeAMl = (item) => ['pza', 'L', 'oz'].includes(item.unit) && !['Botanas', 'Escarchados'].includes(item.category);
const costPerUnitLabel = (item) => (item.unit === 'ml' ? `${moneyFine(item.cost_per_unit)} por ml` : money(item.cost_per_unit));
// Cuánto hay, para la tabla de inventario (24,450 ml sin ceros de más)
const stockLabel = (item) => (item.unit === 'ml' ? fmtBig(item.current_stock, 1) : item.current_stock.toFixed(2));
const packPlural = (w, n) => (Number(n) === 1 ? w : (/[aeiouáéíóú]$/i.test(w) ? w + 's' : w + 'es'));   // botella → botellas, barril → barriles
const cap1 = (t) => String(t || '').charAt(0).toUpperCase() + String(t || '').slice(1);
const UNIT_WORD = { L: 'litro', ml: 'ml', oz: 'oz', g: 'gramo', pza: 'pieza', kg: 'kilo' };
// "3 botellas + 9.5 oz" para un insumo con botella (vacío si no tiene botella o no hay nada)
function packBreakdown(item, qty) {
  const size = Number(item && item.pack_size) || 0;
  if (!(size > 0) || !(qty > 0)) return '';
  let full = Math.floor(qty / size + 1e-9);
  let rest = qty - full * size;
  if (rest < 0.005) rest = 0;
  const name = item.pack_name || 'botella';
  if (full === 0) return `${fmtNum(qty / size)} ${name}`;
  return `${full} ${packPlural(name, full)}` + (rest > 0 ? ` + ${fmtNum(rest)} ${item.unit}` : '');
}
const signedMoney = (n) => (n < 0 ? '−' : n > 0 ? '+' : '') + money(Math.abs(n));

// ---------------------------------------------------
// Dibujos de las bebidas (en vez de emojis)
// Cada producto muestra el dibujo que corresponde a su sección (o, si la sección tiene otro nombre,
// a su nombre). Los dibujos están en public/img/bebidas/*.svg: para poner uno propio basta con
// reemplazar el archivo con el mismo nombre.
// ---------------------------------------------------
const DRINK_EMOJI = { michelada: '🍹', cerveza: '🍺', tarro: '🍺', refresco: '🥤', cola: '🥤', trago: '🥃', botana: '🥜', cigarro: '🚬', general: '🍹' };
const sinTildes = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
function drinkKind(product) {
  const cat = sinTildes(product && product.category_name);
  const name = sinTildes(product && product.name);
  if (/cigarro|tabaco/.test(cat)) return 'cigarro';
  if (/michelada|preparad/.test(cat)) return 'michelada';
  if (/cerveza/.test(cat)) return /tarro|barril|draft|chope|jarra/.test(name) ? 'tarro' : 'cerveza';
  if (/refresco|sin alcohol|jugo|agua|gaseosa/.test(cat)) return /coca|pepsi|\bcola\b/.test(name) ? 'cola' : 'refresco';
  if (/trago|licor|coctel|cocktail|shot/.test(cat)) return 'trago';
  if (/botana|snack|comida|antojito|boquita/.test(cat)) return 'botana';
  // Sección con otro nombre: se adivina por el nombre del producto
  if (/cigarro|tabaco/.test(name)) return 'cigarro';
  if (/michelada|chela|clamato|preparad/.test(name)) return 'michelada';
  if (/tarro|barril|draft|chope/.test(name)) return 'tarro';
  if (/cerveza|corona|victoria|modelo|michelob|gallo(?! pinto)|cabro|moza|dorada|brahva|heineken|budweiser|stella|pilsen/.test(name)) return 'cerveza';
  if (/coca|pepsi|\bcola\b/.test(name)) return 'cola';
  if (/squirt|sprite|fanta|refresco|gaseosa|soda|agua|jugo|limonada|naranjada|te frio|mineral|penafiel/.test(name)) return 'refresco';
  if (/tequila|ron |ron$|vodka|whisky|whiskey|aguardiente|licor|trago|shot|cuba|quetzalteca|zacapa|vino|mezcal|ginebra/.test(name)) return 'trago';
  if (/botana|nacho|cacahuate|\bmani\b|papas|chicharron|tostada|palomita|snack|boquita/.test(name)) return 'botana';
  return 'general';
}
function drinkImageHtml(product) {
  const kind = drinkKind(product);
  const dibujo = `/img/bebidas/${kind}.svg`;
  // Si el administrador subió una foto real del producto, se usa esa; si no, el dibujo
  const foto = product && product.image_v ? `/api/pos/product-image/${Number(product.id)}?v=${Number(product.image_v)}&m=1` : '';   // &m=1: copia chica (carga mucho más rápido)
  return `<img src="${foto || dibujo}"${foto ? ' class="product-photo"' : ''} alt="" width="96" height="96" decoding="async" draggable="false" data-drawing="${dibujo}" data-emoji="${DRINK_EMOJI[kind]}">`;
}

// Prepara la foto que eligió el administrador: la deja cuadrada (máx. 480 px) y la guarda como JPEG liviano (~40–90 KB).
// Si la foto no es cuadrada se muestra completa (sin cortar la botella) y el relleno toma el color de los bordes de la propia foto.
async function fotoAJpegCuadrado(file, lado = 480) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, mal) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => mal(new Error('No se pudo leer la foto'));
      i.src = url;
    });
    const w = img.naturalWidth, h = img.naturalHeight;
    if (!w || !h) throw new Error('No se pudo leer la foto');
    const razon = w / h;
    const c = document.createElement('canvas');
    c.width = c.height = lado;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    if (razon > 0.8 && razon < 1.25) {
      // Casi cuadrada: se recorta el centro
      const m = Math.min(w, h);
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, lado, lado);
      ctx.drawImage(img, (w - m) / 2, (h - m) / 2, m, m, 0, 0, lado, lado);
    } else {
      // Alargada (botella, plato ancho): se muestra completa y el fondo toma el color de los bordes
      const mini = document.createElement('canvas');
      mini.width = mini.height = 16;
      const mctx = mini.getContext('2d');
      mctx.drawImage(img, 0, 0, 16, 16);
      const px = mctx.getImageData(0, 0, 16, 16).data;
      let r = 0, g = 0, b = 0, n = 0;
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        if (x === 0 || y === 0 || x === 15 || y === 15) { const k = (y * 16 + x) * 4; r += px[k]; g += px[k + 1]; b += px[k + 2]; n++; }
      }
      ctx.fillStyle = `rgb(${Math.round(r / n)},${Math.round(g / n)},${Math.round(b / n)})`;
      ctx.fillRect(0, 0, lado, lado);
      const k = Math.min(lado / w, lado / h);
      const dw = w * k, dh = h * k;
      ctx.drawImage(img, (lado - dw) / 2, (lado - dh) / 2, dw, dh);
    }
    let blob = await new Promise(res => c.toBlob(res, 'image/jpeg', 0.85));
    if (blob && blob.size > 250 * 1024) blob = await new Promise(res => c.toBlob(res, 'image/jpeg', 0.7));
    if (!blob || blob.size < 200) throw new Error('No se pudo leer la foto');
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// SQLite guarda las horas en UTC como "2026-10-25 18:30:00" (sin zona).
// Esta función las convierte a la hora correcta de este dispositivo.
function parseDbDate(value) {
  if (!value) return new Date(NaN);
  if (value instanceof Date) return value;
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s)) {
    return new Date(s.replace(' ', 'T') + 'Z');
  }
  return new Date(s);
}
function fmtDateTime(value) {
  const d = parseDbDate(value);
  return isNaN(d) ? '-' : d.toLocaleString('es-GT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
// Fecha corta para el ticket de 58 mm: 28/10/26 18:00
function fmtTicketDate(value) {
  const d = parseDbDate(value);
  if (isNaN(d)) return '-';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${String(d.getFullYear()).slice(-2)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function fmtDate(value) {
  const d = parseDbDate(value);
  return isNaN(d) ? '-' : d.toLocaleDateString('es-GT', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
function fmtTime(value) {
  const d = parseDbDate(value);
  return isNaN(d) ? '-' : d.toLocaleTimeString('es-GT', { hour: '2-digit', minute: '2-digit' });
}

// Convierte errores técnicos en frases que cualquiera entiende
function friendlyError(err) {
  const msg = (err && err.message) ? String(err.message) : String(err || '');
  if ((err && err.name === 'TypeError') || /failed to fetch|networkerror|load failed|network request failed/i.test(msg)) {
    return 'No se pudo conectar con el sistema. Revisa que el internet o el Wi-Fi esté funcionando e inténtalo otra vez.';
  }
  return msg || 'Algo salió mal. Inténtalo otra vez.';
}

// ===================================================
// MICHELADAS EL MISMÍSIMO - CLIENT APP LOGIC
// ===================================================

// Si una foto o un dibujo no se encuentra, se pasa al siguiente: foto -> dibujo -> emoji (nunca una imagen rota).
// (El evento "error" de las imágenes no sube por el documento, por eso se escucha en la fase de captura.)
document.addEventListener('error', (ev) => {
  const img = ev.target;
  if (!(img instanceof HTMLImageElement) || !img.closest('.product-icon, .admin-thumb, .prod-photo-preview')) return;
  if (img.dataset.drawing && img.getAttribute('src') !== img.dataset.drawing) {
    img.classList.remove('product-photo');
    const caja = img.closest('.product-icon');
    if (caja) caja.classList.remove('has-photo');
    img.src = img.dataset.drawing;
    return;
  }
  if (!img.dataset.emoji) return;
  const e = document.createElement('span');
  e.className = 'product-icon-emoji';
  e.textContent = img.dataset.emoji;
  img.replaceWith(e);
}, true);

class MismisimoApp {
  constructor() {
    this.token = localStorage.getItem('mismisimo_token') || null;
    this.currentUser = JSON.parse(localStorage.getItem('mismisimo_user') || 'null');
    this.activeTab = 'pos';
    this.cart = [];
    this.categories = [];
    this.products = [];
    this.inventoryItems = [];
    this.currentShift = null;
    this.hourlyChart = null;
    this.paymentChart = null;
    this.pendingCustomizationProduct = null;
    this.dashboardInterval = null;
    this.settings = null;
    this.tables = [];
    this.activeTable = null;
    this.tableFilterArea = 'all';
    this.tableFilterStatus = 'all';
    this.selectedTableForDetail = null;
    this.textSize = 'normal';
    // Sucursales: lista a la que puede entrar esta persona, la elegida (número, o 'all' = todas juntas, solo administrador)
    this.branches = [];
    this.branchId = null;
    this.multiBranch = false;
    this.applyTextSize(document.documentElement.getAttribute('data-text-size') || 'normal', false);
    this.applyTheme(document.documentElement.getAttribute('data-theme') || 'claro', false);
    const btnTheme = document.getElementById('btnToggleTheme');
    if (btnTheme) btnTheme.onclick = () => this.applyTheme(this.theme === 'oscuro' ? 'claro' : 'oscuro');

    this.init();
  }

  // API helper with authentication token
  // options.key = clave de reintento (el servidor no repite lo que ya hizo con esa clave: un cobro nunca se duplica aunque se toque dos veces)
  async api(endpoint, options = {}) {
    const { key, timeoutMs, ...fetchOptions } = options;
    const headers = {
      'Content-Type': 'application/json',
      ...(this.token ? { 'Authorization': `Bearer ${this.token}` } : {}),
      ...(key ? { 'X-Idempotency-Key': key } : {}),
      ...this.branchHeaders()
    };

    // Si el WiFi se cuelga, la petición no se queda esperando para siempre (el botón se quedaría en "Cobrando…").
    // Las lecturas siempre tienen tiempo máximo; los envíos solo si llevan clave (repetirlos ya no duplica nada).
    const metodo = String(fetchOptions.method || 'GET').toUpperCase();
    const limite = timeoutMs !== undefined ? timeoutMs : (metodo === 'GET' ? 60000 : (key ? 30000 : 0));
    const ctl = limite > 0 && typeof AbortController !== 'undefined' && !fetchOptions.signal ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), limite) : 0;

    try {
      const response = await fetch(endpoint, {
        ...fetchOptions,
        ...(ctl ? { signal: ctl.signal } : {}),
        headers: { ...headers, ...options.headers }
      });

      const data = await response.json().catch(() => ({}));

      // 401 en el login significa "usuario o contraseña mal"; en cualquier otro lado, sesión vencida
      if (response.status === 401 && endpoint !== '/api/auth/login') {
        this.logout({ expired: true });
        throw new Error('Tu sesión se venció. Entra otra vez con tu usuario y contraseña.');
      }

      // Si el administrador le quitó o cambió sus sucursales mientras trabajaba, se vuelve a pedir la lista
      if (response.status === 403 && /sucursal/i.test(data.error || '') && !this._resyncingBranches) {
        this.resyncBranches();
      }

      if (!response.ok) {
        const falla = new Error(data.error || `Algo salió mal (código ${response.status}). Inténtalo otra vez; si sigue igual, avísale al administrador.`);
        if (data.code) falla.code = data.code;
        throw falla;
      }

      // El servidor avisa si esta respuesta es la de un intento anterior con la misma clave (no se volvió a hacer nada)
      if (response.headers && response.headers.get('X-Idempotent-Replay') === '1' && data && typeof data === 'object') {
        try { Object.defineProperty(data, '_repetida', { value: true }); } catch (e) { /* nada */ }
      }
      return data;
    } catch (err) {
      console.error(`API Error [${endpoint}]:`, err);
      if (err && err.name === 'AbortError') {
        const e = new Error(key ? 'El sistema tardó demasiado en responder. Revisa el WiFi y vuelve a intentarlo: si ya se había guardado, no se repite.' : 'El sistema tardó demasiado en responder. Revisa el WiFi e inténtalo otra vez.');
        e.red = true;
        throw e;
      }
      if (err instanceof TypeError) { const e = new Error(friendlyError(err)); e.red = true; throw e; }
      throw err;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  // Clave de reintento: la misma mientras se repita EXACTAMENTE lo mismo (y en los últimos 2 minutos); si algo cambia, una nueva.
  idemKey(nombre, firma) {
    const mapa = this._idem || (this._idem = new Map());
    const ahora = Date.now();
    const actual = mapa.get(nombre);
    if (actual && actual.firma === firma && ahora - actual.t < 120000) return actual.key;
    let id;
    try { const b = new Uint8Array(16); crypto.getRandomValues(b); id = Array.from(b, x => x.toString(16).padStart(2, '0')).join(''); }
    catch (e) { id = (ahora.toString(36) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)).replace(/[^A-Za-z0-9]/g, ''); }
    const key = `${nombre}-${id}`.slice(0, 80);
    mapa.set(nombre, { firma, key, t: ahora });
    return key;
  }
  idemDone(nombre) { if (this._idem) this._idem.delete(nombre); }

  // Avisos: salen arriba al centro, no se repiten y se pueden cerrar tocándolos
  toast(message, type = 'success') {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const text = String(message ?? '').trim();
    if (!text) return;

    const key = `${type}|${text}`;
    const life = type === 'error' ? 8000 : type === 'warning' ? 6000 : 3500;

    const existing = Array.from(container.children).find(t => t.dataset.key === key);
    if (existing) {
      clearTimeout(existing._timer);
      existing.style.opacity = '1';
      existing._timer = setTimeout(() => this.dismissToast(existing), life);
      return;
    }
    while (container.children.length >= 3) container.firstElementChild.remove();

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.dataset.key = key;
    toast.setAttribute('role', type === 'error' ? 'alert' : 'status');

    const icon = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' }[type] || 'ℹ️';
    const iconSpan = document.createElement('span');
    iconSpan.textContent = icon;
    iconSpan.setAttribute('aria-hidden', 'true');
    const msgSpan = document.createElement('span');
    msgSpan.className = 'toast-text';
    msgSpan.textContent = text;
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'toast-close';
    closeBtn.textContent = '✕';
    closeBtn.setAttribute('aria-label', 'Cerrar este aviso');
    closeBtn.onclick = () => this.dismissToast(toast);
    toast.append(iconSpan, msgSpan, closeBtn);

    container.appendChild(toast);
    toast._timer = setTimeout(() => this.dismissToast(toast), life);
  }

  dismissToast(toast) {
    if (!toast || !toast.parentNode) return;
    clearTimeout(toast._timer);
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 250);
  }

  // Pregunta "¿Seguro?" con botones grandes (reemplaza confirm() y prompt() del navegador).
  // Devuelve una promesa: true si dijo que sí, false si no.
  confirmDialog(message, opts = {}) {
    const { title = '¿Estás seguro?', yes = 'Sí', no = 'No, volver', danger = false, typeToConfirm = null } = opts;
    return new Promise(resolve => {
      const modal = document.getElementById('modalConfirm');
      const yesBtn = document.getElementById('btnConfirmYes');
      const noBtn = document.getElementById('btnConfirmNo');
      const wrap = document.getElementById('confirmTypeWrap');
      const input = document.getElementById('confirmTypeInput');
      const msgEl = document.getElementById('confirmMessage');

      document.getElementById('confirmTitle').textContent = title;
      msgEl.textContent = message;
      msgEl.style.whiteSpace = 'pre-line';
      yesBtn.textContent = yes;
      noBtn.textContent = no;
      yesBtn.className = `btn btn-lg ${danger ? 'btn-danger' : 'btn-primary'}`;
      modal.classList.toggle('es-peligro', !!danger);

      const checkTyped = () => {
        yesBtn.disabled = !!typeToConfirm && input.value.trim().toUpperCase() !== String(typeToConfirm).toUpperCase();
      };
      if (typeToConfirm) {
        wrap.style.display = 'block';
        document.getElementById('confirmTypeLabel').textContent = `Para seguir, escribe la palabra ${typeToConfirm}:`;
        input.value = '';
        input.oninput = checkTyped;
      } else {
        wrap.style.display = 'none';
        input.oninput = null;
      }
      checkTyped();

      const finish = (answer) => {
        yesBtn.onclick = null;
        noBtn.onclick = null;
        modal._cancel = null;
        this.closeModal('modalConfirm');
        resolve(answer);
      };
      yesBtn.onclick = () => finish(true);
      noBtn.onclick = () => finish(false);
      modal._cancel = () => finish(false);

      this.openModal('modalConfirm');
      // El foco empieza en "No" para que un Enter accidental no borre nada
      setTimeout(() => (typeToConfirm ? input : noBtn).focus(), 60);
    });
  }

  // Lee un color del tema actual (para las gráficas, que se dibujan en un lienzo y no pueden usar var(--x))
  themeColor(name) {
    try { return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888'; } catch (e) { return '#888'; }
  }

  // Fondo claro (por defecto) u oscuro; se recuerda en cada aparato
  applyTheme(theme, persist = true) {
    if (theme !== 'oscuro') theme = 'claro';
    this.theme = theme;
    document.documentElement.setAttribute('data-theme', theme);
    if (persist) {
      try { localStorage.setItem('mismisimo_theme', theme); } catch (e) { /* sin almacenamiento */ }
    }
    const btn = document.getElementById('btnToggleTheme');
    if (btn) {
      const aOscuro = theme === 'claro';   // el botón ofrece el cambio al otro fondo
      const ico = document.getElementById('themeIco');
      const txt = document.getElementById('themeTxt');
      if (ico) ico.textContent = aOscuro ? '🌙' : '☀️';
      if (txt) txt.textContent = aOscuro ? 'Oscuro' : 'Claro';
      btn.setAttribute('aria-label', aOscuro ? 'Cambiar a fondo oscuro' : 'Cambiar a fondo claro');
      btn.title = aOscuro ? 'Cambiar a fondo oscuro' : 'Cambiar a fondo claro';
    }
    // Las gráficas del Resumen se dibujan con los colores del fondo: se vuelven a pintar
    if (persist && this.currentUser && this.activeTab === 'dashboard' && typeof this.loadDashboardData === 'function') this.loadDashboardData();
  }

  // Tamaño de la letra (normal / grande / muy grande)
  applyTextSize(size, persist = true) {
    if (!TEXT_SIZE_LABELS[size]) size = 'normal';
    this.textSize = size;
    document.documentElement.setAttribute('data-text-size', size);
    if (persist) {
      try { localStorage.setItem('mismisimo_text_size', size); } catch (e) { /* sin almacenamiento */ }
    }
  }

  // Synthetic sound chime for successful sale
  playSaleChime() {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      // Se crea UNA sola vez y se reutiliza: crear uno nuevo en cada cobro es lento en tabletas y los navegadores solo dejan unos pocos abiertos
      const ctx = this._audioCtx || (this._audioCtx = new AudioContext());
      if (ctx.state === 'suspended' && typeof ctx.resume === 'function') ctx.resume().catch(() => {});
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.15); // A5
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.3);
    } catch (e) {
      // Audio not permitted without interaction
    }
  }

  // Espacio para la barra de abajo (total y COBRAR) en celular y tableta de pie.
  // En vez de adivinar cuánto mide, se mide en vivo cuánto tapa la barra de la zona de la pantalla y se deja
  // exactamente ese espacio (variable --bar-reserve). Así no queda un hueco en blanco entre las bebidas y la barra,
  // por ejemplo en el iPhone acostado, donde la altura de la página y la barra fija no miden lo mismo.
  watchBarReserve() {
    const root = document.documentElement;
    let raf = 0;
    const medir = () => {
      raf = 0;
      try {
        const bar = document.querySelector('.tablet-floating-cart-bar');
        const caja = document.getElementById('appView');
        if (!bar || !caja || !bar.getClientRects().length || !caja.getClientRects().length) {
          root.style.removeProperty('--bar-reserve');
          return;
        }
        const tapa = Math.max(0, Math.ceil(caja.getBoundingClientRect().bottom - bar.getBoundingClientRect().top));
        root.style.setProperty('--bar-reserve', tapa + 'px');
      } catch (e) { /* si algo falla, se queda el espacio de siempre */ }
    };
    const pedir = () => { if (!raf) raf = requestAnimationFrame(medir); };
    this._medirBarra = pedir;
    window.addEventListener('resize', pedir);
    window.addEventListener('orientationchange', pedir);
    window.addEventListener('scroll', pedir, { passive: true });
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', pedir);
      window.visualViewport.addEventListener('scroll', pedir);
    }
    if (window.ResizeObserver) {
      const ro = new ResizeObserver(pedir);
      const bar = document.querySelector('.tablet-floating-cart-bar');
      const caja = document.getElementById('appView');
      if (bar) ro.observe(bar);
      if (caja) ro.observe(caja);
    }
    pedir();
  }

  // Initialize application
  async init() {
    this.bindGlobalEvents();
    this.watchBarReserve();
    this.refreshPrintLabels();
    { const pp = this.getPrintPrefs(); if (pp.modo === 'directo' && pp.logo) this.logoListo(); }   // el logo ya queda listo para imprimir

    if (this.token && this.currentUser) {
      try {
        await this.verifySession();
      } catch (err) {
        this.showAuthView();
      }
    } else {
      this.showAuthView();
    }
  }

  async verifySession() {
    const res = await this.api('/api/auth/me');
    this.currentUser = res.user;
    localStorage.setItem('mismisimo_user', JSON.stringify(res.user));
    this.showAppView();
  }

  showAuthView() {
    document.getElementById('authView').style.display = 'flex';
    document.getElementById('appView').style.display = 'none';
    if (this.dashboardInterval) clearInterval(this.dashboardInterval);

    // Pantalla de entrada limpia: sin contraseña escrita ni errores viejos
    const pwd = document.getElementById('loginPassword');
    if (pwd) { pwd.value = ''; pwd.type = 'password'; }
    const showPwd = document.getElementById('loginShowPassword');
    if (showPwd) showPwd.checked = false;
    const loginErr = document.getElementById('loginError');
    if (loginErr) loginErr.style.display = 'none';
  }

  showAppView() {
    document.getElementById('authView').style.display = 'none';
    document.getElementById('appView').style.display = '';

    this.setupBranches();

    // Update user info in header
    const roleBadge = document.getElementById('userRoleBadge');
    roleBadge.textContent = this.currentUser.role === 'admin' ? 'Administrador' : 'Vendedor';
    roleBadge.className = `badge-role ${this.currentUser.role === 'admin' ? 'badge-admin' : 'badge-vendedor'}`;
    
    document.getElementById('userAvatar').textContent = (this.currentUser.full_name || this.currentUser.username)[0].toUpperCase();
    document.getElementById('userFullName').textContent = this.currentUser.full_name || this.currentUser.username;

    // La barra de arriba ya no se oculta (la barra lateral no le quita espacio a las bebidas): se ignora lo que haya guardado
    document.getElementById('appView').classList.remove('header-discrete');
    try { localStorage.removeItem('mismisimo_header_discrete'); } catch (e) { /* sin almacenamiento */ }

    // Enforce role-based tabs:
    // If Vendedor: ONLY allow POS and Shift tabs. Hide all admin reports, margins, costs, and management!
    const isAdmin = this.currentUser.role === 'admin';
    document.getElementById('appView').classList.toggle('is-admin', isAdmin);
    document.getElementById('tabDashboard').style.display = isAdmin ? 'inline-flex' : 'none';
    const tabTables = document.getElementById('tabTables');
    if (tabTables) tabTables.style.display = 'inline-flex';
    document.getElementById('tabInventory').style.display = isAdmin ? 'inline-flex' : 'none';
    document.getElementById('tabProducts').style.display = isAdmin ? 'inline-flex' : 'none';
    document.getElementById('tabSales').style.display = isAdmin ? 'inline-flex' : 'none';
    document.getElementById('tabShifts').style.display = isAdmin ? 'inline-flex' : 'none';
    document.getElementById('tabUsers').style.display = isAdmin ? 'inline-flex' : 'none';
    document.getElementById('tabSettings').style.display = isAdmin ? 'inline-flex' : 'none';
    document.getElementById('tabMyShift').style.display = !isAdmin ? 'inline-flex' : 'none';

    // Default view
    if (isAdmin) {
      this.switchTab('dashboard');
      this.startDashboardPolling();
    } else {
      this.switchTab('pos');
    }

    this.refreshBranchData({ menuYaPedido: !isAdmin && typeof this.branchId === 'number' });
  }

  startDashboardPolling() {
    if (this.dashboardInterval) clearInterval(this.dashboardInterval);
    // Poll every 25 seconds for real-time worldwide monitoring
    this.dashboardInterval = setInterval(() => {
      // No se pide nada si la pantalla no se está viendo (otra pestaña del navegador, aparato dormido) ni si la petición anterior sigue en camino
      // (con WiFi lento se amontonaban y gastaban internet sin que nadie las viera).
      if (document.hidden || this._dashBusy) return;
      if (this.activeTab === 'dashboard' && this.currentUser && this.currentUser.role === 'admin') {
        this._dashBusy = true;
        Promise.resolve(this.loadDashboardData()).finally(() => { this._dashBusy = false; });
      }
    }, 25000);
  }

  // Switch tabs
  // Menú desplegable de pantallas (solo se ve en tabletas bajitas; en las demás las pestañas están siempre a la vista)
  toggleNavMenu(force) {
    const nav = document.getElementById('navTabs');
    const btn = document.getElementById('btnNavMenu');
    if (!nav) return;
    const open = typeof force === 'boolean' ? force : !nav.classList.contains('nav-open');
    nav.classList.toggle('nav-open', open);
    if (btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  switchTab(tabId) {
    // "Mi caja" no es una pantalla: solo abre el cuadro de la caja y deja todo como estaba
    if (tabId === 'myShift') {
      this.openShiftModal();
      return;
    }

    // Seguridad: el vendedor solo puede vender y ver mesas
    if (this.currentUser.role === 'vendedor' && !['pos', 'tables'].includes(tabId)) {
      this.toast('Esta sección es solo para el administrador.', 'warning');
      tabId = 'pos';
    }

    this.activeTab = tabId;
    this.toggleNavMenu(false);
    document.body.setAttribute('data-tab', tabId);
    if (this._payMode) this.setPayMode(false);

    // Update active nav button
    document.querySelectorAll('.nav-tab-btn').forEach(btn => {
      if (btn.dataset.tab === tabId) {
        const lbl = document.getElementById('navMenuLabel');
        const txt = btn.querySelector('.tab-txt');
        if (lbl && txt) lbl.textContent = txt.textContent.trim();
        btn.classList.add('active');
        btn.setAttribute('aria-current', 'page');
      } else {
        btn.classList.remove('active');
        btn.removeAttribute('aria-current');
      }
    });

    // Toggle content views
    document.querySelectorAll('.tab-content').forEach(section => {
      section.style.display = 'none';
    });

    const mainView = document.querySelector('.main-view');
    if (mainView) mainView.scrollTop = 0;

    this.updateScopeChips();

    // Vender, Mesas e Inventario son de UNA sucursal: si están viendo "Ambas" (o no tienen sucursal), se pide elegir
    if (['pos', 'tables', 'inventory'].includes(tabId) && typeof this.branchId !== 'number') {
      this.showBranchGate(tabId);
      return;
    }

    if (tabId === 'dashboard') {
      document.getElementById('viewDashboard').style.display = 'block';
      this.loadDashboardData();
    } else if (tabId === 'pos') {
      document.getElementById('viewPos').style.display = 'block';
      this.loadCatalog();
    } else if (tabId === 'tables') {
      document.getElementById('viewTables').style.display = 'block';
      this.loadTables();
    } else if (tabId === 'inventory') {
      document.getElementById('viewInventory').style.display = 'block';
      this.loadInventory();
    } else if (tabId === 'products') {
      document.getElementById('viewProducts').style.display = 'block';
      this.loadAdminProducts();
    } else if (tabId === 'sales') {
      document.getElementById('viewSales').style.display = 'block';
      this.loadSalesHistory();
    } else if (tabId === 'shifts') {
      document.getElementById('viewShifts').style.display = 'block';
      this.loadShiftsHistory();
    } else if (tabId === 'users') {
      document.getElementById('viewUsers').style.display = 'block';
      this.loadUsers();
    } else if (tabId === 'settings') {
      document.getElementById('viewSettings').style.display = 'block';
      this.loadSettings();
    }
  }

  // Check active shift
  async checkCurrentShift() {
    if (typeof this.branchId !== 'number') {
      this.currentShift = null;
      this.paintShiftStatus(null);
      return;
    }
    try {
      const res = await this.api('/api/pos/shift/current');
      this.currentShift = res.active ? res.shift : null;
      this.paintShiftStatus(!!res.active);
    } catch (e) {
      console.error(e);
    }
  }

  // isOpen: true / false, o null cuando no hay una sucursal elegida (se ven todas juntas)
  paintShiftStatus(isOpen) {
    const neutral = isOpen === null;
    const dotChar = neutral ? '⚪' : isOpen ? '🟢' : '🔴';
    const label = neutral ? 'Elige sucursal' : isOpen ? 'Caja abierta' : 'Caja cerrada';

    document.getElementById('shiftStatusDot').textContent = dotChar;
    document.getElementById('shiftStatusText').textContent = label;

    const btn = document.getElementById('btnShiftStatus');
    if (btn) {
      btn.classList.toggle('caja-abierta', isOpen === true);
      btn.classList.toggle('caja-cerrada', isOpen === false);
    }

    const discreteDot = document.getElementById('discreteShiftDot');
    const discreteText = document.getElementById('discreteShiftText');
    if (discreteDot && discreteText) {
      discreteDot.textContent = dotChar;
      discreteText.textContent = label;
    }

    // Aviso grande en "Vender" cuando la caja está cerrada
    const banner = document.getElementById('posShiftBanner');
    if (banner) banner.style.display = isOpen === true ? 'none' : 'flex';
  }

  // ===================================================
  // SUCURSALES
  // ===================================================
  // Cabecera que se manda en cada petición: el servidor la revisa siempre (nunca se fía de ella).
  branchHeaders() {
    return this.branchId === null || this.branchId === undefined ? {} : { 'X-Branch-Id': String(this.branchId) };
  }

  // Nombre de lo que se está viendo: una sucursal o "Ambas"
  branchScopeName() {
    if (this.branchId === 'all') return this.branches.length === 2 ? 'Ambas sucursales' : 'Todas las sucursales';
    const b = this.branches.find(x => x.id === this.branchId);
    return b ? b.name : '';
  }

  // Al entrar: qué sucursales tiene esta persona y cuál usa. Se acuerda de la última que usó en este aparato.
  setupBranches() {
    const u = this.currentUser || {};
    const isAdmin = u.role === 'admin';
    this.branches = Array.isArray(u.branches) ? u.branches : [];
    this.multiBranch = Math.max(Number(u.total_branches) || 0, this.branches.length) > 1;

    let saved = null;
    try { saved = localStorage.getItem('mismisimo_branch'); } catch (e) { /* sin almacenamiento */ }
    if (saved === 'all' && isAdmin && this.branches.length > 1) {
      this.branchId = 'all';
    } else if (saved && this.branches.some(b => String(b.id) === saved)) {
      this.branchId = Number(saved);
    } else {
      this.branchId = this.branches.length ? this.branches[0].id : null;
    }
    this.renderBranchPickers();
  }

  renderBranchPickers() {
    const isAdmin = this.currentUser && this.currentUser.role === 'admin';
    const showSelect = this.branches.length > 1;
    const showChip = !showSelect && this.multiBranch && this.branches.length === 1;

    document.body.classList.toggle('multi-branch', this.multiBranch);
    // Pasar mercadería entre tiendas: solo el administrador, y solo si hay más de una tienda
    const puedePasar = !!isAdmin && this.branches.length > 1;
    for (const id of ['btnTransfer', 'btnTransfersHistory']) { const b = document.getElementById(id); if (b) b.hidden = !puedePasar; }
    const app = document.getElementById('appView');
    if (app) { app.classList.toggle('has-picker', showSelect || showChip); app.classList.toggle('has-select', showSelect); }

    const options = this.branches.map(b => `<option value="${b.id}">${escapeHtml(b.name)}</option>`);
    if (isAdmin && showSelect) {
      options.push(`<option value="all">${this.branches.length === 2 ? 'Ambas sucursales' : 'Todas las sucursales'}</option>`);
    }

    for (const [pickerId, selectId, chipId, nameId] of [
      ['branchPicker', 'branchSelect', 'branchChip', 'branchChipName'],
      ['branchPickerDiscrete', 'branchSelectDiscrete', 'branchChipDiscrete', 'branchChipNameDiscrete']
    ]) {
      const picker = document.getElementById(pickerId);
      const select = document.getElementById(selectId);
      const chip = document.getElementById(chipId);
      if (!picker || !select || !chip) continue;
      picker.style.display = (showSelect || showChip) ? 'inline-flex' : 'none';
      select.style.display = showSelect ? '' : 'none';
      select.innerHTML = options.join('');
      select.value = String(this.branchId);
      chip.style.display = showChip ? 'inline-flex' : 'none';
      const nameEl = document.getElementById(nameId);
      if (nameEl) nameEl.textContent = this.branches[0] ? this.branches[0].name : '';
      const label = picker.querySelector('.branch-picker-label');
      if (label) label.style.display = showSelect ? '' : 'none';
    }
    this.updateScopeChips();
  }

  // Etiqueta junto al título de cada pantalla del administrador: "🏬 VIP entre amigos" o "🏬 Ambas sucursales"
  updateScopeChips() {
    const text = this.branchId === null ? '' : `🏬 ${this.branchScopeName()}`;
    document.querySelectorAll('[data-scope-chip]').forEach(el => { el.textContent = text; });
  }

  // Después de cambiar de sucursal (o de entrar): lo que depende de la sucursal se vuelve a pedir
  refreshBranchData(opciones = {}) {
    if (typeof this.branchId === 'number') {
      this.checkCurrentShift();
      if (!opciones.menuYaPedido) this.loadCatalog();   // al entrar, Vender ya pidió el menú: no se pide dos veces
    } else {
      this.checkCurrentShift(); // deja la caja en gris
    }
  }

  async changeBranch(value) {
    const next = value === 'all' ? 'all' : Number(value);
    if (next === this.branchId) return;

    const unsaved = (this.cart || []).some(i => !i.is_existing);
    if (unsaved || this.activeTable) {
      const ok = await this.confirmDialog(
        'Tienes un pedido en pantalla. Si cambias de sucursal, el pedido se quita de la pantalla (lo que ya estaba guardado en una mesa se conserva en su sucursal).',
        { title: '¿Cambiar de sucursal?', yes: 'Sí, cambiar', no: 'No, quedarme aquí', danger: true }
      );
      if (!ok) { this.renderBranchPickers(); return; }
    }

    this.applyBranch(next);
    this.toast(`🏬 Ahora estás en: ${this.branchScopeName()}.`);
  }

  applyBranch(next) {
    this.branchId = next;
    try {
      if (next === null) localStorage.removeItem('mismisimo_branch');
      else localStorage.setItem('mismisimo_branch', String(next));
    } catch (e) { /* sin almacenamiento */ }

    // Todo lo de la sucursal anterior se descarta para no mezclar existencias, mesas ni cajas
    if (this._payMode) this.setPayMode(false);
    this.clearActiveTable();
    this.closeCartDrawer();
    this.tables = [];
    this.products = [];
    this.inventoryItems = [];
    this.currentShift = null;

    this.renderBranchPickers();
    this.refreshBranchData();
    this.switchTab(this.activeTab);
  }

  // Pantalla "Elige una sucursal"
  showBranchGate(tabId) {
    const gate = document.getElementById('viewBranchGate');
    if (!gate) return;
    const title = document.getElementById('branchGateTitle');
    const text = document.getElementById('branchGateText');
    const buttons = document.getElementById('branchGateButtons');
    const names = { pos: 'vender', tables: 'ver las mesas', inventory: 'ver el inventario' };

    if (this.branches.length === 0) {
      title.textContent = 'Todavía no tienes una sucursal';
      text.textContent = 'Avisa al administrador para que te asigne la sucursal donde vas a trabajar.';
      buttons.innerHTML = '';
    } else {
      title.textContent = 'Elige una sucursal';
      text.textContent = `Ahora estás viendo todas las sucursales juntas. Para ${names[tabId] || 'seguir'} tienes que elegir una:`;
      buttons.innerHTML = this.branches.map(b =>
        `<button type="button" class="btn btn-primary btn-lg" data-branch-pick="${b.id}">🏬 ${escapeHtml(b.name)}</button>`
      ).join('');
      buttons.querySelectorAll('[data-branch-pick]').forEach(btn => {
        btn.onclick = () => this.changeBranch(btn.dataset.branchPick);
      });
    }
    gate.style.display = 'block';
  }

  // El servidor dijo que ya no puede usar esa sucursal: se pide otra vez la lista y se acomoda todo
  async resyncBranches() {
    if (this._resyncingBranches || !this.token) return;
    this._resyncingBranches = true;
    try {
      const res = await fetch('/api/auth/me', { headers: { 'Authorization': `Bearer ${this.token}` } });
      if (!res.ok) return;
      const data = await res.json();
      this.currentUser = data.user;
      try { localStorage.setItem('mismisimo_user', JSON.stringify(data.user)); } catch (e) { /* sin almacenamiento */ }
      this.setupBranches();
      this.applyBranch(this.branchId);
    } catch (e) {
      console.error(e);
    } finally {
      setTimeout(() => { this._resyncingBranches = false; }, 3000);
    }
  }

  // ===================================================
  // DASHBOARD MODULE (REAL-TIME METRICS)
  // ===================================================
  async loadDashboardData() {
    try {
      const data = await this.api('/api/admin/dashboard');
      const m = data.metrics;

      document.getElementById('kpiTodayRevenue').textContent = money(m.today_revenue);
      document.getElementById('kpiTodayOrders').textContent = `${m.today_orders} ${plural(m.today_orders, 'venta', 'ventas')} hoy`;
      document.getElementById('kpiNetProfit').textContent = money(m.net_profit_today);
      document.getElementById('kpiAverageTicket').textContent = money(m.average_ticket);
      document.getElementById('kpiMonthRevenue').textContent = money(m.month_revenue);
      document.getElementById('kpiMonthOrders').textContent = `${m.month_orders} ${plural(m.month_orders, 'venta', 'ventas')} en el mes`;
      const voidedEl = document.getElementById('kpiVoidedToday');
      if (voidedEl) {
        const n = Number(m.voided_today_count) || 0;
        voidedEl.style.display = n > 0 ? '' : 'none';
        voidedEl.textContent = n > 0 ? `🚫 ${n} ${plural(n, 'venta anulada', 'ventas anuladas')} hoy (${money(m.voided_today_total)}), no cuentan arriba` : '';
      }

      this.renderHourlyChart(data.hourlyData);
      this.renderPaymentChart(data.paymentMethods);
      this.renderDashboardLowStock(data.lowStockAlerts, !!(data.scope && data.scope.all));
      this.renderDashboardTopProducts(data.topProducts);
    } catch (err) {
      this.toast('No se pudo actualizar el resumen. ' + friendlyError(err), 'error');
    }
  }

  // Las gráficas usan Chart.js, que está guardado en el propio sistema (/js/vendor).
  // Solo se descarga cuando el administrador abre el Resumen: el vendedor nunca lo necesita.
  ensureChartJs() {
    if (typeof Chart !== 'undefined') return Promise.resolve(true);
    if (!this._chartPromise) {
      this._chartPromise = new Promise(resolve => {
        const s = document.createElement('script');
        s.src = '/js/vendor/chart.umd.js';
        s.onload = () => resolve(typeof Chart !== 'undefined');
        s.onerror = () => { this._chartPromise = null; resolve(false); };
        document.head.appendChild(s);
      });
    }
    return this._chartPromise;
  }

  async renderHourlyChart(hourlyData) {
    const ctx = document.getElementById('chartHourlySales');
    if (!ctx || !(await this.ensureChartJs())) return;

    const labels = hourlyData.map(h => h.hour);
    const revenues = hourlyData.map(h => h.revenue);

    if (this.hourlyChart) {
      this.hourlyChart.destroy();
    }

    this.hourlyChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels.length ? labels : ['Todavía no hay ventas hoy'],
        datasets: [{
          label: 'Ventas por hora (Q)',
          data: revenues.length ? revenues : [0],
          borderColor: '#f59e0b',
          backgroundColor: 'rgba(245, 158, 11, 0.15)',
          fill: true,
          tension: 0.35,
          pointBackgroundColor: '#fbbf24',
          pointRadius: 5
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false }
        },
        scales: {
          x: { grid: { color: this.themeColor('--chart-grid') }, ticks: { color: this.themeColor('--chart-text'), font: { size: 14 } } },
          y: { grid: { color: this.themeColor('--chart-grid') }, ticks: { color: this.themeColor('--chart-text'), font: { size: 14 } } }
        }
      }
    });
  }

  async renderPaymentChart(methods) {
    const ctx = document.getElementById('chartPaymentMethods');
    if (!ctx || !(await this.ensureChartJs())) return;

    const labels = methods.map(m => payLabel(m.payment_method));
    const amounts = methods.map(m => m.total);

    if (this.paymentChart) {
      this.paymentChart.destroy();
    }

    this.paymentChart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: labels.length ? labels : ['Todavía no hay ventas'],
        datasets: [{
          data: amounts.length ? amounts : [1],
          backgroundColor: amounts.length ? ['#10b981', '#3b82f6', '#f59e0b', '#8b5cf6'] : ['#475569'],
          borderWidth: 0
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { color: this.themeColor('--text-primary'), font: { family: 'Outfit', size: 15 }, padding: 14 } }
        }
      }
    });
  }

  renderDashboardLowStock(alerts, showBranch = false) {
    const container = document.getElementById('dashboardLowStockList');
    if (!alerts || alerts.length === 0) {
      container.innerHTML = '<p style="color: var(--ok-text); font-size: 1.05rem; font-weight: 600; padding: 1rem 0;">✅ Todo en orden: no se está acabando nada.</p>';
      return;
    }

    container.innerHTML = alerts.map(item => `
      <div style="display: flex; justify-content: space-between; align-items: center; gap: 0.75rem; flex-wrap: wrap; padding: 0.7rem 0; border-bottom: 1px solid var(--border-color);">
        <div>
          <strong style="color: var(--text-primary); font-size: 1.05rem;">${escapeHtml(item.name)}</strong>
          <div class="help-text">${escapeHtml(item.category)}${showBranch && item.branch_name ? ` · 🏬 ${escapeHtml(item.branch_name)}` : ''}</div>
        </div>
        <div style="text-align: right;">
          <span class="badge-status critical">Quedan ${item.current_stock.toFixed(1)} ${escapeHtml(item.unit)}</span>
          <div class="help-text">Avisar si baja de ${item.min_stock} ${escapeHtml(item.unit)}</div>
        </div>
      </div>
    `).join('');
  }

  renderDashboardTopProducts(top) {
    const container = document.getElementById('dashboardTopProductsList');
    if (!top || top.length === 0) {
      container.innerHTML = '<p class="help-text" style="padding: 1rem 0;">Todavía no hay ventas.</p>';
      return;
    }

    container.innerHTML = top.map((p, idx) => `
      <div style="display: flex; justify-content: space-between; align-items: center; gap: 0.75rem; padding: 0.7rem 0; border-bottom: 1px solid var(--border-color);">
        <div style="display: flex; align-items: center; gap: 0.6rem;">
          <span style="font-weight: 800; color: var(--accent-amber); min-width: 2rem;">#${idx + 1}</span>
          <span style="font-weight: 700; font-size: 1.05rem;">${escapeHtml(p.product_name)}</span>
        </div>
        <div style="text-align: right;">
          <strong style="color: var(--text-primary);">${p.total_quantity} ${plural(p.total_quantity, 'vendido', 'vendidos')}</strong>
          <div style="color: var(--accent-text);">${money(p.total_revenue)}</div>
        </div>
      </div>
    `).join('');
  }

  // ===================================================
  // POS MODULE (PUNTO DE VENTA)
  // ===================================================
  async loadCatalog() {
    try {
      const data = await this.api('/api/pos/catalog');
      this.categories = data.categories;
      this.products = data.products;
      if (data.settings) this.settings = data.settings;

      this.renderCategoryPills();
      this.renderProductGrid();
    } catch (err) {
      this.toast('No se pudo cargar el menú. ' + friendlyError(err), 'error');
    }
  }

  renderCategoryPills() {
    const container = document.getElementById('posCategoryPills');
    let html = `<button class="cat-pill active" data-cat="all">⭐ Todo</button>`;
    for (const c of this.categories) {
      html += `<button class="cat-pill" data-cat="${c.id}">${escapeHtml(c.icon)} ${escapeHtml(c.name)}</button>`;
    }
    container.innerHTML = html;

    container.querySelectorAll('.cat-pill').forEach(btn => {
      btn.onclick = () => {
        container.querySelectorAll('.cat-pill').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.renderProductGrid(btn.dataset.cat, document.getElementById('posSearchInput').value);
      };
    });
  }

  renderProductGrid(categoryId = 'all', searchQuery = '') {
    const container = document.getElementById('posProductsGrid');
    const query = searchQuery.trim().toLowerCase();

    let filtered = this.products.filter(p => {
      const matchCat = categoryId === 'all' || p.category_id == categoryId;
      const matchQuery = !query || p.name.toLowerCase().includes(query) || (p.description && p.description.toLowerCase().includes(query));
      return matchCat && matchQuery;
    });

    if (filtered.length === 0) {
      const menuEmpty = this.products.length === 0;
      const isAdmin = this.currentUser && this.currentUser.role === 'admin';
      container.innerHTML = `
        <div class="empty-state" style="grid-column: 1 / -1;">
          <div class="empty-icon">${menuEmpty ? '📋' : '🔍'}</div>
          <p>${menuEmpty ? 'Todavía no hay productos en el menú' : 'No encontramos ningún producto con ese nombre'}</p>
          <span>${menuEmpty
            ? (isAdmin ? 'Entra a “Menú” y toca “Agregar un producto”.' : 'Avísale al administrador para que agregue los productos.')
            : 'Borra lo que escribiste arriba, o elige otra sección.'}</span>
        </div>
      `;
      return;
    }

    // Tarjeta simple: foto, nombre y precio. Sin descripción ni avisos de existencias (eso se ve en Inventario y en el Resumen).
    container.innerHTML = filtered.map(p => {
      const opts = Array.isArray(p.options) ? p.options : [];
      const hasCustomization = !p.is_direct_sale && p.category_name && (p.category_name.includes('Michelada') || p.category_name.includes('Preparados'));
      const sinStock = !!p.sin_stock;   // sin existencias en esta tienda: no se puede vender

      return `
        <div class="product-card${opts.length ? ' has-options' : ''}${sinStock ? ' sin-stock' : ''}" data-id="${p.id}" role="button" tabindex="0"${sinStock ? ' aria-disabled="true"' : ''}${p.description ? ` title="${escapeHtml(p.description)}"` : ''} aria-label="${sinStock ? `${escapeHtml(p.name)}: sin stock, no se puede vender` : `Agregar ${escapeHtml(p.name)}, ${p.price.toFixed(2)} quetzales${opts.length ? `. Se elige: ${escapeHtml(opts.map(o => o.label).join(' o '))}` : ''}`}">
          <div class="product-card-header">
            <div class="product-icon${p.image_v ? ' has-photo' : ''}" aria-hidden="true">${drinkImageHtml(p)}</div>
            <div class="product-name">${escapeHtml(p.name)}</div>
          </div>
          <div class="product-footer">
            <span class="product-price">Q ${p.price.toFixed(2)}</span>
          </div>
          ${hasCustomization && !sinStock ? `
            <button type="button" class="btn btn-secondary btn-sm btn-cust-trigger" data-cust-id="${p.id}" title="Elegir el escarchado y el nivel de salsa antes de agregar" aria-label="Elegir escarchado y salsa para ${escapeHtml(p.name)}">
              <span aria-hidden="true">✏️</span><span class="cust-trigger-text"> Elegir escarchado y salsa</span>
            </button>
          ` : ''}
          <span class="card-qty" aria-hidden="true"></span>
          ${sinStock ? '<div class="product-nostock" aria-hidden="true">Sin stock</div>' : ''}
          <div class="product-added" aria-hidden="true">✓ Agregado</div>
        </div>
      `;
    }).join('');
    this.updateCardQty();

    // Un toque sobre la tarjeta agrega 1 al pedido
    const addFromCard = (card) => {
      const prodId = parseInt(card.dataset.id, 10);
      const prod = this.products.find(p => p.id === prodId);
      if (!prod) return;
      if (prod.sin_stock) {
        this.toast(`«${prod.name}» no tiene stock en esta tienda.` + (prod.falta ? ` Falta: ${prod.falta}.` : ''), 'warning');
        return;
      }
      if (Array.isArray(prod.options) && prod.options.length > 0) {
        // Primero el cliente elige (vidrio / lata...); recién entonces se agrega al pedido
        this.openOptionModal(prod, card);
        return;
      }
      if (this.addToCart(prod) === false) return;
      card.classList.add('just-added');
      setTimeout(() => card.classList.remove('just-added'), 450);
      try { if (navigator.vibrate) navigator.vibrate(25); } catch (e) { /* no pasa nada */ }
    };

    container.querySelectorAll('.product-card').forEach(card => {
      card.onclick = (e) => {
        if (e.target.closest('.btn-cust-trigger')) return; // Se tocó el botón de personalizar
        addFromCard(card);
      };
      card.onkeydown = (e) => {
        if (e.target !== card) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          addFromCard(card);
        }
      };
    });

    // Botón de personalizar dentro de la tarjeta
    container.querySelectorAll('.btn-cust-trigger').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const prodId = parseInt(btn.dataset.custId, 10);
        const prod = this.products.find(p => p.id === prodId);
        if (prod && prod.sin_stock) {
          this.toast(`«${prod.name}» no tiene stock en esta tienda.`, 'warning');
        } else if (prod) {
          this.openCustomizationModal(prod);
        }
      };
    });
  }

  openCustomizationModal(prod) {
    this.pendingCustomizationProduct = prod;
    document.getElementById('custModalTitle').textContent = `Personalizar: ${prod.name}`;

    // Populate escarchados dynamically from settings
    const escarchadosStr = this.settings?.escarchados || 'Chamoy con Tajín, Chamoy con Miguelito, Ajonjolí Acaramelado, Solo Sal y Limón';
    const escarchadosList = escarchadosStr.split(',').map(s => s.trim()).filter(Boolean);
    const escContainer = document.getElementById('custEscarchadoList');
    if (escContainer) {
      escContainer.innerHTML = escarchadosList.map((esc, idx) => `
        <label class="option-card">
          <input type="radio" name="custEscarchado" value="${escapeHtml(esc)}" ${idx === 0 ? 'checked' : ''}>
          <span>${escapeHtml(esc)}</span>
        </label>
      `).join('');
    }

    // Populate salsas dynamically from settings
    const salsasStr = this.settings?.salsas || 'Normal de la Casa, Suave / Poco picante, Bien cargado de salsas, Sin salsas';
    const salsasList = salsasStr.split(',').map(s => s.trim()).filter(Boolean);
    const sauceSelect = document.getElementById('custSauceLevel');
    if (sauceSelect) {
      sauceSelect.innerHTML = salsasList.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
    }

    // Si el producto tiene presentaciones (vidrio / lata...), el cliente también elige aquí (sin ninguna marcada de antemano)
    const opts = Array.isArray(prod.options) ? prod.options : [];
    const optGroup = document.getElementById('custOptionGroup');
    if (optGroup) {
      optGroup.style.display = opts.length ? '' : 'none';
      document.getElementById('custOptionList').innerHTML = opts.map(o => `
        <label class="option-card${o.sin_stock ? ' sin-stock' : ''}">
          <input type="radio" name="custOption" value="${Number(o.id)}"${o.sin_stock ? ' disabled' : ''}>
          <span>${escapeHtml(o.label)} ${this.optionStockHtml(o)}</span>
        </label>
      `).join('');
    }

    document.getElementById('custExtraNotes').value = '';
    this.openModal('modalCustomization');
  }

  // "Quedan 24" / "¡Se acabó!" junto a cada presentación
  optionStockHtml(o) {
    const s = Number(o.stock);
    if (!Number.isFinite(s)) return '';
    if (s <= 0) return '<small class="opt-stock low">¡Se acabó!</small>';
    return `<small class="opt-stock">Quedan ${s}</small>`;
  }

  // Cuadro "¿Cuál quiere el cliente?": un botón grande por presentación
  openOptionModal(prod, card = null) {
    this._optionProduct = prod;
    this._optionCard = card;
    document.getElementById('optProductName').textContent = prod.name;
    const list = document.getElementById('optChoices');
    const todoEnPedido = (o) => !o.sin_stock && o.max_venta !== null && o.max_venta !== undefined && this.cantidadEnPedido(prod, o) >= o.max_venta;
    list.innerHTML = prod.options.map(o => `
      <button type="button" class="opt-choice${o.sin_stock || todoEnPedido(o) ? ' sin-stock' : ''}" data-opt-id="${Number(o.id)}"${o.sin_stock || todoEnPedido(o) ? ' disabled aria-disabled="true"' : ''}>
        <span class="opt-choice-label">${escapeHtml(o.label)}</span>
        ${todoEnPedido(o) ? '<small class="opt-stock low">Ya está todo en el pedido</small>' : this.optionStockHtml(o)}
      </button>
    `).join('');
    list.querySelectorAll('.opt-choice').forEach(btn => {
      btn.onclick = () => {
        const option = prod.options.find(o => o.id === Number(btn.dataset.optId));
        if (!option) return;
        if (this.addToCart(prod, '', option) === false) return;
        this.closeModal('modalOption');
        const c = this._optionCard;
        if (c && document.contains(c)) {
          c.classList.add('just-added');
          setTimeout(() => c.classList.remove('just-added'), 450);
        }
        try { if (navigator.vibrate) navigator.vibrate(25); } catch (e) { /* no pasa nada */ }
        this._optionProduct = null; this._optionCard = null;
      };
    });
    this.openModal('modalOption');
  }

  handleProductClick(productId) {
    const prod = this.products.find(p => p.id === productId);
    if (!prod) return;
    if (Array.isArray(prod.options) && prod.options.length > 0) { this.openOptionModal(prod); return; }
    this.addToCart(prod);
  }

  // Cuántos de este producto (y esta presentación) ya van en el pedido
  cantidadEnPedido(product, option) {
    const optionId = option ? Number(option.id) : null;
    return (this.cart || [])
      .filter(i => !i.is_existing && i.product_id === product.id && (i.option_id || null) === optionId)
      .reduce((n, i) => n + (Number(i.quantity) || 0), 0);
  }

  // ¿Se puede agregar uno más de esto al pedido? Se revisa con lo que dijo el servidor al cargar el menú; el servidor lo vuelve a revisar al cobrar.
  puedeAgregar(product, option) {
    const info = option || product;
    const nombre = option ? `${product.name} (${option.label})` : product.name;
    if (info && info.sin_stock) {
      this.toast(`«${nombre}» no tiene stock en esta tienda.`, 'warning');
      return false;
    }
    const max = info ? info.max_venta : null;
    if (max !== null && max !== undefined) {
      const enPedido = this.cantidadEnPedido(product, option);
      if (enPedido + 1 > max) {
        this.toast(`De «${nombre}» solo ${max === 1 ? 'queda 1' : 'quedan ' + max}.`, 'warning');
        return false;
      }
    }
    return true;
  }

  addToCart(product, customization = '', option = null) {
    if (!this.puedeAgregar(product, option)) return false;
    const optionId = option ? Number(option.id) : null;
    // Si ya hay uno igual en el pedido (mismo producto, misma presentación y mismo escarchado), solo sube la cantidad.
    // Lo que ya está guardado en la cuenta de una mesa nunca se junta con lo nuevo.
    const existingIndex = this.cart.findIndex(i => !i.is_existing && i.product_id === product.id && i.customization === customization && (i.option_id || null) === optionId);

    if (existingIndex >= 0) {
      this.cart[existingIndex].quantity += 1;
      this.cart[existingIndex].subtotal = this.cart[existingIndex].quantity * product.price;
    } else {
      this.cart.push({
        product_id: product.id,
        product_name: product.name,
        unit_price: product.price,
        quantity: 1,
        subtotal: product.price,
        customization: customization,
        option_id: optionId,
        option_label: option ? option.label : ''
      });
    }

    this.renderCart();
    return true;
  }

  // Lo que se ve debajo del nombre en el pedido: "Gallo de lata · Escarchado: …" (igual que quedará en la comanda y el ticket)
  cartItemNote(item) {
    return item.option_label ? (item.customization ? `${item.option_label} · ${item.customization}` : item.option_label) : (item.customization || '');
  }

  renderCart() {
    if (this._payMode) this.setPayMode(false); // el pedido cambió: se vuelve al pedido para que el total del cobro nunca quede viejo
    const container = document.getElementById('posCartList');
    const checkoutBtn = document.getElementById('btnPosCheckout');
    const totalElem = document.getElementById('posCartTotal');
    const checkoutTotalElem = document.getElementById('btnPosCheckoutTotal');
    const tabletBadge = document.getElementById('tabletCartBadge');
    const tabletTotal = document.getElementById('tabletFloatingTotal');
    const tabletPayBtn = document.getElementById('tabletBtnQuickPay');

    const productGrid = document.getElementById('posProductsGrid');
    if (productGrid) productGrid.classList.toggle('show-hints', this.cart.length === 0);
    this.updateCardQty();

    if (this.cart.length === 0) {
      container.innerHTML = `
        <div class="cart-empty">
          <div class="cart-empty-icon">🍺</div>
          <p>Todavía no hay nada en el pedido</p>
          <span>Toca una bebida para agregarla</span>
        </div>
      `;
      totalElem.textContent = 'Q 0.00';
      checkoutTotalElem.textContent = 'Q 0.00';
      checkoutBtn.disabled = true;

      if (tabletBadge) tabletBadge.textContent = '0';
      if (tabletTotal) tabletTotal.textContent = 'Q 0.00';
      if (tabletPayBtn) {
        tabletPayBtn.disabled = true;
        tabletPayBtn.innerHTML = `<span>💰 COBRAR</span>`;
      }
      return;
    }

    container.innerHTML = this.cart.map((item, index) => {
      const name = item.product_name || item.name || '';
      const nota = this.cartItemNote(item);
      const custom = nota ? `<span class="cart-item-customization">✨ ${escapeHtml(nota)}</span>` : '';

      // Lo que ya está guardado en la cuenta de la mesa no se toca desde aquí
      if (item.is_existing) {
        return `
          <div class="cart-item cart-item-saved">
            <div class="cart-item-header">
              <span class="cart-item-title">${item.quantity}× ${escapeHtml(name)}</span>
              <span class="cart-item-subtotal">${money(item.subtotal)}</span>
            </div>
            ${custom}
            <div class="cart-item-actions">
              <span class="saved-tag">✔ Ya está en la cuenta</span>
              <span class="help-text saved-help">Para quitarlo, entra a “Mesas”.</span>
            </div>
          </div>
        `;
      }

      return `
      <div class="cart-item">
        <div class="cart-item-header">
          <span class="cart-item-title">${escapeHtml(name)}</span>
          <button type="button" class="btn btn-secondary btn-sm btn-remove-item" onclick="app.removeFromCart(${index})" aria-label="Quitar ${escapeHtml(name)} del pedido" title="Quitar del pedido">✕</button>
        </div>
        ${custom}
        <div class="cart-item-actions">
          <div class="qty-control">
            <button type="button" class="btn-qty" onclick="app.updateCartQty(${index}, -1)" aria-label="Quitar uno">−</button>
            <span class="qty-number" aria-live="polite">${item.quantity}</span>
            <button type="button" class="btn-qty" onclick="app.updateCartQty(${index}, 1)" aria-label="Agregar uno más">+</button>
          </div>
          <span class="cart-item-subtotal">${money(item.subtotal)}</span>
        </div>
      </div>
    `;
    }).join('');

    const subtotal = this.cart.reduce((sum, item) => sum + item.subtotal, 0);
    const total = subtotal; // ya no hay descuentos a mano: lo que se cobra es lo que suman los productos
    const totalItems = this.cart.reduce((sum, item) => sum + item.quantity, 0);

    totalElem.textContent = money(total);
    checkoutTotalElem.textContent = money(total);
    checkoutBtn.disabled = false;

    if (tabletBadge) tabletBadge.textContent = totalItems.toString();
    if (tabletTotal) tabletTotal.textContent = money(total);
    if (tabletPayBtn) {
      tabletPayBtn.disabled = false;
      tabletPayBtn.innerHTML = `<span>💰 COBRAR</span>`;
    }
  }

  // Número redondo en cada tarjeta con lo que ya lleva el pedido (como la palomita de una tarjeta elegida)
  updateCardQty() {
    const grid = document.getElementById('posProductsGrid');
    if (!grid) return;
    const porProducto = new Map();
    for (const item of (this.cart || [])) {
      const id = Number(item.product_id);
      porProducto.set(id, (porProducto.get(id) || 0) + (Number(item.quantity) || 0));
    }
    grid.querySelectorAll('.product-card').forEach(card => {
      const n = porProducto.get(Number(card.dataset.id)) || 0;
      card.classList.toggle('in-cart', n > 0);
      const badge = card.querySelector('.card-qty');
      if (badge) badge.textContent = n > 0 ? String(n) : '';
    });
  }

  toggleCartDrawer() {
    const panel = document.getElementById('posCartPanel');
    if (!panel) return;
    if (panel.classList.contains('drawer-open')) {
      this.closeCartDrawer();
    } else {
      this.openCartDrawer();
    }
  }

  openCartDrawer() {
    const panel = document.getElementById('posCartPanel');
    const backdrop = document.getElementById('cartDrawerBackdrop');
    if (panel) panel.classList.add('drawer-open');
    if (backdrop) backdrop.classList.add('active');
  }

  closeCartDrawer() {
    this.setPayMode(false);
    const panel = document.getElementById('posCartPanel');
    const backdrop = document.getElementById('cartDrawerBackdrop');
    if (panel) panel.classList.remove('drawer-open');
    if (backdrop) backdrop.classList.remove('active');
  }

  updateCartQty(index, change) {
    if (!this.cart[index]) return;
    if (change > 0 && !this.cart[index].is_existing) {
      const it = this.cart[index];
      const prod = (this.products || []).find(p => p.id === it.product_id);
      const opt = prod && it.option_id ? (prod.options || []).find(o => o.id === Number(it.option_id)) : null;
      if (prod && !this.puedeAgregar(prod, opt)) return;
    }
    this.cart[index].quantity += change;

    if (this.cart[index].quantity <= 0) {
      this.cart.splice(index, 1);
    } else {
      this.cart[index].subtotal = this.cart[index].quantity * this.cart[index].unit_price;
    }

    this.renderCart();
  }

  removeFromCart(index) {
    this.cart.splice(index, 1);
    this.renderCart();
  }

  clearCart() {
    this.cart = [];
    this.idemDone('cobro');   // un pedido nuevo nunca reutiliza la clave de reintento del anterior
    this.renderCart();
    this.closeCartDrawer();
  }

  // Botón "Vaciar": pregunta antes de borrar. Lo que ya está guardado en una mesa no se toca.
  async askClearCart() {
    const removable = this.cart.filter(i => !i.is_existing);
    if (removable.length === 0) {
      this.toast('No hay nada que vaciar: el pedido está limpio.', 'info');
      return;
    }
    const units = removable.reduce((sum, i) => sum + i.quantity, 0);
    const ok = await this.confirmDialog(
      `Vas a quitar todo lo que agregaste al pedido (${units} ${plural(units, 'producto', 'productos')}).`,
      { title: '¿Vaciar el pedido?', yes: 'Sí, vaciar', no: 'No, dejarlo', danger: true }
    );
    if (!ok) return;
    this.cart = this.cart.filter(i => i.is_existing);
    this.renderCart();
    this.closeCartDrawer();
  }

  // ===================================================
  // PAYMENT & THERMAL RECEIPT
  // ===================================================
  // El cobro ya no es una ventana: el panel del pedido (a la derecha, o el que sube desde abajo en tabletas
  // y celulares) cambia a la pantalla de cobro. "← Volver" regresa al pedido.
  setPayMode(on) {
    this._payMode = !!on;
    const panel = document.getElementById('posCartPanel');
    if (panel) panel.classList.toggle('pay-mode', !!on);
  }

  closePaymentPanel() {
    this.setPayMode(false);
  }

  // (nombre anterior, por si algo lo llama)
  openPaymentModal() { return this.openPaymentPanel(); }

  async openPaymentPanel() {
    if (this.cart.length === 0) return;
    if (this._openingPayment) return;
    this._openingPayment = true;

    try {
      // En una mesa, el cobro cobra lo que está guardado en la cuenta:
      // si hay bebidas nuevas sin guardar, se guardan primero para que el total sea el correcto.
      if (this.activeTable && this.cart.some(i => !i.is_existing)) {
        const saved = await this.saveOrderToTable({ quiet: true });
        if (!saved) return;
      }

      const total = this.cart.reduce((sum, item) => sum + item.subtotal, 0);

      this._payBase = Number(total.toFixed(2));    // lo que suman los productos (sin recargo)

      // Por defecto: efectivo (selectPaymentMethod también pone el total a cobrar; con tarjeta le suma el recargo)
      this.selectPaymentMethod('efectivo');
      const btnCobrar = document.getElementById('btnConfirmPayment');
      if (btnCobrar) btnCobrar.disabled = false;

      const forLabel = document.getElementById('payForLabel');
      if (forLabel) forLabel.textContent = this.activeTable ? '· ' + this.activeTable.name : '';

      this.setPayMode(true);
      this.openCartDrawer(); // en pantallas angostas el panel sube desde abajo; en las grandes ya está a la vista
      const payBody = document.querySelector('#payPanel .pay-panel-body');
      if (payBody) payBody.scrollTop = 0;
    } finally {
      this._openingPayment = false;
    }
  }

  selectPaymentMethod(method) {
    document.querySelectorAll('.pay-method-btn').forEach(btn => {
      const on = btn.dataset.method === method;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    this.updatePayTotal(method);
  }

  // Recargo por pagar con tarjeta (%), el mismo que usa el servidor (se cambia en Ajustes). 0 = sin recargo.
  cardSurchargePercent() {
    const p = Number(this.settings && this.settings.card_surcharge_percent);
    return Number.isFinite(p) && p > 0 && p <= 50 ? p : 0;
  }

  // Pone en pantalla lo que se va a cobrar: con tarjeta, la cuenta + el recargo; con efectivo o transferencia, la cuenta tal cual.
  updatePayTotal(method) {
    const base = Number(this._payBase) || 0;
    const pct = this.cardSurchargePercent();
    const recargo = method === 'tarjeta' && pct > 0 ? Math.round(base * pct + 1e-9) / 100 : 0;
    const total = Math.round((base + recargo) * 100) / 100;
    this._payTotal = total;    // se cobra exactamente el total (sin pedir con cuánto paga)
    this._payRecargo = recargo;
    const totalEl = document.getElementById('payModalTotal');
    if (totalEl) totalEl.textContent = money(total);
    const box = document.getElementById('paySurcharge');
    if (box) {
      if (recargo > 0) {
        box.innerHTML = `Cuenta ${money(base)} + recargo por tarjeta (${fmtPercent(pct)}%) ${money(recargo)}`;
        box.style.display = '';
      } else {
        box.textContent = '';
        box.style.display = 'none';
      }
    }
  }

  // Muestra el ticket. fresh = true cuando se acaba de cobrar; false si se abre desde "Ventas hechas".
  openTicketModal(ticket, fresh) {
    this._ticketShown = ticket;
    this.renderThermalTicket(ticket);
    const voided = ticket.status === 'anulada';
    const title = document.getElementById('ticketModalTitle');
    if (title) title.textContent = voided ? '🚫 Venta anulada' : fresh ? '✅ Venta hecha' : '🧾 Ticket de venta';
    const nextBtn = document.getElementById('btnNextCustomer');
    if (nextBtn) nextBtn.style.display = fresh && !voided ? '' : 'none';
    const voidBar = document.getElementById('voidBar');
    if (voidBar) voidBar.style.display = this.canVoidTicket(ticket) ? '' : 'none';
    this.openModal('modalTicket');
  }

  // ===================================================
  // ANULAR VENTAS
  // ===================================================
  // ¿Se le debe ofrecer el botón "Anular"? (el servidor lo vuelve a revisar siempre)
  canVoidTicket(t) {
    if (!t || t.status === 'anulada') return false;
    const u = this.currentUser || {};
    if (u.role === 'admin') return true;
    // El vendedor solo anula sus ventas de la caja que sigue abierta
    return !!(this.currentShift && t.cash_shift_id && t.cash_shift_id === this.currentShift.id && t.cashier_id === u.id);
  }

  // Abre el cuadro que pide el motivo
  openVoidModal(ticket) {
    this._voidingTicket = ticket;
    const items = Array.isArray(ticket.items) ? ticket.items : [];
    const units = items.reduce((n, i) => n + (Number(i.quantity) || 0), 0);
    document.getElementById('voidSummary').innerHTML = `
      <div class="void-sum-row"><strong>${escapeHtml(ticket.ticket_number)}</strong><strong class="void-sum-total">${money(ticket.total)}</strong></div>
      <div class="help-text">${units} ${plural(units, 'producto', 'productos')} · ${escapeHtml(payLabel(ticket.payment_method))} · cobró ${escapeHtml(ticket.cashier_name || ticket.cashier || '')}</div>
      ${items.length ? `<div class="void-sum-items">${items.map(i => `${i.quantity}× ${escapeHtml(i.product_name)}`).join(', ')}</div>` : ''}
    `;
    const input = document.getElementById('voidReason');
    const yes = document.getElementById('btnVoidYes');
    input.value = '';
    yes.disabled = true;
    yes.textContent = 'Sí, anular venta';
    document.getElementById('voidChips').innerHTML = VOID_REASONS.map(r => `<button type="button" class="void-chip" data-reason="${escapeHtml(r)}">${escapeHtml(r)}</button>`).join('')
      + '<button type="button" class="void-chip" data-reason="">Otro motivo…</button>';
    document.querySelectorAll('#voidChips .void-chip').forEach(btn => {
      btn.onclick = () => {
        input.value = btn.dataset.reason;
        input.dispatchEvent(new Event('input'));
        document.querySelectorAll('#voidChips .void-chip').forEach(b => b.classList.toggle('active', b === btn));
        input.focus();
      };
    });
    this.openModal('modalVoid');
  }

  // Trae la venta completa y abre el cuadro de anular (desde las listas)
  async askVoidSale(ticketNumber) {
    try {
      const res = await this.api(`/api/pos/ticket/${encodeURIComponent(ticketNumber)}`);
      if (res.ticket.status === 'anulada') {
        this.toast('Esa venta ya estaba anulada.', 'info');
        this.refreshAfterVoid();
        return;
      }
      this.openVoidModal(res.ticket);
    } catch (err) {
      this.toast('No se pudo abrir la venta. ' + friendlyError(err), 'error');
    }
  }

  async submitVoid() {
    if (this._voiding) return; // evita anular dos veces si tocan el botón muy rápido
    const ticket = this._voidingTicket;
    const reason = document.getElementById('voidReason').value.trim();
    if (!ticket || reason.length < 3) {
      this.toast('Escribe por qué se anula la venta (obligatorio).', 'warning');
      return;
    }
    const yes = document.getElementById('btnVoidYes');
    this._voiding = true;
    yes.disabled = true;
    yes.textContent = 'Anulando…';
    try {
      await this.api('/api/pos/sales/void', {
        method: 'POST',
        body: JSON.stringify({ ticket_number: ticket.ticket_number, reason })
      });
      this.closeModal('modalVoid');
      this._voidingTicket = null;
      this.toast(`Venta ${ticket.ticket_number} anulada. El inventario se devolvió.`);

      // Si el ticket está abierto en pantalla, se vuelve a mostrar ya marcado como ANULADO
      const ticketOpen = document.getElementById('modalTicket').classList.contains('active');
      if (ticketOpen && this._ticketShown && this._ticketShown.ticket_number === ticket.ticket_number) {
        try {
          const upd = await this.api(`/api/pos/ticket/${encodeURIComponent(ticket.ticket_number)}`);
          this.openTicketModal(upd.ticket, false);
        } catch (e) { this.closeModal('modalTicket'); }
      }
      this.refreshAfterVoid();
    } catch (err) {
      yes.disabled = false;
      yes.textContent = 'Sí, anular venta';
      this.toast('No se pudo anular. ' + friendlyError(err), 'error');
    } finally {
      this._voiding = false;
    }
  }

  // Lo que cambia al anular: existencias, caja, listas y resumen
  refreshAfterVoid() {
    if (typeof this.branchId === 'number') {
      this.loadCatalog();
      this.checkCurrentShift();
    }
    if (document.getElementById('modalMySales').classList.contains('active')) this.renderMySales();
    if (this.activeTab === 'sales') this.loadSalesHistory();
    if (this.activeTab === 'dashboard') this.loadDashboardData();
    if (this.activeTab === 'inventory') this.loadInventory();
    if (this.activeTab === 'shifts') this.loadShiftsHistory();
  }

  // "Ventas de mi caja": lista de lo vendido en el turno abierto, para revisar o anular una
  async openMySales() {
    this.openModal('modalMySales');
    await this.renderMySales();
  }

  async renderMySales() {
    const box = document.getElementById('mySalesList');
    try {
      const res = await this.api('/api/pos/shift/sales');
      if (!res.active) {
        box.innerHTML = '<div class="empty-state"><div class="empty-icon">💰</div><p>Tu caja no está abierta</p><span>Abre tu caja para ver y anular tus ventas de hoy.</span></div>';
        return;
      }
      if (!res.sales.length) {
        box.innerHTML = '<div class="empty-state"><div class="empty-icon">🧾</div><p>Todavía no hay ventas en tu caja</p><span>Cuando cobres, aparecerán aquí.</span></div>';
        return;
      }
      box.innerHTML = res.sales.map(s => {
        const voided = s.status === 'anulada';
        return `
        <div class="my-sale ${voided ? 'is-voided' : ''}">
          <div class="my-sale-main">
            <div class="my-sale-top">
              <strong>${escapeHtml(s.ticket_number)}</strong>
              <span class="help-text">${fmtTime(s.created_at)}${s.table_name ? ' · ' + escapeHtml(s.table_name) : ''}</span>
              ${voided ? '<span class="badge-void">ANULADA</span>' : ''}
            </div>
            <div class="my-sale-items">${escapeHtml(s.items_text || '')}</div>
            ${voided && s.void_reason ? `<div class="help-text">Motivo: ${escapeHtml(s.void_reason)}</div>` : ''}
          </div>
          <div class="my-sale-side">
            <strong class="my-sale-total">${money(s.total)}</strong>
            <span class="help-text">${escapeHtml(payLabel(s.payment_method))}</span>
          </div>
          <div class="my-sale-actions">
            <button type="button" class="btn btn-secondary btn-sm" onclick="app.viewMySale('${escapeHtml(s.ticket_number)}')">Ver</button>
            ${voided ? '' : `<button type="button" class="btn btn-secondary btn-sm btn-danger-soft" onclick="app.askVoidSale('${escapeHtml(s.ticket_number)}')">🚫 Anular</button>`}
          </div>
        </div>`;
      }).join('');
    } catch (err) {
      box.innerHTML = '';
      this.toast('No se pudieron cargar tus ventas. ' + friendlyError(err), 'error');
    }
  }

  // Ver el ticket de una venta de mi caja (el cuadro de ventas se cierra para que el ticket quede encima)
  async viewMySale(ticketNumber) {
    this.closeModal('modalMySales');
    await this.viewTicketDetails(ticketNumber);
  }

  async processSale() {
    if (this._selling) return; // evita cobrar dos veces si tocan el botón muy rápido

    this._selling = true;
    const btn = document.getElementById('btnConfirmPayment');
    const originalLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Cobrando…';

    try {
      const activeMethodBtn = document.querySelector('.pay-method-btn.active');
      const payment_method = activeMethodBtn ? activeMethodBtn.dataset.method : 'efectivo';
      const amount_paid = this._payTotal;   // se cobra exactamente el total
      const notes = '';

      if (this.activeTable) {
        // Table checkout!
        const cuerpo = JSON.stringify({
          table_id: this.activeTable.id,
          payment_method,
          amount_paid,
          notes
        });
        const res = await this.api('/api/pos/tables/checkout', { method: 'POST', body: cuerpo, key: this.idemKey('cobro-mesa', cuerpo + '|' + this.branchId) });
        this.idemDone('cobro-mesa');

        this.playSaleChime();
        this.toast(`¡Cobrado! La cuenta de ${this.activeTable.name} quedó pagada y la mesa está libre.`);
        if (res._repetida) this.toast('Ese cobro ya se había guardado antes (se perdió la respuesta). No se cobró doble.', 'info');
        this.setPayMode(false);
        this.clearActiveTable();
        this.openTicketModal(res.ticket, true);
        this.loadCatalog();
        this.checkCurrentShift();
        this.loadTables();
        return;
      }

      const payload = {
        items: this.cart,
        payment_method,
        amount_paid,
        notes
      };

      const cuerpo = JSON.stringify(payload);
      const res = await this.api('/api/pos/sale', { method: 'POST', body: cuerpo, key: this.idemKey('cobro', cuerpo + '|' + this.branchId) });
      this.idemDone('cobro');

      this.playSaleChime();
      this.toast(`¡Cobrado! Venta guardada (ticket ${res.ticket.ticket_number}).`);
      if (res._repetida) this.toast('Ese cobro ya se había guardado antes (se perdió la respuesta). No se cobró doble.', 'info');
      this.setPayMode(false);

      // Clear cart
      this.clearCart();

      // Display thermal ticket modal
      this.openTicketModal(res.ticket, true);

      // Reload catalog to refresh stocks
      this.loadCatalog();
      this.checkCurrentShift();
    } catch (err) {
      if (err && err.code === 'SIN_STOCK') this.loadCatalog();   // alguien más vendió lo último: se actualiza el menú
      this.toast('No se pudo cobrar. ' + friendlyError(err) + (err && err.red ? ' Cuando haya internet toca COBRAR otra vez: si ya se había guardado, NO se cobra doble.' : ''), 'error');
    } finally {
      this._selling = false;
      btn.textContent = originalLabel;
      btn.disabled = false;
    }
  }

  renderThermalTicket(ticket) {
    const container = document.getElementById('thermalTicketContent');
    const settings = ticket.settings || {};

    const itemsHtml = ticket.items.map(i => `
      <tr>
        <td style="width: 20px; vertical-align: top;">${i.quantity}x</td>
        <td style="vertical-align: top;">
          <div>${escapeHtml(i.product_name)}</div>
          ${i.customization ? `<div style="font-size: 9px; color: #333;">${escapeHtml(i.customization)}</div>` : ''}
        </td>
        <td style="text-align: right; width: 52px; vertical-align: top; white-space: nowrap;">Q ${i.subtotal.toFixed(2)}</td>
      </tr>
    `).join('');

    container.innerHTML = `
      <div class="ticket-header">
        <img src="/logo.jpg" alt="Logo" class="ticket-logo">
        <div class="ticket-title">${escapeHtml(settings.business_name || 'MICHELADAS EL MISMÍSIMO')}</div>
        <div style="font-size: 11px;">${escapeHtml(settings.tagline || 'Refresquería & Bar')}</div>
        <div style="font-size: 10px;">${escapeHtml(settings.address || 'Guatemala')}</div>
        <div style="font-size: 10px;">Tel: ${escapeHtml(settings.phone || '')}</div>
        <div style="font-size: 10px;">${escapeHtml(settings.tax_id || '')}</div>
        ${this.multiBranch && ticket.branch_name ? `<div style="font-size: 12px; font-weight: bold; margin-top: 3px;">Sucursal: ${escapeHtml(ticket.branch_name)}</div>` : ''}
      </div>

      ${ticket.status === 'anulada' ? `
      <div class="ticket-void">
        <div class="ticket-void-title">*** VENTA ANULADA ***</div>
        <div>Motivo: ${escapeHtml(ticket.void_reason || '—')}</div>
        <div>Anulada por ${escapeHtml(ticket.voided_by_name || '—')}${ticket.voided_at ? ' el ' + fmtDateTime(ticket.voided_at) : ''}</div>
      </div>` : ''}

      <div class="ticket-row">
        <span>Folio:</span>
        <strong>${escapeHtml(ticket.ticket_number)}</strong>
      </div>
      <div class="ticket-row">
        <span>Fecha:</span>
        <span>${fmtTicketDate(ticket.created_at)}</span>
      </div>
      <div class="ticket-row">
        <span>Cajero:</span>
        <span>${escapeHtml(ticket.cashier_name || ticket.cashier || 'Cajero')}</span>
      </div>
      ${ticket.table_name ? `
      <div class="ticket-row">
        <span>Mesa:</span>
        <strong>${escapeHtml(ticket.table_name)}</strong>
      </div>` : ''}
      ${ticket.customer_name ? `
      <div class="ticket-row">
        <span>Cliente:</span>
        <span>${escapeHtml(ticket.customer_name)}</span>
      </div>` : ''}

      <div class="ticket-divider"></div>

      <table class="ticket-items-table">
        <thead>
          <tr>
            <th>Cant</th>
            <th>Descripción</th>
            <th style="text-align: right;">Importe</th>
          </tr>
        </thead>
        <tbody>
          ${itemsHtml}
        </tbody>
      </table>

      <div class="ticket-divider"></div>

      <div class="ticket-row">
        <span>Subtotal:</span>
        <span>Q ${ticket.subtotal.toFixed(2)}</span>
      </div>
      ${ticket.discount > 0 ? `
      <div class="ticket-row">
        <span>Descuento:</span>
        <span>-Q ${ticket.discount.toFixed(2)}</span>
      </div>` : ''}
      ${ticket.card_surcharge > 0 ? `
      <div class="ticket-row">
        <span>${escapeHtml(ticketRecargoEtiqueta(ticket))}</span>
        <span>Q ${ticket.card_surcharge.toFixed(2)}</span>
      </div>` : ''}
      <div class="ticket-row" style="font-size: 13px; font-weight: bold; margin-top: 4px; color: #000;">
        <span>TOTAL:</span>
        <span>Q ${ticket.total.toFixed(2)}</span>
      </div>

      <div class="ticket-divider"></div>

      <div class="ticket-row">
        <span>Pago:</span>
        <span style="text-transform: uppercase;">${escapeHtml(ticket.payment_method)}</span>
      </div>
      ${ticket.change_given > 0 ? `
      <div class="ticket-row">
        <span>Recibido:</span>
        <span>Q ${ticket.amount_paid.toFixed(2)}</span>
      </div>
      <div class="ticket-row">
        <span>Cambio:</span>
        <span style="font-weight: bold;">Q ${ticket.change_given.toFixed(2)}</span>
      </div>` : ''}

      <div class="ticket-footer">
        <p>${escapeHtml(settings.ticket_footer || '¡Gracias por su visita! El Mismísimo sabor en micheladas y bebidas.')}</p>
        <div style="margin-top: 6px; letter-spacing: 1px;">*** EL MISMÍSIMO ***</div>
      </div>
    `;
  }

  // ===================================================
  // INVENTORY MODULE
  // ===================================================
  async loadInventory() {
    try {
      const data = await this.api('/api/inventory');
      this.inventoryItems = data.items;

      document.getElementById('invTotalItems').textContent = data.summary.total_items;
      document.getElementById('invLowStockCount').textContent = data.summary.low_stock_count;
      document.getElementById('invTotalValue').textContent = money(data.summary.total_inventory_cost);
      this.setupInventoryControls();
      this.renderInventoryRows();
    } catch (err) {
      this.toast('No se pudo cargar el inventario. ' + friendlyError(err), 'error');
    }
  }

  // Buscar, filtrar y mostrar costos (se conectan una sola vez)
  setupInventoryControls() {
    if (this._invControls) return;
    this._invControls = true;
    this.invFilter = 'all';
    this.invQuery = '';
    const search = document.getElementById('invSearch');
    if (search) search.oninput = () => { this.invQuery = search.value; this.renderInventoryRows(); };
    document.querySelectorAll('#invFilters [data-inv-filter]').forEach(btn => {
      btn.onclick = () => {
        this.invFilter = btn.dataset.invFilter;
        document.querySelectorAll('#invFilters [data-inv-filter]').forEach(b => b.classList.toggle('active', b === btn));
        this.renderInventoryRows();
      };
    });
    const extra = document.getElementById('btnInvExtra');
    if (extra) extra.onclick = () => {
      const table = document.getElementById('inventoryTable');
      const on = !table.classList.contains('show-extra');
      table.classList.toggle('show-extra', on);
      extra.setAttribute('aria-pressed', on ? 'true' : 'false');
      extra.textContent = on ? '📊 Ocultar costos y más' : '📊 Ver costos y más';
      const chip = document.getElementById('invValueChip');
      if (chip) chip.hidden = !on;
    };
  }

  renderInventoryRows() {
    const tbody = document.getElementById('inventoryTableBody');
    if (!tbody) return;
    const all = this.inventoryItems || [];
    if (all.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state"><div class="empty-icon">📦</div><p>Todavía no hay nada en el inventario</p><span>Toca “➕ Agregar un insumo nuevo” para empezar.</span></div></td></tr>`;
      return;
    }
    const q = sinTildes(this.invQuery || '');
    let items = all;
    if (this.invFilter === 'low') items = items.filter(i => i.stock_status !== 'ok');
    if (q) items = items.filter(i => sinTildes(`${i.name} ${i.category || ''} ${i.supplier || ''}`).includes(q));
    if (items.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state"><div class="empty-icon">🔎</div><p>No hay nada con ese filtro</p><span>Borra lo que escribiste o toca “Todo”.</span></div></td></tr>`;
      return;
    }

    tbody.innerHTML = items.map(item => {
      const base = item.min_stock > 0 ? item.min_stock * 2 : Math.max(item.current_stock, 1);
      const pct = Math.min(100, Math.max(5, (item.current_stock / base) * 100));
      const barColor = item.stock_status === 'critical' ? '#ef4444' : item.stock_status === 'warning' ? '#f59e0b' : '#10b981';
      const statusText = item.stock_status === 'critical' ? '🔴 Casi no queda' : item.stock_status === 'warning' ? '🟡 Queda poco' : '🟢 Bien';

      return `
        <tr>
          <td>
            <strong>${escapeHtml(item.name)}</strong>
            <div class="inv-cat">${escapeHtml(item.category || '')}</div>
          </td>
          <td>
            <div class="inv-qty">
              <div class="liquid-meter">
                <div class="liquid-bar" style="width: ${pct}%; background: ${barColor};"></div>
              </div>
              <strong>${stockLabel(item)}</strong>
              <span class="inv-unit">${escapeHtml(item.unit)}</span>
            </div>
            ${item.pack_size > 0 && item.current_stock > 0 ? `<span class="inv-packs">≈ ${escapeHtml(packBreakdown(item, item.current_stock))}</span>` : ''}
          </td>
          <td>
            <span class="badge-status ${item.stock_status}">${statusText}</span>
          </td>
          <td class="inv-extra">${fmtBig(item.min_stock, 2)}</td>
          <td class="inv-extra">${costPerUnitLabel(item)}</td>
          <td class="inv-extra"><strong style="color: var(--accent-text);">${money(item.total_value)}</strong></td>
          <td class="inv-extra">${escapeHtml(item.supplier || 'No indicado')}</td>
          <td>
            <div class="row-actions">
              <button class="btn btn-secondary btn-sm" onclick="app.openEditInventoryItem(${item.id})" aria-label="Cambiar ${escapeHtml(item.name)}">✏️ Cambiar</button>
              ${puedeAMl(item) ? `<button class="btn btn-secondary btn-sm" onclick="app.openConvertMl(${item.id})" aria-label="Pasar ${escapeHtml(item.name)} a ml">🔄 Pasar a ml</button>` : ''}
              <button class="btn btn-secondary btn-sm btn-danger-soft" onclick="app.deleteInventoryItem(${item.id})" aria-label="Quitar ${escapeHtml(item.name)} del inventario">🗑️ Quitar</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  openEditInventoryItem(itemId) {
    const item = this.inventoryItems.find(i => i.id === itemId);
    if (!item) return;

    document.getElementById('invItemModalTitle').textContent = 'Cambiar un insumo';
    document.getElementById('invItemId').value = item.id;
    document.getElementById('invItemName').value = item.name;
    document.getElementById('invItemCategory').value = item.category;
    this.setInvUnitOptions(item.unit);
    document.getElementById('invItemUnit').value = item.unit;
    document.getElementById('invConvertMlBox').style.display = puedeAMl(item) ? '' : 'none';
    document.getElementById('invItemStock').value = item.current_stock;
    document.getElementById('invItemStock').disabled = true; // la cantidad se cambia con "Llegó mercadería" o "Se perdió algo"
    const hint = document.getElementById('invItemStockHint');
    if (hint) hint.style.display = 'block';
    const branchHint = document.getElementById('invItemBranchHint');
    if (branchHint) branchHint.style.display = 'none';
    document.getElementById('invItemMinStock').value = item.min_stock;
    document.getElementById('invItemCost').value = item.cost_per_unit;
    document.getElementById('invItemSupplier').value = item.supplier || '';
    this.fillInvPackForm(item);

    this.openModal('modalInventoryItem');
  }

  // Medidas que se pueden elegir: ml, piezas y gramos. Si el insumo ya estaba en litros u onzas, esa medida también aparece (para no perderla).
  setInvUnitOptions(current) {
    const sel = document.getElementById('invItemUnit');
    sel.querySelectorAll('option[data-extra]').forEach(o => o.remove());
    if (current && !['ml', 'pza', 'g'].includes(current)) {
      const o = document.createElement('option');
      o.value = current; o.dataset.extra = '1';
      o.textContent = current === 'L' ? 'Litros (L): como estaba' : current === 'oz' ? 'Onzas (oz): como estaba' : `${current}: como estaba`;
      sel.appendChild(o);
    }
  }

  // Un insumo nuevo: según el tipo se sugiere la medida (el licor en ml, la cerveza en piezas...)
  suggestInvUnit() {
    const porTipo = { 'Líquidos Barril': 'ml', 'Líquidos Insumo': 'ml', 'Licores Líquido': 'ml', 'Cerveza Embotellada': 'pza', 'Refrescos': 'pza', 'Botanas': 'pza', 'Escarchados': 'g' };
    const u = porTipo[document.getElementById('invItemCategory').value];
    if (u) document.getElementById('invItemUnit').value = u;
    this.refreshInvPackUnits(document.getElementById('invItemUnit').value, null);
    this.syncInvPackUi();
  }

  // ---- Presentación del insumo (botella, caja...) en el formulario ----
  fillInvPackForm(item) {
    const unit = (item && item.unit) || document.getElementById('invItemUnit').value;
    document.getElementById('invPackName').value = item && item.pack_size > 0 ? item.pack_name : '';
    document.getElementById('invPackSize').value = item && item.pack_size > 0 ? fmtNum(item.pack_size, 4) : '';
    // Un insumo nuevo: las botellas de licor se anotan en ml (como dice la etiqueta). Uno que ya tiene botella: en su propia medida, sin redondeos.
    this.refreshInvPackUnits(unit, item && item.pack_size > 0 ? unit : (unit in VOL_ML ? 'ml' : unit));
    document.getElementById('invPackCost').value = item && item.pack_size > 0 && item.cost_per_unit > 0 ? fmtNum(item.cost_per_unit * item.pack_size, 2) : '';
    this.syncInvPackUi();
  }

  // Llena la lista de medidas de la botella según cómo se mide el insumo ("preferred" = la que se deja elegida)
  refreshInvPackUnits(itemUnit, preferred) {
    const sel = document.getElementById('invPackUnit');
    const opts = packUnitsFor(itemUnit);
    const keep = preferred && opts.includes(preferred) ? preferred : (opts.includes(sel.value) ? sel.value : opts[0]);
    sel.innerHTML = opts.map(u => `<option value="${u}">${u}</option>`).join('');
    sel.value = keep;
    sel.disabled = opts.length === 1;
  }

  // El tamaño escrito, ya convertido a la medida del insumo (0 si no hay)
  invPackSizeInItemUnit() {
    const unit = document.getElementById('invItemUnit').value;
    const raw = parseFloat(document.getElementById('invPackSize').value);
    if (!(raw > 0)) return 0;
    return Math.round(convertAmount(raw, document.getElementById('invPackUnit').value, unit) * 1e4) / 1e4;
  }

  // Textos que dependen de la medida (costo por oz, pista de equivalencias)
  syncInvPackUi() {
    const unit = document.getElementById('invItemUnit').value;
    const word = UNIT_WORD[unit] || 'uno';
    document.getElementById('invCostUnit').textContent = word;
    document.querySelectorAll('.inv-cost-unit-copy').forEach(el => { el.textContent = word; });
    const size = this.invPackSizeInItemUnit();
    const name = document.getElementById('invPackName').value.trim() || 'botella';
    const hint = document.getElementById('invPackHint');
    let text = '';
    if (size > 0) {
      text = `Cada ${name} = ${fmtBig(size, 4)} ${unit}`;
      if (unit in VOL_ML && unit !== 'ml') text += ` (≈ ${fmtNum(convertAmount(size, unit, 'ml'), 1)} ml)`;
    }
    hint.textContent = text;
    document.getElementById('invPackCostGroup').style.display = size > 0 ? '' : 'none';
  }

  // ---- Pasar un insumo a ml ----
  // Abre el cuadro: si es por piezas pide cuántos ml trae cada una; litros y onzas se convierten solos.
  openConvertMl(itemId) {
    const item = (this.inventoryItems || []).find(i => i.id === itemId);
    if (!item) return;
    this._cml = { id: itemId, item, seq: 0, plan: null, timer: null };
    const pza = item.unit === 'pza';
    document.getElementById('convertMlItemId').value = itemId;
    document.getElementById('convertMlTitle').textContent = `🔄 Pasar a ml: ${item.name}`;
    document.getElementById('convertMlPerBox').style.display = pza ? '' : 'none';
    document.getElementById('convertMlPer').value = '';
    document.querySelectorAll('#convertMlChips .ml-chip').forEach(c => c.classList.remove('is-on'));
    const sinBotella = pza && !(item.pack_size > 0);
    document.getElementById('convertMlPackOpt').style.display = sinBotella ? '' : 'none';
    document.getElementById('convertMlPackOn').checked = true;
    document.getElementById('convertMlPackName').value = 'botella';
    document.getElementById('convertMlIntro').innerHTML = pza
      ? 'Escribe cuántos ml trae <strong>una</strong> pieza. El sistema convierte todo solo y <strong>tus bebidas cuestan lo mismo</strong>. Antes de cambiar guarda una copia de seguridad.'
      : `Está en ${item.unit === 'L' ? 'litros (1 litro = 1,000 ml)' : 'onzas (1 oz = 29.57 ml)'}. Se convierte solo y <strong>tus bebidas cuestan lo mismo</strong>. Antes de cambiar guarda una copia de seguridad.`;
    document.getElementById('btnConvertMlGo').disabled = true;
    document.getElementById('convertMlPreview').innerHTML = pza ? '<p class="help-text">Escribe cuántos ml trae cada pieza y aquí verás qué cambia.</p>' : '';
    this.openModal('modalConvertMl');
    if (pza) setTimeout(() => { const i = document.getElementById('convertMlPer'); if (i) i.focus(); }, 60);
    else this.loadConvertMlPreview();
  }

  // Pide al servidor qué cambiaría (no toca nada) y lo muestra
  async loadConvertMlPreview() {
    const st = this._cml;
    if (!st) return;
    const seq = ++st.seq;
    const go = document.getElementById('btnConvertMlGo');
    const box = document.getElementById('convertMlPreview');
    go.disabled = true; st.plan = null;
    const raw = document.getElementById('convertMlPer').value.trim();
    if (st.item.unit === 'pza' && !(parseFloat(raw) > 0)) {
      box.innerHTML = '<p class="help-text">Escribe cuántos ml trae cada pieza y aquí verás qué cambia.</p>';
      return;
    }
    try {
      const q = st.item.unit === 'pza' ? `?ml_per_unit=${encodeURIComponent(raw)}` : '';
      const r = await this.api(`/api/inventory/item/${st.id}/convert-ml${q}`);
      if (seq !== st.seq) return;
      st.plan = r.preview;
      box.innerHTML = this.convertMlPreviewHtml(r.preview);
      go.disabled = false;
    } catch (err) {
      if (seq !== st.seq) return;
      box.innerHTML = `<p class="ml-error">${escapeHtml(friendlyError(err))}</p>`;
    }
  }

  convertMlPreviewHtml(p) {
    const antes = p.item.unit_antes === 'pza' ? 'pza' : p.item.unit_antes;
    const palabra = UNIT_WORD[p.item.unit_antes] || p.item.unit_antes;
    const flecha = '<span class="ml-arrow">→</span>';
    const act = typeof this.branchId === 'number' ? this.branchId : null;
    const sucs = p.sucursales.filter(s => s.existencias_antes !== 0 || s.branch_id === act);
    const varias = sucs.filter(s => s.existencias_antes !== 0).length > 1;
    const filas = [];
    for (const s of (varias ? sucs.filter(x => x.existencias_antes !== 0) : sucs.filter(x => x.branch_id === act || sucs.length === 1))) {
      filas.push(`<div class="ml-row"><span>${varias ? 'Lo que hay en ' + escapeHtml(s.sucursal) : 'Lo que hay'}</span><b>${fmtBig(s.existencias_antes, 2)} ${escapeHtml(antes)} ${flecha} ${fmtBig(s.existencias_despues, 2)} ml</b></div>`);
    }
    const aqui = p.sucursales.find(s => s.branch_id === act) || p.sucursales[0];
    if (aqui) filas.push(`<div class="ml-row"><span>Avisar cuando quede menos de</span><b>${fmtBig(aqui.minimo_antes, 2)} ${escapeHtml(antes)} ${flecha} ${fmtBig(aqui.minimo_despues, 2)} ml</b></div>`);
    filas.push(`<div class="ml-row"><span>Costo</span><b>${moneyFine(p.costo_antes)} por ${escapeHtml(palabra)} ${flecha} ${moneyFine(p.costo_despues)} por ml</b></div>`);
    if (p.presentacion) filas.push(`<div class="ml-row"><span>Cada ${escapeHtml(p.presentacion.nombre)}</span><b>${fmtBig(p.presentacion.antes, 4)} ${escapeHtml(antes)} ${flecha} ${fmtBig(p.presentacion.despues, 2)} ml</b></div>`);
    let html = `<div class="ml-sum">${filas.join('')}</div>`;

    const li = (nombre, valor, oculto) => `<li${oculto ? ' class="is-hidden"' : ''}><span>${escapeHtml(nombre)}${oculto ? ' (oculto)' : ''}</span><span>${valor}</span></li>`;
    if (p.recetas.length) {
      html += `<div><h4>Recetas que se ajustan (${p.recetas.length})</h4><ul class="ml-list">${p.recetas.map(r => li(r.producto, `${fmtBig(r.antes, 4)} ${escapeHtml(antes)} ${flecha} ${fmtBig(r.despues, 4)} ml`, r.oculto)).join('')}</ul></div>`;
    }
    if (p.opciones.length) {
      html += `<div><h4>Opciones del cliente que se ajustan (${p.opciones.length})</h4><ul class="ml-list">${p.opciones.map(o => li(`${o.producto} · ${o.presentacion}`, `${fmtBig(o.antes, 4)} ${escapeHtml(antes)} ${flecha} ${fmtBig(o.despues, 4)} ml`, o.oculto)).join('')}</ul></div>`;
    }
    if (p.directos.length) {
      html += `<div><h4>Se vendían “tal cual” y ahora llevan receta (${p.directos.length})</h4><ul class="ml-list">${p.directos.map(d => li(d.producto, d.con_presentaciones ? 'ya descuenta su opción' : `lleva ${fmtBig(d.despues, 4)} ml`, d.oculto)).join('')}</ul><p class="help-text">Al venderlos se descuenta lo mismo que antes.</p></div>`;
    }
    html += '<p class="ml-note">✔ Tus bebidas cuestan lo mismo. Se guarda una copia de seguridad antes de cambiar.</p>';
    return html;
  }

  async submitConvertMl() {
    const st = this._cml;
    if (!st || !st.plan) return;
    const go = document.getElementById('btnConvertMlGo');
    go.disabled = true;
    const body = {};
    if (st.item.unit === 'pza') body.ml_per_unit = parseFloat(document.getElementById('convertMlPer').value);
    if (document.getElementById('convertMlPackOpt').style.display !== 'none' && document.getElementById('convertMlPackOn').checked) {
      body.presentacion = document.getElementById('convertMlPackName').value.trim() || 'botella';
    }
    try {
      const r = await this.api(`/api/inventory/item/${st.id}/convert-ml`, { method: 'POST', body: JSON.stringify(body) });
      this.toast('✔ ' + r.message);
      this._cml = null;
      this.closeModal('modalConvertMl');
      this.closeModal('modalInventoryItem');
      await this.loadInventory();
      this.loadCatalog();
      this.loadAdminProducts();
    } catch (err) {
      this.toast(friendlyError(err), 'error');
      go.disabled = false;
    }
  }

  // ---- Llegó mercadería: 3 pasos (qué llegó, cuánto, cuánto pagaste) ----
  purchaseItem() {
    const id = parseInt(document.getElementById('purchaseItemId').value, 10);
    return (this.inventoryItems || []).find(i => i.id === id) || null;
  }

  purchaseOptionsHtml() {
    return '<option value="">Elige lo que llegó…</option>' +
      (this.inventoryItems || []).map(i => `<option value="${i.id}">${escapeHtml(i.name)} · hay ${fmtBig(i.current_stock, 2)} ${escapeHtml(i.unit)}</option>`).join('');
  }

  // Abre el cuadro limpio
  openPurchaseModal() {
    document.getElementById('purchaseItemId').innerHTML = this.purchaseOptionsHtml();
    this._purchaseDone = [];
    this.renderPurchaseDone();
    this.resetPurchaseForm();
    document.getElementById('purchaseMore').open = false;
    this.openModal('modalPurchase');
  }

  resetPurchaseForm() {
    document.getElementById('purchaseItemId').value = '';
    document.getElementById('purchaseQty').value = '';
    document.getElementById('purchaseTotal').value = '';
    document.getElementById('purchaseInvoice').value = '';
    document.getElementById('purchaseNotes').value = '';
    this.syncPurchaseSteps();
  }

  renderPurchaseDone() {
    const box = document.getElementById('purchaseDone');
    const list = this._purchaseDone || [];
    box.hidden = list.length === 0;
    box.innerHTML = list.map(t => `<li>✔ ${escapeHtml(t)}</li>`).join('');
    const fin = document.getElementById('btnPurchaseDone'); if (fin) fin.textContent = list.length ? 'Terminar' : 'Cancelar';
  }

  // En qué se puede contar lo que llegó: en su botella/paquete (si tiene) o en su medida. Solo se elige si hay dos.
  purchaseUnitChoices(item) {
    const word = { ml: 'ml', pza: 'piezas', g: 'gramos', L: 'litros', oz: 'oz' }[item.unit] || item.unit;
    const choices = [];
    if (item.pack_size > 0) choices.push({ key: 'pack', label: packPlural(item.pack_name || 'botella', 2) });
    choices.push({ key: 'unit', label: word });
    return choices;
  }

  purchaseUnitKey() {
    const r = document.querySelector('input[name="purchaseUnit"]:checked');
    return r ? r.value : 'unit';
  }

  // Muestra los pasos 2 y 3 solo cuando ya se eligió qué llegó
  syncPurchaseSteps() {
    const item = this.purchaseItem();
    document.getElementById('purchaseStep2').hidden = !item;
    document.getElementById('purchaseStep3').hidden = !item;
    const box = document.getElementById('purchaseUnits');
    if (!item) { box.innerHTML = ''; document.getElementById('purchasePreview').textContent = ''; document.getElementById('purchaseCostHint').textContent = ''; return; }
    const choices = this.purchaseUnitChoices(item);
    box.className = choices.length === 1 ? 'buy-units one' : 'buy-units';
    box.innerHTML = choices.length === 1
      ? `<span class="buy-unit-one">${escapeHtml(choices[0].label)}</span><input type="radio" name="purchaseUnit" value="${choices[0].key}" checked hidden>`
      : choices.map((c, i) => `<label class="seg"><input type="radio" name="purchaseUnit" value="${c.key}" ${i === 0 ? 'checked' : ''}><span>${escapeHtml(c.label)}</span></label>`).join('');
    box.querySelectorAll('input[name="purchaseUnit"]').forEach(r => { r.onchange = () => this.updatePurchasePreview(); });
    this.updatePurchasePreview();
  }

  // Cuánto llegó, ya en la medida del insumo (24 paquetes de 355 ml → 8,520 ml)
  purchaseAmountInItemUnit() {
    const item = this.purchaseItem();
    const q = parseFloat(document.getElementById('purchaseQty').value);
    if (!item || !(q > 0)) return 0;
    return this.purchaseUnitKey() === 'pack' ? q * item.pack_size : q;
  }

  updatePurchasePreview() {
    const item = this.purchaseItem();
    const prev = document.getElementById('purchasePreview'), hint = document.getElementById('purchaseCostHint');
    if (!item) return;
    const q = parseFloat(document.getElementById('purchaseQty').value);
    const total = parseFloat(document.getElementById('purchaseTotal').value);
    const unitWord = item.unit === 'pza' ? 'pza' : item.unit;
    const choices = this.purchaseUnitChoices(item);
    const pack = this.purchaseUnitKey() === 'pack';
    if (!(q > 0)) {
      prev.textContent = `Ahora hay ${fmtBig(item.current_stock, 2)} ${unitWord}.`;
      hint.textContent = '';
      return;
    }
    const add = this.purchaseAmountInItemUnit();
    prev.textContent = (pack ? `${fmtBig(q, 2)} ${choices[0].label} = ${fmtBig(add, 2)} ${unitWord}. ` : '') +
      `Hay ${fmtBig(item.current_stock, 2)} → habrá ${fmtBig(item.current_stock + add, 2)} ${unitWord}.`;
    if (total > 0) {
      hint.textContent = pack
        ? `Cada ${item.pack_name || 'botella'} sale a ${money(total / q)}.`
        : `Cada ${item.unit === 'pza' ? 'pieza' : item.unit} sale a ${moneyFine(total / add)}.`;
    } else {
      hint.textContent = 'Si no lo anotas, el costo se queda como estaba.';
    }
  }

  async submitPurchase() {
    const item = this.purchaseItem();
    if (!item) return this.toast('Elige primero qué llegó.', 'warning');
    const q = parseFloat(document.getElementById('purchaseQty').value);
    if (!(q > 0)) { document.getElementById('purchaseQty').focus(); return this.toast('Escribe cuánto llegó (un número mayor que 0).', 'warning'); }
    const total = parseFloat(document.getElementById('purchaseTotal').value);
    const pack = this.purchaseUnitKey() === 'pack';
    const payload = { inventory_item_id: item.id, invoice_number: document.getElementById('purchaseInvoice').value, notes: document.getElementById('purchaseNotes').value };
    if (pack) { payload.packs = q; if (total > 0) payload.cost_per_pack = total / q; }
    else { payload.quantity = q; if (total > 0) payload.cost_per_unit = total / q; }
    const btn = document.getElementById('btnPurchaseSave');
    btn.disabled = true;
    try {
      const cuerpo = JSON.stringify(payload);
      const res = await this.api('/api/inventory/purchase', { method: 'POST', body: cuerpo, key: this.idemKey('compra', cuerpo + '|' + this.branchId) });
      this.idemDone('compra');
      const u = item.unit === 'pza' ? 'pza' : item.unit;
      const llegaron = pack ? `${fmtBig(q, 2)} ${packPlural(item.pack_name || 'botella', q)}` : `${fmtBig(q, 2)} ${u}`;
      (this._purchaseDone ||= []).unshift(`${item.name}: llegaron ${llegaron} · ahora hay ${fmtBig(res.new_stock, 2)} ${u}`);
      this.renderPurchaseDone();
      this.resetPurchaseForm();
      await this.loadInventory();
      // el cuadro sigue abierto para anotar otro: se actualiza la lista con lo nuevo que hay
      const keep = document.getElementById('purchaseItemId');
      keep.innerHTML = this.purchaseOptionsHtml();
      this.loadCatalog();
      keep.focus();
    } catch (err) {
      this.toast(friendlyError(err), 'error');
    } finally {
      btn.disabled = false;
    }
  }

  // ---- Pasar mercadería de una tienda a otra (por botellas) ----
  // Sale de la tienda que está elegida arriba y va para la que se elija aquí. Solo el administrador.
  trStep(item, mode) { return mode === 'pack' ? 1 : (item.unit === 'ml' || item.unit === 'g') ? 100 : 1; }

  // "2 botellas (50.72 oz)" o "12 pza": lo que se pasa, en palabras
  trText(item, base, mode) {
    if (mode === 'pack' && item.pack_size > 0) {
      const n = fmtNum(base / item.pack_size, 2);
      return `${fmtBig(n, 2)} ${packPlural(item.pack_name || 'botella', n)} (${fmtBig(base, 2)} ${item.unit})`;
    }
    return `${fmtBig(base, 2)} ${item.unit}`;
  }

  trBranch(id) { return this.branches.find(b => b.id === Number(id)) || null; }

  async openTransferModal() {
    if (this.currentUser && this.currentUser.role !== 'admin') return this.toast('Solo el administrador puede pasar mercadería entre tiendas.', 'warning');
    if (typeof this.branchId !== 'number') return this.toast('Elige arriba una sola tienda (no “Ambas”): de ahí sale lo que vas a pasar.', 'warning');
    const otras = this.branches.filter(b => b.id !== this.branchId);
    if (otras.length === 0) return this.toast('No hay otra tienda a donde pasar la mercadería.', 'warning');

    await this.loadInventory();
    const items = (this.inventoryItems || []).filter(i => i.current_stock > 0.0005).slice();
    items.sort((a, b) => String(a.category).localeCompare(String(b.category), 'es') || String(a.name).localeCompare(String(b.name), 'es'));
    const prev = this._tr && this._tr.toId;
    this._tr = { from: this.branchId, items, busy: false, toId: otras.some(b => b.id === prev) ? prev : otras[0].id };

    document.getElementById('trFrom').textContent = (this.trBranch(this.branchId) || {}).name || '';
    document.getElementById('trTo').innerHTML = otras.map(b => `<option value="${b.id}">${escapeHtml(b.name)}</option>`).join('');
    document.getElementById('trTo').value = String(this._tr.toId);
    document.getElementById('trSwap').hidden = false;
    document.getElementById('trSearch').value = '';
    document.getElementById('trNotes').value = '';
    document.getElementById('trPick').hidden = false;
    document.getElementById('trDone').hidden = true;
    document.getElementById('trFoot').hidden = false;

    document.getElementById('trList').innerHTML = items.length === 0
      ? '<div class="empty-state"><div class="empty-icon">📦</div><p>No hay nada que pasar</p><span>En esta tienda no queda mercadería en el inventario.</span></div>'
      : items.map(item => {
        const pack = item.pack_size > 0;
        const hay = pack ? (packBreakdown(item, item.current_stock) || `${fmtBig(item.current_stock, 2)} ${item.unit}`) : `${fmtBig(item.current_stock, 2)} ${item.unit}`;
        const unitCtl = pack
          ? `<button type="button" class="tr-chip on" data-act="mode" data-mode="pack">${escapeHtml(cap1(packPlural(item.pack_name || 'botella', 2)))}</button>` +
            `<button type="button" class="tr-chip" data-act="mode" data-mode="base">${escapeHtml(item.unit)}</button>`
          : `<span class="tr-unit-one">${escapeHtml(item.unit)}</span>`;
        const nm = escapeHtml(item.name);
        return `
          <div class="tr-row" data-id="${item.id}" data-mode="${pack ? 'pack' : 'base'}" data-name="${escapeHtml(sinTildes(item.name + ' ' + item.category))}">
            <div class="tr-info"><strong>${nm}</strong><span>Hay: ${escapeHtml(hay)}</span></div>
            <div class="tr-ctl">
              <button type="button" class="tr-step" data-act="minus" aria-label="Una menos de ${nm}">−</button>
              <input type="number" step="any" min="0" class="form-control tr-qty" inputmode="decimal" aria-label="Cuánto pasar de ${nm}">
              <button type="button" class="tr-step" data-act="plus" aria-label="Una más de ${nm}">+</button>
              ${unitCtl}
              <button type="button" class="tr-chip tr-all" data-act="all">Todo</button>
            </div>
            <div class="tr-preview" data-prev></div>
          </div>`;
      }).join('');
    this.updateTransferSummary();
    if (!document.getElementById('modalTransfer').classList.contains('active')) this.openModal('modalTransfer');
  }

  filterTransferRows() {
    const q = sinTildes(document.getElementById('trSearch').value || '');
    document.querySelectorAll('#trList .tr-row').forEach(row => { row.hidden = !!q && !row.dataset.name.includes(q); });
  }

  // Lo que está escrito en una fila, en la medida del insumo (base) y como lo escribió (mode)
  readTransferRow(row) {
    const item = ((this._tr && this._tr.items) || []).find(i => i.id === Number(row.dataset.id));
    const raw = row.querySelector('.tr-qty').value.trim();
    const mode = row.dataset.mode;
    if (!item || raw === '') return { item, mode, raw, val: 0, base: 0, empty: true, invalid: false, over: false };
    const val = Number(raw);
    if (!Number.isFinite(val) || val < 0) return { item, mode, raw, val: 0, base: 0, empty: false, invalid: true, over: false };
    if (val === 0) return { item, mode, raw, val: 0, base: 0, empty: true, invalid: false, over: false };
    const base = mode === 'pack' ? val * item.pack_size : val;
    return { item, mode, raw, val, base, empty: false, invalid: false, over: base > item.current_stock + 0.0005 };
  }

  updateTransferRow(row) {
    const r = this.readTransferRow(row);
    const prev = row.querySelector('[data-prev]');
    row.classList.remove('tr-has', 'is-invalid');
    prev.className = 'tr-preview';
    if (!r.item) return;
    if (r.invalid) { row.classList.add('is-invalid'); prev.classList.add('mal'); prev.textContent = 'Revisa el número'; return; }
    if (r.empty) { prev.textContent = ''; return; }
    if (r.over) {
      row.classList.add('is-invalid'); prev.classList.add('mal');
      const hay = r.item.pack_size > 0 ? (packBreakdown(r.item, r.item.current_stock) || `${fmtBig(r.item.current_stock, 2)} ${r.item.unit}`) : `${fmtBig(r.item.current_stock, 2)} ${r.item.unit}`;
      prev.textContent = `Solo hay ${hay}. Pon menos.`;
      return;
    }
    row.classList.add('tr-has');
    const resto = Math.max(0, r.item.current_stock - r.base);
    const queda = resto < 0.0005 ? 'ya no quedará nada'
      : `quedará ${r.item.pack_size > 0 ? (packBreakdown(r.item, resto) || `${fmtBig(resto, 2)} ${r.item.unit}`) : `${fmtBig(resto, 2)} ${r.item.unit}`}`;
    prev.textContent = `Pasas ${this.trText(r.item, r.base, r.mode)} · ${queda}`;
  }

  updateTransferSummary() {
    const t = this._tr; if (!t) return;
    const rows = [...document.querySelectorAll('#trList .tr-row')];
    let n = 0, bad = 0;
    rows.forEach(row => { const r = this.readTransferRow(row); if (r.invalid || r.over) bad++; else if (!r.empty) n++; });
    const to = this.trBranch(t.toId);
    const from = this.trBranch(t.from);
    const sum = document.getElementById('trSummary');
    const go = document.getElementById('btnTransferGo');
    sum.classList.toggle('mal', bad > 0);
    if (bad > 0) sum.textContent = `Hay ${bad} ${bad === 1 ? 'renglón' : 'renglones'} en rojo: revísalos para poder pasar.`;
    else if (n === 0) sum.textContent = 'Escribe cuántas botellas quieres pasar.';
    else sum.textContent = `Vas a pasar ${n} ${n === 1 ? 'producto' : 'productos'} de ${from ? from.name : ''} a ${to ? to.name : ''}.`;
    go.disabled = t.busy || bad > 0 || n === 0;
    go.textContent = n > 0 && bad === 0 ? `🚚 Pasar ${n} ${n === 1 ? 'producto' : 'productos'}` : '🚚 Pasar';
  }

  // Clics dentro de la lista (una sola vez: −, +, botellas/oz, Todo)
  onTransferListClick(e) {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const row = btn.closest('.tr-row');
    if (!row || !this._tr) return;
    const item = this._tr.items.find(i => i.id === Number(row.dataset.id));
    if (!item) return;
    const input = row.querySelector('.tr-qty');
    const act = btn.dataset.act;
    const cur = Number(input.value) || 0;
    const mode = row.dataset.mode;
    if (act === 'plus') input.value = String(fmtNum(cur + this.trStep(item, mode), 4));
    else if (act === 'minus') input.value = cur - this.trStep(item, mode) > 0 ? String(fmtNum(cur - this.trStep(item, mode), 4)) : '';
    else if (act === 'mode') {
      const to = btn.dataset.mode;
      if (to === mode) return;
      if (cur > 0) input.value = String(fmtNum(to === 'pack' ? cur / item.pack_size : cur * item.pack_size, 4));
      row.dataset.mode = to;
      row.querySelectorAll('[data-act="mode"]').forEach(b => b.classList.toggle('on', b.dataset.mode === to));
    } else if (act === 'all') {
      // Si es un número exacto de botellas se pone en botellas; si no, en la medida del insumo para no perder ni un ml
      const packs = item.pack_size > 0 ? item.current_stock / item.pack_size : 0;
      if (item.pack_size > 0 && Math.abs(packs - Math.round(packs)) < 1e-6 && mode === 'pack') input.value = String(Math.round(packs));
      else {
        row.dataset.mode = 'base';
        row.querySelectorAll('[data-act="mode"]').forEach(b => b.classList.toggle('on', b.dataset.mode === 'base'));
        input.value = String(fmtNum(item.current_stock, 4));
      }
    }
    this.updateTransferRow(row);
    this.updateTransferSummary();
  }

  async submitTransfer() {
    const t = this._tr;
    if (!t || t.busy) return;
    const lines = [], detail = [];
    for (const row of document.querySelectorAll('#trList .tr-row')) {
      const r = this.readTransferRow(row);
      if (r.invalid || r.over || r.empty) continue;
      lines.push(r.mode === 'pack' ? { inventory_item_id: r.item.id, packs: r.val } : { inventory_item_id: r.item.id, quantity: r.val });
      detail.push(`• ${this.trText(r.item, r.base, r.mode)} de ${r.item.name}`);
    }
    if (lines.length === 0) return this.toast('Escribe cuánto quieres pasar.', 'warning');
    const from = this.trBranch(t.from), to = this.trBranch(t.toId);
    const shown = detail.length > 12 ? detail.slice(0, 12).concat(`…y ${detail.length - 12} más`) : detail;
    const ok = await this.confirmDialog(
      `Vas a pasar de ${from.name} a ${to.name}:\n${shown.join('\n')}\n\nSe resta en ${from.name} y se suma en ${to.name}.`,
      { title: '¿Pasar la mercadería?', yes: 'Sí, pasar', no: 'No, volver' }
    );
    if (!ok) return;
    t.busy = true; this.updateTransferSummary();
    try {
      const cuerpo = JSON.stringify({ from_branch_id: t.from, to_branch_id: t.toId, notes: document.getElementById('trNotes').value, lines });
      const res = await this.api('/api/transfers', { method: 'POST', body: cuerpo, key: this.idemKey('traspaso', cuerpo) });
      this.idemDone('traspaso');
      this.renderTransferDone(res);
      this.loadInventory();
      this.loadCatalog();
    } catch (err) {
      this.toast(friendlyError(err), 'error');
    } finally {
      t.busy = false;
      this.updateTransferSummary();
    }
  }

  renderTransferDone(res) {
    const t = this._tr;
    const find = (id) => t.items.find(i => i.id === id);
    const fmtQ = (item, q) => (item && item.pack_size > 0 ? (packBreakdown(item, q) || `0 ${item.unit}`) : `${fmtBig(q, 2)} ${item ? item.unit : ''}`);
    const lines = (res.lines || []).map(l => {
      const item = find(l.inventory_item_id);
      return `<li>${escapeHtml(l.name)}: ${escapeHtml(l.texto)}
        <small>En ${escapeHtml(res.transfer.from.name)} quedan ${escapeHtml(fmtQ(item, l.origen_despues))} · en ${escapeHtml(res.transfer.to.name)} hay ${escapeHtml(fmtQ(item, l.destino_despues))}</small></li>`;
    }).join('');
    const bajos = (res.low_after || []).length
      ? `<div class="tr-warn">⚠️ Ojo, en ${escapeHtml(res.transfer.from.name)} ya queda poco de: ${res.low_after.map(b => `${escapeHtml(b.name)} (${escapeHtml(b.queda_texto)})`).join(', ')}.</div>` : '';
    const done = document.getElementById('trDone');
    done.innerHTML = `
      <h4>✅ Listo · ${escapeHtml(res.transfer.folio)}</h4>
      <p>${escapeHtml(res.message || '')}</p>
      <ul>${lines}</ul>
      ${bajos}
      <div class="count-actions">
        <button type="button" class="btn btn-secondary btn-lg" id="btnTransferAgain">🚚 Pasar otra cosa</button>
        <button type="button" class="btn btn-primary btn-lg" onclick="app.closeModal('modalTransfer')">Listo</button>
      </div>`;
    document.getElementById('btnTransferAgain').onclick = () => this.openTransferModal();
    document.getElementById('trPick').hidden = true;
    document.getElementById('trFoot').hidden = true;
    done.hidden = false;
    const body = document.getElementById('trBody'); if (body) body.scrollTop = 0;
  }

  async openTransfersModal() {
    const body = document.getElementById('transfersBody');
    body.innerHTML = '<p class="help-text">Cargando…</p>';
    this.openModal('modalTransfers');
    try {
      const data = await this.api('/api/transfers?limit=60');
      const list = data.transfers || [];
      if (list.length === 0) { body.innerHTML = '<div class="empty-state"><div class="empty-icon">🚚</div><p>Todavía no se ha pasado nada entre tiendas</p><span>Cuando pases mercadería, aquí queda el registro.</span></div>'; return; }
      body.innerHTML = list.map(tr => `
        <div class="tr-hist">
          <div class="tr-hist-top"><strong>${escapeHtml(tr.folio)} · ${escapeHtml(tr.from_branch_name)} ➜ ${escapeHtml(tr.to_branch_name)}</strong><span>${escapeHtml(fmtDateTime(tr.created_at))}${tr.user_name ? ' · ' + escapeHtml(tr.user_name) : ''}</span></div>
          <ul>${(tr.lines || []).map(l => {
            const packs = l.pack_size > 0 ? l.quantity / l.pack_size : 0;
            const txt = l.pack_size > 0 && Math.abs(packs - Math.round(packs)) < 1e-6
              ? `${Math.round(packs)} ${packPlural(l.pack_name || 'botella', Math.round(packs))}` : `${fmtBig(l.quantity, 2)} ${l.unit}`;
            return `<li>${escapeHtml(txt)} de ${escapeHtml(l.item_name)}</li>`;
          }).join('')}</ul>
          ${tr.notes ? `<div class="tr-nota">“${escapeHtml(tr.notes)}”</div>` : ''}
        </div>`).join('');
    } catch (err) {
      body.innerHTML = `<p class="ml-error">${escapeHtml(friendlyError(err))}</p>`;
    }
  }

  // ---- Contar inventario: lo que hay de verdad contra lo que dice el sistema ----
  async openCountModal() {
    await this.loadInventory();
    const items = (this.inventoryItems || []).slice();
    const LIQ = ['Licores Líquido', 'Líquidos Insumo', 'Líquidos Barril'];
    const prio = (c) => { const i = LIQ.indexOf(c); return i < 0 ? 99 : i; };
    items.sort((a, b) => prio(a.category) - prio(b.category) || String(a.category).localeCompare(b.category, 'es') || String(a.name).localeCompare(b.name, 'es'));
    this._count = { items, busy: false, saved: false };

    const cats = [...new Set(items.map(i => i.category))];
    document.getElementById('countCat').innerHTML =
      '<option value="all">Todo el inventario</option>' +
      (items.some(i => LIQ.includes(i.category)) ? '<option value="__liq">💧 Solo licores y líquidos</option>' : '') +
      cats.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
    document.getElementById('countSearch').value = '';
    document.getElementById('countNotes').value = '';

    document.getElementById('countRows').innerHTML = items.length === 0
      ? '<div class="empty-state"><div class="empty-icon">📦</div><p>Todavía no hay nada en el inventario</p><span>Agrega insumos para poder contarlos.</span></div>'
      : items.map(item => {
        const hasPack = item.pack_size > 0;
        const main = hasPack ? (packBreakdown(item, item.current_stock) || `0 ${item.unit}`) : `${fmtNum(item.current_stock)} ${item.unit}`;
        const sub = hasPack && item.current_stock > 0 ? `${fmtNum(item.current_stock)} ${item.unit} en total` : '';
        const openLbl = (item.unit in VOL_ML) ? `En la abierta (${item.unit})` : `Sueltas (${item.unit})`;
        const inputs = hasPack
          ? `<label>${escapeHtml(cap1(packPlural(item.pack_name, 2)))}<input type="number" step="any" min="0" class="form-control count-packs" inputmode="decimal" aria-label="${escapeHtml(cap1(packPlural(item.pack_name, 2)))} de ${escapeHtml(item.name)}"></label>` +
            `<label>${escapeHtml(openLbl)}<input type="number" step="any" min="0" class="form-control count-open" inputmode="decimal" aria-label="${escapeHtml(openLbl)} de ${escapeHtml(item.name)}"></label>`
          : `<label>${escapeHtml(item.unit)}<input type="number" step="any" min="0" class="form-control count-qty" inputmode="decimal" aria-label="Cantidad contada de ${escapeHtml(item.name)}"></label>`;
        return `
          <div class="count-row" data-id="${item.id}" data-cat="${escapeHtml(item.category)}" data-name="${escapeHtml(sinTildes(item.name + ' ' + item.category))}">
            <div class="count-name"><strong>${escapeHtml(item.name)}</strong><span class="inv-cat">${escapeHtml(item.category || '')}</span></div>
            <div class="count-expected"><small>Debería haber</small><strong>${escapeHtml(main)}</strong>${sub ? `<span>${escapeHtml(sub)}</span>` : ''}</div>
            <div class="count-inputs">${inputs}</div>
            <div class="count-diff" data-diff>—</div>
          </div>`;
      }).join('');

    this.showCountTab('new');
    this.updateCountSummary();
    if (!document.getElementById('modalCount').classList.contains('active')) this.openModal('modalCount');
  }

  filterCountRows() {
    const q = sinTildes(document.getElementById('countSearch').value || '');
    const cat = document.getElementById('countCat').value;
    const LIQ = ['Licores Líquido', 'Líquidos Insumo', 'Líquidos Barril'];
    document.querySelectorAll('#countRows .count-row').forEach(row => {
      const okCat = cat === 'all' || (cat === '__liq' ? LIQ.includes(row.dataset.cat) : row.dataset.cat === cat);
      row.hidden = !(okCat && (!q || row.dataset.name.includes(q)));
    });
  }

  // Lo contado en una fila, en la medida del insumo. counted = null si no escribieron nada
  readCountRow(row) {
    const item = (this._count.items || []).find(i => i.id === Number(row.dataset.id));
    const val = (sel) => { const el = row.querySelector(sel); return el ? el.value.trim() : ''; };
    let counted = null, invalid = false;
    if (item.pack_size > 0) {
      const a = val('.count-packs'), b = val('.count-open');
      if (a !== '' || b !== '') {
        const na = a === '' ? 0 : Number(a), nb = b === '' ? 0 : Number(b);
        if (!Number.isFinite(na) || !Number.isFinite(nb) || na < 0 || nb < 0) invalid = true;
        else counted = Math.round((na * item.pack_size + nb) * 1e4) / 1e4;
      }
    } else {
      const a = val('.count-qty');
      if (a !== '') {
        const na = Number(a);
        if (!Number.isFinite(na) || na < 0) invalid = true; else counted = na;
      }
    }
    return { item, counted, invalid };
  }

  // Muestra la diferencia de una fila y la deja marcada
  updateCountRow(row) {
    const { item, counted, invalid } = this.readCountRow(row);
    const cell = row.querySelector('[data-diff]');
    row.classList.remove('has-diff-bad', 'has-diff-ok');
    cell.className = 'count-diff';
    if (invalid) { cell.innerHTML = 'Revisa el número'; cell.classList.add('is-short'); return; }
    if (counted === null) { cell.textContent = '—'; return; }
    let diff = Math.round((counted - item.current_stock) * 1e4) / 1e4;
    if (Math.abs(diff) < 0.0001) diff = 0;
    const value = Math.round(diff * item.cost_per_unit * 100) / 100;
    if (diff === 0) { cell.innerHTML = '✔ Cuadra'; cell.classList.add('is-match'); row.classList.add('has-diff-ok'); return; }
    const pk = item.pack_size > 0 ? ` (≈ ${fmtNum(Math.abs(diff) / item.pack_size)} ${item.pack_name})` : '';
    cell.innerHTML = `${diff < 0 ? 'Faltan' : 'Sobran'} ${fmtNum(Math.abs(diff))} ${escapeHtml(item.unit)}${escapeHtml(pk)}<small>${signedMoney(value)}</small>`;
    cell.classList.add(diff < 0 ? 'is-short' : 'is-over');
    row.classList.add('has-diff-bad');
  }

  updateCountSummary() {
    const rows = [...document.querySelectorAll('#countRows .count-row')];
    let n = 0, missing = 0, surplus = 0;
    rows.forEach(row => {
      const { item, counted, invalid } = this.readCountRow(row);
      if (invalid || counted === null) return;
      n++;
      let diff = Math.round((counted - item.current_stock) * 1e4) / 1e4;
      if (Math.abs(diff) < 0.0001) diff = 0;
      const v = Math.round(diff * item.cost_per_unit * 100) / 100;
      if (v < 0) missing += -v; else surplus += v;
    });
    const net = Math.round((surplus - missing) * 100) / 100;
    document.getElementById('countSummary').innerHTML =
      `<span>Contados: <strong>${n}</strong> de ${rows.length}</span>` +
      `<span class="is-short">Faltan: <strong>${money(missing)}</strong></span>` +
      `<span class="is-over">Sobran: <strong>${money(surplus)}</strong></span>` +
      `<span>Diferencia: <strong>${signedMoney(net)}</strong></span>`;
  }

  showCountTab(tab) {
    document.querySelectorAll('[data-count-tab]').forEach(b => b.classList.toggle('active', b.dataset.countTab === (tab === 'result' ? 'new' : tab)));
    document.getElementById('countPaneNew').hidden = tab !== 'new';
    document.getElementById('countPaneHistory').hidden = tab !== 'history';
    document.getElementById('countPaneResult').hidden = tab !== 'result';
    document.getElementById('countFoot').hidden = tab !== 'new';
    if (tab === 'history') this.loadCountHistory();
    const body = document.querySelector('#modalCount .modal-body');
    if (body) body.scrollTop = 0;
  }

  async saveCount(adjust) {
    if (!this._count || this._count.busy) return;
    const lines = [];
    let bad = null;
    document.querySelectorAll('#countRows .count-row').forEach(row => {
      const r = this.readCountRow(row);
      if (r.invalid) { row.classList.add('is-invalid'); if (!bad) bad = row; return; }
      if (r.counted !== null) lines.push({ inventory_item_id: r.item.id, counted: r.counted, _item: r.item });
    });
    if (bad) {
      try { bad.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { /* ok */ }
      this.toast('Hay un número que no sirve. Revisa la fila marcada en rojo.', 'warning');
      return;
    }
    if (lines.length === 0) {
      this.toast('Escribe lo que contaste de al menos un insumo.', 'warning');
      return;
    }
    if (adjust) {
      const nDiff = lines.filter(l => Math.abs(l.counted - l._item.current_stock) >= 0.0001).length;
      const ok = await this.confirmDialog(
        nDiff === 0
          ? 'Todo lo que contaste cuadra con el sistema, así que no hay nada que corregir. ¿Guardar el conteo de todos modos?'
          : `El inventario de ${nDiff} insumo${nDiff === 1 ? '' : 's'} se va a cambiar para que quede exactamente como lo contaste.\n\nQuedará anotado en el historial. ¿Corregir?`,
        { title: '¿Corregir el inventario?', yes: 'Sí, corregir', no: 'No, volver' });
      if (!ok) return;
    }
    this._count.busy = true;
    const btns = [document.getElementById('btnCountSave'), document.getElementById('btnCountAdjust')];
    btns.forEach(b => { b.disabled = true; });
    try {
      const cuerpo = JSON.stringify({ lines: lines.map(l => ({ inventory_item_id: l.inventory_item_id, counted: l.counted })), adjust, notes: document.getElementById('countNotes').value });
      const res = await this.api('/api/inventory/count', { method: 'POST', body: cuerpo, key: this.idemKey('conteo', cuerpo + '|' + this.branchId) });
      this.idemDone('conteo');
      this.toast(res.message);
      this._count.saved = true;
      this.renderCountResult(res.count, res.lines, { fresh: true });
      this.loadInventory();
      this.loadCatalog();
    } catch (err) {
      this.toast(friendlyError(err), 'error');
    } finally {
      this._count.busy = false;
      btns.forEach(b => { b.disabled = false; });
    }
  }

  // Resultado de un conteo (recién guardado o del historial)
  renderCountResult(count, lines, { fresh = false } = {}) {
    const net = Math.round(((count.surplus_value || 0) - (count.missing_value || 0)) * 100) / 100;
    const withDiff = lines.filter(l => Math.abs(l.difference) >= 0.0001).length;
    const rows = lines.map(l => {
      const cls = Math.abs(l.difference) < 0.0001 ? 'is-match' : l.difference < 0 ? 'is-short' : 'is-over';
      const d = Math.abs(l.difference) < 0.0001 ? '✔ Cuadra' : `${l.difference < 0 ? '−' : '+'}${fmtNum(Math.abs(l.difference))} ${escapeHtml(l.unit)}`;
      return `<tr>
        <td><strong>${escapeHtml(l.item_name)}</strong></td>
        <td data-label="Debía haber">${fmtNum(l.expected)} ${escapeHtml(l.unit)}</td>
        <td data-label="Se contó">${fmtNum(l.counted)} ${escapeHtml(l.unit)}</td>
        <td class="${cls}" data-label="Diferencia">${d}</td>
        <td class="${cls}" data-label="Valor">${Math.abs(l.diff_value) < 0.005 ? '—' : signedMoney(l.diff_value)}</td>
      </tr>`;
    }).join('');
    const pane = document.getElementById('countPaneResult');
    pane.innerHTML = `
      <div class="count-result-head">
        <h4>Conteo ${count.created_at ? 'del ' + escapeHtml(fmtDateTime(count.created_at)) : 'recién hecho'}</h4>
        <div class="count-result-meta">${count.user_name ? escapeHtml(count.user_name) + ' · ' : ''}${count.lines_count} insumo${count.lines_count === 1 ? '' : 's'} contado${count.lines_count === 1 ? '' : 's'}, ${withDiff} con diferencia${count.notes ? ' · “' + escapeHtml(count.notes) + '”' : ''}</div>
        <div class="count-kpis">
          <div class="count-kpi is-short"><small>Faltan</small><strong>${money(count.missing_value)}</strong></div>
          <div class="count-kpi is-over"><small>Sobran</small><strong>${money(count.surplus_value)}</strong></div>
          <div class="count-kpi"><small>Diferencia total</small><strong>${signedMoney(net)}</strong></div>
        </div>
        <div class="count-note">${count.adjusted ? '✅ El inventario se corrigió con lo que se contó.' : 'ℹ️ El inventario NO se cambió: solo quedó anotada la diferencia.'}</div>
      </div>
      <div class="table-responsive">
        <table class="count-lines">
          <thead><tr><th>Insumo</th><th>Debía haber</th><th>Se contó</th><th>Diferencia</th><th>Valor</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="count-actions" style="margin-top: 1rem;">
        ${fresh
          ? '<button type="button" class="btn btn-secondary btn-lg" id="btnCountAgain">📝 Hacer otro conteo</button><button type="button" class="btn btn-primary btn-lg" onclick="app.closeModal(\'modalCount\')">Listo</button>'
          : '<button type="button" class="btn btn-secondary btn-lg" id="btnCountBack">← Volver a la lista</button><button type="button" class="btn btn-primary btn-lg" onclick="app.closeModal(\'modalCount\')">Cerrar</button>'}
      </div>`;
    const again = document.getElementById('btnCountAgain');
    if (again) again.onclick = () => this.openCountModal();
    const back = document.getElementById('btnCountBack');
    if (back) back.onclick = () => this.showCountTab('history');
    this.showCountTab('result');
  }

  async loadCountHistory() {
    const pane = document.getElementById('countPaneHistory');
    pane.innerHTML = '<p class="help-text">Cargando…</p>';
    try {
      const data = await this.api('/api/inventory/counts');
      if (!data.counts.length) {
        pane.innerHTML = '<div class="empty-state"><div class="empty-icon">📋</div><p>Todavía no has hecho ningún conteo</p><span>Toca “📝 Contar ahora” para hacer el primero.</span></div>';
        return;
      }
      pane.innerHTML = '<div class="count-hist">' + data.counts.map(c => `
        <button type="button" class="count-hist-item" data-count-id="${c.id}">
          <strong>${escapeHtml(fmtDateTime(c.created_at))}${c.user_name ? ' · ' + escapeHtml(c.user_name) : ''}</strong>
          <span>${c.lines_count} insumo${c.lines_count === 1 ? '' : 's'} contado${c.lines_count === 1 ? '' : 's'} · ${c.adjusted ? '✅ se corrigió el inventario' : 'solo se anotó'}${c.notes ? ' · “' + escapeHtml(c.notes) + '”' : ''}</span>
          <span><span class="is-short">Faltaron ${money(c.missing_value)}</span> · <span class="is-over">Sobraron ${money(c.surplus_value)}</span></span>
        </button>`).join('') + '</div>';
      pane.querySelectorAll('[data-count-id]').forEach(btn => { btn.onclick = () => this.openCountDetail(btn.dataset.countId); });
    } catch (err) {
      pane.innerHTML = '';
      this.toast('No se pudieron cargar los conteos. ' + friendlyError(err), 'error');
    }
  }

  async openCountDetail(id) {
    try {
      const data = await this.api(`/api/inventory/counts/${id}`);
      this.renderCountResult(data.count, data.lines, { fresh: false });
    } catch (err) {
      this.toast(friendlyError(err), 'error');
    }
  }

  // ===================================================
  // PRODUCTS & RECIPES MODULE (ADMIN ONLY)
  // ===================================================
  async loadAdminProducts() {
    try {
      const data = await this.api('/api/admin/products');
      const tbody = document.getElementById('productsTableBody');
      this.adminProducts = data.products || [];

      this.updatePricesButton();
      this.setupMenuControls();
      this.renderAdminProducts();
    } catch (err) {
      this.toast('No se pudo cargar el menú. ' + friendlyError(err), 'error');
    }
  }

  // Buscar y filtrar el menú (se conectan una sola vez)
  setupMenuControls() {
    if (this._menuControls) return;
    this._menuControls = true;
    this.menuFilter = 'all';
    this.menuQuery = '';
    const search = document.getElementById('menuSearch');
    if (search) search.oninput = () => { this.menuQuery = search.value; this.renderAdminProducts(); };
    document.querySelectorAll('#menuFilters [data-menu-filter]').forEach(btn => {
      btn.onclick = () => {
        this.menuFilter = btn.dataset.menuFilter;
        document.querySelectorAll('#menuFilters [data-menu-filter]').forEach(b => b.classList.toggle('active', b === btn));
        this.renderAdminProducts();
      };
    });
  }

  renderAdminProducts() {
    const tbody = document.getElementById('productsTableBody');
    if (!tbody) return;
    const todos = this.adminProducts || [];
    const estaPausado = (p) => !p.is_active || !!p.paused_here;

    // números de los filtros
    const cuenta = { all: todos.length, sale: todos.filter(p => !estaPausado(p)).length, paused: todos.filter(p => estaPausado(p)).length };
    document.querySelectorAll('#menuFilters [data-menu-count]').forEach(el => { el.textContent = cuenta[el.dataset.menuCount] ?? 0; });

    if (todos.length === 0) {
      tbody.innerHTML = `<tr><td colspan="3"><div class="empty-state"><div class="empty-icon">📋</div><p>Todavía no hay productos en el menú</p><span>Toca “➕ Agregar un producto” para crear el primero.</span></div></td></tr>`;
      return;
    }
    const q = sinTildes(this.menuQuery || '');
    const lista = todos.filter(p => {
      if (this.menuFilter === 'sale' && estaPausado(p)) return false;
      if (this.menuFilter === 'paused' && !estaPausado(p)) return false;
      return !q || sinTildes(`${p.name} ${p.category_name || ''}`).includes(q);
    });
    if (lista.length === 0) {
      tbody.innerHTML = `<tr><td colspan="3"><div class="empty-state"><div class="empty-icon">🔎</div><p>No hay productos con ese filtro</p><span>Borra lo que escribiste o toca “Todos”.</span></div></td></tr>`;
      return;
    }
    {
      const adminProducts = lista;

      // Agrupado por sección, en el mismo orden en que se ven en "Vender"
      const orden = new Map((this.categories || []).map((c, i) => [c.id, i]));
      const grupos = new Map();
      for (const p of adminProducts) {
        if (!grupos.has(p.category_id)) grupos.set(p.category_id, { nombre: p.category_name || 'Sin sección', icono: (this.categories || []).find(c => c.id === p.category_id)?.icon || '🍽️', items: [] });
        grupos.get(p.category_id).items.push(p);
      }
      const ids = [...grupos.keys()].sort((a, b) => (orden.has(a) ? orden.get(a) : 999) - (orden.has(b) ? orden.get(b) : 999));

      tbody.innerHTML = ids.map(cid => {
        const g = grupos.get(cid);
        const filas = g.items.map(p => {
          const pausado = !p.is_active || !!p.paused_here;
          const parcial = !pausado && !!p.paused_some;   // solo se ve cuando se miran varias sucursales juntas
          const dondeParcial = parcial ? this.branchNames(p.paused_branch_ids) : '';
          return `
          <tr class="${pausado ? 'row-paused' : ''}">
            <td>
              <div class="prod-name-cell">
                <span class="admin-thumb" aria-hidden="true">${drinkImageHtml(p)}</span>
                <div>
                  <strong>${escapeHtml(p.name)}</strong>
                  ${p.badge ? `<span class="product-badge" style="position: static; margin-left: 6px;">${escapeHtml(p.badge)}</span>` : ''}
                  ${(p.options && p.options.length) ? `<span class="badge-status opt-list-tag" style="margin-left: 6px;">🍺 Elige: ${escapeHtml(p.options.map(o => o.label).join(' / '))}</span>` : ''}
                  ${pausado ? '<span class="badge-status critical" style="margin-left: 6px;">⏸️ Pausado</span>' : ''}
                  ${parcial ? `<span class="badge-status warning" style="margin-left: 6px;">⏸️ Pausado en ${escapeHtml(dondeParcial)}</span>` : ''}
                  <div class="prod-price-mobile">${money(p.price)}</div>
                </div>
              </div>
            </td>
            <td class="col-price"><strong style="color: var(--accent-amber); font-size: 1.1rem;">${money(p.price)}</strong></td>
            <td>
              <div class="row-actions">
                <button class="btn btn-secondary btn-sm" onclick="app.openEditProduct(${p.id})" aria-label="Cambiar ${escapeHtml(p.name)}">✏️ Cambiar</button>
                <button class="btn btn-secondary btn-sm" onclick="app.toggleProductActive(${p.id})" aria-label="${pausado ? 'Volver a vender' : 'Pausar'} ${escapeHtml(p.name)}" title="${pausado ? 'Vuelve a aparecer en “Vender”' : 'Deja de aparecer en “Vender” (por ejemplo, si se acabó)'}${this.multiBranch ? ` — ${escapeHtml(this.branchScopeName())}` : ''}">${pausado ? '▶️ Volver a vender' : (parcial ? '⏸️ Pausar en todas' : '⏸️ Pausar')}</button>
                <button class="btn btn-secondary btn-sm btn-danger-soft" onclick="app.deleteProduct(${p.id})" aria-label="Quitar ${escapeHtml(p.name)} del menú">🗑️ Quitar</button>
              </div>
            </td>
          </tr>`;
        }).join('');
        return `<tr class="section-row"><th colspan="3" scope="colgroup">${escapeHtml(g.icono)} ${escapeHtml(g.nombre)} <small>(${g.items.length})</small></th></tr>${filas}`;
      }).join('');
    }
  }

  // Productos sin precio (cargados desde una lista): se piden en una sola pantalla
  pricelessProducts() {
    return (this.adminProducts || []).filter(p => !(Number(p.price) > 0));
  }

  updatePricesButton() {
    const btn = document.getElementById('btnSetPrices');
    if (!btn) return;
    const n = this.pricelessProducts().length;
    btn.style.display = n > 0 ? '' : 'none';
    const c = document.getElementById('pricesPendingCount');
    if (c) c.textContent = n > 0 ? `(${n})` : '';
  }

  openPricesModal() {
    const lista = this.pricelessProducts();
    const cont = document.getElementById('pricesList');
    if (!lista.length) { this.toast('Todos tus productos ya tienen precio.'); return; }
    const orden = new Map((this.categories || []).map((c, i) => [c.id, i]));
    lista.sort((a, b) => ((orden.has(a.category_id) ? orden.get(a.category_id) : 999) - (orden.has(b.category_id) ? orden.get(b.category_id) : 999)) || String(a.name).localeCompare(String(b.name), 'es'));
    let seccionActual = null;
    cont.innerHTML = lista.map(p => {
      const cab = p.category_id !== seccionActual
        ? `<div class="prices-section">${escapeHtml((this.categories || []).find(c => c.id === p.category_id)?.icon || '🍽️')} ${escapeHtml(p.category_name || 'Sin sección')}</div>` : '';
      seccionActual = p.category_id;
      return `${cab}
        <label class="price-row" for="price_${p.id}">
          <span class="price-row-name">${escapeHtml(p.name)}</span>
          <span class="price-row-input"><span aria-hidden="true">Q</span>
            <input type="number" id="price_${p.id}" data-price-id="${p.id}" inputmode="decimal" min="0" step="any" placeholder="0.00" class="form-control price-input" aria-label="Precio de ${escapeHtml(p.name)}">
          </span>
        </label>`;
    }).join('');
    const save = document.getElementById('btnPricesSave');
    const refresh = () => {
      const n = this.collectPrices().length;
      save.disabled = n === 0 || !!this._savingPrices;
      save.textContent = n > 0 ? `Guardar ${n} ${n === 1 ? 'precio' : 'precios'}` : 'Guardar precios';
    };
    cont.oninput = refresh;
    cont.onkeydown = (e) => {
      // Enter pasa al siguiente precio (más rápido en tableta); no envía nada
      if (e.key === 'Enter' && e.target.matches && e.target.matches('.price-input')) {
        e.preventDefault();
        const todos = [...cont.querySelectorAll('.price-input')];
        const i = todos.indexOf(e.target);
        (todos[i + 1] || save).focus();
      }
    };
    save.onclick = () => this.savePrices();
    refresh();
    this.openModal('modalPrices');
  }

  collectPrices() {
    const out = [];
    document.querySelectorAll('#pricesList .price-input').forEach(inp => {
      const v = parseFloat(String(inp.value).replace(',', '.'));
      if (Number.isFinite(v) && v > 0) out.push({ id: Number(inp.dataset.priceId), price: Math.round(v * 100) / 100 });
    });
    return out;
  }

  async savePrices() {
    if (this._savingPrices) return;
    const prices = this.collectPrices();
    if (!prices.length) return;
    this._savingPrices = true;
    document.getElementById('btnPricesSave').disabled = true;
    try {
      const r = await this.api('/api/admin/products/prices', { method: 'POST', body: JSON.stringify({ prices }) });
      this.closeModal('modalPrices');
      this.toast(`✔ ${r.updated} ${r.updated === 1 ? 'producto listo' : 'productos listos'} para vender.`);
      await this.loadAdminProducts();
      if (typeof this.branchId === 'number') this.loadCatalog();
      if (this.pricelessProducts().length) this.toast(`Quedan ${this.pricelessProducts().length} sin precio (pausados).`);
    } catch (err) {
      this.toast(friendlyError(err), 'error');
    } finally {
      this._savingPrices = false;
    }
  }

  branchNames(ids) {
    return (ids || []).map(id => (this.branches.find(b => b.id === id) || {}).name).filter(Boolean).join(', ');
  }

  // Pausar / volver a vender un producto (sin borrarlo)
  // Pausa o reanuda en la sucursal elegida arriba (o en todas, si se están viendo "Ambas").
  async toggleProductActive(id) {
    const p = (this.adminProducts || []).find(x => x.id === id);
    if (!p) return;
    const pausadoAhora = !p.is_active || !!p.paused_here;
    const pausar = !pausadoAhora;
    const donde = this.multiBranch ? ` en ${this.branchScopeName()}` : '';
    try {
      await this.api(`/api/admin/products/${id}/pause`, { method: 'PUT', body: JSON.stringify({ paused: pausar }) });
      this.toast(pausar ? `⏸️ “${p.name}” está pausado${donde}: ya no aparece en “Vender”.` : `✔ “${p.name}” vuelve a estar a la venta${donde}.`);
      await this.loadAdminProducts();
      if (typeof this.branchId === 'number') this.loadCatalog();
    } catch (err) {
      this.toast(friendlyError(err), 'error');
    }
  }

  // La lista de insumos (para la receta) se pide cada vez que se abre el cuadro del producto.
  // Antes solo se cargaba al visitar "Inventario": si abrías el Menú primero, los ingredientes salían en blanco
  // y al guardar se borraba la receta del producto.
  async ensureInventoryItems() {
    try {
      // En "Ambas" no hay una sola sucursal, pero la lista de insumos es la misma en todas: se pide la primera.
      const opts = typeof this.branchId === 'number' || !this.branches.length ? {} : { headers: { 'X-Branch-Id': String(this.branches[0].id) } };
      const d = await this.api('/api/inventory', opts);
      if (d && Array.isArray(d.items)) this.inventoryItems = d.items;
    } catch (e) { /* si falla, se usa la lista que ya había */ }
  }

  async openNewProductModal() {
    await this.ensureInventoryItems();
    document.getElementById('productModalTitle').textContent = 'Agregar un producto';
    document.getElementById('prodEditId').value = '';
    document.getElementById('prodName').value = '';
    document.getElementById('prodDescription').value = '';
    document.getElementById('prodPrice').value = '';
    document.getElementById('prodBadge').value = '';
    document.getElementById('prodStockMode').value = 'none';
    document.getElementById('prodActiveGroup').style.display = 'none';
    document.getElementById('prodIsActive').checked = true;
    document.getElementById('prodMore').open = false;

    this.populateProductSelects();
    this.renderRecipeRows([]);
    this.renderProdOptionRows([]);
    this.toggleProductTypeSections('none');
    this.resetProductPhoto(null);
    this.openModal('modalProduct');
  }

  openEditProduct(productId) {
    Promise.all([this.api('/api/admin/products'), this.ensureInventoryItems()]).then(([res]) => {
      const prod = res.products.find(p => p.id === productId);
      if (!prod) return;

      document.getElementById('productModalTitle').textContent = `Cambiar: ${prod.name}`;
      document.getElementById('prodEditId').value = prod.id;
      document.getElementById('prodName').value = prod.name;
      document.getElementById('prodDescription').value = prod.description || '';
      document.getElementById('prodPrice').value = prod.price;
      document.getElementById('prodBadge').value = prod.badge || '';
      // Cómo baja el inventario: no baja / se vende tal cual / lleva receta
      const modo = (prod.is_direct_sale && prod.direct_inventory_item_id) ? 'direct'
                 : (!prod.is_direct_sale && prod.recipe && prod.recipe.length > 0) ? 'recipe' : 'none';
      document.getElementById('prodStockMode').value = modo;
      document.getElementById('prodActiveGroup').style.display = 'block';
      document.getElementById('prodIsActive').checked = !!prod.is_active;
      document.getElementById('prodMore').open = !!(prod.description || prod.badge || modo !== 'none' || (prod.options && prod.options.length));

      this.populateProductSelects();
      document.getElementById('prodCategory').value = prod.category_id;
      if (prod.direct_inventory_item_id) {
        document.getElementById('prodDirectItem').value = prod.direct_inventory_item_id;
      }

      this.renderRecipeRows(prod.recipe || []);
      this.renderProdOptionRows(prod.options || []);
      this.toggleProductTypeSections(modo);
      this.resetProductPhoto(prod);
      this.openModal('modalProduct');
    }).catch(err => this.toast(friendlyError(err), 'error'));
  }

  // ----- Presentaciones que elige el cliente (cuadro de agregar / cambiar producto) -----
  prodOptionRowHtml(o = {}) {
    const itemId = o.inventory_item_id;
    const sel = this.inventoryItems.map(item => `<option value="${item.id}" ${item.id === itemId ? 'selected' : ''}>${escapeHtml(item.name)} (${escapeHtml(item.unit)})</option>`).join('');
    const unit = (this.inventoryItems.find(i => i.id === itemId) || this.inventoryItems[0] || {}).unit || '';
    return `
      <div class="prod-option-row" ${o.id ? `data-opt-id="${Number(o.id)}"` : ''}>
        <input type="text" class="form-control form-control-sm opt-label" maxlength="40" value="${escapeHtml(o.label || '')}" placeholder="Nombre. Ej: Gallo de lata" aria-label="Nombre de la opción">
        <select class="form-control form-control-sm opt-item" aria-label="Qué se descuenta del inventario">${sel}</select>
        <input type="number" step="any" min="0" class="form-control form-control-sm opt-qty" value="${o.quantity === undefined ? 1 : Number(o.quantity)}" inputmode="decimal" aria-label="Cantidad que se descuenta">
        <span class="opt-unit help-text">${escapeHtml(unit)}</span>
        <button type="button" class="btn btn-secondary btn-sm btn-danger-soft" data-act="del-opt" aria-label="Quitar esta opción">✕ Quitar</button>
      </div>`;
  }

  renderProdOptionRows(options = []) {
    const box = document.getElementById('prodOptionsList');
    if (!box) return;
    box.innerHTML = (options || []).length
      ? options.map(o => this.prodOptionRowHtml(o)).join('')
      : '<p class="help-text" id="noProdOptionsMsg">Sin opciones: el cliente no elige nada y se agrega con un toque.</p>';
    this.refreshProdOptionsUi();
  }

  addProdOptionRow() {
    const box = document.getElementById('prodOptionsList');
    if (!box) return;
    if (box.querySelectorAll('.prod-option-row').length >= 6) {
      this.toast('Máximo 6 opciones por producto.', 'warning');
      return;
    }
    const msg = document.getElementById('noProdOptionsMsg');
    if (msg) msg.remove();
    box.insertAdjacentHTML('beforeend', this.prodOptionRowHtml({}));
    this.refreshProdOptionsUi();
    const last = box.querySelector('.prod-option-row:last-child .opt-label');
    if (last) { try { last.focus({ preventScroll: false }); } catch (e) { /* ok */ } }
  }

  // Mantiene al día la unidad de cada fila y el costo estimado
  refreshProdOptionsUi() {
    document.querySelectorAll('.prod-option-row').forEach(row => {
      const inv = this.inventoryItems.find(i => i.id === parseInt(row.querySelector('.opt-item').value, 10));
      row.querySelector('.opt-unit').textContent = inv ? inv.unit : '';
    });
    this.calculateRecipeCosts();
  }

  // Lee las filas de opciones. Una fila vacía (sin nombre) se descarta; todo lo demás lo valida el servidor.
  collectProdOptions() {
    const out = [];
    document.querySelectorAll('.prod-option-row').forEach(row => {
      const label = row.querySelector('.opt-label').value.trim();
      if (!label) return;
      const o = {
        label,
        inventory_item_id: parseInt(row.querySelector('.opt-item').value, 10),
        quantity: parseFloat(row.querySelector('.opt-qty').value)
      };
      if (row.dataset.optId) o.id = Number(row.dataset.optId);
      out.push(o);
    });
    return out;
  }

  // ----- Foto del producto (cuadro de agregar / cambiar producto) -----
  resetProductPhoto(prod) {
    if (this._prodPhoto && this._prodPhoto.previewUrl) URL.revokeObjectURL(this._prodPhoto.previewUrl);
    this._prodPhoto = { blob: null, remove: false, previewUrl: '', id: prod ? prod.id : null, serverV: prod && prod.image_v ? prod.image_v : 0 };
    const input = document.getElementById('prodPhotoInput');
    if (input) input.value = '';
    this.renderProductPhoto();
  }

  renderProductPhoto() {
    const st = this._prodPhoto || {};
    const box = document.getElementById('prodPhotoPreview');
    const hint = document.getElementById('prodPhotoHint');
    const btnRemove = document.getElementById('btnProdPhotoRemove');
    if (!box) return;
    const tieneFoto = !!st.blob || (!!st.serverV && !st.remove);
    if (st.blob) {
      box.innerHTML = `<img src="${st.previewUrl}" alt="">`;
    } else if (tieneFoto) {
      box.innerHTML = `<img src="/api/pos/product-image/${Number(st.id)}?v=${Number(st.serverV)}" alt="">`;
    } else {
      const catSel = document.getElementById('prodCategory');
      const catName = catSel && catSel.selectedIndex >= 0 ? catSel.options[catSel.selectedIndex].textContent : '';
      box.innerHTML = drinkImageHtml({ id: 0, category_name: catName, name: document.getElementById('prodName').value });
    }
    if (btnRemove) btnRemove.style.display = tieneFoto ? '' : 'none';
    if (hint) {
      hint.textContent = st.blob ? 'Foto lista. Toca “Guardar” para que se vea en el menú.'
        : tieneFoto ? 'Esta es la foto que se ve en el menú.'
        : 'Sin foto, en el menú se usa este dibujo.';
    }
  }

  async pickProductPhoto(file) {
    if (!file) return;
    try {
      const blob = await fotoAJpegCuadrado(file);
      if (this._prodPhoto.previewUrl) URL.revokeObjectURL(this._prodPhoto.previewUrl);
      this._prodPhoto.blob = blob;
      this._prodPhoto.remove = false;
      this._prodPhoto.previewUrl = URL.createObjectURL(blob);
      this.renderProductPhoto();
    } catch (err) {
      this.toast('No pude leer esa foto. Prueba con otra (que sea JPG o PNG).', 'error');
    }
  }

  populateProductSelects() {
    const catSelect = document.getElementById('prodCategory');
    catSelect.innerHTML = this.categories.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');

    const directItemSelect = document.getElementById('prodDirectItem');
    directItemSelect.innerHTML = '<option value="">Ninguno (no descuenta inventario)</option>' +
      this.inventoryItems.map(i => i.unit === 'ml'
        ? `<option value="${i.id}" disabled>${escapeHtml(i.name)} (ml: usa “receta”)</option>`
        : `<option value="${i.id}">${escapeHtml(i.name)} (${escapeHtml(i.unit)})</option>`).join('');
  }

  toggleProductTypeSections(modo) {
    document.getElementById('sectionDirectSale').style.display = modo === 'direct' ? 'block' : 'none';
    document.getElementById('sectionRecipeBuilder').style.display = modo === 'recipe' ? 'block' : 'none';
    if (modo === 'recipe') this.calculateRecipeCosts();
  }

  renderRecipeRows(ingredients = []) {
    const container = document.getElementById('recipeIngredientsList');
    if (!ingredients || ingredients.length === 0) {
      container.innerHTML = '<p class="help-text" id="noRecipeMsg">Todavía no hay ingredientes. Toca “➕ Agregar ingrediente”.</p>';
      return;
    }

    container.innerHTML = ingredients.map((ing, idx) => `
      <div class="recipe-ingredient-row">
        <select class="form-control form-control-sm recipe-item-select" data-idx="${idx}">
          ${this.inventoryItems.map(item => `
            <option value="${item.id}" ${item.id === ing.inventory_item_id ? 'selected' : ''}>
              ${escapeHtml(item.name)} (${escapeHtml(item.unit)})
            </option>
          `).join('')}
        </select>
        <input type="number" step="any" min="0" class="form-control form-control-sm recipe-qty-input" value="${ing.quantity}" placeholder="Cantidad" aria-label="Cantidad" inputmode="decimal" data-idx="${idx}">
        <span class="recipe-unit-display help-text">${escapeHtml(ing.unit || '')}</span>
        <button type="button" class="btn btn-secondary btn-sm btn-danger-soft" onclick="app.removeRecipeIngredientRow(${idx})" aria-label="Quitar este ingrediente">✕ Quitar</button>
      </div>
    `).join('');

    this.calculateRecipeCosts();
  }

  addRecipeIngredientRow() {
    const container = document.getElementById('recipeIngredientsList');
    const noMsg = document.getElementById('noRecipeMsg');
    if (noMsg) noMsg.remove();

    const idx = container.querySelectorAll('.recipe-ingredient-row').length;
    const firstItem = this.inventoryItems[0] || {};

    const row = document.createElement('div');
    row.className = 'recipe-ingredient-row';
    row.innerHTML = `
      <select class="form-control form-control-sm recipe-item-select" data-idx="${idx}">
        ${this.inventoryItems.map(item => `
          <option value="${item.id}">${escapeHtml(item.name)} (${escapeHtml(item.unit)})</option>
        `).join('')}
      </select>
      <input type="number" step="any" min="0" class="form-control form-control-sm recipe-qty-input" value="1" placeholder="Cantidad" aria-label="Cantidad" inputmode="decimal" data-idx="${idx}">
      <span class="recipe-unit-display help-text">${escapeHtml(firstItem.unit || '')}</span>
      <button type="button" class="btn btn-secondary btn-sm btn-danger-soft" onclick="this.closest('.recipe-ingredient-row').remove(); app.calculateRecipeCosts();" aria-label="Quitar este ingrediente">✕ Quitar</button>
    `;

    container.appendChild(row);
    this.calculateRecipeCosts();
  }

  removeRecipeIngredientRow(idx) {
    const rows = document.querySelectorAll('.recipe-ingredient-row');
    if (rows[idx]) rows[idx].remove();
    this.calculateRecipeCosts();
  }

  calculateRecipeCosts() {
    let totalCost = 0;
    const rows = document.querySelectorAll('.recipe-ingredient-row');
    rows.forEach(row => {
      const select = row.querySelector('.recipe-item-select');
      const qtyInput = row.querySelector('.recipe-qty-input');
      const itemId = parseInt(select.value, 10);
      const qty = parseFloat(qtyInput.value) || 0;

      const inv = this.inventoryItems.find(i => i.id === itemId);
      if (inv) {
        totalCost += qty * inv.cost_per_unit;
        const unitBox = row.querySelector('.recipe-unit-display');
        // Si viene en botella, recuerda cuánto es una (para vender la botella completa basta poner esa cantidad)
        unitBox.innerHTML = escapeHtml(qty > 0 ? `${inv.unit} · ${money(qty * inv.cost_per_unit)}` : inv.unit) +
          (inv.pack_size > 0 ? `<small class="recipe-pack-hint">1 ${escapeHtml(inv.pack_name)} = ${fmtNum(inv.pack_size)} ${escapeHtml(inv.unit)}</small>` : '');
      }
    });

    // Con opciones (vidrio / lata...) se cuenta la más cara, igual que el servidor
    let masCara = 0;
    document.querySelectorAll('.prod-option-row').forEach(row => {
      const inv = this.inventoryItems.find(i => i.id === parseInt(row.querySelector('.opt-item').value, 10));
      const q = parseFloat(row.querySelector('.opt-qty').value) || 0;
      if (inv) masCara = Math.max(masCara, q * inv.cost_per_unit);
    });
    totalCost += masCara;

    const price = parseFloat(document.getElementById('prodPrice').value) || 0;
    const margin = price > 0 ? (((price - totalCost) / price) * 100).toFixed(1) : 0;

    document.getElementById('recipeEstimatedCost').textContent = money(totalCost);
    document.getElementById('recipeProjectedMargin').textContent = `${margin}%`;
  }

  // ===================================================
  // SALES HISTORY MODULE
  // ===================================================
  async loadSalesHistory() {
    try {
      const start = document.getElementById('salesFilterStart').value;
      const end = document.getElementById('salesFilterEnd').value;
      const method = document.getElementById('salesFilterPayment').value;
      const query = document.getElementById('salesFilterQuery').value;
      const status = document.getElementById('salesFilterStatus').value;

      let qs = new URLSearchParams();
      if (status && status !== 'todas') qs.append('status', status);
      if (start) qs.append('start_date', start);
      if (end) qs.append('end_date', end);
      if (method && method !== 'todos') qs.append('payment_method', method);
      if (query) qs.append('query', query);

      const data = await this.api(`/api/admin/sales?${qs.toString()}`);
      const tbody = document.getElementById('salesTableBody');

      if (!data.sales || data.sales.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9"><div class="empty-state"><div class="empty-icon">🧾</div><p>No hay ventas para mostrar</p><span>Si pusiste filtros, prueba quitarlos y tocar “Buscar” otra vez.</span></div></td></tr>';
        return;
      }

      tbody.innerHTML = data.sales.map(s => `
        <tr class="${s.status === 'anulada' ? 'sale-voided' : ''}">
          <td><strong style="color: var(--accent-amber);">${escapeHtml(s.ticket_number)}</strong>${s.status === 'anulada' ? `
            <div><span class="badge-void">ANULADA</span></div>
            <div class="help-text void-why">${escapeHtml(s.voided_by_name || '')}: ${escapeHtml(s.void_reason || '')}</div>` : ''}</td>
          <td>
            <div style="font-weight: 600;">${fmtDate(s.created_at)}</div>
            <div class="help-text">${fmtTime(s.created_at)}</div>
          </td>
          <td class="col-branch">${escapeHtml(s.branch_name || '—')}</td>
          <td>${escapeHtml(s.cashier_name)}</td>
          <td><span class="badge-role" style="background: var(--bg-surface-hover);">${escapeHtml(payLabel(s.payment_method))}</span></td>
          <td>${money(s.subtotal)}</td>
          <td>${s.discount > 0 ? `-${money(s.discount)}` : 'Q 0.00'}</td>
          <td><strong class="sale-total" style="color: var(--accent-text); font-size: 1.05rem;">${money(s.total)}</strong></td>
          <td>
            <div class="sale-actions">
              <button class="btn btn-secondary btn-sm" onclick="app.viewTicketDetails('${escapeHtml(s.ticket_number)}')">
                🖨️ Ver ticket
              </button>
              ${s.status === 'anulada' ? '' : `<button class="btn btn-secondary btn-sm btn-danger-soft" onclick="app.askVoidSale('${escapeHtml(s.ticket_number)}')">🚫 Anular</button>`}
            </div>
          </td>
        </tr>
      `).join('');
    } catch (err) {
      this.toast('No se pudo cargar la lista de ventas. ' + friendlyError(err), 'error');
    }
  }

  async viewTicketDetails(ticketNumber) {
    try {
      const res = await this.api(`/api/pos/ticket/${encodeURIComponent(ticketNumber)}`);
      this.openTicketModal(res.ticket, false);
    } catch (err) {
      this.toast('No se pudo abrir el ticket. ' + friendlyError(err), 'error');
    }
  }

  // Baja la lista de ventas como archivo para Excel (con la sesión, sin pasar el token por la dirección)
  async exportSalesCsv() {
    try {
      const response = await fetch('/api/admin/sales/export', {
        headers: { 'Authorization': `Bearer ${this.token}`, ...this.branchHeaders() }
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'No se pudo preparar el archivo.');
      }
      const rawText = await response.text();
      const pad2 = (n) => String(n).padStart(2, '0');
      // La base de datos guarda la hora en UTC; en el archivo la ponemos en la hora de este dispositivo,
      // igual que se ve en pantalla.
      const text = rawText.replace(/(")(\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2})?)(")/g, (m, a, dt, c) => {
        const d = parseDbDate(dt);
        if (isNaN(d)) return m;
        return `${a}${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}${c}`;
      });
      // El "﻿" al inicio hace que Excel muestre bien las tildes y la ñ
      const blob = new Blob(['﻿', text], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const hoy = new Date();
      const sucursal = this.multiBranch
        ? '_' + (this.branchScopeName().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'sucursal')
        : '';
      a.download = `Ventas_El_Mismisimo${sucursal}_${hoy.getFullYear()}-${pad2(hoy.getMonth() + 1)}-${pad2(hoy.getDate())}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      this.toast('Listo: se descargó el archivo. Ábrelo con Excel.');
    } catch (err) {
      this.toast('No se pudo bajar la lista. ' + friendlyError(err), 'error');
    }
  }

  // ===================================================
  // CASH SHIFTS (ARQUEOS & CORTES DE CAJA)
  // ===================================================
  async loadShiftsHistory() {
    try {
      const data = await this.api('/api/admin/shifts');
      const tbody = document.getElementById('shiftsTableBody');

      if (!data.shifts || data.shifts.length === 0) {
        tbody.innerHTML = '<tr><td colspan="10"><div class="empty-state"><div class="empty-icon">💰</div><p>Todavía no hay cortes de caja</p><span>Aparecerán aquí cuando se abra y se cierre una caja.</span></div></td></tr>';
        return;
      }

      tbody.innerHTML = data.shifts.map(s => {
        const closeTime = s.closed_at
          ? fmtTime(s.closed_at)
          : '<span style="color: var(--ok-text); font-weight: 700;">sigue abierta</span>';
        const diff = Number(s.difference) || 0;

        return `
        <tr class="fila-corte" tabindex="0" role="button" aria-label="Ver el detalle del corte ${s.id}" onclick="app.openShiftDetail(${s.id})" onkeydown="if(event.key==='Enter'){app.openShiftDetail(${s.id})}">
          <td><strong style="color: var(--accent-amber);">#${s.id}</strong></td>
          <td>
            <strong>${escapeHtml(s.cashier_name)}</strong>
          </td>
          <td class="col-branch">${escapeHtml(s.branch_name || '—')}</td>
          <td>
            <div style="font-weight: 600;">${fmtDate(s.opened_at)}</div>
            <div class="help-text" style="white-space: nowrap;">${fmtTime(s.opened_at)} → ${closeTime}</div>
          </td>
          <td>${money(s.initial_cash)}</td>
          <td>
            <strong>${money(s.total_sales_amount)}</strong>
            <div class="help-text">${s.total_sales_count} ${plural(s.total_sales_count, 'venta', 'ventas')}</div>
          </td>
          <td>${money(s.expected_cash)}</td>
          <td><strong>${money(s.actual_cash)}</strong></td>
          <td>
            <strong style="color: ${diff < 0 ? 'var(--bad-text)' : diff > 0 ? 'var(--ok-text)' : 'var(--text-secondary)'};">
              ${diff > 0 ? '+' : ''}${money(diff)}
            </strong>
            <div class="help-text">${diff === 0 ? '✔ Cuadró' : diff < 0 ? 'Faltó dinero' : 'Sobró dinero'}</div>
          </td>
          <td>
            <span class="badge-status ${s.status === 'open' ? 'ok' : 'normal'}">
              ${s.status === 'open' ? '🟢 Abierta' : 'Cerrada'}
            </span>
            <div class="help-text corte-ver">🔍 Ver detalle</div>
          </td>
        </tr>
      `;
      }).join('');
    } catch (err) {
      this.toast('No se pudo cargar la lista de cortes. ' + friendlyError(err), 'error');
    }
  }

  // Detalle de un corte: dinero por forma de pago, anuladas, qué se vendió y cada venta
  async openShiftDetail(id) {
    const body = document.getElementById('shiftDetailBody');
    document.getElementById('shiftDetailTitle').textContent = '💰 Corte #' + id;
    body.innerHTML = '<div class="empty-state"><div class="empty-icon">⏳</div><p>Cargando el corte…</p></div>';
    this.openModal('modalShiftDetail');
    try {
      const d = await this.api('/api/admin/shifts/' + id);
      const s = d.shift, r = d.resumen;
      const abierta = s.status === 'open';
      const diff = Number(s.difference) || 0;
      const efectivo = r.por_metodo.efectivo || { cantidad: 0, total: 0 };
      const fila = (txt, val, extra = '', cls = '') => `<div class="corte-fila ${cls}"><span>${txt}${extra ? `<small>${extra}</small>` : ''}</span><strong>${val}</strong></div>`;
      const cant = (n) => `${n} ${plural(n, 'venta', 'ventas')}`;
      const metodos = [['efectivo', '💵 Efectivo'], ['tarjeta', '💳 Tarjeta'], ['transferencia', '🏦 Transferencia'], ['mixto', '🔀 Mixto']];
      const pagos = metodos
        .filter(([k]) => k !== 'mixto' || (r.por_metodo.mixto && r.por_metodo.mixto.cantidad > 0))
        .map(([k, nombre]) => {
          const m = r.por_metodo[k] || { cantidad: 0, total: 0 };
          const nota = k === 'tarjeta' && r.recargo_tarjeta > 0 ? `incluye ${money(r.recargo_tarjeta)} de recargo` : '';
          return fila(nombre, money(m.total), [cant(m.cantidad), nota].filter(Boolean).join(' · '));
        }).join('');
      const horario = `${fmtDate(s.opened_at)} · ${fmtTime(s.opened_at)} → ${s.closed_at ? fmtTime(s.closed_at) : 'sigue abierta'}`;
      const cuadre = abierta
        ? fila('Dinero inicial', money(s.initial_cash)) +
          fila('+ Ventas en efectivo', money(efectivo.total), cant(efectivo.cantidad)) +
          fila('= Debería haber ahora', money(s.expected_cash), '', 'corte-total') +
          '<div class="help-text" style="margin-top:.4rem;">🟢 La caja sigue abierta: todavía no se cuenta el dinero.</div>'
        : fila('Dinero inicial', money(s.initial_cash)) +
          fila('+ Ventas en efectivo', money(s.expected_cash - s.initial_cash), r.anuladas_despues_del_cierre.cantidad ? '' : cant(efectivo.cantidad)) +
          fila('= Debería haber', money(s.expected_cash), '', 'corte-total') +
          fila('Se contó', money(s.actual_cash)) +
          fila(diff === 0 ? '✔ Cuadró' : diff < 0 ? 'Faltó dinero' : 'Sobró dinero', (diff > 0 ? '+' : '') + money(diff), '', diff < 0 ? 'corte-mal' : diff > 0 ? 'corte-bien' : 'corte-bien');
      const anul = r.anuladas.cantidad
        ? `<div class="corte-aviso">🚫 ${r.anuladas.cantidad} ${plural(r.anuladas.cantidad, 'venta anulada', 'ventas anuladas')} por ${money(r.anuladas.total)} (no suman al total).${r.anuladas_despues_del_cierre.cantidad ? ` <strong>${r.anuladas_despues_del_cierre.cantidad} se anularon después del cierre</strong>: el conteo de ese día no se cambió.` : ''}</div>`
        : '';
      const vendido = d.vendido.length
        ? d.vendido.map(x => `<div class="corte-fila"><span>${x.cantidad} × ${escapeHtml(x.producto)}</span><strong>${money(x.total)}</strong></div>`).join('')
        : '<div class="help-text">No se vendió nada en este corte.</div>';
      const ventas = d.sales.length
        ? d.sales.map(v => {
            const anulada = v.status === 'anulada';
            const recargo = v.card_surcharge > 0 ? ` · recargo ${money(v.card_surcharge)}` : '';
            return `
          <div class="my-sale ${anulada ? 'is-voided' : ''}">
            <div class="my-sale-main">
              <div class="my-sale-top">
                <strong>${escapeHtml(v.ticket_number)}</strong>
                <span class="help-text">${fmtTime(v.created_at)}${v.table_name ? ' · ' + escapeHtml(v.table_name) : ''}</span>
                ${anulada ? '<span class="badge-void">ANULADA</span>' : ''}
              </div>
              <div class="my-sale-items">${escapeHtml(v.items_text || '')}</div>
              ${anulada && v.void_reason ? `<div class="help-text">Motivo: ${escapeHtml(v.void_reason)}${v.voided_by_name ? ' · ' + escapeHtml(v.voided_by_name) : ''}</div>` : ''}
              ${v.notes ? `<div class="help-text">Nota: ${escapeHtml(v.notes)}</div>` : ''}
            </div>
            <div class="my-sale-side">
              <strong class="my-sale-total">${money(v.total)}</strong>
              <span class="help-text">${escapeHtml(payLabel(v.payment_method))}${recargo}</span>
            </div>
          </div>`;
          }).join('')
        : '<div class="help-text">Este corte no tuvo ventas.</div>';
      body.innerHTML = `
        <div class="corte-cabecera">
          <strong>${escapeHtml(s.cashier_name)}</strong>
          <span class="help-text">${escapeHtml(s.branch_name || '')}${s.branch_name ? ' · ' : ''}${horario}</span>
          <span class="badge-status ${abierta ? 'ok' : 'normal'}">${abierta ? '🟢 Abierta' : 'Cerrada'}</span>
        </div>
        <div class="corte-seccion"><h4>🧮 Cuadre del efectivo</h4>${cuadre}</div>
        <div class="corte-seccion"><h4>💳 Lo que se cobró, por forma de pago</h4>
          ${pagos}
          ${fila('Total vendido', money(r.total), cant(r.ventas) + (r.ventas ? ' · promedio ' + money(r.ticket_promedio) : ''), 'corte-total')}
          ${r.descuentos > 0 ? fila('Descuentos dados', money(r.descuentos)) : ''}
          ${anul}
        </div>
        ${s.notes ? `<div class="corte-seccion"><h4>📝 Notas del corte</h4><div class="help-text" style="white-space:pre-wrap;">${escapeHtml(s.notes)}</div></div>` : ''}
        <div class="corte-seccion"><h4>🍹 Qué se vendió</h4>${vendido}</div>
        <div class="corte-seccion"><h4>🧾 Cada venta</h4><div class="my-sales-list">${ventas}</div></div>`;
    } catch (err) {
      body.innerHTML = '<div class="empty-state"><div class="empty-icon">⚠️</div><p>No se pudo abrir el corte</p><span>' + escapeHtml(friendlyError(err)) + '</span></div>';
    }
  }

  async openShiftModal() {
    if (typeof this.branchId !== 'number') {
      this.toast(this.branches.length ? 'Elige una sucursal arriba (no “Ambas”) para abrir o cerrar tu caja.' : 'Todavía no tienes una sucursal asignada. Avisa al administrador.', 'warning');
      return;
    }
    if (this._cajaCargando) return;   // un segundo toque mientras consulta no hace nada más
    this._cajaCargando = true;
    const body = document.getElementById('shiftModalBody');
    const title = document.getElementById('shiftModalTitle');
    // El cuadro se abre AL INSTANTE: con internet lento no pasaba nada hasta que el servidor contestaba y parecía que se trababa
    title.textContent = '💰 Mi caja' + (this.multiBranch ? ` · ${this.branchScopeName()}` : '');
    body.innerHTML = '<div class="hint-box" role="status" aria-live="polite">⏳ Consultando tu caja…</div>';
    this.openModal('modalShift');
    try {
      const res = await this.api('/api/pos/shift/current');

      if (!res.active) {
        // Abrir la caja
        title.textContent = '🟢 Abrir mi caja';
        body.innerHTML = `
          <form id="openShiftForm">
            <div class="hint-box">
              Cuenta el dinero en efectivo que hay en la gaveta <strong>antes de empezar a vender</strong> (el que sirve para dar cambio) y escribe el total.
            </div>
            <div class="form-group">
              <label class="form-label" for="shiftInitCash">¿Cuánto dinero hay en la caja ahora? (Q)</label>
              <input type="number" step="0.01" min="0" id="shiftInitCash" class="form-control big-input" placeholder="Ej: 200" inputmode="decimal" required>
            </div>
            <div class="form-group">
              <label class="form-label" for="shiftInitNotes">Nota (opcional)</label>
              <input type="text" id="shiftInitNotes" class="form-control" placeholder="Ej: billetes de Q10 y Q20, y monedas">
            </div>
            <button type="submit" class="btn btn-success btn-block btn-xl">
              🟢 ABRIR CAJA
            </button>
          </form>
        `;

        document.getElementById('openShiftForm').onsubmit = async (e) => {
          e.preventDefault();
          const initial_cash = parseFloat(document.getElementById('shiftInitCash').value);
          const notes = document.getElementById('shiftInitNotes').value;
          if (isNaN(initial_cash) || initial_cash < 0) {
            this.toast('Escribe cuánto dinero hay en la caja (puede ser 0).', 'warning');
            return;
          }
          const submitBtn = e.target.querySelector('button[type="submit"]');
          submitBtn.disabled = true;
          try {
            await this.api('/api/pos/shift/open', {
              method: 'POST',
              body: JSON.stringify({ initial_cash, notes })
            });
            this.toast('Caja abierta. ¡Ya puedes vender!');
            this.closeModal('modalShift');
            this.checkCurrentShift();
            if (this.activeTab === 'shifts') this.loadShiftsHistory();
          } catch (err) {
            submitBtn.disabled = false;
            this.toast('No se pudo abrir la caja. ' + friendlyError(err), 'error');
          }
        };
      } else {
        // Cerrar la caja (corte)
        const summary = res.summary || {};
        const cashTotal = Number(summary.cash_total) || 0;
        const otherTotal = (Number(summary.card_total) || 0) + (Number(summary.transfer_total) || 0);
        const expected = res.shift.initial_cash + cashTotal;
        title.textContent = '🔴 Cerrar mi caja';
        body.innerHTML = `
          <button type="button" class="btn btn-secondary btn-block" id="btnMySales" style="margin-bottom: 0.75rem;">
            🧾 Ver mis ventas (o anular una por error)
          </button>
          <div class="shift-summary">
            <div class="shift-summary-row"><span>Dinero con el que empezaste:</span><strong>${money(res.shift.initial_cash)}</strong></div>
            <div class="shift-summary-row"><span>Ventas cobradas en efectivo:</span><strong>${money(cashTotal)}</strong></div>
            <div class="shift-summary-row"><span>Ventas con tarjeta o transferencia:</span><strong>${money(otherTotal)}</strong></div>
            <div class="shift-summary-row shift-summary-total"><span>Efectivo que debería haber en la gaveta:</span><strong>${money(expected)}</strong></div>
          </div>

          <form id="closeShiftForm">
            <div class="hint-box">
              Cuenta <strong>todo el dinero en efectivo</strong> que hay en la gaveta y escribe el total. La tarjeta y las transferencias no cuentan aquí.
            </div>
            <div class="form-group">
              <label class="form-label" for="shiftCountedCash">¿Cuánto dinero en efectivo contaste? (Q)</label>
              <input type="number" step="0.01" min="0" id="shiftCountedCash" class="form-control big-input" placeholder="0.00" inputmode="decimal" required>
            </div>
            <div class="form-group">
              <label class="form-label" for="shiftCloseNotes">Nota (opcional)</label>
              <input type="text" id="shiftCloseNotes" class="form-control" placeholder="Ej: todo bien">
            </div>
            <button type="submit" class="btn btn-danger btn-block btn-xl">
              🔴 CERRAR CAJA
            </button>
          </form>
        `;

        document.getElementById('btnMySales').onclick = () => { this.closeModal('modalShift'); this.openMySales(); };
        document.getElementById('closeShiftForm').onsubmit = async (e) => {
          e.preventDefault();
          const actual_cash = parseFloat(document.getElementById('shiftCountedCash').value);
          const notes = document.getElementById('shiftCloseNotes').value;
          if (isNaN(actual_cash) || actual_cash < 0) {
            this.toast('Escribe cuánto dinero contaste (puede ser 0).', 'warning');
            return;
          }

          const ok = await this.confirmDialog(
            `Contaste ${money(actual_cash)}. Al cerrar la caja ya no podrás vender hasta abrir otra.`,
            { title: '¿Cerrar la caja?', yes: 'Sí, cerrar caja', no: 'No, volver', danger: true }
          );
          if (!ok) return;

          const submitBtn = e.target.querySelector('button[type="submit"]');
          submitBtn.disabled = true;
          try {
            const closeRes = await this.api('/api/pos/shift/close', {
              method: 'POST',
              body: JSON.stringify({ actual_cash, notes })
            });

            const diff = closeRes.difference;
            const diffMsg = diff === 0
              ? '✔ El dinero cuadró perfecto.'
              : diff > 0
                ? `Sobró dinero: ${money(diff)}.`
                : `Faltó dinero: ${money(Math.abs(diff))}.`;

            // Resultado claro dentro del mismo cuadro
            title.textContent = '✅ Caja cerrada';
            body.innerHTML = `
              <div class="shift-summary">
                <div class="shift-summary-row"><span>Debería haber:</span><strong>${money(closeRes.expectedCash)}</strong></div>
                <div class="shift-summary-row"><span>Contaste:</span><strong>${money(closeRes.countedCash)}</strong></div>
                <div class="shift-summary-row shift-summary-total"><span>Resultado:</span><strong>${diffMsg}</strong></div>
              </div>
              <button type="button" class="btn btn-primary btn-block btn-xl" onclick="app.closeModal('modalShift')">Entendido</button>
            `;
            this.checkCurrentShift();
            if (this.activeTab === 'shifts') this.loadShiftsHistory();
          } catch (err) {
            submitBtn.disabled = false;
            this.toast('No se pudo cerrar la caja. ' + friendlyError(err), 'error');
          }
        };
      }

      if (this.multiBranch) title.textContent += ` · ${this.branchScopeName()}`;
    } catch (err) {
      this.closeModal('modalShift');
      this.toast('No se pudo consultar la caja. ' + friendlyError(err), 'error');
    } finally {
      this._cajaCargando = false;
    }
  }

  // ===================================================
  // USERS MODULE (ADMIN ONLY)
  // ===================================================
  async loadUsers() {
    try {
      const data = await this.api('/api/admin/users');
      const tbody = document.getElementById('usersTableBody');
      this.usersList = data.users;

      tbody.innerHTML = data.users.map(u => `
        <tr>
          <td><strong>${escapeHtml(u.full_name)}</strong></td>
          <td>${escapeHtml(u.username)}</td>
          <td>
            <span class="badge-role ${u.role === 'admin' ? 'badge-admin' : 'badge-vendedor'}">
              ${u.role === 'admin' ? '👑 Administrador' : '🍹 Vendedor'}
            </span>
          </td>
          <td class="col-branch users-branches-cell">${this.userBranchesHtml(u)}</td>
          <td>
            <span class="badge-status ${u.is_active ? 'ok' : 'critical'}">
              ${u.is_active ? '🟢 Puede entrar' : '⛔ No puede entrar'}
            </span>
          </td>
          <td>${fmtDate(u.created_at)}</td>
          <td>
            <div class="row-actions">
              ${u.role === 'vendedor' && this.multiBranch ? `<button type="button" class="btn btn-secondary btn-sm btn-user-branches" data-user-id="${u.id}">🏬 Sucursales</button>` : ''}
              <button type="button" class="btn btn-secondary btn-sm ${u.is_active ? 'btn-danger-soft' : ''} btn-toggle-user"
                data-user-id="${u.id}" data-new-status="${u.is_active ? 0 : 1}" data-user-name="${escapeHtml(u.full_name)}">
                ${u.is_active ? '⛔ No dejar entrar' : '✅ Dejar entrar otra vez'}
              </button>
            </div>
          </td>
        </tr>
      `).join('');

      tbody.querySelectorAll('.btn-user-branches').forEach(btn => {
        btn.onclick = () => this.openUserBranches(parseInt(btn.dataset.userId, 10));
      });
      tbody.querySelectorAll('.btn-toggle-user').forEach(btn => {
        btn.onclick = () => this.toggleUserStatus(
          parseInt(btn.dataset.userId, 10),
          parseInt(btn.dataset.newStatus, 10),
          btn.dataset.userName
        );
      });
    } catch (err) {
      this.toast('No se pudo cargar el personal. ' + friendlyError(err), 'error');
    }
  }

  userBranchesHtml(u) {
    if (u.role === 'admin') return '<span class="help-text">Todas</span>';
    const ids = Array.isArray(u.branch_ids) ? u.branch_ids : [];
    if (ids.length === 0) return '<span class="badge-status critical">Sin sucursal</span>';
    return ids.map(id => {
      const b = this.branches.find(x => x.id === id);
      return b ? `<span class="badge-branch">${escapeHtml(b.name)}</span>` : '';
    }).join('');
  }

  // Casillas con las sucursales (marcadas las que ya tiene la persona)
  branchChecksHtml(selectedIds, namePrefix) {
    return this.branches.map(b => `
      <label class="check-row">
        <input type="checkbox" name="${namePrefix}" value="${b.id}" ${selectedIds.includes(b.id) ? 'checked' : ''}>
        <span>🏬 ${escapeHtml(b.name)}</span>
      </label>
    `).join('');
  }

  checkedBranchIds(containerId) {
    return Array.from(document.querySelectorAll(`#${containerId} input[type="checkbox"]:checked`)).map(i => parseInt(i.value, 10));
  }

  // Cuadro "Agregar una persona": las sucursales solo se piden a los vendedores y si hay más de una
  syncUserBranchesGroup() {
    const group = document.getElementById('userBranchesGroup');
    if (!group) return;
    const isVendor = document.getElementById('userRoleInput').value === 'vendedor';
    group.style.display = isVendor && this.multiBranch ? '' : 'none';
  }

  openUserBranches(userId) {
    const u = (this.usersList || []).find(x => x.id === userId);
    if (!u) return;
    document.getElementById('userBranchesId').value = u.id;
    document.getElementById('userBranchesTitle').textContent = 'Sucursales de la persona';
    document.getElementById('userBranchesWho').innerHTML = `<strong>${escapeHtml(u.full_name)}</strong> solo podrá vender y ver las sucursales que marques.`;
    document.getElementById('userBranchesChecks').innerHTML = this.branchChecksHtml(u.branch_ids || [], 'ubr');
    this.openModal('modalUserBranches');
  }

  async saveUserBranches(e) {
    e.preventDefault();
    const id = parseInt(document.getElementById('userBranchesId').value, 10);
    const ids = this.checkedBranchIds('userBranchesChecks');
    if (ids.length === 0) {
      this.toast('Marca al menos una sucursal.', 'warning');
      return;
    }
    try {
      await this.api(`/api/admin/users/${id}`, { method: 'PUT', body: JSON.stringify({ branch_ids: ids }) });
      this.toast('✔ Sucursales guardadas.');
      this.closeModal('modalUserBranches');
      this.loadUsers();
    } catch (err) {
      this.toast(friendlyError(err), 'error');
    }
  }

  async toggleUserStatus(userId, newStatus, name = 'Esta persona') {
    if (newStatus === 0) {
      const ok = await this.confirmDialog(
        `${name} ya no podrá entrar al sistema. Sus ventas anteriores se conservan. Puedes dejarla entrar otra vez cuando quieras.`,
        { title: '¿No dejar entrar a esta persona?', yes: 'Sí, no dejar entrar', no: 'No, volver', danger: true }
      );
      if (!ok) return;
    }
    try {
      await this.api(`/api/admin/users/${userId}`, {
        method: 'PUT',
        body: JSON.stringify({ is_active: newStatus })
      });
      this.toast(newStatus ? `${name} puede entrar otra vez.` : `${name} ya no puede entrar.`);
      this.loadUsers();
    } catch (err) {
      this.toast(friendlyError(err), 'error');
    }
  }

  // ===================================================
  // SETTINGS MODULE (ADMIN ONLY)
  // ===================================================
  async loadSettings() {
    this.loadBranchesList();
    try {
      const data = await this.api('/api/admin/settings');
      const s = data.settings;
      this.settings = s;

      document.getElementById('setBusinessName').value = s.business_name || '';
      document.getElementById('setTagline').value = s.tagline || '';
      document.getElementById('setAddress').value = s.address || '';
      document.getElementById('setPhone').value = s.phone || '';
      document.getElementById('setTaxId').value = s.tax_id || '';
      document.getElementById('setTicketFooter').value = s.ticket_footer || '';

      const setEsc = document.getElementById('setEscarchados');
      if (setEsc) setEsc.value = s.escarchados || 'Chamoy con Tajín, Chamoy con Miguelito, Ajonjolí Acaramelado, Solo Sal y Limón';

      const setRecargo = document.getElementById('setCardSurcharge');
      if (setRecargo) setRecargo.value = (s.card_surcharge_percent !== undefined && s.card_surcharge_percent !== null) ? s.card_surcharge_percent : 5;
      const setBloqueo = document.getElementById('setBlockNoStock');
      if (setBloqueo) setBloqueo.checked = Number(s.block_no_stock) !== 0;

      const setSalsas = document.getElementById('setSalsas');
      if (setSalsas) setSalsas.value = s.salsas || 'Normal de la Casa, Suave / Poco picante, Bien cargado de salsas, Sin salsas';

      document.getElementById('headerBusinessName').textContent = s.business_name || 'Micheladas El Mismísimo';
      document.getElementById('headerTagline').textContent = s.tagline || 'Refresquería & Bar';
    } catch (err) {
      this.toast('No se pudieron cargar los datos del negocio. ' + friendlyError(err), 'error');
    }
  }

  // Ajustes > Sucursales
  async loadBranchesList() {
    const list = document.getElementById('branchesList');
    if (!list) return;
    try {
      const data = await this.api('/api/admin/branches?all=1');
      this.adminBranches = data.branches || [];
      const visibles = this.adminBranches.filter(b => b.is_active);
      const ocultas = this.adminBranches.filter(b => !b.is_active);
      const fila = (b, oculta) => `
        <div class="branch-row${oculta ? ' branch-row-hidden' : ''}" data-branch-row="${b.id}">
          <div class="branch-row-name">🏬 ${escapeHtml(b.name)}${oculta ? '<small>Oculta: no aparece para vender. Sus datos se conservan.</small>' : (b.id === 1 && visibles.length > 1 ? '<small>Sucursal principal (aquí quedaron los datos anteriores)</small>' : '')}</div>
          <button type="button" class="btn btn-secondary btn-sm" data-branch-edit="${b.id}" aria-label="Cambiar el nombre de ${escapeHtml(b.name)}">✏️ Cambiar nombre</button>
          ${oculta
            ? `<button type="button" class="btn btn-secondary btn-sm" data-branch-show="${b.id}" aria-label="Volver a mostrar ${escapeHtml(b.name)}">👁️ Mostrar</button>`
            : (visibles.length > 1 ? `<button type="button" class="btn btn-secondary btn-sm" data-branch-hide="${b.id}" aria-label="Ocultar ${escapeHtml(b.name)}">🙈 Ocultar</button>` : '')}
        </div>`;
      list.innerHTML = visibles.map(b => fila(b, false)).join('') +
        (ocultas.length ? `<div class="help-text branches-hidden-title">Sucursales ocultas</div>` + ocultas.map(b => fila(b, true)).join('') : '');
      list.querySelectorAll('[data-branch-edit]').forEach(btn => {
        btn.onclick = () => this.openBranchModal(parseInt(btn.dataset.branchEdit, 10));
      });
      list.querySelectorAll('[data-branch-hide]').forEach(btn => {
        btn.onclick = () => this.setBranchActive(parseInt(btn.dataset.branchHide, 10), false);
      });
      list.querySelectorAll('[data-branch-show]').forEach(btn => {
        btn.onclick = () => this.setBranchActive(parseInt(btn.dataset.branchShow, 10), true);
      });
    } catch (err) {
      this.toast('No se pudo cargar la lista de sucursales. ' + friendlyError(err), 'error');
    }
  }

  // Ocultar / volver a mostrar una sucursal (no borra nada)
  async setBranchActive(id, active) {
    const b = (this.adminBranches || []).find(x => x.id === id);
    if (!b) return;
    if (!active) {
      const ok = await this.confirmDialog(
        `“${b.name}” dejará de aparecer para vender y en los reportes. Sus ventas, cajas y existencias se conservan, y la puedes volver a mostrar cuando quieras.`,
        { title: '¿Ocultar esta sucursal?', yes: 'Sí, ocultarla', no: 'No, dejarla', danger: true }
      );
      if (!ok) return;
    }
    try {
      const res = await this.api(`/api/admin/branches/${id}`, { method: 'PUT', body: JSON.stringify({ is_active: active ? 1 : 0 }) });
      this.toast(`✔ ${res.message || 'Listo.'}`);
      await this.refreshBranchList();
      this.loadBranchesList();
    } catch (err) {
      this.toast(friendlyError(err), 'error');
    }
  }

  openBranchModal(id = null) {
    const b = id ? (this.adminBranches || []).find(x => x.id === id) : null;
    document.getElementById('branchModalTitle').textContent = b ? 'Cambiar el nombre de la sucursal' : 'Agregar una sucursal';
    document.getElementById('branchEditId').value = b ? b.id : '';
    document.getElementById('branchNameInput').value = b ? b.name : '';
    const hint = document.getElementById('branchNameHint');
    if (hint) hint.style.display = b ? 'none' : '';
    this.openModal('modalBranch');
  }

  async saveBranch(e) {
    e.preventDefault();
    const id = document.getElementById('branchEditId').value;
    const name = document.getElementById('branchNameInput').value.trim();
    if (name.length < 2) {
      this.toast('Escribe el nombre de la sucursal.', 'warning');
      return;
    }
    try {
      if (id) {
        await this.api(`/api/admin/branches/${id}`, { method: 'PUT', body: JSON.stringify({ name }) });
        this.toast('✔ Nombre cambiado.');
      } else {
        await this.api('/api/admin/branches', { method: 'POST', body: JSON.stringify({ name }) });
        this.toast(`✔ Sucursal “${name}” creada. Ahora agrégale sus mesas, registra su mercadería y asígnale vendedores.`);
      }
      this.closeModal('modalBranch');
      await this.refreshBranchList();
      this.loadBranchesList();
    } catch (err) {
      this.toast(friendlyError(err), 'error');
    }
  }

  // Después de agregar o renombrar una sucursal: se actualiza la lista de arriba sin sacar a nadie de donde está
  async refreshBranchList() {
    try {
      const data = await this.api('/api/auth/me');
      this.currentUser = data.user;
      try { localStorage.setItem('mismisimo_user', JSON.stringify(data.user)); } catch (e) { /* sin almacenamiento */ }
      this.branches = data.user.branches || [];
      this.multiBranch = Math.max(Number(data.user.total_branches) || 0, this.branches.length) > 1;
      if (typeof this.branchId === 'number' && !this.branches.some(b => b.id === this.branchId)) {
        this.branchId = this.branches.length ? this.branches[0].id : null;
      }
      this.renderBranchPickers();
    } catch (err) {
      console.error(err);
    }
  }

  async saveSettings(e) {
    e.preventDefault();
    try {
      const payload = {
        business_name: document.getElementById('setBusinessName').value,
        tagline: document.getElementById('setTagline').value,
        address: document.getElementById('setAddress').value,
        phone: document.getElementById('setPhone').value,
        tax_id: document.getElementById('setTaxId').value,
        ticket_footer: document.getElementById('setTicketFooter').value,
        escarchados: document.getElementById('setEscarchados') ? document.getElementById('setEscarchados').value : '',
        salsas: document.getElementById('setSalsas') ? document.getElementById('setSalsas').value : ''
      };
      const recargoEl = document.getElementById('setCardSurcharge');
      if (recargoEl && recargoEl.value !== '') payload.card_surcharge_percent = recargoEl.value;
      const bloqueoEl = document.getElementById('setBlockNoStock');
      if (bloqueoEl) payload.block_no_stock = bloqueoEl.checked ? 1 : 0;

      const res = await this.api('/api/admin/settings', {
        method: 'PUT',
        body: JSON.stringify(payload)
      });

      this.settings = res.settings;
      this.toast('✔ Cambios guardados.');
      this.loadSettings();
    } catch (err) {
      this.toast(friendlyError(err), 'error');
    }
  }

  async resetDemoData(type) {
    const isSalesOnly = type === 'sales_only';
    const msg = isSalesOnly
      ? 'Se van a borrar TODAS las ventas y todas las cajas (cortes). El resumen volverá a Q 0.00.\n\nEsto NO se puede deshacer.'
      : 'Se va a borrar TODO el menú: productos, recetas y sus datos de ejemplo. Después tendrás que crear tu menú desde cero.\n\nEsto NO se puede deshacer.';

    const ok = await this.confirmDialog(msg, {
      title: isSalesOnly ? '¿Borrar ventas y cajas?' : '¿Borrar todo el menú?',
      yes: isSalesOnly ? 'Sí, borrar ventas y cajas' : 'Sí, borrar el menú',
      no: 'No, volver',
      danger: true,
      typeToConfirm: 'BORRAR'
    });
    if (!ok) return;

    try {
      const res = await this.api('/api/admin/reset-data', {
        method: 'POST',
        body: JSON.stringify({ type })
      });
      this.toast(res.message || 'Listo, los datos se borraron.');
      await this.loadCatalog();
      if (this.activeTab === 'dashboard') this.loadDashboardData();
      if (this.activeTab === 'inventory') this.loadInventory();
      if (this.activeTab === 'products') this.loadAdminProducts();
      if (this.activeTab === 'shifts') this.loadShiftsHistory();
      if (this.activeTab === 'sales') this.loadSalesHistory();
    } catch (err) {
      this.toast('No se pudieron borrar los datos. ' + friendlyError(err), 'error');
    }
  }

  // ===================================================
  // CATEGORIES MANAGEMENT
  // ===================================================
  async openCategoriesModal() {
    this.openModal('modalCategories');
    await this.loadCategoriesList();
  }

  async loadCategoriesList() {
    try {
      const data = await this.api('/api/admin/categories');
      const box = document.getElementById('categoriesList');
      if (!box) return;
      this._catList = data.categories || [];

      if (this._catList.length === 0) {
        box.innerHTML = '<p class="help-text" style="text-align: center; padding: 1.2rem;">Todavía no hay secciones. Agrega la primera arriba.</p>';
        return;
      }

      const ultimo = this._catList.length - 1;
      box.innerHTML = this._catList.map((c, i) => `
        <div class="cat-row">
          <span class="cat-row-icon" aria-hidden="true">${escapeHtml(c.icon)}</span>
          <strong class="cat-row-name">${escapeHtml(c.name)}</strong>
          <span class="cat-row-actions">
            <button type="button" class="btn btn-secondary btn-sm btn-icon-only" ${i === 0 ? 'disabled' : ''} onclick="app.moveCategory(${c.id}, -1)" aria-label="Subir ${escapeHtml(c.name)}" title="Subir">⬆️</button>
            <button type="button" class="btn btn-secondary btn-sm btn-icon-only" ${i === ultimo ? 'disabled' : ''} onclick="app.moveCategory(${c.id}, 1)" aria-label="Bajar ${escapeHtml(c.name)}" title="Bajar">⬇️</button>
            <button type="button" class="btn btn-secondary btn-sm btn-danger-soft" onclick="app.deleteCategory(${c.id})" aria-label="Quitar la sección ${escapeHtml(c.name)}">🗑️ Quitar</button>
          </span>
        </div>
      `).join('');
    } catch (err) {
      this.toast('No se pudieron cargar las secciones. ' + friendlyError(err), 'error');
    }
  }

  // El dibujo de una sección nueva se escoge solo según su nombre (🍺 cervezas, 🍹 micheladas, 🥤 refrescos…)
  categoryEmoji(name) {
    const kind = drinkKind({ category_name: name, name: '' });
    return kind === 'general' ? '🍽️' : (DRINK_EMOJI[kind] || '🍽️');
  }

  async createCategory(e) {
    e.preventDefault();
    const name = document.getElementById('newCatName').value.trim();
    if (!name) return;
    const lista = this._catList || [];
    const display_order = lista.reduce((m, c) => Math.max(m, Number(c.display_order) || 0), 0) + 1; // al final

    try {
      await this.api('/api/admin/categories', {
        method: 'POST',
        body: JSON.stringify({ name, icon: this.categoryEmoji(name), display_order })
      });
      this.toast(`Sección “${name}” agregada.`);
      document.getElementById('newCatName').value = '';
      await this.loadCategoriesList();
      await this.loadCatalog();
      await this.loadAdminProducts();
    } catch (err) {
      this.toast(friendlyError(err), 'error');
    }
  }

  // Sube o baja una sección en el orden del menú
  async moveCategory(id, delta) {
    const lista = [...(this._catList || [])];
    const i = lista.findIndex(c => c.id === id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= lista.length) return;
    [lista[i], lista[j]] = [lista[j], lista[i]];
    try {
      // Se numera de nuevo 1, 2, 3… (así el orden queda claro aunque antes hubiera números repetidos)
      for (let k = 0; k < lista.length; k++) {
        if (Number(lista[k].display_order) !== k + 1) {
          await this.api(`/api/admin/categories/${lista[k].id}`, { method: 'PUT', body: JSON.stringify({ display_order: k + 1 }) });
        }
      }
      await this.loadCategoriesList();
      await this.loadCatalog();
      await this.loadAdminProducts();
    } catch (err) {
      this.toast(friendlyError(err), 'error');
    }
  }

  async deleteCategory(id) {
    const ok = await this.confirmDialog('Esta sección dejará de aparecer en el menú.', { title: '¿Quitar esta sección?', yes: 'Sí, quitarla', no: 'No, dejarla', danger: true });
    if (!ok) return;
    try {
      await this.api(`/api/admin/categories/${id}`, { method: 'DELETE' });
      this.toast('Sección quitada.');
      await this.loadCategoriesList();
      await this.loadCatalog();
      await this.loadAdminProducts();
    } catch (err) {
      this.toast(friendlyError(err), 'error');
    }
  }

  async deleteProduct(id) {
    const p = (this.adminProducts || this.products || []).find(x => x.id === id);
    const ok = await this.confirmDialog(
      `${p ? `“${p.name}” ` : 'Este producto '}se quitará del menú. Las ventas que ya se hicieron se conservan. (Si solo se acabó, mejor usa “Pausar”.)`,
      { title: '¿Quitar este producto del menú?', yes: 'Sí, quitarlo', no: 'No, dejarlo', danger: true }
    );
    if (!ok) return;
    try {
      const r = await this.api(`/api/admin/products/${id}`, { method: 'DELETE' });
      this.toast(r && r.paused ? r.message : 'Producto quitado del menú.', r && r.paused ? 'warning' : 'success');
      await this.loadAdminProducts();
      await this.loadCatalog();
    } catch (err) {
      this.toast(friendlyError(err), 'error');
    }
  }

  async deleteInventoryItem(id) {
    const item = (this.inventoryItems || []).find(x => x.id === id);
    const ok = await this.confirmDialog(
      `${item ? `“${item.name}” ` : 'Este insumo '}se quitará del inventario${this.multiBranch ? ' de TODAS las sucursales' : ''}.`,
      { title: '¿Quitar este insumo?', yes: 'Sí, quitarlo', no: 'No, dejarlo', danger: true }
    );
    if (!ok) return;
    try {
      await this.api(`/api/inventory/item/${id}`, { method: 'DELETE' });
      this.toast('Insumo quitado del inventario.');
      await this.loadInventory();
      await this.loadCatalog();
    } catch (err) {
      this.toast(friendlyError(err), 'error');
    }
  }

  // ===================================================
  // MODAL CONTROLLERS & EVENT BINDINGS
  // ===================================================
  openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    document.body.classList.remove('printing-sheet');
    modal._opener = document.activeElement;
    modal.classList.add('active');
    const floatingBar = document.getElementById('tabletFloatingCartBar');
    if (floatingBar) floatingBar.style.display = 'none';

    // El foco va al cuadro (no a un campo) para no abrir el teclado de la tablet sin necesidad
    const content = modal.querySelector('.modal-content');
    if (content) {
      content.setAttribute('tabindex', '-1');
      try { content.focus({ preventScroll: true }); } catch (e) { /* ok */ }
    }
  }

  closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.classList.remove('active');
      const opener = modal._opener;
      modal._opener = null;
      if (opener && document.contains(opener) && typeof opener.focus === 'function') {
        try { opener.focus({ preventScroll: true }); } catch (e) { /* ok */ }
      }
    }
    const floatingBar = document.getElementById('tabletFloatingCartBar');
    if (floatingBar && this.activeTab === 'pos' && !document.querySelector('.modal-overlay.active')) {
      floatingBar.style.display = '';
    }
  }

  // Tecla Escape: cierra el cuadro que está arriba
  closeTopModal() {
    const open = Array.from(document.querySelectorAll('.modal-overlay.active'));
    if (open.length === 0) {
      const nav = document.getElementById('navTabs');
      if (nav && nav.classList.contains('nav-open')) { this.toggleNavMenu(false); return; }
      if (this._payMode) this.setPayMode(false);
      return;
    }
    const top = open[open.length - 1];
    if (typeof top._cancel === 'function') top._cancel();
    else this.closeModal(top.id);
  }

  bindGlobalEvents() {
    // Login form
    const loginError = document.getElementById('loginError');
    const showLoginError = (msg) => {
      loginError.textContent = msg;
      loginError.style.display = 'block';
    };
    ['loginUsername', 'loginPassword'].forEach(id => {
      document.getElementById(id).addEventListener('input', () => { loginError.style.display = 'none'; });
    });
    document.getElementById('loginShowPassword').onchange = (e) => {
      document.getElementById('loginPassword').type = e.target.checked ? 'text' : 'password';
    };

    document.getElementById('loginForm').onsubmit = async (e) => {
      e.preventDefault();
      loginError.style.display = 'none';
      const username = document.getElementById('loginUsername').value.trim();
      const password = document.getElementById('loginPassword').value;
      if (!username || !password) {
        showLoginError('Escribe tu usuario y tu contraseña.');
        return;
      }

      const btn = document.getElementById('btnLogin');
      btn.disabled = true;
      btn.textContent = 'Entrando…';
      // Si tarda, el botón cuenta los segundos (así se ve que sigue esperando al servidor y cuánto lleva)
      const inicioEntrar = performance.now();
      const contador = setInterval(() => {
        const seg = Math.round((performance.now() - inicioEntrar) / 1000);
        if (seg >= 3) btn.textContent = `Entrando… ${seg} s`;
      }, 1000);
      try {
        const res = await this.api('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({ username, password }),
          timeoutMs: 45000   // si el internet se cuelga, no se queda esperando para siempre
        });
        // Se anota cuánto tardó en total y cuánto de eso fue del servidor (lo muestra la prueba de velocidad: ?velocidad=1)
        try {
          const total = performance.now() - inicioEntrar;
          const e = performance.getEntriesByType('resource').filter(x => /\/api\/auth\/login(\?|$)/.test(x.name)).pop();
          const st = e && e.serverTiming && e.serverTiming.find(x => x.name === 'app');
          localStorage.setItem('mismisimo_ultimo_login', JSON.stringify({ t: Date.now(), total: Math.round(total), servidor: st ? Math.round(st.duration) : null }));
        } catch (e2) { /* no pasa nada */ }

        this.token = res.token;
        this.currentUser = res.user;
        localStorage.setItem('mismisimo_token', res.token);
        localStorage.setItem('mismisimo_user', JSON.stringify(res.user));
        document.getElementById('loginPassword').value = '';

        this.toast(`¡Bienvenido, ${res.user.full_name}!`);
        this.showAppView();
        if (res.password_de_fabrica && res.user.role === 'admin') this.toast('⚠️ Tu contraseña sigue siendo la de fábrica. Cámbiala en Personal para que nadie más pueda entrar al sistema.', 'warning');
      } catch (err) {
        const msg = friendlyError(err);
        showLoginError(msg === 'Credenciales inválidas'
          ? 'El usuario o la contraseña no son correctos. Revísalos e inténtalo otra vez.'
          : msg);
      } finally {
        clearInterval(contador);
        btn.disabled = false;
        btn.textContent = 'ENTRAR';
      }
    };

    // Tecla Escape cierra el cuadro de arriba
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.closeTopModal();
    });

    // Aviso de caja cerrada en "Vender"
    const btnPosOpenShift = document.getElementById('btnPosOpenShift');
    if (btnPosOpenShift) btnPosOpenShift.onclick = () => this.openShiftModal();

    // Logout
    document.getElementById('btnLogout').onclick = () => this.askLogout();

    // Discrete Header Controls for Tablet
    const appView = document.getElementById('appView');
    const btnToggleDiscrete = document.getElementById('btnToggleDiscrete');
    const btnRestoreHeader = document.getElementById('btnRestoreHeader');
    const btnDiscreteShift = document.getElementById('btnDiscreteShift');
    const btnDiscreteLogout = document.getElementById('btnDiscreteLogout');
    const btnToggleFullscreen = document.getElementById('btnToggleFullscreen');
    const btnDiscreteFullscreen = document.getElementById('btnDiscreteFullscreen');

    if (btnDiscreteShift) {
      btnDiscreteShift.onclick = () => this.openShiftModal();
    }

    if (btnDiscreteLogout) {
      btnDiscreteLogout.onclick = () => this.askLogout();
    }

    // Fullscreen toggle
    const toggleFullscreen = () => {
      try {
        if (!document.fullscreenElement) {
          if (document.documentElement.requestFullscreen) {
            document.documentElement.requestFullscreen();
          } else if (document.documentElement.webkitRequestFullscreen) {
            document.documentElement.webkitRequestFullscreen();
          }
        } else {
          if (document.exitFullscreen) {
            document.exitFullscreen();
          } else if (document.webkitExitFullscreen) {
            document.webkitExitFullscreen();
          }
        }
      } catch (err) {
        console.warn('Fullscreen error:', err);
      }
    };

    if (btnToggleFullscreen) btnToggleFullscreen.onclick = toggleFullscreen;
    if (btnDiscreteFullscreen) btnDiscreteFullscreen.onclick = toggleFullscreen;

    // Nav tabs
    document.querySelectorAll('.nav-tab-btn').forEach(btn => {
      btn.onclick = () => this.switchTab(btn.dataset.tab);
    });

    // POS search
    document.getElementById('posSearchInput').oninput = (e) => {
      const activeCatBtn = document.querySelector('.cat-pill.active');
      const catId = activeCatBtn ? activeCatBtn.dataset.cat : 'all';
      this.renderProductGrid(catId, e.target.value);
    };

    // Cart actions
    document.getElementById('btnClearCart').onclick = () => this.askClearCart();
    document.getElementById('btnPosCheckout').onclick = () => this.openPaymentPanel();

    // Tablet Drawer & Floating Bar triggers
    const toggleCartDrawerBtn = document.getElementById('btnToggleCartDrawer');
    if (toggleCartDrawerBtn) toggleCartDrawerBtn.onclick = () => this.toggleCartDrawer();

    const closeCartDrawerBtn = document.getElementById('btnCloseCartDrawer');
    if (closeCartDrawerBtn) closeCartDrawerBtn.onclick = () => this.closeCartDrawer();

    const cartDrawerBackdrop = document.getElementById('cartDrawerBackdrop');
    if (cartDrawerBackdrop) cartDrawerBackdrop.onclick = () => this.closeCartDrawer();

    const drawerHandle = document.getElementById('drawerDragHandle');
    if (drawerHandle) drawerHandle.onclick = () => this.closeCartDrawer();

    const tabletQuickPayBtn = document.getElementById('tabletBtnQuickPay');
    if (tabletQuickPayBtn) tabletQuickPayBtn.onclick = () => this.openPaymentPanel();

    const backToOrderBtn = document.getElementById('btnBackToOrder');
    if (backToOrderBtn) backToOrderBtn.onclick = () => this.closePaymentPanel();

    // Botón Gigante "Nueva Venta (Siguiente Cliente)"
    const nextBtn = document.getElementById('btnNextCustomer');
    if (nextBtn) {
      nextBtn.onclick = () => {
        this.closeModal('modalTicket');
        this.clearCart();
        this.toast('Listo para el siguiente cliente 🍹');
      };
    }

    document.querySelectorAll('.pay-method-btn').forEach(btn => {
      btn.onclick = () => this.selectPaymentMethod(btn.dataset.method);
    });

    document.getElementById('btnConfirmPayment').onclick = () => this.processSale();

    // Customization confirmation
    document.getElementById('btnConfirmCustomization').onclick = () => {
      if (!this.pendingCustomizationProduct) return;
      const checkedEsc = document.querySelector('input[name="custEscarchado"]:checked');
      const escarchado = checkedEsc ? checkedEsc.value : '';
      const sauceElem = document.getElementById('custSauceLevel');
      const sauce = sauceElem ? sauceElem.value : '';
      const notes = document.getElementById('custExtraNotes').value.trim();

      const customParts = [];
      if (escarchado) customParts.push(`Escarchado: ${escarchado}`);
      if (sauce) customParts.push(`Salsa: ${sauce}`);
      if (notes) customParts.push(notes);

      const prod = this.pendingCustomizationProduct;
      let option = null;
      if (Array.isArray(prod.options) && prod.options.length > 0) {
        const pick = document.querySelector('input[name="custOption"]:checked');
        option = pick ? prod.options.find(o => o.id === Number(pick.value)) : null;
        if (!option) {
          this.toast(`Elige ${prod.options.map(o => o.label).join(' o ')} para agregarla al pedido.`, 'warning');
          return;
        }
      }

      if (this.addToCart(prod, customParts.join(', '), option) === false) return;
      this.closeModal('modalCustomization');
      this.pendingCustomizationProduct = null;
    };

    // Shift button
    document.getElementById('btnShiftStatus').onclick = () => this.openShiftModal();
    document.getElementById('btnTriggerShiftModal').onclick = () => this.openShiftModal();

    // Inventory modals
    document.getElementById('btnNewInventoryItem').onclick = () => {
      document.getElementById('invItemModalTitle').textContent = 'Agregar un insumo nuevo';
      document.getElementById('invItemId').value = '';
      this.setInvUnitOptions(null);
      document.getElementById('invConvertMlBox').style.display = 'none';
      document.getElementById('invItemName').value = '';
      document.getElementById('invItemStock').value = '';
      document.getElementById('invItemStock').disabled = false;
      const stockHint = document.getElementById('invItemStockHint');
      if (stockHint) stockHint.style.display = 'none';
      const branchHint = document.getElementById('invItemBranchHint');
      if (branchHint) branchHint.style.display = '';
      document.getElementById('invItemMinStock').value = '';
      document.getElementById('invItemCost').value = '';
      document.getElementById('invItemSupplier').value = '';
      this.fillInvPackForm(null);
      this.suggestInvUnit();
      this.openModal('modalInventoryItem');
    };
    const mlInput = document.getElementById('convertMlPer');
    mlInput.addEventListener('input', () => {
      document.querySelectorAll('#convertMlChips .ml-chip').forEach(c => c.classList.toggle('is-on', c.dataset.ml === mlInput.value.trim()));
      if (this._cml) { clearTimeout(this._cml.timer); this._cml.timer = setTimeout(() => this.loadConvertMlPreview(), 250); }
    });
    document.querySelectorAll('#convertMlChips .ml-chip').forEach(chip => {
      chip.onclick = () => { mlInput.value = chip.dataset.ml; mlInput.dispatchEvent(new Event('input')); };
    });
    document.getElementById('btnConvertMlGo').onclick = () => this.submitConvertMl();
    document.getElementById('invItemCategory').onchange = () => { if (!document.getElementById('invItemId').value) this.suggestInvUnit(); };
    document.getElementById('btnInvConvertMl').onclick = () => { const id = parseInt(document.getElementById('invItemId').value, 10); if (id) this.openConvertMl(id); };

    // Presentación: al cambiar la medida, el tamaño o el costo de la botella se recalcula todo solo
    document.getElementById('invItemUnit').onchange = () => {
      // Un insumo que ya existe no cambia de medida "a pelo": para pasarlo a ml se usa la conversión (que ajusta existencias, costo y recetas)
      const editId = parseInt(document.getElementById('invItemId').value, 10);
      const orig = editId ? (this.inventoryItems || []).find(i => i.id === editId) : null;
      if (orig && document.getElementById('invItemUnit').value === 'ml' && ['pza', 'L', 'oz'].includes(orig.unit)) {
        document.getElementById('invItemUnit').value = orig.unit;
        this.openConvertMl(orig.id);
        return;
      }
      this.refreshInvPackUnits(document.getElementById('invItemUnit').value, null);
      this.syncInvPackUi();
    };
    document.getElementById('invPackName').oninput = () => this.syncInvPackUi();
    document.getElementById('invPackUnit').onchange = () => this.syncInvPackUi();
    const costDigits = () => (document.getElementById('invItemUnit').value === 'ml' ? 6 : 4);   // 1 ml cuesta una fracción de centavo
    document.getElementById('invPackSize').oninput = () => {
      this.syncInvPackUi();
      const size = this.invPackSizeInItemUnit(), pc = parseFloat(document.getElementById('invPackCost').value);
      if (size > 0 && pc > 0) document.getElementById('invItemCost').value = fmtNum(pc / size, costDigits());
    };
    document.getElementById('invPackCost').oninput = () => {
      const size = this.invPackSizeInItemUnit(), pc = parseFloat(document.getElementById('invPackCost').value);
      if (size > 0 && pc > 0) document.getElementById('invItemCost').value = fmtNum(pc / size, costDigits());
    };
    document.getElementById('invItemCost').oninput = () => {
      const size = this.invPackSizeInItemUnit(), c = parseFloat(document.getElementById('invItemCost').value);
      document.getElementById('invPackCost').value = size > 0 && c > 0 ? fmtNum(c * size, 2) : '';
    };

    document.getElementById('invItemForm').onsubmit = async (e) => {
      e.preventDefault();
      const id = document.getElementById('invItemId').value;
      const payload = {
        name: document.getElementById('invItemName').value,
        category: document.getElementById('invItemCategory').value,
        unit: document.getElementById('invItemUnit').value,
        current_stock: parseFloat(document.getElementById('invItemStock').value) || 0,
        min_stock: parseFloat(document.getElementById('invItemMinStock').value) || 0,
        cost_per_unit: parseFloat(document.getElementById('invItemCost').value) || 0,
        supplier: document.getElementById('invItemSupplier').value,
        pack_size: this.invPackSizeInItemUnit(),
        pack_name: document.getElementById('invPackName').value.trim()
      };

      try {
        if (id) {
          const r = await this.api(`/api/inventory/item/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
          this.toast('✔ Cambios guardados.');
          if (r && r.warning) this.toast(r.warning, 'warning');
        } else {
          await this.api('/api/inventory/item', { method: 'POST', body: JSON.stringify(payload) });
          this.toast('✔ Insumo agregado al inventario.');
        }
        this.closeModal('modalInventoryItem');
        this.loadInventory();
        this.loadCatalog();
      } catch (err) {
        this.toast(friendlyError(err), 'error');
      }
    };

    // Llegó mercadería
    document.getElementById('btnRegisterPurchase').onclick = () => this.openPurchaseModal();
    document.getElementById('purchaseItemId').onchange = () => { document.getElementById('purchaseQty').value = ''; document.getElementById('purchaseTotal').value = ''; this.syncPurchaseSteps(); if (this.purchaseItem()) document.getElementById('purchaseQty').focus(); };
    document.getElementById('purchaseQty').addEventListener('input', () => this.updatePurchasePreview());
    document.getElementById('purchaseTotal').addEventListener('input', () => this.updatePurchasePreview());
    document.getElementById('purchaseForm').onsubmit = (e) => { e.preventDefault(); this.submitPurchase(); };

    // Pasar mercadería a otra tienda (todo se conecta una sola vez; las filas usan delegación)
    document.getElementById('btnTransfer').onclick = () => this.openTransferModal();
    document.getElementById('btnTransfersHistory').onclick = () => this.openTransfersModal();
    document.getElementById('trList').addEventListener('click', (e) => this.onTransferListClick(e));
    document.getElementById('trList').addEventListener('input', (e) => {
      const row = e.target.closest('.tr-row');
      if (row) { this.updateTransferRow(row); this.updateTransferSummary(); }
    });
    document.getElementById('trSearch').oninput = () => this.filterTransferRows();
    document.getElementById('trTo').onchange = (e) => { if (this._tr) { this._tr.toId = Number(e.target.value); this.updateTransferSummary(); } };
    document.getElementById('trSwap').onclick = async () => {
      const t = this._tr; if (!t) return;
      const ok = await this.confirmDialog(`Ahora saldrá de ${(this.trBranch(t.toId) || {}).name} y llegará a ${(this.trBranch(t.from) || {}).name}. Se cambia la tienda de arriba.`, { title: '¿Pasarlo al revés?', yes: 'Sí, al revés', no: 'No, volver' });
      if (!ok) return;
      const dest = t.toId;
      this.applyBranch(dest);
      this._tr = { toId: t.from };
      this.openTransferModal();
    };
    document.getElementById('btnTransferGo').onclick = () => this.submitTransfer();

    // Contar inventario
    document.getElementById('btnInvCount').onclick = () => this.openCountModal();
    document.querySelectorAll('[data-count-tab]').forEach(btn => {
      btn.onclick = () => {
        // Después de guardar un conteo, "Contar ahora" empieza limpio (no se quedan los números del conteo anterior)
        if (btn.dataset.countTab === 'new' && this._count && this._count.saved) return this.openCountModal();
        this.showCountTab(btn.dataset.countTab);
      };
    });
    document.getElementById('countSearch').oninput = () => this.filterCountRows();
    document.getElementById('countCat').onchange = () => this.filterCountRows();
    document.getElementById('countRows').addEventListener('input', (e) => {
      const row = e.target.closest('.count-row');
      if (row) { row.classList.remove('is-invalid'); this.updateCountRow(row); this.updateCountSummary(); }
    });
    document.getElementById('btnCountSave').onclick = () => this.saveCount(false);
    document.getElementById('btnCountAdjust').onclick = () => this.saveCount(true);

    // Waste / Spillage modal
    document.getElementById('btnRegisterWaste').onclick = () => {
      const select = document.getElementById('wasteItemId');
      select.innerHTML = this.inventoryItems.map(i => `<option value="${i.id}">${escapeHtml(i.name)} (hay ${fmtBig(i.current_stock, 2)} ${escapeHtml(i.unit)})</option>`).join('');
      document.getElementById('wasteQty').value = '';
      document.getElementById('wasteNotes').value = '';
      this.openModal('modalWaste');
    };

    document.getElementById('wasteForm').onsubmit = async (e) => {
      e.preventDefault();
      try {
        const payload = {
          inventory_item_id: parseInt(document.getElementById('wasteItemId').value, 10),
          quantity: parseFloat(document.getElementById('wasteQty').value),
          reason: document.getElementById('wasteReason').value,
          notes: document.getElementById('wasteNotes').value
        };

        const cuerpo = JSON.stringify(payload);
        const res = await this.api('/api/inventory/waste', { method: 'POST', body: cuerpo, key: this.idemKey('merma', cuerpo + '|' + this.branchId) });
        this.idemDone('merma');
        this.toast(res.message || 'Listo, se restó del inventario.', 'warning');
        this.closeModal('modalWaste');
        this.loadInventory();
        this.loadCatalog();
      } catch (err) {
        this.toast(friendlyError(err), 'error');
      }
    };

    // Product modal
    document.getElementById('btnNewProduct').onclick = () => this.openNewProductModal();
    document.getElementById('btnSetPrices').onclick = () => this.openPricesModal();
    document.getElementById('prodStockMode').onchange = (e) => this.toggleProductTypeSections(e.target.value);
    document.getElementById('btnAddRecipeIngredient').onclick = () => this.addRecipeIngredientRow();
    // El costo de la receta se recalcula al cambiar un ingrediente o su cantidad (antes solo al agregar o quitar)
    const recipeBox = document.getElementById('recipeIngredientsList');
    recipeBox.addEventListener('input', (e) => { if (e.target.classList.contains('recipe-qty-input')) this.calculateRecipeCosts(); });
    recipeBox.addEventListener('change', (e) => { if (e.target.classList.contains('recipe-item-select') || e.target.classList.contains('recipe-qty-input')) this.calculateRecipeCosts(); });
    document.getElementById('prodPrice').oninput = () => this.calculateRecipeCosts();
    document.getElementById('btnAddProdOption').onclick = () => this.addProdOptionRow();
    const optBox = document.getElementById('prodOptionsList');
    optBox.addEventListener('click', (e) => {
      const del = e.target.closest('[data-act="del-opt"]');
      if (!del) return;
      del.closest('.prod-option-row').remove();
      if (!optBox.querySelector('.prod-option-row')) this.renderProdOptionRows([]); else this.refreshProdOptionsUi();
    });
    optBox.addEventListener('change', () => this.refreshProdOptionsUi());
    optBox.addEventListener('input', (e) => { if (e.target.classList.contains('opt-qty')) this.calculateRecipeCosts(); });
    document.getElementById('btnProdPhotoPick').onclick = () => document.getElementById('prodPhotoInput').click();
    document.getElementById('prodPhotoInput').onchange = (e) => this.pickProductPhoto(e.target.files && e.target.files[0]);
    document.getElementById('btnProdPhotoRemove').onclick = () => {
      if (this._prodPhoto.previewUrl) URL.revokeObjectURL(this._prodPhoto.previewUrl);
      this._prodPhoto.blob = null; this._prodPhoto.previewUrl = ''; this._prodPhoto.remove = true;
      document.getElementById('prodPhotoInput').value = '';
      this.renderProductPhoto();
    };
    // Mientras no tenga foto, el dibujo de muestra cambia con la sección y el nombre
    const refreshDrawing = () => { if (!this._prodPhoto || this._prodPhoto.blob || (this._prodPhoto.serverV && !this._prodPhoto.remove)) return; this.renderProductPhoto(); };
    document.getElementById('prodCategory').addEventListener('change', refreshDrawing);
    document.getElementById('prodName').addEventListener('input', refreshDrawing);

    document.getElementById('productForm').onsubmit = async (e) => {
      e.preventDefault();
      const id = document.getElementById('prodEditId').value;
      const modo = document.getElementById('prodStockMode').value; // none | direct | recipe
      // "Se vende tal cual" sin elegir cuál: se trata como "no llevo inventario" (si no, la tarjeta diría "¡Se acabó!")
      const isDirect = modo === 'direct' && !!document.getElementById('prodDirectItem').value;

      const recipe = [];
      if (modo === 'recipe') {
        document.querySelectorAll('.recipe-ingredient-row').forEach(row => {
          const select = row.querySelector('.recipe-item-select');
          const qtyInput = row.querySelector('.recipe-qty-input');
          const invId = parseInt(select.value, 10);
          const qty = parseFloat(qtyInput.value) || 0;
          if (invId && qty > 0) {
            recipe.push({ inventory_item_id: invId, quantity: qty });
          }
        });
      }

      const payload = {
        name: document.getElementById('prodName').value,
        category_id: parseInt(document.getElementById('prodCategory').value, 10),
        description: document.getElementById('prodDescription').value,
        price: parseFloat(document.getElementById('prodPrice').value),
        is_direct_sale: isDirect ? 1 : 0,
        direct_inventory_item_id: (isDirect && document.getElementById('prodDirectItem').value) ? parseInt(document.getElementById('prodDirectItem').value, 10) : null,
        badge: document.getElementById('prodBadge').value,
        recipe,
        // siempre se manda la lista (aunque esté vacía): así quitar todas las opciones también se guarda
        options: this.collectProdOptions()
      };
      if (id) payload.is_active = document.getElementById('prodIsActive').checked ? 1 : 0;

      try {
        let prodId = id;
        if (id) {
          await this.api(`/api/admin/products/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
          this.toast('✔ Cambios guardados.');
        } else {
          const creado = await this.api('/api/admin/products', { method: 'POST', body: JSON.stringify(payload) });
          prodId = creado.productId;
          this.toast('✔ Producto agregado al menú.');
        }
        // La foto se sube (o se quita) después de guardar el producto
        const foto = this._prodPhoto || {};
        if (prodId && foto.blob) {
          try {
            await this.api(`/api/admin/products/${prodId}/image`, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: foto.blob });
          } catch (errFoto) {
            this.toast('El producto se guardó, pero la foto no se pudo subir: ' + friendlyError(errFoto), 'warning');
          }
        } else if (prodId && foto.remove && foto.serverV) {
          await this.api(`/api/admin/products/${prodId}/image`, { method: 'DELETE' }).catch(() => {});
        }
        this.closeModal('modalProduct');
        this.loadAdminProducts();
        this.loadCatalog();
      } catch (err) {
        this.toast(friendlyError(err), 'error');
      }
    };

    // Anular ventas
    document.getElementById('btnVoidSale').onclick = () => { if (this._ticketShown) this.openVoidModal(this._ticketShown); };
    document.getElementById('btnVoidNo').onclick = () => this.closeModal('modalVoid');
    document.getElementById('btnVoidYes').onclick = () => this.submitVoid();
    const voidInput = document.getElementById('voidReason');
    voidInput.oninput = () => {
      document.getElementById('btnVoidYes').disabled = voidInput.value.trim().length < 3 || !!this._voiding;
      document.querySelectorAll('#voidChips .void-chip').forEach(b => b.classList.toggle('active', b.dataset.reason !== '' && b.dataset.reason === voidInput.value.trim()));
    };
    voidInput.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); if (!document.getElementById('btnVoidYes').disabled) this.submitVoid(); } };

    // Menú desplegable de pantallas (tabletas bajitas): se abre con el botón y se cierra al tocar fuera
    const navMenuBtn = document.getElementById('btnNavMenu');
    if (navMenuBtn) navMenuBtn.onclick = (e) => { e.stopPropagation(); this.toggleNavMenu(); };
    document.addEventListener('click', (e) => {
      const nav = document.getElementById('navTabs');
      if (nav && nav.classList.contains('nav-open') && !e.target.closest('#navTabButtons') && !e.target.closest('#btnNavMenu')) this.toggleNavMenu(false);
    });

    // Filter sales
    document.getElementById('btnFilterSales').onclick = () => this.loadSalesHistory();
    document.getElementById('btnExportSalesCsv').onclick = () => this.exportSalesCsv();

    // Sucursales: selector de arriba, Ajustes y cuadros
    ['branchSelect', 'branchSelectDiscrete'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.onchange = () => this.changeBranch(el.value);
    });
    document.getElementById('btnNewBranch').onclick = () => this.openBranchModal();
    document.getElementById('branchForm').onsubmit = (e) => this.saveBranch(e);
    document.getElementById('userBranchesForm').onsubmit = (e) => this.saveUserBranches(e);
    document.getElementById('userRoleInput').onchange = () => this.syncUserBranchesGroup();

    // User management modal
    document.getElementById('btnNewUser').onclick = () => {
      document.getElementById('userModalTitle').textContent = 'Agregar una persona';
      document.getElementById('userFullNameInput').value = '';
      document.getElementById('userUsernameInput').value = '';
      document.getElementById('userPasswordInput').value = '';
      document.getElementById('userRoleInput').value = 'vendedor';
      // Por defecto, la sucursal en la que está el administrador
      document.getElementById('userBranchChecks').innerHTML = this.branchChecksHtml(typeof this.branchId === 'number' ? [this.branchId] : [], 'unb');
      this.syncUserBranchesGroup();
      this.openModal('modalUser');
    };

    document.getElementById('userForm').onsubmit = async (e) => {
      e.preventDefault();
      try {
        const payload = {
          full_name: document.getElementById('userFullNameInput').value.trim(),
          username: document.getElementById('userUsernameInput').value.trim(),
          password: document.getElementById('userPasswordInput').value,
          role: document.getElementById('userRoleInput').value
        };

        if (payload.password.trim().length < 4) {
          this.toast('La contraseña es muy corta: escribe al menos 4 letras o números.', 'warning');
          return;
        }

        if (payload.role === 'vendedor') {
          // Con una sola sucursal no se pregunta: entra a esa
          payload.branch_ids = this.multiBranch ? this.checkedBranchIds('userBranchChecks') : this.branches.map(b => b.id);
          if (payload.branch_ids.length === 0) {
            this.toast('Marca al menos una sucursal para este vendedor.', 'warning');
            return;
          }
        }

        await this.api('/api/admin/users', { method: 'POST', body: JSON.stringify(payload) });
        this.toast(`Listo: ${payload.full_name} ya puede entrar con el usuario “${payload.username}”.`);
        this.closeModal('modalUser');
        this.loadUsers();
      } catch (err) {
        this.toast(friendlyError(err), 'error');
      }
    };

    // Settings form
    document.getElementById('settingsForm').onsubmit = (e) => this.saveSettings(e);

    // Manage Categories
    const btnCat = document.getElementById('btnManageCategories');
    if (btnCat) btnCat.onclick = () => this.openCategoriesModal();
    const formCat = document.getElementById('newCategoryForm');
    if (formCat) formCat.onsubmit = (e) => this.createCategory(e);

    // Reset Demo Data
    const btnResetSales = document.getElementById('btnResetSales');
    if (btnResetSales) btnResetSales.onclick = () => this.resetDemoData('sales_only');
    const btnResetCatalog = document.getElementById('btnResetCatalog');
    if (btnResetCatalog) btnResetCatalog.onclick = () => this.resetDemoData('catalog_only');

    // ===================================================
    // CONTROL DE MESAS EVENT LISTENERS
    // ===================================================
    const areaBox = document.getElementById('tablesAreaFilters');
    if (areaBox) {
      areaBox.onclick = (e) => {
        const btn = e.target.closest('.table-filter-pill');
        if (!btn) return;
        this.tableFilterArea = btn.dataset.area;
        this.renderTableFilters();
        this.renderTablesGrid();
      };
    }

    document.querySelectorAll('#tablesStatusFilters .table-filter-pill').forEach(btn => {
      btn.onclick = () => {
        document.querySelectorAll('#tablesStatusFilters .table-filter-pill').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.tableFilterStatus = btn.dataset.status;
        this.renderTablesGrid();
      };
    });

    // Las gráficas del Resumen están guardadas: al abrirlas se ajustan a su tamaño
    const dashCharts = document.getElementById('dashCharts');
    if (dashCharts) dashCharts.addEventListener('toggle', () => {
      if (dashCharts.open) [this.hourlyChart, this.paymentChart].forEach(c => { if (c) c.resize(); });
    });

    const btnRefreshTables = document.getElementById('btnRefreshTables');
    if (btnRefreshTables) btnRefreshTables.onclick = () => this.loadTables();

    const btnNewTableModal = document.getElementById('btnNewTableModal');
    if (btnNewTableModal) btnNewTableModal.onclick = () => this.openNewTableModal();

    const btnSwitchTable = document.getElementById('btnSwitchTable');
    if (btnSwitchTable) btnSwitchTable.onclick = () => this.switchTab('tables');

    const btnClearActiveTable = document.getElementById('btnClearActiveTable');
    if (btnClearActiveTable) btnClearActiveTable.onclick = () => this.askClearActiveTable();

    const btnSaveTableOrder = document.getElementById('btnSaveTableOrder');
    if (btnSaveTableOrder) btnSaveTableOrder.onclick = () => this.saveOrderToTable();

    const btnPreBillTable = document.getElementById('btnPreBillTable');
    if (btnPreBillTable) btnPreBillTable.onclick = async () => {
      if (!this.activeTable) return;
      // Si hay bebidas nuevas sin guardar, se guardan primero para que la cuenta salga completa
      if (this.cart.some(i => !i.is_existing)) {
        const saved = await this.saveOrderToTable({ quiet: true });
        if (!saved) return;
      }
      this.openPreBillModal(this.activeTable.id);
    };

    const formOpenTable = document.getElementById('formOpenTable');
    if (formOpenTable) formOpenTable.onsubmit = (e) => this.confirmOpenTable(e);

    const formTransferTable = document.getElementById('formTransferTable');
    if (formTransferTable) formTransferTable.onsubmit = (e) => this.confirmTransferTable(e);

    const formNewTable = document.getElementById('formNewTable');
    if (formNewTable) formNewTable.onsubmit = (e) => this.confirmNewTable(e);

    const btnPrintPreBillAction = document.getElementById('btnPrintPreBillAction');
    if (btnPrintPreBillAction) btnPrintPreBillAction.onclick = () => this.printPreBillTicket();

    const btnTransferTableOpenModal = document.getElementById('btnTransferTableOpenModal');
    if (btnTransferTableOpenModal) btnTransferTableOpenModal.onclick = () => {
      if (this.selectedTableForDetail) this.openTransferTableModal(this.selectedTableForDetail.id);
    };

    const btnCancelTableOrder = document.getElementById('btnCancelTableOrder');
    if (btnCancelTableOrder) btnCancelTableOrder.onclick = () => {
      if (this.selectedTableForDetail) this.confirmCancelTable(this.selectedTableForDetail.id);
    };

    const btnPrintPreBillModal = document.getElementById('btnPrintPreBillModal');
    if (btnPrintPreBillModal) btnPrintPreBillModal.onclick = () => {
      if (this.selectedTableForDetail) {
        this.closeModal('modalTableDetail');
        this.openPreBillModal(this.selectedTableForDetail.id);
      }
    };

    const btnAddRoundsToTable = document.getElementById('btnAddRoundsToTable');
    if (btnAddRoundsToTable) btnAddRoundsToTable.onclick = () => {
      if (this.selectedTableForDetail) {
        this.closeModal('modalTableDetail');
        this.setActiveTable(this.selectedTableForDetail);
        this.switchTab('pos');
        this.toast(`Estás agregando bebidas a ${this.selectedTableForDetail.name}. Toca las bebidas y luego “Guardar en la mesa”.`, 'info');
      }
    };

    const btnCheckoutTableDirect = document.getElementById('btnCheckoutTableDirect');
    if (btnCheckoutTableDirect) btnCheckoutTableDirect.onclick = () => {
      if (this.selectedTableForDetail) {
        this.closeModal('modalTableDetail');
        this.setActiveTable(this.selectedTableForDetail);
        this.switchTab('pos');
        this.openPaymentPanel();
      }
    };
  }

  // ===================================================
  // CONTROL DE MESAS & COMANDAS METHODS
  // ===================================================

  async loadTables() {
    try {
      const res = await this.api('/api/pos/tables');
      this.tables = res.tables || [];

      const activeRevenue = this.tables.reduce((sum, t) => sum + (t.order?.total || 0), 0);

      const kpiRev = document.getElementById('kpiActiveTablesRevenue');
      if (kpiRev) kpiRev.textContent = money(activeRevenue);
      const dueChip = document.getElementById('tablesDueChip');
      if (dueChip) dueChip.style.display = activeRevenue > 0 ? '' : 'none';

      this.renderTableFilters();
      this.renderTablesGrid();
    } catch (err) {
      console.error(err);
      this.toast('No se pudieron cargar las mesas. ' + friendlyError(err), 'error');
    }
  }

  // Zonas (solo si hay más de una) y números en los filtros de estado
  renderTableFilters() {
    const tables = this.tables || [];
    const areas = [];
    tables.forEach(t => { if (t.area && !areas.includes(t.area)) areas.push(t.area); });
    if (this.tableFilterArea !== 'all' && !areas.includes(this.tableFilterArea)) this.tableFilterArea = 'all';

    const areaBox = document.getElementById('tablesAreaFilters');
    if (areaBox) {
      if (areas.length < 2) {
        areaBox.style.display = 'none';
        areaBox.innerHTML = '';
        this.tableFilterArea = 'all';
      } else {
        areaBox.style.display = '';
        areaBox.innerHTML = [`<button class="table-filter-pill ${this.tableFilterArea === 'all' ? 'active' : ''}" data-area="all">Todas las zonas</button>`]
          .concat(areas.map(a => `<button class="table-filter-pill ${this.tableFilterArea === a ? 'active' : ''}" data-area="${escapeHtml(a)}">${escapeHtml(a)}</button>`)).join('');
      }
    }

    const inArea = tables.filter(t => this.tableFilterArea === 'all' || t.area === this.tableFilterArea);
    const counts = { all: inArea.length };
    ['libre', 'ocupada', 'cuenta_pedida'].forEach(s => { counts[s] = inArea.filter(t => t.status === s).length; });
    document.querySelectorAll('#tablesStatusFilters .pill-count').forEach(el => { el.textContent = counts[el.dataset.count] ?? 0; });
  }

  renderTablesGrid() {
    const grid = document.getElementById('tablesGrid');
    if (!grid) return;

    let filtered = this.tables;
    if (this.tableFilterArea !== 'all') {
      filtered = filtered.filter(t => t.area === this.tableFilterArea);
    }
    if (this.tableFilterStatus !== 'all') {
      filtered = filtered.filter(t => t.status === this.tableFilterStatus);
    }

    if (filtered.length === 0) {
      const noTables = this.tables.length === 0;
      grid.innerHTML = `
        <div class="empty-state" style="grid-column: 1 / -1;">
          <div class="empty-icon">🪑</div>
          <p>${noTables ? 'Todavía no hay mesas' : 'No hay mesas con ese filtro'}</p>
          <span>${noTables ? 'Toca “➕ Agregar una mesa” para crear la primera.' : 'Toca “Todas las zonas” y “Todas” para ver todas las mesas.'}</span>
        </div>
      `;
      return;
    }

    const canRemoveTables = !!(this.currentUser && this.currentUser.role === 'admin');

    grid.innerHTML = filtered.map(table => {
      const isFree = table.status === 'libre';
      const isBilled = table.status === 'cuenta_pedida';
      const order = table.order;

      let icon = '🪑';
      if (table.area === 'Barra') icon = '🍸';
      else if (table.area === 'Terraza') icon = '🌿';
      else if (table.area.includes('VIP')) icon = '👑';

      let statusPillText = '🟢 Libre';
      let statusPillClass = 'pill-libre';
      if (table.status === 'ocupada') {
        statusPillText = '🟠 Con cuenta';
        statusPillClass = 'pill-ocupada';
      } else if (isBilled) {
        statusPillText = '🟡 Pidieron la cuenta';
        statusPillClass = 'pill-cuenta_pedida';
      }

      const manyAreas = new Set((this.tables || []).map(t => t.area)).size > 1;
      const nItems = order && order.items ? order.items.reduce((s, it) => s + (Number(it.quantity) || 0), 0) : 0;
      const who = order && order.customer_name ? escapeHtml(order.customer_name) : '';

      return `
        <div class="table-card status-${table.status}" data-table-id="${table.id}" style="cursor: pointer;">
          <div class="table-card-top">
            <div class="table-card-title-box">
              <span class="table-card-icon" aria-hidden="true">${icon}</span>
              <div>
                <div class="table-card-name">${escapeHtml(table.name)}</div>
                ${manyAreas ? `<div class="table-card-area">${escapeHtml(table.area)}</div>` : ''}
              </div>
            </div>
            <span class="table-status-pill ${statusPillClass}">
              ${statusPillText}
            </span>
          </div>

          <div class="table-card-body">
            ${isFree ? `
              <div class="table-card-empty-msg">Toca para abrir una cuenta</div>
            ` : `
              <div class="table-total-amount">${money(order.total)}</div>
              <div class="table-card-sub">
                ${who ? `<span class="table-card-who">${who}</span>` : ''}
                <span>⏱️ ${order.minutes_elapsed} min</span>
                <span>${nItems} ${nItems === 1 ? 'producto' : 'productos'}</span>
              </div>
            `}
          </div>

          <div class="table-card-actions">
            ${isFree ? `
              <button type="button" class="table-btn-open-big btn-table-open" data-id="${table.id}" data-name="${escapeHtml(table.name)}">
                🍹 ABRIR CUENTA
              </button>
              ${canRemoveTables ? `
                <button type="button" class="btn btn-secondary btn-sm btn-danger-soft btn-table-delete" data-id="${table.id}" data-name="${escapeHtml(table.name)}" title="Quitar esta mesa de la lista">
                  🗑️ Quitar mesa
                </button>
              ` : ''}
            ` : `
              <button type="button" class="table-btn-action table-btn-order btn-table-manage" data-id="${table.id}" title="Ver lo que han pedido y agregar más bebidas">
                📝 Ver pedido
              </button>
              <button type="button" class="table-btn-action table-btn-pay btn-table-pay" data-id="${table.id}" title="Cobrar la cuenta y dejar la mesa libre">
                💰 Cobrar
              </button>
            `}
          </div>
        </div>
      `;
    }).join('');

    // Tocar cualquier parte de la tarjeta abre lo que corresponde
    grid.querySelectorAll('.table-card').forEach(card => {
      card.onclick = (e) => {
        if (e.target.closest('button')) return; // Ignore if clicked on an inner button
        const tableId = parseInt(card.dataset.tableId, 10);
        const table = this.tables.find(t => t.id === tableId);
        if (!table) return;
        if (table.status === 'libre') {
          this.openTableModal(table.id, table.name);
        } else {
          this.openTableDetailModal(table.id);
        }
      };
    });

    grid.querySelectorAll('.btn-table-open').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        this.openTableModal(parseInt(btn.dataset.id, 10), btn.dataset.name);
      };
    });

    grid.querySelectorAll('.btn-table-delete').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        this.deleteTable(parseInt(btn.dataset.id, 10), btn.dataset.name);
      };
    });

    grid.querySelectorAll('.btn-table-manage').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        this.openTableDetailModal(parseInt(btn.dataset.id, 10));
      };
    });

    grid.querySelectorAll('.btn-table-pay').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const table = this.tables.find(t => t.id === parseInt(btn.dataset.id, 10));
        if (table) {
          this.setActiveTable(table, { quiet: true });
          this.switchTab('pos');
          this.openPaymentPanel();
        }
      };
    });
  }

  openTableModal(tableId, tableName) {
    document.getElementById('openTableId').value = tableId;
    document.getElementById('modalOpenTableTitle').innerHTML = `<span aria-hidden="true">🪑</span> Abrir cuenta: ${escapeHtml(tableName)}`;
    document.getElementById('openTableCustomer').value = '';
    document.getElementById('openTableNotes').value = '';
    this.openModal('modalOpenTable');
  }

  async confirmOpenTable(e) {
    if (e) e.preventDefault();
    const tableId = parseInt(document.getElementById('openTableId').value, 10);
    const customer = document.getElementById('openTableCustomer').value.trim();
    const notes = document.getElementById('openTableNotes').value.trim();

    try {
      await this.api('/api/pos/tables/open', {
        method: 'POST',
        body: JSON.stringify({ table_id: tableId, customer_name: customer, notes })
      });

      this.closeModal('modalOpenTable');
      await this.loadTables();

      const table = this.tables.find(t => t.id === tableId);
      if (table) {
        this.toast(`Cuenta abierta en ${table.name}. Toca las bebidas que pidieron y luego “Guardar en la mesa”.`);
        this.setActiveTable(table, { quiet: true });
        // Direct jump to POS view so waiter can start adding drinks immediately!
        this.switchTab('pos');
      }
    } catch (err) {
      this.toast('No se pudo abrir la cuenta. ' + friendlyError(err), 'error');
    }
  }

  setActiveTable(table, opts = {}) {
    this.activeTable = table;
    const badge = document.getElementById('posTableBadge');
    const nameElem = document.getElementById('posActiveTableName');
    const clientElem = document.getElementById('posActiveTableClient');
    const clearBtn = document.getElementById('btnClearActiveTable');
    const tableActions = document.getElementById('tableCartActions');
    const checkoutLabel = document.getElementById('btnPosCheckoutLabel');
    const iconElem = document.getElementById('posTableIcon');

    if (badge) badge.classList.add('is-table-active');
    if (iconElem) iconElem.textContent = '🪑';
    if (nameElem) nameElem.textContent = table.name;
    if (clientElem) {
      if (table.order?.customer_name) {
        clientElem.textContent = `👤 ${table.order.customer_name}`;
        clientElem.style.display = 'block';
      } else {
        clientElem.style.display = 'none';
      }
    }
    if (clearBtn) clearBtn.style.display = 'inline-flex';
    if (tableActions) tableActions.style.display = 'flex';
    if (checkoutLabel) checkoutLabel.textContent = `COBRAR ${table.name.toUpperCase()}`;

    // Lo que ya está guardado en la cuenta de la mesa
    this.cart = [];
    if (table.order && table.order.items) {
      for (const it of table.order.items) {
        this.cart.push({
          product_id: it.product_id,
          name: it.product_name,
          product_name: it.product_name,
          unit_price: it.unit_price,
          quantity: it.quantity,
          subtotal: it.subtotal,
          customization: it.customization || '',
          is_existing: true,
          table_order_item_id: it.id
        });
      }
    }

    this.renderCart();
    this.switchTab('pos');
    if (!opts.quiet) {
      this.toast(`Estás tomando el pedido de ${table.name}. Toca las bebidas y luego “Guardar en la mesa”.`, 'info');
    }
  }

  clearActiveTable() {
    this.activeTable = null;
    const badge = document.getElementById('posTableBadge');
    const nameElem = document.getElementById('posActiveTableName');
    const clientElem = document.getElementById('posActiveTableClient');
    const clearBtn = document.getElementById('btnClearActiveTable');
    const tableActions = document.getElementById('tableCartActions');
    const checkoutLabel = document.getElementById('btnPosCheckoutLabel');
    const iconElem = document.getElementById('posTableIcon');

    if (badge) badge.classList.remove('is-table-active');
    if (iconElem) iconElem.textContent = '🛍️';
    if (nameElem) nameElem.textContent = 'Cliente en mostrador';
    if (clientElem) clientElem.style.display = 'none';
    if (clearBtn) clearBtn.style.display = 'none';
    if (tableActions) tableActions.style.display = 'none';
    if (checkoutLabel) checkoutLabel.textContent = 'COBRAR';

    this.cart = [];
    this.renderCart();
  }

  // Botón "Quitar mesa": avisa si se perderían bebidas sin guardar
  async askClearActiveTable() {
    const unsaved = this.cart.filter(i => !i.is_existing);
    if (unsaved.length > 0) {
      const ok = await this.confirmDialog(
        'Hay bebidas en el pedido que todavía no guardaste en la mesa. Si sigues, esas bebidas se pierden.',
        { title: '¿Quitar la mesa del pedido?', yes: 'Sí, quitar la mesa', no: 'No, volver', danger: true }
      );
      if (!ok) return;
    }
    this.clearActiveTable();
  }

  // Guarda las bebidas nuevas en la cuenta de la mesa. Devuelve true si todo quedó bien.
  async saveOrderToTable(opts = {}) {
    if (!this.activeTable) return false;

    const newItems = this.cart.filter(i => !i.is_existing);
    if (newItems.length === 0) {
      if (!opts.quiet) this.toast('No hay bebidas nuevas para guardar. Toca una bebida para agregarla primero.', 'info');
      return true;
    }

    try {
      const cuerpo = JSON.stringify({
        table_id: this.activeTable.id,
        items: newItems.map(i => ({
          product_id: i.product_id,
          quantity: i.quantity,
          customization: i.customization || '',
          option_id: i.option_id || null
        }))
      });
      const saved = await this.api('/api/pos/tables/add-items', { method: 'POST', body: cuerpo, key: this.idemKey('mesa-agregar', cuerpo + '|' + this.branchId) });
      this.idemDone('mesa-agregar');

      if (!opts.quiet) this.toast(`Listo: lo pedido quedó guardado en la cuenta de ${this.activeTable.name}.`);
      let updatedTable = null;
      if (saved && saved.table && Array.isArray(this.tables)) {
        // El servidor ya devolvió la mesa actualizada: se usa directo (con internet lento esperar otra petición se nota mucho)
        // y la lista completa se refresca por detrás, sin hacer esperar al cobro.
        const k = this.tables.findIndex(t => t.id === saved.table.id);
        if (k >= 0) this.tables[k] = saved.table; else this.tables.push(saved.table);
        updatedTable = saved.table;
        this.loadTables();
      } else {
        await this.loadTables();
        updatedTable = this.tables.find(t => t.id === this.activeTable.id);
      }
      if (updatedTable) {
        this.setActiveTable(updatedTable, { quiet: true });
      }
      if (!opts.quiet) this.loadCatalog();   // lo pedido en la mesa ya está apartado: el menú muestra lo que de verdad queda
      return true;
    } catch (err) {
      this.toast('No se pudo guardar el pedido en la mesa. ' + friendlyError(err), 'error');
      if (err && err.code === 'SIN_STOCK') this.loadCatalog();   // alguien más vendió lo último: se actualiza el menú
      return false;
    }
  }

  openTableDetailModal(tableId) {
    const table = this.tables.find(t => t.id === tableId);
    if (!table || !table.order) return;

    this.selectedTableForDetail = table;

    document.getElementById('tableDetailTitle').textContent = `🪑 Cuenta de ${table.name} (${table.area})`;
    document.getElementById('tableDetailSubtitle').textContent = table.order.customer_name ? `Cliente: ${table.order.customer_name}` : 'Sin nombre de cliente';
    document.getElementById('tableDetailWaiter').textContent = `Atiende: ${table.order.waiter_name || 'Cajero'}`;
    document.getElementById('tableDetailElapsed').textContent = `⏱️ ${table.order.minutes_elapsed} min`;
    document.getElementById('tableDetailStatus').textContent = table.status === 'cuenta_pedida' ? '🟡 Pidieron la cuenta' : '🟠 Con cuenta abierta';
    document.getElementById('tableDetailTotal').textContent = money(table.order.total);

    const list = document.getElementById('tableComandaList');
    if (!table.order.items || table.order.items.length === 0) {
      list.innerHTML = `<div class="empty-state"><p>Todavía no han pedido nada</p><span>Toca “➕ Agregar bebidas” para empezar.</span></div>`;
    } else {
      list.innerHTML = table.order.items.map(it => `
        <div class="comanda-item-row">
          <div class="comanda-item-info">
            <div class="comanda-item-title" style="display: flex; align-items: center; gap: 0.5rem;">
              <span class="badge-role badge-admin" style="font-weight: 900;">${it.quantity}x</span>
              <span>${escapeHtml(it.product_name)}</span>
            </div>
            ${it.customization ? `<div class="comanda-item-custom" style="margin-left: 2.5rem;">${escapeHtml(it.customization)}</div>` : ''}
            <div class="help-text" style="margin-left: 2.5rem;">Cada uno: ${money(it.unit_price)}</div>
          </div>
          <div style="display: flex; align-items: center; gap: 0.75rem;">
            <div class="comanda-item-price">${money(it.subtotal)}</div>
            <button type="button" class="btn btn-secondary btn-sm btn-danger-soft btn-remove-comanda-item" onclick="app.removeComandaItem(${it.id}, ${table.id})" aria-label="Quitar ${escapeHtml(it.product_name)} de la cuenta">✕ Quitar</button>
          </div>
        </div>
      `).join('');
    }

    this.openModal('modalTableDetail');
  }

  async removeComandaItem(itemId, tableId) {
    const ok = await this.confirmDialog('Este producto se quitará de la cuenta de la mesa.', { title: '¿Quitar este producto?', yes: 'Sí, quitarlo', no: 'No, dejarlo', danger: true });
    if (!ok) return;
    try {
      await this.api('/api/pos/tables/remove-item', {
        method: 'POST',
        body: JSON.stringify({ table_order_item_id: itemId })
      });
      this.toast('Producto quitado de la cuenta.');
      await this.loadTables();
      this.openTableDetailModal(tableId);
    } catch (err) {
      this.toast(friendlyError(err), 'error');
    }
  }

  openPreBillModal(tableId) {
    const table = this.tables.find(t => t.id === tableId);
    if (!table || !table.order) return;

    // Datos del negocio (los que el administrador puso en Ajustes)
    const st = this.settings || {};
    document.getElementById('preBillBizName').textContent = (st.business_name || 'MICHELADAS EL MISMÍSIMO').toUpperCase();
    document.getElementById('preBillBizTagline').textContent = st.tagline || '';
    const contact = [st.address, st.phone ? `Tel: ${st.phone}` : '', st.tax_id].filter(Boolean).join(' • ');
    document.getElementById('preBillBizContact').textContent = contact;
    const preBranch = document.getElementById('preBillBranch');
    if (preBranch) {
      const cur = this.branches.find(b => b.id === this.branchId);
      preBranch.textContent = this.multiBranch && cur ? `Sucursal: ${cur.name}` : '';
      preBranch.style.display = this.multiBranch && cur ? '' : 'none';
    }

    document.getElementById('preBillTableName').textContent = `${table.name} (${table.area})`;
    document.getElementById('preBillCustomer').textContent = table.order.customer_name || 'Consumidor';
    document.getElementById('preBillWaiter').textContent = table.order.waiter_name || 'Cajero';
    document.getElementById('preBillDate').textContent = fmtDateTime(new Date());

    const itemsTbody = document.getElementById('preBillItemsList');
    if (!table.order.items || table.order.items.length === 0) {
      itemsTbody.innerHTML = `<tr><td colspan="3" style="text-align: center;">Sin productos</td></tr>`;
    } else {
      itemsTbody.innerHTML = table.order.items.map(it => `
        <tr>
          <td><strong>${it.quantity}x</strong></td>
          <td>
            ${escapeHtml(it.product_name)}
            ${it.customization ? `<span class="pb-note">${escapeHtml(it.customization)}</span>` : ''}
          </td>
          <td style="text-align: right;"><strong>${money(it.subtotal)}</strong></td>
        </tr>
      `).join('');
    }

    document.getElementById('preBillTotal').textContent = money(table.order.total);

    // Lo mismo, en texto, para la impresión directa
    const curBranch = this.multiBranch ? this.branches.find(b => b.id === this.branchId) : null;
    this._preBill = {
      negocio: (st.business_name || 'MICHELADAS EL MISMÍSIMO').toUpperCase(),
      lema: st.tagline || '',
      contacto: contact,
      sucursal: curBranch ? `Sucursal: ${curBranch.name}` : '',
      titulo: 'CUENTA DE CONSUMO',
      subtitulo: '(Todavía no está pagada)',
      filas: [
        ['MESA:', `${table.name} (${table.area})`],
        ['CLIENTE:', table.order.customer_name || 'Consumidor'],
        ['ATENDIÓ:', table.order.waiter_name || 'Cajero'],
        ['FECHA:', fmtTicketDate(new Date())]
      ],
      items: (table.order.items || []).map(it => ({ cant: it.quantity, nombre: it.product_name, nota: it.customization, monto: money(it.subtotal) })),
      total: ['TOTAL A PAGAR:', money(table.order.total)],
      pie: '¡Muchas gracias por su visita!'
    };
    this.refreshPrintLabels();

    if (table.status === 'ocupada') {
      this.api('/api/pos/tables/request-bill', {
        method: 'POST',
        body: JSON.stringify({ table_id: table.id })
      }).then(() => this.loadTables()).catch(() => {});
    }

    this.openModal('modalPreBill');
  }

  // ===================================================
  // IMPRESIÓN (térmica de 58 mm)
  //   "Con vista previa": se arma una hoja y se abre el cuadro de imprimir del sistema.
  //   "Directa": se mandan los bytes ESC/POS a la app RawBT (Android) y sale de una vez, sin cuadro.
  // La forma elegida se guarda en cada aparato (localStorage), porque depende de la tablet o la compu.
  // ===================================================
  getPrintPrefs() {
    let p = null;
    try { p = JSON.parse(localStorage.getItem('mismisimo_print') || 'null'); } catch (e) { p = null; }
    p = p || this._printPrefsMem || {};
    return { modo: p.modo === 'directo' ? 'directo' : 'dialogo', logo: p.logo !== false, tildes: p.tildes === true };
  }

  setPrintPrefs(cambios) {
    const p = { ...this.getPrintPrefs(), ...cambios };
    this._printPrefsMem = p;
    try { localStorage.setItem('mismisimo_print', JSON.stringify(p)); } catch (e) { /* sin almacenamiento: queda en memoria */ }
    this.refreshPrintLabels();
    if (p.modo === 'directo' && p.logo) this.logoListo();
    return p;
  }

  refreshPrintLabels() {
    const txt = this.getPrintPrefs().modo === 'directo' ? 'directa' : 'con vista previa';
    document.querySelectorAll('[data-print-label]').forEach(el => { el.textContent = txt; });
  }

  esAndroid() { return /Android/i.test(navigator.userAgent || ''); }

  // El logo se pasa a puntos una sola vez (queda guardado) para que, al tocar Imprimir, salga sin esperas
  logoListo() {
    if (!this._logoPromesa) this._logoPromesa = logoARaster('/logo.jpg', 320);
    return this._logoPromesa;
  }

  // Abre RawBT con los bytes. (Aparte, para poder probarlo sin un Android.)
  abrirEnlace(url) { window.location.href = url; }

  // Manda los bytes a RawBT. Devuelve false si este aparato no puede (entonces se usa el cuadro normal).
  enviarDirecto(bytes) {
    if (!this.esAndroid()) {
      this.toast('La impresión directa solo funciona en tablets y celulares Android. Se abre el cuadro de imprimir normal.', 'warning');
      return false;
    }
    const ahora = Date.now();
    if (this._ultimoEnvio && ahora - this._ultimoEnvio < 1200) return true;   // doble toque: que no salgan dos tickets
    this._ultimoEnvio = ahora;
    try {
      this.abrirEnlace(enlaceRawBT(bytes));
    } catch (e) {
      this.toast('No se pudo mandar a RawBT. Se abre el cuadro de imprimir normal.', 'warning');
      return false;
    }
    this.toast('Enviado a la impresora. Si no sale, revisa ⚙️ Impresora.', 'info');
    return true;
  }

  // Lo que lleva el ticket de venta, en texto (el mismo contenido que se ve en pantalla)
  modeloTicket(ticket) {
    const s = ticket.settings || {};
    const filas = [
      ['Folio:', ticket.ticket_number, { negrita: true }],
      ['Fecha:', fmtTicketDate(ticket.created_at)],
      ['Cajero:', ticket.cashier_name || ticket.cashier || 'Cajero']
    ];
    if (ticket.table_name) filas.push(['Mesa:', ticket.table_name, { negrita: true }]);
    if (ticket.customer_name) filas.push(['Cliente:', ticket.customer_name]);
    const subtotales = [['Subtotal:', money(ticket.subtotal)]];
    if (ticket.discount > 0) subtotales.push(['Descuento:', '-' + money(ticket.discount)]);
    if (ticket.card_surcharge > 0) subtotales.push([ticketRecargoEtiqueta(ticket), money(ticket.card_surcharge)]);
    const pagos = [['Pago:', String(ticket.payment_method || '').toUpperCase()]];
    if (ticket.change_given > 0) pagos.push(['Recibido:', money(ticket.amount_paid)], ['Cambio:', money(ticket.change_given)]);
    return {
      negocio: s.business_name || 'MICHELADAS EL MISMÍSIMO',
      lema: s.tagline || 'Refresquería & Bar',
      direccion: s.address || 'Guatemala',
      telefono: s.phone ? `Tel: ${s.phone}` : '',
      nit: s.tax_id || '',
      sucursal: this.multiBranch && ticket.branch_name ? `Sucursal: ${ticket.branch_name}` : '',
      anulada: ticket.status === 'anulada' ? {
        motivo: ticket.void_reason || '-',
        por: `Anulada por ${ticket.voided_by_name || '-'}${ticket.voided_at ? ' el ' + fmtTicketDate(ticket.voided_at) : ''}`
      } : null,
      filas,
      items: (ticket.items || []).map(i => ({ cant: i.quantity, nombre: i.product_name, nota: i.customization, monto: money(i.subtotal) })),
      subtotales,
      total: ['TOTAL:', money(ticket.total)],
      pagos,
      pie: s.ticket_footer || '¡Gracias por su visita! El Mismísimo sabor en micheladas y bebidas.',
      firma: '*** EL MISMÍSIMO ***'
    };
  }

  // Hoja pegada al <body> para el cuadro de imprimir del sistema: sale centrada y sin el cuadro que la rodea
  imprimirHoja(clase, html) {
    let sheet = document.getElementById('printSheet');
    if (!sheet) {
      sheet = document.createElement('div');
      sheet.id = 'printSheet';
      document.body.appendChild(sheet);
    }
    sheet.className = clase;
    sheet.innerHTML = html;
    document.body.classList.add('printing-sheet');
    const cleanup = () => {
      document.body.classList.remove('printing-sheet');
      sheet.innerHTML = '';
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    window.print();
  }

  // Imprime el ticket de la venta
  async printTicket() {
    const t = this._ticketShown;
    const p = this.getPrintPrefs();
    if (p.modo === 'directo' && t) {
      try {
        const logo = p.logo ? await this.logoListo() : null;
        if (this.enviarDirecto(armarTicket(this.modeloTicket(t), { tildes: p.tildes, logo }))) return;
      } catch (e) {
        console.warn('Impresión directa:', e);
        this.toast('No se pudo preparar el ticket para la impresión directa. Se abre el cuadro de imprimir normal.', 'warning');
      }
    }
    const src = document.getElementById('thermalTicketContent');
    if (src) this.imprimirHoja('is-ticket', src.innerHTML);
  }

  // Imprime la cuenta (todavía sin cobrar)
  async printPreBillTicket() {
    const p = this.getPrintPrefs();
    if (p.modo === 'directo' && this._preBill) {
      try {
        const logo = p.logo ? await this.logoListo() : null;
        if (this.enviarDirecto(armarCuenta(this._preBill, { tildes: p.tildes, logo }))) return;
      } catch (e) {
        console.warn('Impresión directa:', e);
        this.toast('No se pudo preparar la cuenta para la impresión directa. Se abre el cuadro de imprimir normal.', 'warning');
      }
    }
    const area = document.getElementById('preBillPrintArea');
    if (area) this.imprimirHoja('prebill', area.innerHTML);
  }

  // Ticket de prueba: sirve para ver si la impresora, las tildes y el logo salen bien
  async imprimirPrueba() {
    const p = this.getPrintPrefs();
    const st = this.settings || {};
    const logo = p.logo ? await this.logoListo() : null;
    const prueba = {
      negocio: st.business_name || 'MICHELADAS EL MISMÍSIMO',
      lema: 'PRUEBA DE IMPRESIÓN',
      filas: [['Fecha:', fmtTicketDate(new Date())], ['Tildes:', 'á é í ó ú ñ Ñ ¿ ¡']],
      items: [
        { cant: 2, nombre: 'Michelada clásica', monto: 'Q 40.00' },
        { cant: 1, nombre: 'Alitas con aderezo especial de la casa', nota: 'Sin picante', monto: 'Q 35.00' }
      ],
      subtotales: [['Subtotal:', 'Q 75.00']],
      total: ['TOTAL:', 'Q 75.00'],
      pagos: [['Pago:', 'EFECTIVO']],
      pie: 'Si se lee bien, la impresora ya quedó lista.',
      firma: '*** EL MISMÍSIMO ***'
    };
    try {
      this.enviarDirecto(armarTicket(prueba, { tildes: p.tildes, logo }));
    } catch (e) {
      console.warn('Impresión de prueba:', e);
      this.toast('No se pudo preparar la prueba de impresión.', 'error');
    }
  }

  // Cuadro "Impresora de este equipo"
  openPrinterModal() {
    const android = this.esAndroid();
    const modal = document.getElementById('modalPrinter');
    if (!modal) return;
    const direct = modal.querySelector('input[name="printMode"][value="directo"]');
    direct.disabled = !android;
    modal.querySelectorAll('input[name="printMode"]').forEach(r => {
      r.onchange = () => { this.setPrintPrefs({ modo: r.value }); this.syncPrinterModal(); };
    });
    document.getElementById('printLogo').onchange = (e) => this.setPrintPrefs({ logo: e.target.checked });
    document.getElementById('printTildes').onchange = (e) => this.setPrintPrefs({ tildes: e.target.checked });
    document.getElementById('btnPrintTest').onclick = () => this.imprimirPrueba();
    this.syncPrinterModal();
    this.openModal('modalPrinter');
  }

  syncPrinterModal() {
    const p = this.getPrintPrefs();
    const android = this.esAndroid();
    document.querySelectorAll('#modalPrinter input[name="printMode"]').forEach(r => { r.checked = r.value === p.modo; });
    document.getElementById('printLogo').checked = p.logo;
    document.getElementById('printTildes').checked = p.tildes;
    document.getElementById('printDirectOptions').style.display = p.modo === 'directo' ? '' : 'none';
    document.getElementById('printNotAndroid').style.display = android ? 'none' : '';
  }

  openTransferTableModal(tableId) {
    const table = this.tables.find(t => t.id === tableId);
    if (!table) return;

    const freeTables = this.tables.filter(t => t.status === 'libre');
    if (freeTables.length === 0) {
      this.toast('No hay mesas libres para pasar esta cuenta.', 'warning');
      return;
    }

    this.closeModal('modalTableDetail');
    document.getElementById('transferFromTableId').value = table.id;
    document.getElementById('transferFromTableLabel').textContent = `Vas a pasar la cuenta de ${table.name} (${table.area}), que lleva ${money(table.order?.total)}.`;

    const select = document.getElementById('transferToTableSelect');
    select.innerHTML = freeTables.map(t => `<option value="${t.id}">${escapeHtml(t.name)} - ${escapeHtml(t.area)}</option>`).join('');
    this.openModal('modalTransferTable');
  }

  async confirmTransferTable(e) {
    e.preventDefault();
    const fromId = parseInt(document.getElementById('transferFromTableId').value, 10);
    const toId = parseInt(document.getElementById('transferToTableSelect').value, 10);

    if (!toId) return;

    try {
      await this.api('/api/pos/tables/transfer', {
        method: 'POST',
        body: JSON.stringify({ from_table_id: fromId, to_table_id: toId })
      });

      this.closeModal('modalTransferTable');
      this.toast('Listo: la cuenta se pasó a la otra mesa.');
      if (this.activeTable && this.activeTable.id === fromId) this.clearActiveTable();
      await this.loadTables();
    } catch (err) {
      this.toast('No se pudo cambiar de mesa. ' + friendlyError(err), 'error');
    }
  }

  async confirmCancelTable(tableId) {
    const table = this.tables.find(t => t.id === tableId);
    if (!table) return;

    const items = table.order?.items?.length || 0;
    const ok = await this.confirmDialog(
      `Se borrará la cuenta de ${table.name} (${items} ${plural(items, 'producto', 'productos')}, ${money(table.order?.total)}) y la mesa quedará libre.\n\nEsto NO se puede deshacer.`,
      { title: '¿Cancelar esta cuenta?', yes: 'Sí, cancelar la cuenta', no: 'No, volver', danger: true }
    );
    if (!ok) return;

    try {
      await this.api('/api/pos/tables/cancel', {
        method: 'POST',
        body: JSON.stringify({ table_id: table.id, reason: 'Cuenta cancelada por el usuario' })
      });

      this.closeModal('modalTableDetail');
      this.toast(`Cuenta cancelada. ${table.name} quedó libre.`);
      if (this.activeTable && this.activeTable.id === table.id) {
        this.clearActiveTable();
      }
      await this.loadTables();
    } catch (err) {
      this.toast('No se pudo cancelar la cuenta. ' + friendlyError(err), 'error');
    }
  }

  openNewTableModal() {
    document.getElementById('newTableName').value = '';
    this.openModal('modalNewTable');
  }

  // Quitar una mesa de la lista (solo administrador, solo si está libre). Las ventas ya hechas no se pierden.
  async deleteTable(id, name) {
    const ok = await this.confirmDialog(
      `Se quita “${name}” de la lista de mesas. Las ventas que ya se hicieron en ella no se borran. Si la necesitas otra vez, puedes agregarla de nuevo.`,
      { title: '¿Quitar esta mesa?', yes: 'Sí, quitar', no: 'No, dejarla', danger: true }
    );
    if (!ok) return;
    try {
      await this.api('/api/pos/tables/delete', {
        method: 'POST',
        body: JSON.stringify({ table_id: id })
      });
      this.toast(`Mesa “${name}” quitada.`);
      await this.loadTables();
    } catch (err) {
      this.toast('No se pudo quitar la mesa. ' + friendlyError(err), 'error');
      await this.loadTables();
    }
  }

  async confirmNewTable(e) {
    e.preventDefault();
    const name = document.getElementById('newTableName').value.trim();
    const area = document.getElementById('newTableArea').value;
    if (!name) {
      this.toast('Escribe el nombre o número de la mesa.', 'warning');
      return;
    }

    try {
      await this.api('/api/pos/tables/create', {
        method: 'POST',
        body: JSON.stringify({ name, area })
      });

      this.closeModal('modalNewTable');
      this.toast(`Mesa “${name}” creada.`);
      await this.loadTables();
    } catch (err) {
      this.toast('No se pudo crear la mesa. ' + friendlyError(err), 'error');
    }
  }

  // Botón "Salir": avisa si hay un pedido sin cobrar
  async askLogout() {
    const unsaved = this.cart.filter(i => !i.is_existing);
    if (unsaved.length > 0) {
      const ok = await this.confirmDialog(
        'Tienes productos en el pedido que todavía no cobraste ni guardaste. Si sales, se pierden.',
        { title: '¿Salir del sistema?', yes: 'Sí, salir', no: 'No, quedarme', danger: true }
      );
      if (!ok) return;
    }
    this.logout();
  }

  logout(opts = {}) {
    this.token = null;
    this.currentUser = null;
    localStorage.removeItem('mismisimo_token');
    localStorage.removeItem('mismisimo_user');
    try { localStorage.removeItem('mismisimo_branch'); } catch (e) { /* sin almacenamiento */ }
    this.branches = [];
    this.branchId = null;
    this.multiBranch = false;
    document.body.classList.remove('multi-branch');
    this.clearActiveTable();
    document.querySelectorAll('.modal-overlay.active').forEach(m => { m.classList.remove('active'); m._cancel = null; });
    this.showAuthView();
    if (opts.expired) {
      this.toast('Tu sesión se venció. Entra otra vez con tu usuario y contraseña.', 'warning');
    } else {
      this.toast('Saliste del sistema. ¡Hasta pronto!');
    }
  }
}

// Instantiate application globally
window.app = new MismisimoApp();
