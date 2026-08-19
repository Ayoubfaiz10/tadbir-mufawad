'use strict';

/* ================================================================
   اختبارات الخدمات الخلفية (بدون Electron).
   يغطي: البذرة، التحقق، إنشاء قضائي/مباشر، الحالة، البحث، الأداء،
   الأرشفة، التدقيق، الصلاحيات، التوافق القديم.
   تشغيل: node tests/backend.test.js
   ================================================================ */

const fs = require('fs');
const path = require('path');
const os = require('os');

const TEST_DATA_DIR = path.join(os.tmpdir(), 'huissier-test-' + Date.now());
fs.mkdirSync(TEST_DATA_DIR, { recursive: true });

let passed = 0;
let failed = 0;

function log(msg) { console.log('  ' + msg); }

function assert(cond, name) {
  if (cond) { passed++; log('✔ ' + name); }
  else { failed++; log('✘ FAIL: ' + name); }
}

function throws(fn, name) {
  try {
    fn();
    failed++; log('✘ FAIL (expected throw): ' + name);
  } catch (e) {
    passed++; log('✔ ' + name);
  }
}

async function main() {
  process.chdir(__dirname);
  const { initDatabase } = require('../db/database');
  await initDatabase(TEST_DATA_DIR);
  const { get } = require('../db/database').helpers;

  const configService = require('../services/configService');
  const procSvc = require('../services/procedureService');
  const statusSvc = require('../services/statusEngine');
  const auditSvc = require('../services/audit');
  const authSvc = require('../services/auth');
  const paySvc = require('../services/paymentService');
  const dosageSvc = require('../services/dossierService');
  const clientSvc = require('../services/clientService');
  const feeSvc = require('../services/feeService');
  const acctSvc = require('../services/accountingService');

  console.log('\n=== 0. التسجيل الأول (First Setup) ===');
  assert(authSvc.needsSetup() === true, 'عند أول تشغيل: تسجيل أول مطلوب');
  const firstUser = authSvc.setupInitial('admin', 'مدير المكتب', 'admin123');
  assert(firstUser && firstUser.role === 'admin', 'التسجيل الأول ينشئ حساب المدير ويسجّل الدخول');
  throws(() => authSvc.setupInitial('second', 'المدير الثاني', '123456'), 'لا يمكن تكرار التسجيل الأول');
  assert(authSvc.needsSetup() === false, 'بعد التسجيل الأول: لا حاجة لتهيئة');
  const { hashPassword } = require('../services/pwHash');
  const { run } = require('../db/database').helpers;
  run('UPDATE users SET password_hash = ? WHERE username = ?', [hashPassword('agent123'), 'agent']);
  assert(authSvc.needsSetup() === false, 'بعد ضبط كلمة مرور الوكيل: لا تسجيل أول');

  console.log('\n=== 1. البذرة والإعدادات ===');
  const cats = configService.listCategories();
  assert(cats.length === 2, 'فئتان: Judicial + Direct');
  assert(cats.some((c) => c.code === 'JUDICIAL') && cats.some((c) => c.code === 'DIRECT'), 'أكواد الفئات');

  const types = configService.listTypesFull();
  assert(types.length === 8, '8 أنواع إجراء');
  const notifType = types.find((t) => t.code === 'NOTIFICATION');
  const constatType = types.find((t) => t.code === 'CONSTATATIONS');
  assert(notifType && notifType.fields.length >= 3, 'حقول ديناميكية للتبليغ');
  assert(constatType && constatType.fields.length >= 3, 'حقول ديناميكية للمعاينة');

  const statuses = configService.listStatuses();
  assert(statuses.length === 5, '5 حالات افتراضية');
  const trans = configService.listTransitions();
  assert(trans.length > 0, 'انتقالات مسجلة');

  const directCat = cats.find((c) => c.code === 'DIRECT');
  const newType = configService.addType({
    categoryId: directCat.id, code: 'NEW_CUSTOM', nameAr: 'نوع جديد', nameFr: 'Nouveau type',
    fields: [{ fieldKey: 'custom_field', labelAr: 'حقل مخصص', labelFr: 'Champ custom', fieldType: 'text', required: true }]
  });
  assert(newType && newType.id > 0, 'إضافة نوع جديد من Settings');
  const newTypeFields = configService.listFieldsForType(newType.id);
  assert(newTypeFields.length === 1 && newTypeFields[0].required === 1, 'الحقل المخصص أُضيف');

  console.log('\n=== 2. الملفات والأطراف ===');
  const dossier = dosageSvc.save({
    numero: 'DOS-2026-0001', demandeur: 'أحمد العلوي', defendeur: 'شركة النور',
    court: 'المحكمة الابتدائية بالدار البيضاء', type: 'مدني', status: 'open', date: '2026-08-01'
  });
  assert(dossier.id > 0, 'إنشاء ملف');
  const parties = dosageSvc.listPartiesByDossier(dossier.id);
  assert(parties.length === 2, 'أطراف تلقائية (طالب + معني)');

  const demandeur = parties.find((p) => p.role === 'demandeur');
  const partyUpdated = dosageSvc.saveParty({ id: demandeur.id, dossier_id: dossier.id, role: 'demandeur', name: 'أحمد العلوي', cin: 'AB123456', address: 'الدار البيضاء', phone: '0612345678' });
  assert(partyUpdated.cin === 'AB123456', 'تحديث CIN للطرف');

  console.log('\n=== 3. إنشاء إجراء قضائي (التبليغ) ===');
  const created = procSvc.createProcedure({
    dossier_id: dossier.id,
    procedure_type_id: notifType.id,
    status: 'NEW',
    requested_by: 'أحمد العلوي',
    amount: 200,
    assigned_to: 'agent',
    notes: 'تبليغ استدعاء',
    party_ids: [demandeur.id],
    field_values: { act_to_notify: 'استدعاء للمثول', notif_date: '2026-08-10', notif_place: 'الدار البيضاء' }
  });
  assert(!!created && !!created.procedure_number, 'رقم إجراء مولّد');
  assert(/^PR-\d{4}-\d{4}$/.test(created.procedure_number), 'صيغة الرقم PR-YYYY-XXXX');
  assert(created.dossier && created.dossier.numero === 'DOS-2026-0001', 'مرتبط بالملف');
  assert(created.fieldValues.find((f) => f.field_key === 'act_to_notify').value === 'استدعاء للمثول', 'قيم الحقول محفوظة');
  assert(created.parties.length === 1, 'الطرف مرتبط');
  assert(created.status === 'NEW', 'الحالة الافتراضية NEW');

  throws(() => procSvc.createProcedure({ procedure_type_id: notifType.id }), 'رفض بدون Dossier');
  throws(() => procSvc.createProcedure({ dossier_id: dossier.id }), 'رفض بدون Type');
  throws(() => procSvc.createProcedure({ dossier_id: 99999, procedure_type_id: notifType.id }), 'رفض Dossier غير موجود');
  throws(() => procSvc.createProcedure({ dossier_id: dossier.id, procedure_type_id: notifType.id, amount: -5 }), 'رفض مبلغ سالب');

  const second = procSvc.createProcedure({ dossier_id: dossier.id, procedure_type_id: notifType.id, status: 'NEW', field_values: {} });
  assert(second.id !== created.id && second.procedure_number !== created.procedure_number, 'رقم فريد لكل إجراء');

  console.log('\n=== 4. إنشاء إجراء مباشر (معاينة) ===');
  const direct = procSvc.createProcedure({
    dossier_id: dossier.id,
    procedure_type_id: constatType.id,
    status: 'NEW',
    amount: 300,
    party_ids: [],
    field_values: { constat_object: 'معاينة حالة عين', constat_date: '2026-08-12', constat_place: 'عين السبع' }
  });
  assert(direct.dossier.numero === 'DOS-2026-0001', 'إجراء مباشر مرتبط بنفس الملف');
  assert(get('SELECT category_id FROM procedures WHERE id = ?', [direct.id]).category_id !==
         get('SELECT category_id FROM procedures WHERE id = ?', [created.id]).category_id, 'تصنيفات مختلفة');

  console.log('\n=== 5. محرك الحالة ===');
  const nexts = statusSvc.allowedTransitions('NEW');
  assert(nexts.includes('IN_PROGRESS') && nexts.includes('POSTPONED') && nexts.includes('CANCELLED'), 'استعلام من NEW');
  throws(() => statusSvc.applyStatus(created.id, 'COMPLETED'), 'ممنوع: NEW → COMPLETED مباشرة');
  const st1 = statusSvc.applyStatus(created.id, 'IN_PROGRESS', 'بدء المعالجة');
  assert(st1.status === 'IN_PROGRESS', 'NEW → IN_PROGRESS مسموح');
  const st2 = statusSvc.applyStatus(created.id, 'COMPLETED', 'تم');
  assert(st2.status === 'COMPLETED' && !!st2.completed_at, 'IN_PROGRESS → COMPLETED + تاريخ إكمال');
  const hist = statusSvc.history(created.id);
  assert(hist.length >= 2, 'سجل الحالة مسجل');
  assert(hist.some((h) => h.from_status === '' && h.to_status === 'NEW'), 'السجل الأول من الإنشاء مسجل');

  console.log('\n=== 6. البحث والفلاتر ===');
  let listQ = procSvc.list({ q: 'أحمد' });
  assert(listQ.total >= 1 && listQ.rows.some((r) => r.dossier_demandeur === 'أحمد العلوي'), 'بحث بالاسم');
  listQ = procSvc.list({ q: created.procedure_number });
  assert(listQ.total === 1, 'بحث برقم الإجراء');
  listQ = procSvc.list({ q: 'DOS-2026-0001' });
  assert(listQ.total >= 3, 'بحث برقم الملف');
  listQ = procSvc.list({ q: 'AB123456' });
  assert(listQ.total >= 1, 'بحث بـ CIN');
  listQ = procSvc.list({ q: 'استدعاء' });
  assert(listQ.total >= 1, 'بحث بنوع الإجراء/ملاحظات');
  let filtered = procSvc.list({ status: 'COMPLETED' });
  assert(filtered.rows.every((r) => r.status === 'COMPLETED'), 'فلترة حسب الحالة');
  filtered = procSvc.list({ category: directCat.id });
  assert(filtered.rows.every((r) => r.category_code === 'DIRECT'), 'فلترة حسب التصنيف');

  const statsS = procSvc.stats();
  assert(statsS.total >= 3, 'إحصائيات: العدد الكلي');
  assert(typeof statsS.today === 'number' && typeof statsS.inProgress === 'number', 'إحصائيات اليوم/قيد الإنجاز');

  const p1 = procSvc.list({ page: 1, pageSize: 1 });
  const p2 = procSvc.list({ page: 2, pageSize: 1 });
  assert(p1.total === p2.total && p1.rows[0].id !== p2.rows[0].id, 'ترقيم الصفحات مفهرس');

  console.log('\n=== 7. الأداءات والوصولات والأرشيف ===');
  const pay = paySvc.addPayment(direct.id, { amount: 300, method: 'نقداً', status: 'received', reference: 'REF-1' });
  assert(pay.id > 0 && pay.amount === 300, 'إضافة أداء');
  throws(() => paySvc.addPayment(direct.id, { amount: -10 }), 'رفض مبلغ أداء سالب');
  const pay2 = paySvc.addPayment(created.id, { amount: 200, method: 'تحويل' });
  assert(pay2.procedure_id === created.id, 'أداء على إجراء آخر');

  console.log('\n=== 8. التدقيق ===');
  const auditRows = auditSvc.listForEntity('procedure', created.id);
  assert(auditRows.some((a) => a.action === 'procedure.created'), 'تدقيق: الإنشاء');
  assert(auditRows.some((a) => a.action === 'procedure.status_changed'), 'تدقيق: تغيير الحالة');
  assert(auditSvc.listForEntity('procedure', direct.id).some((a) => a.action === 'payment.created'), 'تدقيق: الأداء');

  console.log('\n=== 9. الصلاحيات ===');
  authSvc.login('admin', 'admin123');
  let removed = false;
  try { procSvc.deleteProcedure(created.id); removed = true; } catch (e) {}
  assert(removed === true, 'admin يستطيع حذف إجراء');
  authSvc.login('agent', 'agent123');
  throws(() => procSvc.deleteProcedure(direct.id), 'agent ممنوع من حذف الإجراءات');
  throws(() => { authSvc.login('ghost'); }, 'تسجيل دخول مستخدم غير موجود');
  authSvc.login('admin', 'admin123');

  console.log('\n=== 9ب. الأمان: كلمات المرور والجلسات ===');
  throws(() => authSvc.login('admin', 'bad-pass'), 'كلمة مرور خاطئة مرفوضة');
  assert(authSvc.getCurrentUser() && authSvc.getCurrentUser().role === 'admin', 'الجلسة تبقى غير متأثرة بالفشل');
  assert(authSvc.getCurrentUser().password_hash === undefined, 'كلمة المرور لا تُكشف في الجلسة');
  throws(() => authSvc.changePassword('bad-pass', 'newpass123'), 'تغيير بكلمة مرور حالية خاطئة مرفوض');
  throws(() => authSvc.changePassword('admin123', '123'), 'كلمة مرور قصيرة مرفوضة');
  authSvc.changePassword('admin123', 'newpass123');
  throws(() => authSvc.login('admin', 'admin123'), 'القديمة لم تعد صالحة بعد التغيير');
  authSvc.login('admin', 'newpass123');
  const off = authSvc.getCurrentUser();
  assert(off && off.username === 'admin', 'الدخول بالجديدة يعمل');
  authSvc.logout();
  assert(authSvc.getCurrentUser().id === 0, 'تسجيل الخروج يفرّغ الجلسة');
  throws(() => authSvc.requireAuth(), 'requireAuth يرفض جلسة فارغة');
  throws(() => authSvc.changePassword('x', 'y'), 'تغيير كلمة المرور يتطلب جلسة');
  authSvc.login('admin', 'newpass123');
  authSvc.changePassword('newpass123', 'admin123');
  authSvc.login('admin', 'admin123');

  console.log('\n=== 10. التوافق مع الواجهة القديمة ===');
  const cl = clientSvc.save({ name: 'محمد', phone: '06', type: 'فرد' });
  assert(cl.id > 0, 'حفظ عميل');
  assert(clientSvc.count() === 1, 'عد العملاء');
  const dd = dosageSvc.listAll();
  assert(dd.length >= 1, 'قائمة ملفات');

  console.log('\n=== 11. مكتبة النماذج (Template Engine + Versioning) ===');
  authSvc.login('admin', 'admin123');
  const tplSvc = require('../services/templateService');
  const engine = require('../services/templateEngineService');

  const tcats = tplSvc.listCategories();
  assert(tcats.length === 10, '10 تصنيفات نماذج');

  const vars = engine.extractVariables('<p>{{dossier_number}}</p><p>{{party_cin}} — {{field.act_to_notify}}</p>');
  assert(vars.includes('dossier_number') && vars.includes('party_cin') && vars.includes('field.act_to_notify'), 'استخراج المتغيرات');

  const ctx = engine.buildContext({ dossier: { numero: 'D1', demandeur: 'أحمد' }, parties: [{ name: 'X', cin: 'C123' }] }, { lang: 'ar' });
  assert(ctx.dossier_number === 'D1' && ctx.party_cin === 'C123', 'بناء السياق من الملف والأطراف');
  assert(engine.resolveContent('نص {{dossier_number}} و {{unknown_var}}', ctx) === 'نص D1 و ', 'استبدال المتغيرات (غير معروف = فارغ)');
  const xssVal = '<script>alert(1)</script>" onmouseover="x';
  const xssOut = engine.resolveContent('{{notes}}', { notes: xssVal });
  assert(!xssOut.includes('<script>') && xssOut.includes('&lt;script&gt;'), 'قيم المتغيرات تُعقّم قبل الإدراج في HTML');
  assert(engine.resolveContent('{{unknown_var}}', ctx, { strict: true }) === '{{unknown_var}}', 'حفظ غير المعروف في وضع Strict');

  const tpl = tplSvc.add({
    name: 'محضر قضائي تجريبي',
    categoryId: tcats.find((c) => c.code === 'NOTIFICATION').id,
    procedureTypeId: notifType.id,
    language: 'ar',
    description: 'اختبار',
    active: true,
    version: '1.0',
    content: '<p>الإجراء: {{procedure_number}} — الملف: {{dossier_number}}</p>'
  });
  assert(tpl.id > 0 && tpl.current.version === '1.0' && tpl.versions.length === 1, 'إضافة نموذج + النسخة الأولى');

  const upd = tplSvc.update(tpl.id, { content: '<p>نسخة محدّثة: {{procedure_number}} {{dossier_number}}</p>', note: 'تعديل' });
  assert(upd.versions.length === 2 && upd.current.version === '1.1', 'تعديل = نسخة جديدة (1.1) مع بقاء القديمة');

  const maj = tplSvc.update(tpl.id, { major: true, content: '<p>ماجور {{procedure_number}}</p>' });
  assert(maj.current.version === '2.0' && maj.versions.length === 3, 'نسخة رئيسية جديدة (2.0)');

  const sug = tplSvc.forProcedure(notifType.id, 'ar');
  assert(sug.some((t) => t.id === tpl.id), 'اقتراح النموذج لنوع التبليغ');

  const dup = tplSvc.duplicate(tpl.id, { name: 'نسخة فرنسية' });
  assert(dup.id !== tpl.id && dup.current.version === '1.0' && dup.language === 'ar', 'تكرار النموذج بنسخة 1.0');

  const payload = tplSvc.getRenderPayload(maj.current.id, direct.id, { lang: 'ar', notes: 'ملاحظة اختبار' });
  assert(payload.resolvedContent.includes(direct.procedure_number), 'تحضير العرض: تعويض رقم الإجراء بالبيانات الحقيقية');
  assert(payload.detail.procedure_number === direct.procedure_number, 'السياق مبني من الإجراء الحقيقي');

  tplSvc.setActive(tpl.id, false);
  assert(tplSvc.get(tpl.id).active === 0, 'تعطيل النموذج');
  const tplFiltered = tplSvc.list({ status: 'active' });
  assert(!tplFiltered.rows.some((r) => r.id === tpl.id), 'النموذج غير النشط لا يظهر للمستخدمين');

  tplSvc.setArchived(tpl.id, true);
  assert(tplSvc.get(tpl.id).archived === 1, 'أرشفة النموذج');
  const noArch = tplSvc.list({});
  assert(!noArch.rows.some((r) => r.id === tpl.id), 'الأرشيف/master لا يظهر في القائمة العادية');

  const st = tplSvc.stats();
  assert(st.total >= 3 && st.active >= 2 && st.archived >= 1, 'إحصائيات المكتبة');

  authSvc.login('agent', 'agent123');
  throws(() => tplSvc.add({ name: 'x', content: '<p>x</p>' }), 'agent ممنوع من إضافة النماذج');
  authSvc.login('admin', 'admin123');

  console.log('\n=== 12. نسخ إجراءات من النماذج (توليد وثيقة = نسخة) ===');
  assert((function () {
    const v = tplSvc.versionBump('1.0');
    const v2 = tplSvc.versionBump('2.0', true);
    return v === '1.1' && v2 === '3.0';
  })(), 'زيادة النسخة (ثانوي/رئيسي)');

  console.log('\n=== 13. المحاضر (PV Module) ===');
  const pvSvc = require('../services/pvService');

  const pvStatuses = pvSvc.listPvStatuses();
  assert(pvStatuses.length === 5, '5 حالات محضر قابلة للتهيئة');
  const pvTypes = pvSvc.listPvTypes();
  assert(pvTypes.length === 4, '4 أنواع محضر قابلة للتهيئة');
  assert(pvSvc.allowedTransitions('DRAFT').includes('IN_REVIEW'), 'من DRAFT يمكن الانتقال إلى المراجعة');

  const pvDos = dosageSvc.save({ numero: 'DOS-PV-0001', demandeur: 'خالد أمين', defendeur: 'شركة بنك المغرب', court: 'المحكمة الابتدائية', type: 'مدني', status: 'open', date: '2026-08-01' });
  const pvProc = procSvc.createProcedure({ dossier_id: pvDos.id, procedure_type_id: notifType.id, status: 'NEW', field_values: { act_to_notify: 'استدعاء للمثول' } });

  const pvTpl = tplSvc.add({ name: 'PV Test', categoryId: tcats.find((c) => c.code === 'NOTIFICATION').id, procedureTypeId: notifType.id, language: 'ar', content: '<p>محضر {{pv_number}} — إجراء {{procedure_number}} — ملف {{dossier_number}}</p>' });

  const pv = pvSvc.createPv({ procedure_id: pvProc.id, pv_type_id: pvTypes[0].id, template_version_id: pvTpl.current.id, language: 'ar', notes: 'ملاحظة أولى' });
  assert(/^PV-\d{4}-\d{4}$/.test(pv.pv_number), 'رقم محضر بالصيغة PV-YYYY-####');
  assert(pv.status === 'DRAFT', 'الحالة الأولية DRAFT');
  assert(pv.versions.length === 1 && pv.versions[0].version === 1, 'إنشاء = نسخة أولى');
  assert(pv.content.includes(pvProc.procedure_number) && pv.content.includes(pv.pv_number), 'تعبئة تلقائية: أرقام الإجراء والمحضر');
  assert(pv.procedure.procedure_number === pvProc.procedure_number, 'ربط المحضر بالإجراء');

  throws(() => pvSvc.applyStatus(pv.id, 'FINALIZED'), 'ممنوع القفز من DRAFT إلى FINALIZED');
  const rv = pvSvc.applyStatus(pv.id, 'IN_REVIEW', 'طلبت المراجعة');
  assert(rv.status === 'IN_REVIEW', 'DRAFT → IN_REVIEW');
  assert(pvSvc.getDetail(pv.id).timeline.some((e) => e.text.includes('pv.status_changed')), 'تدقيق: تغيير الحالة');

  const pvUpd = pvSvc.saveContent(pv.id, '<p>نسخة معدلة {{procedure_number}}</p>', 'تعديل المحتوى');
  assert(pvUpd.versions.length === 2 && pvUpd.versions[0].version === 2, 'تحرير = نسخة جديدة');
  throws(() => pvSvc.saveContent(pv.id, '   '), 'رفض المحتوى الفارغ');

  const fin = pvSvc.applyStatus(pv.id, 'FINALIZED', 'إنهاء');
  assert(fin.status === 'FINALIZED' && !!fin.finalized_at, 'FINALIZED مع تاريخ الإنهاء');
  const copies = pvSvc.createCopies(pv.id);
  assert(copies.length === 3, '3 نظائر (طالب/محكمة/أرشيف)');
  assert(new Set(copies.map((c) => c.destination)).size === 3, 'وجهات النظائر مختلفة');
  assert(copies.every((c) => c.status === 'generated'), 'النظائر بحالة مولّدة');
  throws(() => pvSvc.saveContent(pv.id, '<p>x</p>'), 'ممنوع التحرير بعد الإنهاء');

  const c1 = pvSvc.setCopyStatus(copies[0].id, 'delivered', 'سُلمت للمعني');
  assert(c1.status === 'delivered' && !!c1.delivered_at, 'تسليم نظير بتاريخ');
  throws(() => pvSvc.setCopyStatus(copies[0].id, 'hacked'), 'رفض حالة نظير غير معروفة');

  const arc = pvSvc.applyStatus(pv.id, 'ARCHIVED', 'أرشفة');
  assert(arc.status === 'ARCHIVED' && !!arc.archived_at, 'الأرشفة مع التاريخ');

  let pvList = pvSvc.list({ q: pv.pv_number });
  assert(pvList.total === 1, 'البحث برقم المحضر');
  pvList = pvSvc.list({ status: 'ARCHIVED' });
  assert(pvList.rows.some((r) => r.id === pv.id), 'التصفية حسب الحالة');
  const pvStats = pvSvc.stats();
  assert(pvStats.total >= 1 && pvStats.archived >= 1 && typeof pvStats.drafts === 'number', 'إحصائيات المحاضر');

  authSvc.login('agent', 'agent123');
  throws(() => pvSvc.deletePv(pv.id), 'agent ممنوع من حذف المحضر');
  authSvc.login('admin', 'admin123');
  assert(pvSvc.deletePv(pv.id) === true, 'admin يحذف المحضر');
  throws(() => pvSvc.getDetail(pv.id), 'المحضر غير موجود بعد الحذف');

  console.log('\n=== 14. المحاضر: تحقق متقدم (تحقق/فلاتر/حالات/واجهة) ===');

  // تحقق الإدخال
  throws(() => pvSvc.createPv({ pv_type_id: 1, template_version_id: pvTpl.current.id }), 'رفض بدون إجراء');
  throws(() => pvSvc.createPv({ procedure_id: pvProc.id, pv_type_id: 99999, template_version_id: pvTpl.current.id }), 'رفض نوع محضر غير موجود');
  throws(() => pvSvc.createPv({ procedure_id: pvProc.id, pv_type_id: pvTypes[0].id }), 'رفض بدون قالب');
  throws(() => pvSvc.createPv({ procedure_id: pvProc.id, pv_type_id: pvTypes[0].id, template_version_id: 99999, language: 'ar' }), 'رفض نسخة قالب غير موجودة');

  // إنشاء محضر ثانٍ (ترقيم تسلسلي)
  const pv2 = pvSvc.createPv({ procedure_id: pvProc.id, pv_type_id: pvTypes[1].id, template_version_id: pvTpl.current.id, language: 'fr', title: 'PV français' });
  assert(pv2.pv_number !== pv.pv_number && /^PV-\d{4}-\d{4}$/.test(pv2.pv_number), 'رقم تسلسلي فريد لمحضر ثانٍ');
  assert(pv2.language === 'fr' && pv2.title === 'PV français', 'اللغة والعنوان يُحفظان');
  throws(() => pvSvc.applyStatus(pv2.id, 'NONEXISTENT'), 'رفض حالة غير معروفة');
  throws(() => pvSvc.applyStatus(pv2.id, 'DRAFT'), 'رفض الانتقال لنفس الحالة');
  const htmlFr = pvSvc.renderHtml(pv2.id, 'fr');
  assert(typeof htmlFr === 'string' && htmlFr.includes('<html') && htmlFr.includes(pv2.pv_number), 'معاينة HTML بالفرنسية تحتوي رقم المحضر');
  const htmlAr = pvSvc.renderHtml(pv2.id, 'ar');
  assert(htmlAr.includes('PV') && htmlAr !== htmlFr, 'معاينة HTML بالعربية مختلفة');
  throws(() => pvSvc.renderHtml(99999), 'معاينة لمحضر غير موجود');

  // تحديث بيانات وصفية
  const meta = pvSvc.updateMeta(pv2.id, { title: 'عنوان معدل', notes: 'ملاحظة محدثة', pv_type_id: pvTypes[2].id });
  assert(meta.title === 'عنوان معدل' && meta.notes === 'ملاحظة محدثة' && meta.pv_type_id === pvTypes[2].id, 'تحديث البيانات الوصفية');
  const metaDetail = pvSvc.getDetail(pv2.id);
  assert(metaDetail.type && metaDetail.type.code === pvTypes[2].code, 'النوع المحدّث يظهر في التفاصيل');
  assert(metaDetail.transitions.includes('IN_REVIEW') && !metaDetail.transitions.includes('FINALIZED'), 'انتقالات DRAFT صحيحة في التفاصيل');

  // إعادة التعبئة من القالب (بملاحظة)
  const ref = pvSvc.refreshFromTemplate(pv2.id, { notes: 'ملاحظة إعادة التعبئة' });
  assert(ref.versions.length === 2 && ref.versions[0].version === 2, 'إعادة التعبئة = نسخة جديدة');
  assert(ref.content.includes(pvProc.procedure_number), 'إعادة التعبئة تعيد استبدال المتغيرات');

  // فلاتر القائمة
  let fl = pvSvc.list({ pvTypeId: pvTypes[2].id });
  assert(fl.rows.length === 1 && fl.rows[0].id === pv2.id, 'تصفية حسب نوع المحضر');
  fl = pvSvc.list({ procedureId: pvProc.id });
  assert(fl.rows.length === 1 && fl.rows[0].id === pv2.id, 'تصفية حسب الإجراء');
  fl = pvSvc.list({ dateRange: { from: '2020-01-01', to: '2030-01-01' } });
  assert(fl.rows.some((r) => r.id === pv2.id), 'تصفية حسب نطاق تاريخي');
  fl = pvSvc.list({ q: 'عنوان معدل' });
  assert(fl.rows.some((r) => r.id === pv2.id), 'بحث في العنوان');
  fl = pvSvc.list({ page: 1, pageSize: 1 });
  assert(fl.rows.length === 1 && fl.total === 1, 'ترقيم الصفحات في قائمة المحاضر');

  // رجوع IN_REVIEW → DRAFT ثم إنهاء فعلي
  const backToDraft = pvSvc.applyStatus(pv2.id, 'IN_REVIEW', 'مراجعة ثانية');
  assert(backToDraft.status === 'IN_REVIEW', 'DRAFT → IN_REVIEW (ثانٍ)');
  const reviewBack = pvSvc.applyStatus(pv2.id, 'DRAFT', 'عودة للمسودة');
  assert(reviewBack.status === 'DRAFT', 'IN_REVIEW → DRAFT مسموح');
  pvSvc.applyStatus(pv2.id, 'IN_REVIEW', 'إعادة للمراجعة');
  const fin2 = pvSvc.applyStatus(pv2.id, 'FINALIZED', 'إنهاء فعلي');
  assert(fin2.status === 'FINALIZED' && !!fin2.finalized_by, 'FINALIZED + المستخدم المسجل');
  throws(() => pvSvc.updateMeta(pv2.id, { title: 'x' }), 'ممنوع تحديث بيانات محضر مُنهى');
  throws(() => pvSvc.refreshFromTemplate(pv2.id), 'ممنوع إعادة تعبئة محضر مُنهى');
  const arch2 = pvSvc.applyStatus(pv2.id, 'ARCHIVED', 'أرشفة');
  assert(arch2.status === 'ARCHIVED' && !!arch2.archived_at, 'FINALIZED → ARCHIVED');
  throws(() => pvSvc.applyStatus(pv2.id, 'IN_REVIEW'), 'لا انتقال من ARCHIVED');

  // نظائر على محضر مُنهى + تسليم/إيداع
  const cps2 = pvSvc.createCopies(pv2.id);
  assert(cps2.length === 3, 'نظائر ثانية على محضر مُنهى');
  const dep = pvSvc.setCopyStatus(cps2[1].id, 'deposited', 'أودعت بالمحكمة');
  assert(dep.status === 'deposited' && !!dep.delivered_at, 'إيداع نسخة بتاريخ');
  throws(() => pvSvc.setCopyStatus(99999, 'delivered'), 'رفض نسخة غير موجودة');
  const dupCopy = pvSvc.setCopyStatus(cps2[0].id, 'delivered', 'مرة أخرى');
  assert(dupCopy.status === 'delivered', 'تكرار نفس الحالة مقبول (idempotent)');

  // التدقيق والانتقالات
  const tl2 = pvSvc.getDetail(pv2.id).timeline;
  assert(tl2.length >= 4, 'سجل زمني كامل للمحضر الثاني');
  assert(tl2.some((e) => e.text.includes('FINALIZED')), 'التسلسل الزمني يحتوي الإنهاء');
  assert(pvSvc.listPvTransitions().length >= 7, 'جدول انتقالات قابل للاستعلام');
  assert(pvSvc.getStatus('DRAFT').code === 'DRAFT', 'استعلام حالة واحدة');

  // حذف الإجراء يحذف محاضره (CASCADE)
  const pv3 = pvSvc.createPv({ procedure_id: pvProc.id, pv_type_id: pvTypes[0].id, template_version_id: pvTpl.current.id, language: 'ar' });
  procSvc.deleteProcedure(pvProc.id);
  throws(() => pvSvc.getDetail(pv3.id), 'حذف الإجراء يحذف محاضره تلقائياً (CASCADE)');
  const after = pvSvc.list({});
  assert(after.rows.every((r) => r.id !== pv3.id), 'المحضر المحذوف عبر Cascade لا يظهر في القائمة');

  // pvPdfService يعتمد على documentService.renderToPdf (يتطلب Electron؛ فحص ثابت للتصدير)
  const docSrc = fs.readFileSync(path.join(__dirname, '..', 'services', 'documentService.js'), 'utf8');
  const docExports = (docSrc.match(/module\.exports\s*=\s*\{[\s\S]*?\};/) || [''])[0];
  assert(docExports.includes('renderToPdf'), 'documentService يصدّر renderToPdf (مطلوب من pvPdfService)');
  const pdfSrc = fs.readFileSync(path.join(__dirname, '..', 'services', 'pvPdfService.js'), 'utf8');
  assert(pdfSrc.includes('documentService.renderToPdf('), 'pvPdfService يستدعي documentService.renderToPdf');

  console.log('\n=== 15. وحدة الأداءات والحسابات (Financial Module v4) ===');

  // --- طرق الدفع ---
  const methods = paySvc.listPaymentMethods();
  assert(methods.length >= 3, 'طرق دفع افتراضية مبذورة (3)');
  assert(methods.some((m) => m.code === 'OFFICE_PAY'), 'طريقة: مكتب التأشير');
  assert(methods.some((m) => m.code === 'DIRECT_PAY'), 'طريقة: مباشر للمفوض');
  assert(methods.some((m) => m.code === 'ELECTRONIC'), 'طريقة: إلكتروني');

  const newMethod = paySvc.addPaymentMethod({ code: 'CHEQUE', nameAr: 'شيك', nameFr: 'Chèque' });
  assert(newMethod.id > 0, 'إضافة طريقة دفع جديدة');
  const updatedMethod = paySvc.updatePaymentMethod(newMethod.id, { active: false });
  assert(updatedMethod.active === 0, 'تعطيل طريقة الدفع');
  paySvc.updatePaymentMethod(newMethod.id, { active: true });

  // --- تعريفات (Tariffs) ---
  const t1 = feeSvc.addTariff({ code: 'FEE_NOTIF', nameAr: 'رسوم التبليغ', nameFr: 'Frais de notification', defaultAmount: 150 });
  assert(t1.id > 0 && t1.default_amount === 150, 'إضافة تعريفة');
  const t2 = feeSvc.addTariff({ code: 'FEE_EXEC', nameAr: 'رسوم التنفيذ', nameFr: "Frais d'exécution", defaultAmount: 500, status: 'ACTIVE' });
  assert(t2.id > 0, 'تعريفة ثانية');
  throws(() => feeSvc.addTariff({ code: 'FEE_NOTIF', nameAr: 'مكرر', nameFr: 'Dup' }), 'رفض كود تعريفة مكرر');
  throws(() => feeSvc.addTariff({}), 'رفض تعريفة بدون حقول مطلوبة');

  const t1Upd = feeSvc.updateTariff(t1.id, { defaultAmount: 200, nameAr: 'رسوم التبليغ المحدّثة' });
  assert(t1Upd.default_amount === 200 && t1Upd.name_ar === 'رسوم التبليغ المحدّثة', 'تحديث التعريفة');
  throws(() => feeSvc.updateTariff(99999, { nameAr: 'x' }), 'تحديث تعريفة غير موجودة');

  const tStats = feeSvc.tariffStats();
  assert(tStats.total >= 2 && tStats.active >= 2, 'إحصائيات التعريفات');

  authSvc.login('agent', 'agent123');
  throws(() => feeSvc.addTariff({ code: 'X', nameAr: 'x', nameFr: 'x' }), 'agent ممنوع من إضافة التعريفات');
  authSvc.login('admin', 'admin123');

  // --- قواعد التعريفة ---
  const r1 = feeSvc.addRule({ tariffId: t1.id, procedureTypeId: notifType.id });
  assert(r1.id > 0, 'إضافة قاعدة: تعريفة + نوع إجراء');
  const r2 = feeSvc.addRule({ tariffId: t2.id, procedureTypeId: null, overrideAmount: 600 });
  assert(r2.id > 0, 'قاعدة عامة (نوع فارغ) مع مبلغ بديل');
  const rules = feeSvc.listRules();
  assert(rules.length >= 2, 'قواعد التعريفة مرتبطة');

  // اقتراح الرسوم لإجراءات التبليغ
  const suggested = feeSvc.suggestFees(notifType.id);
  assert(suggested.length >= 1, 'اقتراح رسوم لإجراءات التبليغ');
  assert(suggested.some((s) => s.amount === 200 && s.code === 'FEE_NOTIF'), 'المبلغ المعدل يظهر في الاقتراح');

  // الاقتراح يشمل القاعدة العامة (نوع فارغ)
  const allSuggested = feeSvc.suggestFees(constatType.id);
  assert(allSuggested.some((s) => s.code === 'FEE_EXEC' && s.amount === 600), 'القاعدة العامة تظهر لكل الأنواع');

  feeSvc.deleteRule(r2.id);
  assert(!feeSvc.listRules().some((r) => r.id === r2.id), 'حذف القاعدة');

  // --- تقييم الأتعاب ---
  const finDos = dosageSvc.save({ numero: 'DOS-FIN-001', demandeur: 'مالي 1', defendeur: 'مالي 2', court: 'محكمة مالية', type: 'مالي', status: 'open', date: '2026-08-15' });
  const finProc = procSvc.createProcedure({
    dossier_id: finDos.id, procedure_type_id: notifType.id, status: 'NEW',
    amount: 0, field_values: {}
  });

  const assess = feeSvc.createAssessment(finProc.id, {
    currency: 'MAD', notes: 'تقييم أولي',
    items: [
      { tariffId: t1.id, amount: 200, quantity: 1 },
      { descriptionAr: 'خدمة إضافية', descriptionFr: 'Service additionnel', amount: 50, quantity: 2 }
    ]
  });
  assert(assess.id > 0 && assess.status === 'DRAFT', 'إنشاء تقييم DRAFT');
  assert(assess.total_amount === 300, 'المجموع = 200 + (50*2) = 300');

  const assessDetail = feeSvc.getAssessment(assess.id);
  assert(assessDetail.items.length === 2, 'بنود التقييم محفوظة');
  assert(assessDetail.items[0].tariff_id === t1.id, 'البند الأول مرتبط بالتعريفة');

  // إضافة بند + حذف بند
  feeSvc.addAssessmentItem(assess.id, { amount: 100 });
  const afterAdd = feeSvc.getAssessment(assess.id);
  assert(afterAdd.total_amount === 400, 'مجموع بعد إضافة بند 100 = 400');
  const lastItem = afterAdd.items[afterAdd.items.length - 1];
  feeSvc.removeAssessmentItem(lastItem.id);
  const afterRemove = feeSvc.getAssessment(assess.id);
  assert(afterRemove.total_amount === 300, 'مجموع بعد حذف البند = 300');

  throws(() => feeSvc.addAssessmentItem(assess.id, { amount: -10 }), 'رفض بند بمبلغ سالب');
  throws(() => feeSvc.createAssessment(99999, {}), 'تقييم على إجراء غير موجود');

  // تأكيد التقييم
  const confirmedA = feeSvc.confirmAssessment(assess.id);
  assert(confirmedA.status === 'CONFIRMED', 'التقييم CONFIRMED');
  throws(() => feeSvc.addAssessmentItem(assess.id, { amount: 100 }), 'لا إضافة بعد التأكيد');

  // قوائم التقييمات
  const aList = feeSvc.listAssessments({ procedureId: finProc.id });
  assert(aList.total === 1 && aList.rows[0].id === assess.id, 'قائمة التقييمات مفهرسة');
  const aStats = feeSvc.assessmentStats();
  assert(aStats.total >= 1 && aStats.byStatus.CONFIRMED >= 1, 'إحصائيات التقييمات');

  // --- سير عمل الأداءات ---
  const pay1 = paySvc.addPayment(finProc.id, {
    amount: 100, method: 'نقداً', payment_date: '2026-08-15',
    reference: 'PAY-001', assessmentId: assess.id, paymentMethodId: methods[0].id
  });
  assert(pay1.id > 0 && pay1.status === 'PENDING', 'أداء PENDING');

  const pay1Detail = paySvc.getPaymentDetail(pay1.id);
  assert(pay1Detail.transactions.length === 1 && pay1Detail.transactions[0].type === 'initial', 'معاملة أولى مسجلة');
  assert(pay1Detail.method_info && pay1Detail.method_info.code === 'OFFICE_PAY', 'معلومات طريقة الدفع');

  // تأكيد الدفع
  const confirmedPay = paySvc.confirmPayment(pay1.id);
  assert(confirmedPay.status === 'CONFIRMED', 'الدفع CONFIRMED');
  assert(!!confirmedPay.confirmed_at, 'تاريخ التأكيد مسجل');
  assert(confirmedPay.transactions.length === 2, 'معاملتان: initial + confirmation');

  throws(() => paySvc.confirmPayment(pay1.id), 'تأكيد دفع غير PENDING');

  // التقييم يصبح PARTIALLY_PAID (100 من 300)
  const aAfterPay = feeSvc.getAssessment(assess.id);
  assert(aAfterPay.status === 'PARTIALLY_PAID', 'التقييم PARTIALLY_PAID بعد دفع جزئي');

  // دفع ثانٍ
  const finPay2 = paySvc.addPayment(finProc.id, {
    amount: 200, method: 'تحويل', payment_date: '2026-08-16',
    reference: 'PAY-002', assessmentId: assess.id
  });
  paySvc.confirmPayment(finPay2.id);
  const aAfterFull = feeSvc.getAssessment(assess.id);
  assert(aAfterFull.status === 'PAID', 'التقييم PAID بعد الدفع الكامل');

  // دفع بدون تقييم
  const pay3 = paySvc.addPayment(finProc.id, { amount: 50, method: 'نقداً' });
  assert(pay3.id > 0, 'أداء بدون تقييم');

  // قوائم الأداءات
  const pList = paySvc.listPayments({ procedureId: finProc.id });
  assert(pList.total === 3, '3 أداءات للإجراء المالي');
  assert(pList.rows.every((r) => r.procedure_number === finProc.procedure_number), 'رقم الإجراء مرفق');
  const pStats = paySvc.paymentStats();
  assert(pStats.total >= 3 && pStats.totalPaid > 0, 'إحصائيات الأداءات');

  // --- إلغاء أداء ---
  const pay4 = paySvc.addPayment(finProc.id, { amount: 75, method: 'نقداً' });
  const cancelledPay = paySvc.cancelPayment(pay4.id, 'سبب الإلغاء');
  assert(cancelledPay.status === 'CANCELLED', 'الإلغاء');
  assert(cancelledPay.transactions.length === 2, 'معاملة إلغاء مسجلة');
  throws(() => paySvc.confirmPayment(pay4.id), 'لا تأكيد بعد الإلغاء');

  // --- استرداد (Refund) ---
  const refund1 = paySvc.refundPayment(pay1.id, { amount: 30, reason: 'خطأ في المبلغ' });
  assert(refund1.status === 'CONFIRMED', 'الدفع يبقى CONFIRMED بعد استرداد جزئي');
  const refs = paySvc.listRefunds(pay1.id);
  assert(refs.length === 1 && refs[0].amount === 30, 'سجل الاسترداد');

  throws(() => paySvc.refundPayment(pay1.id, { amount: 999 }), 'رفض استرداد يتجاوز الدفع');
  throws(() => paySvc.refundPayment(pay4.id, { amount: 10 }), 'لا استرداد على دفع ملغي');

  // استرداد كامل
  const pay5 = paySvc.addPayment(finProc.id, { amount: 10, method: 'نقداً' });
  paySvc.confirmPayment(pay5.id);
  const refundFull = paySvc.refundPayment(pay5.id, { amount: 10 });
  assert(refundFull.status === 'REFUNDED', 'الدفع REFUNDED بعد الاسترداد الكامل');

  // --- الوصولات: إلغاء وصل ---
  const payForReceipt = paySvc.addPayment(finProc.id, { amount: 25, method: 'نقداً' });
  paySvc.confirmPayment(payForReceipt.id);
  const recNum = paySvc.generateReceiptNumber();
  const { run: dbRun } = require('../db/database').helpers;
  const recRes = dbRun(
    `INSERT INTO receipts (payment_id, receipt_number, generated_at, file_path, document_id, status)
     VALUES (?, ?, datetime('now'), '', 0, 'ACTIVE')`,
    [payForReceipt.id, recNum]
  );
  const cancelledReceipt = paySvc.cancelReceipt(recRes.lastId, 'خطأ في الوصل');
  assert(cancelledReceipt.status === 'CANCELLED', 'إلغاء وصل');
  assert(cancelledReceipt.cancellation_reason === 'خطأ في الوصل', 'سبب الإلغاء محفوظ');
  throws(() => paySvc.cancelReceipt(recRes.lastId), 'لا إلغاء وصل ملغي مرتين');

  // --- الدفتر الحسابي ---
  const acctList = acctSvc.listRecords({ procedureId: finProc.id });
  assert(acctList.total >= 2, 'سجلات في الدفتر = أو أكثر من التأكيدات');
  assert(acctList.rows.some((r) => r.type === 'income'), 'سجل إيراد');
  assert(acctList.rows.some((r) => r.type === 'refund'), 'سجل استرداد');

  const summary = acctSvc.financialSummary();
  assert(typeof summary.income === 'number' && typeof summary.net === 'number', 'ملخص مالي');

  const pReport = acctSvc.procedureReport(finProc.id);
  assert(pReport.payments.length >= 3 && pReport.totalPaid > 0, 'تقرير الإجراء المالي');

  const dashboard = acctSvc.dashboard();
  assert(typeof dashboard.totalPayments === 'number' && typeof dashboard.todayTotal === 'number', 'لوحة تحكم مالية');

  // --- سجل التدقيق المالي ---
  const finAudit = paySvc.listFinancialAudit({ procedureId: finProc.id });
  assert(finAudit.total >= 3, 'سجل تدقيق مالي');

  // --- صلاحيات مالية ---
  authSvc.login('agent', 'agent123');
  throws(() => paySvc.confirmPayment(pay1.id), 'agent ممنوع من تأكيد الأداء');
  throws(() => feeSvc.confirmAssessment(assess.id), 'agent ممنوع من تأكيد التقييم');
  authSvc.login('admin', 'admin123');

  // حذف إجراء يحذف تقييماته (CASCADE)
  const cascadeProc = procSvc.createProcedure({
    dossier_id: finDos.id, procedure_type_id: notifType.id, status: 'NEW', field_values: {}
  });
  const cascadeAssess = feeSvc.createAssessment(cascadeProc.id, { items: [{ amount: 100 }] });
  procSvc.deleteProcedure(cascadeProc.id);
  throws(() => feeSvc.getAssessment(cascadeAssess.id), 'حذف الإجراء يحذف تقييماته (CASCADE)');

  console.log('\n=== 16. السجلات المهنية (Professional Registers) ===');
  const regSvc = require('../services/registersService');
  const { run: regRun } = require('../db/database').helpers;

  const regs = regSvc.listRegisters();
  assert(regs.length === 2, 'سجلان مبذوران (يومي + حسابي)');
  const regDaily = regs.find((r) => r.kind === 'daily');
  const regAcc = regs.find((r) => r.kind === 'accounting');
  assert(regDaily && regAcc && regDaily.active === 1 && regAcc.active === 1, 'السجلان نشطان');
  const cfgNow = regSvc.config();
  assert(cfgNow.settings.autoDaily === true && cfgNow.settings.autoAccounting === true, 'التسجيل التلقائي مفعل افتراضياً');

  // --- قيد تلقائي + ترقيم ---
  const regProc1 = procSvc.createProcedure({ dossier_id: finDos.id, procedure_type_id: notifType.id, status: 'NEW', field_values: { act_to_notify: 'تبليغ اختبار السجلات' } });
  const regProc2 = procSvc.createProcedure({ dossier_id: finDos.id, procedure_type_id: notifType.id, status: 'NEW', field_values: {} });
  const regDailyList = regSvc.listEntries({ registerId: regDaily.id });
  const e1 = regDailyList.rows.find((r) => r.procedure_id === regProc1.id);
  const e2 = regDailyList.rows.find((r) => r.procedure_id === regProc2.id);
  assert(e1 && /^\d{4}-\d{6}$/.test(e1.serial_no), 'قيد يومي تلقائي برقم تسلسلي {year}-{seq:000000}');
  assert(String(e1.serial_no) < String(e2.serial_no), 'الترقيم متصاعد دون تعارض');
  assert(e1.parties_summary && e1.dossier_number === finDos.numero, 'ملخص الأطراف ورقم الملف في القيد');
  throws(() => regSvc.createDailyEntry({ procedureId: regProc1.id }), 'لا تكرار قيد لنفس الإجراء (قيد نشط)');

  // --- ربط المحضر المُنهى بالقيد (آخر محضر مُنهى على الإجراء) ---
  const pvLinked = regSvc.listEntries({ registerId: regDaily.id }).rows.find((r) => r.procedure_id === pvProc.id);
  assert(pvLinked && pvLinked.pv_id === pv2.id && pvLinked.pv_number === pv2.pv_number, 'المحضر المُنهى مربوط بالقيد اليومي (الأحدث على الإجراء)');

  // --- تفاصيل قيد (غنية + تدقيق + تصحيحات) ---
  const g1 = regSvc.getEntry(e1.entry_id);
  assert(g1.register.code === 'DAILY_PROCEDURE' && g1.audit.length >= 1 && g1.audit[0].action === 'CREATE', 'تفاصيل القيد: سجل + تدقيق الإنشاء');
  assert(Array.isArray(g1.corrections) && g1.period && g1.period.status === 'OPEN', 'تفاصيل القيد: تصحيحات + فترة');

  // --- الفترات وإقفالها ---
  const nowD = new Date();
  const pk = nowD.getFullYear() + '-' + String(nowD.getMonth() + 1).padStart(2, '0');
  regSvc.setPeriodStatus(regDaily.id, pk, 'REVIEW', 'مراجعة شهرية');
  const periodsAfter = regSvc.listPeriods(regDaily.id);
  assert(periodsAfter.some((p) => p.period_key === pk && p.status === 'REVIEW'), 'فترة → REVIEW');
  regSvc.setPeriodStatus(regDaily.id, pk, 'LOCKED', 'إقفال الشهر');
  assert(regSvc.listPeriods(regDaily.id).find((p) => p.period_key === pk).status === 'LOCKED', 'فترة → LOCKED');
  const lockedDos = dosageSvc.save({ numero: 'DOS-LOCK-1', demandeur: 'زن', defendeur: 'من', court: 'ابتدائية', type: 'مدني', status: 'open', date: '2026-08-01' });
  const lockedProc = procSvc.createProcedure({ dossier_id: lockedDos.id, procedure_type_id: notifType.id, status: 'NEW', field_values: {} });
  const lockedEntry = regSvc.listEntries({ registerId: regDaily.id }).rows.find((r) => r.procedure_id === lockedProc.id);
  assert(!lockedEntry, 'التسجيل التلقائي يُتجاوز في فترة مقفلة (لا يكسر إنشاء الإجراء)');
  throws(() => regSvc.createDailyEntry({ procedureId: lockedProc.id }), 'رفض إدخال قيد يدوي في فترة مقفلة');
  regSvc.setPeriodStatus(regDaily.id, pk, 'REVIEW', 'مراجعة');
  regSvc.setPeriodStatus(regDaily.id, pk, 'OPEN', 'فتح');
  assert(regSvc.listPeriods(regDaily.id).find((p) => p.period_key === pk).status === 'OPEN', 'إعادة فتح الفترة (LOCKED → REVIEW → OPEN)');
  const afterOpen = regSvc.createDailyEntry({ procedureId: lockedProc.id });
  assert(!!afterOpen.serial, 'القيد مسموح بعد فتح الفترة');

  // --- الإلغاء (لا حذف) ---
  const regProc3 = procSvc.createProcedure({ dossier_id: finDos.id, procedure_type_id: notifType.id, status: 'NEW', field_values: {} });
  const e3 = regSvc.listEntries({ registerId: regDaily.id }).rows.find((r) => r.procedure_id === regProc3.id);
  throws(() => regSvc.cancelEntry(e3.entry_id, ''), 'الإلغاء يتطلب سبباً');
  const can = regSvc.cancelEntry(e3.entry_id, 'سجل بالخطأ');
  assert(can.status === 'CANCELLED' && can.reason === 'سجل بالخطأ' && can.audit.some((a) => a.action === 'CANCEL'), 'إلغاء موثق مع السبب');

  // --- تصحيحات: طلب → موافقة → بديل؛ ورفض ---
  const regProc4 = procSvc.createProcedure({ dossier_id: finDos.id, procedure_type_id: notifType.id, status: 'NEW', field_values: { act_to_notify: 'تصحيح قادم' } });
  const e4 = regSvc.listEntries({ registerId: regDaily.id }).rows.find((r) => r.procedure_id === regProc4.id);
  throws(() => regSvc.requestCorrection(e4.entry_id, '  '), 'طلب التصحيح يتطلب سبباً');
  const req = regSvc.requestCorrection(e4.entry_id, 'اسم الطرف خاطئ');
  assert(req.status === 'REQUESTED' && req.snapshot.serial_no === e4.serial_no, 'طلب تصحيح مع لقطة من القيد');
  const app = regSvc.approveCorrection(req.id, 'مقبول');
  const execCorr = regSvc.listCorrections({ status: 'EXECUTED' }).rows.find((c) => c.id === req.id);
  assert(app.replacement && execCorr && execCorr.replacement_entry_id > 0, 'الموافقة تولد قيداً بديلاً');
  const origAfter = regSvc.getEntry(e4.entry_id);
  const repl = regSvc.getEntry(execCorr.replacement_entry_id);
  assert(origAfter.status === 'SUPERSEDED' && repl.status === 'ACTIVE' && repl.corrections.some((c) => c.id === req.id), 'الأصل مستبدل والبديل نشط ومرتبط');

  const regProc5 = procSvc.createProcedure({ dossier_id: finDos.id, procedure_type_id: notifType.id, status: 'NEW', field_values: {} });
  const e5 = regSvc.listEntries({ registerId: regDaily.id }).rows.find((r) => r.procedure_id === regProc5.id);
  const req5 = regSvc.requestCorrection(e5.entry_id, 'تحقق فقط');
  const rej = regSvc.rejectCorrection(req5.id, 'لا حاجة');
  assert(rej.status === 'REJECTED' && regSvc.getEntry(e5.entry_id).status === 'ACTIVE', 'رفض التصحيح يبقي الأصل نشطاً');

  // --- السجل الحسابي (تلقائية + استرداد + وصـل) ---
  const accPay = paySvc.addPayment(finProc.id, { amount: 80, method: 'نقداً' });
  paySvc.confirmPayment(accPay.id);
  const accList = regSvc.listEntries({ registerId: regAcc.id });
  const accEntry = accList.rows.find((r) => r.payment_id === accPay.id);
  assert(accEntry && accEntry.flow_type === 'income' && Number(accEntry.amount) === 80, 'قيد حسابي تلقائي (إيراد) بعد تأكيد الأداء');
  throws(() => regSvc.createAccountingEntry({ paymentId: accPay.id, flowType: 'income', amount: 80 }), 'لا إيرادين لنفس الأداء');

  paySvc.refundPayment(accPay.id, { amount: 10, reason: 'تصحيح' });
  const refundEntry = regSvc.listEntries({ registerId: regAcc.id }).rows.find((r) => r.payment_id === accPay.id && r.flow_type === 'refund');
  assert(refundEntry && Number(refundEntry.amount) === 10 && refundEntry.status === 'ACTIVE', 'قيد حسابي تلقائي (استرداد)');

  regSvc.linkReceiptToAccounting(accPay.id, 424242, 'REC-TEST-01');
  const accAfterReceipt = regSvc.getEntry(accEntry.entry_id);
  assert(accAfterReceipt.detail.receipt_number === 'REC-TEST-01' && accAfterReceipt.detail.receipt_id === 424242, 'ربط الوصل بالقيد الحسابي');

  // --- فلاتر وبحث ---
  const filteredByStatus = regSvc.listEntries({ registerId: regAcc.id, status: 'ACTIVE' });
  assert(filteredByStatus.rows.every((r) => r.status === 'ACTIVE'), 'فلترة حسب الحالة');
  const filteredQ = regSvc.listEntries({ registerId: regDaily.id, q: e1.serial_no.slice(-4) });
  assert(filteredQ.rows.some((r) => r.entry_id === e1.entry_id), 'بحث جزئي بالرقم التسلسلي');
  const filteredDos = regSvc.listEntries({ registerId: regDaily.id, q: finDos.numero });
  assert(filteredDos.rows.some((r) => r.entry_id === e1.entry_id), 'بحث برقم الملف');
  const gs = regSvc.globalSearch(e1.serial_no.slice(-3));
  assert(gs.daily.some((r) => r.entry_id === e1.entry_id), 'بحـث شامل (الرأسية)');

  // --- تدقيق ومناعة قاعدة البيانات ---
  const regAuditRows = regSvc.listAudit({ registerId: regDaily.id });
  assert(regAuditRows.rows.some((a) => a.action === 'CREATE') && regAuditRows.rows.some((a) => a.action === 'CORRECT'), 'سجل تدقيق السجل (إنشاء/تصحيح)');
  const auditForEntry = regSvc.listAudit({ entryId: e1.entry_id });
  assert(auditForEntry.rows.length >= 1 && auditForEntry.rows[0].entry_id === e1.entry_id, 'تدقيق حسب القيد');
  throws(() => regRun('DELETE FROM register_entries WHERE id = ?', [e1.entry_id]), 'مستحيل حذف قيد (TRIGGER)');
  throws(() => regRun('UPDATE register_entries SET serial_no = ? WHERE id = ?', ['X-000001', e1.entry_id]), 'الرقم التسلسلي لا يتغير (TRIGGER)');
  throws(() => regRun("UPDATE register_entries SET status = 'CANCELLED' WHERE id = ?", [e1.entry_id]), 'تغيير الحالة يتطلب سبباً (TRIGGER)');

  // --- إعدادات (تحقق Admin) ---
  throws(() => regSvc.updateConfig({ registerId: regDaily.id, numberingPattern: 'بدون متغيرات' }), 'رفض نمط ترقيم بدون متغيرات');
  throws(() => regSvc.updateConfig({ registerId: regDaily.id, numberingPattern: '{year}-{seq}', seqFrequency: 'weekly' }), 'رفض دورة ترقيم غير معروفة');
  throws(() => regSvc.updateConfig({ registerId: regDaily.id, schemaJson: '{ليس json' }), 'رفض schema غير صالح');
  const okCfg = regSvc.updateConfig({ registerId: regDaily.id, numberingPattern: '{year}-{month}-{seq:000000}', seqFrequency: 'month', autoDaily: true });
  const updReg = okCfg.registers.find((r) => r.id === regDaily.id);
  assert(updReg.numbering_pattern === '{year}-{month}-{seq:000000}' && updReg.seq_frequency === 'month', 'تحديث نمط الترقيم والدورة (Admin)');
  const patAud = regSvc.listAudit({ registerId: regDaily.id, action: 'CONFIGURE' });
  assert(patAud.rows.length >= 1, 'تعديل الإعدادات يظهر في التدقيق');

  // --- لوحة السجل ---
  const regDash = regSvc.dashboard();
  assert(regDash.todayProcedures >= 5 && regDash.todayEntries >= 8 && regDash.todayPvCount >= 1, 'لوحة السجل: أرقام اليوم');
  assert(typeof regDash.todayIncome === 'number' && typeof regDash.todayRefunds === 'number', 'لوحة السجل: المنجز والمسترد');

  // --- صلاحيات ---
  authSvc.login('agent', 'agent123');
  throws(() => regSvc.cancelEntry(e5.entry_id, 'سبب'), 'agent ممنوع من إلغاء القيد');
  throws(() => regSvc.approveCorrection(req5.id, 'x'), 'agent ممنوع من قبول التصحيح');
  throws(() => regSvc.auditExport(regDaily.id, 'csv'), 'agent ممنوع من التصدير');
  throws(() => regSvc.updateConfig({ registerId: regDaily.id, numberingPattern: '{year}-{seq}' }), 'agent ممنوع من ضبط السجل');
  throws(() => regSvc.setPeriodStatus(regDaily.id, pk, 'REVIEW', 'x'), 'agent ممنوع من تغيير حالة الفترة');
  authSvc.login('admin', 'admin123');

  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });

  console.log('\n=== 17. إدارة المستخدمين ===');
  const freshDir2 = path.join(os.tmpdir(), 'huissier-users-' + Date.now());
  fs.mkdirSync(freshDir2, { recursive: true });
  process.chdir(__dirname);
  const { initDatabase: initDb2 } = require('../db/database');
  await initDb2(freshDir2);
  const auth2 = require('../services/auth');
  assert(auth2.needsSetup() === true, 'قاعدة جديدة: تسجيل أول مطلوب');
  auth2.setupInitial('admin', 'مدير المكتب', 'admin123');
  const u1 = auth2.createUser('khalid', 'خالد العمري', 'agent', 'agent123');
  assert(u1 && u1.role === 'agent' && u1.password_hash === undefined, 'إضافة مستخدم (وكيل) بدون كشف التجزئة');
  throws(() => auth2.createUser('khalid', 'مكرر', 'agent', 'agent123'), 'رفض اسم مستخدم مكرر');
  throws(() => auth2.createUser('x', 'y', 'boss', '123456'), 'رفض دور غير صالح');
  throws(() => auth2.createUser('x', 'y', 'agent', '123'), 'رفض كلمة مرور قصيرة');
  const u2 = auth2.createUser('chaima', 'شيماء', 'admin', 'chaima123');
  assert(u2.role === 'admin', 'إضافة مدير ثانٍ');
  auth2.logout();
  auth2.login('khalid', 'agent123');
  throws(() => auth2.createUser('a', 'b', 'agent', '123456'), 'agent ممنوع من إضافة مستخدمين');
  auth2.login('admin', 'admin123');
  auth2.setUserActive(u1.id, false);
  assert(auth2.getCurrentUser().username === 'admin', 'تبديل الحساب يدخل بالجلسة الجديدة مباشرة');
  auth2.logout();
  throws(() => auth2.login('khalid', 'agent123'), 'المستخدم المعطّل لا يدخل');
  auth2.login('admin', 'admin123');
  auth2.setUserActive(u1.id, true);
  auth2.resetPassword(u1.id, 'newpass123');
  auth2.logout();
  auth2.login('khalid', 'newpass123');
  assert(auth2.isAuthorized('procedure.delete') === false, 'الوكيل غير مخول للحذف');
  assert(auth2.isAuthorized('archive.seal') === false, 'الوكيل غير مخول للختم');
  auth2.login('admin', 'admin123');
  throws(() => auth2.deleteUser(auth2.getCurrentUser().id), 'لا حذف لحسابك');
  auth2.setUserActive(u2.id, false);
  assert(auth2.getCurrentUser().role === 'admin', 'تعطيل مدير ثانٍ مسموح');
  throws(() => auth2.setUserActive(u2.id, false), 'لا تعطيل آخر مدير نشط');
  auth2.setUserActive(u2.id, true);
  auth2.deleteUser(u1.id);
  assert(auth2.listUsers().every((u) => u.username !== 'khalid'), 'حذف مستخدم');
  auth2.logout();
  throws(() => auth2.requireAuth('users.manage'), 'ممنوع إدارة المستخدمين بلا جلسة');
  const auditLogs = require('../db/database').helpers.all(
    "SELECT action FROM audit_logs WHERE action LIKE 'auth.%' ORDER BY id DESC LIMIT 30"
  );
  assert(auditLogs.some((a) => a.action === 'auth.user_created'), 'تدقيق: إنشاء مستخدم');
  assert(auditLogs.some((a) => a.action === 'auth.user_deactivated'), 'تدقيق: تعطيل مستخدم');
  assert(auditLogs.some((a) => a.action === 'auth.password_reset'), 'تدقيق: إعادة ضبط كلمة المرور');
  assert(auditLogs.some((a) => a.action === 'auth.login_failed'), 'تدقيق: محاولة دخول فاشلة');
  fs.rmSync(freshDir2, { recursive: true, force: true });

  console.log('\n====================');
  console.log(`النتيجة: ${passed} نجح، ${failed} فشل`);
  console.log('====================');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error('خطأ قاتل في الاختبار:', e);
  process.exit(1);
});
