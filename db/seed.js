'use strict';

/* ================================================================
   بيانات تجريبية (Seed) — تُدخل فقط عند أول تهيئة فارغة.
   لا تمثل أي المقتضيات القانونية. Business Requirements من مهني.
   ================================================================ */

function seedIfEmpty({ get, run, tx }) {
  const count = get('SELECT COUNT(*) AS c FROM procedure_categories').c;
  if (count > 0) return;

  return tx(() => {
    // ---------- الفئات ----------
    const catJudicial = run(
      "INSERT INTO procedure_categories (code, name_ar, name_fr, active, sort_order) VALUES ('JUDICIAL','الإجراءات القضائية','Procédures judiciaires',1,1)"
    ).lastId;
    const catDirect = run(
      "INSERT INTO procedure_categories (code, name_ar, name_fr, active, sort_order) VALUES ('DIRECT','الإجراءات المباشرة','Procédures directes',1,2)"
    ).lastId;

    // ---------- الحالات ----------
    const statuses = [
      ['NEW', 'جديد', 'Nouveau', 'blue', 1],
      ['IN_PROGRESS', 'قيد الإنجاز', 'En cours', 'amber', 2],
      ['COMPLETED', 'مكتمل', 'Terminé', 'green', 3],
      ['POSTPONED', 'مؤجل', 'Reporté', 'gray', 4],
      ['CANCELLED', 'ملغى', 'Annulé', 'red', 5]
    ];
    statuses.forEach(([code, ar, fr, color, order]) => {
      run(
        `INSERT INTO procedure_statuses (code, name_ar, name_fr, color, active, sort_order)
         VALUES (?,?,?,?,1,?)`,
        [code, ar, fr, color, order]
      );
    });

    // ---------- الانتقالات المسموح بها ----------
    const transitions = [
      ['NEW', 'IN_PROGRESS'], ['NEW', 'POSTPONED'], ['NEW', 'CANCELLED'],
      ['IN_PROGRESS', 'COMPLETED'], ['IN_PROGRESS', 'POSTPONED'], ['IN_PROGRESS', 'CANCELLED'],
      ['POSTPONED', 'IN_PROGRESS'], ['POSTPONED', 'CANCELLED']
    ];
    transitions.forEach(([f, t]) => {
      run('INSERT INTO procedure_status_transitions (from_status, to_status) VALUES (?,?)', [f, t]);
    });

    // ---------- أنواع الإجراءات ----------
    const types = [
      { cat: catJudicial, code: 'NOTIFICATION', ar: 'التبليغ', fr: 'Notification', descAr: 'تبليغ وثيقة قضائية أو غير قضائية', descFr: "Signification d'un acte judiciaire ou extrajudiciaire", order: 1 },
      { cat: catJudicial, code: 'EXECUTION_JUGEMENTS', ar: 'تنفيذ الأحكام', fr: 'Exécution des jugements', descAr: 'تنفيذ حكم صادر عن محكمة', descFr: "Exécution d'un jugement rendu par un tribunal", order: 2 },
      { cat: catJudicial, code: 'EXECUTION_ORDONNANCES', ar: 'تنفيذ الأوامر', fr: 'Exécution des ordonnances', descAr: 'تنفيذ أمر قضائي', descFr: "Exécution d'une ordonnance", order: 3 },
      { cat: catJudicial, code: 'FAIRE', ar: 'القيام بعمل', fr: 'Faire', descAr: 'القيام بعمل يقرره القانون أو المحكمة', descFr: 'Faire / acte à exécuter', order: 4 },
      { cat: catJudicial, code: 'NOTIFICATION_EXECUTION', ar: 'تبليغ وتنفيذ', fr: 'Notification et exécution', descAr: 'تبليغ ثم تنفيذ', descFr: 'Signification puis exécution', order: 5 },
      { cat: catDirect, code: 'NOTIFICATIONS', ar: 'التبليغات', fr: 'Notifications', descAr: 'تبليغات مباشرة', descFr: 'Notifications directes', order: 6 },
      { cat: catDirect, code: 'CONSTATATIONS', ar: 'المعاينات', fr: 'Constatations', descAr: 'معاينة وتحرير محضر', descFr: 'Constat et procès-verbal', order: 7 },
      { cat: catDirect, code: 'OFFRE_REELLE', ar: 'عرض عيني', fr: 'Offre réelle', descAr: 'عرض عيني للالتزام', descFr: 'Offre réelle de paiement', order: 8 }
    ];

    const typeIds = {};
    types.forEach((t) => {
      typeIds[t.code] = run(
        `INSERT INTO procedure_types (category_id, code, name_ar, name_fr, description_ar, description_fr, active, sort_order)
         VALUES (?,?,?,?,?,?,1,?)`,
        [t.cat, t.code, t.ar, t.fr, t.descAr, t.descFr, t.order]
      ).lastId;
    });

    // ---------- الحقول الديناميكية لكل نوع (بيانات فقط، لا مقتضيات قانونية) ----------
    const fields = [
      // التبليغ (قضائي)
      ['NOTIFICATION', 'act_to_notify', 'الوثيقة موضوع التبليغ', "L'acte à notifier", 'text', 1, 1, ''],
      ['NOTIFICATION', 'notif_date', 'تاريخ التبليغ', "Date de signification", 'date', 1, 2, ''],
      ['NOTIFICATION', 'notif_place', 'مكان التبليغ', "Lieu de signification", 'text', 0, 3, ''],
      // تنفيذ الأحكام
      ['EXECUTION_JUGEMENTS', 'title_ref', 'مرجع الحكم', 'Référence du jugement', 'text', 1, 1, ''],
      ['EXECUTION_JUGEMENTS', 'exec_amount', 'المبلغ محل التنفيذ', 'Montant à exécuter', 'number', 0, 2, ''],
      ['EXECUTION_JUGEMENTS', 'exec_notes', 'ملاحظات التنفيذ', "Notes d'exécution", 'textarea', 0, 3, ''],
      // تنفيذ الأوامر
      ['EXECUTION_ORDONNANCES', 'title_ref', 'مرجع الأمر', "Référence de l'ordonnance", 'text', 1, 1, ''],
      ['EXECUTION_ORDONNANCES', 'exec_amount', 'المبلغ محل التنفيذ', 'Montant à exécuter', 'number', 0, 2, ''],
      // القيام بعمل
      ['FAIRE', 'action_desc', 'وصف العمل المطلوب', "Description de l'acte demandé", 'textarea', 1, 1, ''],
      // تبليغ وتنفيذ
      ['NOTIFICATION_EXECUTION', 'act_to_notify', 'الوثيقة موضوع التبليغ', "L'acte à notifier", 'text', 1, 1, ''],
      ['NOTIFICATION_EXECUTION', 'title_ref', 'مرجع الحكم/القرار', 'Référence du jugement/décision', 'text', 0, 2, ''],
      ['NOTIFICATION_EXECUTION', 'notif_date', 'تاريخ التبليغ', 'Date de signification', 'date', 0, 3, ''],
      // التبليغات (مباشر)
      ['NOTIFICATIONS', 'act_to_notify', 'الوثيقة موضوع التبليغ', "L'acte à notifier", 'text', 1, 1, ''],
      ['NOTIFICATIONS', 'notif_date', 'تاريخ التبليغ', 'Date de signification', 'date', 0, 2, ''],
      // المعاينات
      ['CONSTATATIONS', 'constat_object', 'موضوع المعاينة', "Objet du constat", 'text', 1, 1, ''],
      ['CONSTATATIONS', 'constat_date', 'تاريخ المعاينة', 'Date du constat', 'date', 0, 2, ''],
      ['CONSTATATIONS', 'constat_place', 'مكان المعاينة', "Lieu du constat", 'text', 0, 3, ''],
      // عرض عيني
      ['OFFRE_REELLE', 'offered_amount', 'المبلغ المعروض', 'Montant offert', 'number', 1, 1, ''],
      ['OFFRE_REELLE', 'offer_date', 'تاريخ العرض', "Date de l'offre", 'date', 0, 2, ''],
      ['OFFRE_REELLE', 'offer_purpose', 'سبب العرض', "Motif de l'offre", 'textarea', 0, 3, '']
    ];

    fields.forEach(([typeCode, key, ar, fr, ftype, req, order, opts]) => {
      run(
        `INSERT INTO procedure_fields (procedure_type_id, field_key, label_ar, label_fr, field_type, required, sort_order, options)
         VALUES (?,?,?,?,?,?,?,?)`,
        [typeIds[typeCode], key, ar, fr, ftype, req, order, opts]
      );
    });

    // ---------- قوالب المحاضر ----------
    const templates = [
      ['PV_GENERAL', 'محضر عام', 'Procès-verbal général', 1],
      ['PV_NOTIFICATION', 'محضر تبليغ', "Procès-verbal de signification", 2],
      ['PV_CONSTAT', 'محضر معاينة', 'Procès-verbal de constat', 3]
    ];
    templates.forEach(([code, ar, fr, order]) => {
      run(
        `INSERT INTO pv_templates (code, title_ar, title_fr, active, sort_order) VALUES (?,?,?,1,?)`,
        [code, ar, fr, order]
      );
    });

    // ---------- المستخدمون ----------
    run("INSERT INTO users (username, display_name, role, active) VALUES ('admin','المدير العام','admin',1)");
    run("INSERT INTO users (username, display_name, role, active) VALUES ('agent','وكيل المكتب','agent',1)");
  });
}

