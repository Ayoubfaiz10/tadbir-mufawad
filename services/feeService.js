'use strict';

/* ================================================================
   FeeService — التعريفات/الرسوم + قواعد الربط + تقييم الأتعاب.
   لا أتعاب مكتوبة في الكود: كل المبالغ من fee_tariffs القابل للتهيئة.
   التقييم يدوي مع اقتراح تلقائي من القواعد المرتبطة.
   ================================================================ */

const { get, all, run, tx } = require('../db/database').helpers;
const audit = require('./audit');
const { getCurrentUser, requireAuth } = require('./auth');

/* ================================================================
   التعريفات (fee_tariffs)
   ================================================================ */

function listTariffs({ status, activeOnly = true } = {}) {
  let sql = 'SELECT * FROM fee_tariffs';
  const where = [];
  const params = [];
  if (activeOnly) where.push('active = 1');
  if (status) where.push('status = ?'), params.push(status);
  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += ' ORDER BY sort_order, id';
  return all(sql, params);
}

function getTariff(id) {
  return get('SELECT * FROM fee_tariffs WHERE id = ?', [id]);
}

function addTariff(input) {
  requireAuth('tariff.manage');
  if (!input.code || !input.nameAr || !input.nameFr) {
    throw new Error('VALIDATION:tariff:missingRequired');
  }
  const existing = get('SELECT id FROM fee_tariffs WHERE code = ?', [input.code]);
  if (existing) throw new Error('VALIDATION:tariff:codeExists:' + input.code);

  const res = run(
    `INSERT INTO fee_tariffs (code, name_ar, name_fr, description_ar, description_fr,
      default_amount, currency, status, valid_from, valid_to, active, sort_order)
     VALUES (?,?,?,?,?,?,?,?,?,?,1,(SELECT COALESCE(MAX(sort_order),0)+1 FROM fee_tariffs))`,
    [input.code, input.nameAr, input.nameFr,
     input.descriptionAr || '', input.descriptionFr || '',
     Number(input.defaultAmount) || 0, input.currency || 'MAD',
     input.status || 'ACTIVE', input.validFrom || null, input.validTo || null]
  );
  audit.log({ action: 'tariff.created', entity: 'tariff', entityId: res.lastId, metadata: { code: input.code } });
  return getTariff(res.lastId);
}

function updateTariff(id, input) {
  requireAuth('tariff.manage');
  const existing = getTariff(id);
  if (!existing) throw new Error('NOT_FOUND:tariff:' + id);

  const fields = ['name_ar', 'name_fr', 'description_ar', 'description_fr',
                  'default_amount', 'currency', 'status', 'valid_from', 'valid_to', 'active', 'sort_order'];
  const dbCols = ['name_ar', 'name_fr', 'description_ar', 'description_fr',
                  'default_amount', 'currency', 'status', 'valid_from', 'valid_to', 'active', 'sort_order'];
  const inputKeys = ['nameAr', 'nameFr', 'descriptionAr', 'descriptionFr',
                     'defaultAmount', 'currency', 'status', 'validFrom', 'validTo', 'active', 'sortOrder'];
  const sets = [];
  const params = [];

  inputKeys.forEach((k, i) => {
    if (input[k] !== undefined) {
      sets.push(dbCols[i] + ' = ?');
      params.push(input[k]);
    }
  });

  if (sets.length === 0) return existing;
  sets.push("updated_at = datetime('now')");
  params.push(id);

  run(`UPDATE fee_tariffs SET ${sets.join(', ')} WHERE id = ?`, params);
  audit.log({ action: 'tariff.updated', entity: 'tariff', entityId: id });
  return getTariff(id);
}

function deleteTariff(id) {
  requireAuth('tariff.manage');
  const existing = getTariff(id);
  if (!existing) throw new Error('NOT_FOUND:tariff:' + id);
  run('DELETE FROM fee_tariffs WHERE id = ?', [id]);
  audit.log({ action: 'tariff.deleted', entity: 'tariff', entityId: id, metadata: { code: existing.code } });
  return true;
}

function tariffStats() {
  const total = get('SELECT COUNT(*) AS c FROM fee_tariffs').c;
  const active = get('SELECT COUNT(*) AS c FROM fee_tariffs WHERE active = 1').c;
  const inactive = total - active;
  const byStatus = {};
  all('SELECT status, COUNT(*) AS c FROM fee_tariffs GROUP BY status').forEach((r) => {
    byStatus[r.status] = Number(r.c);
  });
  return { total, active, inactive, byStatus };
}

/* ================================================================
   قواعد التعريفة (fee_rules) — ربط التعريفات بأنواع الإجراءات
   ================================================================ */

