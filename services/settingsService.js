'use strict';

/* ================================================================
   SettingsService — الإعدادات العامة في meta (بيانات المكتب).
   ================================================================ */

const { get, all, run, tx } = require('../db/database').helpers;

const OFFICE_KEYS = ['name', 'address', 'phone', 'registration_number', 'email', 'ice'];

function getOffice() {
  const rows = all("SELECT key, value FROM meta WHERE key LIKE 'office.%'");
  const o = { name: '', address: '', phone: '', registration_number: '', email: '', ice: '' };
  rows.forEach((r) => {
    const k = r.key.replace('office.', '');
    if (k in o) o[k] = r.value || '';
  });
  return o;
}

function saveOffice(input = {}) {
  tx(() => {
    OFFICE_KEYS.forEach((k) => {
      const key = 'office.' + k;
      const val = String(input[k] == null ? '' : input[k]).slice(0, 500);
      if (get('SELECT value FROM meta WHERE key = ?', [key])) {
        run('UPDATE meta SET value = ? WHERE key = ?', [val, key]);
      } else {
        run('INSERT INTO meta (key, value) VALUES (?,?)', [key, val]);
      }
    });
  });
  return getOffice();
}

module.exports = { getOffice, saveOffice, OFFICE_KEYS };