function extractVars(content) {
  const vars = [];
  const re = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;
  let m;
  while ((m = re.exec(content || '')) !== null) {
    if (!vars.includes(m[1])) vars.push(m[1]);
  }
  return vars;
}

/* ================================================================
   مكتبة النماذج — تُدخل بذرتها بشكل مستقل (تعمل حتى بعد الترقية
   من إصدار v1 إلى v2 لأنها تعتمد على جدولها الخاص).
   ================================================================ */
function seedTemplateLibrary({ get, run, tx }) {
  const count = get('SELECT COUNT(*) AS c FROM template_categories').c;
  if (count > 0) return;

  return tx(() => {
    const categories = [
      ['NOTIFICATION', 'التبليغ', 'Signification', 1],
      ['EXECUTION_JUGEMENTS', 'تنفيذ الأحكام', 'Exécution des jugements', 2],
      ['EXECUTION_ORDONNANCES', 'تنفيذ الأوامر', 'Exécution des ordonnances', 3],
      ['FAIRE', 'القيام بعمل', 'Faire', 4],
      ['NOTIFICATION_EXECUTION', 'التبليغ والتنفيذ', 'Notification et exécution', 5],
      ['NOTIFICATIONS', 'التبليغات', 'Notifications', 6],
      ['CONSTATATIONS', 'المعاينات', 'Constatations', 7],
      ['OFFRE_REELLE', 'العرض العيني', 'Offre réelle', 8],
      ['RECEIPTS', 'الوصولات', 'Reçus', 9],
      ['OTHER', 'أخرى', 'Autres', 10]
    ];
    const catIds = {};
    categories.forEach(([code, ar, fr, order]) => {
      catIds[code] = run(
        `INSERT INTO template_categories (code, name_ar, name_fr, sort_order, active) VALUES (?,?,?,?,1)`,
        [code, ar, fr, order]
      ).lastId;
    });

    // نموذج تجريبي: محضر تبليغ (عربي) يستعمل المتغيرات الديناميكية
    const arContent = `
<h2>محضر تبليغ</h2>
<p><strong>المؤرخ في:</strong> {{today_date}} — <strong>المكتب:</strong> {{office_name}}</p>
<h4>١. بيان الملف</h4>
<table>
  <tr><td>رقم الملف</td><td>{{dossier_number}}</td></tr>
  <tr><td>المدعي</td><td>{{applicant_name}}</td></tr>
  <tr><td>المدعى عليه</td><td>{{opponent_name}}</td></tr>
  <tr><td>المحكمة</td><td>{{dossier_court}}</td></tr>
</table>
<h4>٢. الوثيقة موضوع التبليغ</h4>
<p>{{field.act_to_notify}}</p>
<h4>٣. الأطراف</h4>
<p>{{party_name}} — CIN: {{party_cin}}<br>{{party_address}}</p>
<h4>٤. الإجراء</h4>
<table>
  <tr><td>رقم الإجراء</td><td>{{procedure_number}}</td></tr>
  <tr><td>نوع الإجراء</td><td>{{procedure_type}}</td></tr>
  <tr><td>ملاحظات</td><td>{{procedure_notes}}</td></tr>
</table>
<div class="sig">
  <div class="col"><div class="line"></div>الطرف المبلَّغ</div>
  <div class="col"><div class="line"></div>المفوض القضائي</div>
</div>`;

    const frContent = `
<h2>Procès-verbal de signification</h2>
<p><strong>Fait le :</strong> {{today_date}} — <strong>Cabinet :</strong> {{office_name}}</p>
<h4>1. Référence du dossier</h4>
<table>
  <tr><td>N° dossier</td><td>{{dossier_number}}</td></tr>
  <tr><td>Demandeur</td><td>{{applicant_name}}</td></tr>
  <tr><td>Défendeur</td><td>{{opponent_name}}</td></tr>
  <tr><td>Tribunal</td><td>{{dossier_court}}</td></tr>
</table>
<h4>2. Acte objet de la signification</h4>
<p>{{field.act_to_notify}}</p>
<h4>3. Parties</h4>
<p>{{party_name}} — CIN : {{party_cin}}<br>{{party_address}}</p>
<h4>4. Procédure</h4>
<table>
  <tr><td>N° procédure</td><td>{{procedure_number}}</td></tr>
  <tr><td>Type</td><td>{{procedure_type}}</td></tr>
  <tr><td>Notes</td><td>{{procedure_notes}}</td></tr>
</table>
<div class="sig">
  <div class="col"><div class="line"></div>Partie signifiée</div>
  <div class="col"><div class="line"></div>Huissier de justice</div>
</div>`;

    // اربط القوالب بنوع الإجراء الأكثر عمومية (التبليغات) إن وُجد،
    // وإلا فالنوع المفرد؛ النوع المفرد يبقى متطابقاً عبر فئة القالب (category).
    const notifType =
      get("SELECT id FROM procedure_types WHERE code = 'NOTIFICATIONS'") ||
      get("SELECT id FROM procedure_types WHERE code = 'NOTIFICATION'");

    const insertTemplate = (name, catCode, lang, content) => {
      const tpl = run(
        `INSERT INTO document_templates (name, category_id, procedure_type_id, language, description, active, archived, current_version_id, created_by)
         VALUES (?,?,?,?,?,1,0,0,'admin')`,
        [name, catIds[catCode], notifType ? notifType.id : null, lang, lang === 'ar'
          ? 'نموذج محضر تبليغ تجريبي مع متغيرات ديناميكية'
          : 'Modèle de procès-verbal de signification (démonstration avec variables dynamiques)']
      ).lastId;
      const ver = run(
        `INSERT INTO template_versions (template_id, version, content, variables, note, created_by) VALUES (?,?,?,?,?,?)`,
        [tpl, '1.0', content, JSON.stringify(extractVars(content)), 'النسخة الأولى', 'admin']
      ).lastId;
      run('UPDATE document_templates SET current_version_id = ? WHERE id = ?', [ver, tpl]);
      return tpl;
    };

    insertTemplate('محضر تبليغ', 'NOTIFICATION', 'ar', arContent);
    insertTemplate('Procès-verbal de signification', 'NOTIFICATION', 'fr', frContent);
  });
}