function listRules() {
  return all(
    `SELECT r.*, t.code AS tariff_code, t.name_ar AS tariff_name_ar, t.name_fr AS tariff_name_fr,
            t.default_amount, t.currency,
            pt.code AS type_code, pt.name_ar AS type_name_ar, pt.name_fr AS type_name_fr
     FROM fee_rules r
     JOIN fee_tariffs t ON t.id = r.tariff_id
     LEFT JOIN procedure_types pt ON pt.id = r.procedure_type_id
     WHERE r.active = 1
     ORDER BY r.id`
  );
}

function getRule(id) {
  return get('SELECT * FROM fee_rules WHERE id = ?', [id]);
}

function addRule(input) {
  requireAuth('tariff.manage');
  if (!input.tariffId) throw new Error('VALIDATION:rule:tariffRequired');
  const tariff = getTariff(input.tariffId);
  if (!tariff) throw new Error('NOT_FOUND:tariff:' + input.tariffId);

  const res = run(
    `INSERT INTO fee_rules (tariff_id, procedure_type_id, override_amount, active, notes)
     VALUES (?,?,?,1,?)`,
    [input.tariffId, input.procedureTypeId || null,
     input.overrideAmount != null ? Number(input.overrideAmount) : null,
     input.notes || '']
  );
  audit.log({ action: 'rule.created', entity: 'fee_rule', entityId: res.lastId, metadata: { tariff_id: input.tariffId, type_id: input.procedureTypeId } });
  return getRule(res.lastId);
}

function deleteRule(id) {
  requireAuth('tariff.manage');
  const rule = getRule(id);
  if (!rule) throw new Error('NOT_FOUND:rule:' + id);
  run('DELETE FROM fee_rules WHERE id = ?', [id]);
  audit.log({ action: 'rule.deleted', entity: 'fee_rule', entityId: id });
  return true;
}

function suggestFees(procedureTypeId) {
  let sql = `SELECT r.*, t.code AS tariff_code, t.name_ar, t.name_fr, t.default_amount, t.currency
             FROM fee_rules r
             JOIN fee_tariffs t ON t.id = r.tariff_id AND t.active = 1 AND t.status = 'ACTIVE'
             WHERE r.active = 1 AND (r.procedure_type_id = ? OR r.procedure_type_id IS NULL)
             ORDER BY r.procedure_type_id DESC, r.id`;
  const rules = all(sql, [procedureTypeId]);
  return rules.map((r) => ({
    tariffId: r.tariff_id,
    code: r.tariff_code,
    nameAr: r.name_ar,
    nameFr: r.name_fr,
    amount: r.override_amount != null ? r.override_amount : r.default_amount,
    currency: r.currency || 'MAD'
  }));
}

/* ================================================================
   تقييم الأتعاب (fee_assessments + items)
   ================================================================ */

function createAssessment(procedureId, input) {
  const proc = get('SELECT id FROM procedures WHERE id = ?', [procedureId]);
  if (!proc) throw new Error('NOT_FOUND:procedure:' + procedureId);

  return tx(() => {
    const user = getCurrentUser();
    const res = run(
      `INSERT INTO fee_assessments (procedure_id, total_amount, currency, status, notes, assessed_by, assessed_at, created_by)
       VALUES (?,?,?,?,?,?,datetime('now'),?)`,
      [procedureId, 0, input.currency || 'MAD', 'DRAFT',
       input.notes || '', user.username, user.username]
    );
    const assessmentId = res.lastId;

    (input.items || []).forEach((item) => {
      addAssessmentItem(assessmentId, item);
    });

    recalcAssessmentTotal(assessmentId);
    audit.log({ action: 'assessment.created', entity: 'procedure', entityId: procedureId, metadata: { assessment_id: assessmentId } });
    return getAssessment(assessmentId);
  });
}

function addAssessmentItem(assessmentId, input) {
  const assessment = get('SELECT * FROM fee_assessments WHERE id = ?', [assessmentId]);
  if (!assessment) throw new Error('NOT_FOUND:assessment:' + assessmentId);
  if (assessment.status !== 'DRAFT') throw new Error('VALIDATION:assessment:notDraft');

  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount < 0) throw new Error('VALIDATION:item:amount');

  let descriptionAr = input.descriptionAr || '';
  let descriptionFr = input.descriptionFr || '';
  let currency = 'MAD';

  if (input.tariffId) {
    const tariff = getTariff(input.tariffId);
    if (!tariff) throw new Error('NOT_FOUND:tariff:' + input.tariffId);
    if (!descriptionAr) descriptionAr = tariff.name_ar;
    if (!descriptionFr) descriptionFr = tariff.name_fr;
    currency = tariff.currency || currency;
  }

  const res = run(
    `INSERT INTO fee_assessment_items (assessment_id, tariff_id, description_ar, description_fr, amount, quantity, notes)
     VALUES (?,?,?,?,?,?,?)`,
    [assessmentId, input.tariffId || null, descriptionAr, descriptionFr,
     amount, Number(input.quantity) || 1, input.notes || '']
  );

  recalcAssessmentTotal(assessmentId);
  return { id: res.lastId };
}

