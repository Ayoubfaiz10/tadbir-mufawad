'use strict';

/* ================================================================
   Auth — جلسة المستخدم الحالية والتفويض.
   حالياً: المصادقة معطّلة — الجلسة تبدأ كمدير مباشرة.
   ================================================================ */

const { get, all, run } = require('../db/database').helpers;
const { verifyPassword, hashPassword } = require('./pwHash');

/* جلسة افتراضية = مدير (المصادقة معطّلة) */
const currentUser = {
  id: 1,
  username: 'admin',
  display_name: 'مدير المكتب',
  role: 'admin'
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

function login(username, password) {
  const user = get('SELECT * FROM users WHERE username = ?', [username]);
  if (!user) throw new Error(`AUTH:USER_NOT_FOUND:${username}`);
  if (!user.active) throw new Error(`AUTH:INACTIVE_USER:${username}`);
  if (!verifyPassword(password, user.password_hash)) throw new Error('AUTH:WRONG_PASSWORD');
  Object.assign(currentUser, toPublic(user));
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
  require('../db/database').helpers.run('UPDATE users SET password_hash = ? WHERE id = ?', [hash, currentUser.id]);
  return toPublic(user);
}

/* الإجراءات المقيدة: الإجراءات المدمرة / الملغاة / الحذف / إدارة النماذج / العمليات المالية */
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
  // السجلات المهنية: الموظف يرى/ينشئ/يطلب تصحيحاً فقط
  'register.config': ['admin'],
  'register.correct': ['admin'],
  'register.lock': ['admin'],
  'register.export': ['admin'],
  'register.audit': ['admin'],
  // الأرشيف: الختم (Seal) والتحقق admin فقط
  'archive.seal': ['admin'],
  // النسخ الاحتياطي والاستعادة
  'backup.manage': ['admin']
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
  const uname = String(username || '').trim();
  const dname = String(displayName || '').trim();
  if (!uname) throw new Error('AUTH:USERNAME_REQUIRED');
  if (!password || String(password).length < 6) throw new Error('AUTH:PASSWORD_TOO_SHORT');
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
  return login(uname, password);
}

function listUsers() {
  return all('SELECT id, username, display_name, role, active FROM users ORDER BY id');
}

module.exports = { login, logout, changePassword, isAuthorized, requireAuth, getCurrentUser, needsSetup, setupInitial, listUsers };