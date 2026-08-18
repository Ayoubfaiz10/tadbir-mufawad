'use strict';

/* ================================================================
   RegistersService — السجلات المهنية (Professional Registers).
   وفق المادة 37 من القانون رقم 46.21:
     • سجل يومي للإجراءات     (DAILY_PROCEDURE)
     • سجل يومي للعمليات الحسابية (ACCOUNTING)
   النموذج الرسمي يحدَّد بنص تنظيمي لاحق (م.37) ➜ كل الحقول وصيغ
   الترقيم قابلة للتهيئة من طرف Admin ولا تُفترَض نماذج رسمية.

   المبادئ:
     • لا DELETE أبداً — الحذف مستحيل على مستوى قاعدة البيانات (Triggers).
     • الرقم التسلسلي والتاريخ والسجل لا يتغيران بعد الإنشاء (Triggers).
     • أي تصحيح = Correction موثقة (نسخة بديلة + الربط بالأصل + تدقيق).
     • كل عملية تُسجل في register_audit_logs (لا يعدله المستخدم العادي).
     • فترات قابلة للإغلاق (إدارية): OPEN → REVIEW → LOCKED.
   نقي: لا يعتمد على Electron (PDF يُبنى HTML هنا ويُطبع في ipc).
   ================================================================ */

const { get, all, run, tx, nextSequence } = require('../db/database').helpers;
const crypto = require('crypto');
const audit = require('./audit');
const { getCurrentUser, requireAuth } = require('./auth');
  const settingsService = require('./settingsService');
  const archiveService = require('./archiveService');

const DAILY = 'DAILY_PROCEDURE';
const ACCOUNTING = 'ACCOUNTING';
const DETAIL_TABLES = {
  [DAILY]: 'daily_procedure_register_entries',
  [ACCOUNTING]: 'accounting_register_entries'
};
const ACTIVE_STATUSES = ['ACTIVE', 'SUPERSEDED', 'CANCELLED'];
const PERIOD_TRANSITIONS = {
  OPEN: ['REVIEW'],
  REVIEW: ['LOCKED', 'OPEN'],
  LOCKED: ['REVIEW']
};

/* ---------- أدوات ---------- */
function toSqlDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function todaySql() { return toSqlDate(new Date()); }

function periodKeyOf(dateStr) {
  return String(dateStr || '').slice(0, 7); // YYYY-MM
}

function parseDateSafe(dateStr) {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr))) throw new Error('VALIDATION:register:invalidDate');
  const d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d.getTime())) throw new Error('VALIDATION:register:invalidDate');
  return d;
}

function safeVal(v, max = 2000) {
  return String(v == null ? '' : v).slice(0, max);
}

/* ---------- السجلات ---------- */
function listRegisters(activeOnly = true) {
  return all(
    `SELECT * FROM registers ${activeOnly ? 'WHERE active = 1' : ''} ORDER BY id`
  ).map((r) => {
    try { r.schema = JSON.parse(r.schema_json || '[]'); } catch (e) { r.schema = []; }
    return r;
  });
}

function getRegisterById(id) {
  return get('SELECT * FROM registers WHERE id = ?', [Number(id)]) || null;
}

function getRegister(code) {
  return get('SELECT * FROM registers WHERE code = ?', [String(code)]) || null;
}

/* ---------- الإعدادات العامة (meta) ---------- */
function getMetaBool(key, def = '1') {
  const row = get('SELECT value FROM meta WHERE key = ?', [key]);
  return row ? row.value === '1' : String(def) === '1';
}

function setMeta(key, val) {
  if (get('SELECT value FROM meta WHERE key = ?', [key])) {
    run('UPDATE meta SET value = ? WHERE key = ?', [String(val), String(key)]);
  } else {
    run('INSERT INTO meta (key, value) VALUES (?,?)', [String(key), String(val)]);
  }
}

function settings() {
  return {
    autoDaily: getMetaBool('registers.auto.daily'),
    autoAccounting: getMetaBool('registers.auto.accounting')
  };
}

function config() {
  return { registers: listRegisters(), settings: settings() };
}

/* ---------- تعديل تكوين السجل (Admin فقط — البنية القانونية غير قابلة
   للتغيير من طرف المستخدم العادي) ---------- */
function updateConfig(input) {
  requireAuth('register.config');
  const reg = getRegisterById(input.registerId);
  if (!reg) throw new Error('NOT_FOUND:register:' + input.registerId);

const pattern = input.numberingPattern !== undefined
    ? String(input.numberingPattern).slice(0, 120)
    : reg.numbering_pattern;
  const patternTokens = ['{year}', '{month}', '{day}', '{seq}', /\{seq:\d+\}/];
  if (!/^[\w\-/.:,،{} ]*$/.test(pattern) ||
      !patternTokens.some((p) => (typeof p === 'string' ? pattern.includes(p) : p.test(pattern)))) {
    throw new Error('VALIDATION:register:badPattern');
  }
  const freq = input.seqFrequency !== undefined ? String(input.seqFrequency) : reg.seq_frequency;
  if (!['year', 'month', 'day', 'continuous'].includes(freq)) throw new Error('VALIDATION:register:badFrequency');

  let schema = reg.schema_json;
  if (input.schemaJson !== undefined) {
    try {
      const arr = JSON.parse(String(input.schemaJson));
      if (!Array.isArray(arr)) throw new Error('not-array');
      schema = JSON.stringify(arr);
    } catch (e) {
      throw new Error('VALIDATION:register:badSchema');
    }
  }

  const user = getCurrentUser();
  const nv = (x) => (x === undefined ? null : x);
  tx(() => {
    run(
      `UPDATE registers SET
        numbering_pattern = ?, seq_frequency = ?,
        name_ar = COALESCE(?, name_ar), name_fr = COALESCE(?, name_fr),
        description_ar = COALESCE(?, description_ar), description_fr = COALESCE(?, description_fr),
        schema_json = ?, official_template_ref = ?, effective_from = COALESCE(?, effective_from),
        active = ?, updated_at = datetime('now')
       WHERE id = ?`,
      [pattern, freq, nv(input.nameAr), nv(input.nameFr), nv(input.descriptionAr), nv(input.descriptionFr),
       schema, String(input.officialTemplateRef || reg.official_template_ref), nv(input.effectiveFrom),
       input.active !== undefined ? (input.active ? 1 : 0) : reg.active, reg.id]
    );
    if (input.autoDaily !== undefined) setMeta('registers.auto.daily', input.autoDaily ? '1' : '0');
    if (input.autoAccounting !== undefined) setMeta('registers.auto.accounting', input.autoAccounting ? '1' : '0');
    logAudit(reg.id, 'CONFIGURE', {
      oldValue: { numbering_pattern: reg.numbering_pattern, seq_frequency: reg.seq_frequency },
      newValue: { numbering_pattern: pattern, seq_frequency: freq, schema, official_template_ref: input.officialTemplateRef || '' },
      reason: 'تعديل إعدادات السجل'
    });
  });
  return config();
}

/* تسجيل عمليات التصدير/الطباعة في التدقيق */
function auditExport(registerId, kind) {
  requireAuth('register.export');
  logAudit(registerId, 'EXPORT', { reason: 'تصدير/طباعة (' + String(kind) + ')' });
  return true;
}

/* ---------- الترقيم التسلسلي (قابل للتهيئة، ليس نموذجاً رسمياً) ---------- */
function buildSerial(register, entryDate) {
  const freq = register.seq_frequency || 'year';
  const d = parseDateSafe(entryDate);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  let bucket = 'all';
  if (freq === 'year') bucket = 'Y' + y;
  else if (freq === 'month') bucket = 'Y' + y + 'M' + m;
  else if (freq === 'day') bucket = 'Y' + y + 'M' + m + 'D' + day;
  const seq = nextSequence('regseq:' + register.id + ':' + bucket);
  const pattern = register.numbering_pattern || '{year}-{seq:000000}';
  let out = pattern
    .replace(/\{year\}/g, String(y))
    .replace(/\{month\}/g, m)
    .replace(/\{day\}/g, day)
    .replace(/\{seq:(\d+)\}/g, (_, n) => String(seq).padStart(n.length, '0'))
    .replace(/\{seq\}/g, String(seq));
  return out;
}

