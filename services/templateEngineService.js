'use strict';

/* ================================================================
   TemplateEngineService — محرك النماذج (Template Engine).
   نقي: بلا اعتماد على Electron ولا على قاعدة البيانات (يصله
   السياق جاهزاً)، قابل للاختبار وحده.

   المتغيرات على صيغة {{var}} أو {{field.key}} تُستبدل بالبيانات
   الحقيقية من الملف + الأطراف + الإجراء + الإعدادات.
   ================================================================ */

/* ---------- معجم المتغيرات (للإدراج في المحرر) ---------- */
const VARIABLES = [
  { key: 'commissioner_name', group: 'office', labelAr: 'اسم المفوض القضائي', labelFr: 'Nom de l’huissier' },
  { key: 'office_name', group: 'office', labelAr: 'اسم المكتب', labelFr: 'Nom du cabinet' },
  { key: 'office_address', group: 'office', labelAr: 'عنوان المكتب', labelFr: 'Adresse du cabinet' },
  { key: 'office_phone', group: 'office', labelAr: 'هاتف المكتب', labelFr: 'Téléphone du cabinet' },
  { key: 'office_registration_number', group: 'office', labelAr: 'رقم الترسيم', labelFr: "N° d'habilitation" },
  { key: 'today_date', group: 'misc', labelAr: 'تاريخ اليوم', labelFr: 'Date du jour' },
  { key: 'now_datetime', group: 'misc', labelAr: 'التاريخ والوقت', labelFr: 'Date et heure' },
  { key: 'dossier_number', group: 'dossier', labelAr: 'رقم الملف', labelFr: 'N° dossier' },
  { key: 'dossier_court', group: 'dossier', labelAr: 'المحكمة', labelFr: 'Tribunal' },
  { key: 'dossier_type', group: 'dossier', labelAr: 'نوع الملف', labelFr: 'Type de dossier' },
  { key: 'dossier_notes', group: 'dossier', labelAr: 'ملاحظات الملف', labelFr: 'Notes du dossier' },
  { key: 'applicant_name', group: 'dossier', labelAr: 'المدعي', labelFr: 'Demandeur' },
  { key: 'opponent_name', group: 'dossier', labelAr: 'المدعى عليه', labelFr: 'Défendeur' },
  { key: 'party_name', group: 'party', labelAr: 'اسم الطرف', labelFr: 'Nom de la partie' },
  { key: 'party_cin', group: 'party', labelAr: 'CIN الطرف', labelFr: 'CIN de la partie' },
  { key: 'party_address', group: 'party', labelAr: 'عنوان الطرف', labelFr: 'Adresse de la partie' },
  { key: 'party_phone', group: 'party', labelAr: 'هاتف الطرف', labelFr: 'Téléphone de la partie' },
  { key: 'party_email', group: 'party', labelAr: 'بريد الطرف', labelFr: 'Email de la partie' },
  { key: 'procedure_number', group: 'procedure', labelAr: 'رقم الإجراء', labelFr: 'N° procédure' },
  { key: 'procedure_date', group: 'procedure', labelAr: 'تاريخ الإجراء', labelFr: 'Date de la procédure' },
  { key: 'procedure_type', group: 'procedure', labelAr: 'نوع الإجراء', labelFr: 'Type de procédure' },
  { key: 'procedure_category', group: 'procedure', labelAr: 'تصنيف الإجراء', labelFr: 'Catégorie de procédure' },
  { key: 'procedure_status', group: 'procedure', labelAr: 'حالة الإجراء', labelFr: 'Statut de la procédure' },
  { key: 'procedure_amount', group: 'procedure', labelAr: 'المبلغ', labelFr: 'Montant' },
  { key: 'procedure_currency', group: 'procedure', labelAr: 'العملة', labelFr: 'Devise' },
  { key: 'procedure_notes', group: 'procedure', labelAr: 'ملاحظات الإجراء', labelFr: 'Notes de la procédure' },
  { key: 'notes', group: 'procedure', labelAr: 'ملاحظات إضافية', labelFr: 'Notes supplémentaires' },
  { key: 'payment_amount', group: 'payment', labelAr: 'مبلغ الأداء', labelFr: 'Montant du paiement' },
  { key: 'payment_method', group: 'payment', labelAr: 'طريقة الأداء', labelFr: 'Méthode de paiement' },
  { key: 'payment_date', group: 'payment', labelAr: 'تاريخ الأداء', labelFr: 'Date du paiement' },
  { key: 'payment_reference', group: 'payment', labelAr: 'مرجع الأداء', labelFr: 'Référence du paiement' },
  { key: 'field.', group: 'field', labelAr: 'حقل ديناميكي (field.المفتاح)', labelFr: 'Champ dynamique (field.clé)' },
  { key: 'pv_number', group: 'pv', labelAr: 'رقم المحضر', labelFr: 'N° procès-verbal' },
  { key: 'pv_title', group: 'pv', labelAr: 'عنوان المحضر', labelFr: 'Titre du PV' },
  { key: 'pv_type', group: 'pv', labelAr: 'نوع المحضر', labelFr: 'Type de PV' },
  { key: 'pv_status', group: 'pv', labelAr: 'حالة المحضر', labelFr: 'Statut du PV' },
  { key: 'pv_notes', group: 'pv', labelAr: 'ملاحظات المحضر', labelFr: 'Notes du PV' },
  { key: 'pv_created_date', group: 'pv', labelAr: 'تاريخ إنشاء المحضر', labelFr: 'Date de création du PV' }
];