/* ================================================================
   تهيئة تكوين المحاضر (حالات + انتقالات + أنواع قابلة للتهيئة).
   تعمل بعد أي ترقية (idempotent) لأنها تعتمد على جدولها الخاص.
   لا تمثل أي مقتضيات قانونية ملزمة — Business Requirements من مهني.
   ================================================================ */
function seedPvConfig({ get, run, tx }) {
  const count = get('SELECT COUNT(*) AS c FROM pv_statuses').c;
  if (count > 0) return;

  return tx(() => {
    const statuses = [
      ['DRAFT', 'مسودة', 'Brouillon', 'gray', 1],
      ['IN_REVIEW', 'قيد المراجعة', 'En revue', 'blue', 2],
      ['FINALIZED', 'مُنهى', 'Finalisé', 'green', 3],
      ['ARCHIVED', 'مؤرشف', 'Archivé', 'amber', 4],
      ['CANCELLED', 'ملغى', 'Annulé', 'red', 5]
    ];
    statuses.forEach(([code, ar, fr, color, order]) => {
      run(
        `INSERT INTO pv_statuses (code, name_ar, name_fr, color, active, sort_order)
         VALUES (?,?,?,?,1,?)`,
        [code, ar, fr, color, order]
      );
    });

    const transitions = [
      ['DRAFT', 'IN_REVIEW'], ['DRAFT', 'CANCELLED'],
      ['IN_REVIEW', 'FINALIZED'], ['IN_REVIEW', 'DRAFT'], ['IN_REVIEW', 'CANCELLED'],
      ['FINALIZED', 'ARCHIVED'], ['FINALIZED', 'CANCELLED']
    ];
    transitions.forEach(([f, t]) => {
      run('INSERT INTO pv_status_transitions (from_status, to_status) VALUES (?,?)', [f, t]);
    });

    const types = [
      { code: 'NOTIFICATION', ar: 'محضر تبليغ', fr: 'PV de signification', descAr: 'محضر إثبات تبليغ وثيقة', descFr: "PV constatant la signification d'un acte", order: 1 },
      { code: 'EXECUTION', ar: 'محضر تنفيذ', fr: "PV d'exécution", descAr: 'محضر إثبات تنفيذ حكم أو قرار', descFr: "PV constatant l'exécution d'un jugement ou d'une décision", order: 2 },
      { code: 'CONSTATATION', ar: 'محضر معاينة', fr: 'PV de constat', descAr: 'محضر معاينة مادية', descFr: "PV de constat matériel", order: 3 },
      { code: 'GENERAL', ar: 'محضر عام', fr: 'PV général', descAr: 'محضر لأي إجراء آخر', descFr: 'PV pour toute autre procédure', order: 4 }
    ];
    types.forEach((t) => {
      run(
        `INSERT INTO pv_types (code, name_ar, name_fr, description_ar, description_fr, active, sort_order)
         VALUES (?,?,?,?,?,1,?)`,
        [t.code, t.ar, t.fr, t.descAr, t.descFr, t.order]
      );
    });
  });
}

