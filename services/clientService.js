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

function count() {
  return get('SELECT COUNT(*) AS c FROM clients').c;
}

module.exports = { listAll, getById, save, remove, count };
