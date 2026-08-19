'use strict';

/* ================================================================
   DocumentService — نظام إدارة الوثائق المركزي
   CRUD, search, audit, soft delete, versioning, tags, relations.
   ================================================================ */

const fs = require('fs');
const path = require('path');
const { BrowserWindow, shell, dialog, app } = require('electron');

const { get, all, run } = require('../db/database').helpers;
const audit = require('./audit');
const procedureService = require('./procedureService');
const paymentService = require('./paymentService');
const registersService = require('./registersService');
const templates = require('./templates');
const templateService = require('./templateService');
const engine = require('./templateEngineService');
const archiveStorage = require('./archiveStorage');
const { requireAuth } = require('./auth');

let outputDir = '';

function setOutputDir(dir) {
  outputDir = dir;
  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
}

function getOutputDir() { return outputDir; }

/* ---------- PDF Rendering ---------- */
function renderToPdf(html) {
  return new Promise((resolve, reject) => {
    const win = new BrowserWindow({
      show: false,
      width: 900,
      height: 1200,
      webPreferences: { nodeIntegration: false, contextIsolation: true }
    });

    win.webContents.on('did-finish-load', async () => {
      try {
        const buf = await win.webContents.printToPDF({ pageSize: 'A4', printBackground: true, preferCSSPageSize: true });
        win.destroy();
        resolve(buf);
      } catch (e) {
        win.destroy();
        reject(e);
      }
    });
    win.webContents.on('did-fail-load', (e, code, desc) => {
      win.destroy();
      reject(new Error('PDF:LOAD_FAILED:' + desc));
    });

    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html)).catch(reject);
  });
}