/* ================================================================
   بذر طرق الدفع الافتراضية (قابلة للتعديل من الإعدادات).
   لا تمثل أي مقتضيات قانونية ملزمة — Business Requirements من مهني.
   لا تُبذر أتعاب أو رسوم هنا (لا أتعاب مكتوبة في الكود).
   ================================================================ */
function seedPaymentMethods({ get, run, tx }) {
  const count = get('SELECT COUNT(*) AS c FROM payment_methods').c;
  if (count > 0) return;

  return tx(() => {
    const methods = [
      ['OFFICE_PAY', 'مكتب التأشير', 'Paiement au cabinet', 1],
      ['DIRECT_PAY', 'مباشر للمفوض', "Paiement direct à l'huissier", 2],
      ['ELECTRONIC', 'إلكتروني', 'Paiement électronique', 3]
    ];
    methods.forEach(([code, ar, fr, order]) => {
      run(
        'INSERT INTO payment_methods (code, name_ar, name_fr, active, sort_order) VALUES (?, ?, ?, 1, ?)',
        [code, ar, fr, order]
      );
    });
  });
}

/* ================================================================
   بذر السجلات المهنية (قابلة للتهيئة من الإعدادات).
   وفق المادة 37 من القانون 46.21: سجل يومي للإجراءات + سجل يومي
   للعمليات الحسابية. النموذج الرسمي يحدَّد بنص تنظيمي لاحق ➜
   صيغ الترقيم هنا داخلية قابلة للتعديل وليست نماذج رسمية.
   ================================================================ */
