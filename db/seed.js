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

    // ---------- الحقول الديناميكية لكل نوع ----------
    const fields = [
      // التبليغ (قضائي) — 9 حقول
      ['NOTIFICATION', 'act_to_notify', 'الوثيقة موضوع التبليغ', "L'acte à notifier", 'text', 1, 1, ''],
      ['NOTIFICATION', 'notif_date', 'تاريخ التبليغ', "Date de signification", 'date', 1, 2, ''],
      ['NOTIFICATION', 'notif_place', 'مكان التبليغ', "Lieu de signification", 'text', 0, 3, ''],
      ['NOTIFICATION', 'notif_method', 'طريقة التبليغ', "Mode de signification", 'select', 1, 4, 'شخصي, بالبريد الموصى عليه, بال宣示, عند المكتب'],
      ['NOTIFICATION', 'notif_result', 'نتيجة التبليغ', "Résultat de la signification", 'select', 1, 5, 'تم التبليغ, شخص غائب, رفض استلام, عنوان خاطئ, بريد موصى عليه'],
      ['NOTIFICATION', 'notif_time', 'ساعة التبليغ', "Heure de la signification", 'text', 0, 6, ''],
      ['NOTIFICATION', 'notif_witnesses', 'الشهود', 'Témoins', 'text', 0, 7, ''],
      ['NOTIFICATION', 'notif_obligee', 'المطالِب', 'Créancier', 'text', 0, 8, ''],
      ['NOTIFICATION', 'notif_debtor', 'المدين', 'Débiteur', 'text', 0, 9, ''],
      // تنفيذ الأحكام — 9 حقول
      ['EXECUTION_JUGEMENTS', 'title_ref', 'مرجع الحكم', 'Référence du jugement', 'text', 1, 1, ''],
      ['EXECUTION_JUGEMENTS', 'exec_amount', 'المبلغ محل التنفيذ', 'Montant à exécuter', 'number', 0, 2, ''],
      ['EXECUTION_JUGEMENTS', 'exec_notes', 'ملاحظات التنفيذ', "Notes d'exécution", 'textarea', 0, 3, ''],
      ['EXECUTION_JUGEMENTS', 'exec_court', 'المحكمة الصادرة عنها الحكم', 'Tribunal émetteur', 'text', 0, 4, ''],
      ['EXECUTION_JUGEMENTS', 'exec_judgment_date', 'تاريخ الحكم', 'Date du jugement', 'date', 0, 5, ''],
      ['EXECUTION_JUGEMENTS', 'exec_stage', 'مرحلة التنفيذ', "Étape d'exécution", 'select', 0, 6, '_pv宣布, محاولة التنفيذ, تنفيذ جزئي, تنفيذ كامل, فشل التنفيذ'],
      ['EXECUTION_JUGEMENTS', 'exec_procedures', 'الإجراءات المنجزة', "Procédures effectuées", 'textarea', 0, 7, ''],
      ['EXECUTION_JUGEMENTS', 'exec_result', 'نتيجة التنفيذ', "Résultat de l'exécution", 'select', 0, 8, 'تنفيذ كامل, تنفيذ جزئي, فشل, تأجيل'],
      ['EXECUTION_JUGEMENTS', 'exec_expenses', 'مصاريف التنفيذ', "Frais d'exécution", 'number', 0, 9, ''],
      // تنفيذ الأوامر — 7 حقول
      ['EXECUTION_ORDONNANCES', 'title_ref', 'مرجع الأمر', "Référence de l'ordonnance", 'text', 1, 1, ''],
      ['EXECUTION_ORDONNANCES', 'exec_amount', 'المبلغ محل التنفيذ', 'Montant à exécuter', 'number', 0, 2, ''],
      ['EXECUTION_ORDONNANCES', 'exec_court', 'المحكمة الصادرة عنها الأمر', 'Tribunal émetteur', 'text', 0, 3, ''],
      ['EXECUTION_ORDONNANCES', 'exec_date', 'تاريخ الأمر', "Date de l'ordonnance", 'date', 0, 4, ''],
      ['EXECUTION_ORDONNANCES', 'exec_procedures', 'الإجراءات المنجزة', "Procédures effectuées", 'textarea', 0, 5, ''],
      ['EXECUTION_ORDONNANCES', 'exec_result', 'نتيجة التنفيذ', "Résultat de l'exécution", 'select', 0, 6, 'تنفيذ كامل, تنفيذ جزئي, فشل, تأجيل'],
      ['EXECUTION_ORDONNANCES', 'exec_expenses', 'مصاريف التنفيذ', "Frais d'exécution", 'number', 0, 7, ''],
      // القيام بعمل — 5 حقول
      ['FAIRE', 'action_desc', 'وصف العمل المطلوب', "Description de l'acte demandé", 'textarea', 1, 1, ''],
      ['FAIRE', 'faire_deadline', 'الموعد النهائي للإنجاز', "Délai limite d'exécution", 'date', 0, 2, ''],
      ['FAIRE', 'faire_location', 'مكان التنفيذ', "Lieu d'exécution", 'text', 0, 3, ''],
      ['FAIRE', 'faire_result', 'نتيجة التنفيذ', "Résultat de l'exécution", 'textarea', 0, 4, ''],
      ['FAIRE', 'faire_costs', 'تكلفة العمل', "Coût de l'acte", 'number', 0, 5, ''],
      // تبليغ وتنفيذ — 8 حقول
      ['NOTIFICATION_EXECUTION', 'act_to_notify', 'الوثيقة موضوع التبليغ', "L'acte à notifier", 'text', 1, 1, ''],
      ['NOTIFICATION_EXECUTION', 'title_ref', 'مرجع الحكم/القرار', 'Référence du jugement/décision', 'text', 0, 2, ''],
      ['NOTIFICATION_EXECUTION', 'notif_date', 'تاريخ التبليغ', 'Date de signification', 'date', 0, 3, ''],
      ['NOTIFICATION_EXECUTION', 'notif_method', 'طريقة التبليغ', "Mode de signification", 'select', 0, 4, 'شخصي, بالبريد الموصى عليه, بال宣示'],
      ['NOTIFICATION_EXECUTION', 'notif_result', 'نتيجة التبليغ', "Résultat de la signification", 'select', 0, 5, 'تم التبليغ, شخص غائب, رفض استلام'],
      ['NOTIFICATION_EXECUTION', 'exec_amount', 'المبلغ محل التنفيذ', 'Montant à exécuter', 'number', 0, 6, ''],
      ['NOTIFICATION_EXECUTION', 'exec_procedures', 'إجراءات التنفيذ المنجزة', "Procédures d'exécution effectuées", 'textarea', 0, 7, ''],
      ['NOTIFICATION_EXECUTION', 'exec_result', 'نتيجة التنفيذ', "Résultat de l'exécution", 'select', 0, 8, 'تنفيذ كامل, تنفيذ جزئي, فشل'],
      // التبليغات (مباشر) — 5 حقول
      ['NOTIFICATIONS', 'act_to_notify', 'الوثيقة موضوع التبليغ', "L'acte à notifier", 'text', 1, 1, ''],
      ['NOTIFICATIONS', 'notif_date', 'تاريخ التبليغ', 'Date de signification', 'date', 0, 2, ''],
      ['NOTIFICATIONS', 'notif_place', 'مكان التبليغ', "Lieu de signification", 'text', 0, 3, ''],
      ['NOTIFICATIONS', 'notif_method', 'طريقة التبليغ', "Mode de signification", 'select', 0, 4, 'شخصي, بالبريد الموصى عليه, بال宣示'],
      ['NOTIFICATIONS', 'notif_result', 'نتيجة التبليغ', "Résultat de la signification", 'select', 0, 5, 'تم التبليغ, شخص غائب, رفض استلام'],
      // المعاينات — 8 حقول
      ['CONSTATATIONS', 'constat_object', 'موضوع المعاينة', "Objet du constat", 'text', 1, 1, ''],
      ['CONSTATATIONS', 'constat_date', 'تاريخ المعاينة', 'Date du constat', 'date', 0, 2, ''],
      ['CONSTATATIONS', 'constat_place', 'مكان المعاينة', "Lieu du constat", 'text', 0, 3, ''],
      ['CONSTATATIONS', 'constat_attendees', 'الحاضرون', 'Personnes présentes', 'textarea', 0, 4, ''],
      ['CONSTATATIONS', 'constat_facts', 'الوقائع المعاينة', 'Faits constatés', 'textarea', 1, 5, ''],
      ['CONSTATATIONS', 'constat_attachments', 'المرفقات', 'Pièces jointes', 'textarea', 0, 6, ''],
      ['CONSTATATIONS', 'constat_result', 'النتيجة والتراتيب', 'Résultat et dispositions', 'textarea', 0, 7, ''],
      ['CONSTATATIONS', 'constat_photos', 'عدد الصور المحصلة', 'Nombre de photos', 'number', 0, 8, ''],
      // عرض عيني — 7 حقول
      ['OFFRE_REELLE', 'offered_amount', 'المبلغ المعروض', 'Montant offert', 'number', 1, 1, ''],
      ['OFFRE_REELLE', 'offer_date', 'تاريخ العرض', "Date de l'offre", 'date', 0, 2, ''],
      ['OFFRE_REELLE', 'offer_purpose', 'سبب العرض', "Motif de l'offre", 'textarea', 0, 3, ''],
      ['OFFRE_REELLE', 'offer_creditor', 'دائن المبلغ', 'Créancier', 'text', 0, 4, ''],
      ['OFFRE_REELLE', 'offer_debtor', 'المدين المعروض', 'Débiteur offrant', 'text', 0, 5, ''],
      ['OFFRE_REELLE', 'offer_witnesses', 'الشهود', 'Témoins', 'text', 0, 6, ''],
      ['OFFRE_REELLE', 'offer_acceptance', 'موقف الدائن من العرض', 'Réponse du créancier', 'select', 0, 7, 'مقبول, مرفوض, بدون رد']
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

    // ربط القوالب بأنواع الإجراءات
    const notifType = get("SELECT id FROM procedure_types WHERE code = 'NOTIFICATION'");
    const execJudType = get("SELECT id FROM procedure_types WHERE code = 'EXECUTION_JUGEMENTS'");
    const execOrdType = get("SELECT id FROM procedure_types WHERE code = 'EXECUTION_ORDONNANCES'");
    const faireType = get("SELECT id FROM procedure_types WHERE code = 'FAIRE'");
    const notifExecType = get("SELECT id FROM procedure_types WHERE code = 'NOTIFICATION_EXECUTION'");
    const notifsType = get("SELECT id FROM procedure_types WHERE code = 'NOTIFICATIONS'");
    const constatType = get("SELECT id FROM procedure_types WHERE code = 'CONSTATATIONS'");
    const offreType = get("SELECT id FROM procedure_types WHERE code = 'OFFRE_REELLE'");

    const insertTemplate = (name, catCode, typeId, lang, content) => {
      const tpl = run(
        `INSERT INTO document_templates (name, category_id, procedure_type_id, language, description, active, archived, current_version_id, created_by)
         VALUES (?,?,?,?,?,1,0,0,'admin')`,
        [name, catIds[catCode], typeId || null, lang, lang === 'ar'
          ? 'نموذج قانوني متخصص — بيانات ديناميكية تلقائية'
          : 'Modèle juridique spécialisé — variables dynamiques automatiques']
      ).lastId;
      const ver = run(
        `INSERT INTO template_versions (template_id, version, content, variables, note, created_by) VALUES (?,?,?,?,?,?)`,
        [tpl, '1.0', content, JSON.stringify(extractVars(content)), 'النسخة الأولى', 'admin']
      ).lastId;
      run('UPDATE document_templates SET current_version_id = ? WHERE id = ?', [ver, tpl]);
      return tpl;
    };

    /* ======================== 1. التبليغ (قضائي) ======================== */
    insertTemplate('محضر تبليغ قضائي', 'NOTIFICATION', notifType ? notifType.id : null, 'ar', `
<h2>محضر تبليغ قضائي</h2>
<p style="text-align:center;color:#555;">المؤرخ في {{today_date}} — المكتب: {{office_name}}</p>

<h4>بيانات المكتب</h4>
<table class="kv">
  <tr><td>المفوض القضائي</td><td>{{commissioner_name}}</td></tr>
  <tr><td>اسم المكتب</td><td>{{office_name}}</td></tr>
  <tr><td>العنوان</td><td>{{office_address}}</td></tr>
  <tr><td>الهاتف</td><td>{{office_phone}}</td></tr>
  <tr><td>رقم الترسيم</td><td>{{office_registration_number}}</td></tr>
</table>

<h4>بيانات الملف</h4>
<table class="kv">
  <tr><td>رقم الملف</td><td>{{dossier_number}}</td></tr>
  <tr><td>المحكمة</td><td>{{dossier_court}}</td></tr>
  <tr><td>نوع الملف</td><td>{{dossier_type}}</td></tr>
  <tr><td>المدعي</td><td>{{applicant_name}}</td></tr>
  <tr><td>المدعى عليه</td><td>{{opponent_name}}</td></tr>
</table>

<h4>بيانات التبليغ</h4>
<table class="kv">
  <tr><td>رقم الإجراء</td><td>{{procedure_number}}</td></tr>
  <tr><td>نوع الإجراء</td><td>{{procedure_type}}</td></tr>
  <tr><td>الوثيقة موضوع التبليغ</td><td>{{field.act_to_notify}}</td></tr>
  <tr><td>المطالِب</td><td>{{field.notif_obligee}}</td></tr>
  <tr><td>المدين</td><td>{{field.notif_debtor}}</td></tr>
  <tr><td>تاريخ التبليغ</td><td>{{field.notif_date}}</td></tr>
  <tr><td>ساعة التبليغ</td><td>{{field.notif_time}}</td></tr>
  <tr><td>مكان التبليغ</td><td>{{field.notif_place}}</td></tr>
  <tr><td>طريقة التبليغ</td><td>{{field.notif_method}}</td></tr>
</table>

<h4>الطرف المبلَّغ</h4>
<table class="kv">
  <tr><td>الاسم</td><td>{{party_name}}</td></tr>
  <tr><td>رقم البطاقة الوطنية</td><td>{{party_cin}}</td></tr>
  <tr><td>العنوان</td><td>{{party_address}}</td></tr>
  <tr><td>الهاتف</td><td>{{party_phone}}</td></tr>
</table>

<h4>النتيجة</h4>
<table class="kv">
  <tr><td>نتيجة التبليغ</td><td>{{field.notif_result}}</td></tr>
  <tr><td>الشهود</td><td>{{field.notif_witnesses}}</td></tr>
</table>

<h4>ملاحظات</h4>
<p>{{procedure_notes}}</p>

<div class="sig">
  <div class="col"><div class="line"></div>المطالِب</div>
  <div class="col"><div class="line"></div>المفوض القضائي<br><span style="font-size:10px;">{{office_name}} — ختم المكتب</span></div>
</div>`);

    insertTemplate('PV de signification judiciaire', 'NOTIFICATION', notifType ? notifType.id : null, 'fr', `
<h2>PV de signification judiciaire</h2>
<p style="text-align:center;color:#555;">Fait le {{today_date}} — Cabinet : {{office_name}}</p>

<h4>Identification du cabinet</h4>
<table class="kv">
  <tr><td>Huissier de justice</td><td>{{commissioner_name}}</td></tr>
  <tr><td>Nom du cabinet</td><td>{{office_name}}</td></tr>
  <tr><td>Adresse</td><td>{{office_address}}</td></tr>
  <tr><td>Téléphone</td><td>{{office_phone}}</td></tr>
  <tr><td>N° d'immatriculation</td><td>{{office_registration_number}}</td></tr>
</table>

<h4>Référence du dossier</h4>
<table class="kv">
  <tr><td>N° dossier</td><td>{{dossier_number}}</td></tr>
  <tr><td>Tribunal</td><td>{{dossier_court}}</td></tr>
  <tr><td>Type de dossier</td><td>{{dossier_type}}</td></tr>
  <tr><td>Demandeur</td><td>{{applicant_name}}</td></tr>
  <tr><td>Défendeur</td><td>{{opponent_name}}</td></tr>
</table>

<h4>Détails de la signification</h4>
<table class="kv">
  <tr><td>N° procédure</td><td>{{procedure_number}}</td></tr>
  <tr><td>Type</td><td>{{procedure_type}}</td></tr>
  <tr><td>Acte à notifier</td><td>{{field.act_to_notify}}</td></tr>
  <tr><td>Créancier</td><td>{{field.notif_obligee}}</td></tr>
  <tr><td>Débiteur</td><td>{{field.notif_debtor}}</td></tr>
  <tr><td>Date de signification</td><td>{{field.notif_date}}</td></tr>
  <tr><td>Heure</td><td>{{field.notif_time}}</td></tr>
  <tr><td>Lieu</td><td>{{field.notif_place}}</td></tr>
  <tr><td>Mode</td><td>{{field.notif_method}}</td></tr>
</table>

<h4>Partie signifiée</h4>
<table class="kv">
  <tr><td>Nom</td><td>{{party_name}}</td></tr>
  <tr><td>CIN</td><td>{{party_cin}}</td></tr>
  <tr><td>Adresse</td><td>{{party_address}}</td></tr>
  <tr><td>Téléphone</td><td>{{party_phone}}</td></tr>
</table>

<h4>Résultat</h4>
<table class="kv">
  <tr><td>Résultat</td><td>{{field.notif_result}}</td></tr>
  <tr><td>Témoins</td><td>{{field.notif_witnesses}}</td></tr>
</table>

<h4>Observations</h4>
<p>{{procedure_notes}}</p>

<div class="sig">
  <div class="col"><div class="line"></div>Créancier</div>
  <div class="col"><div class="line"></div>Huissier de justice<br><span style="font-size:10px;">{{office_name}} — Sceau du cabinet</span></div>
</div>`);

    /* ======================== 2. تنفيذ الأحكام ======================== */
    insertTemplate('محضر تنفيذ حكم', 'EXECUTION_JUGEMENTS', execJudType ? execJudType.id : null, 'ar', `
<h2>محضر تنفيذ حكم قضائي</h2>
<p style="text-align:center;color:#555;">المؤرخ في {{today_date}} — المكتب: {{office_name}}</p>

<h4>بيانات المكتب</h4>
<table class="kv">
  <tr><td>المفوض القضائي</td><td>{{commissioner_name}}</td></tr>
  <tr><td>اسم المكتب</td><td>{{office_name}}</td></tr>
  <tr><td>العنوان</td><td>{{office_address}}</td></tr>
  <tr><td>رقم الترسيم</td><td>{{office_registration_number}}</td></tr>
</table>

<h4>بيانات الحكم</h4>
<table class="kv">
  <tr><td>مرجع الحكم</td><td>{{field.title_ref}}</td></tr>
  <tr><td>المحكمة الصادرة عنها</td><td>{{field.exec_court}}</td></tr>
  <tr><td>تاريخ الحكم</td><td>{{field.exec_judgment_date}}</td></tr>
  <tr><td>المبلغ محل التنفيذ</td><td>{{field.exec_amount}} {{procedure_currency}}</td></tr>
  <tr><td>مرحلة التنفيذ</td><td>{{field.exec_stage}}</td></tr>
</table>

<h4>بيانات الملف</h4>
<table class="kv">
  <tr><td>رقم الملف</td><td>{{dossier_number}}</td></tr>
  <tr><td>المحكمة</td><td>{{dossier_court}}</td></tr>
  <tr><td>المدعي (المطالب بالتنفيذ)</td><td>{{applicant_name}}</td></tr>
  <tr><td>المدعى عليه (المدين)</td><td>{{opponent_name}}</td></tr>
  <tr><td>رقم الإجراء</td><td>{{procedure_number}}</td></tr>
</table>

<h4>الإجراءات المنجزة</h4>
<p style="white-space:pre-line;">{{field.exec_procedures}}</p>

<h4>نتيجة التنفيذ</h4>
<table class="kv">
  <tr><td>النتيجة</td><td>{{field.exec_result}}</td></tr>
  <tr><td>مصاريف التنفيذ</td><td>{{field.exec_expenses}} {{procedure_currency}}</td></tr>
</table>

<h4>ملاحظات</h4>
<p style="white-space:pre-line;">{{field.exec_notes}}</p>
<p>{{procedure_notes}}</p>

<div class="sig">
  <div class="col"><div class="line"></div>المطالب بالتنفيذ</div>
  <div class="col"><div class="line"></div>المفوض القضائي<br><span style="font-size:10px;">{{office_name}} — ختم المكتب</span></div>
</div>`);

    insertTemplate("PV d'exécution de jugement", 'EXECUTION_JUGEMENTS', execJudType ? execJudType.id : null, 'fr', `
<h2>PV d'exécution de jugement</h2>
<p style="text-align:center;color:#555;">Fait le {{today_date}} — Cabinet : {{office_name}}</p>

<h4>Identification du cabinet</h4>
<table class="kv">
  <tr><td>Huissier de justice</td><td>{{commissioner_name}}</td></tr>
  <tr><td>Nom du cabinet</td><td>{{office_name}}</td></tr>
  <tr><td>Adresse</td><td>{{office_address}}</td></tr>
  <tr><td>N° d'immatriculation</td><td>{{office_registration_number}}</td></tr>
</table>

<h4>Référence du jugement</h4>
<table class="kv">
  <tr><td>Référence</td><td>{{field.title_ref}}</td></tr>
  <tr><td>Tribunal émetteur</td><td>{{field.exec_court}}</td></tr>
  <tr><td>Date du jugement</td><td>{{field.exec_judgment_date}}</td></tr>
  <tr><td>Montant à exécuter</td><td>{{field.exec_amount}} {{procedure_currency}}</td></tr>
  <tr><td>Étape d'exécution</td><td>{{field.exec_stage}}</td></tr>
</table>

<h4>Référence du dossier</h4>
<table class="kv">
  <tr><td>N° dossier</td><td>{{dossier_number}}</td></tr>
  <tr><td>Tribunal</td><td>{{dossier_court}}</td></tr>
  <tr><td>Demandeur</td><td>{{applicant_name}}</td></tr>
  <tr><td>Défendeur</td><td>{{opponent_name}}</td></tr>
  <tr><td>N° procédure</td><td>{{procedure_number}}</td></tr>
</table>

<h4>Procédures effectuées</h4>
<p style="white-space:pre-line;">{{field.exec_procedures}}</p>

<h4>Résultat</h4>
<table class="kv">
  <tr><td>Résultat</td><td>{{field.exec_result}}</td></tr>
  <tr><td>Frais d'exécution</td><td>{{field.exec_expenses}} {{procedure_currency}}</td></tr>
</table>

<h4>Observations</h4>
<p style="white-space:pre-line;">{{field.exec_notes}}</p>
<p>{{procedure_notes}}</p>

<div class="sig">
  <div class="col"><div class="line"></div>Demandeur</div>
  <div class="col"><div class="line"></div>Huissier de justice<br><span style="font-size:10px;">{{office_name}} — Sceau du cabinet</span></div>
</div>`);

    /* ======================== 3. تنفيذ الأوامر ======================== */
    insertTemplate('محضر تنفيذ أمر قضائي', 'EXECUTION_ORDONNANCES', execOrdType ? execOrdType.id : null, 'ar', `
<h2>محضر تنفيذ أمر قضائي</h2>
<p style="text-align:center;color:#555;">المؤرخ في {{today_date}} — المكتب: {{office_name}}</p>

<h4>بيانات المكتب</h4>
<table class="kv">
  <tr><td>المفوض القضائي</td><td>{{commissioner_name}}</td></tr>
  <tr><td>اسم المكتب</td><td>{{office_name}}</td></tr>
  <tr><td>العنوان</td><td>{{office_address}}</td></tr>
  <tr><td>رقم الترسيم</td><td>{{office_registration_number}}</td></tr>
</table>

<h4>بيانات الأمر</h4>
<table class="kv">
  <tr><td>مرجع الأمر</td><td>{{field.title_ref}}</td></tr>
  <tr><td>المحكمة الصادرة عنها</td><td>{{field.exec_court}}</td></tr>
  <tr><td>تاريخ الأمر</td><td>{{field.exec_date}}</td></tr>
  <tr><td>المبلغ محل التنفيذ</td><td>{{field.exec_amount}} {{procedure_currency}}</td></tr>
</table>

<h4>بيانات الملف</h4>
<table class="kv">
  <tr><td>رقم الملف</td><td>{{dossier_number}}</td></tr>
  <tr><td>المحكمة</td><td>{{dossier_court}}</td></tr>
  <tr><td>المدعي (المطالب)</td><td>{{applicant_name}}</td></tr>
  <tr><td>المدعى عليه</td><td>{{opponent_name}}</td></tr>
  <tr><td>رقم الإجراء</td><td>{{procedure_number}}</td></tr>
</table>

<h4>الإجراءات المنجزة</h4>
<p style="white-space:pre-line;">{{field.exec_procedures}}</p>

<h4>نتيجة التنفيذ</h4>
<table class="kv">
  <tr><td>النتيجة</td><td>{{field.exec_result}}</td></tr>
  <tr><td>مصاريف التنفيذ</td><td>{{field.exec_expenses}} {{procedure_currency}}</td></tr>
</table>

<div class="sig">
  <div class="col"><div class="line"></div>المطالب بالتنفيذ</div>
  <div class="col"><div class="line"></div>المفوض القضائي<br><span style="font-size:10px;">{{office_name}} — ختم المكتب</span></div>
</div>`);

    insertTemplate("PV d'exécution d'ordonnance", 'EXECUTION_ORDONNANCES', execOrdType ? execOrdType.id : null, 'fr', `
<h2>PV d'exécution d'ordonnance</h2>
<p style="text-align:center;color:#555;">Fait le {{today_date}} — Cabinet : {{office_name}}</p>

<h4>Identification du cabinet</h4>
<table class="kv">
  <tr><td>Huissier de justice</td><td>{{commissioner_name}}</td></tr>
  <tr><td>Nom du cabinet</td><td>{{office_name}}</td></tr>
  <tr><td>Adresse</td><td>{{office_address}}</td></tr>
  <tr><td>N° d'immatriculation</td><td>{{office_registration_number}}</td></tr>
</table>

<h4>Référence de l'ordonnance</h4>
<table class="kv">
  <tr><td>Référence</td><td>{{field.title_ref}}</td></tr>
  <tr><td>Tribunal émetteur</td><td>{{field.exec_court}}</td></tr>
  <tr><td>Date de l'ordonnance</td><td>{{field.exec_date}}</td></tr>
  <tr><td>Montant à exécuter</td><td>{{field.exec_amount}} {{procedure_currency}}</td></tr>
</table>

<h4>Référence du dossier</h4>
<table class="kv">
  <tr><td>N° dossier</td><td>{{dossier_number}}</td></tr>
  <tr><td>Tribunal</td><td>{{dossier_court}}</td></tr>
  <tr><td>Demandeur</td><td>{{applicant_name}}</td></tr>
  <tr><td>Défendeur</td><td>{{opponent_name}}</td></tr>
  <tr><td>N° procédure</td><td>{{procedure_number}}</td></tr>
</table>

<h4>Procédures effectuées</h4>
<p style="white-space:pre-line;">{{field.exec_procedures}}</p>

<h4>Résultat</h4>
<table class="kv">
  <tr><td>Résultat</td><td>{{field.exec_result}}</td></tr>
  <tr><td>Frais d'exécution</td><td>{{field.exec_expenses}} {{procedure_currency}}</td></tr>
</table>

<div class="sig">
  <div class="col"><div class="line"></div>Demandeur</div>
  <div class="col"><div class="line"></div>Huissier de justice<br><span style="font-size:10px;">{{office_name}} — Sceau du cabinet</span></div>
</div>`);

    /* ======================== 4. القيام بعمل ======================== */
    insertTemplate('محضر القيام بعمل', 'FAIRE', faireType ? faireType.id : null, 'ar', `
<h2>محضر القيام بعمل</h2>
<p style="text-align:center;color:#555;">المؤرخ في {{today_date}} — المكتب: {{office_name}}</p>

<h4>بيانات المكتب</h4>
<table class="kv">
  <tr><td>المفوض القضائي</td><td>{{commissioner_name}}</td></tr>
  <tr><td>اسم المكتب</td><td>{{office_name}}</td></tr>
  <tr><td>العنوان</td><td>{{office_address}}</td></tr>
  <tr><td>رقم الترسيم</td><td>{{office_registration_number}}</td></tr>
</table>

<h4>وصف العمل المطلوب</h4>
<p style="white-space:pre-line;border:1px solid #ddd;padding:10px;background:#f9f9f9;">{{field.action_desc}}</p>

<h4>بيانات الملف</h4>
<table class="kv">
  <tr><td>رقم الملف</td><td>{{dossier_number}}</td></tr>
  <tr><td>المحكمة</td><td>{{dossier_court}}</td></tr>
  <tr><td>المدعي</td><td>{{applicant_name}}</td></tr>
  <tr><td>المدعى عليه</td><td>{{opponent_name}}</td></tr>
  <tr><td>رقم الإجراء</td><td>{{procedure_number}}</td></tr>
  <tr><td>نوع الإجراء</td><td>{{procedure_type}}</td></tr>
</table>

<h4>تفاصيل التنفيذ</h4>
<table class="kv">
  <tr><td>مكان التنفيذ</td><td>{{field.faire_location}}</td></tr>
  <tr><td>الموعد النهائي</td><td>{{field.faire_deadline}}</td></tr>
  <tr><td>تكلفة العمل</td><td>{{field.faire_costs}} {{procedure_currency}}</td></tr>
</table>

<h4>نتيجة التنفيذ</h4>
<p style="white-space:pre-line;border:1px solid #ddd;padding:10px;background:#f9f9f9;">{{field.faire_result}}</p>

<h4>ملاحظات</h4>
<p>{{procedure_notes}}</p>

<div class="sig">
  <div class="col"><div class="line"></div>المطالب بالعمل</div>
  <div class="col"><div class="line"></div>المفوض القضائي<br><span style="font-size:10px;">{{office_name}} — ختم المكتب</span></div>
</div>`);

    insertTemplate('PV de faire', 'FAIRE', faireType ? faireType.id : null, 'fr', `
<h2>PV de faire</h2>
<p style="text-align:center;color:#555;">Fait le {{today_date}} — Cabinet : {{office_name}}</p>

<h4>Identification du cabinet</h4>
<table class="kv">
  <tr><td>Huissier de justice</td><td>{{commissioner_name}}</td></tr>
  <tr><td>Nom du cabinet</td><td>{{office_name}}</td></tr>
  <tr><td>Adresse</td><td>{{office_address}}</td></tr>
  <tr><td>N° d'immatriculation</td><td>{{office_registration_number}}</td></tr>
</table>

<h4>Description de l'acte demandé</h4>
<p style="white-space:pre-line;border:1px solid #ddd;padding:10px;background:#f9f9f9;">{{field.action_desc}}</p>

<h4>Référence du dossier</h4>
<table class="kv">
  <tr><td>N° dossier</td><td>{{dossier_number}}</td></tr>
  <tr><td>Tribunal</td><td>{{dossier_court}}</td></tr>
  <tr><td>Demandeur</td><td>{{applicant_name}}</td></tr>
  <tr><td>Défendeur</td><td>{{opponent_name}}</td></tr>
  <tr><td>N° procédure</td><td>{{procedure_number}}</td></tr>
  <tr><td>Type</td><td>{{procedure_type}}</td></tr>
</table>

<h4>Détails d'exécution</h4>
<table class="kv">
  <tr><td>Lieu d'exécution</td><td>{{field.faire_location}}</td></tr>
  <tr><td>Délai limite</td><td>{{field.faire_deadline}}</td></tr>
  <tr><td>Coût</td><td>{{field.faire_costs}} {{procedure_currency}}</td></tr>
</table>

<h4>Résultat</h4>
<p style="white-space:pre-line;border:1px solid #ddd;padding:10px;background:#f9f9f9;">{{field.faire_result}}</p>

<h4>Observations</h4>
<p>{{procedure_notes}}</p>

<div class="sig">
  <div class="col"><div class="line"></div>Demandeur</div>
  <div class="col"><div class="line"></div>Huissier de justice<br><span style="font-size:10px;">{{office_name}} — Sceau du cabinet</span></div>
</div>`);

    /* ======================== 5. تبليغ وتنفيذ ======================== */
    insertTemplate('محضر تبليغ وتنفيذ', 'NOTIFICATION_EXECUTION', notifExecType ? notifExecType.id : null, 'ar', `
<h2>محضر تبليغ وتنفيذ</h2>
<p style="text-align:center;color:#555;">المؤرخ في {{today_date}} — المكتب: {{office_name}}</p>

<h4>بيانات المكتب</h4>
<table class="kv">
  <tr><td>المفوض القضائي</td><td>{{commissioner_name}}</td></tr>
  <tr><td>اسم المكتب</td><td>{{office_name}}</td></tr>
  <tr><td>العنوان</td><td>{{office_address}}</td></tr>
  <tr><td>رقم الترسيم</td><td>{{office_registration_number}}</td></tr>
</table>

<h4>بيانات الملف</h4>
<table class="kv">
  <tr><td>رقم الملف</td><td>{{dossier_number}}</td></tr>
  <tr><td>المحكمة</td><td>{{dossier_court}}</td></tr>
  <tr><td>المدعي</td><td>{{applicant_name}}</td></tr>
  <tr><td>المدعى عليه</td><td>{{opponent_name}}</td></tr>
  <tr><td>رقم الإجراء</td><td>{{procedure_number}}</td></tr>
</table>

<h4>المرحلة الأولى: التبليغ</h4>
<table class="kv">
  <tr><td>الوثيقة موضوع التبليغ</td><td>{{field.act_to_notify}}</td></tr>
  <tr><td>مرجع الحكم/القرار</td><td>{{field.title_ref}}</td></tr>
  <tr><td>تاريخ التبليغ</td><td>{{field.notif_date}}</td></tr>
  <tr><td>طريقة التبليغ</td><td>{{field.notif_method}}</td></tr>
  <tr><td>نتيجة التبليغ</td><td>{{field.notif_result}}</td></tr>
</table>
<table class="kv">
  <tr><td>الطرف المبلَّغ</td><td>{{party_name}}</td></tr>
  <tr><td>رقم البطاقة الوطنية</td><td>{{party_cin}}</td></tr>
  <tr><td>العنوان</td><td>{{party_address}}</td></tr>
</table>

<h4>المرحلة الثانية: التنفيذ</h4>
<table class="kv">
  <tr><td>المبلغ محل التنفيذ</td><td>{{field.exec_amount}} {{procedure_currency}}</td></tr>
  <tr><td>إجراءات التنفيذ المنجزة</td><td>{{field.exec_procedures}}</td></tr>
  <tr><td>نتيجة التنفيذ</td><td>{{field.exec_result}}</td></tr>
</table>

<h4>ملاحظات</h4>
<p>{{procedure_notes}}</p>

<div class="sig">
  <div class="col"><div class="line"></div>المطالب بالتنفيذ</div>
  <div class="col"><div class="line"></div>المفوض القضائي<br><span style="font-size:10px;">{{office_name}} — ختم المكتب</span></div>
</div>`);

    insertTemplate('PV de notification et exécution', 'NOTIFICATION_EXECUTION', notifExecType ? notifExecType.id : null, 'fr', `
<h2>PV de notification et exécution</h2>
<p style="text-align:center;color:#555;">Fait le {{today_date}} — Cabinet : {{office_name}}</p>

<h4>Identification du cabinet</h4>
<table class="kv">
  <tr><td>Huissier de justice</td><td>{{commissioner_name}}</td></tr>
  <tr><td>Nom du cabinet</td><td>{{office_name}}</td></tr>
  <tr><td>Adresse</td><td>{{office_address}}</td></tr>
  <tr><td>N° d'immatriculation</td><td>{{office_registration_number}}</td></tr>
</table>

<h4>Référence du dossier</h4>
<table class="kv">
  <tr><td>N° dossier</td><td>{{dossier_number}}</td></tr>
  <tr><td>Tribunal</td><td>{{dossier_court}}</td></tr>
  <tr><td>Demandeur</td><td>{{applicant_name}}</td></tr>
  <tr><td>Défendeur</td><td>{{opponent_name}}</td></tr>
  <tr><td>N° procédure</td><td>{{procedure_number}}</td></tr>
</table>

<h4>Phase 1 : Signification</h4>
<table class="kv">
  <tr><td>Acte à notifier</td><td>{{field.act_to_notify}}</td></tr>
  <tr><td>Référence</td><td>{{field.title_ref}}</td></tr>
  <tr><td>Date</td><td>{{field.notif_date}}</td></tr>
  <tr><td>Mode</td><td>{{field.notif_method}}</td></tr>
  <tr><td>Résultat</td><td>{{field.notif_result}}</td></tr>
</table>
<table class="kv">
  <tr><td>Partie signifiée</td><td>{{party_name}}</td></tr>
  <tr><td>CIN</td><td>{{party_cin}}</td></tr>
  <tr><td>Adresse</td><td>{{party_address}}</td></tr>
</table>

<h4>Phase 2 : Exécution</h4>
<table class="kv">
  <tr><td>Montant</td><td>{{field.exec_amount}} {{procedure_currency}}</td></tr>
  <tr><td>Procédures</td><td>{{field.exec_procedures}}</td></tr>
  <tr><td>Résultat</td><td>{{field.exec_result}}</td></tr>
</table>

<h4>Observations</h4>
<p>{{procedure_notes}}</p>

<div class="sig">
  <div class="col"><div class="line"></div>Demandeur</div>
  <div class="col"><div class="line"></div>Huissier de justice<br><span style="font-size:10px;">{{office_name}} — Sceau du cabinet</span></div>
</div>`);

    /* ======================== 6. التبليغات المباشرة ======================== */
    insertTemplate('محضر تبليغ مباشر', 'NOTIFICATIONS', notifsType ? notifsType.id : null, 'ar', `
<h2>محضر تبليغ مباشر</h2>
<p style="text-align:center;color:#555;">المؤرخ في {{today_date}} — المكتب: {{office_name}}</p>

<h4>بيانات المكتب</h4>
<table class="kv">
  <tr><td>المفوض القضائي</td><td>{{commissioner_name}}</td></tr>
  <tr><td>اسم المكتب</td><td>{{office_name}}</td></tr>
  <tr><td>العنوان</td><td>{{office_address}}</td></tr>
  <tr><td>رقم الترسيم</td><td>{{office_registration_number}}</td></tr>
</table>

<h4>بيانات التبليغ</h4>
<table class="kv">
  <tr><td>رقم الإجراء</td><td>{{procedure_number}}</td></tr>
  <tr><td>الوثيقة موضوع التبليغ</td><td>{{field.act_to_notify}}</td></tr>
  <tr><td>تاريخ التبليغ</td><td>{{field.notif_date}}</td></tr>
  <tr><td>مكان التبليغ</td><td>{{field.notif_place}}</td></tr>
  <tr><td>طريقة التبليغ</td><td>{{field.notif_method}}</td></tr>
  <tr><td>نتيجة التبليغ</td><td>{{field.notif_result}}</td></tr>
</table>

<h4>الطرف المبلَّغ</h4>
<table class="kv">
  <tr><td>الاسم</td><td>{{party_name}}</td></tr>
  <tr><td>رقم البطاقة الوطنية</td><td>{{party_cin}}</td></tr>
  <tr><td>العنوان</td><td>{{party_address}}</td></tr>
  <tr><td>الهاتف</td><td>{{party_phone}}</td></tr>
</table>

<h4>ملاحظات</h4>
<p>{{procedure_notes}}</p>

<div class="sig">
  <div class="col"><div class="line"></div>المطالِب</div>
  <div class="col"><div class="line"></div>المفوض القضائي<br><span style="font-size:10px;">{{office_name}} — ختم المكتب</span></div>
</div>`);

    insertTemplate('PV de notification directe', 'NOTIFICATIONS', notifsType ? notifsType.id : null, 'fr', `
<h2>PV de notification directe</h2>
<p style="text-align:center;color:#555;">Fait le {{today_date}} — Cabinet : {{office_name}}</p>

<h4>Identification du cabinet</h4>
<table class="kv">
  <tr><td>Huissier de justice</td><td>{{commissioner_name}}</td></tr>
  <tr><td>Nom du cabinet</td><td>{{office_name}}</td></tr>
  <tr><td>Adresse</td><td>{{office_address}}</td></tr>
  <tr><td>N° d'immatriculation</td><td>{{office_registration_number}}</td></tr>
</table>

<h4>Détails de la notification</h4>
<table class="kv">
  <tr><td>N° procédure</td><td>{{procedure_number}}</td></tr>
  <tr><td>Acte à notifier</td><td>{{field.act_to_notify}}</td></tr>
  <tr><td>Date</td><td>{{field.notif_date}}</td></tr>
  <tr><td>Lieu</td><td>{{field.notif_place}}</td></tr>
  <tr><td>Mode</td><td>{{field.notif_method}}</td></tr>
  <tr><td>Résultat</td><td>{{field.notif_result}}</td></tr>
</table>

<h4>Partie signifiée</h4>
<table class="kv">
  <tr><td>Nom</td><td>{{party_name}}</td></tr>
  <tr><td>CIN</td><td>{{party_cin}}</td></tr>
  <tr><td>Adresse</td><td>{{party_address}}</td></tr>
  <tr><td>Téléphone</td><td>{{party_phone}}</td></tr>
</table>

<h4>Observations</h4>
<p>{{procedure_notes}}</p>

<div class="sig">
  <div class="col"><div class="line"></div>Créancier</div>
  <div class="col"><div class="line"></div>Huissier de justice<br><span style="font-size:10px;">{{office_name}} — Sceau du cabinet</span></div>
</div>`);

    /* ======================== 7. المعاينات ======================== */
    insertTemplate('محضر معاينة', 'CONSTATATIONS', constatType ? constatType.id : null, 'ar', `
<h2>محضر معاينة</h2>
<p style="text-align:center;color:#555;">المؤرخ في {{today_date}} — المكتب: {{office_name}}</p>

<h4>بيانات المكتب</h4>
<table class="kv">
  <tr><td>المفوض القضائي</td><td>{{commissioner_name}}</td></tr>
  <tr><td>اسم المكتب</td><td>{{office_name}}</td></tr>
  <tr><td>العنوان</td><td>{{office_address}}</td></tr>
  <tr><td>رقم الترسيم</td><td>{{office_registration_number}}</td></tr>
</table>

<h4>بيانات المعاينة</h4>
<table class="kv">
  <tr><td>رقم الإجراء</td><td>{{procedure_number}}</td></tr>
  <tr><td>موضوع المعاينة</td><td>{{field.constat_object}}</td></tr>
  <tr><td>تاريخ المعاينة</td><td>{{field.constat_date}}</td></tr>
  <tr><td>مكان المعاينة</td><td>{{field.constat_place}}</td></tr>
</table>

<h4>بيانات الملف</h4>
<table class="kv">
  <tr><td>رقم الملف</td><td>{{dossier_number}}</td></tr>
  <tr><td>المحكمة</td><td>{{dossier_court}}</td></tr>
  <tr><td>المدعي</td><td>{{applicant_name}}</td></tr>
  <tr><td>المدعى عليه</td><td>{{opponent_name}}</td></tr>
</table>

<h4>الحاضرون</h4>
<p style="white-space:pre-line;border:1px solid #ddd;padding:10px;background:#f9f9f9;">{{field.constat_attendees}}</p>

<h4>الوقائع المعاينة</h4>
<p style="white-space:pre-line;border:1px solid #ddd;padding:10px;background:#f9f9f9;">{{field.constat_facts}}</p>

<h4>المرفقات</h4>
<p style="white-space:pre-line;">{{field.constat_attachments}}</p>

<h4>عدد الصور المحصلة</h4>
<p>{{field.constat_photos}} صورة</p>

<h4>النتيجة والتراتيب</h4>
<p style="white-space:pre-line;border:1px solid #ddd;padding:10px;background:#f9f9f9;">{{field.constat_result}}</p>

<h4>ملاحظات</h4>
<p>{{procedure_notes}}</p>

<div class="sig">
  <div class="col"><div class="line"></div>أطراف المعاينة</div>
  <div class="col"><div class="line"></div>المفوض القضائي<br><span style="font-size:10px;">{{office_name}} — ختم المكتب</span></div>
</div>`);

    insertTemplate('PV de constat', 'CONSTATATIONS', constatType ? constatType.id : null, 'fr', `
<h2>PV de constat</h2>
<p style="text-align:center;color:#555;">Fait le {{today_date}} — Cabinet : {{office_name}}</p>

<h4>Identification du cabinet</h4>
<table class="kv">
  <tr><td>Huissier de justice</td><td>{{commissioner_name}}</td></tr>
  <tr><td>Nom du cabinet</td><td>{{office_name}}</td></tr>
  <tr><td>Adresse</td><td>{{office_address}}</td></tr>
  <tr><td>N° d'immatriculation</td><td>{{office_registration_number}}</td></tr>
</table>

<h4>Objet du constat</h4>
<table class="kv">
  <tr><td>N° procédure</td><td>{{procedure_number}}</td></tr>
  <tr><td>Objet</td><td>{{field.constat_object}}</td></tr>
  <tr><td>Date</td><td>{{field.constat_date}}</td></tr>
  <tr><td>Lieu</td><td>{{field.constat_place}}</td></tr>
</table>

<h4>Référence du dossier</h4>
<table class="kv">
  <tr><td>N° dossier</td><td>{{dossier_number}}</td></tr>
  <tr><td>Tribunal</td><td>{{dossier_court}}</td></tr>
  <tr><td>Demandeur</td><td>{{applicant_name}}</td></tr>
  <tr><td>Défendeur</td><td>{{opponent_name}}</td></tr>
</table>

<h4>Personnes présentes</h4>
<p style="white-space:pre-line;border:1px solid #ddd;padding:10px;background:#f9f9f9;">{{field.constat_attendees}}</p>

<h4>Faits constatés</h4>
<p style="white-space:pre-line;border:1px solid #ddd;padding:10px;background:#f9f9f9;">{{field.constat_facts}}</p>

<h4>Pièces jointes</h4>
<p style="white-space:pre-line;">{{field.constat_attachments}}</p>

<h4>Nombre de photos</h4>
<p>{{field.constat_photos}} photos</p>

<h4>Résultat et dispositions</h4>
<p style="white-space:pre-line;border:1px solid #ddd;padding:10px;background:#f9f9f9;">{{field.constat_result}}</p>

<h4>Observations</h4>
<p>{{procedure_notes}}</p>

<div class="sig">
  <div class="col"><div class="line"></div>Parties au constat</div>
  <div class="col"><div class="line"></div>Huissier de justice<br><span style="font-size:10px;">{{office_name}} — Sceau du cabinet</span></div>
</div>`);

    /* ======================== 8. العرض العيني ======================== */
    insertTemplate('محضر عرض عيني', 'OFFRE_REELLE', offreType ? offreType.id : null, 'ar', `
<h2>محضر عرض عيني</h2>
<p style="text-align:center;color:#555;">المؤرخ في {{today_date}} — المكتب: {{office_name}}</p>

<h4>بيانات المكتب</h4>
<table class="kv">
  <tr><td>المفوض القضائي</td><td>{{commissioner_name}}</td></tr>
  <tr><td>اسم المكتب</td><td>{{office_name}}</td></tr>
  <tr><td>العنوان</td><td>{{office_address}}</td></tr>
  <tr><td>رقم الترسيم</td><td>{{office_registration_number}}</td></tr>
</table>

<h4>بيانات العرض</h4>
<table class="kv">
  <tr><td>رقم الإجراء</td><td>{{procedure_number}}</td></tr>
  <tr><td>المبلغ المعروض</td><td>{{field.offered_amount}} {{procedure_currency}}</td></tr>
  <tr><td>تاريخ العرض</td><td>{{field.offer_date}}</td></tr>
  <tr><td>سبب العرض</td><td>{{field.offer_purpose}}</td></tr>
</table>

<h4>بيانات الملف</h4>
<table class="kv">
  <tr><td>رقم الملف</td><td>{{dossier_number}}</td></tr>
  <tr><td>المحكمة</td><td>{{dossier_court}}</td></tr>
</table>

<h4>أطراف العرض</h4>
<table class="kv">
  <tr><td>المدين المعروض</td><td>{{field.offer_debtor}}</td></tr>
  <tr><td>دائن المبلغ</td><td>{{field.offer_creditor}}</td></tr>
</table>

<h4>الشهود</h4>
<p>{{field.offer_witnesses}}</p>

<h4>موقف الدائن من العرض</h4>
<table class="kv">
  <tr><td>النتيجة</td><td>{{field.offer_acceptance}}</td></tr>
</table>

<h4>ملاحظات</h4>
<p>{{procedure_notes}}</p>

<div class="sig">
  <div class="col"><div class="line"></div>المدين المعروض</div>
  <div class="col"><div class="line"></div>المفوض القضائي<br><span style="font-size:10px;">{{office_name}} — ختم المكتب</span></div>
</div>`);

    insertTemplate("PV d'offre réelle", 'OFFRE_REELLE', offreType ? offreType.id : null, 'fr', `
<h2>PV d'offre réelle</h2>
<p style="text-align:center;color:#555;">Fait le {{today_date}} — Cabinet : {{office_name}}</p>

<h4>Identification du cabinet</h4>
<table class="kv">
  <tr><td>Huissier de justice</td><td>{{commissioner_name}}</td></tr>
  <tr><td>Nom du cabinet</td><td>{{office_name}}</td></tr>
  <tr><td>Adresse</td><td>{{office_address}}</td></tr>
  <tr><td>N° d'immatriculation</td><td>{{office_registration_number}}</td></tr>
</table>

<h4>Détails de l'offre</h4>
<table class="kv">
  <tr><td>N° procédure</td><td>{{procedure_number}}</td></tr>
  <tr><td>Montant offert</td><td>{{field.offered_amount}} {{procedure_currency}}</td></tr>
  <tr><td>Date</td><td>{{field.offer_date}}</td></tr>
  <tr><td>Motif</td><td>{{field.offer_purpose}}</td></tr>
</table>

<h4>Référence du dossier</h4>
<table class="kv">
  <tr><td>N° dossier</td><td>{{dossier_number}}</td></tr>
  <tr><td>Tribunal</td><td>{{dossier_court}}</td></tr>
</table>

<h4>Parties</h4>
<table class="kv">
  <tr><td>Débiteur offrant</td><td>{{field.offer_debtor}}</td></tr>
  <tr><td>Créancier</td><td>{{field.offer_creditor}}</td></tr>
</table>

<h4>Témoins</h4>
<p>{{field.offer_witnesses}}</p>

<h4>Réponse du créancier</h4>
<table class="kv">
  <tr><td>Décision</td><td>{{field.offer_acceptance}}</td></tr>
</table>

<h4>Observations</h4>
<p>{{procedure_notes}}</p>

<div class="sig">
  <div class="col"><div class="line"></div>Débiteur offrant</div>
  <div class="col"><div class="line"></div>Huissier de justice<br><span style="font-size:10px;">{{office_name}} — Sceau du cabinet</span></div>
</div>`);
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
function seedDocumentTypes({ get, run, tx }) {
  const count = get('SELECT COUNT(*) AS c FROM document_types').c;
  if (count > 0) return;

  return tx(() => {
    const types = [
      ['PV', 'محضر', 'Procès-verbal', 'محضر قضائي أو إداري', 'Procès-verbal judiciaire ou administratif', 'fa-file-signature', 1],
      ['RECEIPT', 'وصل', 'Reçu', 'وصل أداء', 'Reçu de paiement', 'fa-receipt', 2],
      ['NOTIFICATION', 'تبليغ', 'Signification', 'وثيقة تبليغ', 'Document de signification', 'fa-bell', 3],
      ['JUDGMENT', 'حكم', 'Jugement', 'حكم قضائي', 'Jugement judiciaire', 'fa-gavel', 4],
      ['CONTRACT', 'عقد', 'Contrat', 'عقد أو اتفاقية', 'Contrat ou convention', 'fa-file-contract', 5],
      ['CORRESPONDENCE', 'مراسلة', 'Correspondance', 'مراسلة رسمية', 'Correspondance officielle', 'fa-envelope', 6],
      ['REPORT', 'تقرير', 'Rapport', 'تقرير أو معاينة', 'Rapport ou constat', 'fa-file-lines', 7],
      ['OTHER', 'أخرى', 'Autre', 'وثيقة أخرى', 'Autre document', 'fa-file', 99]
    ];
    types.forEach(([code, ar, fr, descAr, descFr, icon, order]) => {
      run(
        `INSERT INTO document_types (code, name_ar, name_fr, description_ar, description_fr, icon, numbering_pattern, active, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, '{type}-{year}-{seq:000000}', 1, ?)`,
        [code, ar, fr, descAr, descFr, icon, order]
      );
    });
  });
}

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

/* ================================================================
   مراحل تدفق العمل (Workflow Stages) — 8 مراحل لكل نوع إجراء
   تُضاف عند أول تشغيل فقط (idempotent).
   ================================================================ */
function seedWorkflowStages({ get, all, run, tx }) {
  const count = get('SELECT COUNT(*) AS c FROM workflow_stages').c;
  if (count > 0) return;

  const allTypes = all('SELECT id, code FROM procedure_types');
  if (!allTypes) return;

  const stages = [
    { code: 'RECEPTION',      ar: 'الاستقبال',         fr: 'Réception',           descAr: 'إنشاء الملف والعميل والأطراف وربطهم',                                  descFr: 'Créer le dossier, client et parties',                                   artifacts: '[]',                    actions: '[]' },
    { code: 'TYPE_SELECTION', ar: 'تحديد النوع',       fr: 'Choix du type',       descAr: 'اختيار نوع الإجراء مع الحقول المهنية الخاصة به',                        descFr: 'Choisir le type avec les champs professionnels',                        artifacts: '[]',                    actions: '[]' },
    { code: 'EXECUTION',      ar: 'الإنجاز',           fr: 'Exécution',           descAr: 'تنفيذ الإجراء وفق المراحل الخاصة بالنوع',                               descFr: 'Exécuter la procédure selon le type',                                  artifacts: '[]',                    actions: '[]' },
    { code: 'DOCUMENTATION',  ar: 'التوثيق',           fr: 'Documentation',       descAr: 'إنشاء المحضر المناسب مع تعبئة المتغيرات الحقيقية',                     descFr: 'Créer le PV avec les variables réelles',                               artifacts: '["PV"]',                actions: '["auto_create_pv"]' },
    { code: 'FINALIZATION',   ar: 'الإنهاء',           fr: 'Finalisation',        descAr: 'إنهاء المحضر وتوليد النسخ النهائية وربطها بالإجراء',                     descFr: 'Finaliser le PV et générer les copies',                                artifacts: '["PV_FINAL"]',          actions: '["finalize_pv","generate_copies"]' },
    { code: 'BILLING',        ar: 'الحساب',            fr: 'Facturation',         descAr: 'إنشاء التقييم واحساب التعريفة وتسجيل الأداء والوصل',                    descFr: 'Créer l\'évaluation, calculer les frais, enregistrer le paiement',     artifacts: '["ASSESSMENT","RECEIPT"]', actions: '["create_assessment"]' },
    { code: 'REGISTER',       ar: 'السجل',             fr: 'Registre',            descAr: 'إنشاء القيد المهني المناسب أوتوماتيكياً ومراجعته',                     descFr: 'Créer l\'enregistrement professionnel automatiquement',                 artifacts: '[]',                    actions: '["auto_register_entry"]' },
    { code: 'ARCHIVE',        ar: 'الأرشيف',           fr: 'Archivage',           descAr: 'حفظ الوثيقة النهائية وربطها بالنسخ والمرفقات والفترة',                  descFr: 'Archiver le document final avec copies et période',                     artifacts: '["ARCHIVE"]',           actions: '["auto_archive"]' }
  ];

  return tx(() => {
    allTypes.forEach((t) => {
      stages.forEach((s, i) => {
        run(
          `INSERT INTO workflow_stages (procedure_type_id, code, name_ar, name_fr, description_ar, description_fr, sort_order, required_artifacts, auto_actions, active)
           VALUES (?,?,?,?,?,?,?,?,?,1)`,
          [t.id, s.code, s.ar, s.fr, s.descAr, s.descFr, i + 1, s.artifacts, s.actions]
        );
      });
    });
  });
}

module.exports = { seedIfEmpty, seedTemplateLibrary, seedPvConfig, seedPaymentMethods, seedRegisters, seedDocumentTypes, seedWorkflowStages };