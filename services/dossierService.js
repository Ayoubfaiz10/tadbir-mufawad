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
  return all('SELECT * FROM parties WHERE dossier_id = ? ORDER BY id', [dossierId]);
}

function getParty(id) {
  return get('SELECT * FROM parties WHERE id = ?', [id]);
}

function saveParty(party) {
  const id = party.id;
  if (id) {
    run(
      `UPDATE parties SET role = ?, name = ?, cin = ?, address = ?, phone = ?, email = ?, notes = ?
       WHERE id = ?`,
      [party.role || '', party.name, party.cin || '', party.address || '', party.phone || '',
       party.email || '', party.notes || '', id]
    );
    audit.log({ action: 'party.updated', entity: 'party', entityId: id });
  } else {
    id = run(
      `INSERT INTO parties (dossier_id, role, name, cin, address, phone, email, notes)
       VALUES (?,?,?,?,?,?,?,?)`,
      [party.dossier_id, party.role || '', party.name, party.cin || '', party.address || '',
       party.phone || '', party.email || '', party.notes || '']
    ).lastId;
    audit.log({ action: 'party.created', entity: 'party', entityId: id });
  }
  return getParty(id);
}

/* ---------- البحث في الملفات (للسلوك 8 و 11) ---------- */
function searchDossiers(q, limit = 25) {
  const term = `%${(q || '').trim()}%`;
  if (!term || term === '%%') return [];
  return all(
    `SELECT DISTINCT d.* FROM dossiers d
     LEFT JOIN parties p ON p.dossier_id = d.id
     WHERE d.numero LIKE ? OR d.demandeur LIKE ? OR d.defendeur LIKE ? OR p.name LIKE ? OR p.cin LIKE ?
     ORDER BY d.id DESC LIMIT ?`,
    [term, term, term, term, term, limit]
  );
}

function count() {
  return get('SELECT COUNT(*) AS c FROM dossiers').c;
}

module.exports = { listAll, getById, save, remove, listPartiesByDossier, getParty, saveParty, searchDossiers, count };