function removeAssessmentItem(itemId) {
  const item = get('SELECT * FROM fee_assessment_items WHERE id = ?', [itemId]);
  if (!item) throw new Error('NOT_FOUND:item:' + itemId);
  const assessment = get('SELECT * FROM fee_assessments WHERE id = ?', [item.assessment_id]);
  if (assessment.status !== 'DRAFT') throw new Error('VALIDATION:assessment:notDraft');
  run('DELETE FROM fee_assessment_items WHERE id = ?', [itemId]);
  recalcAssessmentTotal(item.assessment_id);
  return true;
}

function recalcAssessmentTotal(assessmentId) {
  const total = get(
    'SELECT COALESCE(SUM(amount * quantity), 0) AS total FROM fee_assessment_items WHERE assessment_id = ?',
    [assessmentId]
  ).total;
  run("UPDATE fee_assessments SET total_amount = ?, updated_at = datetime('now') WHERE id = ?", [total, assessmentId]);
}

function getAssessment(id) {
  const a = get('SELECT * FROM fee_assessments WHERE id = ?', [id]);
  if (!a) throw new Error('NOT_FOUND:assessment:' + id);
  a.items = all(
    `SELECT i.*, t.code AS tariff_code, t.name_ar AS tariff_name_ar, t.name_fr AS tariff_name_fr
     FROM fee_assessment_items i
     LEFT JOIN fee_tariffs t ON t.id = i.tariff_id
     WHERE i.assessment_id = ? ORDER BY i.id`,
    [id]
  );
  return a;
}

function listAssessments({ procedureId, status, page = 1, pageSize = 25 } = {}) {
  const where = [];
  const params = [];
  if (procedureId) where.push('a.procedure_id = ?'), params.push(Number(procedureId));
  if (status) where.push('a.status = ?'), params.push(status);
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = get(`SELECT COUNT(*) AS c FROM fee_assessments a ${whereSql}`, params).c;
  const pageNum = Math.max(1, Number(page) || 1);
  const size = Math.min(100, Number(pageSize) || 25);
  const offset = (pageNum - 1) * size;
  const rows = all(
    `SELECT a.*, p.procedure_number
     FROM fee_assessments a
     LEFT JOIN procedures p ON p.id = a.procedure_id
     ${whereSql}
     ORDER BY a.id DESC LIMIT ? OFFSET ?`,
    [...params, size, offset]
  );
  return { rows, total, page: pageNum, pageSize: size };
}

function confirmAssessment(id) {
  requireAuth('payment.confirm');
  const a = get('SELECT * FROM fee_assessments WHERE id = ?', [id]);
  if (!a) throw new Error('NOT_FOUND:assessment:' + id);
  if (a.status !== 'DRAFT') throw new Error('VALIDATION:assessment:notDraft');
  if (a.total_amount <= 0) throw new Error('VALIDATION:assessment:emptyAmount');

  const user = getCurrentUser();
  run(
    "UPDATE fee_assessments SET status = 'CONFIRMED', confirmed_by = ?, confirmed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
    [user.username, id]
  );
  audit.log({ action: 'assessment.confirmed', entity: 'procedure', entityId: a.procedure_id, metadata: { assessment_id: id, total: a.total_amount } });
  return getAssessment(id);
}

function cancelAssessment(id, reason) {
  requireAuth('payment.cancel');
  const a = get('SELECT * FROM fee_assessments WHERE id = ?', [id]);
  if (!a) throw new Error('NOT_FOUND:assessment:' + id);
  if (a.status === 'CANCELLED') throw new Error('VALIDATION:assessment:alreadyCancelled');
  if (a.status === 'PAID') throw new Error('VALIDATION:assessment:cannotCancelPaid');

  run(
    "UPDATE fee_assessments SET status = 'CANCELLED', notes = ?, updated_at = datetime('now') WHERE id = ?",
    [reason || 'إلغاء', id]
  );
  audit.log({ action: 'assessment.cancelled', entity: 'procedure', entityId: a.procedure_id, metadata: { assessment_id: id, reason } });
  return getAssessment(id);
}

function assessmentStats() {
  const total = get('SELECT COUNT(*) AS c FROM fee_assessments').c;
  const byStatus = {};
  all('SELECT status, COUNT(*) AS c FROM fee_assessments GROUP BY status').forEach((r) => {
    byStatus[r.status] = Number(r.c);
  });
  const totalAmount = get("SELECT COALESCE(SUM(total_amount), 0) AS t FROM fee_assessments WHERE status IN ('CONFIRMED','PARTIALLY_PAID','PAID')").t;
  return { total, byStatus, totalAmount };
}

module.exports = {
  listTariffs, getTariff, addTariff, updateTariff, deleteTariff, tariffStats,
  listRules, getRule, addRule, deleteRule,
  suggestFees,
  createAssessment, addAssessmentItem, removeAssessmentItem, getAssessment,
  listAssessments, confirmAssessment, cancelAssessment, assessmentStats
};