/* ---------- التدقيق الخاص بالسجلات ---------- */
function logAudit(registerId, action, opts = {}) {
  const user = getCurrentUser();
  run(
    `INSERT INTO register_audit_logs
      (register_id, entry_id, action, by_user, old_value, new_value, reason)
     VALUES (?,?,?,?,?,?,?)`,
    [Number(registerId), opts.entryId ? Number(opts.entryId) : null, String(action),
     user.username, JSON.stringify(opts.oldValue || {}), JSON.stringify(opts.newValue || {}),
     safeVal(opts.reason, 2000)]
  );
  audit.log({
    action: 'register.' + String(action).toLowerCase(),
    entity: 'register',
    entityId: Number(registerId),
    metadata: { entry_id: opts.entryId || 0, old_value: opts.oldValue || {}, new_value: opts.newValue || {}, reason: opts.reason || '' },
    user
  });
}

/* ---------- الفترات والإغلاق ---------- */
function _ensurePeriod(registerId, entryDate) {
  const pk = periodKeyOf(entryDate);
  run(
    `INSERT OR IGNORE INTO register_periods (register_id, period_key, status) VALUES (?,?, 'OPEN')`,
    [Number(registerId), pk]
  );
  return pk;
}

function _periodStatus(registerId, entryDate) {
  const pk = periodKeyOf(entryDate);
  const row = get(
    'SELECT status FROM register_periods WHERE register_id = ? AND period_key = ?',
    [Number(registerId), pk]
  );
  return row ? row.status : 'OPEN';
}

function _enforceNotLocked(registerId, entryDate) {
  const st = _periodStatus(registerId, entryDate);
  if (st === 'LOCKED') throw new Error(`VALIDATION:register:periodLocked:${periodKeyOf(entryDate)}`);
  return st;
}

function listPeriods(registerId) {
  return all(
    `SELECT p.*,
       (SELECT COUNT(*) FROM register_archives ra WHERE ra.register_id = p.register_id AND ra.period_key = p.period_key) AS archived_documents_count,
       s.id AS seal_id, s.sealed_at, s.sealed_by, s.doc_count AS seal_doc_count, s.sha256_manifest, s.manifest_json
     FROM register_periods p
     LEFT JOIN archive_seals s ON s.register_id = p.register_id AND s.period_key = p.period_key
     WHERE p.register_id = ? ORDER BY p.period_key DESC`,
    [Number(registerId)]
  );
}

function setPeriodStatus(registerId, periodKey, status, note = '') {
  requireAuth('register.lock');
  const reg = getRegisterById(registerId);
  if (!reg) throw new Error('NOT_FOUND:register:' + registerId);
  const pk = String(periodKey || '').slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(pk)) throw new Error('VALIDATION:register:invalidPeriod');
  _ensurePeriod(registerId, pk + '-01');

  const user = getCurrentUser();
  const row = get(
    'SELECT * FROM register_periods WHERE register_id = ? AND period_key = ?',
    [Number(registerId), pk]
  );
  const from = row.status;
  if (from === status) throw new Error('VALIDATION:register:periodSameStatus');
  if (!(PERIOD_TRANSITIONS[from] || []).includes(status)) {
    throw new Error(`VALIDATION:register:periodNotAllowed:${from}->${status}`);
  }
  if (status === 'LOCKED') {
    if (from !== 'REVIEW') throw new Error('VALIDATION:register:periodLockNeedsReview');
  }
  if (from === 'LOCKED' && status === 'REVIEW' && !String(note || '').trim()) {
    throw new Error('VALIDATION:register:unlockReasonRequired');
  }

  const sets = ['status = ?', "locked_at = CASE WHEN ? = 'LOCKED' THEN datetime('now') ELSE locked_at END",
    "locked_by = CASE WHEN ? = 'LOCKED' THEN ? ELSE locked_by END",
    "reviewed_at = CASE WHEN ? IN ('REVIEW','LOCKED') AND reviewed_at IS NULL THEN datetime('now') ELSE reviewed_at END",
    "reviewed_by = CASE WHEN ? IN ('REVIEW','LOCKED') THEN ? ELSE reviewed_by END",
    "review_note = CASE WHEN ? = 'REVIEW' THEN ? ELSE review_note END",
    "unlock_reason = CASE WHEN ? = 'REVIEW' AND ? IN ('LOCKED','REVIEW') THEN ? ELSE unlock_reason END"];
  run(`UPDATE register_periods SET ${sets.join(', ')} WHERE register_id = ? AND period_key = ?`,
    [status, status, status, user.username, status, status, user.username, status, safeVal(note, 2000),
     status, from === 'LOCKED' ? 'LOCKED' : status, safeVal(note, 2000), Number(registerId), pk]);

  logAudit(registerId, status === 'LOCKED' ? 'LOCK' : 'UNLOCK', {
    newValue: { period: pk, from, to: status }, reason: note
  });
  return get('SELECT * FROM register_periods WHERE register_id = ? AND period_key = ?', [Number(registerId), pk]);
}

/* ================================================================
   الإنشاء الداخلي (قلب الإدراج — يُستعمل تلقائياً أو يدوياً)
   ================================================================ */
function insertEntryCore({ register, entryDate, detailTable, detailRow, values = {}, reason = '' }) {
  const st = _enforceNotLocked(register.id, entryDate);
  _ensurePeriod(register.id, entryDate);
  const serial = buildSerial(register, entryDate);
  const user = getCurrentUser();
  const res = run(
    `INSERT INTO register_entries (register_id, serial_no, entry_date, status, reason, created_by)
     VALUES (?,?,?, 'ACTIVE', ?, ?)`,
    [register.id, serial, entryDate, safeVal(reason), user.username]
  );
  const entryId = res.lastId;

  if (detailTable && detailRow && Object.keys(detailRow).length) {
    const cols = Object.keys(detailRow);
    run(
      `INSERT INTO ${detailTable} (entry_id, ${cols.join(',')}) VALUES (?, ${cols.map(() => '?').join(',')})`,
      [entryId, ...cols.map((c) => detailRow[c])]
    );
  }
  Object.entries(values || {}).forEach(([k, v]) => {
    run('INSERT INTO register_entry_values (entry_id, field_key, value) VALUES (?,?,?)',
      [entryId, safeVal(k, 100), safeVal(v)]);
  });

  run("UPDATE registers SET updated_at = datetime('now') WHERE id = ?", [register.id]);
  logAudit(register.id, 'CREATE', {
    entryId,
    newValue: { serial, entry_date: entryDate, period_status: st },
    reason: reason || 'تسجيل'
  });
  return { entryId, serial };
}

/* ================================================================
   السجل اليومي للإجراءات
   ================================================================ */
function _findActiveDailyForProcedure(procedureId) {
  return get(
    `SELECT e.id AS entry_id, e.serial_no, e.status FROM register_entries e
     JOIN daily_procedure_register_entries d ON d.entry_id = e.id
     WHERE d.procedure_id = ? AND e.status = 'ACTIVE'`,
    [Number(procedureId)]
  );
}

