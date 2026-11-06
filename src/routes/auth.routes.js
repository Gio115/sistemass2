import { Router } from 'express';
import { db, verifyPassword } from '../db.js';
import { generateToken, authenticate } from '../auth.js';
import { branchesForUser, listBranches } from '../branches.js';
import { segundosDeEspera, anotarFallo, limpiarFallos } from '../login-limite.js';

const router = Router();

// POST /api/auth/login
router.post('/login', (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password || typeof username !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
    }

    // Demasiados intentos fallidos seguidos: se espera unos minutos (sin gastar tiempo revisando la contraseña)
    const espera = segundosDeEspera(req.ip, username);
    if (espera > 0) {
      res.setHeader('Retry-After', String(espera));
      return res.status(429).json({ error: `Demasiados intentos con ese usuario. Espera ${espera > 90 ? Math.ceil(espera / 60) + ' minutos' : espera + ' segundos'} e inténtalo otra vez.` });
    }

    const user = db.prepare('SELECT * FROM users WHERE LOWER(username) = LOWER(?)').get(username.trim());
    if (!user) {
      anotarFallo(req.ip, username);
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    if (!user.is_active) {
      return res.status(403).json({ error: 'Esta cuenta ha sido desactivada por el Administrador' });
    }

    const isValid = verifyPassword(password, user.salt, user.password_hash);
    if (!isValid) {
      anotarFallo(req.ip, username);
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }
    limpiarFallos(req.ip, username);

    const token = generateToken({
      id: user.id,
      username: user.username,
      role: user.role,
      full_name: user.full_name
    });

    const deFabrica = (user.username === 'admin' && password === 'admin123') || (user.username === 'vendedor' && password === 'vendedor123');
    res.json({
      success: true,
      token,
      password_de_fabrica: deFabrica,
      user: {
        id: user.id,
        username: user.username,
        full_name: user.full_name,
        role: user.role,
        branches: branchesForUser(user).map(b => ({ id: b.id, name: b.name })),
        total_branches: listBranches(true).length
      }
    });
  } catch (error) {
    console.error('Error en login:', error);
    res.status(500).json({ error: 'Error interno en autenticación' });
  }
});

// GET /api/auth/me
router.get('/me', authenticate, (req, res) => {
  res.json({
    user: {
      id: req.user.id,
      username: req.user.username,
      full_name: req.user.full_name,
      role: req.user.role,
      branches: branchesForUser(req.user).map(b => ({ id: b.id, name: b.name })),
      total_branches: listBranches(true).length
    }
  });
});

export default router;
