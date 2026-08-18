'use strict';

/* ================================================================
   IPC — تسجيل جميع قنوات الاتصال الآمنة بين Renderer و Main.
   تدفّق: Renderer → Preload → Secure IPC → Services → Database.
   كل معاملات الوصف تُفحص هنا (sanitization + validation).
   ================================================================ */

const { ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { shell } = require('electron');
const { app } = require('electron');

const dbCore = require('./db/database');
const auth = require('./services/auth');
const audit = require('./services/audit');
const configService = require('./services/configService');
const dossierService = require('./services/dossierService');
const clientService = require('./services/clientService');
const procedureService = require('./services/procedureService');
const paymentService = require('./services/paymentService');
const feeService = require('./services/feeService');
const accountingService = require('./services/accountingService');
const documentService = require('./services/documentService');
const templateService = require('./services/templateService');
const settingsService = require('./services/settingsService');
const pvService = require('./services/pvService');
const pvPdfService = require('./services/pvPdfService');
const registersService = require('./services/registersService');
const backupService = require('./services/backupService');
const LOCALES_DIR = path.join(__dirname, 'src', 'locales');

/* ---------- أدوات الأمان ---------- */
function str(v, max = 2000) {
  return String(v == null ? '' : v).slice(0, max);
}
function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function bool(v) {
  return v === true || v === 1;
}
function int(v) {
  const n = parseInt(v, 10);
  return Number.isInteger(n) ? n : 0;
}
function genHandle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      return { ok: true, data: await fn(...args) };
    } catch (e) {
      return { ok: false, error: String(e.message || e) };
    }
  });
}

/* ================================================================
   تسجيل القنوات
   ================================================================ */
