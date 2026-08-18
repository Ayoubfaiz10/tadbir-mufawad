'use strict';

/* ================================================================
   TemplateService — مكتبة النماذج (Template Engine متكامل مع DB).
   إضافة/تعديل/نسخ/تفعيل/أرشفة + النسخ Versioning + فلاتر/بحث/إحصائيات
   + اقتراح النموذج المناسب لنوع إجراء + تحضير العرض/التوليد.
   ================================================================ */

const { get, all, run, tx } = require('../db/database').helpers;
const audit = require('./audit');
const auth = require('./auth');
const settingsService = require('./settingsService');
const procedureService = require('./procedureService');
const engine = require('./templateEngineService');

function parseVersion(v) {
  const parts = String(v).split('.');
  return {
    major: parseInt(parts[0], 10) || 0,
    minor: parseInt(parts[1], 10) || 0
  };
}

function versionBump(current, major = false) {
  const { major: ma, minor: mi } = parseVersion(current || '1.0');
  if (major) return `${ma + 1}.0`;
  return `${ma}.${mi + 1}`;
}

/* ---------- قائمة مع فلاتر وبحث وإحصائيات ---------- */
function list(f = {}) {
  const where = ['dt.archived = ?'];
  const params = [Number(f.includeArchived) ? 1 : 0];

  if (f.q && String(f.q).trim()) {
    const term = `%${String(f.q).trim()}%`;
    where.push(`(dt.name LIKE ? OR dt.description LIKE ? OR tc.name_ar LIKE ? OR tc.name_fr LIKE ?
                OR pt.name_ar LIKE ? OR pt.name_fr LIKE ?)`);
    params.push(term, term, term, term, term, term);
  }
  if (f.language) { where.push('dt.language = ?'); params.push(f.language); }
  if (f.category) { where.push('dt.category_id = ?'); params.push(Number(f.category)); }
  if (f.procedureTypeId) { where.push('dt.procedure_type_id = ?'); params.push(Number(f.procedureTypeId)); }
  if (f.status === 'active') { where.push('dt.active = 1'); }
  else if (f.status === 'inactive') { where.push('dt.active = 0'); }

  const whereSql = 'WHERE ' + where.join(' AND ');
  const total = get(`SELECT COUNT(*) AS c FROM document_templates dt
                     LEFT JOIN template_categories tc ON tc.id = dt.category_id
                     LEFT JOIN procedure_types pt ON pt.id = dt.procedure_type_id ${whereSql}`, params).c;

  const pageNum = Math.max(1, Number(f.page) || 1);
  const size = Math.min(100, Number(f.pageSize) || 25);
  const offset = (pageNum - 1) * size;

  const rows = all(
    `SELECT dt.*,
            tc.code AS category_code, tc.name_ar AS category_name_ar, tc.name_fr AS category_name_fr,
            pt.code AS type_code, pt.name_ar AS type_name_ar, pt.name_fr AS type_name_fr,
            tv.version AS current_version, tv.created_at AS version_created_at,
            (SELECT COUNT(*) FROM template_versions v2 WHERE v2.template_id = dt.id) AS versions_count
     FROM document_templates dt
     LEFT JOIN template_categories tc ON tc.id = dt.category_id
     LEFT JOIN procedure_types pt ON pt.id = dt.procedure_type_id
     LEFT JOIN template_versions tv ON tv.id = dt.current_version_id
     ${whereSql}
     ORDER BY dt.updated_at DESC LIMIT ? OFFSET ?`,
    [...params, size, offset]
  );
  return { rows, total, page: pageNum, pageSize: size };
}

function stats() {
  const total = get('SELECT COUNT(*) AS c FROM document_templates').c;
  const active = get('SELECT COUNT(*) AS c FROM document_templates WHERE active = 1 AND archived = 0').c;
  const inactive = get('SELECT COUNT(*) AS c FROM document_templates WHERE active = 0 AND archived = 0').c;
  const archived = get('SELECT COUNT(*) AS c FROM document_templates WHERE archived = 1').c;
  const recent = all('SELECT * FROM document_templates ORDER BY created_at DESC LIMIT 5');
  return { total, active, inactive, archived, recent };
}

/* ---------- قراءة ---------- */
function getTemplate(id) {
  const t = get('SELECT * FROM document_templates WHERE id = ?', [id]);
  if (!t) throw new Error('NOT_FOUND:template:' + id);
  const versions = all(
    'SELECT * FROM template_versions WHERE template_id = ? ORDER BY created_at DESC, id DESC',
    [id]
  );
  const current = t.current_version_id ? get('SELECT * FROM template_versions WHERE id = ?', [t.current_version_id]) : null;
  const category = t.category_id ? get('SELECT * FROM template_categories WHERE id = ?', [t.category_id]) : null;
  const type = t.procedure_type_id ? get('SELECT * FROM procedure_types WHERE id = ?', [t.procedure_type_id]) : null;
  return { ...t, versions, current, category, type };
}