function seedRegisters({ get, run, tx }) {
  const count = get('SELECT COUNT(*) AS c FROM registers').c;
  if (count > 0) return;

  return tx(() => {
    run(
      `INSERT INTO registers (code, kind, name_ar, name_fr, description_ar, description_fr,
         numbering_pattern, seq_frequency, schema_json, active)
       VALUES ('DAILY_PROCEDURE','daily',
         'السجل الخاص بالإجراءات اليومية','Registre quotidien des procédures',
         'يثبت فيه كل يوم جميع الإجراءات التي أنجزها المفوض القضائي مع بيان أرقام تسلسلها، من غير بياض أو شطب أو فراغ بين السطور (م.37 من القانون 46.21)',
         'Consigne chaque jour toutes les procédures réalisées avec leurs numéros de série, sans blanc, rature ni intercalation (art. 37 de la loi 46.21)',
         '{year}-{seq:000000}','year','[]',1)`
    );
    run(
      `INSERT INTO registers (code, kind, name_ar, name_fr, description_ar, description_fr,
         numbering_pattern, seq_frequency, schema_json, active)
       VALUES ('ACCOUNTING','accounting',
         'السجل الخاص بالعمليات الحسابية','Registre quotidien des opérations comptables',
         'يضمن فيه كل يوم جميع العمليات الحسابية من مبالغ وقيم متحصل عليها في إطار إنجاز الإجراءات مع بيان أرقام تسلسلها، من غير بياض أو شطب أو فراغ بين السطور (م.37 من القانون 46.21)',
         'Consigne chaque jour toutes les opérations comptables (montants et valeurs encaissés) avec leurs numéros de série, sans blanc, rature ni intercalation (art. 37 de la loi 46.21)',
         '{year}-{seq:000000}','year','[]',1)`
    );
    run("INSERT INTO meta (key, value) VALUES ('registers.auto.daily', '1')");
    run("INSERT INTO meta (key, value) VALUES ('registers.auto.accounting', '1')");
  });
}

module.exports = { seedIfEmpty, seedTemplateLibrary, seedPvConfig, seedPaymentMethods, seedRegisters };