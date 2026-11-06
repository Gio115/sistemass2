import { DatabaseSync } from 'node:sqlite';
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { aplicarConversion } from './ml_nucleo.js';
import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';

// Dónde se guarda la base de datos (un solo archivo). En este orden:
//  1) la variable de entorno DATA_DIR, si existe (ruta completa de una carpeta);
//  2) en Hostinger (Node.js Web App), cada publicación crea una carpeta NUEVA dentro de ".../domains/<dominio>/hbuilds/";
//     si la base se guardara ahí se perdería al publicar otra versión, así que se guarda al lado: ".../domains/<dominio>/mismisimo-data";
//  3) en cualquier otro caso, la carpeta "data" del proyecto (como siempre).
function chooseDataDir() {
  const fromEnv = (process.env.DATA_DIR || '').trim();
  if (fromEnv) return resolve(fromEnv);
  const here = dirname(fileURLToPath(import.meta.url));
  const m = here.match(/^(.*[\\/]domains[\\/][^\\/]+)[\\/]hbuilds[\\/]/);
  if (m) return join(m[1], 'mismisimo-data');
  return join(process.cwd(), 'data');
}

function prepareDataDir() {
  const wanted = chooseDataDir();
  try {
    if (!existsSync(wanted)) mkdirSync(wanted, { recursive: true });
    return wanted;
  } catch (err) {
    // Si no se puede escribir ahí, se avisa fuerte y se usa la carpeta del proyecto para no dejar el sistema caído.
    const fallback = join(process.cwd(), 'data');
    console.warn(`[DB] No se pudo usar la carpeta de datos "${wanted}" (${err.code || err.message}). Se usará "${fallback}": ahí los datos pueden perderse al publicar una versión nueva.`);
    mkdirSync(fallback, { recursive: true });
    return fallback;
  }
}

export const DATA_DIR = prepareDataDir();

// Nombre libre para una copia de seguridad: si ya hay una con ese nombre (por ejemplo, un reintento en el mismo segundo)
// se le agrega -2, -3... para no perder la copia nueva ni pisar la anterior.
export function rutaLibre(ruta) {
  if (!existsSync(ruta)) return ruta;
  const base = ruta.replace(/\.db$/, '');
  for (let n = 2; n < 100; n++) {
    const r = `${base}-${n}.db`;
    if (!existsSync(r)) return r;
  }
  return ruta;
}
console.log(`[DB] Los datos del negocio se guardan en: ${DATA_DIR}`);

const DB_PATH = join(DATA_DIR, 'mismisimo.db');

// Primera vez en una carpeta SIN base de datos: en vez de empezar con el menú de ejemplo, se empieza con la base que armó el dueño
// (menú, insumos, recetas, fotos y existencias): src/base_inicial/base_inicial.sqlite. Si ya existe una base, NO se toca nunca.
// (Tiene extensión .sqlite a propósito: los paquetes ZIP excluyen "*.db" para no llevarse la base de nadie.)
// SIN_BASE_INICIAL=1 solo sirve para pruebas.
// Los archivos "-wal" y "-shm" que SQLite deja junto a la base guardan los cambios más recientes. Si se cambia la base a mano y se queda el
// "-wal" / "-shm" de la base ANTERIOR, SQLite los mezcla con la base nueva y la daña ("database disk image is malformed"). Por eso, cuando
// no hay base y se va a poner la inicial, los restos de otra base se APARTAN (no se borran: se les agrega ".huerfano-<fecha>").
function apartarRestosDeOtraBase(ruta) {
  const marca = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const apartados = [];
  for (const ext of ['-wal', '-shm']) {
    const f = ruta + ext;
    if (!existsSync(f)) continue;
    try { renameSync(f, `${f}.huerfano-${marca}`); apartados.push(f); }
    catch (e) { try { unlinkSync(f); apartados.push(f); } catch (e2) { console.warn(`[DB] No se pudo apartar ${f}: ${e2.message}`); } }
  }
  return apartados;
}

function copiarBaseInicial() {
  const tmp = DB_PATH + '.copiando';
  const limpiarTemporal = () => {
    for (const f of [tmp, tmp + '-wal', tmp + '-shm']) { try { if (existsSync(f)) unlinkSync(f); } catch (e) { /* si no se puede borrar, se sobrescribe la próxima vez */ } }
  };
  try {
    if (existsSync(DB_PATH) || process.env.SIN_BASE_INICIAL === '1') return;
    const origen = join(dirname(fileURLToPath(import.meta.url)), 'base_inicial', 'base_inicial.sqlite');
    if (!existsSync(origen)) return;
    limpiarTemporal();
    copyFileSync(origen, tmp);
    const prueba = new DatabaseSync(tmp, { readOnly: true });
    const ok = prueba.prepare('PRAGMA quick_check').get().quick_check === 'ok';
    prueba.close();
    for (const f of [tmp + '-wal', tmp + '-shm']) { try { if (existsSync(f)) unlinkSync(f); } catch (e) { /* nada */ } }   // restos de la revisión
    if (!ok) { limpiarTemporal(); console.warn('[DB] La base inicial está dañada: se empieza con una base nueva de ejemplo.'); return; }
    const apartados = apartarRestosDeOtraBase(DB_PATH);
    if (apartados.length) console.warn(`[DB] Había restos de otra base junto a la carpeta de datos (${apartados.map(f => f.split(/[\\/]/).pop()).join(', ')}): se apartaron (quedaron con la terminación ".huerfano-<fecha>") para que no dañen la base nueva.`);
    renameSync(tmp, DB_PATH);
    console.log('[DB] Primera vez en esta carpeta: se empezó con la base del dueño (menú, inventario y recetas ya armados).');
  } catch (err) {
    limpiarTemporal();
    console.warn(`[DB] No se pudo usar la base inicial (${err.message}): se empieza con una base nueva de ejemplo.`);
  }
}
copiarBaseInicial();

// ¿La base de esa ruta está sana? Se abre SOLO PARA LEER (no cambia nada ni junta el "-wal" con la base).
// Devuelve 'ok', 'mala' (dañada o mezclada) o 'error' (no se pudo revisar: permisos, archivo en uso...; en ese caso no se hace nada).
function revisarBase(ruta) {
  try {
    const d = new DatabaseSync(ruta, { readOnly: true });
    const filas = d.prepare('PRAGMA quick_check').all().map(r => String(Object.values(r)[0]));
    d.close();
    return filas.length === 1 && filas[0] === 'ok' ? 'ok' : 'mala';
  } catch (err) { return /malformed|corrupt|not a database/i.test(String(err.message)) ? 'mala' : 'error'; }
}

// Si la base ya existe y trae un "-wal", pero junto con él está MALA y SIN él está sana, el "-wal" es de otra base (pasa al cambiar
// mismisimo.db a mano o con la app encendida). Se aparta (no se borra) antes de abrir la base: así no se mezclan. Un "-wal" bueno (por ejemplo
// el que queda si el sistema se apagó de golpe) NO se toca, porque con él la base sale sana.
function apartarWalSiEstaMezclado() {
  const copia = DB_PATH + '.revisando';
  const limpiar = () => { for (const f of [copia, copia + '-wal', copia + '-shm']) { try { if (existsSync(f)) unlinkSync(f); } catch (e) { /* nada */ } } };
  try {
    if (!existsSync(DB_PATH) || !existsSync(DB_PATH + '-wal')) return;
    if (revisarBase(DB_PATH) !== 'mala') return;        // sana, o no se pudo revisar: no se toca nada
    limpiar();
    copyFileSync(DB_PATH, copia);                       // la base sola, sin su -wal
    const sola = revisarBase(copia);
    limpiar();
    if (sola !== 'ok') return;                          // dañada de verdad: se avisa más abajo, no se toca nada
    const apartados = apartarRestosDeOtraBase(DB_PATH);
    console.warn(`[DB] ⚠️ La base estaba MEZCLADA con archivos de otra base (${apartados.map(f => f.split(/[\\/]/).pop()).join(', ')}). Se apartaron (terminan en ".huerfano-<fecha>") y la base quedó sana.`);
  } catch (err) {
    limpiar();
    console.warn(`[DB] No se pudo revisar si la base estaba mezclada con restos de otra: ${err.message}`);
  }
}
apartarWalSiEstaMezclado();

export const db = new DatabaseSync(DB_PATH);

// Enable WAL mode for concurrent speed and foreign key integrity
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
`);

// Velocidad (no cambia ningún dato ni ninguna cuenta del inventario):
//  - synchronous = NORMAL: en modo WAL cada cobro ya no espera a que el disco del servidor confirme la escritura
//    (en hospedajes compartidos ese disco puede tardar segundos). La base NUNCA queda dañada; solo si se corta la luz
//    del servidor en ese instante exacto podría perderse el último cobro, y para eso están los respaldos.
//  - busy_timeout: si otro proceso está escribiendo, espera hasta 5 s en vez de fallar al instante.
//  - cache_size / temp_store: usa un poco más de memoria para no leer el disco una y otra vez.
try {
  db.exec(`
    PRAGMA synchronous = NORMAL;
    PRAGMA busy_timeout = 5000;
    PRAGMA cache_size = -16000;
    PRAGMA temp_store = MEMORY;
  `);
} catch (err) {
  console.warn(`[DB] No se pudieron ajustar los parámetros de velocidad: ${err.message}`);
}

// Revisión rápida de la base al arrancar: si está dañada o mezclada (por ejemplo, cambiaron mismisimo.db a mano y quedó el "-wal" de otra
// base), el menú todavía se ve pero al cobrar falla con "database disk image is malformed". Se avisa fuerte en el registro y en /api/health.
export const baseEstado = { ok: true, detalle: '' };
try {
  const filas = db.prepare('PRAGMA quick_check').all().map(r => String(Object.values(r)[0]));
  if (!(filas.length === 1 && filas[0] === 'ok')) { baseEstado.ok = false; baseEstado.detalle = filas.slice(0, 5).join(' | '); }
} catch (err) { baseEstado.ok = false; baseEstado.detalle = err.message; }
if (!baseEstado.ok) {
  console.error('[DB] ⚠️⚠️⚠️ LA BASE DE DATOS ESTÁ DAÑADA O MEZCLADA: vender o guardar puede fallar con "database disk image is malformed".');
  console.error(`[DB] Detalle: ${baseEstado.detalle}`);
  console.error('[DB] Qué hacer: apaga el sistema, mueve a otra carpeta los 3 archivos mismisimo.db, mismisimo.db-wal y mismisimo.db-shm de la carpeta de datos y vuelve a iniciar (arranca con la base inicial). Si tienes un respaldo (respaldo_antes_*.db), cópialo como mismisimo.db.');
}

// Password hashing helper using standard Node.js crypto
export function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  const hash = scryptSync(password, salt, 64).toString('hex');
  return { hash, salt };
}

export function verifyPassword(password, salt, storedHash) {
  const hash = Buffer.from(scryptSync(password, salt, 64).toString('hex'));
  const stored = Buffer.from(String(storedHash));
  return hash.length === stored.length && timingSafeEqual(hash, stored);
}

// Avisa en consola si alguna cuenta conserva la contraseña de ejemplo del README.
function warnDefaultPasswords() {
  const defaults = [['admin', 'admin123'], ['vendedor', 'vendedor123']];
  for (const [username, password] of defaults) {
    const u = db.prepare('SELECT salt, password_hash, is_active FROM users WHERE LOWER(username) = ?').get(username);
    if (u && u.is_active && verifyPassword(password, u.salt, u.password_hash)) {
      console.warn(`[SEGURIDAD] ⚠️  El usuario "${username}" todavía usa la contraseña de ejemplo. Cámbiala desde Usuarios antes de publicar el sistema.`);
    }
  }
}

// Initialize tables
export function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS system_settings (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      business_name TEXT DEFAULT 'Micheladas El Mismísimo',
      tagline TEXT DEFAULT 'El Sabor Que Manda • Refresquería & Bar',
      address TEXT DEFAULT 'Ciudad de Guatemala, Guatemala',
      phone TEXT DEFAULT '+502 2345 6789',
      tax_id TEXT DEFAULT 'NIT: 8934521-3',
      ticket_footer TEXT DEFAULT '¡Gracias por su visita! El Mismísimo sabor en micheladas y bebidas.',
      currency_symbol TEXT DEFAULT 'Q',
      logo_path TEXT DEFAULT '/logo.jpg',
      escarchados TEXT DEFAULT 'Chamoy con Tajín, Chamoy con Miguelito, Ajonjolí Acaramelado, Solo Sal y Limón',
      salsas TEXT DEFAULT 'Normal de la Casa, Suave / Poco picante, Bien cargado de salsas, Sin salsas',
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      full_name TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin', 'vendedor')),
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      icon TEXT DEFAULT 'beer',
      display_order INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS inventory_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      unit TEXT NOT NULL, -- 'L', 'ml', 'pza', 'g', 'oz'
      current_stock REAL NOT NULL DEFAULT 0,
      min_stock REAL NOT NULL DEFAULT 5,
      cost_per_unit REAL NOT NULL DEFAULT 0,
      supplier TEXT DEFAULT '',
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id INTEGER REFERENCES categories(id),
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      price REAL NOT NULL,
      cost REAL NOT NULL DEFAULT 0,
      is_direct_sale INTEGER DEFAULT 1, -- 1 = producto empaquetado directo, 0 = preparado con receta
      direct_inventory_item_id INTEGER REFERENCES inventory_items(id),
      badge TEXT DEFAULT '',
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS recipe_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      inventory_item_id INTEGER NOT NULL REFERENCES inventory_items(id),
      quantity REAL NOT NULL -- cantidad en la unidad del insumo (ml, g, pza, etc.)
    );

    -- Presentaciones que el CLIENTE elige al comprar un producto (por ejemplo "Gallo de vidrio" o "Gallo de lata").
    -- Todas cuestan lo mismo; cada una descuenta su propio insumo (quantity por cada unidad vendida) de la sucursal donde se vende.
    CREATE TABLE IF NOT EXISTS product_options (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      label TEXT NOT NULL,
      inventory_item_id INTEGER NOT NULL REFERENCES inventory_items(id),
      quantity REAL NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_product_options_product ON product_options(product_id, sort_order, id);

    -- Foto real de cada producto (JPEG chico, ya recortado y reducido por el navegador). Si no hay foto, el menú usa el dibujo.
    CREATE TABLE IF NOT EXISTS product_images (
      product_id INTEGER PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
      data BLOB NOT NULL,
      version INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cash_shifts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      opened_at TEXT DEFAULT CURRENT_TIMESTAMP,
      initial_cash REAL NOT NULL DEFAULT 0,
      closed_at TEXT,
      expected_cash REAL DEFAULT 0,
      actual_cash REAL DEFAULT 0,
      difference REAL DEFAULT 0,
      total_sales_count INTEGER DEFAULT 0,
      total_sales_amount REAL DEFAULT 0,
      status TEXT DEFAULT 'open' CHECK(status IN ('open', 'closed')),
      notes TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_number TEXT UNIQUE NOT NULL,
      cash_shift_id INTEGER REFERENCES cash_shifts(id),
      cashier_id INTEGER REFERENCES users(id),
      cashier_name TEXT NOT NULL,
      subtotal REAL NOT NULL,
      discount REAL DEFAULT 0,
      total REAL NOT NULL,
      payment_method TEXT NOT NULL CHECK(payment_method IN ('efectivo', 'tarjeta', 'transferencia', 'mixto')),
      amount_paid REAL NOT NULL,
      change_given REAL NOT NULL DEFAULT 0,
      notes TEXT DEFAULT '',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sale_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
      product_id INTEGER REFERENCES products(id),
      product_name TEXT NOT NULL,
      unit_price REAL NOT NULL,
      quantity INTEGER NOT NULL,
      subtotal REAL NOT NULL,
      customization TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS inventory_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      inventory_item_id INTEGER NOT NULL REFERENCES inventory_items(id),
      type TEXT NOT NULL CHECK(type IN ('entrada_compra', 'venta', 'merma_derrame', 'merma_rotura', 'merma_caducidad', 'ajuste')),
      quantity REAL NOT NULL,
      previous_stock REAL NOT NULL,
      new_stock REAL NOT NULL,
      reference_id TEXT DEFAULT '',
      user_id INTEGER REFERENCES users(id),
      notes TEXT DEFAULT '',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS dining_tables (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      area TEXT NOT NULL DEFAULT 'Salón Principal',
      status TEXT NOT NULL DEFAULT 'libre' CHECK(status IN ('libre', 'ocupada', 'cuenta_pedida')),
      display_order INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS table_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      table_id INTEGER NOT NULL REFERENCES dining_tables(id),
      opened_at TEXT DEFAULT CURRENT_TIMESTAMP,
      closed_at TEXT,
      opened_by INTEGER REFERENCES users(id),
      customer_name TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'billed', 'closed')),
      notes TEXT DEFAULT '',
      total REAL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS table_order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      table_order_id INTEGER NOT NULL REFERENCES table_orders(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id),
      product_name TEXT NOT NULL,
      unit_price REAL NOT NULL,
      quantity INTEGER NOT NULL,
      subtotal REAL NOT NULL,
      customization TEXT DEFAULT '',
      added_at TEXT DEFAULT CURRENT_TIMESTAMP,
      added_by INTEGER REFERENCES users(id)
    );

    -- Sucursales. El menú, los precios, las recetas y la lista de insumos son los mismos para todas;
    -- lo que se separa por sucursal son las existencias, las mesas, los turnos de caja y las ventas.
    CREATE TABLE IF NOT EXISTS branches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      display_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- Existencias de cada insumo en cada sucursal.
    CREATE TABLE IF NOT EXISTS inventory_stock (
      branch_id INTEGER NOT NULL REFERENCES branches(id),
      inventory_item_id INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
      current_stock REAL NOT NULL DEFAULT 0,
      min_stock REAL NOT NULL DEFAULT 5,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (branch_id, inventory_item_id)
    );

    -- A qué sucursales puede entrar cada vendedor (el administrador entra a todas).
    CREATE TABLE IF NOT EXISTS user_branches (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      branch_id INTEGER NOT NULL REFERENCES branches(id),
      PRIMARY KEY (user_id, branch_id)
    );

    -- Productos pausados en una sucursal en particular ("aquí se acabó"); en las demás siguen a la venta.
    CREATE TABLE IF NOT EXISTS branch_paused_products (
      branch_id INTEGER NOT NULL REFERENCES branches(id),
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      PRIMARY KEY (branch_id, product_id)
    );
  `);

  // Ensure columns exist on already created databases
  try {
    db.exec("ALTER TABLE system_settings ADD COLUMN escarchados TEXT DEFAULT 'Chamoy con Tajín, Chamoy con Miguelito, Ajonjolí Acaramelado, Solo Sal y Limón';");
  } catch(e) {}
  try {
    db.exec("ALTER TABLE system_settings ADD COLUMN salsas TEXT DEFAULT 'Normal de la Casa, Suave / Poco picante, Bien cargado de salsas, Sin salsas';");
  } catch(e) {}
  try {
    db.exec("ALTER TABLE sales ADD COLUMN table_name TEXT DEFAULT '';");
  } catch(e) {}
  // Recargo por pagar con tarjeta: el porcentaje vive en la configuración del negocio (5 % por defecto)
  // y lo que se cobró de recargo en cada venta queda guardado aparte (0 en todas las ventas anteriores).
  try {
    db.exec("ALTER TABLE system_settings ADD COLUMN card_surcharge_percent REAL NOT NULL DEFAULT 5;");
  } catch(e) {}
  try {
    db.exec("ALTER TABLE sales ADD COLUMN card_surcharge REAL NOT NULL DEFAULT 0;");
  } catch(e) {}
  // "No dejar vender lo que no tiene stock": viene encendido (1). El administrador lo puede apagar en Ajustes si alguna vez lo necesita.
  try {
    db.exec("ALTER TABLE system_settings ADD COLUMN block_no_stock INTEGER NOT NULL DEFAULT 1;");
  } catch(e) {}
  try {
    db.exec("ALTER TABLE sales ADD COLUMN table_id INTEGER;");
  } catch(e) {}
  // Sucursal de cada turno, venta, movimiento de inventario y mesa (las filas viejas se asignan a la primera sucursal más abajo)
  for (const t of ['cash_shifts', 'sales', 'inventory_movements', 'dining_tables']) {
    try { db.exec(`ALTER TABLE ${t} ADD COLUMN branch_id INTEGER;`); } catch (e) { /* ya existe */ }
  }
  // Anulación de ventas: la venta NO se borra; queda marcada (estado, quién la anuló, cuándo y por qué).
  // Las ventas que ya existían quedan como 'completada'.
  for (const col of [
    "status TEXT NOT NULL DEFAULT 'completada'",
    'voided_at TEXT',
    'voided_by INTEGER',
    "voided_by_name TEXT DEFAULT ''",
    "void_reason TEXT DEFAULT ''"
  ]) {
    try { db.exec(`ALTER TABLE sales ADD COLUMN ${col};`); } catch (e) { /* ya existe */ }
  }
  // Productos "quitados" que ya tenían ventas: no se pueden borrar (se perdería la historia), pero ya no se muestran en el Menú.
  try { db.exec('ALTER TABLE products ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;'); } catch (e) { /* ya existe */ }
  // Presentación elegida (vidrio / lata...) en cada producto de una cuenta de mesa: se necesita al cobrar para saber qué descontar.
  try { db.exec('ALTER TABLE table_order_items ADD COLUMN option_id INTEGER;'); } catch (e) { /* ya existe */ }
  // Presentación de compra de cada insumo (ej. "botella" de 25.36 oz): sirve para registrar lo que llega y contar por botellas.
  // pack_size está en la misma unidad del insumo. Sin presentación: pack_name '' y pack_size 0.
  try { db.exec("ALTER TABLE inventory_items ADD COLUMN pack_name TEXT NOT NULL DEFAULT '';"); } catch (e) { /* ya existe */ }
  try { db.exec('ALTER TABLE inventory_items ADD COLUMN pack_size REAL NOT NULL DEFAULT 0;'); } catch (e) { /* ya existe */ }
  // Conteo físico del inventario: lo que DEBÍA haber (según el sistema) contra lo que se contó con las manos.
  // Cada línea guarda una copia del nombre, la unidad y el costo de ese momento, para que el historial no cambie si luego se edita el insumo.
  db.exec(`
    CREATE TABLE IF NOT EXISTS inventory_counts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      branch_id INTEGER NOT NULL,
      user_id INTEGER,
      user_name TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      adjusted INTEGER NOT NULL DEFAULT 0,
      lines_count INTEGER NOT NULL DEFAULT 0,
      missing_value REAL NOT NULL DEFAULT 0,
      surplus_value REAL NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS inventory_count_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      count_id INTEGER NOT NULL REFERENCES inventory_counts(id) ON DELETE CASCADE,
      inventory_item_id INTEGER,
      item_name TEXT NOT NULL,
      unit TEXT NOT NULL,
      expected REAL NOT NULL,
      counted REAL NOT NULL,
      difference REAL NOT NULL,
      cost_per_unit REAL NOT NULL DEFAULT 0,
      diff_value REAL NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_counts_branch ON inventory_counts(branch_id, id);
    CREATE INDEX IF NOT EXISTS idx_count_lines_count ON inventory_count_lines(count_id);
  `);
  // Traspasos de mercadería entre sucursales: qué se pasó, de dónde a dónde, quién y cuándo.
  // Guarda copias del nombre de las sucursales y de cada insumo para que el historial no cambie si luego se editan.
  // (Las existencias se mueven con movimientos normales del inventario; esto es solo el comprobante.)
  db.exec(`
    CREATE TABLE IF NOT EXISTS inventory_transfers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      folio TEXT NOT NULL DEFAULT '',
      from_branch_id INTEGER NOT NULL,
      to_branch_id INTEGER NOT NULL,
      from_branch_name TEXT NOT NULL DEFAULT '',
      to_branch_name TEXT NOT NULL DEFAULT '',
      user_id INTEGER,
      user_name TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      lines_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS inventory_transfer_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transfer_id INTEGER NOT NULL REFERENCES inventory_transfers(id) ON DELETE CASCADE,
      inventory_item_id INTEGER,
      item_name TEXT NOT NULL,
      unit TEXT NOT NULL,
      quantity REAL NOT NULL,
      pack_name TEXT NOT NULL DEFAULT '',
      pack_size REAL NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_transfers_from ON inventory_transfers(from_branch_id, id);
    CREATE INDEX IF NOT EXISTS idx_transfers_to ON inventory_transfers(to_branch_id, id);
    CREATE INDEX IF NOT EXISTS idx_transfer_lines_transfer ON inventory_transfer_lines(transfer_id);

  -- Respuestas ya dadas a un cobro / compra / traspaso, para que un reintento (WiFi flojo) no lo duplique. Se limpian a los 2 días.
  CREATE TABLE IF NOT EXISTS idempotency_keys (
    key TEXT PRIMARY KEY, auth TEXT NOT NULL DEFAULT '', body_hash TEXT NOT NULL DEFAULT '', method TEXT NOT NULL DEFAULT '',
    path TEXT NOT NULL DEFAULT '', status INTEGER NOT NULL DEFAULT 200, response TEXT NOT NULL DEFAULT '', created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_idempotency_created ON idempotency_keys(created_at);
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_sales_branch ON sales(branch_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items(sale_id);
    CREATE INDEX IF NOT EXISTS idx_shifts_branch ON cash_shifts(branch_id, user_id, status);
    CREATE INDEX IF NOT EXISTS idx_movements_branch ON inventory_movements(branch_id, id);
    CREATE INDEX IF NOT EXISTS idx_tables_branch ON dining_tables(branch_id);
    -- "Mi caja", cerrar la caja y los cortes buscan las ventas de UN turno: sin esto revisaban todas las ventas del negocio
    CREATE INDEX IF NOT EXISTS idx_sales_shift ON sales(cash_shift_id, status);
  `);


  // La fila de ajustes siempre existe (en una instalación nueva antes no se creaba).
  db.prepare('INSERT OR IGNORE INTO system_settings (id) VALUES (1)').run();
  // Solo se corrige el símbolo si quedó el "$" de la versión original. Ya NO se pisan NIT, teléfono ni dirección en cada arranque.
  db.prepare("UPDATE system_settings SET currency_symbol = 'Q' WHERE id = 1 AND (currency_symbol IS NULL OR currency_symbol = '' OR currency_symbol = '$')").run();

  // Seed default admin and cashier if no users exist
  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
  if (userCount === 0) {
    const adminHash = hashPassword('admin123');
    db.prepare(`
      INSERT INTO users (username, password_hash, salt, full_name, role)
      VALUES (?, ?, ?, ?, ?)
    `).run('admin', adminHash.hash, adminHash.salt, 'Administrador General', 'admin');

    const sellerHash = hashPassword('vendedor123');
    db.prepare(`
      INSERT INTO users (username, password_hash, salt, full_name, role)
      VALUES (?, ?, ?, ?, ?)
    `).run('vendedor', sellerHash.hash, sellerHash.salt, 'Cajero de Turno', 'vendedor');

    console.log('[DB] Usuarios predeterminados (admin y vendedor) inicializados con éxito.');
  }

  // Seed default categories and inventory if empty
  const categoryCount = db.prepare('SELECT COUNT(*) as count FROM categories').get().count;
  const freshInstall = categoryCount === 0;
  if (categoryCount === 0) {
    seedInitialBarData();
    // Bebidas guatemaltecas (Gallo, Cabro): se agregan DESPUÉS de crear las secciones del menú.
    // (Antes se intentaba antes, y en una instalación nueva, sin base de datos, el sistema se caía al arrancar.)
    // Solo en una instalación nueva: antes se repetía en cada arranque y, si renombrabas o quitabas el insumo
    // "Cerveza Gallo", los productos volvían a aparecer solos.
    ensureGuatemalanDrinks();
  }

  // Seed default dining tables if empty
  seedDiningTables();

  // Sucursales: crea "El Mismísimo" y "VIP entre amigos" la primera vez y deja todo lo que ya existía en la primera.
  migrateBranches();

  // Marinero (litro de clamato) y Michelada con Gallo de vidrio o de lata: una sola vez.
  migrateMarinero(freshInstall);
  migrateCubetazos(freshInstall);
  migrateListaDelDueno();
  migrateQuitarMenuEjemplo();
  migrateSucursalesDelDueno();
  migrateLibretaDelDueno();
  migrateLibreta2DelDueno();
  migrateLista3DelDueno();
  migrateMenuSoloLaLista();
  migrateMedidasEnMl();
  migrateBotellasEnInventario();
  migrateAzulitosEnMl();
  aplicarFotosDelDueno();

  warnDefaultPasswords();
}

