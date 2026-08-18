'use strict';

/* ================================================================
   pwHash — تجزئة كلمات المرور (scrypt المدمج في Node).
   الصيغة المخزنة: saltHex:hashHex
   ================================================================ */

const crypto = require('crypto');

const KEY_LEN = 64;

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password == null ? '' : password), salt, KEY_LEN);
  return salt.toString('hex') + ':' + hash.toString('hex');
}

function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [saltHex, hashHex] = stored.split(':');
  try {
    const expected = Buffer.from(hashHex, 'hex');
    const actual = crypto.scryptSync(String(password == null ? '' : password), Buffer.from(saltHex, 'hex'), KEY_LEN);
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch (e) {
    return false;
  }
}

module.exports = { hashPassword, verifyPassword };