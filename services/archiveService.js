'use strict';

/* ================================================================
   ArchiveService — مركزي، بلا اعتماد على Electron (قابل للاختبار).
   نظام الأرشيف (P1):
   - بنية مجلدات منظمة: archive/{group}/{label}/{file}
   - بصمة SHA-256 وحجم لكل وثيقة
   - حالة الوثيقة: active / archived / sealed (قراءة فقط — Triggers)
   - ترقية تلقائية للتخطيط القديم (ملفات مسطحة → بنية منظمة)
   ================================================================ */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { get, all, run, tx, persist } = require('../db/database').helpers;
const audit = require('./audit');
const { getCurrentUser } = require('./auth');

let ARCHIVE_DIR = '';

const GROUPS = {
  procedure: 'procedures',
  register: 'registers',
  template: 'templates',
  dossier: 'dossiers',
  client: 'clients'
};

/* ---------- أدوات الملفات ---------- */
function safeFileName(name) {
  return String(name).replace(/[\\/:*?"<>|]/g, '_').slice(0, 80);
}

function sha256File(filePath) {
  try { return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex'); }
  catch (e) { return ''; }
}

function fileSize(filePath) {
  try { return fs.statSync(filePath).size; }
  catch (e) { return 0; }
}

function groupOf(entityType) {
  return GROUPS[entityType] || 'misc';
}

function labelOf(entityType, entityId) {
  return safeFileName(`${groupOf(entityType)}-${entityId || 0}`);
}

/* ---------- البنية المنظمة ---------- */
function archivePathFor(group, label, fileName) {
  const dir = path.join(ARCHIVE_DIR, safeFileName(group || 'misc'), safeFileName(label || 'misc'));
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, safeFileName(fileName));
}

function isInsideArchive(p) {
  if (!ARCHIVE_DIR) return false;
  const archAbs = path.resolve(ARCHIVE_DIR);
  const abs = path.resolve(p);
  return abs === archAbs || abs.startsWith(archAbs + path.sep);
}

/* نقل الملف إلى بنية منظمة (سلوك idempotent) */
function relocateFile(filePath, group, label) {
  if (!ARCHIVE_DIR) return { filePath, moved: false };
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) return { filePath: abs, moved: false };
  if (isInsideArchive(abs)) return { filePath: abs, moved: false };
  const newPath = archivePathFor(group, label, path.basename(abs));
  if (abs === newPath) return { filePath: abs, moved: false };
  try {
    fs.copyFileSync(abs, newPath);
    fs.unlinkSync(abs);
  } catch (e) {
    try { fs.renameSync(abs, newPath); }
    catch (e2) { throw new Error('ARCHIVE:MOVE_FAILED'); }
  }
  return { filePath: newPath, moved: true };
}

/* ---------- الإعداد ---------- */
function setArchiveDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const changed = ARCHIVE_DIR !== dir;
  ARCHIVE_DIR = dir;
  if (changed) upgradeLegacyLayout();
}

function getArchiveDir() {
  return ARCHIVE_DIR;
}

/* ---------- الترقيـة التلقائية للتخطيط القديم (مرة واحدة) ---------- */
function upgradeLegacyLayout() {
  if (!ARCHIVE_DIR) return;
  try {
    const flag = get("SELECT value FROM meta WHERE key = 'archive_layout_v6'");
    if (flag) return;
    const docs = all("SELECT id, entity_type, entity_id, file_path FROM documents WHERE status = 'active' AND file_path != ''");
    tx(() => {
      docs.forEach((d) => {
        const abs = path.resolve(d.file_path || '');
        if (!fs.existsSync(abs) || isInsideArchive(abs)) return;
        const moved = relocateFile(abs, groupOf(d.entity_type), labelOf(d.entity_type, d.entity_id));
        if (moved.moved) {
          run('UPDATE documents SET file_path = ?, sha256 = ?, size_bytes = ? WHERE id = ?',
            [moved.filePath, sha256File(moved.filePath), fileSize(moved.filePath), d.id]);
        }
      });
      run("INSERT OR REPLACE INTO meta (key, value) VALUES ('archive_layout_v6', '1')");
    });
  } catch (e) {
    /* لا نوقف التطبيق إذا فشلت الترقيـة — تُعاد تجربتها عند الإقلاع التالي */
  }
}

/* ---------- الحفظ والربط ---------- */
function getById(id) {
  return get('SELECT * FROM documents WHERE id = ?', [id]);
}

function saveDocumentAndLink({ procedureId, kind, title, filePath, templateId = 0, templateVersionId = 0, periodKey = '', source = 'auto' }) {
  const user = getCurrentUser();
  const etype = procedureId ? 'procedure' : 'template';
  const eid = procedureId || templateId || 0;
  const moved = relocateFile(filePath, groupOf(etype), labelOf(etype, eid));
  const finalPath = moved.filePath;
  const sha = sha256File(finalPath);
  const size = fileSize(finalPath);
  const res = run(
    `INSERT INTO documents (entity_type, entity_id, kind, title, file_name, file_path, mime, archived, created_by, template_id, template_version_id, status, sha256, size_bytes, period_key, source)
     VALUES (?, ?, ?, ?, ?, ?, 'application/pdf', 1, ?, ?, ?, 'active', ?, ?, ?, ?)`,
    [etype, eid, kind, title, safeFileName(path.basename(finalPath, '.pdf')) + '.pdf', finalPath,
     user.username, templateId, templateVersionId, sha, size, periodKey, source]
  );
  if (procedureId) {
    run('INSERT OR IGNORE INTO procedure_documents (procedure_id, document_id) VALUES (?,?)', [procedureId, res.lastId]);
  }
  persist();
  audit.log({
    action: 'document.created',
    entity: 'procedure',
    entityId: procedureId,
    metadata: { document_id: res.lastId, kind, title, sha256: sha, size_bytes: size },
    user
  });
  return getById(res.lastId);
}

