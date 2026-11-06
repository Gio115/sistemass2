import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { db, DATA_DIR } from './db.js';

// La clave de firma NUNCA va escrita en el código.
// 1) Se usa la variable de entorno JWT_SECRET (recomendado en producción, mínimo 32 caracteres).
// 2) Si no existe, se genera una clave aleatoria y se guarda en data/.jwt_secret para que
//    las sesiones sobrevivan a los reinicios (útil en local).
function loadJwtSecret() {
  const fromEnv = process.env.JWT_SECRET;
  if (fromEnv && fromEnv.length >= 32) return fromEnv;
  if (fromEnv) {
    console.warn('[AUTH] JWT_SECRET es demasiado corto (mínimo 32 caracteres); se ignora.');
  }

  const dir = DATA_DIR;
  const file = join(dir, '.jwt_secret');
  try {
    if (existsSync(file)) {
      const saved = readFileSync(file, 'utf8').trim();
      if (saved.length >= 32) return saved;
    }
  } catch { /* se genera una nueva */ }

  const secret = randomBytes(48).toString('hex');
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, secret, { mode: 0o600 });
  console.warn(`[AUTH] JWT_SECRET no está definido: se generó una clave aleatoria en ${file}.`);
  console.warn('[AUTH] En producción (Hostinger, Render, etc.) define JWT_SECRET como variable de entorno.');
  return secret;
}

const JWT_SECRET = loadJwtSecret();

// Lightweight and secure token generation using Node crypto HMAC
export function generateToken(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const bodyPayload = {
    ...payload,
    exp: Date.now() + (1000 * 60 * 60 * 24 * 7) // 7 days validity
  };
  const body = Buffer.from(JSON.stringify(bodyPayload)).toString('base64url');
  const signature = createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

export function verifyToken(token) {
  try {
    if (!token) return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [header, body, signature] = parts;
    const expectedSignature = createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expectedSignature);
    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) return null;

    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (payload.exp && Date.now() > payload.exp) {
      return null; // Expired
    }
    return payload;
  } catch (err) {
    return null;
  }
}

// Authentication middleware
export function authenticate(req, res, next) {
  const authHeader = req.headers.authorization || req.headers['x-auth-token'];
  let token = null;

  if (authHeader) {
    if (authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    } else {
      token = authHeader;
    }
  }

  if (!token) {
    return res.status(401).json({ error: 'No autorizado: Falta token de sesión' });
  }

  const payload = verifyToken(token);
  if (!payload) {
    return res.status(401).json({ error: 'Sesión inválida o expirada' });
  }

  // Verify user still exists and is active in DB
  const user = db.prepare('SELECT id, username, full_name, role, is_active FROM users WHERE id = ?').get(payload.id);
  if (!user || !user.is_active) {
    return res.status(403).json({ error: 'Usuario no encontrado o inactivo' });
  }

  req.user = user;
  next();
}

// Admin only middleware (Strictly blocks 'vendedor' from admin features)
export function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({
      error: 'Acceso Denegado: Esta función está reservada exclusivamente para el Administrador'
    });
  }
  next();
}
