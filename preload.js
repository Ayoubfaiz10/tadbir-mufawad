'use strict';

/* ================================================================
   Preload — جسر آمن عبر contextBridge.
   الـRenderer لا يلمس SQLite ولا ملفات النظام مباشرة.
   ================================================================ */

const { contextBridge, ipcRenderer } = require('electron');

function expose(channel) {
  return (...args) => ipcRenderer.invoke(channel, ...args).then((r) => {
    if (!r || r.ok === undefined) return r;
    if (!r.ok) {
      const err = new Error(r.error || 'UNKNOWN');
      err.code = r.error;
      throw err;
    }
    return r.data;
  });
}

contextBridge.exposeInMainWorld('appAPI', {
  // الواجهة القديمة (لوحة/ملفات/عملاء)
  getState: expose('app:getState'),
  saveDossier: expose('app:saveDossier'),
  deleteDossier: expose('app:deleteDossier'),
  saveClient: expose('app:saveClient'),
  deleteClient: expose('app:deleteClient'),
  exportCsv: expose('app:exportCsv'),
  getLocale: expose('app:getLocale'),

  // الملفات والأطراف
  dossierSearch: expose('app:dossierSearch'),
  dossierParties: expose('app:dossierParties'),
  dossierDetail: expose('app:dossierDetail'),
  partySave: expose('app:partySave'),
  partyDelete: expose('app:partyDelete'),
  partyLinkClient: expose('app:partyLinkClient'),
  clientDetail: expose('app:clientDetail'),
  clientSearch: expose('app:clientSearch'),
  clientFindByCin: expose('app:clientFindByCin'),

  // التوثيق
  authLogin: expose('auth:login'),
  authLogout: expose('auth:logout'),
  authChangePassword: expose('auth:changePassword'),
  authSetupInitial: expose('auth:setupInitial'),
  authCurrent: expose('auth:current'),
  authUsers: expose('auth:users'),
  authUserCreate: expose('auth:userCreate'),
  authUserSetActive: expose('auth:userSetActive'),
  authUserDelete: expose('auth:userDelete'),
  authUserResetPassword: expose('auth:userResetPassword'),
  authIsAuthorized: expose('auth:isAuthorized'),

  // الإعدادات
  configSnapshot: expose('config:snapshot'),
  configCategories: expose('config:categories'),
  configTypes: expose('config:types'),
  configTypesFull: expose('config:typesFull'),
  configTypeAdd: expose('config:typeAdd'),
  configStatuses: expose('config:statuses'),
  configTransitions: expose('config:transitions'),
  configStatusAdd: expose('config:statusAdd'),
  configStatusUpdate: expose('config:statusUpdate'),
  configPvTemplates: expose('config:pvTemplates'),
  configTypeUpdate: expose('config:typeUpdate'),
  configTransitionAdd: expose('config:transitionAdd'),
  configTransitionDelete: expose('config:transitionDelete'),

  // الإجراءات
  procList: expose('proc:list'),
  procStats: expose('proc:stats'),
  procGet: expose('proc:get'),
  procCreate: expose('proc:create'),
  procUpdate: expose('proc:update'),
  procDelete: expose('proc:delete'),
  procStatusChange: expose('proc:statusChange'),
  procNextStatus: expose('proc:nextStatus'),

  // الأداءات
  payAdd: expose('pay:add'),
  payList: expose('pay:list'),
  payGet: expose('pay:get'),
  payConfirm: expose('pay:confirm'),
  payCancel: expose('pay:cancel'),
  payRefund: expose('pay:refund'),
  payRefunds: expose('pay:refunds'),
  payStats: expose('pay:stats'),
  payMethods: expose('pay:methods'),
  payMethodAdd: expose('pay:methodAdd'),
  payMethodUpdate: expose('pay:methodUpdate'),
  payCancelReceipt: expose('pay:cancelReceipt'),
  payFinancialAudit: expose('pay:financialAudit'),

  // التعريفات
  tariffList: expose('tariff:list'),
  tariffGet: expose('tariff:get'),
  tariffAdd: expose('tariff:add'),
  tariffUpdate: expose('tariff:update'),
  tariffDelete: expose('tariff:delete'),
  tariffStats: expose('tariff:stats'),
  tariffRules: expose('tariff:rules'),
  tariffRuleAdd: expose('tariff:ruleAdd'),
  tariffRuleDelete: expose('tariff:ruleDelete'),
  tariffSuggest: expose('tariff:suggest'),

  // التقييمات
  assessmentCreate: expose('assessment:create'),
  assessmentGet: expose('assessment:get'),
  assessmentList: expose('assessment:list'),
  assessmentConfirm: expose('assessment:confirm'),
  assessmentCancel: expose('assessment:cancel'),
  assessmentItemAdd: expose('assessment:itemAdd'),
  assessmentItemRemove: expose('assessment:itemRemove'),
  assessmentStats: expose('assessment:stats'),

  // الدفتر الحسابي
  accountingList: expose('accounting:list'),
  accountingGet: expose('accounting:get'),
  accountingSummary: expose('accounting:summary'),
  accountingDashboard: expose('accounting:dashboard'),
  accountingProcedureReport: expose('accounting:procedureReport'),

  // الوثائق
  docGeneratePv: expose('doc:generatePv'),
  docGenerateReceipt: expose('doc:generateReceipt'),
  docList: expose('doc:list'),
  docOpen: expose('doc:open'),
  docDownload: expose('doc:download'),
  docPrint: expose('doc:print'),
  docDelete: expose('doc:delete'),

  // الأرشيف المركزي (Central Archive)
  arcSearch: expose('arc:search'),
  arcStats: expose('arc:stats'),
  arcGet: expose('arc:get'),
  arcUpdate: expose('arc:update'),
  arcDelete: expose('arc:delete'),
  arcPermanentDelete: expose('arc:permanentDelete'),
  arcRestore: expose('arc:restore'),
  arcLock: expose('arc:lock'),
  arcUnlock: expose('arc:unlock'),
  arcVersions: expose('arc:versions'),
  arcAuditLog: expose('arc:auditLog'),
  arcTags: expose('arc:tags'),
  arcTagAdd: expose('arc:tagAdd'),
  arcTagRemove: expose('arc:tagRemove'),
  arcRelations: expose('arc:relations'),
  arcRelationAdd: expose('arc:relationAdd'),
  arcRelationRemove: expose('arc:relationRemove'),
  arcDocTypes: expose('arc:docTypes'),
  arcDocTypeAdd: expose('arc:docTypeAdd'),
  arcDocTypeUpdate: expose('arc:docTypeUpdate'),
  arcDocTypeDelete: expose('arc:docTypeDelete'),
  arcCreateWithFile: expose('arc:createWithFile'),
  arcArchivedTemplates: expose('arc:archivedTemplates'),
  arcVerifyIntegrity: expose('arc:verifyIntegrity'),
  arcUpload: expose('arc:upload'),
  arcOpenDoc: expose('doc:open'),

  // التدقيق
  auditProcedure: expose('audit:procedure'),

  // الإعدادات العامة (المكتب)
  settingsGetOffice: expose('settings:getOffice'),
  settingsSaveOffice: expose('settings:saveOffice'),

  // مكتبة النماذج
  tplList: expose('tpl:list'),
  tplStats: expose('tpl:stats'),
  tplGet: expose('tpl:get'),
  tplCategories: expose('tpl:categories'),
  tplAdd: expose('tpl:add'),
  tplUpdate: expose('tpl:update'),
  tplSetActive: expose('tpl:setActive'),
  tplSetArchived: expose('tpl:setArchived'),
  tplDuplicate: expose('tpl:duplicate'),
  tplForProcedure: expose('tpl:forProcedure'),
  tplVariables: expose('tpl:variables'),
  tplRenderPreview: expose('tpl:renderPreview'),
  tplRenderDraft: expose('tpl:renderDraft'),
  docGenerateTemplate: expose('doc:generateTemplate'),

  // المحاضر (Procès-Verbaux)
  pvTypes: expose('pv:types'),
  pvStatuses: expose('pv:statuses'),
  pvTransitions: expose('pv:transitions'),
  pvList: expose('pv:list'),
  pvStats: expose('pv:stats'),
  pvGet: expose('pv:get'),
  pvCreate: expose('pv:create'),
  pvSaveContent: expose('pv:saveContent'),
  pvRefreshFromTemplate: expose('pv:refreshFromTemplate'),
  pvUpdateMeta: expose('pv:updateMeta'),
  pvApplyStatus: expose('pv:applyStatus'),
  pvFinalize: expose('pv:finalize'),
  pvRegenerateCopy: expose('pv:regenerateCopy'),
  pvSetCopyStatus: expose('pv:setCopyStatus'),
  pvPreview: expose('pv:preview'),
  pvOpenDoc: expose('pv:openDoc'),
  pvDownloadDoc: expose('pv:downloadDoc'),
  pvPrintDoc: expose('pv:printDoc'),
  pvDelete: expose('pv:delete'),
  pvTypeUpdate: expose('pv:typeUpdate'),
  pvStatusUpdate: expose('pv:statusUpdate'),

  onMenuExport: (cb) => ipcRenderer.on('menu:export', (_e, kind) => cb(kind)),

  // السجلات المهنية (Professional Registers)
  regListRegisters: expose('reg:listRegisters'),
  regConfig: expose('reg:config'),
  regUpdateConfig: expose('reg:updateConfig'),
  regDashboard: expose('reg:dashboard'),
  regEntries: expose('reg:entries'),
  regEntryGet: expose('reg:entryGet'),
  regEntryCancel: expose('reg:entryCancel'),
  regEntryCreateManual: expose('reg:entryCreateManual'),
  regCorrectionRequest: expose('reg:correctionRequest'),
  regCorrections: expose('reg:corrections'),
  regCorrectionApprove: expose('reg:correctionApprove'),
  regCorrectionReject: expose('reg:correctionReject'),
  regSealPeriod: expose('reg:sealPeriod'),
  regSealVerify: expose('reg:sealVerify'),
  regSeals: expose('reg:seals'),
  regPeriods: expose('reg:periods'),
  regPeriodSetStatus: expose('reg:periodSetStatus'),
  regAudit: expose('reg:audit'),
  regSearch: expose('reg:search'),
  regArchivePeriod: expose('reg:archivePeriod'),
  regExportCsv: expose('reg:export'),
  regExportPdf: expose('reg:exportPdf'),
  regPrint: expose('reg:print'),

  /* ---------- محرك تدفق العمل ---------- */
  wfStatus: expose('wf:status'),
  wfProgress: expose('wf:progress'),
  wfStages: expose('wf:stages'),
  wfCompleteStage: expose('wf:completeStage'),
  wfRevertStage: expose('wf:revertStage'),
  wfStats: expose('wf:stats'),

  /* ---------- النسخ الاحتياطي ---------- */
  backupList: expose('backup:list'),
  backupCreate: expose('backup:create'),
  backupDelete: expose('backup:delete'),
  backupRestore: expose('backup:restore'),
  backupRestoreUpload: expose('backup:restoreUpload')
});
