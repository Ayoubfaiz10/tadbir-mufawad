'use strict';

/* ================================================================
   Auth — جلسة المستخدم الحالية والتفويض مع مصادقة بكلمة المرور.
   التجزئة عبر scrypt (services/pwHash). الجلسة في العملية الرئيسية.
   أحداث المصادقة تُسجل مباشرة في audit_logs (بدون استيراد دائري).
   ================================================================ */

const { get, all, run } = require('../db/database').helpers;
const { persist } = require('../db/database');
const { verifyPassword, hashPassword } = require('./pwHash');

/* جلسة فارغة = غير مسجّل الدخول */
const currentUser = {
  id: 0,
  username: '',
  display_name: '',
  role: 'guest'
};

function toPublic(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    display_name: user.display_name,
    role: user.role,
    active: user.active
  };
}

/* سجل تدقيق داخلي (تجنب الاستيراد الدائري مع services/audit) */
function logAudit(action, entity, entityId, byUser, metadata) {
  try {
    run(
      "INSERT INTO audit_logs (action, entity, entity_id, by_user, metadata, created_at) VALUES (?,?,?,?,?, datetime('now'))",
      [action, entity, entityId, byUser, metadata ? JSON.stringify(metadata) : '']
    );
  } catch (e) { /* لا نكسر المصادقة بسبب فشل التسجيل */ }
}

/* ---------- الدخول والخروج ---------- */
function login(username, password) {
  const user = get('SELECT * FROM users WHERE username = ?', [username]);
  if (!user) {
    logAudit('auth.login_failed', 'user', 0, String(username || 'unknown'), { reason: 'not_found' });
    throw new Error('AUTH:USER_NOT_FOUND');
  }
  if (!user.active) {
    logAudit('auth.login_failed', 'user', user.id, user.username, { reason: 'inactive' });
    throw new Error('AUTH:INACTIVE_USER');
  }
  if (!verifyPassword(password, user.password_hash)) {
    logAudit('auth.login_failed', 'user', user.id, user.username, { reason: 'wrong_password' });
    throw new Error('AUTH:WRONG_PASSWORD');
  }
  Object.assign(currentUser, toPublic(user));
  logAudit('auth.login', 'user', user.id, user.username, {});
  return toPublic(currentUser);
}

function logout() {
  Object.assign(currentUser, { id: 0, username: '', display_name: '', role: 'guest' });
  return toPublic(currentUser);
}

function changePassword(currentPassword, newPassword) {
  if (currentUser.id === 0) throw new Error('AUTH:LOGIN_REQUIRED');
  const user = get('SELECT * FROM users WHERE id = ?', [currentUser.id]);
  if (!user || !verifyPassword(currentPassword, user.password_hash)) throw new Error('AUTH:WRONG_PASSWORD');
  if (!newPassword || String(newPassword).length < 6) throw new Error('AUTH:PASSWORD_TOO_SHORT');
  const hash = hashPassword(newPassword);
  run('UPDATE users SET password_hash = ? WHERE id = ?', [hash, currentUser.id]);
  logAudit('auth.password_changed', 'user', user.id, user.username, {});
  persist();
  return toPublic(user);
}

/* ---------- الصلاحيات ---------- */
const RESTRICTED = {
  'procedure.delete': ['admin'],
  'procedure.cancel': ['admin'],
  'document.delete': ['admin'],
  'template.manage': ['admin'],
  'pv.delete': ['admin'],
  'payment.confirm': ['admin'],
  'payment.cancel': ['admin'],
  'refund.create': ['admin'],
  'tariff.manage': ['admin'],
  'receipt.cancel': ['admin'],
  'accounting.delete': ['admin'],
  'register.config': ['admin'],
  'register.correct': ['admin'],
  'register.lock': ['admin'],
  'register.export': ['admin'],
  'register.audit': ['admin'],
  'archive.seal': ['admin'],
  'backup.manage': ['admin'],
  'users.manage': ['admin']
};

function isAuthorized(action) {
  if (currentUser.id === 0) return false;
  const allowed = RESTRICTED[action];
  if (!allowed) return true;
  return allowed.includes(currentUser.role);
}

function requireAuth(action) {
  if (currentUser.id === 0) throw new Error('AUTH:LOGIN_REQUIRED');
  if (!isAuthorized(action)) throw new Error(`AUTH:UNAUTHORIZED:${action}`);
}

function getCurrentUser() {
  return toPublic(currentUser);
}

/* ---------- التسجيل الأول (أول تشغيل) ---------- */
function needsSetup() {
  const row = get("SELECT COUNT(*) AS c FROM users WHERE password_hash <> ''");
  return row.c === 0;
}

