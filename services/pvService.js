'use strict';

/* ================================================================
   PvService — المحاور (Procès-Verbaux) Module.
   يضم: التوليد، الإنشاء مع تعبئة تلقائية من القالب، تحرير بنسخ
   (Versioning)، الحالات والانتقالات، النظائر (Copies)، البحث،
   الإحصائيات، سجل التدقيق، الأنواع والحالات القابلة للتهيئة.
   نقي: لا يعتمد على Electron (PDF يُدار في PvPdfService).
   ================================================================ */

const { get, all, run, tx, nextSequence } = require('../db/database').helpers;
const audit = require('./audit');
const auth = require('./auth');
const procedureService = require('./procedureService');
const templateService = require('./templateService');
const settingsService = require('./settingsService');
const registersService = require('./registersService');
const engine = require('./templateEngineService');

/* ---------- أنواع المحاضر (قابلة للتهيئة) ---------- */
function listPvTypes(activeOnly = true) {
  return all(
    `SELECT * FROM pv_types ${activeOnly ? 'WHERE active = 1' : ''} ORDER BY sort_order, id`
  );
}

function getPvType(id) {
  return get('SELECT * FROM pv_types WHERE id = ?', [id]);
}

function updatePvType({ id, code, nameAr, nameFr, active }) {
  if (id) {
    run('UPDATE pv_types SET name_ar = ?, name_fr = ?, active = ? WHERE id = ?', [nameAr, nameFr, active, id]);
  } else if (code) {
    const existing = get('SELECT id FROM pv_types WHERE code = ?', [code]);
    if (existing) {
      run('UPDATE pv_types SET name_ar = ?, name_fr = ?, active = ? WHERE code = ?', [nameAr, nameFr, active, code]);
    } else {
      run('INSERT INTO pv_types (code, name_ar, name_fr, active) VALUES (?,?,?,?)', [code, nameAr, nameFr, active]);
    }
  }
  audit.log({ action: 'pv_type.updated', entity: 'pv_type', entityId: id || 0, metadata: { code, nameAr, nameFr } });
  return true;
}

/* ---------- حالات المحضر (قابلة للتهيئة) ---------- */
function listPvStatuses(activeOnly = true) {
  return all(
    `SELECT * FROM pv_statuses ${activeOnly ? 'WHERE active = 1' : ''} ORDER BY sort_order`
  );
}

function updatePvStatus({ code, nameAr, nameFr, color }) {
  run('UPDATE pv_statuses SET name_ar = ?, name_fr = ?, color = ? WHERE code = ?', [nameAr, nameFr, color, code]);
  audit.log({ action: 'pv_status.updated', entity: 'pv_status', entityId: 0, metadata: { code, nameAr, nameFr, color } });
  return true;
}

function listPvTransitions() {
  return all('SELECT * FROM pv_status_transitions ORDER BY id');
}

function getStatus(code) {
  return get('SELECT * FROM pv_statuses WHERE code = ?', [code]);
}

/* ---------- انتقالات الحالة ---------- */
function allowedTransitions(fromStatus) {
  return all(
    'SELECT to_status FROM pv_status_transitions WHERE from_status = ?',
    [fromStatus]
  ).map((r) => r.to_status);
}

function canTransition(fromStatus, toStatus) {
  if (fromStatus === toStatus) return false;
  return allowedTransitions(fromStatus).includes(toStatus);
}

/* ---------- توليد رقم محضر فريد ---------- */
function generatePvNumber() {
  const year = new Date().getFullYear();
  const seq = nextSequence('pv:' + year);
  return `PV-${year}-${String(seq).padStart(4, '0')}`;
}

/* ---------- سجل تدقيق خاص بالمحضر ---------- */
function pvAudit(pvId, action, metadata = {}, actor = null) {
  let user = actor;
  if (!user || typeof user === 'object') user = (user && user.username) || auth.getCurrentUser().username;
  run(
    'INSERT INTO pv_audit_logs (pv_id, action, by_user, metadata) VALUES (?,?,?,?)',
    [pvId, action, user, JSON.stringify(metadata)]
  );
  audit.log({ action, entity: 'pv', entityId: pvId, metadata, user });
}

