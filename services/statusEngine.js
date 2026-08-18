'use strict';

/* ================================================================
   StatusEngine — يتحكم في تغييرات الحالة عبر انتقالات مسموحة فقط
   ويسجل كل تغيير في history + audit.
   ================================================================ */

const { get, all, run } = require('../db/database').helpers;
const audit = require('./audit');
const { getCurrentUser } = require('./auth');

function allowedTransitions(fromStatus) {
  return all(
    'SELECT to_status FROM procedure_status_transitions WHERE from_status = ?',
    [fromStatus]
  ).map((r) => r.to_status);
}

function canTransition(fromStatus, toStatus) {
  if (fromStatus === toStatus) return false;
  return allowedTransitions(fromStatus).includes(toStatus);
}

function currentStatus(procedureId) {
  const p = get('SELECT status FROM procedures WHERE id = ?', [procedureId]);
  const s = p ? get('SELECT * FROM procedure_statuses WHERE code = ?', [p.status]) : null;
  return s;
}

function recordTransition(procedureId, fromStatus, toStatus, note = '') {
  const user = getCurrentUser();
  run(
    `INSERT INTO procedure_status_history (procedure_id, from_status, to_status, by_user, note)
     VALUES (?,?,?,?,?)`,
    [procedureId, fromStatus, toStatus, user.username, note]
  );
  audit.log({
    action: 'procedure.status_changed',
    entity: 'procedure',
    entityId: procedureId,
    metadata: { from: fromStatus, to: toStatus, note }
  });
}

function applyStatus(procedureId, toStatus, note = '') {
  const proc = get('SELECT status FROM procedures WHERE id = ?', [procedureId]);
  if (!proc) throw new Error('NOT_FOUND:procedure:' + procedureId);
  const from = proc.status;

  if (!canTransition(from, toStatus)) {
    throw new Error(`VALIDATION:status:notAllowed:${from}->${toStatus}`);
  }

  const now = new Date().toISOString();
  run('UPDATE procedures SET status = ?, updated_at = ? WHERE id = ?', [toStatus, now, procedureId]);
  recordTransition(procedureId, from, toStatus, note);

  // عند الإكمال تسجيل تاريخ الإكمال
  if (toStatus === 'COMPLETED') {
    run('UPDATE procedures SET completed_at = COALESCE(completed_at, ?) WHERE id = ?', [now, procedureId]);
  }
  if (toStatus === 'IN_PROGRESS') {
    run('UPDATE procedures SET started_at = COALESCE(started_at, ?) WHERE id = ?', [now, procedureId]);
  }
  return get('SELECT * FROM procedures WHERE id = ?', [procedureId]);
}

function history(procedureId) {
  return all(
    `SELECT * FROM procedure_status_history WHERE procedure_id = ? ORDER BY id DESC`,
    [procedureId]
  );
}

module.exports = { allowedTransitions, canTransition, currentStatus, applyStatus, recordTransition, history, getStatus: (c) => get('SELECT * FROM procedure_statuses WHERE code = ?', [c]) };
