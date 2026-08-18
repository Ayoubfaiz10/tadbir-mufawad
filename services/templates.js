'use strict';

/* ================================================================
   Templates — بناء HTML النماذج (محضر/وصل) بدون أي اعتماد على
   Electron، قابل للاختبار وحده.
   ================================================================ */

function kvRow(k, v) {
  return `<tr><td class="k">${k}</td><td class="v">${(v === undefined || v === null || v === '') ? '—' : v}</td></tr>`;
}

function docShell(title, bodyHtml, lang) {
  const ar = lang === 'ar';
  const dir = ar ? 'rtl' : 'ltr';
  return `<!DOCTYPE html><html lang="${ar ? 'ar' : 'fr'}" dir="${dir}"><head><meta charset="utf-8"><style>
    @page { size: A4; margin: 18mm 16mm; }
    * { box-sizing: border-box; }
    body { font-family: "Inter","Noto Kufi Arabic","Segoe UI",sans-serif; color:#1c2431; font-size:13px; line-height:1.55; }
    .head { display:flex; justify-content:space-between; align-items:center; border-bottom:2px solid #1f4e8c; padding-bottom:10px; margin-bottom:16px; }
    .head .brand { font-size:15px; font-weight:800; color:#1f4e8c; }
    .head .meta { font-size:11px; color:#4a5568; text-align:${ar ? 'left' : 'right'}; }
    .doctitle { text-align:center; font-size:16px; font-weight:800; margin:6px 0 4px; }
    .docref { text-align:center; font-size:11px; color:#4a5568; margin-bottom:18px; }
    h4 { font-size:12px; text-transform:uppercase; letter-spacing:.03em; color:#1f4e8c; margin:14px 0 6px; border-bottom:1px solid #e2e7f0; padding-bottom:4px; }
    table.kv { width:100%; border-collapse:collapse; }
    table.kv td { padding:4px 6px; }
    table.kv .k { color:#4a5568; width:38%; vertical-align:top; }
    table.kv .v { font-weight:600; }
    .sig { display:flex; justify-content:space-between; margin-top:48px; }
    .sig .col { width:45%; }
    .sig .line { margin-top:34px; border-bottom:1px solid #1c2431; }
    .stamp { text-align:center; font-size:10px; color:#8593a7; margin-top:30px; }
    .tpl-content table { width:100%; border-collapse:collapse; margin:8px 0; }
    .tpl-content table, .tpl-content th, .tpl-content td { border:1px solid #c6cfdc; }
    .tpl-content th, .tpl-content td { padding:6px 8px; font-size:12px; }
    .tpl-content h1 { font-size:18px; } .tpl-content h2 { font-size:15px; }
    .tpl-content h3 { font-size:13.5px; } .tpl-content h4 { font-size:12.5px; }
    .tpl-content p { margin:6px 0; } .tpl-content { margin-top:4px; }
    .footer { margin-top:24px; border-top:1px solid #e2e7f0; padding-top:8px; font-size:10px; color:#8593a7; text-align:center; }
  </style></head><body>
    <div class="head">
      <div class="brand">${ar ? 'مكتب المفوض القضائي' : 'Cabinet de l\'Huissier de Justice'}</div>
      <div class="meta">${ar ? 'المغرب' : 'Maroc'}<br>${ar ? 'واجهة تُولَّد آلياً' : 'Document généré automatiquement'}</div>
    </div>
    ${bodyHtml}
    <div class="footer">${ar ? 'وثيقة داخلية — تُولَّد من تطبيق تسيير المفوض القضائي. ليست قالباً قانونياً رسمياً.' : 'Document interne généré par l\'application de gestion. Template non officiel.'}</div>
  </body></html>`;
}

