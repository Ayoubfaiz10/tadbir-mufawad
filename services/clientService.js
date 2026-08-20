'use strict';

/* ================================================================
   ClientService — العملاء (يُحافظ على التوافق مع الواجهة القديمة)
   ================================================================ */

const { get, all, run, tx } = require('../db/database').helpers;
const audit = require('./audit');

function listAll() {
  return all('SELECT * FROM clients ORDER BY id DESC');
}

function getById(id) {
  return get('SELECT * FROM clients WHERE id = ?', [id]);
}

function save(client) {
  return tx(() => {
    let id = client.id || null;
    if (id) {
      run(
        'UPDATE clients SET name = ?, phone = ?, email = ?, type = ?, notes = ? WHERE id = ?',
        [client.name, client.phone || '', client.email || '', client.type || '', client.notes || '', id]
      );
      audit.log({ action: 'client.updated', entity: 'client', entityId: id });
    } else {
      const now = new Date().toISOString();
      id = run(
        'INSERT INTO clients (name, phone, email, type, notes, created_at) VALUES (?,?,?,?,?,?)',
        [client.name, client.phone || '', client.email || '', client.type || '', client.notes || '', now]
      ).lastId;
      audit.log({ action: 'client.created', entity: 'client', entityId: id });
    }
    return getById(id);
  });
}

function remove(id) {
  run('DELETE FROM clients WHERE id = ?', [id]);
  audit.log({ action: 'client.deleted', entity: 'client', entityId: id });
  return true;
}

/* ---------- تفاصيل العميل ---------- */
function getDetail(id) {
  const client = getById(id);
  if (!client) return null;
  const partyLinks = all(
    `SELECT p.*, d.numero, d.demandeur, d.defendeur, d.court, d.status AS dossier_status, d.type AS dossier_type
     FROM parties p JOIN dossiers d ON d.id = p.dossier_id
     WHERE p.client_id = ? ORDER BY d.id DESC`, [id]
  );
  const dossierIds = [...new Set(partyLinks.map((p) => p.dossier_id))];
  let procedures = [], payments = [];
  if (dossierIds.length) {
    const ph = dossierIds.map(() => '?').join(',');
    procedures = all(
      `SELECT pr.*, pt.name_ar AS type_name_ar, pt.name_fr AS type_name_fr
       FROM procedures pr
       LEFT JOIN procedure_types pt ON pt.id = pr.procedure_type_id
       WHERE pr.dossier_id IN (${ph}) ORDER BY pr.id DESC`, dossierIds
    );
    const procIds = procedures.map((p) => p.id);
    if (procIds.length) {
      const ph2 = procIds.map(() => '?').join(',');
      payments = all(
        `SELECT pay.*, pm.name_ar AS method_name_ar, pm.name_fr AS method_name_fr
         FROM payments pay
         LEFT JOIN payment_methods pm ON pm.id = pay.payment_method_id
         WHERE pay.procedure_id IN (${ph2}) ORDER BY pay.id DESC`, procIds
      );
    }
  }
  return { ...client, partyLinks, procedures, payments };
}

/* ---------- بحث شامل ---------- */
function searchAll(q, limit = 30) {
  const term = `%${(q || '').trim()}%`;
  if (!term || term === '%%') return [];
  return all(
    `SELECT * FROM clients
     WHERE name LIKE ? OR phone LIKE ? OR email LIKE ? OR type LIKE ?
     ORDER BY id DESC LIMIT ?`,
    [term, term, term, term, limit]
  );
}

function findByCin(cin) {
  if (!cin) return null;
  return get('SELECT * FROM clients WHERE id IN (SELECT client_id FROM parties WHERE cin = ? AND client_id IS NOT NULL LIMIT 1)', [cin]);
}

function count() {
  return get('SELECT COUNT(*) AS c FROM clients').c;
}

module.exports = { listAll, getById, save, remove, getDetail, searchAll, findByCin, count };