function getVersion(id) {
  const v = get('SELECT * FROM template_versions WHERE id = ?', [id]);
  if (!v) throw new Error('NOT_FOUND:template_version:' + id);
  const t = get('SELECT * FROM document_templates WHERE id = ?', [v.template_id]);
  return { ...v, template: t || null };
}

function listCategories() {
  return all('SELECT * FROM template_categories ORDER BY sort_order, id');
}

/* ---------- إضافة ---------- */
function add(input) {
  auth.requireAuth('template.manage');
  const name = String(input.name || '').trim();
  const content = String(input.content || '');
  if (!name) throw new Error('VALIDATION:template:name');
  if (!content.trim()) throw new Error('VALIDATION:template:content');

  const now = new Date().toISOString();
  const version = input.version && /^\d+\.\d+$/.test(String(input.version)) ? String(input.version) : '1.0';
  const user = auth.getCurrentUser();

  return tx(() => {
    const tpl = run(
      `INSERT INTO document_templates (name, category_id, procedure_type_id, language, description, active, archived, current_version_id, created_by, created_at, updated_at)
       VALUES (?,?,?,?,?,?,0,0,?,?,?)`,
      [name, input.categoryId ? Number(input.categoryId) : null,
       input.procedureTypeId ? Number(input.procedureTypeId) : null,
       String(input.language === 'fr' ? 'fr' : 'ar'),
       String(input.description || ''), Number(input.active) ? 1 : 0,
       user.username, now, now]
    ).lastId;
    const ver = run(
      `INSERT INTO template_versions (template_id, version, content, variables, note, created_by, created_at)
       VALUES (?,?,?,?,?,?,?)`,
      [tpl, version, content, JSON.stringify(engine.extractVariables(content)),
       String(input.note || 'النسخة الأولى'), user.username, now]
    ).lastId;
    run('UPDATE document_templates SET current_version_id = ? WHERE id = ?', [ver, tpl]);
    audit.log({ action: 'template.created', entity: 'template', entityId: tpl, metadata: { name, version } });
    return getTemplate(tpl);
  });
}

/* ---------- تعديل: كل تغيير في المحتوى يُنشئ نسخة جديدة ---------- */
function update(id, input) {
  auth.requireAuth('template.manage');
  const existing = getTemplate(id);
  const now = new Date().toISOString();
  const user = auth.getCurrentUser();
  const currentContent = existing.current ? existing.current.content : '';

  const name = input.name !== undefined ? String(input.name).trim() : existing.name;
  if (!name) throw new Error('VALIDATION:template:name');

  return tx(() => {
    run(
      `UPDATE document_templates SET name = ?, category_id = ?, procedure_type_id = ?, language = ?,
       description = ?, active = ?, updated_at = ? WHERE id = ?`,
      [name,
       input.categoryId !== undefined ? (input.categoryId ? Number(input.categoryId) : null) : existing.category_id,
       input.procedureTypeId !== undefined ? (input.procedureTypeId ? Number(input.procedureTypeId) : null) : existing.procedure_type_id,
       input.language !== undefined ? String(input.language === 'fr' ? 'fr' : 'ar') : existing.language,
       input.description !== undefined ? String(input.description) : existing.description,
       input.active !== undefined ? (Number(input.active) ? 1 : 0) : existing.active,
       now, id]
    );

    const content = input.content !== undefined ? String(input.content) : currentContent;
    const changedContent = content !== currentContent;
    if (changedContent || input.newVersion) {
      let version = String(input.version || versionBump(existing.current ? existing.current.version : '1.0', input.major)).trim();
      if (!/^\d+\.\d+$/.test(version)) version = versionBump(existing.current ? existing.current.version : '1.0', input.major);
      const ver = run(
        `INSERT INTO template_versions (template_id, version, content, variables, note, created_by, created_at)
         VALUES (?,?,?,?,?,?,?)`,
        [id, version, content, JSON.stringify(engine.extractVariables(content)),
         String(input.note || (changedContent ? 'تحرير المحتوى' : 'نسخة جديدة')), user.username, now]
      ).lastId;
      run('UPDATE document_templates SET current_version_id = ? WHERE id = ?', [ver, id]);
    }

    audit.log({ action: 'template.updated', entity: 'template', entityId: id, metadata: { name } });
    return getTemplate(id);
  });
}

/* ---------- تفعيل/تعطيل ---------- */
function setActive(id, active) {
  auth.requireAuth('template.manage');
  run('UPDATE document_templates SET active = ?, updated_at = datetime(\'now\') WHERE id = ?', [active ? 1 : 0, id]);
  audit.log({ action: 'template.active_changed', entity: 'template', entityId: id, metadata: { active: active ? 1 : 0 } });
  return getTemplate(id);
}