function createDailyEntry({ procedureId, entryDate, referenceNumber, pvId, pvNumber, values, reason, procedureTypeId, dossierId, procedureNumberSnapshot, partiesSummary }) {
  procedureId = Number(procedureId);
  if (!procedureId) throw new Error('VALIDATION:register:procedureRequired');
  const reg = getRegister(DAILY);
  if (!reg) throw new Error('NOT_FOUND:register:' + DAILY);
  const entryDateSql = entryDate || todaySql();
  parseDateSafe(entryDateSql);

  const proc = get('SELECT * FROM procedures WHERE id = ?', [procedureId]);
  if (!proc) throw new Error('NOT_FOUND:procedure:' + procedureId);

  const existing = _findActiveDailyForProcedure(procedureId);
  if (existing) throw new Error(`VALIDATION:register:alreadyRecorded:${existing.serial_no}`);

  const entryDossierId = dossierId || proc.dossier_id || 0;
  const typeId = procedureTypeId || proc.procedure_type_id || 0;
  const partyNames = all(
    `SELECT pa.name FROM procedure_parties pp JOIN parties pa ON pa.id = pp.party_id
     WHERE pp.procedure_id = ? ORDER BY pp.id`,
    [procedureId]
  ).map((r) => r.name).filter(Boolean);
  let summary = safeVal(partiesSummary, 1000) || partyNames.slice(0, 3).join('، ');
  if (partyNames.length > 3) summary += ' …';
  if (!summary) {
    const dossier = entryDossierId ? get('SELECT demandeur, defendeur FROM dossiers WHERE id = ?', [entryDossierId]) : null;
    summary = safeVal([dossier && dossier.demandeur, dossier && dossier.defendeur].filter(Boolean).join(' — '), 1000);
  }

  return tx(() => insertEntryCore({
    register: reg,
    entryDate: entryDateSql,
    detailTable: DETAIL_TABLES[DAILY],
    detailRow: {
      procedure_id: procedureId,
      dossier_id: entryDossierId || null,
      procedure_type_id: typeId || null,
      pv_id: pvId ? Number(pvId) : null,
      procedure_number_snapshot: safeVal(procedureNumberSnapshot, 100) || proc.procedure_number || '',
      pv_number: safeVal(pvNumber, 100),
      reference_number: safeVal(referenceNumber, 300),
      parties_summary: summary
    },
    values,
    reason
  }));
}

/* إنشاء تلقائي عند إنشاء إجراء (قابل للإلغاء من الإعدادات) */
function autoCreateDailyForProcedure(procedureId) {
  if (!settings().autoDaily) return null;
  const proc = get('SELECT * FROM procedures WHERE id = ?', [procedureId]);
  if (!proc) return null;
  if (_findActiveDailyForProcedure(procedureId)) return null;
  if (_periodStatus(getRegister(DAILY) ? getRegister(DAILY).id : 0, todaySql()) === 'LOCKED') return null;

  const ref = (() => {
    const fv = get(
      `SELECT pfv.value FROM procedure_field_values pfv
       JOIN procedure_fields pf ON pf.id = pfv.field_id
       WHERE pfv.procedure_id = ? AND pf.field_key IN ('title_ref','act_to_notify','constat_object')
       ORDER BY pf.sort_order LIMIT 1`,
      [procedureId]
    );
    return fv ? fv.value : '';
  })();

  return createDailyEntry({
    procedureId,
    entryDate: todaySql(),
    referenceNumber: ref,
    procedureNumberSnapshot: proc.procedure_number
  });
}

/* ربط محضر مُنهى بإدخال السجل اليومي */
function linkPvToDaily(procedureId, pvId, pvNumber) {
  const row = _findActiveDailyForProcedure(procedureId);
  if (!row) return null;
  const oldRow = get('SELECT pv_id, pv_number FROM daily_procedure_register_entries WHERE entry_id = ?', [row.entry_id]);
  if (oldRow && oldRow.pv_id === Number(pvId)) return row;
  run(
    'UPDATE daily_procedure_register_entries SET pv_id = ?, pv_number = ? WHERE entry_id = ?',
    [Number(pvId), safeVal(pvNumber, 100), row.entry_id]
  );
  logAudit(getRegister(DAILY).id, 'UPDATE', {
    entryId: row.entry_id,
    oldValue: { pv_id: oldRow ? oldRow.pv_id : null, pv_number: oldRow ? oldRow.pv_number : '' },
    newValue: { pv_id: Number(pvId), pv_number: safeVal(pvNumber, 100) },
    reason: 'ربط المحضر بالإجراء'
  });
  return row;
}

/* ================================================================
   السجل الحسابي
   ================================================================ */
function _findActiveAccountingForPayment(paymentId, flowType) {
  return get(
    `SELECT e.id AS entry_id, e.serial_no FROM register_entries e
     JOIN accounting_register_entries a ON a.entry_id = e.id
     WHERE a.payment_id = ? AND a.flow_type = ? AND e.status = 'ACTIVE'`,
    [Number(paymentId), flowType]
  );
}

function createAccountingEntry({ paymentId, flowType = 'income', amount, currency, entryDate, receiptId, receiptNumber, reference, values, reason, procedureId, dossierId, amountText }) {
  paymentId = Number(paymentId);
  if (!paymentId) throw new Error('VALIDATION:register:paymentRequired');
  const reg = getRegister(ACCOUNTING);
  if (!reg) throw new Error('NOT_FOUND:register:' + ACCOUNTING);
  const entryDateSql = entryDate || todaySql();
  parseDateSafe(entryDateSql);

  const pay = get('SELECT * FROM payments WHERE id = ?', [paymentId]);
  if (!pay) throw new Error('NOT_FOUND:payment:' + paymentId);
  const flow = flowType === 'refund' ? 'refund' : 'income';
  const amt = Number(amount) || 0;

  if (flow === 'income' && _findActiveAccountingForPayment(paymentId, 'income')) {
    throw new Error('VALIDATION:register:paymentAlreadyRecorded');
  }

  const proc = procedureId ? get('SELECT * FROM procedures WHERE id = ?', [Number(procedureId)]) : null;
  const dos = dossierId || (proc && proc.dossier_id) || pay.procedure_id ? get('SELECT dossier_id FROM procedures WHERE id = ?', [pay.procedure_id]).dossier_id : 0;

  return tx(() => insertEntryCore({
    register: reg,
    entryDate: entryDateSql,
    detailTable: DETAIL_TABLES[ACCOUNTING],
    detailRow: {
      payment_id: paymentId,
      receipt_id: receiptId ? Number(receiptId) : null,
      procedure_id: proc ? proc.id : null,
      dossier_id: dos || null,
      flow_type: flow,
      amount: amt,
      currency: safeVal(currency, 10) || pay.currency || 'MAD',
      amount_text: safeVal(amountText, 300),
      receipt_number: safeVal(receiptNumber, 100),
      reference: safeVal(reference, 300) || pay.reference || ''
    },
    values,
    reason
  }));
}

function autoCreateAccountingForPayment(paymentId, { flowType = 'income', amount, currency, procedureId } = {}) {
  if (!settings().autoAccounting) return null;
  const pay = get('SELECT * FROM payments WHERE id = ?', [Number(paymentId)]);
  if (!pay) return null;
  if (flowType === 'income' && _findActiveAccountingForPayment(paymentId, 'income')) return null;
  if (_periodStatus(getRegister(ACCOUNTING) ? getRegister(ACCOUNTING).id : 0, todaySql()) === 'LOCKED') return null;

  const proc = get('SELECT dossier_id FROM procedures WHERE id = ?', [pay.procedure_id]);

  return createAccountingEntry({
    paymentId,
    flowType,
    amount: amount != null ? amount : pay.amount,
    currency: currency || pay.currency || 'MAD',
    procedureId: pay.procedure_id,
    dossierId: proc ? proc.dossier_id : null,
    reference: pay.reference
  });
}

