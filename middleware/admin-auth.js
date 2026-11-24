const crypto = require('crypto');

/**
 * Área admin: senha única (env ADMIN_PASSWORD), sem cadastro.
 * Após o login fica um cookie derivado da senha; trocar a senha desloga todos.
 */
const COOKIE = 'ufs_drive_admin';
const MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30;

function sessionToken(password) {
  return crypto.createHmac('sha256', password).update('ufs-drive-admin').digest('hex');
}

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function readCookie(req, name) {
  const header = req.get('Cookie') || '';
  const match = header.split(/;\s*/).find((c) => c.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : '';
}

function isAdmin(req) {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) return false;
  return safeEqual(readCookie(req, COOKIE), sessionToken(password));
}

function checkPassword(attempt) {
  const password = process.env.ADMIN_PASSWORD;
  return Boolean(password) && safeEqual(attempt || '', password);
}

function setAdminCookie(res) {
  res.cookie(COOKIE, sessionToken(process.env.ADMIN_PASSWORD), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: MAX_AGE_MS,
    path: '/',
  });
}

function clearAdminCookie(res) {
  res.clearCookie(COOKIE, { path: '/' });
}

function requireAdmin(req, res, next) {
  if (isAdmin(req)) return next();
  if (req.path.startsWith('/api/') || req.xhr || (req.get('Accept') || '').includes('application/json')) {
    return res.status(401).json({ error: 'Não autorizado' });
  }
  res.redirect('/admin');
}

module.exports = { isAdmin, checkPassword, setAdminCookie, clearAdminCookie, requireAdmin };
