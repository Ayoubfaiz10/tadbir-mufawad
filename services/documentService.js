'use strict';

/* ================================================================
   DocumentService — توليد PDF (محاضر/وصولات) عبر BrowserWindow
   مخفية + عمليات فتح/طباعة/تحميل.
   الحفظ والأرشفة عبر ArchiveService (لا يعتمد على Electron).
   ================================================================ */

const fs = require('fs');
const path = require('path');
const { BrowserWindow, shell, dialog, app } = require('electron');

const { get, run } = require('../db/database').helpers;
const audit = require('./audit');
const procedureService = require('./procedureService');
const paymentService = require('./paymentService');
const archiveService = require('./archiveService');
const registersService = require('./registersService');
const templates = require('./templates');
const templateService = require('./templateService');
const engine = require('./templateEngineService');
const { requireAuth } = require('./auth');

/* ---------- توليد PDF من HTML ---------- */
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

function ensureArchiveFile(name) {
  return path.join(archiveService.getArchiveDir(), safeName(name));
}

/* ---------- إنشاء محضر (PV) ---------- */
async function generatePv(procedureId, templateId, lang, notes = '') {
  const detail = procedureService.getDetail(procedureId);
  let template = get('SELECT * FROM pv_templates WHERE id = ?', [templateId]);
  if (!template) template = get('SELECT * FROM pv_templates ORDER BY id LIMIT 1');

  const ar = lang === 'ar';
  const title = ar ? template.title_ar : template.title_fr;
  const html = templates.docShell(title, templates.buildPvBody(detail, title, lang, { notes }), lang);

  const filePath = ensureArchiveFile(`PV-${detail.procedure_number}-${Date.now()}.pdf`);
  const buf = await renderToPdf(html);
  fs.writeFileSync(filePath, buf);

  const doc = archiveService.saveDocumentAndLink({
    procedureId,
    kind: 'pv',
    title,
    filePath
  });
  audit.log({ action: 'pv.generated', entity: 'procedure', entityId: procedureId, metadata: { template: template.code, title } });
  return { ok: true, document: doc, filePath };
}

/* ---------- إنشاء وصل (Receipt) ---------- */
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

  const filePath = ensureArchiveFile(`${number}.pdf`);
  const buf = await renderToPdf(html);
  fs.writeFileSync(filePath, buf);

  let doc;
  if (existing) {
    doc = get('SELECT * FROM documents WHERE id = ?', [existing.document_id]);
    audit.log({ action: 'receipt.regenerated', entity: 'procedure', entityId: payment.procedure_id, metadata: { payment_id: paymentId } });
  } else {
    doc = archiveService.saveDocumentAndLink({
      procedureId: payment.procedure_id,
      kind: 'receipt',
      title: number,
      filePath
    });
    run(
      'INSERT INTO receipts (payment_id, receipt_number, generated_at, file_path, document_id) VALUES (?,?,datetime(\'now\'),?,?)',
      [paymentId, number, filePath, doc.id]
    );
    // ربط الوصل بقيد السجل الحسابي (إن وُجد)
    const receiptRow = get('SELECT id FROM receipts WHERE payment_id = ? ORDER BY id DESC', [paymentId]);
    registersService.linkReceiptToAccounting(paymentId, receiptRow ? receiptRow.id : 0, number);
    audit.log({ action: 'receipt.generated', entity: 'procedure', entityId: payment.procedure_id, metadata: { number, payment_id: paymentId } });
  }
  return { ok: true, receipt: number, document: doc, filePath };
}

/* ---------- توليد PDF من نموذج المكتبة (Template Engine) ---------- */
async function generateFromTemplate(versionId, procedureId, lang, notes = '') {
  const pid = procedureId || null;
  const payload = templateService.getRenderPayload(versionId, pid, { lang, notes });
  const html = engine.renderHtml(payload.title, payload.resolvedContent, payload.lang);

  const filePath = ensureArchiveFile(
    `TPL-${safeName(payload.detail.procedure_number)}-${safeName(payload.title)}-${Date.now()}.pdf`
  );
  const buf = await renderToPdf(html);
  fs.writeFileSync(filePath, buf);

  const doc = archiveService.saveDocumentAndLink({
    procedureId: pid,
    kind: 'template',
    title: `${payload.title} (v${payload.version.version})`,
    filePath,
    templateId: payload.template.id,
    templateVersionId: payload.version.id
  });
  audit.log({
    action: 'template.document_created',
    entity: 'procedure',
    entityId: pid,
    metadata: {
      template_id: payload.template.id,
      template_version_id: payload.version.id,
      version: payload.version.version
    }
  });
  return { ok: true, document: doc, filePath };
}

/* ---------- عمليات الوثيقة ---------- */
function getDoc(id) {
  return archiveService.getById(id);
}

function openDoc(id) {
  const doc = getDoc(id);
  if (!doc) throw new Error('NOT_FOUND:document:' + id);
  if (fs.existsSync(doc.file_path)) shell.openPath(doc.file_path);
  audit.log({ action: 'document.opened', entity: 'document', entityId: id });
  return doc;
}

function downloadDoc(id) {
  return new Promise(async (resolve, reject) => {
    try {
      const doc = getDoc(id);
      if (!doc) throw new Error('NOT_FOUND:document:' + id);
      const result = await dialog.showSaveDialog({
        defaultPath: path.join(app.getPath('downloads'), path.basename(doc.file_path)),
        filters: [{ name: 'PDF', extensions: ['pdf'] }]
      });
      if (result.canceled || !result.filePath) return resolve({ ok: false });
      fs.copyFileSync(doc.file_path, result.filePath);
      audit.log({ action: 'document.downloaded', entity: 'document', entityId: id });
      resolve({ ok: true, path: result.filePath });
    } catch (e) {
      reject(e);
    }
  });
}

function printDoc(id) {
  const doc = getDoc(id);
  if (!doc) throw new Error('NOT_FOUND:document:' + id);
  if (fs.existsSync(doc.file_path)) shell.openPath(doc.file_path);
  audit.log({ action: 'document.printed', entity: 'document', entityId: id });
  return doc;
}

function deleteDoc(id) {
  requireAuth('document.delete');
  const doc = getDoc(id);
  archiveService.unlink(id);
  if (doc && doc.file_path && fs.existsSync(doc.file_path)) {
    try { fs.unlinkSync(doc.file_path); } catch (e) {}
  }
  audit.log({ action: 'document.deleted', entity: 'document', entityId: id });
  return true;
}

module.exports = {
  generatePv, generateReceipt, generateFromTemplate, renderToPdf,
  openDoc, downloadDoc, printDoc, deleteDoc, getDoc,
  listForProcedure: archiveService.listForProcedure,
  archiveForProcedure: archiveService.archiveForProcedure,
  listArchive: archiveService.listArchive,
  stats: archiveService.stats
};