function buildPvBody(detail, templateTitle, lang, extra = {}) {
  const ar = lang === 'ar';
  const p = detail;
  const d = p.dossier || {};

  const fieldRows = (p.fieldValues || [])
    .filter((f) => f.value && String(f.value).trim() !== '')
    .map((f) => kvRow(ar ? f.label_ar : f.label_fr, f.value))
    .join('');

  const partyRows = (p.parties || [])
    .map((pa) => {
      const name = pa.name || (pa.link_role === 'demandeur' ? d.demandeur : pa.link_role === 'defendeur' ? d.defendeur : pa.name);
      return kvRow(ar ? 'الطرف' : 'Partie', `${name}${pa.cin ? ' — CIN: ' + pa.cin : ''}${pa.address ? '، ' + pa.address : ''}${pa.phone ? '، هاتف: ' + pa.phone : ''}`);
    })
    .join('');

  return `
    <div class="doctitle">${templateTitle}</div>
    <div class="docref">${ar ? 'رقم الإجراء' : 'N° de procédure'} : ${p.procedure_number} — ${ar ? 'المؤرخ في' : 'fait le'} ${p.created_at ? String(p.created_at).slice(0, 10) : ''}</div>

    <h4>${ar ? 'بيانات الملف' : 'Référence du dossier'}</h4>
    <table class="kv">
      ${kvRow(ar ? 'رقم الملف' : 'N° dossier', d.numero)}
      ${kvRow(ar ? 'المدعي' : 'Demandeur', d.demandeur)}
      ${kvRow(ar ? 'المدعى عليه' : 'Défendeur', d.defendeur)}
      ${kvRow(ar ? 'المحكمة' : 'Tribunal', d.court)}
    </table>

    <h4>${ar ? 'الأطراف' : 'Parties'}</h4>
    <table class="kv">${partyRows || (ar ? '<tr><td>لا توجد أطراف</td></tr>' : '<tr><td>Aucune partie</td></tr>')}</table>

    <h4>${ar ? 'معلومات الإجراء' : 'Informations sur la procédure'}</h4>
    <table class="kv">
      ${kvRow(ar ? 'نوع الإجراء' : 'Type', ar ? p.type.name_ar : p.type.name_fr)}
      ${kvRow(ar ? 'التصنيف' : 'Catégorie', ar ? p.category.name_ar : p.category.name_fr)}
      ${kvRow(ar ? 'المبلغ' : 'Montant', p.amount ? p.amount + ' ' + (p.currency || 'MAD') : '—')}
      ${fieldRows}
      ${extra && extra.notes ? kvRow(ar ? 'ملاحظات' : 'Notes', extra.notes) : ''}
    </table>

    <div class="sig">
      <div class="col"><div class="line"></div>${ar ? 'إمضاء' : 'Signature'}</div>
      <div class="col"><div class="line"></div>${ar ? 'الختم' : 'Cachet'}</div>
    </div>
  `;
}

function buildReceiptBody(procedure, payment, receiptNumber, lang) {
  const ar = lang === 'ar';
  return `
    <div class="doctitle">${ar ? 'وصل أداء' : 'Reçu de paiement'}</div>
    <div class="docref">${ar ? 'رقم الوصل' : 'N° de reçu'} : ${receiptNumber} — ${ar ? 'التاريخ' : 'Date'} : ${payment.payment_date || ''}</div>
    <table class="kv">
      ${kvRow(ar ? 'الإجراء' : 'Procédure', procedure.procedure_number)}
      ${kvRow(ar ? 'الملف' : 'Dossier', procedure.dossier ? procedure.dossier.numero : '')}
      ${kvRow(ar ? 'نوع الإجراء' : 'Type', ar ? procedure.type.name_ar : procedure.type.name_fr)}
      ${kvRow(ar ? 'المبلغ' : 'Montant', `${Number(payment.amount).toFixed(2)} ${procedure.currency || 'MAD'}`)}
      ${kvRow(ar ? 'طريقة الأداء' : 'Méthode', payment.method || '')}
      ${kvRow(ar ? 'مرجع الأداء' : 'Référence', payment.reference || '')}
    </table>
    <div class="stamp">${ar ? 'وصل يحرره المكتب في إطار تتبع الأداءات' : 'Reçu établi par le cabinet dans le suivi des paiements'}</div>
  `;
}

module.exports = { kvRow, docShell, buildPvBody, buildReceiptBody };
