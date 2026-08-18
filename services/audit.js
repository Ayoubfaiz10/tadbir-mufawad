'use strict';

/* ================================================================
   Audit — تسجيل جميع العمليات الحساسة.
   ================================================================ */

const { run, all, get } = require('../db/database').helpers;
const { getCurrentUser } = require('./auth');

function log({ action, entity, entityId = 0, metadata = {}, user = null }) {
  let actor = user || getCurrentUser().username;
  if (actor && typeof actor === 'object') actor = actor.username || 'system';
  run(
    'INSERT INTO audit_logs (action, entity, entity_id, by_user, metadata) VALUES (?,?,?,?,?)',
    [action, entity, entityId || 0, actor, JSON.stringify(metadata)]
  );
  return true;
}

function listForEntity(entity, entityId, limit = 100) {
  return all(
    `SELECT * FROM audit_logs
     WHERE entity = ? AND entity_id = ?
     ORDER BY id DESC LIMIT ?`,
    [entity, entityId, limit]
  );
}

function listRecent(limit = 20) {
  return all('SELECT * FROM audit_logs ORDER BY id DESC LIMIT ?', [limit]);
}

function listPaginated(entity, entityId, page = 1, pageSize = 50) {
  const offset = (page - 1) * pageSize;
  const rows = all(
    `SELECT * FROM audit_logs
     WHERE (? = '' OR entity = ?) AND (? = 0 OR entity_id = ?)
     ORDER BY id DESC LIMIT ? OFFSET ?`,
    [entity, entity, entityId, entityId, pageSize, offset]
  );
  const total = get(
    `SELECT COUNT(*) AS c FROM audit_logs
     WHERE (? = '' OR entity = ?) AND (? = 0 OR entity_id = ?)`,
    [entity, entity, entityId, entityId]
  ).c;
  return { rows, total, page, pageSize };
}

module.exports = { log, listForEntity, listRecent, listPaginated };