/* ---------- الاستعلامات ---------- */
function listForProcedure(procedureId) {
  return all(
    `SELECT doc.* FROM procedure_documents pd
     JOIN documents doc ON doc.id = pd.document_id
     WHERE pd.procedure_id = ? ORDER BY doc.id DESC`,
    [procedureId]
  );
}

function archiveForProcedure(procedureId) {
  const docs = listForProcedure(procedureId);
  const groups = { pv: [], document: [], receipt: [], other: [] };
  docs.forEach((x) => {
    const key = groups[x.kind] ? x.kind : 'other';
    groups[key].push(x);
  });
  return { procedureId, docs, groups };
}

function listArchive(f = {}) {
  let sql = `SELECT doc.*, COALESCE(p.procedure_number, p2.procedure_number) AS procedure_number FROM documents doc
     LEFT JOIN procedure_documents pd ON pd.document_id = doc.id
     LEFT JOIN procedures p ON p.id = pd.procedure_id
     LEFT JOIN procedures p2 ON p2.id = doc.entity_id AND doc.entity_type = 'procedure'
     WHERE 1=1`;
  const params = [];
  if (f.kind) { sql += ' AND doc.kind = ?'; params.push(String(f.kind)); }
  if (f.status) { sql += ' AND doc.status = ?'; params.push(String(f.status)); }
  if (f.entityType) { sql += ' AND doc.entity_type = ?'; params.push(String(f.entityType)); }
  if (f.q) { sql += ' AND (doc.title LIKE ? OR doc.file_name LIKE ?)'; params.push('%' + f.q + '%', '%' + f.q + '%'); }
  sql += ' ORDER BY doc.id DESC LIMIT ' + (Number(f.limit) || 500);
  return all(sql, params);
}

function stats() {
  const t = get("SELECT COUNT(*) AS c, COALESCE(SUM(size_bytes),0) AS bytes, SUM(CASE WHEN status='sealed' THEN 1 ELSE 0 END) AS sealed FROM documents") || {};
  const byKind = all("SELECT kind, COUNT(*) AS c FROM documents GROUP BY kind ORDER BY c DESC");
  const byStatus = all("SELECT status, COUNT(*) AS c FROM documents GROUP BY status");
  const byYear = all("SELECT substr(created_at,1,4) AS y, COUNT(*) AS c FROM documents GROUP BY y ORDER BY y DESC");
  return {
    total: t.c || 0,
    bytes: t.bytes || 0,
    sealed: t.sealed || 0,
    byKind, byStatus, byYear
  };
}

/* ---------- الحذف (محمي للوثائق المختومة) ---------- */
function unlink(id) {
  const doc = getById(id);
  if (doc && doc.status === 'sealed') throw new Error('DOC:SEALED:NO_DELETE');
  run('DELETE FROM documents WHERE id = ?', [id]);
  persist();
}

/* ---------- مرجعيات الأرشيف (ملفات / إجراءات) ---------- */
function createDossierRef(dossierId) {
  const user = getCurrentUser();
  const d = get('SELECT * FROM dossiers WHERE id = ?', [dossierId]);
  if (!d) return null;
  const existing = get("SELECT id FROM documents WHERE entity_type = 'dossier' AND entity_id = ? AND kind = 'dossier'", [dossierId]);
  if (existing) return getById(existing.id);
  const res = run(
    `INSERT INTO documents (entity_type, entity_id, kind, title, file_name, file_path, mime, archived, created_by, status, sha256, size_bytes, period_key, source)
     VALUES ('dossier', ?, 'dossier', ?, ?, '', '', 1, ?, 'active', '', 0, '', 'auto')`,
    [dossierId, d.numero || 'ملف #' + dossierId, 'dossier-' + dossierId, user.username]
  );
  persist();
  audit.log({ action: 'document.created', entity: 'dossier', entityId: dossierId, metadata: { document_id: res.lastId, kind: 'dossier' }, user });
  return getById(res.lastId);
}

function createProcedureRef(procedureId) {
  const user = getCurrentUser();
  const p = get('SELECT * FROM procedures WHERE id = ?', [procedureId]);
  if (!p) return null;
  const existing = get("SELECT id FROM documents WHERE entity_type = 'procedure' AND entity_id = ? AND kind = 'procedure'", [procedureId]);
  if (existing) return getById(existing.id);
  const res = run(
    `INSERT INTO documents (entity_type, entity_id, kind, title, file_name, file_path, mime, archived, created_by, status, sha256, size_bytes, period_key, source)
     VALUES ('procedure', ?, 'procedure', ?, ?, '', '', 1, ?, 'active', '', 0, '', 'auto')`,
    [procedureId, p.procedure_number || 'إجراء #' + procedureId, 'procedure-' + procedureId, user.username]
  );
  persist();
  audit.log({ action: 'document.created', entity: 'procedure', entityId: procedureId, metadata: { document_id: res.lastId, kind: 'procedure' }, user });
  return getById(res.lastId);
}

module.exports = {
  setArchiveDir, getArchiveDir, getById,
  saveDocumentAndLink, listForProcedure, archiveForProcedure, listArchive, unlink, safeFileName,
  sha256File, fileSize, archivePathFor, stats, upgradeLegacyLayout, isInsideArchive,
  createDossierRef, createProcedureRef
};