function setupInitial(username, displayName, password) {
  if (!needsSetup()) throw new Error('AUTH:ALREADY_SETUP');
  if (!username || !String(username).trim()) throw new Error('AUTH:USERNAME_REQUIRED');
  if (!password || String(password).length < 6) throw new Error('AUTH:PASSWORD_TOO_SHORT');
  const uname = String(username).trim();
  const dname = String(displayName || '').trim();
  if (get("SELECT id FROM users WHERE username = ? AND role <> 'admin'", [uname])) {
    throw new Error('AUTH:USERNAME_TAKEN');
  }
  const hash = hashPassword(password);
  let target = get("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1");
  if (!target) {
    const ins = run('INSERT INTO users (username, display_name, role, active, password_hash) VALUES (?,?,?,1,?)', [uname, dname, 'admin', hash]);
    target = { id: ins.lastId };
  } else {
    run('UPDATE users SET username = ?, display_name = ?, password_hash = ? WHERE id = ?', [uname, dname, hash, target.id]);
  }
  logAudit('auth.setup_initial', 'user', target.id, uname, {});
  persist();
  return login(uname, password);
}

/* ---------- إدارة المستخدمين (admin فقط) ---------- */
function listUsers() {
  requireAuth('users.manage');
  return all('SELECT id, username, display_name, role, active FROM users ORDER BY id');
}

function createUser(username, displayName, role, password) {
  requireAuth('users.manage');
  const uname = String(username || '').trim();
  if (!uname) throw new Error('AUTH:USERNAME_REQUIRED');
  if (role !== 'admin' && role !== 'agent') throw new Error('AUTH:INVALID_ROLE');
  if (!password || String(password).length < 6) throw new Error('AUTH:PASSWORD_TOO_SHORT');
  if (get('SELECT id FROM users WHERE lower(username) = lower(?)', [uname])) throw new Error('AUTH:USERNAME_TAKEN');
  const ins = run(
    'INSERT INTO users (username, display_name, role, active, password_hash) VALUES (?,?,?,1,?)',
    [uname, String(displayName || '').trim(), role, hashPassword(password)]
  );
  logAudit('auth.user_created', 'user', ins.lastId, currentUser.username, { username: uname, role });
  persist();
  return all('SELECT id, username, display_name, role, active FROM users WHERE id = ?', [ins.lastId])[0];
}

function setUserActive(id, active) {
  requireAuth('users.manage');
  const uid = Number(id);
  if (!uid || uid === currentUser.id) throw new Error('AUTH:CANNOT_SELF');
  const target = get('SELECT * FROM users WHERE id = ?', [uid]);
  if (!target) throw new Error('NOT_FOUND:user:' + uid);
  const isAdmin = get("SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND active = 1").c;
  if (target.role === 'admin' && !active && isAdmin <= 1) throw new Error('AUTH:LAST_ADMIN');
  run('UPDATE users SET active = ? WHERE id = ?', [active ? 1 : 0, uid]);
  logAudit(active ? 'auth.user_activated' : 'auth.user_deactivated', 'user', uid, currentUser.username, { username: target.username });
  persist();
  return all('SELECT id, username, display_name, role, active FROM users WHERE id = ?', [uid])[0];
}

function deleteUser(id) {
  requireAuth('users.manage');
  const uid = Number(id);
  if (!uid || uid === currentUser.id) throw new Error('AUTH:CANNOT_SELF');
  const target = get('SELECT * FROM users WHERE id = ?', [uid]);
  if (!target) throw new Error('NOT_FOUND:user:' + uid);
  const isAdmin = get("SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND active = 1").c;
  if (target.role === 'admin' && isAdmin <= 1) throw new Error('AUTH:LAST_ADMIN');
  run('DELETE FROM users WHERE id = ?', [uid]);
  logAudit('auth.user_deleted', 'user', uid, currentUser.username, { username: target.username });
  persist();
  return { ok: true };
}

function resetPassword(id, newPassword) {
  requireAuth('users.manage');
  const uid = Number(id);
  if (!uid) throw new Error('NOT_FOUND:user:' + uid);
  if (!newPassword || String(newPassword).length < 6) throw new Error('AUTH:PASSWORD_TOO_SHORT');
  const target = get('SELECT * FROM users WHERE id = ?', [uid]);
  if (!target) throw new Error('NOT_FOUND:user:' + uid);
  run('UPDATE users SET password_hash = ? WHERE id = ?', [hashPassword(newPassword), uid]);
  logAudit('auth.password_reset', 'user', uid, currentUser.username, { username: target.username });
  persist();
  return { ok: true };
}

module.exports = {
  login, logout, changePassword,
  isAuthorized, requireAuth, getCurrentUser,
  needsSetup, setupInitial, listUsers,
  createUser, setUserActive, deleteUser, resetPassword
};