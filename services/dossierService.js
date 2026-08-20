'use strict';

/* ================================================================
   DossierService — الملفات القضائية + الأطراف.
   نقطة مركزية تُستعمل من صفحة الملفات ومن وحدات الإجراءات.
   ================================================================ */

const { get, all, run, tx } = require('../db/database').helpers;
const audit = require('./audit');
const { getCurrentUser } = require('./auth');

/* ---------- ملفات ---------- */
function listAll() {
  return all('SELECT * FROM dossiers ORDER BY id DESC');
}

function getById(id) {
  return get('SELECT * FROM dossiers WHERE id = ?', [id]);
}

function save(dossier) {
  return tx(() => {
    let id = dossier.id || null;
    if (id) {
      run(
        `UPDATE dossiers SET numero = ?, demandeur = ?, defendeur = ?, court = ?, type = ?, status = ?, date = ?, notes = ? WHERE id = ?`,
        [dossier.numero, dossier.demandeur || '', dossier.defendeur || '', dossier.court || '',
         dossier.type || '', dossier.status || 'open', dossier.date || '', dossier.notes || '', id]
      );
      audit.log({ action: 'dossier.updated', entity: 'dossier', entityId: id, metadata: { numero: dossier.numero } });
    } else {
      const now = new Date().toISOString();
      id = run(
        `INSERT INTO dossiers (numero, demandeur, defendeur, court, type, status, date, notes, created_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [dossier.numero, dossier.demandeur || '', dossier.defendeur || '', dossier.court || '',
         dossier.type || '', dossier.status || 'open', dossier.date || '', dossier.notes || '', now]
      ).lastId;
      // أطراف تلقائية
      if (dossier.demandeur) {
        run(`INSERT INTO parties (dossier_id, role, name) VALUES (?, 'demandeur', ?)`, [id, dossier.demandeur]);
      }
      if (dossier.defendeur) {
        run(`INSERT INTO parties (dossier_id, role, name) VALUES (?, 'defendeur', ?)`, [id, dossier.defendeur]);
      }
      audit.log({ action: 'dossier.created', entity: 'dossier', entityId: id, metadata: { numero: dossier.numero } });
    }
    return getById(id);
  });
}

function remove(id) {
  const d = getById(id);
  run('DELETE FROM dossiers WHERE id = ?', [id]);
  audit.log({ action: 'dossier.deleted', entity: 'dossier', entityId: id, metadata: { numero: d ? d.numero : '' } });
  return true;
}

/* ---------- أطراف ---------- */
function listPartiesByDossier(dossierId) {
  return all(
    `SELECT p.*, c.name AS client_name, c.phone AS client_phone, c.email AS client_email
     FROM parties p LEFT JOIN clients c ON c.id = p.client_id
     WHERE p.dossier_id = ? ORDER BY p.id`, [dossierId]
  );
}

function getParty(id) {
  return get(
    `SELECT p.*, c.name AS client_name FROM parties p
     LEFT JOIN clients c ON c.id = p.client_id WHERE p.id = ?`, [id]
  );
}

function saveParty(party) {
  const id = party.id;
  if (id) {
    run(
      `UPDATE parties SET role = ?, name = ?, cin = ?, address = ?, phone = ?, email = ?, notes = ?, client_id = ?
       WHERE id = ?`,
      [party.role || '', party.name, party.cin || '', party.address || '', party.phone || '',
       party.email || '', party.notes || '', party.client_id || null, id]
    );
    audit.log({ action: 'party.updated', entity: 'party', entityId: id });
  } else {
    id = run(
      `INSERT INTO parties (dossier_id, role, name, cin, address, phone, email, notes, client_id)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [party.dossier_id, party.role || '', party.name, party.cin || '', party.address || '',
       party.phone || '', party.email || '', party.notes || '', party.client_id || null]
    ).lastId;
    audit.log({ action: 'party.created', entity: 'party', entityId: id });
  }
  return getParty(id);
}

function deleteParty(id) {
  const p = getParty(id);
  run('DELETE FROM parties WHERE id = ?', [id]);
  if (p) audit.log({ action: 'party.deleted', entity: 'party', entityId: id, metadata: { name: p.name, dossier_id: p.dossier_id } });
  return true;
}

function linkPartyToClient(partyId, clientId) {
  run('UPDATE parties SET client_id = ? WHERE id = ?', [clientId, partyId]);
  audit.log({ action: 'party.linked_client', entity: 'party', entityId: partyId, metadata: { clientId } });
  return getParty(partyId);
}

/* ---------- تفاصيل الملف ---------- */
function getDetail(id) {
  const dossier = getById(id);
  if (!dossier) return null;
  const parties = listPartiesByDossier(id);
  const procedures = all(
    `SELECT pr.*, pt.name_ar AS type_name_ar, pt.name_fr AS type_name_fr, ps.name_ar AS status_name_ar, ps.name_fr AS status_name_fr, ps.color AS status_color
     FROM procedures pr
     LEFT JOIN procedure_types pt ON pt.id = pr.procedure_type_id
     LEFT JOIN procedure_statuses ps ON ps.code = pr.status
     WHERE pr.dossier_id = ? ORDER BY pr.id DESC`, [id]
  );
  const procedureIds = procedures.map((p) => p.id);
  let pvList = [], payments = [];
  if (procedureIds.length) {
    const placeholders = procedureIds.map(() => '?').join(',');
    pvList = all(
      `SELECT pv.*, pvt.name_ar AS type_name_ar, pvt.name_fr AS type_name_fr
       FROM pvs pv LEFT JOIN pv_types pvt ON pvt.id = pv.pv_type_id
       WHERE pv.procedure_id IN (${placeholders}) ORDER BY pv.id DESC`, procedureIds
    );
    payments = all(
      `SELECT pay.*, pm.name_ar AS method_name_ar, pm.name_fr AS method_name_fr
       FROM payments pay
       LEFT JOIN payment_methods pm ON pm.id = pay.payment_method_id
       WHERE pay.procedure_id IN (${placeholders}) ORDER BY pay.id DESC`, procedureIds
    );
  }
  return { ...dossier, parties, procedures, pvs: pvList, payments };
}

/* ---------- بحث شامل ---------- */
function searchAll(q, limit = 30) {
  const term = `%${(q || '').trim()}%`;
  if (!term || term === '%%') return [];
  return all(
    `SELECT DISTINCT d.* FROM dossiers d
     LEFT JOIN parties p ON p.dossier_id = d.id
     WHERE d.numero LIKE ? OR d.demandeur LIKE ? OR d.defendeur LIKE ?
        OR p.name LIKE ? OR p.cin LIKE ? OR p.phone LIKE ?
     ORDER BY d.id DESC LIMIT ?`,
    [term, term, term, term, term, term, limit]
  );
}

function searchDossiers(q, limit = 25) {
  return searchAll(q, limit);
}

function count() {
  return get('SELECT COUNT(*) AS c FROM dossiers').c;
}

module.exports = { listAll, getById, save, remove, listPartiesByDossier, getParty, saveParty, deleteParty, linkPartyToClient, getDetail, searchAll, searchDossiers, count };