function safeName(s) {
  return String(s).replace(/[\\/:*?"<>|]/g, '_').slice(0, 80);
}

function outputPath(name) {
  return path.join(outputDir, safeName(name));
}

/* ================================================================
   DOCUMENT MANAGEMENT — Central System
   ================================================================ */

/* ---------- Generate Next Doc Number ---------- */
function nextDocNumber(typeCode) {
  const year = new Date().getFullYear();
  const row = get(
    "SELECT COUNT(*) AS c FROM documents_v2 WHERE doc_number LIKE ? AND deleted_at IS NULL",
    [`${typeCode}-${year}-%`]
  );
  const seq = (row ? row.c : 0) + 1;
  return archiveStorage.generateDocNumber(typeCode, seq, year);
}

/* ---------- Create Document ---------- */
function createDocument(input) {
  const typeRow = input.document_type_id
    ? get('SELECT * FROM document_types WHERE id = ?', [input.document_type_id])
    : null;
  const typeCode = typeRow ? typeRow.code : 'DOC';
  const docNumber = nextDocNumber(typeCode);
  const user = require('./auth').getCurrentUser();
  const now = new Date().toISOString();
  const period = archiveStorage.periodKey(now);

  const res = run(
    `INSERT INTO documents_v2 (
      doc_number, document_type_id, title, description, status,
      file_name, storage_name, file_path, original_name, mime, size_bytes, sha256,
      entity_type, entity_id, dossier_id, procedure_id, pv_id,
      version, is_latest, language, period_key,
      deleted_at, deleted_by, locked, source,
      template_id, template_version_id, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'active',
      ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      1, 1, ?, ?,
      NULL, '', 0, ?,
      ?, ?, ?, ?, ?)`,
    [
      docNumber,
      input.document_type_id || null,
      input.title || '',
      input.description || '',
      input.file_name || '',
      input.storage_name || '',
      input.file_path || '',
      input.original_name || '',
      input.mime || 'application/pdf',
      input.size_bytes || 0,
      input.sha256 || '',
      input.entity_type || '',
      input.entity_id || 0,
      input.dossier_id || null,
      input.procedure_id || null,
      input.pv_id || null,
      input.language || 'ar',
      period,
      input.source || 'manual',
      input.template_id || 0,
      input.template_version_id || 0,
      user ? user.username : 'system',
      now,
      now
    ]
  );

  const doc = get('SELECT * FROM documents_v2 WHERE id = ?', [res.lastId]);
  audit.log({
    action: 'document.created', entity: 'document', entityId: res.lastId,
    metadata: { doc_number: docNumber, title: input.title, type: typeCode }
  });
  return doc;
}

/* ---------- Save Document (legacy compatibility) ---------- */
function saveDocument({ procedureId, kind, title, filePath, templateId, templateVersionId }) {
  const typeRow = get("SELECT id FROM document_types WHERE code = ?", [kind ? kind.toUpperCase() : 'DOC']);
  return createDocument({
    document_type_id: typeRow ? typeRow.id : null,
    title: title || '',
    file_name: path.basename(filePath || ''),
    file_path: filePath || '',
    original_name: path.basename(filePath || ''),
    mime: 'application/pdf',
    size_bytes: filePath && fs.existsSync(filePath) ? fs.statSync(filePath).size : 0,
    entity_type: 'procedure',
    entity_id: procedureId || 0,
    procedure_id: procedureId || null,
    source: 'generated',
    template_id: templateId || 0,
    template_version_id: templateVersionId || 0
  });
}

/* ---------- Get Document ---------- */
function getDoc(id) {
  const doc = get('SELECT * FROM documents_v2 WHERE id = ? AND deleted_at IS NULL', [id]);
  if (doc && doc.document_type_id) {
    doc.type_info = get('SELECT * FROM document_types WHERE id = ?', [doc.document_type_id]);
  }
  if (doc) {
    doc.tags = all(
      `SELECT t.* FROM document_tags t
       JOIN document_tag_relations r ON r.tag_id = t.id
       WHERE r.document_id = ?`, [id]
    );
  }
  return doc;
}

/* ---------- Update Document ---------- */
function updateDoc(id, input) {
  const doc = get('SELECT * FROM documents_v2 WHERE id = ? AND deleted_at IS NULL', [id]);
  if (!doc) throw new Error('DOC:NOT_FOUND');
  if (doc.locked) throw new Error('DOC:LOCKED');

  const fields = [];
  const values = [];

  if (input.title !== undefined) { fields.push('title = ?'); values.push(input.title); }
  if (input.description !== undefined) { fields.push('description = ?'); values.push(input.description); }
  if (input.document_type_id !== undefined) { fields.push('document_type_id = ?'); values.push(input.document_type_id); }
  if (input.status !== undefined) { fields.push('status = ?'); values.push(input.status); }
  if (input.language !== undefined) { fields.push('language = ?'); values.push(input.language); }
  if (input.entity_type !== undefined) { fields.push('entity_type = ?'); values.push(input.entity_type); }
  if (input.entity_id !== undefined) { fields.push('entity_id = ?'); values.push(input.entity_id); }
  if (input.dossier_id !== undefined) { fields.push('dossier_id = ?'); values.push(input.dossier_id); }
  if (input.procedure_id !== undefined) { fields.push('procedure_id = ?'); values.push(input.procedure_id); }

  fields.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);

  run(`UPDATE documents_v2 SET ${fields.join(', ')} WHERE id = ?`, values);

  audit.log({
    action: 'document.updated', entity: 'document', entityId: id,
    old_value: JSON.stringify({ title: doc.title }),
    new_value: JSON.stringify({ title: input.title || doc.title })
  });

  return getDoc(id);
}

/* ---------- Soft Delete ---------- */
function deleteDoc(id) {
  const doc = get('SELECT * FROM documents_v2 WHERE id = ?', [id]);
  if (!doc) throw new Error('DOC:NOT_FOUND');
  if (doc.locked) throw new Error('DOC:LOCKED');

  const user = require('./auth').getCurrentUser();
  run(
    "UPDATE documents_v2 SET deleted_at = datetime('now'), deleted_by = ?, updated_at = datetime('now') WHERE id = ?",
    [user ? user.username : 'system', id]
  );

  audit.log({
    action: 'document.deleted', entity: 'document', entityId: id,
    metadata: { doc_number: doc.doc_number, title: doc.title }
  });
  return true;
}

/* ---------- Permanent Delete ---------- */
function permanentDeleteDoc(id) {
  requireAuth('document.delete');
  const doc = get('SELECT * FROM documents_v2 WHERE id = ?', [id]);
  if (!doc) throw new Error('DOC:NOT_FOUND');
  if (doc.locked) throw new Error('DOC:LOCKED');

  if (doc.file_path && fs.existsSync(doc.file_path)) {
    archiveStorage.deleteFile(doc.file_path);
  }
  run('DELETE FROM document_versions WHERE document_id = ?', [id]);
  run('DELETE FROM document_tag_relations WHERE document_id = ?', [id]);
  run('DELETE FROM document_audit_logs WHERE document_id = ?', [id]);
  run('DELETE FROM document_relations WHERE from_doc_id = ? OR to_doc_id = ?', [id, id]);
  run('DELETE FROM documents_v2 WHERE id = ?', [id]);

  audit.log({ action: 'document.permanent_delete', entity: 'document', entityId: id });
  return true;
}

/* ---------- Restore Deleted ---------- */
function restoreDoc(id) {
  const doc = get('SELECT * FROM documents_v2 WHERE id = ?', [id]);
  if (!doc || !doc.deleted_at) throw new Error('DOC:NOT_DELETED');

  run("UPDATE documents_v2 SET deleted_at = NULL, deleted_by = '', updated_at = datetime('now') WHERE id = ?", [id]);
  audit.log({ action: 'document.restored', entity: 'document', entityId: id });
  return getDoc(id);
}

/* ---------- Lock/Unlock (Tamper Seal) ---------- */
function lockDoc(id) {
  const doc = get('SELECT * FROM documents_v2 WHERE id = ?', [id]);
  if (!doc) throw new Error('DOC:NOT_FOUND');

  const user = require('./auth').getCurrentUser();
  run(
    "UPDATE documents_v2 SET locked = 1, locked_at = datetime('now'), locked_by = ?, updated_at = datetime('now') WHERE id = ?",
    [user ? user.username : 'system', id]
  );
  audit.log({ action: 'document.locked', entity: 'document', entityId: id });
  return getDoc(id);
}

function unlockDoc(id) {
  const doc = get('SELECT * FROM documents_v2 WHERE id = ?', [id]);
  if (!doc) throw new Error('DOC:NOT_FOUND');

  run("UPDATE documents_v2 SET locked = 0, locked_at = NULL, locked_by = '', updated_at = datetime('now') WHERE id = ?", [id]);
  audit.log({ action: 'document.unlocked', entity: 'document', entityId: id });
  return getDoc(id);
}

/* ---------- Versioning ---------- */
function addVersion(documentId, buffer, originalName, note, user) {
  const doc = get('SELECT * FROM documents_v2 WHERE id = ?', [documentId]);
  if (!doc) throw new Error('DOC:NOT_FOUND');

  const nextVer = doc.version + 1;
  const result = archiveStorage.storeFile(buffer, originalName);

  run(
    `INSERT INTO document_versions (document_id, version, file_name, storage_name, file_path, original_name, mime, size_bytes, sha256, note, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [documentId, nextVer - 1, path.basename(result.filePath), result.storageName, result.filePath,
     result.originalName, result.mime, result.sizeBytes, result.sha256, note || '', user || 'system']
  );

  run(
    `UPDATE documents_v2 SET
      file_name = ?, storage_name = ?, file_path = ?, original_name = ?,
      mime = ?, size_bytes = ?, sha256 = ?, version = ?, is_latest = 1,
      updated_at = datetime('now')
     WHERE id = ?`,
    [path.basename(result.filePath), result.storageName, result.filePath, result.originalName,
     result.mime, result.sizeBytes, result.sha256, nextVer, documentId]
  );

  audit.log({
    action: 'document.version_added', entity: 'document', entityId: documentId,
    metadata: { version: nextVer, note }
  });

  return getDoc(documentId);
}

function listVersions(documentId) {
  return all(
    'SELECT * FROM document_versions WHERE document_id = ? ORDER BY version DESC', [documentId]
  );
}

/* ---------- Tags ---------- */
function addTag(documentId, tagName, tagColor) {
  let tag = get('SELECT * FROM document_tags WHERE name = ?', [tagName]);
  if (!tag) {
    const res = run('INSERT INTO document_tags (name, color) VALUES (?, ?)', [tagName, tagColor || '#1f4e8c']);
    tag = get('SELECT * FROM document_tags WHERE id = ?', [res.lastId]);
  }
  try {
    run('INSERT OR IGNORE INTO document_tag_relations (document_id, tag_id) VALUES (?, ?)', [documentId, tag.id]);
  } catch (e) {}
  return tag;
}

function removeTag(documentId, tagId) {
  run('DELETE FROM document_tag_relations WHERE document_id = ? AND tag_id = ?', [documentId, tagId]);
}

function listTags() {
  return all('SELECT * FROM document_tags ORDER BY name');
}

/* ---------- Relations ---------- */
function addRelation(fromDocId, toDocId, relationType, note) {
  run(
    'INSERT OR REPLACE INTO document_relations (from_doc_id, to_doc_id, relation_type, note) VALUES (?, ?, ?, ?)',
    [fromDocId, toDocId, relationType || 'related', note || '']
  );
}

function removeRelation(fromDocId, toDocId, relationType) {
  run('DELETE FROM document_relations WHERE from_doc_id = ? AND to_doc_id = ? AND relation_type = ?',
    [fromDocId, toDocId, relationType || 'related']);
}

function listRelations(documentId) {
  return all(
    `SELECT r.*, d.doc_number, d.title, dt.name_ar AS type_name_ar, dt.name_fr AS type_name_fr
     FROM document_relations r
     JOIN documents_v2 d ON (d.id = r.to_doc_id AND r.from_doc_id = ?) OR (d.id = r.from_doc_id AND r.to_doc_id = ?)
     LEFT JOIN document_types dt ON dt.id = d.document_type_id
     WHERE (r.from_doc_id = ? OR r.to_doc_id = ?) AND d.deleted_at IS NULL`,
    [documentId, documentId, documentId, documentId]
  );
}

/* ---------- Audit Log ---------- */
function logAudit(documentId, action, oldValue, newValue, metadata) {
  const user = require('./auth').getCurrentUser();
  run(
    `INSERT INTO document_audit_logs (document_id, action, by_user, old_value, new_value, metadata)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [documentId, action, user ? user.username : 'system',
     oldValue || '', newValue || '', metadata || '']
  );
}

function getAuditLog(documentId, limit) {
  return all(
    'SELECT * FROM document_audit_logs WHERE document_id = ? ORDER BY created_at DESC LIMIT ?',
    [documentId, limit || 50]
  );
}

/* ---------- Search ---------- */
function searchDocuments(query, filters = {}) {
  let where = ['d.deleted_at IS NULL'];
  const params = [];

  if (query) {
    where.push('(d.doc_number LIKE ? OR d.title LIKE ? OR d.description LIKE ? OR d.original_name LIKE ?)');
    const q = `%${query}%`;
    params.push(q, q, q, q);
  }

  if (filters.status) { where.push('d.status = ?'); params.push(filters.status); }
  if (filters.document_type_id) { where.push('d.document_type_id = ?'); params.push(filters.document_type_id); }
  if (filters.language) { where.push('d.language = ?'); params.push(filters.language); }
  if (filters.entity_type) { where.push('d.entity_type = ?'); params.push(filters.entity_type); }
  if (filters.entity_id) { where.push('d.entity_id = ?'); params.push(filters.entity_id); }
  if (filters.dossier_id) { where.push('d.dossier_id = ?'); params.push(filters.dossier_id); }
  if (filters.procedure_id) { where.push('d.procedure_id = ?'); params.push(filters.procedure_id); }
  if (filters.pv_id) { where.push('d.pv_id = ?'); params.push(filters.pv_id); }
  if (filters.period_key) { where.push('d.period_key = ?'); params.push(filters.period_key); }
  if (filters.locked !== undefined) { where.push('d.locked = ?'); params.push(filters.locked ? 1 : 0); }
  if (filters.includeDeleted) {
    where = where.filter((w) => !w.includes('deleted_at'));
  }
  if (filters.sha256) { where.push('d.sha256 = ?'); params.push(filters.sha256); }

  const page = filters.page || 1;
  const pageSize = filters.pageSize || 25;
  const offset = (page - 1) * pageSize;

  const countRow = get(
    `SELECT COUNT(*) AS c FROM documents_v2 d WHERE ${where.join(' AND ')}`, params
  );
  const total = countRow ? countRow.c : 0;

  const rows = all(
    `SELECT d.*, dt.name_ar AS type_name_ar, dt.name_fr AS type_name_fr, dt.code AS type_code
     FROM documents_v2 d
     LEFT JOIN document_types dt ON dt.id = d.document_type_id
     WHERE ${where.join(' AND ')}
     ORDER BY d.created_at DESC
     LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  );

  return { rows, total, page, pageSize };
}

/* ---------- Stats ---------- */
function documentStats() {
  const total = get('SELECT COUNT(*) AS c FROM documents_v2 WHERE deleted_at IS NULL');
  const active = get("SELECT COUNT(*) AS c FROM documents_v2 WHERE status = 'active' AND deleted_at IS NULL");
  const archived = get("SELECT COUNT(*) AS c FROM documents_v2 WHERE status = 'archived' AND deleted_at IS NULL");
  const deleted = get('SELECT COUNT(*) AS c FROM documents_v2 WHERE deleted_at IS NOT NULL');
  const locked = get('SELECT COUNT(*) AS c FROM documents_v2 WHERE locked = 1 AND deleted_at IS NULL');
  const totalSize = get('SELECT SUM(size_bytes) AS s FROM documents_v2 WHERE deleted_at IS NULL');

  const byType = all(
    `SELECT dt.name_ar, dt.name_fr, dt.code, COUNT(d.id) AS count
     FROM document_types dt
     LEFT JOIN documents_v2 d ON d.document_type_id = dt.id AND d.deleted_at IS NULL
     GROUP BY dt.id ORDER BY count DESC`
  );

  return {
    total: total ? total.c : 0,
    active: active ? active.c : 0,
    archived: archived ? archived.c : 0,
    deleted: deleted ? deleted.c : 0,
    locked: locked ? locked.c : 0,
    totalSize: totalSize ? totalSize.s : 0,
    byType
  };
}

/* ---------- List Document Types ---------- */
function listDocTypes() {
  return all('SELECT * FROM document_types ORDER BY sort_order, name_ar');
}

/* ---------- CRUD for Document Types ---------- */
function addDocType(input) {
  const res = run(
    `INSERT INTO document_types (code, name_ar, name_fr, description_ar, description_fr, icon, numbering_pattern, active, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
    [input.code, input.nameAr, input.nameFr, input.descriptionAr || '', input.descriptionFr || '',
     input.icon || 'fa-file', input.numberingPattern || '{type}-{year}-{seq:000000}', input.sortOrder || 0]
  );
  return get('SELECT * FROM document_types WHERE id = ?', [res.lastId]);
}

function updateDocType(id, input) {
  const fields = [];
  const values = [];
  if (input.nameAr !== undefined) { fields.push('name_ar = ?'); values.push(input.nameAr); }
  if (input.nameFr !== undefined) { fields.push('name_fr = ?'); values.push(input.nameFr); }
  if (input.descriptionAr !== undefined) { fields.push('description_ar = ?'); values.push(input.descriptionAr); }
  if (input.descriptionFr !== undefined) { fields.push('description_fr = ?'); values.push(input.descriptionFr); }
  if (input.icon !== undefined) { fields.push('icon = ?'); values.push(input.icon); }
  if (input.active !== undefined) { fields.push('active = ?'); values.push(input.active ? 1 : 0); }
  if (input.sortOrder !== undefined) { fields.push('sort_order = ?'); values.push(input.sortOrder); }
  if (input.numberingPattern !== undefined) { fields.push('numbering_pattern = ?'); values.push(input.numberingPattern); }
  if (!fields.length) return get('SELECT * FROM document_types WHERE id = ?', [id]);
  values.push(id);
  run(`UPDATE document_types SET ${fields.join(', ')} WHERE id = ?`, values);
  return get('SELECT * FROM document_types WHERE id = ?', [id]);
}

function deleteDocType(id) {
  run('UPDATE documents_v2 SET document_type_id = NULL WHERE document_type_id = ?', [id]);
  run('DELETE FROM document_types WHERE id = ?', [id]);
  return true;
}

/* ---------- Document Types with counts ---------- */
function listDocTypesWithCounts() {
  return all(
    `SELECT dt.*, COUNT(d.id) AS doc_count
     FROM document_types dt
     LEFT JOIN documents_v2 d ON d.document_type_id = dt.id AND d.deleted_at IS NULL
     GROUP BY dt.id ORDER BY dt.sort_order, dt.name_ar`
  );
}

/* ================================================================
   LEGACY METHODS (kept for compatibility)
   ================================================================ */

async function generatePv(procedureId, templateId, lang, notes = '') {
  const detail = procedureService.getDetail(procedureId);
  let template = get('SELECT * FROM pv_templates WHERE id = ?', [templateId]);
  if (!template) template = get('SELECT * FROM pv_templates ORDER BY id LIMIT 1');

  const ar = lang === 'ar';
  const title = ar ? template.title_ar : template.title_fr;
  const html = templates.docShell(title, templates.buildPvBody(detail, title, lang, { notes }), lang);

  const buf = await renderToPdf(html);
  const stored = await archiveStorage.storeFile(buf, `PV-${detail.procedure_number}-${Date.now()}.pdf`, { mime: 'application/pdf' });

  const doc = saveDocument({ procedureId, kind: 'PV', title, filePath: stored.filePath });
  run(
    'UPDATE documents_v2 SET sha256 = ?, size_bytes = ?, storage_name = ?, period_key = ? WHERE id = ?',
    [stored.sha256, stored.sizeBytes, stored.storageName, stored.period, doc.id]
  );
  audit.log({ action: 'pv.generated', entity: 'procedure', entityId: procedureId, metadata: { template: template.code, title } });
  return { ok: true, document: getDoc(doc.id), filePath: stored.filePath };
}

async function generateReceipt(paymentId, lang) {
  const payment = paymentService.getPayment(paymentId);
  if (!payment) throw new Error('NOT_FOUND:payment:' + paymentId);
  const procedure = procedureService.getDetail(payment.procedure_id);
  const ar = lang === 'ar';

  const existing = get('SELECT * FROM receipts WHERE payment_id = ?', [paymentId]);
  const number = existing ? existing.receipt_number : paymentService.generateReceiptNumber();

  const html = templates.docShell(
    ar ? 'وصل أداء' : 'Reçu de paiement',
    templates.buildReceiptBody(procedure, payment, number, lang),
    lang
  );

  const buf = await renderToPdf(html);
  const stored = await archiveStorage.storeFile(buf, `${number}.pdf`, { mime: 'application/pdf' });

  let doc;
  if (existing) {
    run(
      'UPDATE documents_v2 SET file_path = ?, sha256 = ?, size_bytes = ?, storage_name = ?, period_key = ?, updated_at = datetime(\'now\') WHERE id = ?',
      [stored.filePath, stored.sha256, stored.sizeBytes, stored.storageName, stored.period, existing.document_id]
    );
    doc = getDoc(existing.document_id);
    audit.log({ action: 'receipt.regenerated', entity: 'procedure', entityId: payment.procedure_id, metadata: { payment_id: paymentId } });
  } else {
    doc = saveDocument({ procedureId: payment.procedure_id, kind: 'RECEIPT', title: number, filePath: stored.filePath });
    run(
      'UPDATE documents_v2 SET sha256 = ?, size_bytes = ?, storage_name = ?, period_key = ? WHERE id = ?',
      [stored.sha256, stored.sizeBytes, stored.storageName, stored.period, doc.id]
    );
    run(
      'INSERT INTO receipts (payment_id, receipt_number, generated_at, file_path, document_id) VALUES (?, ?, datetime(\'now\'), ?, ?)',
      [paymentId, number, stored.filePath, doc.id]
    );
    const receiptRow = get('SELECT id FROM receipts WHERE payment_id = ? ORDER BY id DESC', [paymentId]);
    registersService.linkReceiptToAccounting(paymentId, receiptRow ? receiptRow.id : 0, number);
    audit.log({ action: 'receipt.generated', entity: 'procedure', entityId: payment.procedure_id, metadata: { number, payment_id: paymentId } });
  }
  return { ok: true, receipt: number, document: doc, filePath: stored.filePath };
}

async function generateFromTemplate(versionId, procedureId, lang, notes = '') {
  const pid = procedureId || null;
  const payload = templateService.getRenderPayload(versionId, pid, { lang, notes });
  const html = engine.renderHtml(payload.title, payload.resolvedContent, payload.lang);

  const buf = await renderToPdf(html);
  const stored = await archiveStorage.storeFile(
    buf,
    `TPL-${safeName(payload.detail.procedure_number)}-${safeName(payload.title)}-${Date.now()}.pdf`,
    { mime: 'application/pdf' }
  );

  const doc = saveDocument({
    procedureId: pid, kind: 'TEMPLATE',
    title: `${payload.title} (v${payload.version.version})`,
    filePath: stored.filePath, templateId: payload.template.id, templateVersionId: payload.version.id
  });
  run(
    'UPDATE documents_v2 SET sha256 = ?, size_bytes = ?, storage_name = ?, period_key = ? WHERE id = ?',
    [stored.sha256, stored.sizeBytes, stored.storageName, stored.period, doc.id]
  );
  audit.log({
    action: 'template.document_created', entity: 'procedure', entityId: pid,
    metadata: { template_id: payload.template.id, template_version_id: payload.version.id, version: payload.version.version }
  });
  return { ok: true, document: getDoc(doc.id), filePath: stored.filePath };
}

function openDoc(id) {
  const doc = get('SELECT * FROM documents_v2 WHERE id = ? AND deleted_at IS NULL', [id]) ||
              get('SELECT * FROM documents WHERE id = ?', [id]);
  if (!doc) throw new Error('NOT_FOUND:document:' + id);
  const fp = doc.file_path;
  if (fp && fs.existsSync(fp)) shell.openPath(fp);
  audit.log({ action: 'document.opened', entity: 'document', entityId: id });
  return doc;
}

function downloadDoc(id) {
  return new Promise(async (resolve, reject) => {
    try {
      const doc = get('SELECT * FROM documents_v2 WHERE id = ? AND deleted_at IS NULL', [id]) ||
                  get('SELECT * FROM documents WHERE id = ?', [id]);
      if (!doc) throw new Error('NOT_FOUND:document:' + id);
      const result = await dialog.showSaveDialog({
        defaultPath: path.join(app.getPath('downloads'), path.basename(doc.file_path || 'document.pdf')),
        filters: [{ name: 'PDF', extensions: ['pdf'] }]
      });
      if (result.canceled || !result.filePath) return resolve({ ok: false });
      if (doc.file_path && fs.existsSync(doc.file_path)) fs.copyFileSync(doc.file_path, result.filePath);
      audit.log({ action: 'document.downloaded', entity: 'document', entityId: id });
      resolve({ ok: true, path: result.filePath });
    } catch (e) {
      reject(e);
    }
  });
}

function printDoc(id) {
  const doc = get('SELECT * FROM documents_v2 WHERE id = ? AND deleted_at IS NULL', [id]) ||
              get('SELECT * FROM documents WHERE id = ?', [id]);
  if (!doc) throw new Error('NOT_FOUND:document:' + id);
  if (doc.file_path && fs.existsSync(doc.file_path)) shell.openPath(doc.file_path);
  audit.log({ action: 'document.printed', entity: 'document', entityId: id });
  return doc;
}

function listForProcedure(procedureId) {
  return all(
    'SELECT * FROM documents_v2 WHERE procedure_id = ? AND deleted_at IS NULL ORDER BY id DESC', [procedureId]
  );
}

module.exports = {
  setOutputDir, getOutputDir, renderToPdf,
  createDocument, saveDocument, getDoc, updateDoc,
  deleteDoc, permanentDeleteDoc, restoreDoc,
  lockDoc, unlockDoc,
  addVersion, listVersions,
  addTag, removeTag, listTags,
  addRelation, removeRelation, listRelations,
  logAudit, getAuditLog,
  searchDocuments, documentStats,
  listDocTypes, addDocType, updateDocType, deleteDocType, listDocTypesWithCounts,
  nextDocNumber,
  generatePv, generateReceipt, generateFromTemplate,
  openDoc, downloadDoc, printDoc,
  listForProcedure
};