/* ربط وصل بإدخال السجل الحسابي */
function linkReceiptToAccounting(paymentId, receiptId, receiptNumber) {
  const row = _findActiveAccountingForPayment(paymentId, 'income');
  if (!row) return null;
  const oldRow = get('SELECT receipt_id, receipt_number FROM accounting_register_entries WHERE entry_id = ?', [row.entry_id]);
  if (oldRow && oldRow.receipt_id === Number(receiptId)) return row;
  run(
    'UPDATE accounting_register_entries SET receipt_id = ?, receipt_number = ? WHERE entry_id = ?',
    [Number(receiptId), safeVal(receiptNumber, 100), row.entry_id]
  );
  logAudit(getRegister(ACCOUNTING).id, 'UPDATE', {
    entryId: row.entry_id,
    oldValue: { receipt_id: oldRow ? oldRow.receipt_id : null, receipt_number: oldRow ? oldRow.receipt_number : '' },
    newValue: { receipt_id: Number(receiptId), receipt_number: safeVal(receiptNumber, 100) },
    reason: 'ربط الوصل بالأداء'
  });
  return row;
}

/* ================================================================
   القوائم (فلاتر + بحث + صفحات) — استعلام مشترك حسب النوع
   ================================================================ */
function listEntries({ registerId, kind, page = 1, pageSize = 25, from, to, typeId, status, user, dossier, q } = {}) {
  let reg = null;
  if (registerId) reg = getRegisterById(registerId);
  else if (kind === 'accounting') reg = getRegister(ACCOUNTING);
  else reg = getRegister(DAILY);
  if (!reg) throw new Error('NOT_FOUND:register');

  const isAcc = reg.kind === 'accounting';
  const where = ['e.register_id = ?'];
  const params = [reg.id];

  if (from) { where.push('date(e.entry_date) >= date(?)'); params.push(from); }
  if (to) { where.push('date(e.entry_date) <= date(?)'); params.push(to); }
  if (status && ACTIVE_STATUSES.includes(status)) { where.push('e.status = ?'); params.push(status); }
  if (user) { where.push('e.created_by = ?'); params.push(String(user)); }
  if (typeId) {
    if (isAcc) { where.push('p.procedure_type_id = ?'); params.push(Number(typeId)); }
    else { where.push('dpv.procedure_type_id = ?'); params.push(Number(typeId)); }
  }
  if (dossier && String(dossier).trim()) {
    where.push('d.numero LIKE ?');
    params.push(`%${String(dossier).trim()}%`);
  }

  if (q && String(q).trim()) {
    const term = `%${String(q).trim()}%`;
    if (isAcc) {
      where.push(`(
        e.serial_no LIKE ? OR e.entry_date LIKE ? OR p.procedure_number LIKE ? OR d.numero LIKE ? OR
        a.receipt_number LIKE ? OR a.reference LIKE ? OR r.receipt_number LIKE ?
      )`);
      params.push(term, term, term, term, term, term, term);
    } else {
      where.push(`(
        e.serial_no LIKE ? OR e.entry_date LIKE ? OR p.procedure_number LIKE ? OR d.numero LIKE ? OR
        dpv.pv_number LIKE ? OR dpv.parties_summary LIKE ? OR dpv.reference_number LIKE ? OR
        EXISTS (SELECT 1 FROM procedure_parties pp2 JOIN parties qp ON qp.id = pp2.party_id
                WHERE pp2.procedure_id = dpv.procedure_id AND (qp.name LIKE ? OR qp.cin LIKE ?))
      )`);
      params.push(term, term, term, term, term, term, term, term, term);
    }
  }

  const whereSql = 'WHERE ' + where.join(' AND ');

  const fromClause = isAcc
    ? `FROM register_entries e
       JOIN accounting_register_entries a ON a.entry_id = e.id
       LEFT JOIN procedures p ON p.id = a.procedure_id
       LEFT JOIN dossiers d ON d.id = a.dossier_id
       LEFT JOIN receipts r ON r.id = a.receipt_id`
    : `FROM register_entries e
       JOIN daily_procedure_register_entries dpv ON dpv.entry_id = e.id
       LEFT JOIN procedures p ON p.id = dpv.procedure_id
       LEFT JOIN dossiers d ON d.id = dpv.dossier_id
       LEFT JOIN pvs pv ON pv.id = dpv.pv_id
       LEFT JOIN procedure_types pt ON pt.id = dpv.procedure_type_id`;

  const total = get(`SELECT COUNT(*) AS c ${fromClause} ${whereSql}`, params).c;
  const pageNum = Math.max(1, Number(page) || 1);
  const size = Math.min(500, Number(pageSize) || 25);
  const offset = (pageNum - 1) * size;

  const selectCols = isAcc
    ? `e.serial_no, e.entry_date, e.status, e.reason, e.created_by, e.created_at, e.id AS entry_id,
       a.payment_id, a.receipt_id, a.procedure_id, a.dossier_id, a.flow_type, a.amount, a.currency,
       a.amount_text, a.receipt_number, a.reference,
       p.procedure_number, d.numero AS dossier_number, d.demandeur AS dossier_demandeur,
       r.receipt_number AS rc_receipt_number, r.status AS receipt_status`
    : `e.serial_no, e.entry_date, e.status, e.reason, e.created_by, e.created_at, e.id AS entry_id,
       dpv.procedure_id, dpv.dossier_id, dpv.procedure_type_id, dpv.pv_id, dpv.pv_number,
       dpv.procedure_number_snapshot, dpv.reference_number, dpv.parties_summary,
       p.procedure_number, d.numero AS dossier_number,
       pt.code AS type_code, pt.name_ar AS type_name_ar, pt.name_fr AS type_name_fr,
       pv.pv_number AS pv_pnumber`;

  const rows = all(
    `SELECT ${selectCols} ${fromClause} ${whereSql}
     ORDER BY e.entry_date ASC, e.id ASC LIMIT ? OFFSET ?`,
    [...params, size, offset]
  );

  return { rows, total, page: pageNum, pageSize: size, register: reg };
}

/* ================================================================
   تفاصيل إدخال (غنية + قيم + تدقيق + تصحيحات)
   ================================================================ */
function getEntry(id) {
  const e = get('SELECT * FROM register_entries WHERE id = ?', [Number(id)]);
  if (!e) throw new Error('NOT_FOUND:registerEntry:' + id);
  const reg = getRegisterById(e.register_id);

  let detail = null;
  if (reg.kind === 'daily') {
    detail = get(
      `SELECT dpv.*, p.procedure_number, p.currency AS proc_currency, p.status AS procedure_status,
              d.numero AS dossier_number, d.demandeur AS dossier_demandeur, d.defendeur AS dossier_defendeur,
              pt.code AS type_code, pt.name_ar AS type_name_ar, pt.name_fr AS type_name_fr,
              pv.pv_number, pv.status AS pv_status, pyt.name_ar AS pv_type_ar, pyt.name_fr AS pv_type_fr
       FROM daily_procedure_register_entries dpv
       LEFT JOIN procedures p ON p.id = dpv.procedure_id
       LEFT JOIN dossiers d ON d.id = dpv.dossier_id
       LEFT JOIN procedure_types pt ON pt.id = dpv.procedure_type_id
       LEFT JOIN pvs pv ON pv.id = dpv.pv_id
       LEFT JOIN pv_types pyt ON pyt.id = pv.pv_type_id
       WHERE dpv.entry_id = ?`,
      [e.id]
    );
  } else {
    detail = get(
      `SELECT a.*, p.procedure_number, p.status AS procedure_status, p.currency AS proc_currency,
              d.numero AS dossier_number, d.demandeur AS dossier_demandeur, d.defendeur AS dossier_defendeur,
              r.receipt_number AS rc_receipt_number, r.status AS receipt_status,
              pay.method AS payment_method, pay.status AS payment_status, pt.code AS type_code, pt.name_ar AS type_name_ar, pt.name_fr AS type_name_fr
       FROM accounting_register_entries a
       LEFT JOIN procedures p ON p.id = a.procedure_id
       LEFT JOIN dossiers d ON d.id = a.dossier_id
       LEFT JOIN receipts r ON r.id = a.receipt_id
       LEFT JOIN payments pay ON pay.id = a.payment_id
       LEFT JOIN procedure_types pt ON pt.id = p.procedure_type_id
       WHERE a.entry_id = ?`,
      [e.id]
    );
  }

  const values = all(
    'SELECT field_key, value FROM register_entry_values WHERE entry_id = ?',
    [e.id]
  );

  const auditRows = all(
    `SELECT * FROM register_audit_logs WHERE entry_id = ? ORDER BY id`,
    [e.id]
  );

  const corrections = all(
    `SELECT * FROM register_corrections WHERE original_entry_id = ? OR replacement_entry_id = ? ORDER BY id`,
    [e.id, e.id]
  );

  const periods = get(
    'SELECT * FROM register_periods WHERE register_id = ? AND period_key = ?',
    [reg.id, periodKeyOf(e.entry_date)]
  );

  return {
    ...e,
    register: { id: reg.id, code: reg.code, kind: reg.kind, name_ar: reg.name_ar, name_fr: reg.name_fr },
    detail,
    values,
    audit: auditRows,
    corrections,
    period: periods ? { period_key: periods.period_key, status: periods.status } : null
  };
}

