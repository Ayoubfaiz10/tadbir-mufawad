'use strict';

/* ================================================================
   WorkflowService — محرك تدفق العمل
   يدير المراحل الثمانية لكل إجراء:
   RECEPTION → TYPE_SELECTION → EXECUTION → DOCUMENTATION → FINALIZATION → BILLING → REGISTER → ARCHIVE
   ================================================================ */

const { get, all, run, tx } = require('../db/database').helpers;
const audit = require('./audit');
const { getCurrentUser, requireAuth } = require('./auth');

const STAGE_ORDER = ['RECEPTION', 'TYPE_SELECTION', 'EXECUTION', 'DOCUMENTATION', 'FINALIZATION', 'BILLING', 'REGISTER', 'ARCHIVE'];

/* ---------- جلب مراحل نوع الإجراء ---------- */
function getStagesForType(procedureTypeId) {
  return all(
    `SELECT * FROM workflow_stages WHERE procedure_type_id = ? AND active = 1 ORDER BY sort_order`,
    [procedureTypeId]
  );
}

/* ---------- جلب تقدم إجراء معين ---------- */
function getProcedureProgress(procedureId) {
  const progress = all(
    `SELECT pp.*, ws.name_ar, ws.name_fr, ws.description_ar, ws.description_fr, ws.sort_order, ws.required_artifacts, ws.auto_actions
     FROM procedure_progress pp
     JOIN workflow_stages ws ON ws.code = pp.stage_code AND ws.procedure_type_id = (SELECT procedure_type_id FROM procedures WHERE id = pp.procedure_id)
     WHERE pp.procedure_id = ?
     ORDER BY ws.sort_order`,
    [procedureId]
  );
  return progress;
}

/* ---------- جلب حالة ال workflow الكاملة لإجراء ---------- */
function getWorkflowStatus(procedureId) {
  const proc = get('SELECT id, procedure_type_id, current_stage, status, workflow_completed_at FROM procedures WHERE id = ?', [procedureId]);
  if (!proc) throw new Error('NOT_FOUND:procedure:' + procedureId);

  const stages = getStagesForType(proc.procedure_type_id);
  const progress = getProcedureProgress(procedureId);
  const progressMap = {};
  progress.forEach((p) => { progressMap[p.stage_code] = p; });

  const currentIndex = STAGE_ORDER.indexOf(proc.current_stage);
  const completedCount = progress.filter((p) => p.status === 'completed').length;

  return {
    procedure_id: procedureId,
    current_stage: proc.current_stage,
    current_stage_index: currentIndex,
    procedure_status: proc.status,
    workflow_completed: !!proc.workflow_completed_at,
    total_stages: stages.length,
    completed_stages: completedCount,
    percentage: stages.length > 0 ? Math.round((completedCount / stages.length) * 100) : 0,
    stages: stages.map((s) => {
      const p = progressMap[s.code] || {};
      return {
        code: s.code,
        name_ar: s.name_ar,
        name_fr: s.name_fr,
        description_ar: s.description_ar,
        description_fr: s.description_fr,
        sort_order: s.sort_order,
        required_artifacts: JSON.parse(s.required_artifacts || '[]'),
        auto_actions: JSON.parse(s.auto_actions || '[]'),
        status: p.status || (s.sort_order <= currentIndex ? 'available' : 'locked'),
        completed: p.status === 'completed',
        completed_at: p.completed_at || null,
        completed_by: p.completed_by || '',
        notes: p.notes || '',
        artifacts: JSON.parse(p.artifacts || '[]')
      };
    })
  };
}

/* ---------- تهيئة تقدم إجراء جديد ---------- */
function initializeProgress(procedureId) {
  const proc = get('SELECT procedure_type_id FROM procedures WHERE id = ?', [procedureId]);
  if (!proc) throw new Error('NOT_FOUND:procedure:' + procedureId);

  const stages = getStagesForType(proc.procedure_type_id);
  const existing = all('SELECT stage_code FROM procedure_progress WHERE procedure_id = ?', [procedureId]);
  const existingCodes = new Set(existing.map((e) => e.stage_code));

  stages.forEach((s, i) => {
    if (!existingCodes.has(s.code)) {
      const initialStatus = i === 0 ? 'completed' : 'pending';
      const completedAt = i === 0 ? new Date().toISOString() : null;
      const completedBy = i === 0 ? (getCurrentUser() ? getCurrentUser().username : 'system') : '';
      run(
        `INSERT INTO procedure_progress (procedure_id, stage_code, status, completed_at, completed_by, notes) VALUES (?,?,?,?,?,?)`,
        [procedureId, s.code, initialStatus, completedAt, completedBy, i === 0 ? 'إنشاء الإجراء' : '']
      );
    }
  });

  run("UPDATE procedures SET current_stage = 'RECEPTION' WHERE id = ? AND current_stage = 'RECEPTION'", [procedureId]);
}

