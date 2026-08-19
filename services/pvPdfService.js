'use strict';

/* ================================================================
   PvPdfService — توليد PDF المحاضر + إنهاء + النظائر.
   يعتمد على Electron (BrowserWindow مخفي) مثل DocumentService.
   النظائر: لكل نسخة وثيقة مستقلة في الأرشيف (تتبع/تسليم منفصل).
   ================================================================ */

const fs = require('fs');
const path = require('path');

const { get, run } = require('../db/database').helpers;
const audit = require('./audit');
const documentService = require('./documentService');
const pvService = require('./pvService');
const archiveStorage = require('./archiveStorage');

function ensureOutputFile(name) {
  return path.join(documentService.getOutputDir(), String(name).replace(/[\\/:*?"<>|]/g, '_').slice(0, 80));
}

/* ---------- توليد PDF من محتوى محضر مخزّن ---------- */
async function generatePvPdf(id, lang) {
  const pv = get('SELECT * FROM pvs WHERE id = ?', [id]);
  if (!pv) throw new Error('NOT_FOUND:pv:' + id);
  const html = pvService.renderHtml(id, lang);
  const buf = await documentService.renderToPdf(html);
  return { buf, pv };
}

async function saveCopyDocument(pv, copy, buf) {
  const label = pv.language === 'ar' ? copy.label_ar : copy.label_fr;
  const safeLabel = String(label).replace(/[\\/:*?"<>|]/g, '_').slice(0, 80);
  const stored = await archiveStorage.storeFile(
    buf,
    `PV-${pv.pv_number}-${copy.copy_number}-${safeLabel}.pdf`,
    { mime: 'application/pdf' }
  );

  const doc = documentService.saveDocument({
    procedureId: pv.procedure_id,
    kind: 'pv',
    title: `${pv.title || pv.pv_number} — ${label}`,
    filePath: stored.filePath,
    templateId: pv.template_id,
    templateVersionId: pv.template_version_id
  });
  run(
    'UPDATE documents_v2 SET sha256 = ?, size_bytes = ?, storage_name = ?, period_key = ? WHERE id = ?',
    [stored.sha256, stored.sizeBytes, stored.storageName, stored.period, doc.id]
  );
  pvService.addDocumentLink(pv.id, doc.id);
  run('UPDATE pv_copies SET document_id = ? WHERE id = ?', [doc.id, copy.id]);
  return doc;
}

/* ---------- إنهاء المحضر: حالة + نظائر + وثائق PDF ---------- */
async function finalizePv(id) {
  const pv = get('SELECT * FROM pvs WHERE id = ?', [id]);
  if (!pv) throw new Error('NOT_FOUND:pv:' + id);

  if (pv.status !== 'FINALIZED') {
    pvService.applyStatus(id, 'FINALIZED', 'إنهاء المحضر وتوليد النظائر');
  }

  const copies = pvService.createCopies(id);
  const { buf } = await generatePvPdf(id, pv.language);

  await Promise.all(copies.map((copy) => saveCopyDocument(pv, copy, buf)));

  audit.log({
    action: 'pv.finalized',
    entity: 'pv',
    entityId: id,
    metadata: { number: pv.pv_number, copies: copies.length }
  });
  return pvService.getDetail(id);
}

/* ---------- إعادة توليد PDF لنسخة معينة ---------- */
async function regenerateCopyPdf(copyId) {
  const copy = get('SELECT * FROM pv_copies WHERE id = ?', [copyId]);
  if (!copy) throw new Error('NOT_FOUND:pv_copy:' + copyId);
  const pv = get('SELECT * FROM pvs WHERE id = ?', [copy.pv_id]);
  if (!pv) throw new Error('NOT_FOUND:pv:' + copy.pv_id);

  const { buf } = await generatePvPdf(pv.id, pv.language);
  const doc = saveCopyDocument(pv, copy, buf);

  audit.log({
    action: 'pv.copy_regenerated',
    entity: 'pv',
    entityId: pv.id,
    metadata: { copy_number: copy.copy_number, document_id: doc.id }
  });
  return pvService.getDetail(pv.id);
}

/* ---------- عمليات وثائق المحضر (إعادة استخدام DocumentService) ---------- */
function openDoc(id) { return documentService.openDoc(id); }
function downloadDoc(id) { return documentService.downloadDoc(id); }
function printDoc(id) { return documentService.printDoc(id); }

module.exports = { finalizePv, regenerateCopyPdf, generatePvPdf, openDoc, downloadDoc, printDoc };