/* ================================================================
   الإلغاء (بدون حذف): CANCELLED + سبب + تدقيق
   ================================================================ */
function cancelEntry(id, reason) {
  requireAuth('register.correct');
  const e = get('SELECT * FROM register_entries WHERE id = ?', [Number(id)]);
  if (!e) throw new Error('NOT_FOUND:registerEntry:' + id);
  if (e.status !== 'ACTIVE') throw new Error('VALIDATION:register:entryNotActive');
  if (!String(reason || '').trim()) throw new Error('VALIDATION:register:reasonRequired');
  const st = _periodStatus(e.register_id, e.entry_date);
  if (st === 'LOCKED') throw new Error(`VALIDATION:register:periodLocked:${periodKeyOf(e.entry_date)}`);

  tx(() => {
    run("UPDATE register_entries SET status = 'CANCELLED', reason = ? WHERE id = ?",
      [safeVal(reason, 2000), e.id]);
    logAudit(e.register_id, 'CANCEL', {
      entryId: e.id,
      oldValue: { status: 'ACTIVE' },
      newValue: { status: 'CANCELLED' },
      reason
    });
  });
  return getEntry(e.id);
}

/* ================================================================
   التصحيحات (Correction Workflow — لا تعديل صامت)
   ================================================================ */
function requestCorrection(id, reason) {
  const e = get('SELECT * FROM register_entries WHERE id = ?', [Number(id)]);
  if (!e) throw new Error('NOT_FOUND:registerEntry:' + id);
  if (e.status !== 'ACTIVE') throw new Error('VALIDATION:register:entryNotActive');
  if (!String(reason || '').trim()) throw new Error('VALIDATION:register:reasonRequired');

  const user = getCurrentUser();
  const snapshot = getEntry(id);

  const res = tx(() => {
    const r = run(
      `INSERT INTO register_corrections (register_id, original_entry_id, snapshot_old, reason, requested_by, status)
       VALUES (?,?,?,?,?, 'REQUESTED')`,
      [e.register_id, e.id, JSON.stringify(snapshot), safeVal(reason, 2000), user.username]
    );
    logAudit(e.register_id, 'REQUEST_CORRECTION', {
      entryId: e.id, newValue: { correction_id: r.lastId }, reason
    });
    return r.lastId;
  });
  return getCorrection(res);
}

function getCorrection(correctionId) {
  const c = get('SELECT * FROM register_corrections WHERE id = ?', [Number(correctionId)]);
  if (!c) throw new Error('NOT_FOUND:correction:' + correctionId);
  try { c.snapshot = JSON.parse(c.snapshot_old || '{}'); } catch (e2) { c.snapshot = {}; }
  return c;
}

function listCorrections({ registerId, status, page = 1, pageSize = 25 } = {}) {
  const where = [];
  const params = [];
  if (registerId) { where.push('rc.register_id = ?'); params.push(Number(registerId)); }
  if (status) { where.push('rc.status = ?'); params.push(String(status)); }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = get(`SELECT COUNT(*) AS c FROM register_corrections rc ${whereSql}`, params).c;
  const pageNum = Math.max(1, Number(page) || 1);
  const size = Math.min(100, Number(pageSize) || 25);
  const offset = (pageNum - 1) * size;
  const rows = all(
    `SELECT rc.*, e.serial_no AS original_serial, e.entry_date AS original_date, e.status AS original_status,
            r.code AS register_code, r.name_ar AS register_ar, r.name_fr AS register_fr,
            re.serial_no AS replacement_serial
     FROM register_corrections rc
     JOIN registers r ON r.id = rc.register_id
     JOIN register_entries e ON e.id = rc.original_entry_id
     LEFT JOIN register_entries re ON re.id = rc.replacement_entry_id
     ${whereSql} ORDER BY rc.id DESC LIMIT ? OFFSET ?`,
    [...params, size, offset]
  );
  return { rows, total, page: pageNum, pageSize: size };
}

function approveCorrection(correctionId, reviewNote) {
  requireAuth('register.correct');
  const c = getCorrection(correctionId);
  if (c.status !== 'REQUESTED') throw new Error('VALIDATION:correction:notRequested');
  const original = get('SELECT * FROM register_entries WHERE id = ?', [c.original_entry_id]);
  if (!original) throw new Error('NOT_FOUND:registerEntry:' + c.original_entry_id);
  if (original.status !== 'ACTIVE') throw new Error('VALIDATION:register:entryNotActive');

  const reg = getRegisterById(c.register_id);
  const user = getCurrentUser();
  const snapshot = c.snapshot || {};
  const detail = snapshot.detail || {};

  const result = tx(() => {
    run("UPDATE register_entries SET status = 'SUPERSEDED', reason = ? WHERE id = ?",
      ['عوّض بتصحيح #' + c.id + ' — ' + safeVal(c.reason, 500), c.original_entry_id]);
    logAudit(reg.id, 'SUPERSEDE', {
      entryId: c.original_entry_id,
      oldValue: { status: 'ACTIVE' },
      newValue: { status: 'SUPERSEDED', correction_id: c.id },
      reason: c.reason
    });

    const values = {};
    (snapshot.values || []).forEach((v) => { values[v.field_key] = v.value; });

    const detailRow = reg.kind === 'daily'
      ? {
          procedure_id: detail.procedure_id || null,
          dossier_id: detail.dossier_id || null,
          procedure_type_id: detail.procedure_type_id || null,
          pv_id: detail.pv_id || null,
          procedure_number_snapshot: detail.procedure_number_snapshot || '',
          pv_number: detail.pv_number || '',
          reference_number: detail.reference_number || '',
          parties_summary: detail.parties_summary || ''
        }
      : {
          payment_id: detail.payment_id || null,
          receipt_id: detail.receipt_id || null,
          procedure_id: detail.procedure_id || null,
          dossier_id: detail.dossier_id || null,
          flow_type: detail.flow_type || 'income',
          amount: Number(detail.amount) || 0,
          currency: detail.currency || 'MAD',
          amount_text: detail.amount_text || '',
          receipt_number: detail.receipt_number || '',
          reference: detail.reference || ''
        };

    const repl = insertEntryCore({
      register: reg,
      entryDate: todaySql(),
      detailTable: DETAIL_TABLES[reg.kind === 'daily' ? DAILY : ACCOUNTING],
      detailRow,
      values,
      reason: 'تصحيح #' + c.id + ' — ' + safeVal(c.reason, 1000)
    });

    run(
      `UPDATE register_corrections SET status = 'EXECUTED', replacement_entry_id = ?, reviewed_by = ?, reviewed_at = datetime('now'), review_note = ? WHERE id = ?`,
      [repl.entryId, user.username, safeVal(reviewNote, 1000), c.id]
    );
    logAudit(reg.id, 'CORRECT', {
      entryId: repl.entryId,
      oldValue: { original_entry_id: c.original_entry_id, original_serial: original.serial_no },
      newValue: { replacement_entry_id: repl.entryId, replacement_serial: repl.serial },
      reason: c.reason
    });
    return { original: original.serial_no, replacement: repl.serial };
  });
  return result;
}