// Idempotente: se puede ejecutar en cada arranque sin cambiar nada que ya esté bien.
function migrateBranches() {
  db.exec('BEGIN TRANSACTION;');
  try {
    let first = db.prepare('SELECT id FROM branches ORDER BY display_order ASC, id ASC LIMIT 1').get();
    if (!first) {
      const a = db.prepare("INSERT INTO branches (name, display_order) VALUES ('El Mismísimo', 1)").run();
      db.prepare("INSERT INTO branches (name, display_order) VALUES ('VIP entre amigos', 2)").run();
      first = { id: Number(a.lastInsertRowid) };
      console.log('[DB] Sucursales creadas: "El Mismísimo" (con todo lo que ya tenías) y "VIP entre amigos".');
    }
    const firstId = first.id;

    // Todo lo que todavía no tiene sucursal pertenece a la primera.
    for (const t of ['cash_shifts', 'sales', 'inventory_movements', 'dining_tables']) {
      db.prepare(`UPDATE ${t} SET branch_id = ? WHERE branch_id IS NULL`).run(firstId);
    }

    // Existencias: la primera sucursal conserva las cantidades que ya había; las demás empiezan en 0.
    const branches = db.prepare('SELECT id FROM branches').all();
    const addStock = db.prepare(`
      INSERT OR IGNORE INTO inventory_stock (branch_id, inventory_item_id, current_stock, min_stock)
      SELECT ?, id, ?, min_stock FROM inventory_items
    `);
    for (const b of branches) {
      if (b.id === firstId) {
        db.prepare(`
          INSERT OR IGNORE INTO inventory_stock (branch_id, inventory_item_id, current_stock, min_stock)
          SELECT ?, id, current_stock, min_stock FROM inventory_items
        `).run(b.id);
      } else {
        addStock.run(b.id, 0);
      }
    }

    // Vendedores sin ninguna sucursal asignada entran solo a la primera (el administrador entra a todas).
    db.prepare(`
      INSERT OR IGNORE INTO user_branches (user_id, branch_id)
      SELECT id, ? FROM users
      WHERE role = 'vendedor' AND id NOT IN (SELECT user_id FROM user_branches)
    `).run(firstId);

    // Nunca bajar el número de versión (otras migraciones, como la del marinero, lo suben).
    if (db.prepare('PRAGMA user_version').get().user_version < 1) db.exec('PRAGMA user_version = 1;');
    db.exec('COMMIT;');
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }
}

