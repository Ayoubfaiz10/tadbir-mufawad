'use strict';

/* ================================================================
   ProcedureService — الكيان المحوري للإجراءات.
   يضم: التوليد، القوائم المفهرسة، الفلاتر، البحث، الإحصائيات،
   التفاصيل، القيم الديناميكية، سجل الحالة.
   ================================================================ */

const { get, all, run, tx, nextSequence } = require('../db/database').helpers;
const audit = require('./audit');
const dossierService = require('./dossierService');
const configService = require('./configService');
const statusEngine = require('./statusEngine');
const registersService = require('./registersService');
const { getCurrentUser, requireAuth } = require('./auth');

/* ---------- توليد رقم إجراء فريد ---------- */
function generateProcedureNumber() {
  const year = new Date().getFullYear();
  const seq = nextSequence('procedure:' + year);
  return `PR-${year}-${String(seq).padStart(4, '0')}`;
}

/* ---------- التحقق ---------- */
function validatePayload(input) {
  const errors = [];

  if (!input.dossier_id) {
    errors.push('dossier:required');
  } else if (!dossierService.getById(input.dossier_id)) {
    errors.push('dossier:notFound');
  }

  let type = null;
  if (!input.procedure_type_id) {
    errors.push('procedureType:required');
  } else {
    type = configService.getType(input.procedure_type_id);
    if (!type) errors.push('procedureType:notFound');
  }

  // التاريخ الصحيح
  if (input.notes && typeof input.notes !== 'string') errors.push('notes:invalid');

  // المبالغ أرقام غير سالبة
  if (input.amount !== undefined && input.amount !== null && input.amount !== '') {
    const a = Number(input.amount);
    if (!Number.isFinite(a) || a < 0) errors.push('amount:invalid');
  }

  // المتطلبات الأساسية
  if (!input.status) errors.push('status:required');

  return { errors, type };
}