function rejectCorrection(correctionId, reviewNote) {
  requireAuth('register.correct');
  const c = getCorrection(correctionId);
  if (c.status !== 'REQUESTED') throw new Error('VALIDATION:correction:notRequested');
  const user = getCurrentUser();
  tx(() => {
    run(
      `UPDATE register_corrections SET status = 'REJECTED', reviewed_by = ?, reviewed_at = datetime('now'), review_note = ? WHERE id = ?`,
      [user.username, safeVal(reviewNote, 1000), c.id]
    );
    logAudit(c.register_id, 'REJECT_CORRECTION', {
      entryId: c.original_entry_id, newValue: { correction_id: c.id, status: 'REJECTED' }, reason: reviewNote
    });
  });
  return getCorrection(correctionId);
}

/* ================================================================
   التدقيق (قراءة فقط للمستخدمين المصرح لهم)
   ================================================================ */
function listAudit({ registerId, entryId, action, page = 1, pageSize = 50 } = {}) {
  requireAuth('register.audit');
  const where = [];
  const params = [];
  if (registerId) { where.push('ral.register_id = ?'); params.push(Number(registerId)); }
  if (entryId) { where.push('ral.entry_id = ?'); params.push(Number(entryId)); }
  if (action) { where.push('ral.action = ?'); params.push(String(action)); }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = get(`SELECT COUNT(*) AS c FROM register_audit_logs ral ${whereSql}`, params).c;
  const pageNum = Math.max(1, Number(page) || 1);
  const size = Math.min(200, Number(pageSize) || 50);
  const offset = (pageNum - 1) * size;
  const rows = all(
    `SELECT ral.*, r.code AS register_code FROM register_audit_logs ral
     LEFT JOIN registers r ON r.id = ral.register_id
     ${whereSql} ORDER BY ral.id DESC LIMIT ? OFFSET ?`,
    [...params, size, offset]
  );
  return { rows, total, page: pageNum, pageSize: size };
}

/* ================================================================
   البحث الشامل (الأرقام + الأطراف + CIN + التواريخ)
   ================================================================ */
function globalSearch(q) {
  const term = `%${String(q || '').trim()}%`;
  if (term === '%%') return { daily: [], accounting: [] };

  const daily = all(
    `SELECT e.id AS entry_id, e.serial_no, e.entry_date, e.status, dpv.pv_number, dpv.reference_number, dpv.parties_summary,
            p.procedure_number, d.numero AS dossier_number, pt.name_ar AS type_ar, pt.name_fr AS type_fr
     FROM register_entries e
     JOIN daily_procedure_register_entries dpv ON dpv.entry_id = e.id
     LEFT JOIN procedures p ON p.id = dpv.procedure_id
     LEFT JOIN dossiers d ON d.id = dpv.dossier_id
     LEFT JOIN procedure_types pt ON pt.id = dpv.procedure_type_id
     LEFT JOIN procedure_parties pp ON pp.procedure_id = dpv.procedure_id
     LEFT JOIN parties pa ON pa.id = pp.party_id
     WHERE e.serial_no LIKE ? OR p.procedure_number LIKE ? OR d.numero LIKE ? OR dpv.pv_number LIKE ?
        OR pa.name LIKE ? OR pa.cin LIKE ? OR e.entry_date LIKE ?
     GROUP BY e.id ORDER BY e.entry_date DESC, e.id DESC LIMIT 50`,
    [term, term, term, term, term, term, term]
  );

  const accounting = all(
    `SELECT e.id AS entry_id, e.serial_no, e.entry_date, e.status, a.amount, a.currency, a.flow_type, a.receipt_number, a.reference,
            p.procedure_number, d.numero AS dossier_number, r.receipt_number AS rc_number
     FROM register_entries e
     JOIN accounting_register_entries a ON a.entry_id = e.id
     LEFT JOIN procedures p ON p.id = a.procedure_id
     LEFT JOIN dossiers d ON d.id = a.dossier_id
     LEFT JOIN receipts r ON r.id = a.receipt_id
     WHERE e.serial_no LIKE ? OR p.procedure_number LIKE ? OR d.numero LIKE ? OR r.receipt_number LIKE ?
        OR a.reference LIKE ? OR e.entry_date LIKE ?
     ORDER BY e.entry_date DESC, e.id DESC LIMIT 50`,
    [term, term, term, term, term, term]
  );

  return { daily, accounting };
}

/* ================================================================
   لوحة السجلات (بيانات حقيقية من قاعدة البيانات)
   ================================================================ */
function dashboard() {
  const today = todaySql();
  const t0 = today + 'T00:00:00';

  const todayProcedures = get(
    "SELECT COUNT(*) AS c FROM procedures WHERE date(created_at, 'localtime') = ?", [today]
  ).c;
  const todayEntries = get(
    'SELECT COUNT(*) AS c FROM register_entries WHERE date(entry_date) = ?', [today]
  ).c;

  const lastProcedure = get(
    `SELECT e.id AS entry_id, e.serial_no, e.entry_date, dpv.procedure_number_snapshot, dpv.parties_summary,
            p.procedure_number, d.numero AS dossier_number, pt.name_ar AS type_ar, pt.name_fr AS type_fr
     FROM register_entries e
     JOIN daily_procedure_register_entries dpv ON dpv.entry_id = e.id
     LEFT JOIN procedures p ON p.id = dpv.procedure_id
     LEFT JOIN dossiers d ON d.id = dpv.dossier_id
     LEFT JOIN procedure_types pt ON pt.id = dpv.procedure_type_id
     WHERE e.register_id = (SELECT id FROM registers WHERE code = 'DAILY_PROCEDURE')
     ORDER BY e.entry_date DESC, e.id DESC LIMIT 1`
  );

  const lastAccounting = get(
    `SELECT e.id AS entry_id, e.serial_no, e.entry_date, a.amount, a.currency, a.flow_type,
            a.receipt_number, p.procedure_number, r.receipt_number AS rc_number
     FROM register_entries e
     JOIN accounting_register_entries a ON a.entry_id = e.id
     LEFT JOIN procedures p ON p.id = a.procedure_id
     LEFT JOIN receipts r ON r.id = a.receipt_id
     WHERE e.register_id = (SELECT id FROM registers WHERE code = 'ACCOUNTING')
     ORDER BY e.entry_date DESC, e.id DESC LIMIT 1`
  );

  const todayPvCount = get(
    "SELECT COUNT(*) AS c FROM pvs WHERE date(COALESCE(finalized_at, created_at), 'localtime') = ?", [today]
  ).c;

  const todayIncome = get(
    `SELECT COALESCE(SUM(a.amount),0) AS t FROM register_entries e
     JOIN accounting_register_entries a ON a.entry_id = e.id
     WHERE e.register_id = (SELECT id FROM registers WHERE code = 'ACCOUNTING')
       AND date(e.entry_date) = ? AND a.flow_type = 'income' AND e.status != 'CANCELLED'`,
    [today]
  ).t;
  const todayRefunds = get(
    `SELECT COALESCE(SUM(a.amount),0) AS t FROM register_entries e
     JOIN accounting_register_entries a ON a.entry_id = e.id
     WHERE e.register_id = (SELECT id FROM registers WHERE code = 'ACCOUNTING')
       AND date(e.entry_date) = ? AND a.flow_type = 'refund' AND e.status != 'CANCELLED'`,
    [today]
  ).t;

  const incomplete = get(
    "SELECT COUNT(*) AS c FROM procedures WHERE status NOT IN ('COMPLETED','CANCELLED')",
    []
  ).c;

  const latestAudit = all(
    `SELECT ral.*, r.code AS register_code FROM register_audit_logs ral
     LEFT JOIN registers r ON r.id = ral.register_id
     ORDER BY ral.id DESC LIMIT 8`
  );

  return {
    todayProcedures,
    todayEntries,
    todayPvCount,
    todayIncome: Number(todayIncome),
    todayRefunds: Number(todayRefunds),
    todayNet: Number(todayIncome) - Number(todayRefunds),
    lastProcedure,
    lastAccounting,
    todayAccounting: { income: Number(todayIncome), refunds: Number(todayRefunds), net: Number(todayIncome) - Number(todayRefunds) },
    incompleteProcedures: incomplete,
    latestAudit
  };
}