// Una sola vez (user_version 1 -> 2). Agrega, SIN tocar nada de lo que ya existe:
//  - el insumo "Cerveza Gallo 350ml Lata" (existencias en 0: se llenan con una compra en Inventario),
//  - "Marinero (1 litro)" Q10, "Jugo Preparado Completo (1 litro)" Q15 y "Michelada con Medio Marinero" Q15,
//    esta última con la presentación que elige el cliente: Gallo de vidrio o Gallo de lata.
// Si ya existe cualquier producto con "marinero" en el nombre, se asume que el dueño ya los creó y no se agrega ninguno.
function migrateMarinero(freshInstall) {
  if (db.prepare('PRAGMA user_version').get().user_version >= 2) return;
  db.exec('BEGIN TRANSACTION;');
  try {
    const yaTiene = db.prepare("SELECT 1 FROM products WHERE LOWER(name) LIKE '%marinero%' LIMIT 1").get();
    if (!yaTiene) {
      const findItem = (sql) => db.prepare(sql).get()?.id || null;
      const addItem = (name, category, unit, stock, min, cost, supplier) => {
        const r = db.prepare(`
          INSERT INTO inventory_items (name, category, unit, current_stock, min_stock, cost_per_unit, supplier)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(name, category, unit, stock, min, cost, supplier);
        const id = Number(r.lastInsertRowid);
        // existencias de cada sucursal (la primera conserva la cantidad inicial; las demás empiezan en 0)
        const firstBranch = db.prepare('SELECT id FROM branches ORDER BY display_order ASC, id ASC LIMIT 1').get()?.id;
        for (const b of db.prepare('SELECT id FROM branches').all()) {
          db.prepare('INSERT OR IGNORE INTO inventory_stock (branch_id, inventory_item_id, current_stock, min_stock) VALUES (?, ?, ?, ?)')
            .run(b.id, id, b.id === firstBranch ? stock : 0, min);
        }
        return id;
      };

      const clamato = findItem("SELECT id FROM inventory_items WHERE LOWER(name) LIKE '%clamato%' OR LOWER(name) LIKE '%jugo de tomate%' ORDER BY id LIMIT 1")
        || addItem('Clamato (Jugo de Tomate)', 'Líquidos Insumo', 'L', freshInstall ? 18 : 0, 5, 0, '');
      const gallo = findItem("SELECT id FROM inventory_items WHERE LOWER(name) LIKE '%gallo%' AND LOWER(name) NOT LIKE '%lata%' ORDER BY id LIMIT 1")
        || addItem('Cerveza Gallo 350ml Botella', 'Cerveza Embotellada', 'pza', freshInstall ? 96 : 0, 24, 11.50, 'Cervecería Centro Americana');
      const galloLata = findItem("SELECT id FROM inventory_items WHERE LOWER(name) LIKE '%gallo%' AND LOWER(name) LIKE '%lata%' ORDER BY id LIMIT 1")
        || addItem('Cerveza Gallo 350ml Lata', 'Cerveza Embotellada', 'pza', freshInstall ? 48 : 0, 24, 10.00, 'Cervecería Centro Americana');
      const limon = findItem("SELECT id FROM inventory_items WHERE name LIKE '%Limón%' ORDER BY id LIMIT 1");
      const salsas = findItem("SELECT id FROM inventory_items WHERE name LIKE '%Salsas Negras%' ORDER BY id LIMIT 1");

      const cat = db.prepare("SELECT id FROM categories WHERE name LIKE '%Michelada%' ORDER BY display_order, id LIMIT 1").get()?.id
        || db.prepare('SELECT id FROM categories ORDER BY display_order, id LIMIT 1').get()?.id || 1;
      const costOf = (id) => db.prepare('SELECT cost_per_unit FROM inventory_items WHERE id = ?').get(id)?.cost_per_unit || 0;
      const insP = db.prepare(`
        INSERT INTO products (category_id, name, description, price, cost, is_direct_sale, direct_inventory_item_id, badge)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const insR = db.prepare('INSERT INTO recipe_items (product_id, inventory_item_id, quantity) VALUES (?, ?, ?)');

      // 1) Marinero suelto: 1 litro de clamato, tal cual.
      insP.run(cat, 'Marinero (1 litro)', 'Un litro de jugo de tomate (clamato), solito.', 10, costOf(clamato), 1, clamato, '');

      // 2) Jugo preparado completo: 1 litro de clamato con limón y salsas, hecho al momento.
      let costJugo = costOf(clamato);
      const jugo = Number(insP.run(cat, 'Jugo Preparado Completo (1 litro)', 'Un litro de clamato preparado con limón y salsas, hecho al momento.', 15, 0, 0, null, '').lastInsertRowid);
      insR.run(jugo, clamato, 1);
      if (limon) { insR.run(jugo, limon, 0.04); costJugo += 0.04 * costOf(limon); }
      if (salsas) { insR.run(jugo, salsas, 0.03); costJugo += 0.03 * costOf(salsas); }
      db.prepare('UPDATE products SET cost = ? WHERE id = ?').run(Number(costJugo.toFixed(2)), jugo);

      // 3) Michelada con medio marinero: 0.5 L de clamato + una Gallo; el cliente elige vidrio o lata.
      let costMich = 0.5 * costOf(clamato);
      const mich = Number(insP.run(cat, 'Michelada con Medio Marinero', 'Medio litro de clamato preparado con limón y salsas, con una cerveza Gallo (de vidrio o de lata, a elección).', 15, 0, 0, null, '⭐ A elección').lastInsertRowid);
      insR.run(mich, clamato, 0.5);
      if (limon) { insR.run(mich, limon, 0.02); costMich += 0.02 * costOf(limon); }
      if (salsas) { insR.run(mich, salsas, 0.015); costMich += 0.015 * costOf(salsas); }
      const insO = db.prepare('INSERT INTO product_options (product_id, label, inventory_item_id, quantity, sort_order) VALUES (?, ?, ?, 1, ?)');
      insO.run(mich, 'Gallo de vidrio', gallo, 1);
      insO.run(mich, 'Gallo de lata', galloLata, 2);
      // el costo guardado toma la presentación más cara, para no inflar el margen
      costMich += Math.max(costOf(gallo), costOf(galloLata));
      db.prepare('UPDATE products SET cost = ? WHERE id = ?').run(Number(costMich.toFixed(2)), mich);

      console.log('[DB] Agregados: Marinero (Q10), Jugo Preparado Completo (Q15) y Michelada con Medio Marinero (Q15, Gallo de vidrio o lata).');
    }
    db.exec('PRAGMA user_version = 2;');
    db.exec('COMMIT;');
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }
}

// Una sola vez (user_version 2 -> 3). Se quitó el "descuento a mano" de la pantalla de venta (se prestaba a abusos);
// las promociones ahora son productos con su propio precio. Agrega, SIN tocar nada de lo que ya existe:
//  - "Cubetazo de Gallo (6 cervezas)": baja 6 Gallo de vidrio,
//  - "Cubetazo Mixto (3 Gallo + 3 Gallo Light)": baja 3 de cada una,
//  - "Cubetazo de Corona (6 cervezas)": baja 6 Corona.
// El precio inicial es lo que costarían las 6 cervezas sueltas (o un precio de ejemplo si no hay): el dueño lo cambia en "Menú"
// al precio de su promoción. Si ya existe cualquier producto con "cubetazo" en el nombre, no se agrega ninguno.
function migrateCubetazos(freshInstall) {
  if (db.prepare('PRAGMA user_version').get().user_version >= 3) return;
  db.exec('BEGIN TRANSACTION;');
  try {
    const yaTiene = db.prepare("SELECT 1 FROM products WHERE LOWER(name) LIKE '%cubetazo%' LIMIT 1").get();
    if (!yaTiene) {
      const findItem = (sql) => db.prepare(sql).get()?.id || null;
      const addItem = (name, category, unit, stock, min, cost, supplier) => {
        const r = db.prepare(`
          INSERT INTO inventory_items (name, category, unit, current_stock, min_stock, cost_per_unit, supplier)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(name, category, unit, stock, min, cost, supplier);
        const id = Number(r.lastInsertRowid);
        const firstBranch = db.prepare('SELECT id FROM branches ORDER BY display_order ASC, id ASC LIMIT 1').get()?.id;
        for (const b of db.prepare('SELECT id FROM branches').all()) {
          db.prepare('INSERT OR IGNORE INTO inventory_stock (branch_id, inventory_item_id, current_stock, min_stock) VALUES (?, ?, ?, ?)')
            .run(b.id, id, b.id === firstBranch ? stock : 0, min);
        }
        return id;
      };

      const gallo = findItem("SELECT id FROM inventory_items WHERE LOWER(name) LIKE '%gallo%' AND LOWER(name) NOT LIKE '%lata%' AND LOWER(name) NOT LIKE '%light%' ORDER BY id LIMIT 1")
        || addItem('Cerveza Gallo 350ml Botella', 'Cerveza Embotellada', 'pza', freshInstall ? 96 : 0, 24, 11.50, 'Cervecería Centro Americana');
      const galloLight = findItem("SELECT id FROM inventory_items WHERE LOWER(name) LIKE '%gallo%' AND LOWER(name) LIKE '%light%' AND LOWER(name) NOT LIKE '%lata%' ORDER BY id LIMIT 1")
        || addItem('Cerveza Gallo Light 350ml Botella', 'Cerveza Embotellada', 'pza', freshInstall ? 48 : 0, 24, 11.50, 'Cervecería Centro Americana');
      const corona = findItem("SELECT id FROM inventory_items WHERE LOWER(name) LIKE '%corona%' AND LOWER(name) NOT LIKE '%lata%' ORDER BY id LIMIT 1")
        || addItem('Corona Extra 355ml Botella', 'Cerveza Embotellada', 'pza', freshInstall ? 72 : 0, 24, 21.00, 'Grupo Modelo');

      const cat = db.prepare("SELECT id FROM categories WHERE name LIKE '%Cerveza%' ORDER BY display_order, id LIMIT 1").get()?.id
        || db.prepare('SELECT id FROM categories ORDER BY display_order, id LIMIT 1').get()?.id || 1;
      const costOf = (id) => db.prepare('SELECT cost_per_unit FROM inventory_items WHERE id = ?').get(id)?.cost_per_unit || 0;
      // Lo que cuesta hoy una cerveza suelta en el menú (si el dueño ya la vende); si no, un precio de ejemplo.
      const unitPrice = (itemId, fallback) => {
        const p = db.prepare('SELECT price FROM products WHERE is_direct_sale = 1 AND direct_inventory_item_id = ? AND is_active = 1 ORDER BY id LIMIT 1').get(itemId);
        return p && p.price > 0 ? p.price : fallback;
      };
      const insP = db.prepare(`
        INSERT INTO products (category_id, name, description, price, cost, is_direct_sale, direct_inventory_item_id, badge)
        VALUES (?, ?, ?, ?, ?, 0, NULL, ?)
      `);
      const insR = db.prepare('INSERT INTO recipe_items (product_id, inventory_item_id, quantity) VALUES (?, ?, ?)');
      const make = (name, description, price, parts) => {
        const cost = parts.reduce((sum, [itemId, qty]) => sum + qty * costOf(itemId), 0);
        const id = Number(insP.run(cat, name, description, Number(price.toFixed(2)), Number(cost.toFixed(2)), '🧊 Cubetazo').lastInsertRowid);
        for (const [itemId, qty] of parts) insR.run(id, itemId, qty);
      };

      const pGallo = unitPrice(gallo, 18), pLight = unitPrice(galloLight, pGallo), pCorona = unitPrice(corona, 45);
      make('Cubetazo de Gallo (6 cervezas)', 'Cubeta con 6 cervezas Gallo bien frías.', pGallo * 6, [[gallo, 6]]);
      make('Cubetazo Mixto (3 Gallo + 3 Gallo Light)', 'Cubeta con 3 Gallo y 3 Gallo Light bien frías.', pGallo * 3 + pLight * 3, [[gallo, 3], [galloLight, 3]]);
      make('Cubetazo de Corona (6 cervezas)', 'Cubeta con 6 cervezas Corona bien frías.', pCorona * 6, [[corona, 6]]);
      console.log('[DB] Agregados los cubetazos (Gallo, Mixto y Corona). Ajusta su precio en "Menú" al de tu promoción.');
    }
    db.exec('PRAGMA user_version = 3;');
    db.exec('COMMIT;');
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }
}

// Lo que realmente se vende en el negocio (lista que mandó el dueño). Una sola vez (user_version 3 -> 4).
//  - Cada producto de paquete se crea con SU PROPIO insumo en Inventario con existencias en 0 (se llenan con "Llegó mercadería").
//    Si ya existe el insumo (Gallo, Gallo Light, Gallo lata, Corona, Coca de vidrio...) se usa ese, sin duplicarlo.
//  - Las micheladas por cerveza llevan en la receta solo la cerveza (lo único seguro); el resto se agrega en Menú.
//  - Los tragos y preparados cuya receta no se conoce quedan sin descuento de inventario ("No baja inventario").
//  - NO se sabe el precio: todo entra en Q0 y PAUSADO (no aparece en "Vender") hasta que el dueño le pone precio
//    (botón "Poner precios" en Menú), para que nadie lo venda por error en Q0.
//  - Nunca se repite un producto que ya existe (mismo nombre, o la misma bebida ya vendida directamente).
//  - Costos en 0: se piden en Inventario cuando el dueño los sepa.
const LISTA_DUENO = {
  // clave: [sección, ícono]
  secciones: {
    cervezas: ['%Cerveza%', 'Cervezas Frías', '🍺'],
    micheladas: ['%Michelada%', 'Micheladas & Preparados', '🍹'],
    refrescos: ['%Refresco%', 'Refrescos & Sin Alcohol', '🥤'],
    tragos: ['%Trago%', 'Tragos & Licores', '🥃'],
    botanas: ['%Botana%', 'Botanas & Snacks', '🥜'],
    cigarros: ['%Cigarro%', 'Cigarros', '🚬']
  },
  // Insumos que ya podrían existir (se busca por nombre): [clave, condición SQL sobre LOWER(name), nombre si hay que crearlo, categoría del insumo, unidad]
  insumos: {
    gallo: ["LOWER(name) LIKE '%gallo%' AND LOWER(name) NOT LIKE '%lata%' AND LOWER(name) NOT LIKE '%light%'", 'Cerveza Gallo 350ml Botella', 'Cerveza Embotellada', 'pza'],
    galloLight: ["LOWER(name) LIKE '%gallo%' AND LOWER(name) LIKE '%light%' AND LOWER(name) NOT LIKE '%lata%'", 'Cerveza Gallo Light 350ml Botella', 'Cerveza Embotellada', 'pza'],
    galloLata: ["LOWER(name) LIKE '%gallo%' AND LOWER(name) LIKE '%lata%' AND LOWER(name) NOT LIKE '%light%'", 'Cerveza Gallo 350ml Lata', 'Cerveza Embotellada', 'pza'],
    corona: ["LOWER(name) LIKE '%corona%' AND LOWER(name) NOT LIKE '%lata%' AND LOWER(name) NOT LIKE '%coronita%'", 'Corona Extra 355ml Botella', 'Cerveza Embotellada', 'pza'],
    coronita: ["LOWER(name) LIKE '%coronita%'", 'Coronita 210ml Botella', 'Cerveza Embotellada', 'pza'],
    cocaVidrio: ["LOWER(name) LIKE '%coca%' AND LOWER(name) LIKE '%vidrio%'", 'Coca-Cola Vidrio', 'Refrescos', 'pza']
  },
  // Productos. tipo 'insumo' = se vende tal cual y baja su insumo; 'receta' = lleva la cerveza indicada; 'libre' = no baja inventario.
  productos: [
    // Cervezas
    { n: 'Gallo bot 12 oz', s: 'cervezas', t: 'insumo', i: 'gallo' },
    { n: 'Gallo light bot 12 oz', s: 'cervezas', t: 'insumo', i: 'galloLight' },
    { n: 'Gallo lata 12 oz', s: 'cervezas', t: 'insumo', i: 'galloLata' },
    { n: 'Corona bot 12 oz', s: 'cervezas', t: 'insumo', i: 'corona' },
    { n: 'Coronita', s: 'cervezas', t: 'insumo', i: 'coronita' },
    { n: 'Busch lata', s: 'cervezas', t: 'insumo', nuevo: ['Busch Lata', 'Cerveza Embotellada', 'pza'] },
    { n: 'Monte Carlo bot 12 oz', s: 'cervezas', t: 'insumo', nuevo: ['Monte Carlo 355ml Botella', 'Cerveza Embotellada', 'pza'] },
    { n: 'Tecate', s: 'cervezas', t: 'insumo', nuevo: ['Tecate', 'Cerveza Embotellada', 'pza'] },
    { n: 'Pacifico', s: 'cervezas', t: 'insumo', nuevo: ['Pacífico', 'Cerveza Embotellada', 'pza'] },
    { n: 'Cubetazo de Gallo Light (6 cervezas)', s: 'cervezas', t: 'receta', r: [['galloLight', 6]], yaSi: "LOWER(name) LIKE '%cubetazo%' AND LOWER(name) LIKE '%light%' AND LOWER(name) NOT LIKE '%mixto%'", badge: '🧊 Cubetazo', desc: 'Cubeta con 6 cervezas Gallo Light bien frías.' },
    // Micheladas y preparados
    { n: 'Miche gallo lata', s: 'micheladas', t: 'receta', r: [['galloLata', 1]] },
    { n: 'Miche corona', s: 'micheladas', t: 'receta', r: [['corona', 1]] },
    { n: 'Miche coronita', s: 'micheladas', t: 'receta', r: [['coronita', 1]] },
    { n: 'Miche mineral', s: 'micheladas', t: 'libre' },
    { n: 'Marinero preparado', s: 'micheladas', t: 'libre', yaSi: "LOWER(name) LIKE '%marinero%prepar%' OR LOWER(name) LIKE '%jugo preparado%'" },
    { n: 'Marinero bot 250 ml', s: 'micheladas', t: 'insumo', nuevo: ['Marinero 250 ml Botella', 'Refrescos', 'pza'] },
    // Tragos y licores
    { n: 'Bacardi vip', s: 'tragos', t: 'insumo', nuevo: ['Bacardi VIP', 'Licores', 'pza'] },
    { n: 'Jagger onza', s: 'tragos', t: 'insumo', nuevo: ['Jagger (onzas)', 'Licores', 'oz'] },
    { n: 'Venado XI 1/2 bot', s: 'tragos', t: 'insumo', nuevo: ['Venado XI media botella', 'Licores', 'pza'] },
    { n: 'Tequila Santo bot', s: 'tragos', t: 'insumo', nuevo: ['Tequila Santo Botella', 'Licores', 'pza'] },
    { n: 'Octavo variedad', s: 'tragos', t: 'insumo', nuevo: ['Octavo (variedad)', 'Licores', 'pza'] },
    { n: 'Mezcal', s: 'tragos', t: 'libre' },
    { n: 'Cubata normal', s: 'tragos', t: 'libre' },
    { n: 'Cubata largas', s: 'tragos', t: 'libre' },
    { n: 'Vodka Azulito', s: 'tragos', t: 'libre' },
    // Refrescos, energizantes y aguas
    { n: 'Adrenalina', s: 'refrescos', t: 'insumo', nuevo: ['Adrenalina', 'Refrescos', 'pza'] },
    { n: 'Red Bull', s: 'refrescos', t: 'insumo', nuevo: ['Red Bull', 'Refrescos', 'pza'] },
    { n: 'Jugo V8 lata', s: 'refrescos', t: 'insumo', nuevo: ['Jugo V8 Lata', 'Refrescos', 'pza'] },
    { n: 'Coca lata', s: 'refrescos', t: 'insumo', nuevo: ['Coca-Cola Lata', 'Refrescos', 'pza'] },
    { n: 'Coca vidrio', s: 'refrescos', t: 'insumo', i: 'cocaVidrio' },
    { n: 'Sprite', s: 'refrescos', t: 'insumo', nuevo: ['Sprite', 'Refrescos', 'pza'] },
    { n: 'Pepsitas', s: 'refrescos', t: 'insumo', nuevo: ['Pepsitas', 'Refrescos', 'pza'] },
    { n: 'Gaseosa lata', s: 'refrescos', t: 'insumo', nuevo: ['Gaseosa Lata', 'Refrescos', 'pza'] },
    { n: 'Cimarrona', s: 'refrescos', t: 'insumo', nuevo: ['Cimarrona', 'Refrescos', 'pza'] },
    { n: 'Agua pura bot', s: 'refrescos', t: 'insumo', nuevo: ['Agua Pura Botella', 'Refrescos', 'pza'] },
    { n: 'Gatorade', s: 'refrescos', t: 'insumo', nuevo: ['Gatorade', 'Refrescos', 'pza'] },
    { n: 'Gatorade pequeño', s: 'refrescos', t: 'insumo', nuevo: ['Gatorade pequeño', 'Refrescos', 'pza'] },
    { n: 'Power', s: 'refrescos', t: 'insumo', nuevo: ['Power', 'Refrescos', 'pza'] },
    { n: 'Hidra', s: 'refrescos', t: 'insumo', nuevo: ['Hidra', 'Refrescos', 'pza'] },
    { n: 'Vitafer', s: 'refrescos', t: 'insumo', nuevo: ['Vitafer', 'Refrescos', 'pza'] },
    { n: 'Azul sin licor', s: 'refrescos', t: 'libre' },
    // Botanas
    { n: 'Lays', s: 'botanas', t: 'insumo', nuevo: ['Lays', 'Botanas', 'pza'] },
    { n: 'Sopa Laky variedad', s: 'botanas', t: 'insumo', nuevo: ['Sopa Laky (variedad)', 'Botanas', 'pza'] },
    { n: 'Sopa sin preparar', s: 'botanas', t: 'insumo', nuevo: ['Sopa sin preparar', 'Botanas', 'pza'] },
    { n: 'Alitas Pío Lindo', s: 'botanas', t: 'libre' },
    { n: 'Chiclets', s: 'botanas', t: 'insumo', nuevo: ['Chiclets', 'Botanas', 'pza'] },
    { n: 'Bon Bon', s: 'botanas', t: 'insumo', nuevo: ['Bon Bon', 'Botanas', 'pza'] },
    // Cigarros
    { n: 'Cigarros This sueltos', s: 'cigarros', t: 'insumo', nuevo: ['Cigarros This (sueltos)', 'Cigarros', 'pza'] },
    { n: 'Cigarros This', s: 'cigarros', t: 'insumo', nuevo: ['Cigarros This (cajetilla)', 'Cigarros', 'pza'] },
    { n: 'Modern suelto', s: 'cigarros', t: 'insumo', nuevo: ['Cigarros Modern (sueltos)', 'Cigarros', 'pza'] },
    { n: 'Modern', s: 'cigarros', t: 'insumo', nuevo: ['Cigarros Modern (cajetilla)', 'Cigarros', 'pza'] }
  ]
};

function migrateListaDelDueno() {
  if (db.prepare('PRAGMA user_version').get().user_version >= 4) return;
  db.exec('BEGIN TRANSACTION;');
  try {
    const clave = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const yaExiste = new Set(db.prepare('SELECT name FROM products').all().map(p => clave(p.name)));
    const itemPorNombre = new Map(db.prepare('SELECT id, name FROM inventory_items').all().map(i => [clave(i.name), i.id]));
    const branches = db.prepare('SELECT id FROM branches').all();

    // Sección: la existente que se parezca; si no hay, se crea al final
    const seccion = {};
    for (const [k, [patron, nombre, icono]] of Object.entries(LISTA_DUENO.secciones)) {
      let id = db.prepare('SELECT id FROM categories WHERE name LIKE ? ORDER BY display_order, id LIMIT 1').get(patron)?.id;
      if (!id) {
        const orden = (db.prepare('SELECT COALESCE(MAX(display_order), 0) AS m FROM categories').get().m || 0) + 1;
        id = Number(db.prepare('INSERT INTO categories (name, icon, display_order) VALUES (?, ?, ?)').run(nombre, icono, orden).lastInsertRowid);
      }
      seccion[k] = id;
    }

    const crearInsumo = (nombre, categoria, unidad) => {
      const k = clave(nombre);
      if (itemPorNombre.has(k)) return itemPorNombre.get(k);
      // min_stock 0: sin aviso de "por agotarse" hasta que el dueño le ponga un mínimo; costo 0 hasta que lo sepa
      const id = Number(db.prepare(`
        INSERT INTO inventory_items (name, category, unit, current_stock, min_stock, cost_per_unit, supplier)
        VALUES (?, ?, ?, 0, 0, 0, '')
      `).run(nombre, categoria, unidad).lastInsertRowid);
      for (const b of branches) {
        db.prepare('INSERT OR IGNORE INTO inventory_stock (branch_id, inventory_item_id, current_stock, min_stock) VALUES (?, ?, 0, 0)').run(b.id, id);
      }
      itemPorNombre.set(k, id);
      return id;
    };
    const insumoConocido = {};
    const insumo = (k) => {
      if (insumoConocido[k]) return insumoConocido[k];
      const [cond, nombre, cat, unidad] = LISTA_DUENO.insumos[k];
      insumoConocido[k] = db.prepare(`SELECT id FROM inventory_items WHERE ${cond} ORDER BY id LIMIT 1`).get()?.id || crearInsumo(nombre, cat, unidad);
      return insumoConocido[k];
    };
    const costoDe = (id) => db.prepare('SELECT cost_per_unit FROM inventory_items WHERE id = ?').get(id)?.cost_per_unit || 0;

    const insP = db.prepare(`
      INSERT INTO products (category_id, name, description, price, cost, is_direct_sale, direct_inventory_item_id, badge, is_active)
      VALUES (?, ?, ?, 0, ?, ?, ?, ?, 0)
    `);
    const insR = db.prepare('INSERT INTO recipe_items (product_id, inventory_item_id, quantity) VALUES (?, ?, ?)');

    let creados = 0, existentes = [];
    for (const p of LISTA_DUENO.productos) {
      if (yaExiste.has(clave(p.n)) || (p.yaSi && db.prepare(`SELECT 1 FROM products WHERE ${p.yaSi} LIMIT 1`).get())) { existentes.push(p.n); continue; }

      if (p.t === 'insumo') {
        const itemId = p.i ? insumo(p.i) : crearInsumo(...p.nuevo);
        // Si esa bebida ya se vende directamente con otro nombre (por ejemplo una "Cerveza Gallo 350ml Bien Fría"), no se repite
        if (db.prepare('SELECT 1 FROM products WHERE is_direct_sale = 1 AND direct_inventory_item_id = ? LIMIT 1').get(itemId)) { existentes.push(p.n); continue; }
        insP.run(seccion[p.s], p.n, p.desc || '', costoDe(itemId), 1, itemId, p.badge || '');
      } else if (p.t === 'receta') {
        const partes = p.r.map(([k, q]) => [insumo(k), q]);
        const costo = partes.reduce((s, [id, q]) => s + q * costoDe(id), 0);
        const id = Number(insP.run(seccion[p.s], p.n, p.desc || '', Number(costo.toFixed(2)), 0, null, p.badge || '').lastInsertRowid);
        for (const [itemId, q] of partes) insR.run(id, itemId, q);
      } else {
        insP.run(seccion[p.s], p.n, p.desc || '', 0, 0, null, p.badge || '');
      }
      yaExiste.add(clave(p.n));
      creados++;
    }

    db.exec('PRAGMA user_version = 4;');
    db.exec('COMMIT;');
    console.log(`[DB] Lista de productos del negocio: ${creados} agregados (en Q0 y pausados, con inventario en 0)` +
      (existentes.length ? `; ya existían: ${existentes.join(', ')}.` : '.') +
      ' Ponles precio con "Poner precios" en Menú.');
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }
}

// Una sola vez (user_version 4 -> 5). El dueño pidió dejar en el Menú SOLO lo de su lista: se quita el menú de ejemplo
// que traía el sistema (Victoria, Modelo, Squirt, Cacahuates, Michelada Clásica...).
//  - Solo se tocan productos con el nombre EXACTO del ejemplo: lo que el dueño haya creado o renombrado no se toca.
//  - Los 4 que ya existían con otro nombre se RENOMBRAN como en su lista (mismos precios, recetas e historial).
//  - Un producto que ya aparece en ventas no se borra (se perdería la historia): queda fuera del Menú y de "Vender" (archivado), igual que al "Quitar" en Menú.
//  - El inventario NO se toca (las existencias y los insumos se quedan como están).
//  - Con la variable MANTENER_MENU_EJEMPLO=1 no se hace nada (para pruebas o demostraciones con el menú de ejemplo).
const MENU_EJEMPLO_RENOMBRAR = [
  ['Cerveza Gallo 350ml Bien Fría', 'Gallo bot 12 oz'],
  ['Corona Extra 355ml', 'Corona bot 12 oz'],
  ['Coca-Cola 500ml Vidrio', 'Coca vidrio'],
  ['Jugo Preparado Completo (1 litro)', 'Marinero preparado']
];
const MENU_EJEMPLO_QUITAR = [
  'Michelada Clásica El Mismísimo (1L)', 'Clamato Preparado El Mismísimo (1L)', 'Gomichela Loca El Mismísimo (1L)',
  'Mangochela Tropical (1L)', 'Tarro Barril Preparado (500ml)', 'Victoria 355ml', 'Modelo Especial 355ml',
  'Negra Modelo 355ml', 'Michelob Ultra 355ml', 'Squirt Toronja 600ml', 'Peñafiel Agua Mineral 600ml',
  'Rusa Refrescante Preparada (1L)', 'Shot Tequila Tradicional Reposado (2oz)', 'Cuba Libre Bacardí (Vaso 16oz)',
  'Cacahuates Preparados El Mismísimo', 'Cerveza Cabro Extra 350ml', 'Michelada con Gallo Orgullo (1L)'
];

function migrateQuitarMenuEjemplo() {
  if (db.prepare('PRAGMA user_version').get().user_version >= 5) return;
  if (process.env.MANTENER_MENU_EJEMPLO === '1') return;   // no se marca como hecho: si se quita la variable, se limpia después
  db.exec('BEGIN TRANSACTION;');
  try {
    const clave = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const nombres = new Set(db.prepare('SELECT name FROM products').all().map(p => clave(p.name)));

    let renombrados = 0, borrados = 0, pausados = 0;
    for (const [viejo, nuevo] of MENU_EJEMPLO_RENOMBRAR) {
      const p = db.prepare('SELECT id FROM products WHERE name = ?').get(viejo);
      if (!p || nombres.has(clave(nuevo))) continue;      // no existe, o ya hay uno con el nombre de su lista
      db.prepare('UPDATE products SET name = ? WHERE id = ?').run(nuevo, p.id);
      nombres.delete(clave(viejo)); nombres.add(clave(nuevo));
      renombrados++;
    }

    for (const nombre of MENU_EJEMPLO_QUITAR) {
      for (const p of db.prepare('SELECT id FROM products WHERE name = ?').all(nombre)) {
        const yaVendido = db.prepare('SELECT 1 FROM sale_items WHERE product_id = ? LIMIT 1').get(p.id)
          || db.prepare('SELECT 1 FROM table_order_items WHERE product_id = ? LIMIT 1').get(p.id);
        if (yaVendido) {
          db.prepare('UPDATE products SET is_active = 0, archived = 1 WHERE id = ?').run(p.id);   // fuera del Menú; sus ventas se conservan
          pausados++;
        } else {
          db.prepare('DELETE FROM recipe_items WHERE product_id = ?').run(p.id);
          db.prepare('DELETE FROM product_options WHERE product_id = ?').run(p.id);
          db.prepare('DELETE FROM product_images WHERE product_id = ?').run(p.id);
          db.prepare('DELETE FROM branch_paused_products WHERE product_id = ?').run(p.id);
          db.prepare('DELETE FROM products WHERE id = ?').run(p.id);
          borrados++;
        }
      }
    }

    db.exec('PRAGMA user_version = 5;');
    db.exec('COMMIT;');
    console.log(`[DB] Menú de ejemplo quitado: ${borrados} borrados` + (pausados ? `, ${pausados} ocultos (ya tenían ventas; se conservan solo en el historial)` : '') +
      `, ${renombrados} renombrados como tu lista. El inventario no se tocó.`);
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }
}

// Las sucursales reales del dueño. Una sola vez (user_version 5 -> 6).
//  - Las que ya existen con ese nombre se conservan con todos sus datos ("Vip" cuenta como "VIP entre amigos").
//  - Las que faltan se crean con existencias en 0 y sin mesas (el menú y los precios son los mismos para todas).
//  - Las que no están en la lista (por ejemplo "El Mismísimo", que era solo el nombre del negocio) se OCULTAN, no se borran:
//    sus ventas, cajas y existencias se conservan. Si tienen una caja abierta o una mesa con cuenta, se dejan visibles
//    para que el administrador las cierre y luego las oculte desde Ajustes > Sucursales.
//  - Los vendedores que se quedarían sin ninguna sucursal entran a la primera de la lista.
//  - Con MANTENER_MENU_EJEMPLO=1 no se hace nada (pruebas y demostraciones).
const SUCURSALES_DUENO = ['Cruce', 'Predio', 'Pista', 'Estadio', 'VIP entre amigos', 'Queens Abajo', 'Queens Arriba'];
const SUCURSALES_ALIAS = { vip: 'vip entre amigos' };

function migrateSucursalesDelDueno() {
  const ver = db.prepare('PRAGMA user_version').get().user_version;
  if (ver >= 6 || ver < 5) return;                         // ya hecha, o falta una anterior (se hace en orden)
  if (process.env.MANTENER_MENU_EJEMPLO === '1') return;
  db.exec('BEGIN TRANSACTION;');
  try {
    const clave = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const existentes = db.prepare('SELECT id, name FROM branches ORDER BY display_order, id').all();
    const usadas = new Set();
    const creadas = [];

    SUCURSALES_DUENO.forEach((nombre, i) => {
      const k = clave(nombre);
      const ya = existentes.find(e => !usadas.has(e.id) && (SUCURSALES_ALIAS[clave(e.name)] || clave(e.name)) === k);
      if (ya) {
        usadas.add(ya.id);
        db.prepare('UPDATE branches SET name = ?, is_active = 1, display_order = ? WHERE id = ?').run(nombre, i + 1, ya.id);
      } else {
        const id = Number(db.prepare('INSERT INTO branches (name, is_active, display_order) VALUES (?, 1, ?)').run(nombre, i + 1).lastInsertRowid);
        db.prepare(`
          INSERT OR IGNORE INTO inventory_stock (branch_id, inventory_item_id, current_stock, min_stock)
          SELECT ?, id, 0, min_stock FROM inventory_items
        `).run(id);
        creadas.push(nombre);
      }
    });

    const ocultas = [], visibles = [];
    let orden = SUCURSALES_DUENO.length;
    for (const e of existentes) {
      if (usadas.has(e.id)) continue;
      orden++;
      const turno = db.prepare("SELECT 1 FROM cash_shifts WHERE branch_id = ? AND status = 'open' LIMIT 1").get(e.id);
      const mesa = db.prepare("SELECT 1 FROM dining_tables WHERE branch_id = ? AND is_active = 1 AND status != 'libre' LIMIT 1").get(e.id);
      if (turno || mesa) {
        db.prepare('UPDATE branches SET display_order = ? WHERE id = ?').run(orden, e.id);
        visibles.push(e.name);
      } else {
        db.prepare('UPDATE branches SET is_active = 0, display_order = ? WHERE id = ?').run(orden, e.id);
        ocultas.push(e.name);
      }
    }

    // Que ningún vendedor se quede sin poder entrar
    const primera = db.prepare('SELECT id FROM branches WHERE is_active = 1 ORDER BY display_order, id LIMIT 1').get().id;
    const sinSucursal = db.prepare(`
      SELECT id FROM users
      WHERE role = 'vendedor'
        AND id NOT IN (SELECT ub.user_id FROM user_branches ub JOIN branches b ON b.id = ub.branch_id WHERE b.is_active = 1)
    `).all();
    for (const u of sinSucursal) db.prepare('INSERT OR IGNORE INTO user_branches (user_id, branch_id) VALUES (?, ?)').run(u.id, primera);

    db.exec('PRAGMA user_version = 6;');
    db.exec('COMMIT;');
    console.log(`[DB] Sucursales: ${SUCURSALES_DUENO.join(', ')}.` +
      (creadas.length ? ` Nuevas: ${creadas.join(', ')}.` : '') +
      (ocultas.length ? ` Ocultas (sus datos se conservan): ${ocultas.join(', ')}.` : '') +
      (visibles.length ? ` Siguen visibles por tener caja o mesas abiertas: ${visibles.join(', ')} (ciérralas y ocúltalas en Ajustes).` : '') +
      (sinSucursal.length ? ` ${sinSucursal.length} vendedor(es) pasaron a la primera sucursal; cámbialo en Personal.` : ''));
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }
}

// Precios y costos reales (libreta "Inventarios. Estadio") y recetas explicadas por el dueño. Una sola vez (user_version 6 -> 7).
//  - Cada producto se busca por su nombre del Menú. Solo se le pone el precio si todavía está en Q0 o conserva el precio de ejemplo
//    que traía el sistema: lo que el dueño ya haya puesto él mismo no se pisa.
//  - Cimarrona baja UNA agua mineral del inventario.
//  - Michelada de gallo lata / light / gallo vidrio = medio marinero (0.5 L de clamato) + una cerveza (lata, light o de vidrio).
//  - Costos que salen de los números de la libreta (no estaban escritos): el medio marinero cuesta 12.21 - 5.94 = 6.27 (litro: 12.54)
//    y la Gallo lata 13.52 - 6.27 = 7.25.
//  - Los cubetazos que aún traían el precio de ejemplo (6 x precio de ejemplo) se pausan en Q0: con el precio nuevo de la cerveza ya no tendría sentido.
//  - "Precio cliente" de la libreta NO se aplica (no se sabe qué significa). Smirnoff: su costo no está claro en la libreta, queda en 0.
const LIBRETA_DEMO = { 'Gallo bot 12 oz': [18], 'Corona bot 12 oz': [45, 22], 'Coca vidrio': [30, 10] };   // precios de ejemplo que traía el sistema (45 y 30 en instalación nueva)
const LIBRETA_DIRECTOS = [
  { n: 'Gallo bot 12 oz', precio: 10, costo: 5.94 },
  { n: 'Gallo light bot 12 oz', precio: 10, costo: 5.94 },
  { n: 'Corona bot 12 oz', precio: 15, costo: 7 },
  { n: 'Coronita', precio: 7.5, costo: 4.45 },
  { n: 'Busch lata', precio: 7.5, costo: 4.04 },
  { n: 'Monte Carlo bot 12 oz', precio: 20, costo: 10.2 },
  { n: 'Gaseosa lata', precio: 7, costo: 3.21 },           // en la libreta: "Aguas lata"
  { n: 'Coca lata', precio: 7, costo: 4.58 },
  { n: 'Coca vidrio', precio: 7, costo: 3.33 }
];
const CUBETAZOS_PRECIO_EJEMPLO = [108, 270, 132];        // 6 x 18 (Gallo) y 6 x 45 (Corona) del menú de ejemplo (132 = 6 x 22, base vieja de pruebas)

function migrateLibretaDelDueno() {
  const ver = db.prepare('PRAGMA user_version').get().user_version;
  if (ver >= 7 || ver < 6) return;
  if (process.env.MANTENER_MENU_EJEMPLO === '1') return;
  db.exec('BEGIN TRANSACTION;');
  try {
    const clave = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const branches = db.prepare('SELECT id FROM branches').all();
    const costoDe = (id) => db.prepare('SELECT cost_per_unit FROM inventory_items WHERE id = ?').get(id)?.cost_per_unit || 0;
    const cambiados = new Set();       // insumos cuyo costo cambió
    const tocados = new Set();         // productos que hay que recalcular
    const aplicados = [], omitidos = [];

    const ponerCosto = (id, costo) => {
      if (Math.abs(costoDe(id) - costo) < 0.0001) return;
      db.prepare('UPDATE inventory_items SET cost_per_unit = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(costo, id);
      cambiados.add(id);
    };
    const itemPorNombre = (nombre) => db.prepare('SELECT id, name FROM inventory_items').all().find(i => clave(i.name) === clave(nombre))?.id || null;
    const crearInsumo = (nombre, categoria, unidad) => {
      const ya = itemPorNombre(nombre);
      if (ya) return ya;
      const id = Number(db.prepare(`
        INSERT INTO inventory_items (name, category, unit, current_stock, min_stock, cost_per_unit, supplier)
        VALUES (?, ?, ?, 0, 0, 0, '')
      `).run(nombre, categoria, unidad).lastInsertRowid);
      for (const b of branches) {
        db.prepare('INSERT OR IGNORE INTO inventory_stock (branch_id, inventory_item_id, current_stock, min_stock) VALUES (?, ?, 0, 0)').run(b.id, id);
      }
      return id;
    };
    const insumoConocido = (k) => {
      const [cond, nombre, cat, unidad] = LISTA_DUENO.insumos[k];
      return db.prepare(`SELECT id FROM inventory_items WHERE ${cond} ORDER BY id LIMIT 1`).get()?.id || crearInsumo(nombre, cat, unidad);
    };
    const seccion = (patron) => db.prepare('SELECT id FROM categories WHERE name LIKE ? ORDER BY display_order, id LIMIT 1').get(patron)?.id
      || db.prepare('SELECT id FROM categories ORDER BY display_order, id LIMIT 1').get()?.id || 1;
    const buscar = (nombre) => db.prepare('SELECT id, name, price, is_direct_sale, direct_inventory_item_id FROM products WHERE archived = 0').all()
      .find(p => clave(p.name) === clave(nombre));
    const existeAlgo = (texto) => db.prepare('SELECT name FROM products WHERE archived = 0').all().some(p => clave(p.name).includes(texto));
    // ¿Todavía no tiene su precio real? (Q0, o el precio de ejemplo del sistema)
    const sinPrecioReal = (p, nombre) => p.price <= 0 || (LIBRETA_DEMO[nombre] || []).includes(p.price);
    const ponerReceta = (productId, partes) => {
      db.prepare('DELETE FROM recipe_items WHERE product_id = ?').run(productId);
      for (const [itemId, q] of partes) db.prepare('INSERT INTO recipe_items (product_id, inventory_item_id, quantity) VALUES (?, ?, ?)').run(productId, itemId, q);
    };

    // 1) Bebidas que se venden tal cual: precio de venta y costo
    for (const d of LIBRETA_DIRECTOS) {
      const p = buscar(d.n);
      if (!p) { omitidos.push(`${d.n} (no está en el Menú)`); continue; }
      if (!sinPrecioReal(p, d.n)) { omitidos.push(`${d.n} (ya tenía su precio)`); continue; }
      if (p.is_direct_sale && p.direct_inventory_item_id) ponerCosto(p.direct_inventory_item_id, d.costo);
      db.prepare('UPDATE products SET price = ?, is_active = 1 WHERE id = ?').run(d.precio, p.id);
      tocados.add(p.id); aplicados.push(d.n);
    }

    // 2) Cimarrona: una agua mineral completa
    const cim = buscar('Cimarrona');
    if (!cim) omitidos.push('Cimarrona (no está en el Menú)');
    else if (!sinPrecioReal(cim, 'Cimarrona')) omitidos.push('Cimarrona (ya tenía su precio)');
    else {
      const mineral = itemPorNombre('Agua Mineral') || itemPorNombre('Mineral') || crearInsumo('Agua Mineral', 'Refrescos', 'pza');
      ponerCosto(mineral, 5);
      const insumoViejo = cim.is_direct_sale ? cim.direct_inventory_item_id : null;
      db.prepare('UPDATE products SET is_direct_sale = 0, direct_inventory_item_id = NULL, price = 15, is_active = 1 WHERE id = ?').run(cim.id);
      ponerReceta(cim.id, [[mineral, 1]]);
      tocados.add(cim.id); aplicados.push('Cimarrona');
      // El insumo "Cimarrona" que se creó con la lista ya no se usa: se quita si está vacío y sin movimientos
      const nombreViejo = insumoViejo ? db.prepare('SELECT name FROM inventory_items WHERE id = ?').get(insumoViejo)?.name : null;
      if (insumoViejo && clave(nombreViejo) === 'cimarrona') {
        const enUso = db.prepare('SELECT 1 FROM recipe_items WHERE inventory_item_id = ? LIMIT 1').get(insumoViejo)
          || db.prepare('SELECT 1 FROM product_options WHERE inventory_item_id = ? LIMIT 1').get(insumoViejo)
          || db.prepare('SELECT 1 FROM products WHERE direct_inventory_item_id = ? LIMIT 1').get(insumoViejo)
          || db.prepare('SELECT 1 FROM inventory_movements WHERE inventory_item_id = ? LIMIT 1').get(insumoViejo)
          || db.prepare('SELECT 1 FROM inventory_stock WHERE inventory_item_id = ? AND current_stock != 0 LIMIT 1').get(insumoViejo);
        if (!enUso) {
          db.exec('SAVEPOINT quitar_insumo');
          try {
            db.prepare('DELETE FROM inventory_stock WHERE inventory_item_id = ?').run(insumoViejo);
            db.prepare('DELETE FROM inventory_items WHERE id = ?').run(insumoViejo);
            db.exec('RELEASE quitar_insumo');
          } catch (e) {
            db.exec('ROLLBACK TO quitar_insumo');
            db.exec('RELEASE quitar_insumo');
          }
        }
      }
    }

    // 3) Micheladas: medio marinero + una cerveza
    const clamato = db.prepare("SELECT id FROM inventory_items WHERE LOWER(name) LIKE '%clamato%' OR LOWER(name) LIKE '%jugo de tomate%' ORDER BY id LIMIT 1").get()?.id
      || crearInsumo('Clamato (Jugo de Tomate)', 'Líquidos Insumo', 'L');
    if ([0, 42].includes(costoDe(clamato))) ponerCosto(clamato, 12.54);                 // 0 = sin costo; 42 = el de ejemplo
    const galloLataId = insumoConocido('galloLata');
    if ([0, 10].includes(costoDe(galloLataId))) ponerCosto(galloLataId, 7.25);          // 10 = el de ejemplo
    const micheladas = [
      { n: 'Miche gallo lata', cerveza: galloLataId },
      { n: 'Miche light', cerveza: insumoConocido('galloLight') },
      { n: 'Miche gallo vidrio', cerveza: insumoConocido('gallo') }
    ];
    for (const m of micheladas) {
      const p = buscar(m.n);
      if (p && !sinPrecioReal(p, m.n)) { omitidos.push(`${m.n} (ya tenía su precio)`); continue; }
      const partes = [[clamato, 0.5], [m.cerveza, 1]];
      let id;
      if (p) {
        id = p.id;
        db.prepare('UPDATE products SET price = 25, is_active = 1 WHERE id = ?').run(id);
      } else {
        id = Number(db.prepare(`
          INSERT INTO products (category_id, name, description, price, cost, is_direct_sale, direct_inventory_item_id, badge, is_active)
          VALUES (?, ?, '', 25, 0, 0, NULL, '', 1)
        `).run(seccion('%Michelada%'), m.n).lastInsertRowid);
      }
      ponerReceta(id, partes);
      tocados.add(id); aplicados.push(m.n);
    }

    // 4) Productos de la libreta que no estaban en la lista del Menú
    const nuevos = [
      { n: 'Michelob', clave: 'michelob', sec: '%Cerveza%', insumo: ['Michelob', 'Cerveza Embotellada', 'pza'], precio: 20, costo: 8.12 },
      { n: 'Smirnoff', clave: 'smirnoff', sec: '%Trago%', insumo: ['Smirnoff', 'Licores', 'pza'], precio: 20, costo: 0 }
    ];
    for (const nv of nuevos) {
      if (existeAlgo(nv.clave)) { omitidos.push(`${nv.n} (ya existe)`); continue; }
      const itemId = crearInsumo(...nv.insumo);
      if (nv.costo) ponerCosto(itemId, nv.costo);
      const id = Number(db.prepare(`
        INSERT INTO products (category_id, name, description, price, cost, is_direct_sale, direct_inventory_item_id, badge, is_active)
        VALUES (?, ?, '', ?, ?, 1, ?, '', 1)
      `).run(seccion(nv.sec), nv.n, nv.precio, nv.costo, itemId).lastInsertRowid);
      tocados.add(id); aplicados.push(nv.n);
    }

    // 5) Cubetazos que seguían con el precio de ejemplo: se pausan en Q0 hasta que el dueño ponga el real
    const cubetazosPausados = [];
    for (const p of db.prepare('SELECT id, name, price, is_active FROM products WHERE archived = 0').all()) {
      if (clave(p.name).includes('cubetazo') && p.is_active === 1 && CUBETAZOS_PRECIO_EJEMPLO.includes(p.price)) {
        db.prepare('UPDATE products SET price = 0, is_active = 0 WHERE id = ?').run(p.id);
        cubetazosPausados.push(p.name);
      }
    }

    // 6) Costos de los productos que usan algún insumo cuyo costo cambió
    for (const id of cambiados) {
      for (const r of db.prepare('SELECT product_id FROM recipe_items WHERE inventory_item_id = ?').all(id)) tocados.add(r.product_id);
      for (const r of db.prepare('SELECT product_id FROM product_options WHERE inventory_item_id = ?').all(id)) tocados.add(r.product_id);
      for (const r of db.prepare('SELECT id FROM products WHERE direct_inventory_item_id = ?').all(id)) tocados.add(r.id);
    }
    for (const pid of tocados) {
      const p = db.prepare('SELECT is_direct_sale, direct_inventory_item_id FROM products WHERE id = ?').get(pid);
      if (!p) continue;
      let base = p.is_direct_sale && p.direct_inventory_item_id
        ? costoDe(p.direct_inventory_item_id)
        : db.prepare('SELECT quantity, inventory_item_id FROM recipe_items WHERE product_id = ?').all(pid).reduce((t, r) => t + r.quantity * costoDe(r.inventory_item_id), 0);
      const opts = db.prepare('SELECT quantity, inventory_item_id FROM product_options WHERE product_id = ?').all(pid);
      if (opts.length) base = (p.is_direct_sale ? 0 : base) + Math.max(0, ...opts.map(o => o.quantity * costoDe(o.inventory_item_id)));
      db.prepare('UPDATE products SET cost = ? WHERE id = ?').run(Number(base.toFixed(2)), pid);
    }

    db.exec('PRAGMA user_version = 7;');
    db.exec('COMMIT;');
    console.log(`[DB] Precios y recetas de la libreta: ${aplicados.length} aplicados (${aplicados.join(', ')})` +
      (omitidos.length ? `; sin cambios: ${omitidos.join(', ')}` : '') +
      (cubetazosPausados.length ? `; cubetazos pausados por traer precio de ejemplo: ${cubetazosPausados.join(', ')}` : '') + '.');
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }
}

// Segunda hoja de la libreta (precio costo / precio venta de VB, cigarros, alitas, papas, sopas, octavos, azulitos, Vitafer, marinero y Michel Corona).
// Una sola vez (user_version 7 -> 8).
//  - Cada producto se busca por su nombre del Menú y solo se le pone el precio si todavía está en Q0: lo que el dueño ya puso no se pisa.
//  - El costo del Marinero (Q4.70) corrige el costo del litro de clamato que se había deducido antes (Q12.54): ahora Q4.70.
//    El marinero preparado cuesta Q8.52: el "aderezo" (limón + salsas) es Q3.82 por litro de marinero; como el dueño aún no puso el costo real de
//    esos dos insumos (siguen con el de ejemplo, Q35 y Q65), se ajustan en la misma proporción para que cuadre con su libreta.
//  - Michel Corona (Q30, costo Q13.17) = Corona Q7.00 + medio marinero Q2.35 + aderezo Q3.82: cuadra al centavo con la libreta. Las otras micheladas
//    (Gallo lata, Light y vidrio) llevan ese mismo aderezo; así salen a pocos centavos de lo que dice la libreta (12.11 / 12.11 / 13.42 contra 12.21 / 12.21 / 13.52).
//  - Los tres productos que no bajaban inventario (alitas, Vodka Azulito, Azul sin licor) pasan a venderse tal cual con su propio insumo en 0, para poder guardar su costo.
//  - "VB" no estaba en el Menú: se agrega en Cervezas Frías. Los cigarros This "3x5" se agregan como producto aparte (3 sueltos por Q5).
const LIBRETA2 = [
  // n = nombre en el Menú; en la libreta: Cigarros This / Cigarros Modern / Papas / Sopa preparada / Sopa s/con agua / Octavos / Azulitos c/alcohol / s/alcohol / Vitafer / Alitas
  { n: 'Cigarros This sueltos', precio: 2, costo: 0.45 },
  { n: 'Modern suelto', precio: 1, costo: 0.45 },
  { n: 'Lays', precio: 20, costo: 7.12 },
  { n: 'Sopa Laky variedad', precio: 15, costo: 6.16 },
  { n: 'Sopa sin preparar', precio: 10, costo: 4.66 },
  { n: 'Octavo variedad', precio: 14, costo: 8 },
  { n: 'Vitafer', precio: 20, costo: 6 },
  { n: 'Alitas Pío Lindo', precio: 70, costo: 40.12, insumo: ['Alitas Pío Lindo', 'Botanas', 'pza'] },
  { n: 'Vodka Azulito', precio: 25, costo: 11.11, insumo: ['Vodka Azulito', 'Licores', 'pza'] },
  { n: 'Azul sin licor', precio: 20, costo: 9.2, insumo: ['Azul sin licor', 'Refrescos', 'pza'] }
];
// ---------------------------------------------------------------------------------------------------------------------
// Fotos de productos que mandó el dueño (carpeta src/fotos_dueno, ya recortadas a 480 px).
// Se ejecuta en cada arranque, pero cada foto se pone UNA sola vez:
//  - solo en un producto que todavía NO tiene foto (nunca pisa una que el administrador ya puso);
//  - si el producto aún no existe (por ejemplo "Bote de Vitafer"), la foto espera y se pone sola en el primer arranque después de crearlo;
//  - queda anotada en fotos_dueno_aplicadas: si el administrador la quita después con "Quitar foto", no vuelve a aparecer.
// Cada foto lista los nombres con que puede llamarse el producto; vale el primero que exista (sin importar mayúsculas, tildes ni espacios).
// ---------------------------------------------------------------------------------------------------------------------
const FOTOS_DUENO = [
  { f: 'miche_gallo_lata.jpg', nombres: ['Miche gallo lata'] },
  { f: 'miche_gallo_vidrio.jpg', nombres: ['Miche gallo vidrio', 'Miche gallo'] },
  { f: 'smirnoff.jpg', nombres: ['Smirnoff'] },
  { f: 'tequila_santo.jpg', nombres: ['Tequila Santo bot', 'Tequila Santo'] },
  { f: 'bote_vitafer.jpg', nombres: ['Bote de Vitafer', 'Vitafer bote'] },
  { f: 'vitafer_10ml.jpg', nombres: ['10 ml de Vitafer', 'Vitafer 10 ml', 'Vitafer'] },
  { f: 'sopa_preparada.jpg', nombres: ['Sopa preparada', 'Sopa Laky variedad'] },
  { f: 'jaggerbomb.jpg', nombres: ['JaggerBomb', 'Jagger bomb', 'Jagger onza'] },
  { f: 'pacifico.jpg', nombres: ['Pacifico'] },
  { f: 'miche_coronita.jpg', nombres: ['Miche coronita'] },
  { f: 'cimarrona.jpg', nombres: ['Cimarrona'] },
  { f: 'miche_pacifico.jpg', nombres: ['Miche pacifico'] },
  { f: 'miche_montecarlo.jpg', nombres: ['Miche Montecarlo', 'Miche Monte Carlo'] }
];

function aplicarFotosDelDueno() {
  if (process.env.MANTENER_MENU_EJEMPLO === '1') return;
  const carpeta = join(dirname(fileURLToPath(import.meta.url)), 'fotos_dueno');
  if (!existsSync(carpeta)) return;
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS fotos_dueno_aplicadas (
      archivo TEXT PRIMARY KEY,
      product_id INTEGER,
      resultado TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);
    const clave = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
    const productos = db.prepare('SELECT id, name FROM products WHERE archived = 0').all();
    const yaAplicada = db.prepare('SELECT 1 FROM fotos_dueno_aplicadas WHERE archivo = ?');
    const tieneFoto = db.prepare('SELECT 1 FROM product_images WHERE product_id = ?');
    const anotar = db.prepare('INSERT OR IGNORE INTO fotos_dueno_aplicadas (archivo, product_id, resultado) VALUES (?, ?, ?)');
    let n = 0;
    for (const foto of FOTOS_DUENO) {
      if (yaAplicada.get(foto.f)) continue;
      let prod = null;
      for (const nombre of foto.nombres) {
        prod = productos.find(p => clave(p.name) === clave(nombre));
        if (prod) break;
      }
      if (!prod) continue;                                   // el producto todavía no existe: la foto espera
      const ruta = join(carpeta, foto.f);
      if (!existsSync(ruta)) continue;
      if (tieneFoto.get(prod.id)) { anotar.run(foto.f, prod.id, 'ya tenía foto'); continue; }
      const datos = readFileSync(ruta);
      const esJpeg = datos.length > 200 && datos[0] === 0xFF && datos[1] === 0xD8 && datos[datos.length - 2] === 0xFF && datos[datos.length - 1] === 0xD9;
      if (!esJpeg) continue;
      db.prepare('INSERT INTO product_images (product_id, data, version) VALUES (?, ?, ?)').run(prod.id, datos, Date.now() + n);
      anotar.run(foto.f, prod.id, 'puesta');
      n++;
    }
    if (n) console.log(`[DB] Fotos del dueño: se pusieron ${n} foto(s) de productos.`);
  } catch (err) {
    console.warn('[DB] No se pudieron poner las fotos del dueño:', err.message);
  }
}

const CLAMATO_LITRO = 4.7, MARINERO_PREPARADO = 8.52;

function migrateLibreta2DelDueno() {
  const ver = db.prepare('PRAGMA user_version').get().user_version;
  if (ver !== 7) return;
  if (process.env.MANTENER_MENU_EJEMPLO === '1') return;
  db.exec('BEGIN TRANSACTION;');
  try {
    const clave = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const branches = db.prepare('SELECT id FROM branches').all();
    const costoDe = (id) => db.prepare('SELECT cost_per_unit FROM inventory_items WHERE id = ?').get(id)?.cost_per_unit || 0;
    const cambiados = new Set(), tocados = new Set();
    const aplicados = [], omitidos = [];
    const ponerCosto = (id, costo) => {
      if (Math.abs(costoDe(id) - costo) < 0.0001) return;
      db.prepare('UPDATE inventory_items SET cost_per_unit = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(costo, id);
      cambiados.add(id);
    };
    const itemPorNombre = (nombre) => db.prepare('SELECT id, name FROM inventory_items').all().find(i => clave(i.name) === clave(nombre))?.id || null;
    const crearInsumo = (nombre, categoria, unidad) => {
      const ya = itemPorNombre(nombre);
      if (ya) return ya;
      const id = Number(db.prepare(`
        INSERT INTO inventory_items (name, category, unit, current_stock, min_stock, cost_per_unit, supplier)
        VALUES (?, ?, ?, 0, 0, 0, '')
      `).run(nombre, categoria, unidad).lastInsertRowid);
      for (const b of branches) {
        db.prepare('INSERT OR IGNORE INTO inventory_stock (branch_id, inventory_item_id, current_stock, min_stock) VALUES (?, ?, 0, 0)').run(b.id, id);
      }
      return id;
    };
    const seccion = (patron) => db.prepare('SELECT id FROM categories WHERE name LIKE ? ORDER BY display_order, id LIMIT 1').get(patron)?.id
      || db.prepare('SELECT id FROM categories ORDER BY display_order, id LIMIT 1').get()?.id || 1;
    const buscar = (nombre) => db.prepare('SELECT id, name, price, is_direct_sale, direct_inventory_item_id FROM products WHERE archived = 0').all()
      .find(p => clave(p.name) === clave(nombre));
    const recetaDe = (pid) => db.prepare('SELECT inventory_item_id AS i, quantity AS q FROM recipe_items WHERE product_id = ? ORDER BY inventory_item_id').all(pid);
    const ponerReceta = (pid, partes) => {
      db.prepare('DELETE FROM recipe_items WHERE product_id = ?').run(pid);
      for (const [itemId, q] of partes) db.prepare('INSERT INTO recipe_items (product_id, inventory_item_id, quantity) VALUES (?, ?, ?)').run(pid, itemId, q);
    };
    const mismaReceta = (pid, partes) => {
      const a = recetaDe(pid), b = partes.map(([i, q]) => ({ i, q })).sort((x, y) => x.i - y.i);
      return a.length === b.length && a.every((r, k) => r.i === b[k].i && Math.abs(r.q - b[k].q) < 1e-9);
    };

    // 1) Productos de la libreta que ya están en el Menú
    for (const d of LIBRETA2) {
      const p = buscar(d.n);
      if (!p) { omitidos.push(`${d.n} (no está en el Menú)`); continue; }
      if (p.price > 0) { omitidos.push(`${d.n} (ya tenía su precio)`); continue; }
      let itemId = p.is_direct_sale ? p.direct_inventory_item_id : null;
      if (!itemId) {
        // sin insumo propio (alitas, azulitos): se vende tal cual con un insumo nuevo, solo si no tiene receta ni opciones
        const lleva = db.prepare('SELECT 1 FROM recipe_items WHERE product_id = ? LIMIT 1').get(p.id)
          || db.prepare('SELECT 1 FROM product_options WHERE product_id = ? LIMIT 1').get(p.id);
        if (d.insumo && !lleva) {
          itemId = crearInsumo(...d.insumo);
          db.prepare('UPDATE products SET is_direct_sale = 1, direct_inventory_item_id = ? WHERE id = ?').run(itemId, p.id);
        }
      }
      if (itemId) ponerCosto(itemId, d.costo);
      db.prepare('UPDATE products SET price = ?, is_active = 1 WHERE id = ?').run(d.precio, p.id);
      tocados.add(p.id); aplicados.push(d.n);
    }

    // 2) Productos que no estaban en el Menú
    const vb = buscar('VB');
    if (vb) omitidos.push('VB (ya existe)');
    else {
      const itemId = crearInsumo('VB', 'Cerveza Embotellada', 'pza'); ponerCosto(itemId, 3.08);
      const id = Number(db.prepare(`
        INSERT INTO products (category_id, name, description, price, cost, is_direct_sale, direct_inventory_item_id, badge, is_active)
        VALUES (?, 'VB', '', 5, 3.08, 1, ?, '', 1)
      `).run(seccion('%Cerveza%'), itemId).lastInsertRowid);
      tocados.add(id); aplicados.push('VB');
    }
    const sueltos = itemPorNombre('Cigarros This (sueltos)');
    const tres = 'Cigarros This (3 por Q5)';
    if (buscar(tres)) omitidos.push(`${tres} (ya existe)`);
    else if (!sueltos) omitidos.push(`${tres} (no hay cigarros This sueltos)`);
    else {
      const id = Number(db.prepare(`
        INSERT INTO products (category_id, name, description, price, cost, is_direct_sale, direct_inventory_item_id, badge, is_active)
        VALUES (?, ?, '3 cigarros This sueltos por Q5.', 5, 0, 0, NULL, '', 1)
      `).run(seccion('%Cigarro%'), tres).lastInsertRowid);
      ponerReceta(id, [[sueltos, 3]]);
      tocados.add(id); aplicados.push(tres);
    }

    // 3) Marinero (clamato) y su aderezo
    const clamato = db.prepare("SELECT id FROM inventory_items WHERE LOWER(name) LIKE '%clamato%' OR LOWER(name) LIKE '%jugo de tomate%' ORDER BY id LIMIT 1").get()?.id;
    const limon = db.prepare("SELECT id FROM inventory_items WHERE LOWER(name) LIKE '%limón%' OR LOWER(name) LIKE '%limon%' ORDER BY id LIMIT 1").get()?.id;
    const salsas = db.prepare("SELECT id FROM inventory_items WHERE LOWER(name) LIKE '%salsas negras%' ORDER BY id LIMIT 1").get()?.id;
    let aderezoListo = false;
    if (clamato && [0, 12.54, 42].includes(costoDe(clamato))) {
      ponerCosto(clamato, CLAMATO_LITRO); aplicados.push('costo del clamato Q4.70 el litro (Marinero)');
    } else omitidos.push('costo del clamato (ya lo había puesto el dueño)');
    if (limon && salsas && costoDe(limon) === 35 && costoDe(salsas) === 65) {
      const aderezoActual = 0.04 * 35 + 0.03 * 65;
      const f = (MARINERO_PREPARADO - CLAMATO_LITRO) / aderezoActual;
      ponerCosto(limon, Number((35 * f).toFixed(2)));
      ponerCosto(salsas, Number((65 * f).toFixed(2)));
      aderezoListo = true; aplicados.push('costo del limón y las salsas (para que el Marinero preparado cueste Q8.52)');
    } else omitidos.push('costo del limón y las salsas (ya los había puesto el dueño)');

    // 4) Michel Corona (Q30) y el aderezo de las micheladas
    if (clamato && limon && salsas) {
      const aderezo = [[limon, 0.04], [salsas, 0.03]];
      const mc = buscar('Miche corona');
      const corona = db.prepare("SELECT id FROM inventory_items WHERE LOWER(name) LIKE '%corona%' AND LOWER(name) NOT LIKE '%coronita%' AND LOWER(name) NOT LIKE '%lata%' ORDER BY id LIMIT 1").get()?.id;
      if (!mc) omitidos.push('Miche corona (no está en el Menú)');
      else if (mc.price > 0) omitidos.push('Miche corona (ya tenía su precio)');
      else if (!corona || !mismaReceta(mc.id, [[corona, 1]])) omitidos.push('Miche corona (el dueño cambió su receta)');
      else {
        ponerReceta(mc.id, [[clamato, 0.5], ...aderezo, [corona, 1]]);
        db.prepare('UPDATE products SET price = 30, is_active = 1 WHERE id = ?').run(mc.id);
        tocados.add(mc.id); aplicados.push('Miche corona');
      }
      const cervezas = { 'Miche gallo lata': "LOWER(name) LIKE '%gallo%' AND LOWER(name) LIKE '%lata%' AND LOWER(name) NOT LIKE '%light%'",
        'Miche light': "LOWER(name) LIKE '%gallo%' AND LOWER(name) LIKE '%light%' AND LOWER(name) NOT LIKE '%lata%'",
        'Miche gallo vidrio': "LOWER(name) LIKE '%gallo%' AND LOWER(name) NOT LIKE '%lata%' AND LOWER(name) NOT LIKE '%light%'" };
      for (const [nombre, cond] of Object.entries(cervezas)) {
        const p = buscar(nombre);
        const cerveza = db.prepare(`SELECT id FROM inventory_items WHERE ${cond} ORDER BY id LIMIT 1`).get()?.id;
        if (!p || !cerveza) { omitidos.push(`${nombre} (no está en el Menú)`); continue; }
        if (!mismaReceta(p.id, [[clamato, 0.5], [cerveza, 1]])) { omitidos.push(`${nombre} (el dueño cambió su receta)`); continue; }
        ponerReceta(p.id, [[clamato, 0.5], ...aderezo, [cerveza, 1]]);
        tocados.add(p.id); aplicados.push(`${nombre} (con aderezo)`);
      }
    }

    // 5) Costos de los productos que usan algún insumo cuyo costo cambió
    for (const id of cambiados) {
      for (const r of db.prepare('SELECT product_id FROM recipe_items WHERE inventory_item_id = ?').all(id)) tocados.add(r.product_id);
      for (const r of db.prepare('SELECT product_id FROM product_options WHERE inventory_item_id = ?').all(id)) tocados.add(r.product_id);
      for (const r of db.prepare('SELECT id FROM products WHERE direct_inventory_item_id = ?').all(id)) tocados.add(r.id);
    }
    for (const pid of tocados) {
      const p = db.prepare('SELECT is_direct_sale, direct_inventory_item_id FROM products WHERE id = ?').get(pid);
      if (!p) continue;
      let base = p.is_direct_sale && p.direct_inventory_item_id
        ? costoDe(p.direct_inventory_item_id)
        : db.prepare('SELECT quantity, inventory_item_id FROM recipe_items WHERE product_id = ?').all(pid).reduce((t, r) => t + r.quantity * costoDe(r.inventory_item_id), 0);
      const opts = db.prepare('SELECT quantity, inventory_item_id FROM product_options WHERE product_id = ?').all(pid);
      if (opts.length) base = (p.is_direct_sale ? 0 : base) + Math.max(0, ...opts.map(o => o.quantity * costoDe(o.inventory_item_id)));
      db.prepare('UPDATE products SET cost = ? WHERE id = ?').run(Number(base.toFixed(2)), pid);
    }

    db.exec('PRAGMA user_version = 8;');
    db.exec('COMMIT;');
    console.log(`[DB] Segunda hoja de la libreta: ${aplicados.length} cambios (${aplicados.join(', ')})` +
      (omitidos.length ? `; sin cambios: ${omitidos.join(', ')}` : '') + '.');
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Tercera lista del dueño (mensaje del 29 de octubre): precios de "bebidas por sí solas", azulitos con receta, Jagger, Jaggerbomb,
// alitas con papas, volteaditos, Vitafer por mililitros (por shot y por bote), cimarrona completa, y "borra del inventario todo
// lo demás que no te haya dicho". Una sola vez (user_version 8 -> 9).
//  - ANTES de tocar nada se guarda una copia completa de la base en la carpeta de datos (respaldo_antes_de_lista3_<fecha>.db).
//    Si no se pudo guardar la copia, NO se hace nada y se vuelve a intentar en el siguiente arranque.
//  - Los precios de la lista se ponen aunque ya hubiera otro (el dueño los dijo de nuevo, es lo más reciente).
//  - Se borran los insumos que NINGÚN producto del Menú usa (ni en receta, ni "tal cual", ni como opción). Los que el dueño ya había
//    dado (lista y libreta) siguen porque sus productos están en el Menú, aunque estén pausados en Q0. Lo que se borra y lo que tenía
//    de existencias queda anotado en inventario_borrado_lista3.txt, al lado del respaldo.
//  - Con MANTENER_MENU_EJEMPLO=1 no se hace nada (pruebas y demostraciones).
// ---------------------------------------------------------------------------------------------------------------------
const LISTA3_PRECIOS = [
  // [nombre en el Menú, precio]  (en la lista: Gallo lata, Corona, Ultra, Mineral/Gaseosas, Pacifico, Redbull solo, Marinero preparado, papas, octavo)
  ['Gallo lata 12 oz', 12], ['Corona bot 12 oz', 15], ['Michelob', 20], ['Pacifico', 15], ['Red Bull', 20],
  ['Marinero preparado', 20], ['Lays', 20], ['Octavo variedad', 14],
  ['Coca vidrio', 10], ['Coca lata', 10], ['Gaseosa lata', 10], ['Sprite', 10], ['Pepsitas', 10]
];

function migrateLista3DelDueno() {
  const ver = db.prepare('PRAGMA user_version').get().user_version;
  if (ver !== 8) return;
  if (process.env.MANTENER_MENU_EJEMPLO === '1') return;
  if (process.env.MIGRAR_HASTA && Number(process.env.MIGRAR_HASTA) < 9) return;   // solo para pruebas: detenerse en la versión 8

  // 1) Respaldo completo ANTES de cambiar nada (VACUUM INTO no se puede dentro de una transacción)
  const fecha = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const rutaRespaldo = rutaLibre(join(DATA_DIR, `respaldo_antes_de_lista3_${fecha}.db`));
  try {
    db.exec(`VACUUM INTO '${rutaRespaldo.replace(/'/g, "''")}'`);
    if (!existsSync(rutaRespaldo)) throw new Error('el archivo no apareció');
  } catch (err) {
    console.warn(`[DB] Lista nueva del dueño: NO se hizo, porque no se pudo guardar la copia de seguridad (${err.message}). Se intentará de nuevo al reiniciar.`);
    return;
  }

  db.exec('BEGIN TRANSACTION;');
  try {
    const clave = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const branches = db.prepare('SELECT id FROM branches').all();
    const hecho = [], aviso = [], tocados = new Set();
    const itemPorNombre = (nombre) => db.prepare('SELECT id, name FROM inventory_items').all().find(i => clave(i.name) === clave(nombre))?.id || null;
    const crearInsumo = (nombre, categoria, unidad, costo = 0, presentacion = null) => {
      const ya = itemPorNombre(nombre);
      if (ya) return ya;
      const id = Number(db.prepare(`
        INSERT INTO inventory_items (name, category, unit, current_stock, min_stock, cost_per_unit, supplier, pack_name, pack_size)
        VALUES (?, ?, ?, 0, 0, ?, '', ?, ?)
      `).run(nombre, categoria, unidad, costo, presentacion ? presentacion[0] : '', presentacion ? presentacion[1] : 0).lastInsertRowid);
      for (const b of branches) {
        db.prepare('INSERT OR IGNORE INTO inventory_stock (branch_id, inventory_item_id, current_stock, min_stock) VALUES (?, ?, 0, 0)').run(b.id, id);
      }
      return id;
    };
    const seccion = (patron) => db.prepare('SELECT id FROM categories WHERE name LIKE ? ORDER BY display_order, id LIMIT 1').get(patron)?.id
      || db.prepare('SELECT id FROM categories ORDER BY display_order, id LIMIT 1').get()?.id || 1;
    const buscar = (...nombres) => {
      const todos = db.prepare('SELECT id, name, price, is_direct_sale, direct_inventory_item_id FROM products WHERE archived = 0').all();
      for (const n of nombres) { const p = todos.find(x => clave(x.name) === clave(n)); if (p) return p; }
      return null;
    };
    const ponerReceta = (pid, partes) => {
      db.prepare('DELETE FROM recipe_items WHERE product_id = ?').run(pid);
      for (const [itemId, q] of partes) db.prepare('INSERT INTO recipe_items (product_id, inventory_item_id, quantity) VALUES (?, ?, ?)').run(pid, itemId, q);
      tocados.add(pid);
    };
    // Pasa un producto "tal cual" (o sin nada) a receta, con el nombre y precio nuevos
    const aReceta = (p, nombre, precio, partes) => {
      db.prepare('UPDATE products SET name = ?, price = ?, is_active = 1, is_direct_sale = 0, direct_inventory_item_id = NULL WHERE id = ?').run(nombre, precio, p.id);
      ponerReceta(p.id, partes);
    };
    const crearProducto = (nombre, descripcion, precio, patronSeccion, partes, activo = 1) => {
      const id = Number(db.prepare(`
        INSERT INTO products (category_id, name, description, price, cost, is_direct_sale, direct_inventory_item_id, badge, is_active)
        VALUES (?, ?, ?, ?, 0, 0, NULL, '', ?)
      `).run(seccion(patronSeccion), nombre, descripcion, precio, activo).lastInsertRowid);
      ponerReceta(id, partes);
      return id;
    };
    const costoDe = (id) => db.prepare('SELECT cost_per_unit FROM inventory_items WHERE id = ?').get(id)?.cost_per_unit || 0;

    // 2) Insumos que faltaban (en la medida con que se descuentan). Costos que no se conocen: en 0 hasta que el dueño los ponga.
    const esencia = crearInsumo('Esencia azul', 'Líquidos Insumo', 'oz');
    const vodka = crearInsumo('Licor del azulito', 'Licores Líquido', 'oz');
    const sal = crearInsumo('Sal', 'Escarchados', 'g');
    // Vitafer: 500 ml el bote = 50 shots de 10 ml. El costo del shot de la libreta (Q6) da Q0.60 por ml.
    const vitafer = crearInsumo('Vitafer (líquido)', 'Líquidos Insumo', 'ml', 0.6, ['bote', 500]);
    const insumo = (...nombres) => { for (const n of nombres) { const id = itemPorNombre(n); if (id) return id; } return null; };
    const sprite = insumo('Sprite'), power = insumo('Power'), redbull = insumo('Red Bull'), jagger = insumo('Jagger (onzas)');
    const alitasIns = insumo('Alitas Pío Lindo'), papasIns = insumo('Lays'), gaseosa = insumo('Gaseosa Lata'), octavo = insumo('Octavo (variedad)');
    const mineral = insumo('Agua Mineral'), limon = insumo('Jugo de Limón Natural 100%'), clamato = insumo('Clamato Original Jugo de Tomate');
    const salsas = insumo('Mezcla Salsas Negras de la Casa (Maggi/Inglesa)');
    const existe = (n, v) => { if (!v) aviso.push(`${n} (no existe el insumo)`); return !!v; };

    // 3) Precios de bebidas solas
    for (const [n, precio] of LISTA3_PRECIOS) {
      const p = buscar(n);
      if (!p) { aviso.push(`${n} (no está en el Menú)`); continue; }
      db.prepare('UPDATE products SET price = ?, is_active = 1 WHERE id = ?').run(precio, p.id);
      tocados.add(p.id); hecho.push(`${p.name} Q${precio}`);
    }
    // Agua mineral sola (Q10): vende el mismo insumo que usa la Cimarrona
    if (!buscar('Agua mineral') && existe('Agua mineral', mineral)) {
      const id = Number(db.prepare(`
        INSERT INTO products (category_id, name, description, price, cost, is_direct_sale, direct_inventory_item_id, badge, is_active)
        VALUES (?, 'Agua mineral', '', 10, 0, 1, ?, '', 1)
      `).run(seccion('%Refresco%'), mineral).lastInsertRowid);
      tocados.add(id); hecho.push('Agua mineral Q10');
    }

    // 4) Jagger sola y Jaggerbomb (1/3 de Red Bull)
    const JAGGER_OZ = 2;
    if (existe('Jagger', jagger)) {
      const pj = buscar('Jagger onza', 'Jagger sola');
      if (pj) { aReceta(pj, 'Jagger sola', 25, [[jagger, JAGGER_OZ]]); hecho.push(`Jagger sola Q25 (${JAGGER_OZ} oz)`); }
      else { crearProducto('Jagger sola', '', 25, '%Trago%', [[jagger, JAGGER_OZ]]); hecho.push('Jagger sola Q25 (nuevo)'); }
      if (existe('Jaggerbomb', redbull)) {
        const bomba = buscar('Jaggerbomb', 'Jagger bomb');
        if (bomba) { aReceta(bomba, bomba.name, 45, [[jagger, JAGGER_OZ], [redbull, 1 / 3]]); hecho.push('Jaggerbomb Q45'); }
        else { crearProducto('Jaggerbomb', 'Jagger con un tercio de Red Bull.', 45, '%Trago%', [[jagger, JAGGER_OZ], [redbull, 1 / 3]]); hecho.push('Jaggerbomb Q45 (nuevo)'); }
      }
    }

    // 5) Azulitos: esencia 2 oz + licor 1 1/2 oz + media Sprite (chaparrita) + la tercera parte de un Power azul
    if (existe('Sprite', sprite) && existe('Power', power)) {
      const base = [[esencia, 2], [sprite, 0.5], [power, 1 / 3]];
      const con = buscar('Azulito con licor', 'Azulito', 'Vodka Azulito');
      if (con) aReceta(con, 'Azulito con licor', 30, [[esencia, 2], [vodka, 1.5], [sprite, 0.5], [power, 1 / 3]]);
      else crearProducto('Azulito con licor', '', 30, '%Trago%', [[esencia, 2], [vodka, 1.5], [sprite, 0.5], [power, 1 / 3]]);
      const sin = buscar('Azulito sin licor', 'Azul sin licor');
      if (sin) aReceta(sin, 'Azulito sin licor', 25, base);
      else crearProducto('Azulito sin licor', '', 25, '%Refresco%', base);
      hecho.push('Azulito con licor Q30 y sin licor Q25 (con receta)');
    }

    // 6) Alitas (llevan papas), Volteaditos (soda en lata + octavo), Octavo
    if (existe('Alitas', alitasIns) && existe('Papas', papasIns)) {
      const pa = buscar('Alitas Pío Lindo', 'Alitas');
      if (pa) aReceta(pa, pa.name, 70, [[alitasIns, 1], [papasIns, 1]]);
      else crearProducto('Alitas Pío Lindo', '', 70, '%Botana%', [[alitasIns, 1], [papasIns, 1]]);
      hecho.push('Alitas Q70 (descuentan alitas y papas)');
    }
    if (existe('Gaseosa lata', gaseosa) && existe('Octavo', octavo)) {
      const pv = buscar('Volteaditos', 'Volteadito');
      if (pv) aReceta(pv, pv.name, 25, [[gaseosa, 1], [octavo, 1]]);
      else crearProducto('Volteaditos', 'Una soda en lata y un octavo.', 25, '%Trago%', [[gaseosa, 1], [octavo, 1]]);
      hecho.push('Volteaditos Q25 (una soda en lata y un octavo)');
    }

    // 7) Vitafer: por shot (10 ml) y por bote (500 ml), del MISMO insumo líquido
    {
      const shot = buscar('Vitafer', 'Vitafer 10 ml');
      if (shot) aReceta(shot, 'Vitafer 10 ml', 20, [[vitafer, 10]]);
      else crearProducto('Vitafer 10 ml', 'Un shot de 10 ml.', 20, '%Refresco%', [[vitafer, 10]]);
      if (!buscar('Bote de Vitafer', 'Vitafer bote')) crearProducto('Bote de Vitafer', 'Bote de 500 ml (50 shots).', 0, '%Refresco%', [[vitafer, 500]], 0);
      hecho.push('Vitafer: shot de 10 ml Q20 y Bote de 500 ml (sin precio todavía)');
    }

    // 8) Cimarrona: limón, sal y mineral
    {
      const pc = buscar('Cimarrona');
      if (pc && existe('Agua mineral', mineral) && existe('Limón', limon)) {
        ponerReceta(pc.id, [[mineral, 1], [limon, 0.03], [sal, 3]]);
        db.prepare('UPDATE products SET is_direct_sale = 0, direct_inventory_item_id = NULL WHERE id = ?').run(pc.id);
        hecho.push('Cimarrona (mineral, limón y sal)');
      } else if (!pc) aviso.push('Cimarrona (no está en el Menú)');
    }

    // 9) Micheladas con Pacífico y Monte Carlo (ya tenían foto): igual que las demás (medio marinero + aderezo + una cerveza), sin precio todavía
    if (clamato && limon && salsas) {
      for (const [nombre, cerveza] of [['Miche pacifico', insumo('Pacífico', 'Pacifico')], ['Miche Montecarlo', insumo('Monte Carlo 355ml Botella')]]) {
        if (buscar(nombre, nombre === 'Miche Montecarlo' ? 'Miche Monte Carlo' : nombre)) continue;
        if (!cerveza) { aviso.push(`${nombre} (no existe la cerveza)`); continue; }
        crearProducto(nombre, '', 0, '%Michelada%', [[clamato, 0.5], [limon, 0.04], [salsas, 0.03], [cerveza, 1]], 0);
        hecho.push(`${nombre} (sin precio todavía)`);
      }
    }

    // 10) Costos de los productos tocados (receta, tal cual u opciones). Los azulitos conservan el costo de la libreta
    //     (Q11.11 y Q9.20) hasta que el dueño ponga el de la esencia, el Power, el Sprite y el vodka.
    for (const pid of tocados) {
      const p = db.prepare('SELECT is_direct_sale, direct_inventory_item_id FROM products WHERE id = ?').get(pid);
      if (!p) continue;
      let base = p.is_direct_sale && p.direct_inventory_item_id
        ? costoDe(p.direct_inventory_item_id)
        : db.prepare('SELECT quantity, inventory_item_id FROM recipe_items WHERE product_id = ?').all(pid).reduce((t, r) => t + r.quantity * costoDe(r.inventory_item_id), 0);
      const opts = db.prepare('SELECT quantity, inventory_item_id FROM product_options WHERE product_id = ?').all(pid);
      if (opts.length) base = (p.is_direct_sale ? 0 : base) + Math.max(0, ...opts.map(o => o.quantity * costoDe(o.inventory_item_id)));
      db.prepare('UPDATE products SET cost = ? WHERE id = ?').run(Number(base.toFixed(2)), pid);
    }
    const conLicor = buscar('Azulito con licor'), sinLicor = buscar('Azulito sin licor');
    if (conLicor) db.prepare('UPDATE products SET cost = 11.11 WHERE id = ?').run(conLicor.id);
    if (sinLicor) db.prepare('UPDATE products SET cost = 9.2 WHERE id = ?').run(sinLicor.id);

    // 11) La foto del Jaggerbomb estaba puesta en "Jagger onza": se pasa al producto Jaggerbomb
    try {
      const carpeta = join(dirname(fileURLToPath(import.meta.url)), 'fotos_dueno');
      const ruta = join(carpeta, 'jaggerbomb.jpg');
      const bomba = buscar('Jaggerbomb', 'Jagger bomb'), sola = buscar('Jagger sola');
      if (existsSync(ruta) && bomba && sola && bomba.id !== sola.id) {
        const archivo = readFileSync(ruta);
        const foto = db.prepare('SELECT data FROM product_images WHERE product_id = ?').get(sola.id);
        const yaTiene = db.prepare('SELECT 1 FROM product_images WHERE product_id = ?').get(bomba.id);
        if (foto && !yaTiene && Buffer.compare(Buffer.from(foto.data), archivo) === 0) {
          db.prepare('UPDATE product_images SET product_id = ?, version = ? WHERE product_id = ?').run(bomba.id, Date.now(), sola.id);
          try { db.prepare("UPDATE fotos_dueno_aplicadas SET product_id = ? WHERE archivo = 'jaggerbomb.jpg'").run(bomba.id); } catch (e) { /* la tabla aún no existe */ }
          hecho.push('la foto del Jaggerbomb pasó a su producto');
        }
      }
    } catch (e) { aviso.push('foto del Jaggerbomb: ' + e.message); }

    // 12) Borrar del inventario todo insumo que no use ningún producto del Menú
    const borrados = [];
    for (const it of db.prepare('SELECT id, name, unit FROM inventory_items ORDER BY id').all()) {
      const lo = db.prepare(`
        SELECT (SELECT COUNT(*) FROM recipe_items r JOIN products p ON p.id = r.product_id WHERE r.inventory_item_id = ? AND p.archived = 0)
             + (SELECT COUNT(*) FROM products WHERE direct_inventory_item_id = ? AND archived = 0)
             + (SELECT COUNT(*) FROM product_options o JOIN products p ON p.id = o.product_id WHERE o.inventory_item_id = ? AND p.archived = 0) AS n
      `).get(it.id, it.id, it.id).n;
      if (lo > 0) continue;
      const exist = db.prepare(`
        SELECT b.name AS sucursal, s.current_stock AS q FROM inventory_stock s JOIN branches b ON b.id = s.branch_id
        WHERE s.inventory_item_id = ? AND s.current_stock <> 0 ORDER BY b.id
      `).all(it.id);
      borrados.push(`${it.name} (${it.unit})` + (exist.length ? ' — tenía: ' + exist.map(e => `${Number(e.q.toFixed(2))} en ${e.sucursal}`).join(', ') : ''));
      db.prepare('DELETE FROM recipe_items WHERE inventory_item_id = ? AND product_id IN (SELECT id FROM products WHERE archived = 1)').run(it.id);
      db.prepare('DELETE FROM product_options WHERE inventory_item_id = ? AND product_id IN (SELECT id FROM products WHERE archived = 1)').run(it.id);
      db.prepare('UPDATE products SET direct_inventory_item_id = NULL, is_direct_sale = 0 WHERE direct_inventory_item_id = ? AND archived = 1').run(it.id);
      db.prepare('DELETE FROM inventory_movements WHERE inventory_item_id = ?').run(it.id);
      db.prepare('DELETE FROM inventory_stock WHERE inventory_item_id = ?').run(it.id);
      db.prepare('DELETE FROM inventory_items WHERE id = ?').run(it.id);
    }

    db.exec('PRAGMA user_version = 9;');
    db.exec('COMMIT;');
    try {
      writeFileSync(join(DATA_DIR, 'inventario_borrado_lista3.txt'),
        `Insumos que se borraron del inventario el ${new Date().toISOString().slice(0, 10)} (nadie los usaba en el Menú).\n` +
        `La base completa de antes está en: ${rutaRespaldo}\n\n` + (borrados.length ? borrados.join('\n') : '(ninguno)') + '\n');
    } catch (e) { /* solo es una nota */ }
    console.log(`[DB] Lista nueva del dueño: ${hecho.length} cambios (${hecho.join('; ')})` +
      (aviso.length ? `; sin cambios: ${aviso.join('; ')}` : '') +
      `. Insumos borrados (${borrados.length}): ${borrados.map(b => b.split(' — ')[0]).join(', ') || 'ninguno'}. Copia de seguridad: ${rutaRespaldo}`);
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Borra los insumos que NINGÚN producto del Menú usa (ni en receta, ni "tal cual", ni como opción). Devuelve una línea de texto por insumo
// con lo que tenía de existencias. Debe llamarse dentro de una transacción.
// ---------------------------------------------------------------------------------------------------------------------
function borrarInsumosSinUso() {
  const borrados = [];
  for (const it of db.prepare('SELECT id, name, unit FROM inventory_items ORDER BY id').all()) {
    const lo = db.prepare(`
      SELECT (SELECT COUNT(*) FROM recipe_items r JOIN products p ON p.id = r.product_id WHERE r.inventory_item_id = ? AND p.archived = 0)
           + (SELECT COUNT(*) FROM products WHERE direct_inventory_item_id = ? AND archived = 0)
           + (SELECT COUNT(*) FROM product_options o JOIN products p ON p.id = o.product_id WHERE o.inventory_item_id = ? AND p.archived = 0) AS n
    `).get(it.id, it.id, it.id).n;
    if (lo > 0) continue;
    const exist = db.prepare(`
      SELECT b.name AS sucursal, s.current_stock AS q FROM inventory_stock s JOIN branches b ON b.id = s.branch_id
      WHERE s.inventory_item_id = ? AND s.current_stock <> 0 ORDER BY b.id
    `).all(it.id);
    borrados.push(`${it.name} (${it.unit})` + (exist.length ? ' — tenía: ' + exist.map(e => `${Number(e.q.toFixed(2))} en ${e.sucursal}`).join(', ') : ''));
    db.prepare('DELETE FROM recipe_items WHERE inventory_item_id = ? AND product_id IN (SELECT id FROM products WHERE archived = 1)').run(it.id);
    db.prepare('DELETE FROM product_options WHERE inventory_item_id = ? AND product_id IN (SELECT id FROM products WHERE archived = 1)').run(it.id);
    db.prepare('UPDATE products SET direct_inventory_item_id = NULL, is_direct_sale = 0 WHERE direct_inventory_item_id = ? AND archived = 1').run(it.id);
    db.prepare('DELETE FROM inventory_movements WHERE inventory_item_id = ?').run(it.id);
    db.prepare('DELETE FROM inventory_stock WHERE inventory_item_id = ?').run(it.id);
    db.prepare('DELETE FROM inventory_items WHERE id = ?').run(it.id);
  }
  return borrados;
}

// ---------------------------------------------------------------------------------------------------------------------
// "Borra todo y deja solo lo que te mandé" (29 de octubre, por la tarde): el Menú queda con la lista del dueño y nada más.
// Una sola vez (user_version 9 -> 10).
//  - Antes se guarda una copia completa de la base (respaldo_antes_de_menu_solo_lista_<fecha>.db). Si no se pudo, no se hace nada.
//  - Un producto que NO está en la lista se borra del todo; si ya tiene ventas o está en una cuenta de mesa, se OCULTA (las ventas se conservan).
//  - Se borran las secciones que quedan vacías y los insumos que ya ningún producto usa.
//  - Las fotos de los productos quitados se anotan como "no puestas" para que, si algún día se vuelven a crear, la foto vuelva sola.
//  - Con MANTENER_MENU_EJEMPLO=1 no se hace nada (pruebas y demostraciones).
// ---------------------------------------------------------------------------------------------------------------------
const MENU_SOLO_LISTA = [
  // Cervezas y bebidas por sí solas
  'Gallo lata 12 oz', 'Gallo bot 12 oz', 'Corona bot 12 oz', 'Michelob', 'Pacifico',
  'Agua mineral', 'Coca vidrio', 'Coca lata', 'Gaseosa lata', 'Sprite', 'Pepsitas', 'Red Bull',
  'Jagger sola', 'Jaggerbomb', 'Octavo variedad', 'Volteaditos',
  'Vitafer 10 ml', 'Bote de Vitafer',
  'Lays', 'Alitas Pío Lindo',
  // Micheladas con la cerveza que el cliente quiera (cada una con su precio) y preparados
  'Miche gallo lata', 'Miche gallo vidrio', 'Miche light', 'Miche corona', 'Miche coronita', 'Miche pacifico', 'Miche Montecarlo', 'Miche Monte Carlo',
  'Marinero preparado', 'Azulito con licor', 'Azulito sin licor', 'Cimarrona'
];

const MENU_LISTA_MINIMO = 15;   // un menú sin limpiar trae unos 30 de la lista; el del dueño ya armado, 2

function migrateMenuSoloLaLista() {
  const ver = db.prepare('PRAGMA user_version').get().user_version;
  if (ver !== 9) return;
  if (process.env.MANTENER_MENU_EJEMPLO === '1') return;
  if (process.env.MIGRAR_HASTA && Number(process.env.MIGRAR_HASTA) < 10) return;   // solo para pruebas: detenerse antes

  // Si el dueño YA armó su propio menú (borró lo de ejemplo y creó lo suyo), esto no se aplica: no se borra ni se cambia nada, solo se
  // marca como hecho. Se nota porque ya no quedan ni la mitad de los productos de la lista (un menú sin limpiar trae casi todos).
  {
    const claveL = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const enLista = new Set(MENU_SOLO_LISTA.map(claveL));
    const activos = db.prepare('SELECT name FROM products WHERE archived = 0').all();
    const coinciden = activos.filter(p => enLista.has(claveL(p.name))).length;
    if (coinciden < MENU_LISTA_MINIMO) {
      db.exec('PRAGMA user_version = 10;');
      console.log(`[DB] Menú solo con la lista del dueño: no se aplicó porque el menú ya es el que armó el dueño (${activos.length} productos, solo ${coinciden} de la lista). No se borró nada.`);
      return;
    }
  }

  const fecha = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const rutaRespaldo = rutaLibre(join(DATA_DIR, `respaldo_antes_de_menu_solo_lista_${fecha}.db`));
  try {
    db.exec(`VACUUM INTO '${rutaRespaldo.replace(/'/g, "''")}'`);
    if (!existsSync(rutaRespaldo)) throw new Error('el archivo no apareció');
  } catch (err) {
    console.warn(`[DB] Menú solo con la lista del dueño: NO se hizo, porque no se pudo guardar la copia de seguridad (${err.message}). Se intentará de nuevo al reiniciar.`);
    return;
  }

  db.exec('BEGIN TRANSACTION;');
  try {
    const clave = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const dejar = new Set(MENU_SOLO_LISTA.map(clave));
    const quitados = [], ocultos = [], secciones = [];
    const productos = db.prepare(`
      SELECT p.id, p.name, c.name AS seccion FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE p.archived = 0 ORDER BY p.id
    `).all();
    for (const p of productos) {
      if (dejar.has(clave(p.name))) continue;
      const yaVendido = db.prepare('SELECT 1 FROM sale_items WHERE product_id = ? LIMIT 1').get(p.id)
        || db.prepare('SELECT 1 FROM table_order_items WHERE product_id = ? LIMIT 1').get(p.id);
      db.prepare('DELETE FROM product_images WHERE product_id = ?').run(p.id);
      try { db.prepare('DELETE FROM fotos_dueno_aplicadas WHERE product_id = ?').run(p.id); } catch (e) { /* la tabla aún no existe */ }
      if (yaVendido) {
        db.prepare('UPDATE products SET is_active = 0, archived = 1 WHERE id = ?').run(p.id);
        ocultos.push(`${p.name} (${p.seccion || 'sin sección'})`);
      } else {
        db.prepare('DELETE FROM recipe_items WHERE product_id = ?').run(p.id);
        db.prepare('DELETE FROM product_options WHERE product_id = ?').run(p.id);
        db.prepare('DELETE FROM branch_paused_products WHERE product_id = ?').run(p.id);
        db.prepare('DELETE FROM products WHERE id = ?').run(p.id);
        quitados.push(`${p.name} (${p.seccion || 'sin sección'})`);
      }
    }
    for (const c of db.prepare('SELECT id, name FROM categories ORDER BY id').all()) {
      const n = db.prepare('SELECT COUNT(*) AS n FROM products WHERE category_id = ? AND archived = 0').get(c.id).n;
      if (n > 0) continue;
      db.prepare('UPDATE products SET category_id = NULL WHERE category_id = ? AND archived = 1').run(c.id);
      db.prepare('DELETE FROM categories WHERE id = ?').run(c.id);
      secciones.push(c.name);
    }
    const insumos = borrarInsumosSinUso();

    db.exec('PRAGMA user_version = 10;');
    db.exec('COMMIT;');
    try {
      writeFileSync(join(DATA_DIR, 'menu_borrado_solo_lista.txt'),
        `Lo que se quitó del Menú y del inventario el ${new Date().toISOString().slice(0, 10)} para dejar solo la lista del dueño.\n` +
        `La base completa de antes está en: ${rutaRespaldo}\n\n` +
        `PRODUCTOS BORRADOS (${quitados.length}):\n${quitados.join('\n') || '(ninguno)'}\n\n` +
        `PRODUCTOS OCULTOS PORQUE YA TENÍAN VENTAS (${ocultos.length}; las ventas se conservan):\n${ocultos.join('\n') || '(ninguno)'}\n\n` +
        `SECCIONES QUITADAS (${secciones.length}):\n${secciones.join('\n') || '(ninguna)'}\n\n` +
        `INSUMOS BORRADOS DEL INVENTARIO (${insumos.length}):\n${insumos.join('\n') || '(ninguno)'}\n`);
    } catch (e) { /* solo es una nota */ }
    console.log(`[DB] Menú solo con la lista del dueño: ${quitados.length} productos borrados y ${ocultos.length} ocultos (tenían ventas); secciones quitadas: ${secciones.join(', ') || 'ninguna'}; ` +
      `${insumos.length} insumos borrados. Copia de seguridad: ${rutaRespaldo}`);
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }
}

// Una sola vez (user_version 10 -> 11). El dueño pidió pasar a ML las medidas de sus tragos y micheladas.
// Cuántos ml trae cada pieza (los dio el dueño o salen de sus propias recetas: shot de Vitafer = 0.02 de 500 ml = 10 ml,
// shot de El Santo = 0.0133 de 750 ml = 10 ml, Jagger 0.07 de 700 ml = 49 ml). Las alitas y las papas se quedan en piezas.
//  - Solo se aplica si la base es la del dueño (encuentra al menos 8 de estos 11 insumos por su nombre).
//  - Solo convierte los que siguen en piezas (si el dueño ya pasó alguno a ml con el botón, no se toca).
//  - Guarda una copia completa antes (respaldo_antes_de_pasar_a_ml_<fecha>.db); si no se puede, no se hace y se reintenta al reiniciar.
//  - Todo en una sola transacción: las existencias de TODAS las sucursales, el mínimo, el costo, la botella o paquete, las recetas y el
//    historial se convierten juntos y el costo de cada bebida y el valor del inventario tienen que quedar iguales; si algo no cuadra, se
//    deshace todo y el sistema arranca igual que antes (no se cae) y lo reintenta al reiniciar.
//  - Con MANTENER_MENU_EJEMPLO=1 o MIGRAR_HASTA menor a 11 no se hace nada (pruebas y demostraciones).
const ML_POR_PIEZA_DUENO = {
  'Marinero': 250, 'Gallo 350ML vidrio': 350, 'Gallo 350ML Lata': 350, 'Vitafer': 500, 'Mineral': 355, 'JaggerMeiter': 700,
  'RedBull': 250, 'Smirnoff': 355, 'Tequila El Santo': 750, 'Pacifico Sola': 355, 'Monte Carlo': 355
};
const ML_MINIMO_COINCIDENCIAS = 8;

function migrateMedidasEnMl() {
  const ver = db.prepare('PRAGMA user_version').get().user_version;
  if (ver !== 10) return;
  if (process.env.MANTENER_MENU_EJEMPLO === '1') return;
  if (process.env.MIGRAR_HASTA && Number(process.env.MIGRAR_HASTA) < 11) return;   // solo para pruebas: detenerse antes

  const items = db.prepare('SELECT * FROM inventory_items').all();
  const porNombre = new Map(items.map(i => [i.name, i]));
  const encontrados = Object.keys(ML_POR_PIEZA_DUENO).filter(n => porNombre.has(n));
  if (encontrados.length < ML_MINIMO_COINCIDENCIAS) {
    db.exec('PRAGMA user_version = 11;');
    console.log(`[DB] Medidas en ml: no se aplicó porque el inventario no es el del dueño (${encontrados.length} de ${Object.keys(ML_POR_PIEZA_DUENO).length} insumos). No se cambió nada.`);
    return;
  }
  const porConvertir = encontrados.map(n => porNombre.get(n)).filter(i => i.unit === 'pza');
  if (porConvertir.length === 0) {
    db.exec('PRAGMA user_version = 11;');
    console.log('[DB] Medidas en ml: ya estaban en ml. No se cambió nada.');
    return;
  }

  const fecha = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const rutaRespaldo = rutaLibre(join(DATA_DIR, `respaldo_antes_de_pasar_a_ml_${fecha}.db`));
  try {
    db.exec(`VACUUM INTO '${rutaRespaldo.replace(/'/g, "''")}'`);
    if (!existsSync(rutaRespaldo)) throw new Error('el archivo no apareció');
  } catch (err) {
    console.warn(`[DB] Medidas en ml: NO se hizo, porque no se pudo guardar la copia de seguridad (${err.message}). Se intentará de nuevo al reiniciar.`);
    return;
  }

  const resumen = [];
  db.exec('BEGIN TRANSACTION;');
  try {
    for (const item of porConvertir) {
      const ml = ML_POR_PIEZA_DUENO[item.name];
      const stock = db.prepare('SELECT COALESCE(SUM(current_stock), 0) AS s FROM inventory_stock WHERE inventory_item_id = ?').get(item.id).s;
      aplicarConversion(db, item, ml, { presentacion: 'botella', redondear: true });
      resumen.push(`${item.name}: ${ml} ml por pieza · había ${Math.round(stock * 1e4) / 1e4} pza, ahora ${Math.round(stock * ml * 1e4) / 1e4} ml · costo Q ${item.cost_per_unit} por pieza, ahora Q ${Math.round(item.cost_per_unit / ml * 1e8) / 1e8} por ml`);
    }
    db.exec('PRAGMA user_version = 11;');
    db.exec('COMMIT;');
  } catch (err) {
    try { db.exec('ROLLBACK;'); } catch { /* ya estaba cerrada */ }
    console.error(`[DB] Medidas en ml: NO se aplicó y se dejó todo como estaba (${err.message}). Copia de seguridad: ${rutaRespaldo}. Se intentará de nuevo al reiniciar.`);
    return;   // no se cae el sistema por esto: sigue funcionando en piezas
  }
  try {
    writeFileSync(join(DATA_DIR, 'medidas_en_ml.txt'),
      `Insumos que se pasaron a ml el ${new Date().toISOString().slice(0, 10)} (el costo de cada bebida quedó igual).\n` +
      `La base completa de antes está en: ${rutaRespaldo}\n\n${resumen.join('\n')}\n\n` +
      `Si algún tamaño no es el de tu producto, dímelo (o corrígelo en Inventario → Cambiar y en el Menú → la receta).\n`);
  } catch (e) { /* solo es una nota */ }
  console.log(`[DB] Medidas en ml: ${porConvertir.length} insumos pasados a ml (${porConvertir.map(i => i.name).join(', ')}). Copia de seguridad: ${rutaRespaldo}`);
}

// Una sola vez (user_version 11 -> 12). El dueño quiere ver BOTELLAS en el inventario, no paquetes.
// Hasta la versión 11 sus insumos en ml guardaban el "paquete" completo (24 botellas de 350 ml = 8,400 ml), así que la tabla decía
// "≈ 1 paquete". Aquí la presentación de cada uno pasa a ser UNA botella (350 ml): el inventario dice "≈ 24 botellas" y Llegó mercadería
// cuenta en botellas.
//  - Solo cambia el nombre y el tamaño de la presentación (pack_name y pack_size). Existencias, costos, recetas, ventas e historial NO se
//    tocan (se comprueba antes de confirmar).
//  - Solo si la base es la del dueño (mismos 11 insumos por nombre, al menos 8) y solo los insumos cuya presentación sea un "paquete" que
//    traiga exactamente varias botellas de su tamaño. Si el dueño ya puso otra presentación, no se toca.
//  - Guarda una copia completa antes (respaldo_antes_de_botellas_<fecha>.db). Si algo falla, se deshace y el sistema arranca igual.
//  - Con MANTENER_MENU_EJEMPLO=1 o MIGRAR_HASTA menor a 12 no se hace nada (pruebas y demostraciones).
function migrateBotellasEnInventario() {
  const ver = db.prepare('PRAGMA user_version').get().user_version;
  if (ver !== 11) return;
  if (process.env.MANTENER_MENU_EJEMPLO === '1') return;
  if (process.env.MIGRAR_HASTA && Number(process.env.MIGRAR_HASTA) < 12) return;   // solo para pruebas: detenerse antes

  const items = db.prepare('SELECT * FROM inventory_items').all();
  const porNombre = new Map(items.map(i => [i.name, i]));
  const encontrados = Object.keys(ML_POR_PIEZA_DUENO).filter(n => porNombre.has(n));
  if (encontrados.length < ML_MINIMO_COINCIDENCIAS) {
    db.exec('PRAGMA user_version = 12;');
    console.log('[DB] Botellas en el inventario: no se aplicó porque el inventario no es el del dueño. No se cambió nada.');
    return;
  }
  const cambios = [];
  for (const nombre of encontrados) {
    const it = porNombre.get(nombre);
    const ml = ML_POR_PIEZA_DUENO[nombre];
    if (it.unit !== 'ml' || String(it.pack_name || '').trim().toLowerCase() !== 'paquete') continue;
    const veces = it.pack_size / ml;
    if (!(veces > 1.5) || Math.abs(veces - Math.round(veces)) > 1e-6) continue;   // no es un paquete de varias botellas de este tamaño
    cambios.push({ id: it.id, nombre, ml, nombrePresentacion: /lata/i.test(nombre) ? 'lata' : 'botella', antes: it.pack_size });
  }
  if (cambios.length === 0) {
    db.exec('PRAGMA user_version = 12;');
    console.log('[DB] Botellas en el inventario: no había paquetes que cambiar. No se cambió nada.');
    return;
  }

  const fecha = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const rutaRespaldo = rutaLibre(join(DATA_DIR, `respaldo_antes_de_botellas_${fecha}.db`));
  try {
    db.exec(`VACUUM INTO '${rutaRespaldo.replace(/'/g, "''")}'`);
    if (!existsSync(rutaRespaldo)) throw new Error('el archivo no apareció');
  } catch (err) {
    console.warn(`[DB] Botellas en el inventario: NO se hizo, porque no se pudo guardar la copia de seguridad (${err.message}). Se intentará de nuevo al reiniciar.`);
    return;
  }

  // Lo que NO debe cambiar: existencias, costos, mínimos, recetas, opciones y movimientos
  const foto = () => JSON.stringify([
    db.prepare('SELECT id, unit, current_stock, min_stock, cost_per_unit FROM inventory_items ORDER BY id').all(),
    db.prepare('SELECT * FROM inventory_stock ORDER BY inventory_item_id, branch_id').all(),
    db.prepare('SELECT id, product_id, inventory_item_id, quantity FROM recipe_items ORDER BY id').all(),
    db.prepare('SELECT id, product_id, inventory_item_id, quantity FROM product_options ORDER BY id').all(),
    db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(quantity), 0) AS q FROM inventory_movements').get(),
  ]);
  db.exec('BEGIN TRANSACTION;');
  try {
    const antes = foto();
    const upd = db.prepare('UPDATE inventory_items SET pack_name = ?, pack_size = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
    for (const c of cambios) upd.run(c.nombrePresentacion, c.ml, c.id);
    if (foto() !== antes) throw new Error('las existencias, costos o recetas cambiaron y no debían');
    db.exec('PRAGMA user_version = 12;');
    db.exec('COMMIT;');
  } catch (err) {
    try { db.exec('ROLLBACK;'); } catch { /* ya estaba cerrada */ }
    console.error(`[DB] Botellas en el inventario: NO se aplicó y se dejó todo como estaba (${err.message}). Copia de seguridad: ${rutaRespaldo}. Se intentará de nuevo al reiniciar.`);
    return;
  }
  try {
    const ruta = join(DATA_DIR, 'medidas_en_ml.txt');
    const linea = `\n\nBotellas en vez de paquetes (${new Date().toISOString().slice(0, 10)}): ` +
      cambios.map(c => `${c.nombre}: 1 ${c.nombrePresentacion} = ${c.ml} ml (antes 1 paquete = ${c.antes} ml)`).join(' · ') +
      `\nSolo cambió cómo se cuenta; las existencias y los costos son los mismos. Copia de antes: ${rutaRespaldo}\n`;
    writeFileSync(ruta, (existsSync(ruta) ? readFileSync(ruta, 'utf8') : '') + linea);
  } catch (e) { /* solo es una nota */ }
  console.log(`[DB] Botellas en el inventario: ${cambios.length} insumos ahora se cuentan por botella (${cambios.map(c => c.nombre).join(', ')}). Copia de seguridad: ${rutaRespaldo}`);
}

// Una sola vez (user_version 12 -> 13). El dueño pidió de vuelta los azulitos, ahora con la receta en ml y con vodka (Absolut):
//   Azulito con licor Q30 = 2 oz de esencia azul (59 ml) + 1½ oz de vodka (44 ml) + ½ Sprite chaparrita + ⅓ de Power
//   Azulito sin licor Q25 = lo mismo sin el vodka
// Tamaños (los que no son seguros el dueño los cambia en Inventario → Cambiar y en Menú → receta):
//   esencia 250 ml (dato del dueño), vodka Absolut 750 ml (tamaño de la botella), Sprite chaparrita 237 ml (supuesto) y Power 500 ml (supuesto).
//  - Solo AGREGA (4 insumos con existencias en 0 en todas las sucursales y 2 productos); no cambia ni borra nada de lo que ya hay.
//  - Solo si la base es la del dueño (mismos insumos por nombre, al menos 8). Si ya existe un producto "Azulito con licor" / "sin licor",
//    o un insumo con ese nombre en otra medida, no se toca nada (si el insumo ya está en ml, se usa el que hay).
//  - Guarda una copia completa antes (respaldo_antes_de_azulitos_<fecha>.db) y todo va en una sola transacción.
//  - Con MANTENER_MENU_EJEMPLO=1 o MIGRAR_HASTA menor a 13 no se hace nada (pruebas y demostraciones).
const AZULITO_COSTO_LIBRETA = { 'Azulito con licor': 11.11, 'Azulito sin licor': 9.2 };   // se conserva hasta que el dueño ponga los costos de cada insumo
function migrateAzulitosEnMl() {
  const ver = db.prepare('PRAGMA user_version').get().user_version;
  if (ver !== 12) return;
  if (process.env.MANTENER_MENU_EJEMPLO === '1') return;
  if (process.env.MIGRAR_HASTA && Number(process.env.MIGRAR_HASTA) < 13) return;   // solo para pruebas: detenerse antes

  const items = db.prepare('SELECT * FROM inventory_items').all();
  const porNombre = new Map(items.map(i => [i.name, i]));
  const encontrados = Object.keys(ML_POR_PIEZA_DUENO).filter(n => porNombre.has(n));
  if (encontrados.length < ML_MINIMO_COINCIDENCIAS) {
    db.exec('PRAGMA user_version = 13;');
    console.log('[DB] Azulitos: no se agregaron porque el inventario no es el del dueño.');
    return;
  }
  const insumosNuevos = [
    { n: 'Esencia azul', cat: 'Líquidos Insumo', ml: 250 },
    { n: 'Vodka Absolut', cat: 'Licores Líquido', ml: 750 },
    { n: 'Sprite', cat: 'Refrescos', ml: 237 },
    { n: 'Power', cat: 'Refrescos', ml: 500 },
  ];
  const productos = db.prepare("SELECT name FROM products WHERE archived = 0").all().map(p => p.name.trim().toLowerCase());
  const yaHay = ['azulito con licor', 'azulito sin licor'].filter(n => productos.includes(n));
  const enOtraMedida = insumosNuevos.filter(x => porNombre.has(x.n) && porNombre.get(x.n).unit !== 'ml').map(x => x.n);
  if (yaHay.length || enOtraMedida.length) {
    db.exec('PRAGMA user_version = 13;');
    console.log(`[DB] Azulitos: no se agregaron (${yaHay.length ? 'ya existe: ' + yaHay.join(', ') : 'el insumo ' + enOtraMedida.join(', ') + ' ya existe en otra medida'}). No se cambió nada.`);
    return;
  }

  const fecha = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const rutaRespaldo = rutaLibre(join(DATA_DIR, `respaldo_antes_de_azulitos_${fecha}.db`));
  try {
    db.exec(`VACUUM INTO '${rutaRespaldo.replace(/'/g, "''")}'`);
    if (!existsSync(rutaRespaldo)) throw new Error('el archivo no apareció');
  } catch (err) {
    console.warn(`[DB] Azulitos: NO se hizo, porque no se pudo guardar la copia de seguridad (${err.message}). Se intentará de nuevo al reiniciar.`);
    return;
  }

  const fotoDeLoDemas = () => JSON.stringify([
    db.prepare('SELECT * FROM inventory_items ORDER BY id').all(),
    db.prepare('SELECT * FROM inventory_stock ORDER BY inventory_item_id, branch_id').all(),
    db.prepare('SELECT * FROM products ORDER BY id').all(),
    db.prepare('SELECT * FROM recipe_items ORDER BY id').all(),
    db.prepare('SELECT * FROM product_options ORDER BY id').all(),
  ]);
  db.exec('BEGIN TRANSACTION;');
  try {
    const antes = fotoDeLoDemas();
    const sucursales = db.prepare('SELECT id FROM branches').all();
    const id = {};
    for (const x of insumosNuevos) {
      const hay = porNombre.get(x.n);
      if (hay) { id[x.n] = hay.id; continue; }   // ya estaba en ml: se usa tal cual
      id[x.n] = Number(db.prepare(`
        INSERT INTO inventory_items (name, category, unit, current_stock, min_stock, cost_per_unit, supplier, pack_name, pack_size)
        VALUES (?, ?, 'ml', 0, 0, 0, '', 'botella', ?)
      `).run(x.n, x.cat, x.ml).lastInsertRowid);
      for (const b of sucursales) {
        db.prepare('INSERT OR IGNORE INTO inventory_stock (branch_id, inventory_item_id, current_stock, min_stock) VALUES (?, ?, 0, 0)').run(b.id, id[x.n]);
      }
    }
    const seccion = db.prepare("SELECT id FROM categories WHERE name LIKE '%Micheladas%' OR name LIKE '%Bebidas%' ORDER BY display_order, id LIMIT 1").get()?.id
      || db.prepare('SELECT id FROM categories ORDER BY display_order, id LIMIT 1').get()?.id || 1;
    const crear = (nombre, descripcion, precio, partes) => {
      const pid = Number(db.prepare(`
        INSERT INTO products (category_id, name, description, price, cost, is_direct_sale, direct_inventory_item_id, badge, is_active)
        VALUES (?, ?, ?, ?, ?, 0, NULL, '', 1)
      `).run(seccion, nombre, descripcion, precio, AZULITO_COSTO_LIBRETA[nombre]).lastInsertRowid);
      for (const [insumo, ml] of partes) db.prepare('INSERT INTO recipe_items (product_id, inventory_item_id, quantity) VALUES (?, ?, ?)').run(pid, id[insumo], ml);
      return pid;
    };
    const base = [['Esencia azul', 59], ['Sprite', 118.5], ['Power', 167]];     // 2 oz · ½ chaparrita de 237 · ⅓ de 500
    crear('Azulito con licor', 'Esencia azul, vodka, Sprite y Power', 30, [base[0], ['Vodka Absolut', 44], base[1], base[2]]);   // 1½ oz de vodka
    crear('Azulito sin licor', 'Esencia azul, Sprite y Power', 25, base);
    // lo que ya había no puede cambiar (se compara sin contar lo que se acaba de agregar)
    const despues = JSON.parse(fotoDeLoDemas()), previo = JSON.parse(antes);
    if (JSON.stringify(previo[0]) !== JSON.stringify(despues[0].slice(0, previo[0].length)) ||
        JSON.stringify(previo[1]) !== JSON.stringify(despues[1].filter(r => previo[1].some(q => q.inventory_item_id === r.inventory_item_id && q.branch_id === r.branch_id))) ||
        JSON.stringify(previo[2]) !== JSON.stringify(despues[2].slice(0, previo[2].length)) ||
        JSON.stringify(previo[3]) !== JSON.stringify(despues[3].slice(0, previo[3].length)) ||
        JSON.stringify(previo[4]) !== JSON.stringify(despues[4])) {
      throw new Error('algo de lo que ya había cambió y no debía');
    }
    db.exec('PRAGMA user_version = 13;');
    db.exec('COMMIT;');
  } catch (err) {
    try { db.exec('ROLLBACK;'); } catch { /* ya estaba cerrada */ }
    console.error(`[DB] Azulitos: NO se agregaron y se dejó todo como estaba (${err.message}). Copia de seguridad: ${rutaRespaldo}. Se intentará de nuevo al reiniciar.`);
    return;
  }
  try {
    const ruta = join(DATA_DIR, 'medidas_en_ml.txt');
    const linea = `\n\nAzulitos (${new Date().toISOString().slice(0, 10)}): se agregaron "Azulito con licor" (Q30) y "Azulito sin licor" (Q25) en Micheladas & Bebidas, con receta en ml: ` +
      'esencia azul 59 ml (2 oz) + vodka Absolut 44 ml (1½ oz, solo con licor) + Sprite 118.5 ml (½ chaparrita de 237 ml) + Power 167 ml (⅓ de 500 ml). ' +
      'Insumos nuevos (en 0 en todas las sucursales): Esencia azul (botella 250 ml), Vodka Absolut (botella 750 ml), Sprite (237 ml) y Power (500 ml). ' +
      'Los tamaños de Sprite y Power son supuestos: si no son los tuyos, cámbialos en Inventario → Cambiar (la botella) y en Menú → la receta. ' +
      `Los costos están en Q 0 (los azulitos conservan Q11.11 y Q9.20 de tu libreta hasta que los pongas). Copia de antes: ${rutaRespaldo}\n`;
    writeFileSync(ruta, (existsSync(ruta) ? readFileSync(ruta, 'utf8') : '') + linea);
  } catch (e) { /* solo es una nota */ }
  console.log(`[DB] Azulitos: se agregaron 4 insumos en ml y los productos Azulito con licor y Azulito sin licor. Copia de seguridad: ${rutaRespaldo}`);
}

function seedDiningTables() {
  const count = db.prepare('SELECT COUNT(*) as count FROM dining_tables').get().count;
  if (count === 0) {
    const insert = db.prepare('INSERT INTO dining_tables (name, area, status, display_order) VALUES (?, ?, ?, ?)');
    const defaultTables = [
      // Salón Principal
      { name: 'Mesa 1', area: 'Salón Principal', order: 1 },
      { name: 'Mesa 2', area: 'Salón Principal', order: 2 },
      { name: 'Mesa 3', area: 'Salón Principal', order: 3 },
      { name: 'Mesa 4', area: 'Salón Principal', order: 4 },
      { name: 'Mesa 5', area: 'Salón Principal', order: 5 },
      { name: 'Mesa 6', area: 'Salón Principal', order: 6 },
      // Barra
      { name: 'Barra 1', area: 'Barra', order: 7 },
      { name: 'Barra 2', area: 'Barra', order: 8 },
      { name: 'Barra 3', area: 'Barra', order: 9 },
      { name: 'Barra 4', area: 'Barra', order: 10 },
      // Terraza
      { name: 'Terraza 1', area: 'Terraza', order: 11 },
      { name: 'Terraza 2', area: 'Terraza', order: 12 },
      { name: 'Terraza 3', area: 'Terraza', order: 13 },
      { name: 'Terraza 4', area: 'Terraza', order: 14 }
    ];

    for (const t of defaultTables) {
      insert.run(t.name, t.area, 'libre', t.order);
    }
    console.log('[DB] Mesas iniciales (Salón, Barra, Terraza) sembradas con éxito.');
  }
}

function ensureGuatemalanDrinks() {
  const galloInv = db.prepare("SELECT id FROM inventory_items WHERE name LIKE '%Cerveza Gallo%'").get();
  if (!galloInv) {
    // Insert Gallo into inventory
    const resGallo = db.prepare(`
      INSERT INTO inventory_items (name, category, unit, current_stock, min_stock, cost_per_unit, supplier)
      VALUES ('Cerveza Gallo 350ml Botella', 'Cerveza Embotellada', 'pza', 96, 24, 11.50, 'Cervecería Centro Americana')
    `).run();
    const galloId = Number(resGallo.lastInsertRowid);

    const resCabro = db.prepare(`
      INSERT INTO inventory_items (name, category, unit, current_stock, min_stock, cost_per_unit, supplier)
      VALUES ('Cerveza Cabro Extra 350ml', 'Cerveza Embotellada', 'pza', 60, 18, 12.50, 'Cervecería Centro Americana')
    `).run();
    const cabroId = Number(resCabro.lastInsertRowid);

    // Get categories
    const catMicheladas = db.prepare("SELECT id FROM categories WHERE name LIKE '%Michelada%'").get()?.id || 1;
    const catCervezas = db.prepare("SELECT id FROM categories WHERE name LIKE '%Cerveza%'").get()?.id || 2;
    const catBotanas = db.prepare("SELECT id FROM categories WHERE name LIKE '%Botana%'").get()?.id || 5;

    // Direct products
    db.prepare(`
      INSERT INTO products (category_id, name, description, price, cost, is_direct_sale, direct_inventory_item_id, badge)
      VALUES (?, 'Cerveza Gallo 350ml Bien Fría', 'La cerveza orgullo de Guatemala, servida con limón y sal.', 18.00, 11.50, 1, ?, '⭐ Nacional')
    `).run(catCervezas, galloId);

    db.prepare(`
      INSERT INTO products (category_id, name, description, price, cost, is_direct_sale, direct_inventory_item_id, badge)
      VALUES (?, 'Cerveza Cabro Extra 350ml', 'Cerveza de tradición quetzalteca bien fría.', 20.00, 12.50, 1, ?, '')
    `).run(catCervezas, cabroId);

    // Flagship Michelada con Gallo (1L)
    const resMichGallo = db.prepare(`
      INSERT INTO products (category_id, name, description, price, cost, is_direct_sale, direct_inventory_item_id, badge)
      VALUES (?, 'Michelada con Gallo Orgullo (1L)', 'Vaso escarchado con chamoy, tajín, salsas negras de la casa, limón y cerveza Gallo.', 35.00, 16.50, 0, NULL, '🔥 Favorita')
    `).run(catMicheladas);
    const michGalloId = Number(resMichGallo.lastInsertRowid);

    // Link recipe
    const limon = db.prepare("SELECT id FROM inventory_items WHERE name LIKE '%Limón%'").get();
    const salsas = db.prepare("SELECT id FROM inventory_items WHERE name LIKE '%Salsas Negras%'").get();
    const chamoy = db.prepare("SELECT id FROM inventory_items WHERE name LIKE '%Chamoy%'").get();
    const tajin = db.prepare("SELECT id FROM inventory_items WHERE name LIKE '%Tajín%'").get();

    db.prepare('INSERT INTO recipe_items (product_id, inventory_item_id, quantity) VALUES (?, ?, 1)').run(michGalloId, galloId);
    if (limon) db.prepare('INSERT INTO recipe_items (product_id, inventory_item_id, quantity) VALUES (?, ?, 0.04)').run(michGalloId, limon.id);
    if (salsas) db.prepare('INSERT INTO recipe_items (product_id, inventory_item_id, quantity) VALUES (?, ?, 0.03)').run(michGalloId, salsas.id);
    if (chamoy) db.prepare('INSERT INTO recipe_items (product_id, inventory_item_id, quantity) VALUES (?, ?, 0.025)').run(michGalloId, chamoy.id);
    if (tajin) db.prepare('INSERT INTO recipe_items (product_id, inventory_item_id, quantity) VALUES (?, ?, 15)').run(michGalloId, tajin.id);

    console.log('[DB] Cervezas y Micheladas nacionales en Quetzales (Q) integradas con éxito.');
  }
}

function seedInitialBarData() {
  // Categories
  const categories = [
    { name: 'Micheladas & Preparados', icon: '🍹', order: 1 },
    { name: 'Cervezas Frías', icon: '🍺', order: 2 },
    { name: 'Refrescos & Sin Alcohol', icon: '🥤', order: 3 },
    { name: 'Tragos & Licores', icon: '🥃', order: 4 },
    { name: 'Botanas & Snacks', icon: '🥜', order: 5 }
  ];

  const catInsert = db.prepare('INSERT INTO categories (name, icon, display_order) VALUES (?, ?, ?)');
  for (const c of categories) {
    catInsert.run(c.name, c.icon, c.order);
  }

  // Inventory items: Liquids, Bottled drinks, Insumos
  const inventoryItems = [
    // Insumos Líquidos a granel
    { name: 'Barril Cerveza Clara (Barril 50L)', category: 'Líquidos Barril', unit: 'L', stock: 48.5, min_stock: 10.0, cost: 28.00, supplier: 'Grupo Modelo' },
    { name: 'Clamato Original Jugo de Tomate', category: 'Líquidos Insumo', unit: 'L', stock: 18.0, min_stock: 5.0, cost: 42.00, supplier: 'Distribuidora Central' },
    { name: 'Jugo de Limón Natural 100%', category: 'Líquidos Insumo', unit: 'L', stock: 12.0, min_stock: 3.0, cost: 35.00, supplier: 'Mercado de Abastos' },
    { name: 'Mezcla Salsas Negras de la Casa (Maggi/Inglesa)', category: 'Líquidos Insumo', unit: 'L', stock: 7.5, min_stock: 2.0, cost: 65.00, supplier: 'El Mismísimo Receta' },
    { name: 'Chamoy Líquido Concentrado', category: 'Líquidos Insumo', unit: 'L', stock: 14.0, min_stock: 3.0, cost: 40.00, supplier: 'Dulces & Salsas' },
    { name: 'Pulpa de Mango con Chile', category: 'Líquidos Insumo', unit: 'L', stock: 9.0, min_stock: 2.5, cost: 55.00, supplier: 'Frutas & Jarabes' },
    { name: 'Pulpa de Tamarindo Dulce', category: 'Líquidos Insumo', unit: 'L', stock: 8.5, min_stock: 2.5, cost: 55.00, supplier: 'Frutas & Jarabes' },
    { name: 'Tequila Reposado Tradicional', category: 'Licores Líquido', unit: 'L', stock: 4.5, min_stock: 1.0, cost: 320.00, supplier: 'La Europea' },
    { name: 'Ron Bacardí Blanco', category: 'Licores Líquido', unit: 'L', stock: 5.0, min_stock: 1.0, cost: 210.00, supplier: 'La Europea' },
    { name: 'Vodka Smirnoff Red', category: 'Licores Líquido', unit: 'L', stock: 3.8, min_stock: 1.0, cost: 230.00, supplier: 'La Europea' },

    // Escarchados y Sólidos
    { name: 'Polvo Miguelito Chamoy', category: 'Escarchados', unit: 'g', stock: 3500, min_stock: 800, cost: 0.08, supplier: 'Dulces & Salsas' },
    { name: 'Polvo Tajín Clásico', category: 'Escarchados', unit: 'g', stock: 3000, min_stock: 600, cost: 0.12, supplier: 'Dulces & Salsas' },
    { name: 'Ajonjolí Tostado Caramelizado', category: 'Escarchados', unit: 'g', stock: 1800, min_stock: 400, cost: 0.15, supplier: 'Mercado de Abastos' },
    { name: 'Gomitas Enchiladas Surtidas', category: 'Golosinas', unit: 'g', stock: 2400, min_stock: 500, cost: 0.14, supplier: 'Dulces & Salsas' },
    { name: 'Cacahuates Japoneses con Ajo', category: 'Botanas', unit: 'g', stock: 3200, min_stock: 800, cost: 0.09, supplier: 'Botanas El Rey' },

    // Cervezas en Botella / Lata (Piezas)
    { name: 'Corona Extra 355ml Botella', category: 'Cerveza Embotellada', unit: 'pza', stock: 72, min_stock: 24, cost: 21.00, supplier: 'Grupo Modelo' },
    { name: 'Victoria 355ml Botella', category: 'Cerveza Embotellada', unit: 'pza', stock: 65, min_stock: 24, cost: 21.00, supplier: 'Grupo Modelo' },
    { name: 'Modelo Especial 355ml Botella', category: 'Cerveza Embotellada', unit: 'pza', stock: 48, min_stock: 18, cost: 24.50, supplier: 'Grupo Modelo' },
    { name: 'Negra Modelo 355ml Botella', category: 'Cerveza Embotellada', unit: 'pza', stock: 36, min_stock: 12, cost: 25.00, supplier: 'Grupo Modelo' },
    { name: 'Michelob Ultra 355ml Botella', category: 'Cerveza Embotellada', unit: 'pza', stock: 40, min_stock: 15, cost: 26.00, supplier: 'Grupo Modelo' },

    // Refrescos y Mezcladores
    { name: 'Coca-Cola 500ml Vidrio', category: 'Refrescos', unit: 'pza', stock: 54, min_stock: 15, cost: 16.00, supplier: 'Coca-Cola FEMSA' },
    { name: 'Squirt Toronja 600ml', category: 'Refrescos', unit: 'pza', stock: 42, min_stock: 12, cost: 15.50, supplier: 'Peñafiel Grupo' },
    { name: 'Peñafiel Agua Mineral 600ml', category: 'Refrescos', unit: 'pza', stock: 38, min_stock: 12, cost: 14.00, supplier: 'Peñafiel Grupo' }
  ];

  const invInsert = db.prepare(`
    INSERT INTO inventory_items (name, category, unit, current_stock, min_stock, cost_per_unit, supplier)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const itemMap = {};
  for (const item of inventoryItems) {
    const res = invInsert.run(item.name, item.category, item.unit, item.stock, item.min_stock, item.cost, item.supplier);
    itemMap[item.name] = Number(res.lastInsertRowid);
  }

  // Products for Sale
  // Helper to fetch cat ID
  const getCatId = (name) => {
    const row = db.prepare('SELECT id FROM categories WHERE name = ?').get(name);
    return row ? row.id : 1;
  };

  const catMicheladas = getCatId('Micheladas & Preparados');
  const catCervezas = getCatId('Cervezas Frías');
  const catRefrescos = getCatId('Refrescos & Sin Alcohol');
  const catTragos = getCatId('Tragos & Licores');
  const catBotanas = getCatId('Botanas & Snacks');

  const prodInsert = db.prepare(`
    INSERT INTO products (category_id, name, description, price, cost, is_direct_sale, direct_inventory_item_id, badge)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const recipeInsert = db.prepare(`
    INSERT INTO recipe_items (product_id, inventory_item_id, quantity)
    VALUES (?, ?, ?)
  `);

  // 1. Michelada Clásica El Mismísimo (1 Litro) - Preparado
  let p1 = prodInsert.run(
    catMicheladas,
    'Michelada Clásica El Mismísimo (1L)',
    'Vaso escarchado con chamoy y tajín, salsa negra especial, limón fresco y cerveza Corona/Victoria.',
    95.00,
    31.50,
    0,
    null,
    '⭐ Más Vendida'
  );
  const p1Id = Number(p1.lastInsertRowid);
  // Recipe for 1L Michelada: 1 bot Victoria, 0.04L limon, 0.03L salsas, 25g chamoy, 15g tajin
  recipeInsert.run(p1Id, itemMap['Victoria 355ml Botella'], 1);
  recipeInsert.run(p1Id, itemMap['Jugo de Limón Natural 100%'], 0.04);
  recipeInsert.run(p1Id, itemMap['Mezcla Salsas Negras de la Casa (Maggi/Inglesa)'], 0.03);
  recipeInsert.run(p1Id, itemMap['Chamoy Líquido Concentrado'], 0.025);
  recipeInsert.run(p1Id, itemMap['Polvo Tajín Clásico'], 15);

  // 2. Clamato Preparado con Cerveza (1 Litro)
  let p2 = prodInsert.run(
    catMicheladas,
    'Clamato Preparado El Mismísimo (1L)',
    'Delicioso jugo Clamato con salsas de la casa, limón, escarchado picante y cerveza Modelo Especial.',
    125.00,
    44.00,
    0,
    null,
    '🔥 Especial'
  );
  const p2Id = Number(p2.lastInsertRowid);
  recipeInsert.run(p2Id, itemMap['Modelo Especial 355ml Botella'], 1);
  recipeInsert.run(p2Id, itemMap['Clamato Original Jugo de Tomate'], 0.30);
  recipeInsert.run(p2Id, itemMap['Jugo de Limón Natural 100%'], 0.03);
  recipeInsert.run(p2Id, itemMap['Mezcla Salsas Negras de la Casa (Maggi/Inglesa)'], 0.025);
  recipeInsert.run(p2Id, itemMap['Polvo Tajín Clásico'], 15);

  // 3. Gomichela Loca El Mismísimo (1 Litro)
  let p3 = prodInsert.run(
    catMicheladas,
    'Gomichela Loca El Mismísimo (1L)',
    'Cerveza fría, pulpa de tamarindo, chamoy dulce, escarchado Miguelito y copete repleto de gomitas enchiladas.',
    135.00,
    46.00,
    0,
    null,
    '🍬 Favorita'
  );
  const p3Id = Number(p3.lastInsertRowid);
  recipeInsert.run(p3Id, itemMap['Corona Extra 355ml Botella'], 1);
  recipeInsert.run(p3Id, itemMap['Pulpa de Tamarindo Dulce'], 0.08);
  recipeInsert.run(p3Id, itemMap['Chamoy Líquido Concentrado'], 0.04);
  recipeInsert.run(p3Id, itemMap['Gomitas Enchiladas Surtidas'], 45);
  recipeInsert.run(p3Id, itemMap['Polvo Miguelito Chamoy'], 20);

  // 4. Mangochela Picante (1 Litro)
  let p4 = prodInsert.run(
    catMicheladas,
    'Mangochela Tropical (1L)',
    'Exquisita pulpa de mango natural, chamoy, tajín, ajonjolí y cerveza helada.',
    130.00,
    43.00,
    0,
    null,
    '🥭 Novedad'
  );
  const p4Id = Number(p4.lastInsertRowid);
  recipeInsert.run(p4Id, itemMap['Corona Extra 355ml Botella'], 1);
  recipeInsert.run(p4Id, itemMap['Pulpa de Mango con Chile'], 0.09);
  recipeInsert.run(p4Id, itemMap['Chamoy Líquido Concentrado'], 0.03);
  recipeInsert.run(p4Id, itemMap['Polvo Tajín Clásico'], 15);
  recipeInsert.run(p4Id, itemMap['Ajonjolí Tostado Caramelizado'], 10);

  // 5. Tarro Cerveza de Barril Preparado (500ml)
  let p5 = prodInsert.run(
    catMicheladas,
    'Tarro Barril Preparado (500ml)',
    'Cerveza clara directo del barril bien fría, limón, salsas y escarchado clásico.',
    65.00,
    18.50,
    0,
    null,
    ''
  );
  const p5Id = Number(p5.lastInsertRowid);
  recipeInsert.run(p5Id, itemMap['Barril Cerveza Clara (Barril 50L)'], 0.45);
  recipeInsert.run(p5Id, itemMap['Jugo de Limón Natural 100%'], 0.02);
  recipeInsert.run(p5Id, itemMap['Mezcla Salsas Negras de la Casa (Maggi/Inglesa)'], 0.015);
  recipeInsert.run(p5Id, itemMap['Polvo Tajín Clásico'], 10);

  // 6. Cervezas directas
  prodInsert.run(catCervezas, 'Corona Extra 355ml', 'Botella individual bien fría con limón y sal.', 45.00, 21.00, 1, itemMap['Corona Extra 355ml Botella'], '');
  prodInsert.run(catCervezas, 'Victoria 355ml', 'Botella individual de cerveza tipo vienna.', 45.00, 21.00, 1, itemMap['Victoria 355ml Botella'], '');
  prodInsert.run(catCervezas, 'Modelo Especial 355ml', 'Cerveza pilsner mexicana en botella dorada.', 50.00, 24.50, 1, itemMap['Modelo Especial 355ml Botella'], '');
  prodInsert.run(catCervezas, 'Negra Modelo 355ml', 'Cerveza oscura cremosa tipo Munich Dunkel.', 50.00, 25.00, 1, itemMap['Negra Modelo 355ml Botella'], '');
  prodInsert.run(catCervezas, 'Michelob Ultra 355ml', 'Cerveza light baja en calorías y carbohidratos.', 55.00, 26.00, 1, itemMap['Michelob Ultra 355ml Botella'], '');

  // 7. Refrescos & Sin Alcohol
  prodInsert.run(catRefrescos, 'Coca-Cola 500ml Vidrio', 'Refresco clásico en botella de vidrio retornable.', 30.00, 16.00, 1, itemMap['Coca-Cola 500ml Vidrio'], '');
  prodInsert.run(catRefrescos, 'Squirt Toronja 600ml', 'Refresco sabor toronja ideal para acompañar.', 30.00, 15.50, 1, itemMap['Squirt Toronja 600ml'], '');
  prodInsert.run(catRefrescos, 'Peñafiel Agua Mineral 600ml', 'Agua mineral de manantial burbujeante con hielo y limón.', 28.00, 14.00, 1, itemMap['Peñafiel Agua Mineral 600ml'], '');

  // Rusa sin alcohol (preparada con Squirt y Peñafiel)
  let pRusa = prodInsert.run(
    catRefrescos,
    'Rusa Refrescante Preparada (1L)',
    'Mezcla de Squirt y Peñafiel, abundante jugo de limón, sal de grano y vaso escarchado con chile.',
    60.00,
    19.00,
    0,
    null,
    '🍋 Refrescante'
  );
  const pRusaId = Number(pRusa.lastInsertRowid);
  recipeInsert.run(pRusaId, itemMap['Squirt Toronja 600ml'], 0.5);
  recipeInsert.run(pRusaId, itemMap['Peñafiel Agua Mineral 600ml'], 0.5);
  recipeInsert.run(pRusaId, itemMap['Jugo de Limón Natural 100%'], 0.05);
  recipeInsert.run(pRusaId, itemMap['Polvo Tajín Clásico'], 15);

  // 8. Tragos y Destilados
  let pTequila = prodInsert.run(
    catTragos,
    'Shot Tequila Tradicional Reposado (2oz)',
    'Caballito de tequila 100% agave con rodaja de limón y sal.',
    75.00,
    19.20,
    0,
    null,
    ''
  );
  recipeInsert.run(Number(pTequila.lastInsertRowid), itemMap['Tequila Reposado Tradicional'], 0.06);

  let pCuba = prodInsert.run(
    catTragos,
    'Cuba Libre Bacardí (Vaso 16oz)',
    'Ron Bacardí Blanco, refresco de cola, toque de limón y hielo frappé.',
    85.00,
    22.50,
    0,
    null,
    ''
  );
  recipeInsert.run(Number(pCuba.lastInsertRowid), itemMap['Ron Bacardí Blanco'], 0.06);
  recipeInsert.run(Number(pCuba.lastInsertRowid), itemMap['Coca-Cola 500ml Vidrio'], 0.5);

  // 9. Botanas
  let pCacahuates = prodInsert.run(
    catBotanas,
    'Cacahuates Preparados El Mismísimo',
    'Cacahuates con salsas negras, limón, clamato, chile en polvo y chamoy.',
    55.00,
    16.00,
    0,
    null,
    '🥜 Botana'
  );
  const pCacahuatesId = Number(pCacahuates.lastInsertRowid);
  recipeInsert.run(pCacahuatesId, itemMap['Cacahuates Japoneses con Ajo'], 120);
  recipeInsert.run(pCacahuatesId, itemMap['Clamato Original Jugo de Tomate'], 0.05);
  recipeInsert.run(pCacahuatesId, itemMap['Jugo de Limón Natural 100%'], 0.02);
  recipeInsert.run(pCacahuatesId, itemMap['Chamoy Líquido Concentrado'], 0.02);
  recipeInsert.run(pCacahuatesId, itemMap['Polvo Tajín Clásico'], 10);

  console.log('[DB] Catálogo y Recetas iniciales sembrados con éxito.');
}