const GROUPS = {
  office: { ar: 'المكتب والمفوض', fr: 'Cabinet et huissier' },
  dossier: { ar: 'الملف', fr: 'Dossier' },
  party: { ar: 'الأطراف', fr: 'Parties' },
  procedure: { ar: 'الإجراء', fr: 'Procédure' },
  payment: { ar: 'الأداء', fr: 'Paiement' },
  field: { ar: 'الحقول الديناميكية', fr: 'Champs dynamiques' },
  pv: { ar: 'المحضر', fr: 'Procès-verbal' },
  misc: { ar: 'أخرى', fr: 'Divers' }
};

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

function extractVariables(content) {
  const vars = [];
  const re = new RegExp(PLACEHOLDER_RE.source, 'g');
  let m;
  while ((m = re.exec(content || '')) !== null) {
    if (!vars.includes(m[1])) vars.push(m[1]);
  }
  return vars;
}

/* ---------- تنسيق الأرقام والتواريخ حسب اللغة ---------- */
function toFixedAmount(n, currency, lang) {
  const v = Number(n || 0);
  try {
    return new Intl.NumberFormat(lang === 'fr' ? 'fr-MA' : 'ar-MA', {
      minimumFractionDigits: 2, maximumFractionDigits: 2
    }).format(v) + (currency ? ' ' + currency : '');
  } catch (e) {
    return v.toFixed(2) + (currency ? ' ' + currency : '');
  }
}

function fmtDate(d, lang) {
  if (!d) return '';
  const date = new Date(d);
  if (isNaN(date.getTime())) return d;
  try {
    return date.toLocaleDateString(lang === 'fr' ? 'fr-MA' : 'ar-MA', { year: 'numeric', month: '2-digit', day: '2-digit' });
  } catch (e) {
    return date.toISOString().slice(0, 10);
  }
}

/* ---------- بناء سياق القيم من بيانات حقيقية ---------- */
function buildContext(detail, opts = {}) {
  const lang = opts.lang === 'fr' ? 'fr' : 'ar';
  const d = (detail && detail.dossier) || {};
  const party = (detail && detail.parties && detail.parties[0]) || null;
  const office = opts.office || {};
  const user = opts.user || {};
  const payment = opts.payment || null;
  const now = new Date();

  const ctx = {
    commissioner_name: String(office.commissioner || user.display_name || user.username || ''),

    office_name: String(office.name || ''),
    office_address: String(office.address || ''),
    office_phone: String(office.phone || ''),
    office_registration_number: String(office.registration_number || ''),

    today_date: fmtDate(now, lang),
    now_datetime: fmtDate(now, lang) + ' ' + now.toTimeString().slice(0, 8),

    dossier_number: String(d.numero || ''),
    dossier_court: String(d.court || ''),
    dossier_type: String(d.type || ''),
    dossier_notes: String(d.notes || ''),
    applicant_name: String(d.demandeur || ''),
    opponent_name: String(d.defendeur || ''),

    party_name: String((party && (party.name || d.demandeur)) || ''),
    party_cin: String((party && party.cin) || ''),
    party_address: String((party && party.address) || ''),
    party_phone: String((party && party.phone) || ''),
    party_email: String((party && party.email) || ''),

    procedure_number: String((detail && detail.procedure_number) || ''),
    procedure_date: fmtDate(detail && detail.created_at, lang),
    procedure_type: String((detail && detail.type && (lang === 'ar' ? detail.type.name_ar : detail.type.name_fr)) || ''),
    procedure_category: String((detail && detail.category && (lang === 'ar' ? detail.category.name_ar : detail.category.name_fr)) || ''),
    procedure_status: String((detail && detail.status) || ''),
    procedure_amount: detail && detail.amount ? toFixedAmount(detail.amount, detail.currency, lang) : '',
    procedure_currency: String((detail && detail.currency) || ''),
    procedure_notes: String((detail && detail.notes) || ''),
    notes: String((opts.notes != null ? opts.notes : (detail && detail.notes)) || ''),

    payment_amount: payment ? toFixedAmount(payment.amount, detail && detail.currency, lang) : '',
    payment_method: String((payment && payment.method) || ''),
    payment_date: payment ? fmtDate(payment.payment_date, lang) : '',
    payment_reference: String((payment && payment.reference) || '')
  };

  // الحقول الديناميكية: {{field.key}} من قيم الإجراء
  const fieldMap = {};
  (detail && detail.fieldValues || []).forEach((f) => {
    fieldMap[f.field_key] = f.value == null ? '' : String(f.value);
  });
  ctx._fields = fieldMap;

  // قيم إضافية (مثل متغيرات المحضر) تُمرر من الخدمة الطالبة
  if (opts.extra && typeof opts.extra === 'object') {
    Object.keys(opts.extra).forEach((k) => {
      ctx[k] = opts.extra[k] == null ? '' : String(opts.extra[k]);
    });
  }

  return ctx;
}

/* ---------- تعقيم قيمة متغير قبل إدراجها في HTML ---------- */
function escapeHtml(v) {
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ---------- استبدال المتغيرات في المحتوى ---------- */
function resolveContent(content, context = {}, opts = {}) {
  const strict = opts.strict === true;
  return String(content || '').replace(PLACEHOLDER_RE, (whole, name) => {
    let val;
    if (name.startsWith('field.')) {
      const key = name.slice(6);
      val = context._fields && context._fields[key];
    } else {
      val = context[name];
    }
    if (val === undefined || val === null) {
      return strict ? whole : '';
    }
    return escapeHtml(val);
  });
}

/* ---------- صفحة HTML كاملة جاهزة للطباعة ---------- */
function renderHtml(title, resolvedContent, lang) {
  return require('./templates').docShell(title, `<div class="tpl-content">${resolvedContent}</div>`, lang);
}

module.exports = {
  VARIABLES,
  GROUPS,
  extractVariables,
  buildContext,
  resolveContent,
  renderHtml,
  fmtDate,
  toFixedAmount,
  escapeHtml
};