/* ================================================================
   HTML الطباعة (A4 / RTL / أرقام صفحات) — نقي وقابل للاختبار
   ================================================================ */
function buildRegisterHtml(register, rows, opts = {}) {
  const ar = opts.lang !== 'fr';
  const office = opts.office || settingsService.getOffice();
  const dir = ar ? 'rtl' : 'ltr';
  const title = ar ? register.name_ar : register.name_fr;

  const groupByDate = {};
  (rows || []).forEach((r) => {
    (groupByDate[r.entry_date] = groupByDate[r.entry_date] || []).push(r);
  });

  const isAcc = register.kind === 'accounting';
  const dayTotals = {};
  Object.keys(groupByDate).forEach((d) => {
    if (isAcc) {
      const inc = groupByDate[d].filter((r) => r.flow_type === 'income' && r.status !== 'CANCELLED').reduce((s, r) => s + (Number(r.amount) || 0), 0);
      const ref = groupByDate[d].filter((r) => r.flow_type === 'refund' && r.status !== 'CANCELLED').reduce((s, r) => s + (Number(r.amount) || 0), 0);
      dayTotals[d] = { inc, ref };
    } else {
      dayTotals[d] = { count: groupByDate[d].length };
    }
  });

  const headerRow = isAcc
    ? `<tr><th>${ar ? 'الرقم التسلسلي' : 'N° série'}</th><th>${ar ? 'المرجع' : 'Référence'}</th><th>${ar ? 'رقم الإجراء' : 'N° procédure'}</th><th>${ar ? 'رقم الملف' : 'N° dossier'}</th><th>${ar ? 'المبلغ' : 'Montant'}</th><th>${ar ? 'الوصل' : 'Reçu'}</th><th>${ar ? 'بيان' : 'Observation'}</th><th>${ar ? 'الحالة' : 'État'}</th></tr>`
    : `<tr><th>${ar ? 'الرقم التسلسلي' : 'N° série'}</th><th>${ar ? 'رقم الإجراء' : 'N° procédure'}</th><th>${ar ? 'رقم الملف' : 'N° dossier'}</th><th>${ar ? 'نوع الإجراء' : 'Type de procédure'}</th><th>${ar ? 'الأطراف' : 'Parties'}</th><th>${ar ? 'المحضر' : 'PV'}</th><th>${ar ? 'الحالة' : 'État'}</th></tr>`;

  const bodyRows = Object.keys(groupByDate).sort().map((d) => {
    const items = groupByDate[d].map((r) => {
      const st = r.status === 'ACTIVE' ? (ar ? 'مُثبت' : 'Enregistré') : r.status === 'SUPERSEDED' ? (ar ? 'عُوّض' : 'Remplacé') : r.status === 'CANCELLED' ? (ar ? 'ملغى' : 'Annulé') : r.status;
      const note = r.status !== 'ACTIVE' ? (r.status === 'CANCELLED' || r.status === 'SUPERSEDED' ? r.reason : '') : '';
      if (isAcc) {
        const amt = (Number(r.amount) || 0).toLocaleString();
        return `<tr>
          <td>${r.serial_no}</td>
          <td>${r.reference || '—'}</td>
          <td>${r.procedure_number || '—'}</td>
          <td>${r.dossier_number || '—'}</td>
          <td class="num">${amt} ${r.currency || 'MAD'}${r.flow_type === 'refund' ? ' (' + (ar ? 'استرداد' : 'remboursement') + ')' : ''}</td>
          <td>${r.receipt_number || r.rc_receipt_number || '—'}</td>
          <td>${r.amount_text || note || '—'}</td>
          <td>${st}</td>
        </tr>`;
      }
      return `<tr>
        <td>${r.serial_no}</td>
        <td>${r.procedure_number || r.procedure_number_snapshot || '—'}</td>
        <td>${r.dossier_number || '—'}</td>
        <td>${ar ? (r.type_name_ar || r.type_name_fr) : (r.type_name_fr || r.type_name_ar) || '—'}</td>
        <td>${r.parties_summary || '—'}</td>
        <td>${r.pv_number || '—'}</td>
        <td>${st}${note ? '<br><small>' + note + '</small>' : ''}</td>
      </tr>`;
    }).join('');
    const totals = isAcc
      ? `<tr class="day-total"><td colspan="8">${ar ? 'مجموع اليوم' : 'Total du jour'} — ${ar ? 'إيراد' : 'Recettes'} : ${(dayTotals[d].inc || 0).toLocaleString()} | ${ar ? 'استرداد' : 'Remb.'} : ${(dayTotals[d].ref || 0).toLocaleString()}</td></tr>`
      : `<tr class="day-total"><td colspan="7">${ar ? 'مجموع إجراءات اليوم' : 'Total des procédures du jour'} : ${dayTotals[d].count}</td></tr>`;
    return `<div class="day-block"><h4>${ar ? 'يوم' : 'Jour'} ${d}</h4>
      <table class="reg-table">${headerRow}${items}${totals}</table></div>`;
  }).join('') || `<p class="empty">${ar ? 'لا توجد إدخالات للفترة المحددة.' : 'Aucune entrée pour la période.'}</p>`;

  return `<!DOCTYPE html><html lang="${ar ? 'ar' : 'fr'}" dir="${dir}"><head><meta charset="utf-8"><style>
    @page { size: A4; margin: 16mm 14mm; }
    * { box-sizing: border-box; }
    body { font-family: "Noto Kufi Arabic","Inter","Segoe UI",sans-serif; color:#1c2431; font-size:11.5px; line-height:1.5; }
    .head { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:2px solid #1f4e8c; padding-bottom:8px; margin-bottom:10px; }
    .head .t { font-size:14px; font-weight:800; color:#1f4e8c; }
    .head .m { font-size:10px; color:#4a5568; }
    .reg-title { text-align:center; font-size:15px; font-weight:800; margin:4px 0 2px; }
    .reg-ref { text-align:center; font-size:10px; color:#4a5568; margin-bottom:12px; }
    .day-block { margin-bottom:14px; page-break-inside: avoid; }
    .day-block h4 { font-size:11px; margin:8px 0 4px; color:#1f4e8c; border-bottom:1px solid #dde3ee; padding-bottom:3px; }
    table.reg-table { width:100%; border-collapse:collapse; }
    .reg-table th, .reg-table td { border:1px solid #b9c4d4; padding:4px 6px; font-size:10.5px; }
    .reg-table th { background:#eef2f8; }
    .reg-table td.num { text-align:${ar ? 'left' : 'right'}; white-space:nowrap; }
    .day-total td { background:#f6f8fb; font-weight:700; }
    .legal { margin-top:18px; padding-top:8px; border-top:1px solid #e2e7f0; font-size:9px; color:#8593a7; text-align:center; }
    .empty { text-align:center; color:#8593a7; }
    ${opts.watermark ? `
    .wm { position:fixed; top:45%; left:0; right:0; text-align:center; pointer-events:none; z-index:5;
          font-size:34px; font-weight:800; color:rgba(31,78,140,0.10); transform:rotate(-24deg);
          letter-spacing:2px; white-space:nowrap; }` : ''}
  </style></head><body>
    ${opts.watermark ? `<div class="wm">${escapeHtml(opts.watermark)}</div>` : ''}
    <div class="head">
      <div class="t">${ar ? 'مكتب المفوض القضائي' : 'Cabinet de l\'Huissier de Justice'}</div>
      <div class="m">${ar ? 'المغرب' : 'Maroc'}<br>${escapeHtml(office.name || '')}</div>
    </div>
    <div class="reg-title">${escapeHtml(title)}</div>
    <div class="reg-ref">
      ${ar ? 'الفترة' : 'Période'} : ${opts.from || '—'} ${ar ? 'إلى' : 'à'} ${opts.to || '—'}
      &nbsp;•&nbsp; ${ar ? 'أُعدّ بتاريخ' : 'Généré le'} ${opts.generatedAt || ''} ${ar ? 'بواسطة' : 'par'} ${opts.by || ''}
    </div>
    ${bodyRows}
    <div class="legal">${ar
      ? 'وثيقة إدارية داخلية تُولَّد من تطبيق تسيير المفوض القضائي. السجلات المنصوص عليها في المادة 37 من القانون رقم 46.21 تُمسك إلكترونياً وورقياً، ويحدَّد نموذجها بنص تنظيمي. لا تُعتبر هذه الوثيقة النموذج الرسمي.'
      : 'Document administratif interne généré par l\'application de gestion. Les registres prévus à l\'article 37 de la loi n° 46.21 sont tenus par voie électronique et papier ; leur modèle est fixé par texte réglementaire. Ce document n\'est pas le modèle officiel.'}</div>
  </body></html>`;
}