/* ---------- سجل تغيير الحالة ---------- */
function recordTransition(pvId, fromStatus, toStatus, note = '') {
  const user = auth.getCurrentUser();
  run(
    `INSERT INTO pv_status_history (pv_id, from_status, to_status, by_user, note)
     VALUES (?,?,?,?,?)`,
    [pvId, fromStatus, toStatus, user.username, note]
  );
}

/* ---------- متغيرات المحضر لسياق القالب ---------- */
function buildPvExtra(pv, detail, lang) {
  const type = pv.pv_type_id ? getPvType(pv.pv_type_id) : null;
  const ar = lang === 'ar';
  return {
    pv_number: String(pv.pv_number || ''),
    pv_title: String(pv.title || ''),
    pv_type: String(type ? (ar ? type.name_ar : type.name_fr) : ''),
    pv_status: String(pv.status || ''),
    pv_notes: String(pv.notes || ''),
    pv_created_date: pv.created_at ? String(pv.created_at).slice(0, 10) : ''
  };
}

/* ---------- تعبئة تلقائية من القالب + بيانات الإجراء ---------- */
function autofillContent(pv, detail, lang, templateVersionId, opts = {}) {
  const version = templateService.getVersion(templateVersionId || pv.template_version_id);
  const office = settingsService.getOffice();
  const user = auth.getCurrentUser();
  const l = lang === 'fr' ? 'fr' : 'ar';
  const context = engine.buildContext(detail, {
    lang: l,
    notes: opts.notes,
    office: { ...office, commissioner: opts.commissionerName || '' },
    user,
    extra: buildPvExtra(pv, detail, l)
  });
  return engine.resolveContent(version.content, context, { strict: false });
}

/* ---------- التحقق ---------- */
function validatePayload(input) {
  const errors = [];

  if (!input.procedure_id) {
    errors.push('procedure:required');
  } else if (!procedureService.getDetail(input.procedure_id)) {
    errors.push('procedure:notFound');
  }

  if (!input.pv_type_id) {
    errors.push('pvType:required');
  } else if (!getPvType(input.pv_type_id)) {
    errors.push('pvType:notFound');
  }

  if (!input.template_version_id) {
    errors.push('templateVersion:required');
  } else {
    try { templateService.getVersion(input.template_version_id); } catch (e) { errors.push('templateVersion:notFound'); }
  }

  if (input.notes !== undefined && typeof input.notes !== 'string') errors.push('notes:invalid');

  return errors;
}