function register() {
  /* ---------- اللغة ---------- */
  genHandle('app:getLocale', (lang) => {
    const file = path.join(LOCALES_DIR, (lang === 'fr' ? 'fr' : 'ar') + '.json');
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  });

  /* ---------- الحالة الشاملة (الواجهة القديمة) ---------- */
  genHandle('app:getState', () => {
    const dossiers = dossierService.listAll();
    const clients = clientService.listAll();
    const recentAudit = audit.listRecent(8).map((a) => ({
      text: a.entity + '.' + a.action,
      date: a.created_at
    }));
    const byStatus = {};
    dossiers.forEach((d) => { byStatus[d.status] = (byStatus[d.status] || 0) + 1; });
    return {
      dossiers,
      clients,
      activities: recentAudit,
      stats: {
        totalDossiers: dossiers.length,
        totalClients: clients.length,
        byStatus,
        recent: recentAudit
      }
    };
  });

  /* ---------- الملفات ---------- */
  genHandle('app:saveDossier', (d) => dossierService.save({
    id: int(d.id) || null,
    numero: str(d.numero),
    demandeur: str(d.demandeur),
    defendeur: str(d.defendeur),
    court: str(d.court),
    type: str(d.type),
    status: str(d.status),
    date: str(d.date),
    notes: str(d.notes)
  }));
  genHandle('app:deleteDossier', (id) => dossierService.remove(int(id)));
  genHandle('app:dossierSearch', (q) => dossierService.searchDossiers(str(q), 25));
  genHandle('app:dossierParties', (dossierId) => dossierService.listPartiesByDossier(int(dossierId)));
  genHandle('app:partySave', (party) => dossierService.saveParty({
    id: int(party.id) || null,
    dossier_id: int(party.dossier_id),
    role: str(party.role),
    name: str(party.name, 500),
    cin: str(party.cin, 100),
    address: str(party.address),
    phone: str(party.phone),
    email: str(party.email),
    notes: str(party.notes)
  }));

  /* ---------- العملاء ---------- */
  genHandle('app:saveClient', (c) => clientService.save({
    id: int(c.id) || null,
    name: str(c.name),
    phone: str(c.phone),
    email: str(c.email),
    type: str(c.type),
    notes: str(c.notes)
  }));
  genHandle('app:deleteClient', (id) => clientService.remove(int(id)));

  /* ---------- تصدير CSV ---------- */
  genHandle('app:exportCsv', async (kind) => {
    const result = await dialog.showSaveDialog({
      defaultPath: path.join(app.getPath('documents'), (kind === 'clients' ? 'clients' : 'dossiers') + '.csv'),
      filters: [{ name: 'CSV', extensions: ['csv'] }]
    });
    if (result.canceled || !result.filePath) return { ok: false };
    const rows = kind === 'clients' ? clientService.listAll() : dossierService.listAll();
    const headers = kind === 'clients'
      ? ['id', 'الاسم', 'الهاتف', 'البريد', 'النوع']
      : ['id', 'رقم الملف', 'المدعي', 'المدعى عليه', 'المحكمة', 'الحالة', 'التاريخ'];
    const lines = [headers.join(';')];
    rows.forEach((r) => {
      const vals = kind === 'clients'
        ? [r.id, r.name, r.phone, r.email, r.type]
        : [r.id, r.numero, r.demandeur, r.defendeur, r.court, r.status, r.date];
      lines.push(vals.map((v) => `"${(v || '').toString().replace(/"/g, '""')}"`).join(';'));
    });
    fs.writeFileSync(result.filePath, '\uFEFF' + lines.join('\r\n'), 'utf8');
    return { ok: true, path: result.filePath };
  });

  /* ---------- Auth ---------- */
  genHandle('auth:login', (username, password) => auth.login(str(username, 60), str(password, 200)));
  genHandle('auth:logout', () => auth.logout());
  genHandle('auth:changePassword', (currentPassword, newPassword) => auth.changePassword(str(currentPassword, 200), str(newPassword, 200)));
  genHandle('auth:current', () => ({ user: auth.getCurrentUser(), needsSetup: auth.needsSetup() }));
  genHandle('auth:setupInitial', (username, displayName, password) => auth.setupInitial(str(username, 60), str(displayName, 120), str(password, 200)));
  genHandle('auth:users', () => auth.listUsers());
  genHandle('auth:isAuthorized', (action) => auth.isAuthorized(str(action)));

  /* ---------- الإعدادات والتكوين ---------- */
  genHandle('config:snapshot', () => configService.configSnapshot('all'));
  genHandle('config:categories', () => configService.listCategories());
  genHandle('config:types', (categoryId) => configService.listTypesByCategory(int(categoryId)));
  genHandle('config:typesFull', () => configService.listTypesFull());
  genHandle('config:typeAdd', (input) => configService.addType({
    categoryId: int(input.categoryId),
    code: str(input.code, 60).toUpperCase(),
    nameAr: str(input.nameAr),
    nameFr: str(input.nameFr),
    descriptionAr: str(input.descriptionAr),
    descriptionFr: str(input.descriptionFr),
    fields: (input.fields || []).map((f) => ({
      fieldKey: str(f.fieldKey, 60),
      labelAr: str(f.labelAr),
      labelFr: str(f.labelFr),
      fieldType: str(f.fieldType, 20) || 'text',
      required: bool(f.required),
      options: Array.isArray(f.options) ? f.options.map(str) : []
    }))
  }));
  genHandle('config:statuses', () => configService.listStatuses());
  genHandle('config:transitions', () => configService.listTransitions());
  genHandle('config:statusAdd', (s) => configService.addStatus(str(s.code).toUpperCase(), str(s.nameAr), str(s.nameFr), str(s.color)));
  genHandle('config:statusUpdate', (s) => configService.updateStatus(str(s.code), {
    nameAr: str(s.nameAr), nameFr: str(s.nameFr), color: str(s.color), active: bool(s.active)
  }));
  genHandle('config:pvTemplates', () => configService.listPvTemplates());

  /* ---------- الإجراءات ---------- */
  genHandle('proc:list', (f) => procedureService.list({
    page: int(f.page) || 1,
    pageSize: int(f.pageSize) || 25,
    q: str(f.q, 300),
    category: f.category ? int(f.category) : null,
    typeId: f.typeId ? int(f.typeId) : null,
    status: str(f.status),
    dateRange: f.dateRange,
    assignedTo: str(f.assignedTo),
    userId: str(f.userId)
  }));
  genHandle('proc:stats', () => procedureService.stats());
  genHandle('proc:get', (id) => procedureService.getDetail(int(id)));
  genHandle('proc:create', (input) => procedureService.createProcedure({
    dossier_id: int(input.dossier_id) || null,
    procedure_type_id: int(input.procedure_type_id) || null,
    status: str(input.status) || 'NEW',
    requested_by: str(input.requested_by, 500),
    amount: num(input.amount),
    currency: str(input.currency) || 'MAD',
    assigned_to: str(input.assigned_to),
    notes: str(input.notes),
    party_ids: Array.isArray(input.party_ids) ? input.party_ids.map(int).filter(Boolean) : [],
    field_values: input.field_values || {}
  }));
  genHandle('proc:update', (id, input) => procedureService.updateProcedure(int(id), {
    dossier_id: input.dossier_id !== undefined ? int(input.dossier_id) : undefined,
    procedure_type_id: int(input.procedure_type_id),
    requested_by: str(input.requested_by),
    amount: num(input.amount),
    currency: str(input.currency),
    assigned_to: str(input.assigned_to),
    notes: str(input.notes)
  }));
  genHandle('proc:delete', (id) => procedureService.deleteProcedure(int(id)));
  genHandle('proc:statusChange', (id, to, note) => procedureService.applyStatus(int(id), str(to), str(note, 1000)));
  genHandle('proc:nextStatus', (id) => procedureService.allowedTransitions(int(id)));

  /* ---------- الأداءات ---------- */
  genHandle('pay:add', (procedureId, data) => paymentService.addPayment(int(procedureId), {
    amount: num(data.amount),
    method: str(data.method),
    payment_date: str(data.payment_date),
    status: str(data.status) || 'pending',
    reference: str(data.reference),
    notes: str(data.notes),
    assessmentId: int(data.assessmentId),
    paymentMethodId: int(data.paymentMethodId)
  }));
  genHandle('pay:list', (f) => paymentService.listPayments({
    procedureId: f.procedureId ? int(f.procedureId) : undefined,
    status: str(f.status),
    method: str(f.method),
    page: int(f.page) || 1,
    pageSize: int(f.pageSize) || 25
  }));
  genHandle('pay:get', (id) => paymentService.getPaymentDetail(int(id)));
  genHandle('pay:confirm', (id) => paymentService.confirmPayment(int(id)));
  genHandle('pay:cancel', (id, reason) => paymentService.cancelPayment(int(id), str(reason, 500)));
  genHandle('pay:refund', (id, data) => paymentService.refundPayment(int(id), {
    amount: num(data.amount), reason: str(data.reason), notes: str(data.notes)
  }));
  genHandle('pay:refunds', (paymentId) => paymentService.listRefunds(int(paymentId)));
  genHandle('pay:stats', () => paymentService.paymentStats());
  genHandle('pay:methods', () => paymentService.listPaymentMethods());
  genHandle('pay:methodAdd', (data) => paymentService.addPaymentMethod({
    code: str(data.code, 60).toUpperCase(), nameAr: str(data.nameAr),
    nameFr: str(data.nameFr), sortOrder: int(data.sortOrder)
  }));
  genHandle('pay:methodUpdate', (id, data) => paymentService.updatePaymentMethod(int(id), {
    nameAr: data.nameAr !== undefined ? str(data.nameAr) : undefined,
    nameFr: data.nameFr !== undefined ? str(data.nameFr) : undefined,
    active: data.active !== undefined ? bool(data.active) : undefined,
    sortOrder: data.sortOrder !== undefined ? int(data.sortOrder) : undefined
  }));
  genHandle('pay:cancelReceipt', (id, reason) => paymentService.cancelReceipt(int(id), str(reason, 500)));
  genHandle('pay:financialAudit', (f) => paymentService.listFinancialAudit({
    procedureId: f.procedureId ? int(f.procedureId) : undefined,
    entityType: str(f.entityType),
    page: int(f.page) || 1,
    pageSize: int(f.pageSize) || 50
  }));

  /* ---------- التعريفات ---------- */
  genHandle('tariff:list', (f) => feeService.listTariffs({
    status: str(f && f.status), activeOnly: !f || f.activeOnly !== false
  }));
  genHandle('tariff:get', (id) => feeService.getTariff(int(id)));
  genHandle('tariff:add', (data) => feeService.addTariff({
    code: str(data.code, 60).toUpperCase(), nameAr: str(data.nameAr), nameFr: str(data.nameFr),
    descriptionAr: str(data.descriptionAr), descriptionFr: str(data.descriptionFr),
    defaultAmount: num(data.defaultAmount), currency: str(data.currency),
    status: str(data.status), validFrom: str(data.validFrom),
    validTo: str(data.validTo), active: bool(data.active)
  }));
  genHandle('tariff:update', (id, data) => feeService.updateTariff(int(id), {
    nameAr: data.nameAr !== undefined ? str(data.nameAr) : undefined,
    nameFr: data.nameFr !== undefined ? str(data.nameFr) : undefined,
    descriptionAr: data.descriptionAr !== undefined ? str(data.descriptionAr) : undefined,
    descriptionFr: data.descriptionFr !== undefined ? str(data.descriptionFr) : undefined,
    defaultAmount: data.defaultAmount !== undefined ? num(data.defaultAmount) : undefined,
    currency: data.currency !== undefined ? str(data.currency) : undefined,
    status: data.status !== undefined ? str(data.status) : undefined,
    validFrom: data.validFrom !== undefined ? str(data.validFrom) : undefined,
    validTo: data.validTo !== undefined ? str(data.validTo) : undefined,
    active: data.active !== undefined ? bool(data.active) : undefined,
    sortOrder: data.sortOrder !== undefined ? int(data.sortOrder) : undefined
  }));
  genHandle('tariff:delete', (id) => feeService.deleteTariff(int(id)));
  genHandle('tariff:stats', () => feeService.tariffStats());
  genHandle('tariff:rules', () => feeService.listRules());
  genHandle('tariff:ruleAdd', (data) => feeService.addRule({
    tariffId: int(data.tariffId), procedureTypeId: int(data.procedureTypeId) || null,
    overrideAmount: data.overrideAmount !== undefined ? num(data.overrideAmount) : undefined,
    notes: str(data.notes)
  }));
  genHandle('tariff:ruleDelete', (id) => feeService.deleteRule(int(id)));
  genHandle('tariff:suggest', (procedureTypeId) => feeService.suggestFees(int(procedureTypeId)));

  /* ---------- التقييمات ---------- */
  genHandle('assessment:create', (procedureId, data) => feeService.createAssessment(int(procedureId), {
    currency: str(data.currency), notes: str(data.notes), items: data.items || []
  }));
  genHandle('assessment:get', (id) => feeService.getAssessment(int(id)));
  genHandle('assessment:list', (f) => feeService.listAssessments({
    procedureId: f.procedureId ? int(f.procedureId) : undefined,
    status: str(f.status),
    page: int(f.page) || 1,
    pageSize: int(f.pageSize) || 25
  }));
  genHandle('assessment:confirm', (id) => feeService.confirmAssessment(int(id)));
  genHandle('assessment:cancel', (id, reason) => feeService.cancelAssessment(int(id), str(reason, 500)));
  genHandle('assessment:itemAdd', (assessmentId, data) => feeService.addAssessmentItem(int(assessmentId), {
    tariffId: int(data.tariffId) || null,
    descriptionAr: str(data.descriptionAr), descriptionFr: str(data.descriptionFr),
    amount: num(data.amount), quantity: int(data.quantity), notes: str(data.notes)
  }));
  genHandle('assessment:itemRemove', (itemId) => feeService.removeAssessmentItem(int(itemId)));
  genHandle('assessment:stats', () => feeService.assessmentStats());

  /* ---------- الدفتر الحسابي ---------- */
  genHandle('accounting:list', (f) => accountingService.listRecords({
    procedureId: f.procedureId ? int(f.procedureId) : undefined,
    type: str(f.type), entityType: str(f.entityType),
    page: int(f.page) || 1, pageSize: int(f.pageSize) || 50
  }));
  genHandle('accounting:get', (id) => accountingService.getRecord(int(id)));
  genHandle('accounting:summary', (f) => accountingService.financialSummary({
    from: str(f && f.from), to: str(f && f.to)
  }));
  genHandle('accounting:dashboard', () => accountingService.dashboard());
  genHandle('accounting:procedureReport', (procedureId) => accountingService.procedureReport(int(procedureId)));

  /* ---------- الوثائق والمحاضر والوصولات والأرشيف ---------- */
  genHandle('doc:generatePv', (procedureId, templateId, lang, notes) =>
    documentService.generatePv(int(procedureId), int(templateId), str(lang) === 'fr' ? 'fr' : 'ar', str(notes)));
  genHandle('doc:generateReceipt', (paymentId, lang) =>
    documentService.generateReceipt(int(paymentId), str(lang) === 'fr' ? 'fr' : 'ar'));
  genHandle('doc:list', (procedureId) => documentService.listForProcedure(int(procedureId)));
  genHandle('doc:open', (id) => documentService.openDoc(int(id)));
  genHandle('doc:download', (id) => documentService.downloadDoc(int(id)));
  genHandle('doc:print', (id) => documentService.printDoc(int(id)));
  genHandle('doc:delete', (id) => documentService.deleteDoc(int(id)));
  genHandle('archive:forProcedure', (procedureId) => documentService.archiveForProcedure(int(procedureId)));
  genHandle('archive:list', (f) => documentService.listArchive({
    kind: str(f.kind),
    status: str(f.status),
    entityType: str(f.entityType),
    q: str(f.q, 300),
    limit: int(f.limit) || 50
  }));
  genHandle('archive:stats', () => documentService.stats());
  genHandle('archive:openDir', async () => {
    const dir = archiveService.getArchiveDir();
    if (!dir) throw new Error('ARCHIVE:NOT_INITIALIZED');
    try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { throw new Error('ARCHIVE:OPEN_FAILED'); }
    const openRes = await shell.openPath(dir);
    if (openRes) throw new Error('ARCHIVE:OPEN_FAILED');
    return { ok: true };
  });

  /* ---------- النسخ الاحتياطي والاستعادة (P4) ---------- */
  genHandle('archive:backup', async () => {
    const result = await dialog.showSaveDialog({
      defaultPath: path.join(app.getPath('documents'), 'huissier-backup-' + new Date().toISOString().slice(0, 10) + '.zip'),
      filters: [{ name: 'ZIP', extensions: ['zip'] }]
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    return backupService.createBackupZip(result.filePath, archiveService.getArchiveDir());
  });

  genHandle('archive:restore', async () => {
    const result = await dialog.showOpenDialog({
      filters: [{ name: 'ZIP', extensions: ['zip'] }],
      properties: ['openFile']
    });
    if (result.canceled || !result.filePaths.length) return { canceled: true };
    const dbPathMain = require('./db/database').getDbPath();
    const dataDir = dbPathMain ? path.dirname(dbPathMain) : app.getPath('userData');
    const out = await backupService.restoreBackup(result.filePaths[0], dataDir, archiveService.getArchiveDir());
    setTimeout(() => { app.relaunch(); app.exit(0); }, 700);
    return out;
  });

  /* ---------- التدقيق ---------- */
  genHandle('audit:procedure', (procedureId) => audit.listForEntity('procedure', int(procedureId)));

  /* ---------- الإعدادات العامة (المكتب) ---------- */
  genHandle('settings:getOffice', () => settingsService.getOffice());
  genHandle('settings:saveOffice', (o) => settingsService.saveOffice({
    name: str(o.name, 500),
    address: str(o.address, 1000),
    phone: str(o.phone, 100),
    registration_number: str(o.registration_number, 100)
  }));

  /* ---------- مكتبة النماذج (Template Library) ---------- */
  genHandle('tpl:list', (f) => templateService.list({
    page: int(f.page) || 1,
    pageSize: int(f.pageSize) || 25,
    q: str(f.q, 300),
    language: str(f.language),
    category: f.category ? int(f.category) : null,
    procedureTypeId: f.procedureTypeId ? int(f.procedureTypeId) : null,
    status: str(f.status),
    includeArchived: bool(f.includeArchived)
  }));
  genHandle('tpl:stats', () => templateService.stats());
  genHandle('tpl:get', (id) => templateService.get(int(id)));
  genHandle('tpl:categories', () => templateService.listCategories());
  genHandle('tpl:add', (input) => templateService.add({
    name: str(input.name),
    categoryId: input.categoryId ? int(input.categoryId) : null,
    procedureTypeId: input.procedureTypeId ? int(input.procedureTypeId) : null,
    language: str(input.language) === 'fr' ? 'fr' : 'ar',
    description: str(input.description),
    active: bool(input.active),
    version: str(input.version),
    content: str(input.content, 200000),
    note: str(input.note)
  }));
  genHandle('tpl:update', (id, input) => templateService.update(int(id), {
    name: input.name !== undefined ? str(input.name) : undefined,
    categoryId: input.categoryId !== undefined ? (input.categoryId ? int(input.categoryId) : null) : undefined,
    procedureTypeId: input.procedureTypeId !== undefined ? (input.procedureTypeId ? int(input.procedureTypeId) : null) : undefined,
    language: input.language !== undefined ? (str(input.language) === 'fr' ? 'fr' : 'ar') : undefined,
    description: input.description !== undefined ? str(input.description) : undefined,
    active: input.active !== undefined ? bool(input.active) : undefined,
    version: input.version !== undefined ? str(input.version) : undefined,
    major: bool(input.major),
    newVersion: bool(input.newVersion),
    content: input.content !== undefined ? str(input.content, 200000) : undefined,
    note: input.note !== undefined ? str(input.note) : undefined
  }));
  genHandle('tpl:setActive', (id, active) => templateService.setActive(int(id), bool(active)));
  genHandle('tpl:setArchived', (id, archived) => templateService.setArchived(int(id), bool(archived)));
  genHandle('tpl:duplicate', (id, input) => templateService.duplicate(int(id), {
    name: input.name !== undefined ? str(input.name) : undefined,
    language: input.language !== undefined ? (str(input.language) === 'fr' ? 'fr' : 'ar') : undefined
  }));
  genHandle('tpl:forProcedure', (typeId, lang) => templateService.forProcedure(int(typeId), str(lang)));
  genHandle('tpl:variables', () => templateService.variables());
  genHandle('tpl:renderPreview', (versionId, procedureId, lang, notes) =>
    templateService.getRenderPayload(int(versionId), int(procedureId), {
      lang: str(lang), notes: str(notes, 5000), strict: true
    }).resolvedContent);
  genHandle('tpl:renderDraft', (html, lang) => templateService.renderDraft(str(html, 200000), str(lang)));
  genHandle('doc:generateTemplate', (versionId, procedureId, lang, notes) =>
    documentService.generateFromTemplate(int(versionId), int(procedureId), str(lang), str(notes, 5000)));

  /* ---------- المحاضر (Procès-Verbaux) ---------- */
  genHandle('pv:types', () => pvService.listPvTypes());
  genHandle('pv:statuses', () => pvService.listPvStatuses());
  genHandle('pv:transitions', () => pvService.listPvTransitions());
  genHandle('pv:list', (f) => pvService.list({
    page: int(f.page) || 1,
    pageSize: int(f.pageSize) || 25,
    q: str(f.q, 300),
    status: str(f.status),
    pvTypeId: f.pvTypeId ? int(f.pvTypeId) : null,
    procedureId: f.procedureId ? int(f.procedureId) : null,
    dateRange: f.dateRange
  }));
  genHandle('pv:stats', () => pvService.stats());
  genHandle('pv:get', (id) => pvService.getDetail(int(id)));
  genHandle('pv:create', (input) => pvService.createPv({
    procedure_id: int(input.procedure_id) || null,
    pv_type_id: int(input.pv_type_id) || null,
    template_version_id: int(input.template_version_id) || null,
    language: str(input.language) === 'fr' ? 'fr' : 'ar',
    title: str(input.title, 300),
    notes: str(input.notes)
  }));
  genHandle('pv:saveContent', (id, content, note) => pvService.saveContent(int(id), str(content, 200000), str(note, 1000)));
  genHandle('pv:refreshFromTemplate', (id, notes) => pvService.refreshFromTemplate(int(id), { notes: str(notes, 5000) }));
  genHandle('pv:updateMeta', (id, input) => pvService.updateMeta(int(id), {
    title: input.title !== undefined ? str(input.title, 300) : undefined,
    pv_type_id: input.pv_type_id !== undefined ? int(input.pv_type_id) : undefined,
    notes: input.notes !== undefined ? str(input.notes) : undefined
  }));
  genHandle('pv:applyStatus', (id, to, note) => pvService.applyStatus(int(id), str(to), str(note, 1000)));
  genHandle('pv:finalize', (id) => pvPdfService.finalizePv(int(id)));
  genHandle('pv:regenerateCopy', (copyId) => pvPdfService.regenerateCopyPdf(int(copyId)));
  genHandle('pv:setCopyStatus', (copyId, status, notes) => pvService.setCopyStatus(int(copyId), str(status), str(notes, 1000)));
  genHandle('pv:preview', (id, lang) => pvService.renderHtml(int(id), str(lang)));
  genHandle('pv:openDoc', (id) => pvPdfService.openDoc(int(id)));
  genHandle('pv:downloadDoc', (id) => pvPdfService.downloadDoc(int(id)));
  genHandle('pv:printDoc', (id) => pvPdfService.printDoc(int(id)));
  genHandle('pv:delete', (id) => pvService.deletePv(int(id)));

  /* ---------- السجلات المهنية (Professional Registers) ---------- */
  const regFilters = (f) => ({
    registerId: f.registerId ? int(f.registerId) : null,
    kind: str(f.kind),
    page: int(f.page) || 1,
    pageSize: int(f.pageSize) || 25,
    from: str(f.from),
    to: str(f.to),
    typeId: f.typeId ? int(f.typeId) : null,
    status: str(f.status),
    user: str(f.user),
    dossier: str(f.dossier),
    q: str(f.q, 300)
  });

  genHandle('reg:listRegisters', () => registersService.listRegisters());
  genHandle('reg:config', () => registersService.config());
  genHandle('reg:updateConfig', (input) => registersService.updateConfig({
    registerId: int(input.registerId),
    numberingPattern: str(input.numberingPattern, 120),
    seqFrequency: str(input.seqFrequency, 20),
    nameAr: str(input.nameAr, 300),
    nameFr: str(input.nameFr, 300),
    descriptionAr: str(input.descriptionAr, 2000),
    descriptionFr: str(input.descriptionFr, 2000),
    schemaJson: str(input.schemaJson, 20000),
    officialTemplateRef: str(input.officialTemplateRef, 500),
    effectiveFrom: str(input.effectiveFrom, 20),
    autoDaily: input.autoDaily !== undefined ? bool(input.autoDaily) : undefined,
    autoAccounting: input.autoAccounting !== undefined ? bool(input.autoAccounting) : undefined,
    active: input.active !== undefined ? bool(input.active) : undefined
  }));
  genHandle('reg:dashboard', () => registersService.dashboard());
  genHandle('reg:entries', (f) => registersService.listEntries(regFilters(f)));
  genHandle('reg:entryGet', (id) => registersService.getEntry(int(id)));
  genHandle('reg:entryCancel', (id, reason) => registersService.cancelEntry(int(id), str(reason, 2000)));
  genHandle('reg:entryCreateManual', (input) => {
    const kind = str(input.kind) === 'accounting' ? 'accounting' : 'daily';
    if (kind === 'accounting') {
      return registersService.createAccountingEntry({
        paymentId: int(input.paymentId),
        flowType: str(input.flowType) === 'refund' ? 'refund' : 'income',
        amount: num(input.amount),
        currency: str(input.currency) || 'MAD',
        entryDate: str(input.entryDate),
        reference: str(input.reference),
        values: input.values || {},
        reason: str(input.reason)
      });
    }
    return registersService.createDailyEntry({
      procedureId: int(input.procedureId),
      entryDate: str(input.entryDate),
      referenceNumber: str(input.referenceNumber),
      values: input.values || {},
      reason: str(input.reason)
    });
  });
  genHandle('reg:correctionRequest', (id, reason) => registersService.requestCorrection(int(id), str(reason, 2000)));
  genHandle('reg:corrections', (f) => registersService.listCorrections({
    registerId: f.registerId ? int(f.registerId) : null,
    status: str(f.status),
    page: int(f.page) || 1,
    pageSize: int(f.pageSize) || 25
  }));
  genHandle('reg:correctionApprove', (id, note) => registersService.approveCorrection(int(id), str(note, 1000)));
  genHandle('reg:correctionReject', (id, note) => registersService.rejectCorrection(int(id), str(note, 1000)));
  genHandle('reg:sealPeriod', (registerId, periodKey, note) => registersService.sealPeriod(int(registerId), str(periodKey), str(note, 1000)));
  genHandle('reg:sealVerify', (sealId) => registersService.verifySeal(int(sealId)));
  genHandle('reg:seals', (registerId) => registersService.listSeals(int(registerId)));
  genHandle('reg:periods', (registerId) => registersService.listPeriods(int(registerId)));
  genHandle('reg:periodSetStatus', (registerId, periodKey, status, note) =>
    registersService.setPeriodStatus(int(registerId), str(periodKey), str(status), str(note, 2000)));
  genHandle('reg:audit', (f) => registersService.listAudit({
    registerId: f.registerId ? int(f.registerId) : null,
    entryId: f.entryId ? int(f.entryId) : null,
    action: str(f.action),
    page: int(f.page) || 1,
    pageSize: int(f.pageSize) || 50
  }));
  genHandle('reg:search', (q) => registersService.globalSearch(str(q, 300)));

  /* ---------- السجلات: تصدير (CSV/XLS) — نسخة فقط، لا تعديل للسجل ---------- */
  genHandle('reg:export', async (kind, f) => {
    kind = str(kind) === 'xls' ? 'xls' : 'csv';
    const res = await registersService.listEntries({ ...regFilters(f), pageSize: 500 });
    if (!res.rows.length) throw new Error('REGISTER:NO_ROWS');
    const defName = `${res.register.code.toLowerCase()}-${res.rows[0].entry_date || ''}-${(res.rows[res.rows.length - 1] || {}).entry_date || ''}`;
    const result = await dialog.showSaveDialog({
      defaultPath: path.join(app.getPath('documents'), defName + '.' + kind),
      filters: kind === 'csv' ? [{ name: 'CSV', extensions: ['csv'] }] : [{ name: 'Excel', extensions: ['xls'] }]
    });
    if (result.canceled || !result.filePath) return { ok: true, data: { canceled: true } };
    const ar = true;
    const isAcc = res.register.kind === 'accounting';
    const headers = isAcc
      ? ['الرقم التسلسلي', 'التاريخ', 'المرجع', 'رقم الإجراء', 'رقم الملف', 'المبلغ', 'العملة', 'الوصل', 'الحالة', 'المستخدم', 'سبب التعليق']
      : ['الرقم التسلسلي', 'التاريخ', 'رقم الإجراء', 'رقم الملف', 'نوع الإجراء', 'الأطراف', 'المحضر', 'المرجع', 'الحالة', 'المستخدم', 'سبب التعليق'];
    const cell = (r) => isAcc
      ? [r.serial_no, r.entry_date, r.reference || '', r.procedure_number || '', r.dossier_number || '',
         r.amount != null ? Number(r.amount) : '', r.currency || '', r.receipt_number || r.rc_receipt_number || '',
         r.status, r.created_by, r.reason || '']
      : [r.serial_no, r.entry_date, r.procedure_number || r.procedure_number_snapshot || '', r.dossier_number || '',
         r.type_name_ar || r.type_name_fr || '', r.parties_summary || '', r.pv_number || '', r.reference_number || '',
         r.status, r.created_by, r.reason || ''];

    if (kind === 'csv') {
      const lines = [headers.join(';')];
      res.rows.forEach((r) => {
        lines.push(cell(r).map((v) => `"${(v == null ? '' : v).toString().replace(/"/g, '""')}"`).join(';'));
      });
      fs.writeFileSync(result.filePath, '\uFEFF' + lines.join('\r\n'), 'utf8');
    } else {
      const escX = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const rowsXml = res.rows.map((r) =>
        `<Row>${cell(r).map((v) => {
          const isNum = typeof v === 'number';
          return `<Cell><Data ss:Type="${isNum ? 'Number' : 'String'}">${escX(v)}</Data></Cell>`;
        }).join('')}</Row>`
      ).join('');
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Worksheet ss:Name="${escX(res.register.code)}">
  <Table>${rowsXml}</Table>
 </Worksheet>
</Workbook>`;
      fs.writeFileSync(result.filePath, '\uFEFF' + xml, 'utf8');
    }
    registersService.auditExport(res.register.id, kind);
    return { ok: true, path: result.filePath };
  });

  /* ---------- السجلات: PDF / طباعة (A4 RTL بأرقام صفحات) ---------- */
  async function regBuildPdf(f) {
    const res = await registersService.listEntries({ ...regFilters(f), pageSize: 500 });
    if (!res.rows.length) throw new Error('REGISTER:NO_ROWS');
    const settingsBackend = require('./services/settingsService');
    const office = settingsBackend.getOffice();
    const authBackend = require('./services/auth');
    const now = new Date();
    const html = registersService.buildRegisterHtml(res.register, res.rows, {
      lang: (f && f.lang) === 'fr' ? 'fr' : 'ar',
      office,
      from: res.rows[0].entry_date,
      to: res.rows[res.rows.length - 1].entry_date,
      generatedAt: f.from || now.toISOString().slice(0, 10),
      by: authBackend.getCurrentUser().display_name || authBackend.getCurrentUser().username
    });
    const buf = await documentService.renderToPdf(html);
    return { buf, res };
  }

  genHandle('reg:exportPdf', async (f) => {
    const { buf, res } = await regBuildPdf(f);
    const result = await dialog.showSaveDialog({
      defaultPath: path.join(app.getPath('documents'), `${res.register.code.toLowerCase()}-register.pdf`),
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    });
    if (result.canceled || !result.filePath) return { ok: true, data: { canceled: true } };
    fs.writeFileSync(result.filePath, buf);
    registersService.auditExport(res.register.id, 'pdf');
    return { ok: true, path: result.filePath };
  });

  genHandle('reg:print', async (f) => {
    const { buf, res } = await regBuildPdf(f);
    const tmp = path.join(os.tmpdir(), `register-${res.register.code}-${Date.now()}.pdf`);
    fs.writeFileSync(tmp, buf);
    shell.openPath(tmp);
    registersService.auditExport(res.register.id, 'print');
    return { ok: true, path: tmp };
  });

  /* ---------- السجلات: أرشفة فترة (السجل + الوثيقة معاً) ---------- */
  genHandle('reg:archivePeriod', async (registerId, periodKey) => {
    const f = { registerId: int(registerId), from: periodKey + '-01', to: periodKey + '-31' };
    const res = await registersService.listEntries({ ...regFilters(f), pageSize: 500 });
    if (!res.rows.length) throw new Error('REGISTER:NO_ROWS');
    const office = require('./services/settingsService').getOffice();
    const authBackend = require('./services/auth');
    const html = registersService.buildRegisterHtml(res.register, res.rows, {
      lang: 'ar', office, from: periodKey + '-01', to: periodKey + '-31',
      generatedAt: periodKey + '-01', by: authBackend.getCurrentUser().display_name || authBackend.getCurrentUser().username,
      watermark: 'نسخة أرشيفية'
    });
    const buf = await documentService.renderToPdf(html);
    const archiveDir = archiveService.getArchiveDir();
    if (!archiveDir) throw new Error('ARCHIVE:NOT_INITIALIZED');
    const fileName = `${res.register.code.toLowerCase()}-${periodKey}-archive.pdf`;
    const filePath = archiveService.archivePathFor('registers', `${res.register.code}-${periodKey}`, fileName);
    fs.writeFileSync(filePath, buf);
    const out = registersService.archivePeriod(res.register.id, periodKey, `أرشيف ${res.register.name_ar} — ${periodKey}`, filePath);
    return { ok: true, filePath, document: out.document_id };
  });
}

module.exports = { register };