function escapeHtml(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* ================================================================
   أرشيف السجلات: حُفِظَ سجل قاعدة البيانات + الوثيقة معاً
   ================================================================ */
function archivePeriod(registerId, periodKey, title, filePath) {
  requireAuth('register.export');
  const reg = getRegisterById(registerId);
  if (!reg) throw new Error('NOT_FOUND:register:' + registerId);
  const pk = String(periodKey || '').slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(pk)) throw new Error('VALIDATION:register:invalidPeriod');

  const user = getCurrentUser();
  const result = tx(() => {
    const sha = archiveService.sha256File(filePath);
    const size = archiveService.fileSize(filePath);
    const doc = run(
      `INSERT INTO documents (entity_type, entity_id, kind, title, file_name, file_path, mime, archived, created_by, status, sha256, size_bytes, period_key, source)
       VALUES ('register', ?, 'register-archive', ?, ?, ?, 'application/pdf', 1, ?, 'active', ?, ?, ?, 'auto')`,
      [reg.id, safeVal(title, 300), pathBase(filePath) + '.pdf', filePath, user.username, sha, size, pk]
    );
    const arch = run(
      `INSERT INTO register_archives (register_id, period_key, document_id, archived_by) VALUES (?,?,?,?)`,
      [reg.id, pk, doc.lastId, user.username]
    );
    logAudit(reg.id, 'ARCHIVE', {
      newValue: { period: pk, document_id: doc.lastId },
      reason: 'أرشفة فترة ' + pk
    });
    return { document_id: doc.lastId, archive_id: arch.lastId };
  });
  return { document_id: result.document_id, archive_id: result.archive_id, period_key: pk, filePath };
}

function pathBase(p) {
  return String(p).replace(/\.pdf$/i, '').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80);
}

/* ================================================================
   الختم القانوني للفترة (Seal) + التحقق من السلامة (P3)
   الختم = وضع وثائق أرشيف الفترة في حالة read-only مع بيان Manifest
   مسجل بصمةً له — لا يمكن بعده حذفها أو تعديلها (Triggers).
   ================================================================ */
function sealPeriod(registerId, periodKey, note = '') {
  requireAuth('archive.seal');
  const reg = getRegisterById(registerId);
  if (!reg) throw new Error('NOT_FOUND:register:' + registerId);
  const pk = String(periodKey || '').slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(pk)) throw new Error('VALIDATION:register:invalidPeriod');
  if (!String(note || '').trim()) throw new Error('REGISTER:REASON_REQUIRED');

  const archives = all(
    `SELECT d.* FROM register_archives ra JOIN documents d ON d.id = ra.document_id
     WHERE ra.register_id = ? AND ra.period_key = ? ORDER BY d.id`,
    [Number(registerId), pk]
  );
  if (!archives.length) throw new Error('REGISTER:PERIOD_NOT_ARCHIVED');

  const existing = get('SELECT * FROM archive_seals WHERE register_id = ? AND period_key = ?', [Number(registerId), pk]);
  if (existing) return existing;

  const user = getCurrentUser();
  const manifest = {
    register: reg.code,
    period: pk,
    note: String(note || '').trim(),
    docs: archives.map((d) => ({ id: d.id, title: d.title, file: d.file_path, sha256: d.sha256, size: d.size_bytes }))
  };
  const manifestHash = crypto.createHash('sha256').update(JSON.stringify(manifest)).digest('hex');

  const sealId = tx(() => {
    archives.forEach((d) => {
      run("UPDATE documents SET status = 'sealed' WHERE id = ?", [d.id]);
    });
    return run(
      `INSERT INTO archive_seals (register_id, period_key, doc_count, sha256_manifest, manifest_json, file_path, note, sealed_by)
       VALUES (?,?,?,?,?,?,?,?)`,
      [Number(registerId), pk, archives.length, manifestHash, JSON.stringify(manifest),
       manifest.docs[0].file, safeVal(note, 1000), user.username]
    ).lastId;
  });

  logAudit(registerId, 'SEAL', {
    newValue: { period: pk, docs: archives.length, manifest: manifestHash },
    reason: note
  });
  return get('SELECT * FROM archive_seals WHERE id = ?', [sealId]);
}

function verifySeal(sealId) {
  requireAuth('archive.seal');
  const seal = get('SELECT * FROM archive_seals WHERE id = ?', [Number(sealId)]);
  if (!seal) throw new Error('NOT_FOUND:seal:' + sealId);
  let manifest = null;
  try { manifest = JSON.parse(seal.manifest_json || ''); } catch (e) {}
  if (!manifest || !Array.isArray(manifest.docs) || !manifest.docs.length) {
    throw new Error('ARCHIVE:SEAL_MANIFEST_INVALID');
  }
  const results = manifest.docs.map((m) => {
    const current = archiveService.sha256File(m.file);
    return { id: m.id, title: m.title, file: m.file, expected: m.sha256, current, size: m.size || 0, ok: current.length === 64 && current === m.sha256 };
  });
  const manifestNow = crypto.createHash('sha256')
    .update(JSON.stringify({ register: manifest.register, period: manifest.period, note: manifest.note, docs: results.map((r) => ({ id: r.id, title: r.title, file: r.file, sha256: r.current, size: r.size })) }))
    .digest('hex');
  return {
    seal_id: seal.id,
    register_id: seal.register_id,
    period: seal.period_key,
    doc_count: results.length,
    ok_docs: results.filter((r) => r.ok).length,
    corrupted_docs: results.filter((r) => !r.ok).length,
    manifest_ok: manifestNow === seal.sha256_manifest,
    results
  };
}

function listSeals(registerId) {
  return all(
    'SELECT * FROM archive_seals WHERE register_id = ? ORDER BY sealed_at DESC',
    [Number(registerId)]
  );
}

module.exports = {
  DAILY, ACCOUNTING,
  listRegisters, getRegister, getRegisterById, config, updateConfig, settings,
  createDailyEntry, autoCreateDailyForProcedure, linkPvToDaily,
  createAccountingEntry, autoCreateAccountingForPayment, linkReceiptToAccounting,
  listEntries, getEntry, cancelEntry,
  requestCorrection, approveCorrection, rejectCorrection, getCorrection, listCorrections,
  listPeriods, setPeriodStatus, listAudit, auditExport,
  globalSearch, dashboard, buildRegisterHtml, archivePeriod,
  sealPeriod, verifySeal, listSeals
};