/* ---------- إنشاء إجراء ---------- */
function createProcedure(input, actorUser) {
  const { errors, type } = validatePayload(input);
  if (errors.length) {
    throw new Error('VALIDATION:' + errors.join(','));
  }
  const user = actorUser || getCurrentUser();

  return tx(() => {
    const now = new Date().toISOString();
    const number = generateProcedureNumber();
    const status = input.status || 'NEW';
    const res = run(
      `INSERT INTO procedures
        (procedure_number, dossier_id, category_id, procedure_type_id, status, requested_by,
         amount, currency, created_at, updated_at, created_by, assigned_to, notes)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [number, input.dossier_id, type.category_id, type.id, status,
       input.requested_by || '', input.amount ? Number(input.amount) : 0, input.currency || 'MAD',
       now, now, user.username, input.assigned_to || '', input.notes || '']
    );
    const procedureId = res.lastId;

    // الحالة الأولية تُسجل دائماً
    statusEngine.recordTransition(procedureId, '', status, 'إنشاء الإجراء');

    // ربط الأطراف
    (input.party_ids || []).forEach((pid) => { linkParty(procedureId, pid, 'general'); });

    // القيم الديناميكية
    const fields = configService.listFieldsForType(type.id);
    Object.entries(input.field_values || {}).forEach(([key, v]) => {
      const f = fields.find((x) => x.field_key === key);
      if (f) {
        run(
          'INSERT INTO procedure_field_values (procedure_id, field_id, value) VALUES (?,?,?)',
          [procedureId, f.id, String(v == null ? '' : v)]
        );
      }
    });

    audit.log({
      action: 'procedure.created',
      entity: 'procedure',
      entityId: procedureId,
      metadata: { number, dossier_id: input.dossier_id, type_id: type.id },
      user
    });

    // تهيئة تدفق العمل (Workflow)
    try {
      const workflowService = require('./workflowService');
      workflowService.initializeProgress(procedureId);
    } catch (e) { /* تجاهل إذا لم يكن جدول workflow متاحاً */ }

    // السجل المهني اليومي: ربط تلقائي (قابل للإلغاء من إعدادات السجلات)
    registersService.autoCreateDailyForProcedure(procedureId);

    return getDetail(procedureId);
  });
}

/* ---------- ربط طرف ---------- */
function linkParty(procedureId, partyId, role) {
  run('INSERT OR IGNORE INTO procedure_parties (procedure_id, party_id, role) VALUES (?,?,?)', [procedureId, partyId, role]);
}

/* ---------- قائمة مع فلاتر وبحث مفهرس وصفحات ---------- */
function list({ page = 1, pageSize = 25, q = '', category, typeId, status, dateRange, assignedTo, userId }) {
  const where = [];
  const params = [];

  if (q && String(q).trim()) {
    const term = `%${String(q).trim()}%`;
    where.push(`(
      p.procedure_number LIKE ? OR p.requested_by LIKE ? OR
      p.notes LIKE ? OR d.numero LIKE ? OR d.demandeur LIKE ? OR d.defendeur LIKE ? OR
      EXISTS (SELECT 1 FROM procedure_parties pp
              JOIN parties pa ON pa.id = pp.party_id
              WHERE pp.procedure_id = p.id
              AND (pa.name LIKE ? OR pa.cin LIKE ?))
    )`);
    params.push(term, term, term, term, term, term, term, term);
  }

  if (category) where.push('p.category_id = ?'), params.push(Number(category));
  if (typeId) where.push('p.procedure_type_id = ?'), params.push(Number(typeId));
  if (status) where.push('p.status = ?'), params.push(status);

  if (dateRange) {
    const now = new Date();
    let start = null;
    let end = null;
    const today = () => toSqlDate(now);
    const daysAgo = (n) => {
      const d = new Date(now); d.setDate(d.getDate() - n); return toSqlDate(d);
    };
    if (dateRange === 'today') { start = today(); end = today(); }
    else if (dateRange === 'week') { start = daysAgo(6); end = today(); }
    else if (dateRange === 'month') { start = daysAgo(30); end = today(); }
    else if (dateRange && dateRange.from) { start = dateRange.from; end = dateRange.to || today(); }

    if (start && end) {
      where.push('date(p.created_at) >= date(?) AND date(p.created_at) <= date(?)');
      params.push(start, end);
    }
  }

  if (assignedTo) where.push('p.assigned_to = ?'), params.push(assignedTo);
  if (userId) where.push('p.created_by = ?'), params.push(userId);

  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const base = `FROM procedures p JOIN dossiers d ON d.id = p.dossier_id
                JOIN procedure_types t ON t.id = p.procedure_type_id
                JOIN procedure_categories c ON c.id = p.category_id ${whereSql}`;

  const total = get(`SELECT COUNT(*) AS c ${base}`, params).c;

  const pageNum = Math.max(1, Number(page) || 1);
  const size = Math.min(100, Number(pageSize) || 25);
  const offset = (pageNum - 1) * size;

  const rows = all(
    `SELECT p.*, d.numero AS dossier_number, d.demandeur AS dossier_demandeur,
            d.defendeur AS dossier_defendeur, c.code AS category_code,
            c.name_ar AS category_name_ar, c.name_fr AS category_name_fr,
            t.code AS type_code, t.name_ar AS type_name_ar, t.name_fr AS type_name_fr,
            (SELECT COALESCE(SUM(pay.amount),0) FROM payments pay WHERE pay.procedure_id = p.id) AS paid_amount,
            (SELECT COUNT(*) FROM procedure_parties pc WHERE pc.procedure_id = p.id) AS parties_count
     ${base} ORDER BY p.id DESC LIMIT ? OFFSET ?`,
    [...params, size, offset]
  );

  return { rows, total, page: pageNum, pageSize: size };
}

function toSqlDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/* ---------- إحصائيات حقيقية من قاعدة البيانات ---------- */
function stats() {
  const today = toSqlDate(new Date());
  const weekStart = toSqlDate(new Date(Date.now() - 6 * 86400000));

  const total = get('SELECT COUNT(*) AS c FROM procedures').c;
  const todayCount = get('SELECT COUNT(*) AS c FROM procedures WHERE date(created_at) = ?', [today]).c;
  const weekCount = get('SELECT COUNT(*) AS c FROM procedures WHERE date(created_at) >= ?', [weekStart]).c;
  const inProgress = get("SELECT COUNT(*) AS c FROM procedures WHERE status IN ('NEW','IN_PROGRESS')").c;
  const completed = get("SELECT COUNT(*) AS c FROM procedures WHERE status = 'COMPLETED'").c;
  const postponed = get("SELECT COUNT(*) AS c FROM procedures WHERE status = 'POSTPONED'").c;
  const cancelled = get("SELECT COUNT(*) AS c FROM procedures WHERE status = 'CANCELLED'").c;

  const byStatus = {};
  all('SELECT status, COUNT(*) AS c FROM procedures GROUP BY status').forEach((r) => {
    byStatus[r.status] = Number(r.c);
  });

  const byCategory = all(
    `SELECT c.code, c.name_ar, c.name_fr, COUNT(*) AS c
     FROM procedures p JOIN procedure_categories c ON c.id = p.category_id
     GROUP BY c.id`
  );

  return {
    total, today: todayCount, week: weekCount,
    inProgress, completed, postponed, cancelled,
    byStatus: Object(zipStatus(byStatus)), byCategory
  };
}

function zipStatus(map) {
  const out = {};
  ['NEW', 'IN_PROGRESS', 'COMPLETED', 'POSTPONED', 'CANCELLED'].forEach((k) => { out[k] = map[k] || 0; });
  return out;
}

/* ---------- تفاصيل إجراء كامل ---------- */
function getDetail(id) {
  const p = get('SELECT * FROM procedures WHERE id = ?', [id]);
  if (!p) throw new Error('NOT_FOUND:procedure:' + id);

  const type = configService.getType(p.procedure_type_id);
  const category = get('SELECT * FROM procedure_categories WHERE id = ?', [p.category_id]);

  const fieldValues = all(
    `SELECT pf.*, pfv.value FROM procedure_fields pf
     LEFT JOIN procedure_field_values pfv ON pfv.field_id = pf.id AND pfv.procedure_id = ?
     WHERE pf.procedure_type_id = ? ORDER BY pf.sort_order`,
    [id, p.procedure_type_id]
  );
  fieldValues.forEach((f) => {
    if (f.options && typeof f.options === 'string') {
      try { f.options = JSON.parse(f.options); } catch (e) { f.options = []; }
    }
  });

  const parties = all(
    `SELECT pa.*, pp.role AS link_role FROM procedure_parties pp
     JOIN parties pa ON pa.id = pp.party_id
     WHERE pp.procedure_id = ? ORDER BY pa.id`,
    [id]
  );

  const dossier = p.dossier_id ? dossierService.getById(p.dossier_id) : null;

  const documents = all(
    `SELECT doc.* FROM procedure_documents pd
     JOIN documents doc ON doc.id = pd.document_id
     WHERE pd.procedure_id = ? ORDER BY doc.id DESC`,
    [id]
  );

  const payments = all('SELECT * FROM payments WHERE procedure_id = ? ORDER BY id DESC', [id]);
  const receipts = all(
    `SELECT r.*, pay.amount, pay.method FROM receipts r
     JOIN payments pay ON pay.id = r.payment_id
     WHERE pay.procedure_id = ? ORDER BY r.id DESC`,
    [id]
  );

  const timeline = buildTimeline(id);

  return {
    ...p,
    fieldValues,
    parties,
    dossier,
    documents,
    payments,
    receipts,
    timeline,
    statusInfo: statusEngine.getStatus(p.status),
    type,
    category,
    transitions: statusEngine.allowedTransitions(p.status)
  };
}

function buildTimeline(procedureId) {
  const events = [];
  all(
    'SELECT * FROM procedure_status_history WHERE procedure_id = ? ORDER BY id',
    [procedureId]
  ).forEach((h) => {
    events.push({
      type: 'status',
      date: h.changed_at,
      text: h.to_status + ' (from ' + (h.from_status || '-') + ')',
      desc: h.note,
      user: h.by_user,
      status: h.to_status
    });
  });
  all(
    'SELECT * FROM audit_logs WHERE entity = ? AND entity_id = ? ORDER BY id',
    ['procedure', procedureId]
  ).forEach((a) => {
    events.push({
      type: 'audit',
      date: a.created_at,
      text: a.action,
      desc: a.metadata,
      user: a.by_user
    });
  });
  // حوادث فرعية (payment / document / receipt)
  all(
    'SELECT * FROM audit_logs WHERE entity = ? AND entity_id = ? ORDER BY id',
    ['payment', procedureId]
  ).forEach((a) => {
    events.push({ type: 'payment', date: a.created_at, text: a.action, user: a.by_user });
  });
  all(
    'SELECT * FROM audit_logs WHERE entity = ? AND entity_id = ? ORDER BY id',
    ['document', procedureId]
  ).forEach((a) => {
    events.push({ type: 'document', date: a.created_at, text: a.action, user: a.by_user });
  });
  events.sort((a, b) => new Date(a.date) - new Date(b.date));
  return events;
}

/* ---------- تعديل ---------- */
function updateProcedure(id, input) {
  const existing = get('SELECT * FROM procedures WHERE id = ?', [id]);
  if (!existing) throw new Error('NOT_FOUND:procedure:' + id);
  const { errors, type } = validatePayload({ ...existing, ...input });
  if (errors.length) throw new Error('VALIDATION:' + errors.join(','));

  return tx(() => {
    const now = new Date().toISOString();
    run(
      `UPDATE procedures SET dossier_id = ?, procedure_type_id = ?, amount = ?, currency = ?,
       requested_by = ?, assigned_to = ?, notes = ?, updated_at = ?
       WHERE id = ?`,
      [input.dossier_id || existing.dossier_id, type.id,
       input.amount !== undefined ? Number(input.amount) : existing.amount,
       input.currency || existing.currency,
       input.requested_by !== undefined ? input.requested_by : existing.requested_by,
       input.assigned_to !== undefined ? input.assigned_to : existing.assigned_to,
       input.notes !== undefined ? input.notes : existing.notes, now, id]
    );
    audit.log({ action: 'procedure.updated', entity: 'procedure', entityId: id });
    return getDetail(id);
  });
}

/* ---------- حذف (مقيد) ---------- */
function deleteProcedure(id) {
  requireAuth('procedure.delete');
  const p = get('SELECT procedure_number FROM procedures WHERE id = ?', [id]);
  run('DELETE FROM fee_assessment_items WHERE assessment_id IN (SELECT id FROM fee_assessments WHERE procedure_id = ?)', [id]);
  run('DELETE FROM fee_assessments WHERE procedure_id = ?', [id]);
  run('DELETE FROM procedures WHERE id = ?', [id]);
  audit.log({ action: 'procedure.deleted', entity: 'procedure', entityId: id, metadata: { number: p ? p.procedure_number : '' } });
  return true;
}

module.exports = {
  generateProcedureNumber, createProcedure, updateProcedure, deleteProcedure,
  list, stats, getDetail, linkParty,
  allowedTransitions: (id) => statusEngine.allowedTransitions(get('SELECT status FROM procedures WHERE id = ?', [id]).status),
  applyStatus: (id, to, note, user) => statusEngine.applyStatus(id, to, note, user),
  statusHistory: statusEngine.history
};
