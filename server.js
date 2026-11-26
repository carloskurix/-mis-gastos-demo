// Mis Gastos — Node.js 18+ sin framework (solo módulo http + pg).
// Postgres real cuando existe DATABASE_URL (Render), JSON local en
// data/mis-gastos.json cuando no hay base de datos (laptop de Carlos).
// Para correrlo: node server.js  ->  http://localhost:3000
// Seguridad: contraseñas PBKDF2 + salt, sesiones con token aleatorio
// que expira en 7 días, cada usuario ve solo sus propios gastos.
// Los montos se guardan en centavos (enteros) para no perder precisión.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_FILE = path.join(__dirname, 'data', 'mis-gastos.json');
const DATABASE_URL = process.env.DATABASE_URL || '';
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-only-change-in-production';

const CATEGORIES = ['Comida', 'Transporte', 'Casa', 'Ocio', 'Salud', 'Otros'];

// --- Postgres (solo si hay DATABASE_URL) ---
let pool = null;
if (DATABASE_URL) {
  try {
    const { Pool } = require('pg');
    pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
    pool.on('error', (err) => console.error('Error de Postgres:', err.message));
  } catch (e) {
    console.error('No se pudo cargar pg, se usará el archivo JSON:', e.message);
    pool = null;
  }
}

async function initDb() {
  if (!pool) return;
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL, salt TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT '')`);
    await pool.query(`CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at TEXT NOT NULL)`);
    await pool.query(`CREATE TABLE IF NOT EXISTS expenses (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, description TEXT NOT NULL,
      amount_cents INT NOT NULL, category TEXT NOT NULL,
      date TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT '')`);
    console.log('Base de datos Postgres lista.');
  } catch (e) {
    console.error('Postgres no disponible, se usará el archivo JSON:', e.message);
    pool = null;
  }
}

// --- JSON local ---
function readData() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const d = JSON.parse(raw || '{}');
    return { users: d.users || [], sessions: d.sessions || [], expenses: d.expenses || [] };
  } catch (e) {
    return { users: [], sessions: [], expenses: [] };
  }
}
function saveData(d) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(d, null, 2), 'utf8');
}

// --- Contraseñas y sesiones ---
function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
}
function newSalt() { return crypto.randomBytes(16).toString('hex'); }
function newToken() { return crypto.randomBytes(32).toString('hex'); }
function newId() { return Date.now().toString(36) + crypto.randomBytes(6).toString('hex'); }

async function findUserByEmail(email) {
  const e = String(email).toLowerCase();
  if (!pool) return readData().users.find((u) => u.email === e) || null;
  const r = await pool.query('SELECT * FROM users WHERE email = $1', [e]);
  return r.rows[0] || null;
}
async function findUserById(id) {
  if (!pool) return readData().users.find((u) => u.id === id) || null;
  const r = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
  return r.rows[0] || null;
}
async function createUser({ name, email, password }) {
  const salt = newSalt();
  const user = {
    id: newId(), name, email: String(email).toLowerCase(),
    password_hash: hashPassword(password, salt), salt,
    created_at: new Date().toISOString(),
  };
  if (!pool) {
    const d = readData();
    if (d.users.some((u) => u.email === user.email)) return null;
    d.users.push(user); saveData(d); return user;
  }
  try {
    await pool.query(
      'INSERT INTO users (id,name,email,password_hash,salt,created_at) VALUES ($1,$2,$3,$4,$5,$6)',
      [user.id, user.name, user.email, user.password_hash, user.salt, user.created_at]);
    return user;
  } catch (e) { return null; }
}
async function updatePassword(userId, newPassword) {
  const salt = newSalt();
  const hash = hashPassword(newPassword, salt);
  if (!pool) {
    const d = readData();
    const u = d.users.find((x) => x.id === userId);
    if (!u) return false;
    u.password_hash = hash; u.salt = salt; saveData(d); return true;
  }
  await pool.query('UPDATE users SET password_hash=$1, salt=$2 WHERE id=$3', [hash, salt, userId]);
  return true;
}
async function createSession(userId) {
  const token = newToken();
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  if (!pool) {
    const d = readData();
    d.sessions.push({ token, user_id: userId, expires_at: expires }); saveData(d);
    return { token, expires_at: expires };
  }
  await pool.query('INSERT INTO sessions (token,user_id,expires_at) VALUES ($1,$2,$3)', [token, userId, expires]);
  return { token, expires_at: expires };
}
async function findSession(token) {
  if (!token) return null;
  if (!pool) {
    const s = readData().sessions.find((x) => x.token === token) || null;
    if (s && new Date(s.expires_at) < new Date()) return null;
    return s;
  }
  const r = await pool.query('SELECT * FROM sessions WHERE token = $1', [token]);
  const s = r.rows[0] || null;
  if (s && new Date(s.expires_at) < new Date()) return null;
  return s;
}
async function deleteSession(token) {
  if (!pool) {
    const d = readData();
    d.sessions = d.sessions.filter((x) => x.token !== token); saveData(d); return;
  }
  await pool.query('DELETE FROM sessions WHERE token = $1', [token]);
}
async function deleteSessionsForUser(userId) {
  if (!pool) {
    const d = readData();
    d.sessions = d.sessions.filter((x) => x.user_id !== userId); saveData(d); return;
  }
  await pool.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
}

// --- Gastos ---
function publicExpense(row) {
  return {
    id: row.id, description: row.description,
    amount: row.amount_cents / 100, amountCents: row.amount_cents,
    category: row.category, date: row.date, createdAt: row.created_at || '',
  };
}
function normalize(text) {
  return String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}
async function listExpenses(userId, { month, category, q }) {
  let rows;
  if (!pool) {
    rows = readData().expenses.filter((e) => e.user_id === userId);
  } else {
    const r = await pool.query('SELECT * FROM expenses WHERE user_id = $1', [userId]);
    rows = r.rows;
  }
  if (month) rows = rows.filter((e) => String(e.date).startsWith(month));
  if (category && category !== 'Todas') rows = rows.filter((e) => e.category === category);
  if (q) {
    const needle = normalize(q);
    rows = rows.filter((e) => normalize(e.description).includes(needle));
  }
  rows.sort((a, b) => (b.date + (b.created_at || '')).localeCompare(a.date + (a.created_at || '')));
  const expenses = rows.map(publicExpense);
  const totalCents = rows.reduce((sum, e) => sum + e.amount_cents, 0);
  const byCategory = {};
  for (const c of CATEGORIES) byCategory[c] = 0;
  for (const e of rows) byCategory[e.category] = (byCategory[e.category] || 0) + e.amount_cents;
  return { expenses, totalCents, byCategory, count: rows.length };
}
async function createExpenseRow({ userId, description, amountCents, category, date }) {
  const item = {
    id: newId(), user_id: userId, description, amount_cents: amountCents,
    category, date, created_at: new Date().toISOString(),
  };
  if (!pool) {
    const d = readData(); d.expenses.push(item); saveData(d); return item;
  }
  await pool.query(
    'INSERT INTO expenses (id,user_id,description,amount_cents,category,date,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [item.id, item.user_id, item.description, item.amount_cents, item.category, item.date, item.created_at]);
  return item;
}
async function findExpense(id) {
  if (!pool) return readData().expenses.find((e) => e.id === id) || null;
  const r = await pool.query('SELECT * FROM expenses WHERE id = $1', [id]);
  return r.rows[0] || null;
}
async function updateExpenseRow(id, { description, amountCents, category, date }) {
  if (!pool) {
    const d = readData();
    const e = d.expenses.find((x) => x.id === id);
    if (!e) return null;
    e.description = description; e.amount_cents = amountCents; e.category = category; e.date = date;
    saveData(d); return e;
  }
  const r = await pool.query(
    'UPDATE expenses SET description=$1, amount_cents=$2, category=$3, date=$4 WHERE id=$5 RETURNING *',
    [description, amountCents, category, date, id]);
  return r.rows[0] || null;
}
async function deleteExpenseRow(id) {
  if (!pool) {
    const d = readData();
    d.expenses = d.expenses.filter((e) => e.id !== id); saveData(d); return;
  }
  await pool.query('DELETE FROM expenses WHERE id = $1', [id]);
}

// --- Validación ---
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function validEmail(e) { return typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); }
function validDate(d) { return typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d); }
function validateExpense(d) {
  const description = String(d.description || '').trim();
  const category = String(d.category || '');
  const date = String(d.date || '');
  const amount = Number(d.amount);
  if (!description || description.length > 120) return { error: 'La descripción es obligatoria (máximo 120 caracteres)' };
  if (!Number.isFinite(amount) || amount <= 0) return { error: 'El monto debe ser mayor a cero' };
  if (amount > 10000000) return { error: 'El monto es demasiado grande' };
  if (!CATEGORIES.includes(category)) return { error: 'Categoría no válida' };
  if (!validDate(date)) return { error: 'Fecha no válida (AAAA-MM-DD)' };
  if (date > todayStr()) return { error: 'La fecha no puede ser en el futuro' };
  return { ok: true, description, amountCents: Math.round(amount * 100), category, date };
}

// --- HTTP helpers ---
function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}
function publicUser(u) {
  return u ? { id: u.id, name: u.name, email: u.email } : null;
}
function getToken(req) {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7);
  const cookie = req.headers.cookie || '';
  const m = cookie.match(/(?:^|;\s*)session=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}
async function authUser(req) {
  const token = getToken(req);
  const session = await findSession(token);
  if (!session) return null;
  const user = await findUserById(session.user_id);
  return user ? { user, token } : null;
}
function requireAuth(res, auth) {
  if (!auth) { sendJson(res, 401, { error: 'Inicia sesión para continuar' }); return false; }
  return true;
}
function sendFile(res, filePath) {
  const ext = path.extname(filePath);
  const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
  fs.readFile(filePath, (err, content) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('No encontrado'); }
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
    res.end(content);
  });
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 200000) req.destroy(); });
    req.on('end', () => { try { resolve(body ? JSON.parse(body) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}
function setSessionCookie(res, status, session, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Set-Cookie': `session=${session.token}; Path=/; Max-Age=${7 * 24 * 3600}; HttpOnly; SameSite=Lax`,
  });
  return res.end(JSON.stringify(payload));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;
  try {
    // Categorías
    if (pathname === '/api/categories' && req.method === 'GET') {
      return sendJson(res, 200, { categories: CATEGORIES });
    }
    // Registro
    if (pathname === '/api/register' && req.method === 'POST') {
      const d = await readBody(req);
      const name = String(d.name || '').trim();
      const email = String(d.email || '').trim();
      const password = String(d.password || '');
      if (name.length < 2 || !validEmail(email) || password.length < 6) {
        return sendJson(res, 400, { error: 'Nombre, correo válido y contraseña de al menos 6 caracteres' });
      }
      if (await findUserByEmail(email)) return sendJson(res, 400, { error: 'Ese correo ya está registrado' });
      const user = await createUser({ name, email, password });
      if (!user) return sendJson(res, 400, { error: 'No se pudo crear la cuenta' });
      const session = await createSession(user.id);
      return setSessionCookie(res, 201, session, { user: publicUser(user), token: session.token });
    }
    // Login
    if (pathname === '/api/login' && req.method === 'POST') {
      const d = await readBody(req);
      const email = String(d.email || '').trim();
      const password = String(d.password || '');
      const user = await findUserByEmail(email);
      if (!user || hashPassword(password, user.salt) !== user.password_hash) {
        return sendJson(res, 401, { error: 'Correo o contraseña incorrectos' });
      }
      const session = await createSession(user.id);
      return setSessionCookie(res, 200, session, { user: publicUser(user), token: session.token });
    }
    // Logout
    if (pathname === '/api/logout' && req.method === 'POST') {
      const token = getToken(req);
      if (token) await deleteSession(token);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Set-Cookie': 'session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax' });
      return res.end(JSON.stringify({ ok: true }));
    }
    // Yo
    if (pathname === '/api/me' && req.method === 'GET') {
      const auth = await authUser(req);
      if (!requireAuth(res, auth)) return;
      return sendJson(res, 200, { user: publicUser(auth.user) });
    }
    // Cambiar contraseña
    if (pathname === '/api/change-password' && req.method === 'POST') {
      const auth = await authUser(req);
      if (!requireAuth(res, auth)) return;
      const d = await readBody(req);
      const current = String(d.currentPassword || '');
      const next = String(d.newPassword || '');
      if (hashPassword(current, auth.user.salt) !== auth.user.password_hash) {
        return sendJson(res, 401, { error: 'Tu contraseña actual no coincide' });
      }
      if (next.length < 6) return sendJson(res, 400, { error: 'La nueva contraseña debe tener al menos 6 caracteres' });
      await updatePassword(auth.user.id, next);
      await deleteSessionsForUser(auth.user.id);
      return sendJson(res, 200, { ok: true, message: 'Contraseña cambiada. Vuelve a iniciar sesión.' });
    }
    // Listar gastos (con totales del mes, filtro y búsqueda)
    if (pathname === '/api/expenses' && req.method === 'GET') {
      const auth = await authUser(req);
      if (!requireAuth(res, auth)) return;
      const out = await listExpenses(auth.user.id, {
        month: url.searchParams.get('month') || '',
        category: url.searchParams.get('category') || '',
        q: url.searchParams.get('q') || '',
      });
      return sendJson(res, 200, out);
    }
    // Crear gasto
    if (pathname === '/api/expenses' && req.method === 'POST') {
      const auth = await authUser(req);
      if (!requireAuth(res, auth)) return;
      const d = await readBody(req);
      const v = validateExpense(d);
      if (v.error) return sendJson(res, 400, { error: v.error });
      const row = await createExpenseRow({ userId: auth.user.id, description: v.description, amountCents: v.amountCents, category: v.category, date: v.date });
      return sendJson(res, 201, publicExpense(row));
    }
    // Editar / borrar gasto (solo el dueño)
    if (pathname.startsWith('/api/expenses/') && (req.method === 'PUT' || req.method === 'DELETE')) {
      const auth = await authUser(req);
      if (!requireAuth(res, auth)) return;
      const id = decodeURIComponent(pathname.split('/')[3] || '');
      const row = await findExpense(id);
      if (!row) return sendJson(res, 404, { error: 'Gasto no encontrado' });
      if (row.user_id !== auth.user.id) return sendJson(res, 403, { error: 'Solo puedes cambiar tus propios gastos' });
      if (req.method === 'DELETE') {
        await deleteExpenseRow(id);
        return sendJson(res, 200, { ok: true });
      }
      const d = await readBody(req);
      const v = validateExpense(d);
      if (v.error) return sendJson(res, 400, { error: v.error });
      const updated = await updateExpenseRow(id, { description: v.description, amountCents: v.amountCents, category: v.category, date: v.date });
      return sendJson(res, 200, publicExpense(updated));
    }
  } catch (e) {
    console.error('Error en la API:', e.message);
    return sendJson(res, 500, { error: 'Error del servidor' });
  }

  // Archivos estáticos
  let filePath = pathname === '/' ? path.join(PUBLIC_DIR, 'index.html') : path.join(PUBLIC_DIR, pathname);
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('Prohibido'); }
  return sendFile(res, filePath);
});

initDb().then(() => {
  server.listen(PORT, HOST, () => {
    console.log(`Mis Gastos corriendo en http://localhost:${PORT}`);
    console.log(pool ? 'Guardando en Postgres.' : 'Guardando en data/mis-gastos.json.');
    console.log('Para detenerla, presiona Ctrl + C en la terminal.');
  });
});