/* ---------- أرشفة (حذف ناعم — تبقى الوثائق القديمة محفوظة) ---------- */
function setArchived(id, archived) {
  auth.requireAuth('template.manage');
  run('UPDATE document_templates SET archived = ?, active = ?, updated_at = datetime(\'now\') WHERE id = ?',
    [archived ? 1 : 0, archived ? 0 : 1, id]);
  audit.log({ action: 'template.archived', entity: 'template', entityId: id, metadata: { archived: archived ? 1 : 0 } });
  return getTemplate(id);
}

/* ---------- نسخ النموذج ---------- */
function duplicate(id, input = {}) {
  auth.requireAuth('template.manage');
  const src = getTemplate(id);
  const content = src.current ? src.current.content : '';
  const lang = input.language || src.language;
  const name = String(input.name || (src.name + ' (نسخة)'));

  return tx(() => {
    const tpl = run(
      `INSERT INTO document_templates (name, category_id, procedure_type_id, language, description, active, archived, current_version_id, created_by)
       VALUES (?,?,?,?,?,1,0,0,?)`,
      [name, src.category_id, src.procedure_type_id, lang, src.description,
       auth.getCurrentUser().username]
    ).lastId;
    const ver = run(
      `INSERT INTO template_versions (template_id, version, content, variables, note, created_by)
       VALUES (?,?,?,?,?,?)`,
      [tpl, '1.0', content, JSON.stringify(engine.extractVariables(content)), 'نسخة منسوخة', auth.getCurrentUser().username]
    ).lastId;
    run('UPDATE document_templates SET current_version_id = ? WHERE id = ?', [ver, tpl]);
    audit.log({ action: 'template.duplicated', entity: 'template', entityId: tpl, metadata: { from: id } });
    return getTemplate(tpl);
  });
}

/* ---------- اقتراح النموذج المناسب لنوع إجراء ---------- */
function forProcedure(procedureTypeId, lang) {
  const type = get('SELECT * FROM procedure_types WHERE id = ?', [procedureTypeId]);
  if (!type) return [];
  return all(
    `SELECT dt.*,
            tc.code AS category_code, tc.name_ar AS category_name_ar, tc.name_fr AS category_name_fr,
            tv.version AS current_version
     FROM document_templates dt
     LEFT JOIN template_categories tc ON tc.id = dt.category_id
     LEFT JOIN template_versions tv ON tv.id = dt.current_version_id
     WHERE dt.archived = 0 AND dt.active = 1
       AND (dt.procedure_type_id = ? OR tc.code = ?)
     ORDER BY dt.procedure_type_id DESC, dt.language DESC`,
    [type.id, type.code]
  );
}

/* ---------- معجم المتغيرات ---------- */
function variables() {
  return { variables: engine.VARIABLES, groups: engine.GROUPS };
}

const EMPTY_DETAIL = {
  dossier: {}, parties: [], fieldValues: [],
  type: { name_ar: '', name_fr: '' },
  category: { name_ar: '', name_fr: '' },
  procedure_number: '', status: '', amount: 0, currency: 'MAD', notes: '', created_at: null
};

/* ---------- تحضير العرض/التوليد ---------- */
function getRenderPayload(versionId, procedureId, opts = {}) {
  const version = getVersion(versionId);
  const detail = (procedureId ? procedureService.getDetail(procedureId) : null) || EMPTY_DETAIL;
  const office = settingsService.getOffice();
  const user = auth.getCurrentUser();
  const lang = opts.lang === 'fr' ? 'fr' : (version.template.language === 'fr' ? 'fr' : 'ar');
  const context = engine.buildContext(detail, {
    lang,
    notes: opts.notes,
    office: { ...office, commissioner: opts.commissionerName || '' },
    user,
    payment: opts.payment || null
  });
  const resolved = engine.resolveContent(version.content, context, { strict: opts.strict === true });
  return {
    template: version.template,
    version,
    detail,
    lang,
    title: version.template.name,
    context,
    resolvedContent: resolved
  };
}

/* ---------- معاينة مسودة (محتوى غير محفوظ من المحرر) ---------- */
function renderDraft(html, lang) {
  const office = settingsService.getOffice();
  const user = auth.getCurrentUser();
  const l = lang === 'fr' ? 'fr' : 'ar';
  const context = engine.buildContext(EMPTY_DETAIL, {
    lang: l,
    office: { ...office, commissioner: user.display_name || user.username },
    user
  });
  const resolved = engine.resolveContent(html || '', context, { strict: true });
  return engine.renderHtml('', resolved, l);
}

module.exports = {
  list, stats, get: getTemplate, getVersion, listCategories, add, update,
  setActive, setArchived, duplicate, forProcedure, variables,
  getRenderPayload, renderDraft, versionBump
};