/* ---------- إنشاء محضر ---------- */
function createPv(input, actorUser) {
  const errors = validatePayload(input);
  if (errors.length) throw new Error('VALIDATION:' + errors.join(','));
  const user = actorUser || auth.getCurrentUser();

  const detail = procedureService.getDetail(input.procedure_id);
  const version = templateService.getVersion(input.template_version_id);
  const lang = input.language === 'fr' ? 'fr' : 'ar';
  const now = new Date().toISOString();
  const number = generatePvNumber();

  const type = getPvType(input.pv_type_id);
  const ar = lang === 'ar';
  const title = String(input.title || (ar ? type.name_ar : type.name_fr) || '').slice(0, 300);

  const pv = {
    pv_number: number,
    procedure_id: input.procedure_id,
    dossier_id: detail.dossier ? detail.dossier.id : null,
    pv_type_id: input.pv_type_id,
    template_id: version.template_id,
    template_version_id: version.id,
    status: 'DRAFT',
    title,
    language: lang,
    notes: String(input.notes || ''),
    created_at: now,
    created_by: user.username
  };

  pv.content = autofillContent(pv, detail, lang, version.id, { notes: pv.notes });

  const id = tx(() => {
    const res = run(
      `INSERT INTO pvs
        (pv_number, procedure_id, dossier_id, pv_type_id, template_id, template_version_id,
         status, title, language, content, notes, created_at, updated_at, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [pv.pv_number, pv.procedure_id, pv.dossier_id, pv.pv_type_id, pv.template_id,
       pv.template_version_id, pv.status, pv.title, pv.language, pv.content, pv.notes,
       pv.created_at, pv.created_at, pv.created_by]
    );
    const pvId = res.lastId;

    run(
      `INSERT INTO pv_versions (pv_id, version, content, variables, note, created_by, created_at)
       VALUES (?,?,?,?,?,?,?)`,
      [pvId, 1, pv.content, JSON.stringify(engine.extractVariables(version.content)),
       'الإنشاء من القالب', user.username, now]
    );

    recordTransition(pvId, '', 'DRAFT', 'إنشاء المحضر');
    pvAudit(pvId, 'pv.created', { number, procedure_id: input.procedure_id, template_version_id: version.id }, user);
    return pvId;
  });

  return getDetail(id);
}

/* ---------- إعادة التعبئة من القالب (مسودات فقط) ---------- */
function refreshFromTemplate(id, opts = {}) {
  const pv = get('SELECT * FROM pvs WHERE id = ?', [id]);
  if (!pv) throw new Error('NOT_FOUND:pv:' + id);
  if (pv.status !== 'DRAFT' && pv.status !== 'IN_REVIEW') {
    throw new Error('VALIDATION:pv:notEditable:' + pv.status);
  }
  const detail = procedureService.getDetail(pv.procedure_id);
  const content = autofillContent(pv, detail, pv.language, pv.template_version_id, opts);
  return saveContent(id, content, 'إعادة التعبئة من القالب');
}

/* ---------- حفظ المحتوى = نسخة جديدة ---------- */
function saveContent(id, content, note = '') {
  const pv = get('SELECT * FROM pvs WHERE id = ?', [id]);
  if (!pv) throw new Error('NOT_FOUND:pv:' + id);
  if (pv.status !== 'DRAFT' && pv.status !== 'IN_REVIEW') {
    throw new Error('VALIDATION:pv:notEditable:' + pv.status);
  }
  const html = String(content || '').trim();
  if (!html) throw new Error('VALIDATION:pv:contentRequired');

  const user = auth.getCurrentUser();
  const now = new Date().toISOString();

  return tx(() => {
    const maxRow = get('SELECT COALESCE(MAX(version),0) AS v FROM pv_versions WHERE pv_id = ?', [id]);
    const nextVersion = Number(maxRow.v) + 1;

    run(
      `INSERT INTO pv_versions (pv_id, version, content, variables, note, created_by, created_at)
       VALUES (?,?,?,?,?,?,?)`,
      [id, nextVersion, html, '[]', String(note || ('النسخة ' + nextVersion)), user.username, now]
    );
    run('UPDATE pvs SET content = ?, updated_at = ? WHERE id = ?', [html, now, id]);
    pvAudit(id, 'pv.content_updated', { version: nextVersion, note }, user);
    return getDetail(id);
  });
}

/* ---------- تحديث بيانات وصفية (مسودات فقط) ---------- */
function updateMeta(id, input) {
  const pv = get('SELECT * FROM pvs WHERE id = ?', [id]);
  if (!pv) throw new Error('NOT_FOUND:pv:' + id);
  if (pv.status !== 'DRAFT' && pv.status !== 'IN_REVIEW') {
    throw new Error('VALIDATION:pv:notEditable:' + pv.status);
  }

  const title = input.title !== undefined ? String(input.title || '').slice(0, 300) : pv.title;
  const notes = input.notes !== undefined ? String(input.notes || '') : pv.notes;
  let pvTypeId = pv.pv_type_id;
  if (input.pv_type_id) {
    if (!getPvType(input.pv_type_id)) throw new Error('VALIDATION:pvType:notFound');
    pvTypeId = input.pv_type_id;
  }

  const now = new Date().toISOString();
  run('UPDATE pvs SET title = ?, notes = ?, pv_type_id = ?, updated_at = ? WHERE id = ?',
    [title, notes, pvTypeId, now, id]);
  pvAudit(id, 'pv.meta_updated', { title, notes, pv_type_id: pvTypeId });
  return getDetail(id);
}

/* ---------- تغيير الحالة (الانتقالات فقط) ---------- */
function applyStatus(id, toStatus, note = '') {
  const pv = get('SELECT * FROM pvs WHERE id = ?', [id]);
  if (!pv) throw new Error('NOT_FOUND:pv:' + id);
  if (!getStatus(toStatus)) throw new Error('VALIDATION:pvStatus:notFound:' + toStatus);
  if (!canTransition(pv.status, toStatus)) {
    throw new Error(`VALIDATION:pvStatus:notAllowed:${pv.status}->${toStatus}`);
  }

  const user = auth.getCurrentUser();
  const now = new Date().toISOString();

  return tx(() => {
    run('UPDATE pvs SET status = ?, updated_at = ? WHERE id = ?', [toStatus, now, id]);

    if (toStatus === 'FINALIZED') {
      run('UPDATE pvs SET finalized_at = COALESCE(finalized_at, ?), finalized_by = ? WHERE id = ?', [now, user.username, id]);
      // ربط المحضر المُنهى بإدخال السجل اليومي (إن وُجد)
      registersService.linkPvToDaily(pv.procedure_id, id, pv.pv_number);
    }
    if (toStatus === 'ARCHIVED') {
      run('UPDATE pvs SET archived_at = COALESCE(archived_at, ?), archived_by = ? WHERE id = ?', [now, user.username, id]);
    }
    if (toStatus === 'CANCELLED') {
      run('UPDATE pvs SET cancelled_at = COALESCE(cancelled_at, ?), cancelled_by = ? WHERE id = ?', [now, user.username, id]);
    }

    recordTransition(id, pv.status, toStatus, note);
    pvAudit(id, 'pv.status_changed', { from: pv.status, to: toStatus, note }, user);
    return getDetail(id);
  });
}

/* ---------- إنشاء نظائر المحضر (النسخ) ---------- */
const DEFAULT_COPIES = [
  { destination: 'applicant', labelAr: 'نسخة الطالب', labelFr: 'Copie du requérant' },
  { destination: 'court', labelAr: 'نسخة المحكمة', labelFr: "Copie du tribunal" },
  { destination: 'archive', labelAr: 'نسخة أرشيف المكتب', labelFr: "Copie archive du cabinet" }
];

function createCopies(id, copies = null) {
  const pv = get('SELECT * FROM pvs WHERE id = ?', [id]);
  if (!pv) throw new Error('NOT_FOUND:pv:' + id);

  const list = copies && copies.length ? copies : DEFAULT_COPIES;
  const user = auth.getCurrentUser();

  return tx(() => {
    list.forEach((c, i) => {
      run(
        `INSERT OR IGNORE INTO pv_copies
          (pv_id, copy_number, destination, label_ar, label_fr, status)
         VALUES (?,?,?,?,?,'generated')`,
        [id, i + 1, c.destination, c.labelAr, c.labelFr]
      );
    });
    pvAudit(id, 'pv.copies_created', { count: list.length }, user);
    return getCopies(id);
  });
}

function getCopies(pvId) {
  return all('SELECT * FROM pv_copies WHERE pv_id = ? ORDER BY copy_number', [pvId]);
}

/* ---------- تحديث حالة نسخة ---------- */
function setCopyStatus(copyId, status, notes = '') {
  const copy = get('SELECT * FROM pv_copies WHERE id = ?', [copyId]);
  if (!copy) throw new Error('NOT_FOUND:pv_copy:' + copyId);

  const valid = ['generated', 'delivered', 'deposited'];
  if (!valid.includes(status)) throw new Error('VALIDATION:pvCopy:invalidStatus:' + status);

  const user = auth.getCurrentUser();
  const now = new Date().toISOString();
  const delivered = (status === 'delivered' || status === 'deposited') && !copy.delivered_at ? now : copy.delivered_at;
  const deliveredBy = (status === 'delivered' || status === 'deposited') && !copy.delivered_by ? user.username : copy.delivered_by;

  run(
    'UPDATE pv_copies SET status = ?, delivered_at = ?, delivered_by = ?, notes = ? WHERE id = ?',
    [status, delivered, deliveredBy, String(notes || copy.notes || ''), copyId]
  );
  pvAudit(copy.pv_id, 'pv.copy_status_changed', { copy_number: copy.copy_number, status });
  return get('SELECT * FROM pv_copies WHERE id = ?', [copyId]);
}

/* ---------- ربط وثيقة بالمحضر ---------- */
function addDocumentLink(pvId, documentId) {
  run('INSERT OR IGNORE INTO pv_documents (pv_id, document_id) VALUES (?,?)', [pvId, documentId]);
  return get('SELECT * FROM documents WHERE id = ?', [documentId]);
}

/* ---------- تفاصيل كاملة ---------- */
function getDetail(id) {
  const pv = get('SELECT * FROM pvs WHERE id = ?', [id]);
  if (!pv) throw new Error('NOT_FOUND:pv:' + id);

  const type = pv.pv_type_id ? getPvType(pv.pv_type_id) : null;
  const statusInfo = getStatus(pv.status);
  const versions = all('SELECT * FROM pv_versions WHERE pv_id = ? ORDER BY id DESC', [id]);
  const copies = getCopies(id);
  const documents = all(
    `SELECT doc.* FROM pv_documents pd
     JOIN documents doc ON doc.id = pd.document_id
     WHERE pd.pv_id = ? ORDER BY doc.id DESC`,
    [id]
  );
  const procedure = procedureService.getDetail(pv.procedure_id);
  const timeline = buildTimeline(id);

  return {
    ...pv,
    type,
    statusInfo,
    versions,
    copies,
    documents,
    procedure,
    timeline,
    transitions: allowedTransitions(pv.status)
  };
}

function buildTimeline(pvId) {
  const events = [];
  all('SELECT * FROM pv_status_history WHERE pv_id = ? ORDER BY id', [pvId]).forEach((h) => {
    events.push({
      type: 'status',
      date: h.changed_at,
      text: h.to_status + ' (from ' + (h.from_status || '-') + ')',
      desc: h.note,
      user: h.by_user,
      status: h.to_status
    });
  });
  all('SELECT * FROM pv_audit_logs WHERE pv_id = ? ORDER BY id', [pvId]).forEach((a) => {
    events.push({ type: 'audit', date: a.created_at, text: a.action, desc: a.metadata, user: a.by_user });
  });
  events.sort((a, b) => new Date(a.date) - new Date(b.date));
  return events;
}

/* ---------- قائمة مع فلاتر وبحث وصفحات ---------- */
function list(f = {}) {
  const where = [];
  const params = [];

  if (f.q && String(f.q).trim()) {
    const term = `%${String(f.q).trim()}%`;
    where.push(`(
      v.pv_number LIKE ? OR v.title LIKE ? OR v.notes LIKE ? OR
      p.procedure_number LIKE ? OR d.numero LIKE ? OR d.demandeur LIKE ? OR d.defendeur LIKE ?
    )`);
    params.push(term, term, term, term, term, term, term);
  }

  if (f.status) { where.push('v.status = ?'); params.push(String(f.status)); }
  if (f.pvTypeId) { where.push('v.pv_type_id = ?'); params.push(Number(f.pvTypeId)); }
  if (f.procedureId) { where.push('v.procedure_id = ?'); params.push(Number(f.procedureId)); }

  if (f.dateRange) {
    const now = new Date();
    let start = null;
    let end = null;
    const today = () => toSqlDate(now);
    const daysAgo = (n) => { const d = new Date(now); d.setDate(d.getDate() - n); return toSqlDate(d); };
    if (f.dateRange === 'today') { start = today(); end = today(); }
    else if (f.dateRange === 'week') { start = daysAgo(6); end = today(); }
    else if (f.dateRange === 'month') { start = daysAgo(30); end = today(); }
    else if (f.dateRange && f.dateRange.from) { start = f.dateRange.from; end = f.dateRange.to || today(); }
    if (start && end) {
      where.push('date(v.created_at) >= date(?) AND date(v.created_at) <= date(?)');
      params.push(start, end);
    }
  }

  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const base = `FROM pvs v
                JOIN procedures p ON p.id = v.procedure_id
                LEFT JOIN dossiers d ON d.id = v.dossier_id
                LEFT JOIN pv_types t ON t.id = v.pv_type_id ${whereSql}`;

  const total = get(`SELECT COUNT(*) AS c ${base}`, params).c;

  const pageNum = Math.max(1, Number(f.page) || 1);
  const size = Math.min(100, Number(f.pageSize) || 25);
  const offset = (pageNum - 1) * size;

  const rows = all(
    `SELECT v.*,
            d.numero AS dossier_number, d.demandeur AS dossier_demandeur, d.defendeur AS dossier_defendeur,
            p.procedure_number,
            t.code AS type_code, t.name_ar AS type_name_ar, t.name_fr AS type_name_fr,
            (SELECT COUNT(*) FROM pv_copies pc WHERE pc.pv_id = v.id) AS copies_count,
            (SELECT COUNT(*) FROM pv_copies pc2 WHERE pc2.pv_id = v.id AND pc2.status != 'generated') AS copies_delivered
     ${base} ORDER BY v.id DESC LIMIT ? OFFSET ?`,
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

/* ---------- إحصائيات ---------- */
function stats() {
  const total = get('SELECT COUNT(*) AS c FROM pvs').c;
  const drafts = get("SELECT COUNT(*) AS c FROM pvs WHERE status IN ('DRAFT','IN_REVIEW')").c;
  const finalized = get("SELECT COUNT(*) AS c FROM pvs WHERE status = 'FINALIZED'").c;
  const archived = get("SELECT COUNT(*) AS c FROM pvs WHERE status = 'ARCHIVED'").c;
  const cancelled = get("SELECT COUNT(*) AS c FROM pvs WHERE status = 'CANCELLED'").c;
  const today = get('SELECT COUNT(*) AS c FROM pvs WHERE date(created_at) = ?', [toSqlDate(new Date())]).c;

  const byStatus = {};
  all('SELECT status, COUNT(*) AS c FROM pvs GROUP BY status').forEach((r) => {
    byStatus[r.status] = Number(r.c);
  });

  const byType = all(
    `SELECT t.code, t.name_ar, t.name_fr, COUNT(*) AS c
     FROM pvs v LEFT JOIN pv_types t ON t.id = v.pv_type_id
     GROUP BY v.pv_type_id`
  );

  return { total, drafts, finalized, archived, cancelled, today, byStatus, byType };
}

/* ---------- حذف (مقيد) ---------- */
function deletePv(id) {
  auth.requireAuth('pv.delete');
  const pv = get('SELECT * FROM pvs WHERE id = ?', [id]);
  if (!pv) throw new Error('NOT_FOUND:pv:' + id);
  run('DELETE FROM pvs WHERE id = ?', [id]);
  audit.log({ action: 'pv.deleted', entity: 'pv', entityId: id, metadata: { number: pv.pv_number } });
  return true;
}

/* ---------- معاينة (HTML كامل للطباعة) ---------- */
function renderHtml(id, lang) {
  const pv = get('SELECT * FROM pvs WHERE id = ?', [id]);
  if (!pv) throw new Error('NOT_FOUND:pv:' + id);
  const l = lang === 'fr' ? 'fr' : lang === 'ar' ? 'ar' : pv.language;
  return engine.renderHtml(pv.title || pv.pv_number, pv.content || '', l);
}

module.exports = {
  generatePvNumber,
  listPvTypes, getPvType, updatePvType, listPvStatuses, updatePvStatus, listPvTransitions, getStatus,
  allowedTransitions, canTransition,
  createPv, getDetail, list, stats, updateMeta, saveContent,
  refreshFromTemplate, applyStatus, createCopies, getCopies, setCopyStatus,
  addDocumentLink, deletePv, renderHtml
};