/* ---------- إكمال مرحلة ---------- */
function completeStage(procedureId, stageCode, notes = '') {
  requireAuth('procedure.update');
  const proc = get('SELECT id, procedure_type_id, current_stage FROM procedures WHERE id = ?', [procedureId]);
  if (!proc) throw new Error('NOT_FOUND:procedure:' + procedureId);

  const stages = getStagesForType(proc.procedure_type_id);
  const stageIndex = STAGE_ORDER.indexOf(stageCode);
  const currentIndex = STAGE_ORDER.indexOf(proc.current_stage);

  if (stageIndex < 0) throw new Error('WORKFLOW:INVALID_STAGE:' + stageCode);

  const stageDef = stages.find((s) => s.code === stageCode);
  if (!stageDef) throw new Error('WORKFLOW:STAGE_NOT_CONFIGURED:' + stageCode);

  if (stageIndex > currentIndex + 1) {
    throw new Error('WORKFLOW:STAGE_NOT_AVAILABLE:' + stageCode + ' (current: ' + proc.current_stage + ')');
  }

  const user = getCurrentUser();
  const now = new Date().toISOString();

  tx(() => {
    const existing = get('SELECT * FROM procedure_progress WHERE procedure_id = ? AND stage_code = ?', [procedureId, stageCode]);
    if (existing && existing.status === 'completed') return;

    run(
      `INSERT INTO procedure_progress (procedure_id, stage_code, status, completed_at, completed_by, notes)
       VALUES (?,?,'completed',?,?,?)
       ON CONFLICT(procedure_id, stage_code) DO UPDATE SET status = 'completed', completed_at = excluded.completed_at, completed_by = excluded.completed_by, notes = excluded.notes`,
      [procedureId, stageCode, now, user.username, notes]
    );

    const nextIndex = stageIndex + 1;
    if (nextIndex < STAGE_ORDER.length) {
      run('UPDATE procedures SET current_stage = ?, updated_at = datetime(\'now\') WHERE id = ?', [STAGE_ORDER[nextIndex], procedureId]);
    }

    if (stageCode === 'ARCHIVE') {
      run('UPDATE procedures SET workflow_completed_at = datetime(\'now\'), updated_at = datetime(\'now\') WHERE id = ?', [procedureId]);
    }

    audit.log(procedureId, 'procedure', 'WORKFLOW_STAGE_COMPLETE', {
      oldValue: { stage: proc.current_stage },
      newValue: { stage: stageCode, completed_by: user.username }
    });
  });

  return getWorkflowStatus(procedureId);
}

/* ---------- التراجع عن مرحلة ---------- */
function revertStage(procedureId, stageCode, reason = '') {
  requireAuth('procedure.update');
  const proc = get('SELECT id, procedure_type_id, current_stage FROM procedures WHERE id = ?', [procedureId]);
  if (!proc) throw new Error('NOT_FOUND:procedure:' + procedureId);

  if (!reason || !String(reason).trim()) throw new Error('REGISTER:REASON_REQUIRED');

  const stageIndex = STAGE_ORDER.indexOf(stageCode);
  const currentIndex = STAGE_ORDER.indexOf(proc.current_stage);

  if (stageIndex >= currentIndex) {
    throw new Error('WORKFLOW:CANNOT_REVERT_CURRENT_OR_FUTURE');
  }

  const user = getCurrentUser();
  tx(() => {
    run(`UPDATE procedure_progress SET status = 'reverted', notes = ? WHERE procedure_id = ? AND stage_code = ?`,
      [reason + ' — تم التراجع في ' + new Date().toISOString(), procedureId, stageCode]);
    run('UPDATE procedures SET current_stage = ?, updated_at = datetime(\'now\') WHERE id = ?', [stageCode, procedureId]);
    audit.log(procedureId, 'procedure', 'WORKFLOW_STAGE_REVERT', {
      oldValue: { stage: proc.current_stage },
      newValue: { stage: stageCode, reason }
    });
  });

  return getWorkflowStatus(procedureId);
}

/* ---------- إحصائيات عامة ---------- */
function workflowStats() {
  const total = get('SELECT COUNT(*) AS c FROM procedures WHERE archived = 0');
  const byStage = all(
    `SELECT current_stage, COUNT(*) AS count FROM procedures WHERE archived = 0 GROUP BY current_stage`
  );
  const completed = get('SELECT COUNT(*) AS c FROM procedures WHERE workflow_completed_at IS NOT NULL AND archived = 0');
  const avgCompletion = get(
    `SELECT AVG(juliayday(workflow_completed_at) - juliayday(created_at)) AS avg_days
     FROM procedures WHERE workflow_completed_at IS NOT NULL AND archived = 0`
  );

  return {
    total: total.c,
    completed: completed.c,
    avg_days: avgCompletion.avg_days ? Math.round(avgCompletion.avg_days * 10) / 10 : 0,
    by_stage: {}
  };
}

module.exports = {
  STAGE_ORDER,
  getStagesForType,
  getProcedureProgress,
  getWorkflowStatus,
  initializeProgress,
  completeStage,
  revertStage,
  workflowStats
};
