'use strict';

/* ================================================================
   ConfigService — الفئات/الأنواع/الحقول/الحالات/قوالب المحاضر.
   الأنواع والحقول قابلة للإضافة من Settings (Database-driven).
   ================================================================ */

const { get, all, run, tx } = require('../db/database').helpers;
const audit = require('./audit');
const { getCurrentUser } = require('./auth');

/* ---------- الفئات ---------- */
function listCategories(activeOnly = true) {
  return all(
    `SELECT * FROM procedure_categories ${activeOnly ? 'WHERE active = 1' : ''} ORDER BY sort_order, id`
  );
}

/* ---------- الحالات ---------- */
function listStatuses(activeOnly = true) {
  return all(
    `SELECT * FROM procedure_statuses ${activeOnly ? 'WHERE active = 1' : ''} ORDER BY sort_order`
  );
}

function listTransitions() {
  return all('SELECT * FROM procedure_status_transitions ORDER BY id');
}

function addStatus(code, nameAr, nameFr, color) {
  run('INSERT INTO procedure_statuses (code, name_ar, name_fr, color) VALUES (?,?,?,?)', [code, nameAr, nameFr, color]);
  audit.log({ action: 'status.created', entity: 'status', entityId: 0, metadata: { code } });
  return getStatus(code);
}

function updateStatus(code, { nameAr, nameFr, color, active }) {
  run(
    `UPDATE procedure_statuses SET name_ar = ?, name_fr = ?, color = ?, active = ? WHERE code = ?`,
    [nameAr, nameFr, color, active ? 1 : 0, code]
  );
  audit.log({ action: 'status.updated', entity: 'status', entityId: 0, metadata: { code } });
  return getStatus(code);
}

function getStatus(code) {
  return get('SELECT * FROM procedure_statuses WHERE code = ?', [code]);
}

/* ---------- أنواع الإجراءات (مع حقولها) ---------- */
function getType(id) {
  return get('SELECT * FROM procedure_types WHERE id = ?', [id]);
}

function getTypeByCode(code) {
  return get('SELECT * FROM procedure_types WHERE code = ?', [code]);
}

function listTypesByCategory(categoryId, activeOnly = true) {
  return all(
    `SELECT * FROM procedure_types WHERE category_id = ? ${activeOnly ? 'AND active = 1' : ''} ORDER BY sort_order, id`,
    [categoryId]
  );
}

function listTypesFull(activeOnly = true) {
  const types = all(
    `SELECT t.*, c.code AS category_code, c.name_ar AS category_name_ar, c.name_fr AS category_name_fr
     FROM procedure_types t
     JOIN procedure_categories c ON c.id = t.category_id
     ${activeOnly ? 'WHERE t.active = 1' : ''}
     ORDER BY c.sort_order, t.sort_order, t.id`
  );
  const fields = all(
    `SELECT * FROM procedure_fields ORDER BY procedure_type_id, sort_order, id`
  );
  const byType = {};
  fields.forEach((f) => {
    (byType[f.procedure_type_id] = byType[f.procedure_type_id] || []).push(f);
  });
  types.forEach((t) => {
    t.fields = byType[t.id] || [];
    if (t.fields.length) {
      t.fields.forEach((f) => {
        if (f.options) {
          try { f.options = JSON.parse(f.options); } catch (e) { f.options = []; }
        }
      });
    }
  });
  return types;
}

/* ---------- الحقول الديناميكية ---------- */
function listFieldsForType(typeId) {
  const rows = all('SELECT * FROM procedure_fields WHERE procedure_type_id = ? ORDER BY sort_order, id', [typeId]);
  rows.forEach((f) => {
    if (f.options) {
      try { f.options = JSON.parse(f.options); } catch (e) { f.options = []; }
    }
  });
  return rows;
}

function addType({ categoryId, code, nameAr, nameFr, descriptionAr = '', descriptionFr = '', fields = [] }) {
  if (!categoryId || !code || !nameAr || !nameFr) {
    throw new Error('VALIDATION:procedureType:missingRequired');
  }
  const existing = get('SELECT id FROM procedure_types WHERE code = ?', [code]);
  if (existing) throw new Error('VALIDATION:procedureType:codeExists:' + code);

  return tx(() => {
    const res = run(
      `INSERT INTO procedure_types (category_id, code, name_ar, name_fr, description_ar, description_fr, active, sort_order)
       VALUES (?,?,?,?,?,?,1, (SELECT COALESCE(MAX(sort_order),0)+1 FROM procedure_types))`,
      [categoryId, code, nameAr, nameFr, descriptionAr, descriptionFr]
    );
    (fields || []).forEach((f, i) => {
      run(
        `INSERT INTO procedure_fields (procedure_type_id, field_key, label_ar, label_fr, field_type, required, sort_order, options)
         VALUES (?,?,?,?,?,?,?,?)`,
        [res.lastId, f.fieldKey, f.labelAr, f.labelFr, f.fieldType || 'text', f.required ? 1 : 0, i + 1, JSON.stringify(f.options || [])]
      );
    });
    audit.log({ action: 'procedure_type.created', entity: 'procedure_type', entityId: res.lastId, metadata: { code } });
    return getType(res.lastId);
  });
}

function updateType(id, { nameAr, nameFr, descriptionAr, descriptionFr, active, categoryId }) {
  return tx(() => {
    run(
      `UPDATE procedure_types SET name_ar = ?, name_fr = ?, description_ar = ?, description_fr = ?, active = ?, category_id = ?
       WHERE id = ?`,
      [nameAr, nameFr, descriptionAr, descriptionFr, active ? 1 : 0, categoryId, id]
    );
    audit.log({ action: 'procedure_type.updated', entity: 'procedure_type', entityId: id });
    return getType(id);
  });
}

/* ---------- قوالب المحاضر ---------- */
function listPvTemplates(activeOnly = true) {
  return all(
    `SELECT * FROM pv_templates ${activeOnly ? 'WHERE active = 1' : ''} ORDER BY sort_order, id`
  );
}

/* ---------- إحصائيات التكوين ---------- */
function configSnapshot(scope = 'all') {
  const snap = {};
  if (scope === 'all' || scope === 'categories') snap.categories = listCategories();
  if (scope === 'all' || scope === 'types') snap.types = listTypesFull();
  if (scope === 'all' || scope === 'statuses') { snap.statuses = listStatuses(); snap.transitions = listTransitions(); }
  if (scope === 'all' || scope === 'templates') snap.templates = listPvTemplates();
  if (scope === 'all' || scope === 'users') snap.users = require('./auth').listUsers();
  return snap;
}

module.exports = {
  listCategories, listStatuses, listTransitions, getStatus,
  addStatus, updateStatus,
  getType, getTypeByCode, listTypesByCategory, listTypesFull, listFieldsForType,
  addType, updateType, listPvTemplates, configSnapshot,
};
