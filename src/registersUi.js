/* ================================================================
   وحدة السجلات المهنية — RegistersModule
   السجل اليومي للإجراءات + السجل اليومي للعمليات الحسابية
   (المادة 37 من القانون 46.21): ترقيم تسلسلي، لا حذف، تصحيحات موثقة،
   فترات قابلة للإغلاق، تدقيق كامل، تصدير/طباعة/أرشفة.
   ================================================================ */

'use strict';

(function () {
  const {
    API, state, t, toast, escapeHtml, fmtDate, badge,
    modal, openModal, closeModal, field, goTo
  } = window.HuissierApp;

  const byId = (id) => document.getElementById(id);
  const esc = escapeHtml;
  const l = (ar, fr) => (state.lang === 'ar' ? ar : fr);

  /* رسائل خطأ الخادم المرمّزة → رسالة مألوفة */
  const REG_ERRORS = {
    'REGISTER:NO_ROWS': ['لا توجد قيود ضمن نطاق الفلترة الحالية في هذا السجل', "Aucune écriture dans la période ou les filtres actuels"],
    'ARCHIVE:NOT_INITIALIZED': ['لم يتم تحديد مجلد الأرشفة من الإعدادات', "Le dossier d'archivage n'est pas configuré dans les réglages"],
    'ARCHIVE:NO_ARCHIVE_APP': ['التطبيق الداخلي لفتح الأرشيف غير مثبت', "L'application d'ouverture des archives n'est pas installée"],
    'REGISTER:NO_DELETE': ['لا يمكن حذف قيود السجلات — القانون 46.21 يمنع الحذف', 'Les écritures des registres ne peuvent pas être supprimées'],
    'REGISTER:REASON_REQUIRED': ['السبب مطلوب لهذه العملية', 'Un motif est requis pour cette opération'],
    'REGISTER:PERIOD_NOT_ARCHIVED': ['أرشفِ الفترة أولاً قبل ختمها', 'Archivez d\'abord la période avant de la sceller'],
    'DOC:SEALED:NO_DELETE': ['وثيقة مختومة — لا يمكن حذفها', 'Document scellé — suppression impossible'],
    'DOC:SEALED:NO_MODIFY': ['وثيقة مختومة — لا يمكن تعديلها', 'Document scellé — modification impossible'],
    'ARCHIVE:SEAL_MANIFEST_INVALID': ['بيان الختم تالف أو غير صالح', 'Manifeste du scellé invalide']
  };
  function errText(e) {
    const msg = e && e.message ? e.message : String(e || '');
    const pair = REG_ERRORS[msg];
    return pair ? l(pair[0], pair[1]) : msg;
  }

  let cfg = { registers: [], settings: {} };
  let dash = null;
  let activeTab = 'daily';
  let permissions = { correct: false, config: false, audit: false, export: false, lock: false, seal: false };
  let authLoaded = false;

  const filters = {
    daily: { from: '', to: '', q: '', status: '', user: '', dossier: '', page: 1, pageSize: 25, rows: [], total: 0, register: null },
    accounting: { from: '', to: '', q: '', status: '', user: '', dossier: '', page: 1, pageSize: 25, rows: [], total: 0, register: null }
  };
  let correctionsPage = 1, correctionsTotal = 0;
  let auditPage = 1, auditTotal = 0;
  let auditRegisterId = null, periodsRegisterId = null;

  /* ---------- أدوات ---------- */
  function fmtAmount(n) {
    const v = Number(n || 0);
    try { return v.toLocaleString(state.lang === 'ar' ? 'ar-MA' : 'fr-MA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
    catch (e) { return String(v.toFixed(2)); }
  }

  function entryStatusBadge(s) {
    const colors = { ACTIVE: 'success', SUPERSEDED: 'info', CANCELLED: 'danger' };
    const labels = { ACTIVE: l('نشط', 'Actif'), SUPERSEDED: l('مستبدل', 'Remplacé'), CANCELLED: l('ملغى', 'Annulé') };
    return `<span class="badge st-${colors[s] || 'gray'}">${esc(labels[s] || s)}</span>`;
  }

  function flowBadge(s) {
    const colors = { income: 'success', refund: 'warning' };
    const labels = { income: l('إيراد', 'Recette'), refund: l('استرداد', 'Remboursement') };
    return `<span class="badge st-${colors[s] || 'gray'}">${esc(labels[s] || s)}</span>`;
  }

  function periodBadge(s) {
    const colors = { OPEN: 'success', REVIEW: 'warning', LOCKED: 'danger' };
    const labels = { OPEN: l('مفتوحة', 'Ouverte'), REVIEW: l('تحت المراجعة', 'En révision'), LOCKED: l('مقفلة', 'Vérouillée') };
    return `<span class="badge st-${colors[s] || 'gray'}">${esc(labels[s] || s)}</span>`;
  }

  function corrBadge(s) {
    const colors = { REQUESTED: 'warning', APPROVED: 'info', EXECUTED: 'success', REJECTED: 'danger' };
    const labels = { REQUESTED: l('طلب', 'Demande'), APPROVED: l('مقبول', 'Approuvée'), EXECUTED: l('منفذ', 'Exécutée'), REJECTED: l('مرفوض', 'Rejetée') };
    return `<span class="badge st-${colors[s] || 'gray'}">${esc(labels[s] || s)}</span>`;
  }

  function auditActionBadge(a) {
    const colors = { CREATE: 'success', UPDATE: 'info', CANCEL: 'danger', REQUEST_CORRECTION: 'warning', SUPERSEDE: 'info', CORRECT: 'warning', EXPORT: 'primary', CONFIGURE: 'primary', ARCHIVE: 'info' };
    const labels = { CREATE: l('إنشاء', 'Création'), UPDATE: l('تحديث', 'MàJ'), CANCEL: l('إلغاء', 'Annulation'), REQUEST_CORRECTION: l('طلب تصحيح', 'Correction'), SUPERSEDE: l('استبدال', 'Remplacé'), CORRECT: l('تصحيح', 'Correction'), EXPORT: l('تصدير', 'Export'), CONFIGURE: l('ضبط', 'Config'), ARCHIVE: l('أرشفة', 'Archive') };
    return `<span class="badge st-${colors[a] || 'gray'}">${esc(labels[a] || a)}</span>`;
  }

  async function loadPermissions() {
    if (authLoaded) return permissions;
    const check = async (a) => { try { return await API.authIsAuthorized(a); } catch (e) { return false; } };
    permissions.correct = await check('register.correct');
    permissions.config = await check('register.config');
    permissions.audit = await check('register.audit');
    permissions.export = await check('register.export');
    permissions.lock = await check('register.lock');
    permissions.seal = await check('archive.seal');
    authLoaded = true;
    return permissions;
  }

  /* ---------- لوحة ملخص السجلات ---------- */
  function renderStats() {
    const d = dash || {};
    const cards = [
      { icon: 'fa-list-check', accent: 'primary', v: d.todayProcedures, k: l('إجراءات اليوم', 'Procédures du jour') },
      { icon: 'fa-book-open', accent: 'info', v: d.todayEntries, k: l('قيدات اليوم', 'Écritures du jour') },
      { icon: 'fa-file-signature', accent: 'success', v: d.todayPvCount, k: l('محاضر اليوم', 'PV du jour') },
      { icon: 'fa-coins', accent: 'success', v: fmtAmount(d.todayIncome), k: l('منجز اليوم', 'Encaissé du jour') },
      { icon: 'fa-rotate-left', accent: 'warning', v: fmtAmount(d.todayRefunds), k: l('مسترد اليوم', 'Remboursé du jour') },
      { icon: 'fa-scale-balanced', accent: 'info', v: fmtAmount(d.todayNet), k: l('الصافي', 'Net') },
      { icon: 'fa-clock-rotate-left', accent: 'danger', v: d.incompleteProcedures || 0, k: l('إجراءات غير منجزة', 'Non exécutées') }
    ];
    byId('reg-stats').innerHTML = cards.map((c) => `
      <div class="stat-card" data-accent="${c.accent}">
        <div class="stat-icon"><i class="fas ${c.icon}"></i></div>
        <div class="stat-info"><span class="stat-value">${esc(c.v)}</span><span class="stat-label">${esc(c.k)}</span></div>
      </div>`).join('');
  }

  /* ---------- التبويبات ---------- */
  function bindTabs() {
    byId('reg-tabs').querySelectorAll('.fin-tab').forEach((btn) => {
      btn.onclick = () => {
        activeTab = btn.getAttribute('data-reg-tab');
        byId('reg-tabs').querySelectorAll('.fin-tab').forEach((b) => b.classList.toggle('active', b === btn));
        document.querySelectorAll('[id^="reg-panel-"]').forEach((p) => {
          p.classList.toggle('active', p.id === 'reg-panel-' + activeTab);
        });
        loadTab();
      };
    });
  }

  async function loadTab() {
    if (activeTab === 'daily') await loadEntries('daily');
    else if (activeTab === 'accounting') await loadEntries('accounting');
    else if (activeTab === 'corrections') await loadCorrections();
    else if (activeTab === 'periods') await loadPeriods();
    else if (activeTab === 'audit') await loadAudit();
    else if (activeTab === 'settings') { await loadPermissions(); await renderSettings(); }
  }

  /* ================================================================
     قوائم القيود (السجل اليومي / الحسابي)
     ================================================================ */
  function regOf(kind) {
    const k = kind === 'accounting' ? 'accounting' : 'daily';
    return (cfg.registers || []).find((r) => r.kind === k) || null;
  }

  async function loadEntries(kind) {
    const f = filters[kind];
    const reg = regOf(kind);
    if (!reg) { f.rows = []; f.total = 0; f.register = null; renderEntries(kind); return; }
    const res = await API.regEntries({
      registerId: reg.id, kind,
      page: f.page, pageSize: f.pageSize,
      from: f.from || undefined, to: f.to || undefined,
      status: f.status || undefined, user: f.user || undefined,
      dossier: f.dossier || undefined, q: f.q || undefined
    });
    f.rows = res.rows; f.total = res.total; f.register = res.register;
    renderEntries(kind);
  }

  function dailyRow(r) {
    return `<tr>
      <td><strong>${esc(r.serial_no)}</strong></td>
      <td nowrap>${esc(r.entry_date)}</td>
      <td><a href="#" class="link" data-reg-link="proc:${r.procedure_id || ''}">${esc(r.procedure_number || r.procedure_number_snapshot || '—')}</a></td>
      <td>${esc(r.dossier_number || '—')}</td>
      <td>${esc((state.lang === 'fr' ? (r.type_name_fr || r.type_name_ar) : (r.type_name_ar || r.type_name_fr)) || '—')}</td>
      <td title="${esc(r.parties_summary || '')}">${esc((r.parties_summary || '—').slice(0, 46))}</td>
      <td>${r.pv_id ? `<a href="#" class="link" data-reg-link="pv:${r.pv_id}">${esc(r.pv_number || '—')}</a>` : '—'}</td>
      <td>${entryStatusBadge(r.status)}</td>
      <td>${esc(r.created_by || '—')}</td>
      <td><div class="row-actions">
        <button class="row-btn" data-reg-view="${r.entry_id}" title="${l('تفاصيل', 'Détails')}"><i class="fas fa-eye"></i></button>
      </div></td>
    </tr>`;
  }

  function accountingRow(r) {
    return `<tr>
      <td><strong>${esc(r.serial_no)}</strong></td>
      <td nowrap>${esc(r.entry_date)}</td>
      <td>${flowBadge(r.flow_type)}</td>
      <td>${esc(r.reference || '—')}</td>
      <td><a href="#" class="link" data-reg-link="proc:${r.procedure_id || ''}">${esc(r.procedure_number || '—')}</a></td>
      <td>${esc(r.dossier_number || '—')}</td>
      <td>${fmtAmount(r.amount)} ${esc(r.currency || '')}</td>
      <td>${esc(r.receipt_number || r.rc_receipt_number || '—')}</td>
      <td>${entryStatusBadge(r.status)}</td>
      <td>${esc(r.created_by || '—')}</td>
      <td><div class="row-actions">
        <button class="row-btn" data-reg-view="${r.entry_id}" title="${l('تفاصيل', 'Détails')}"><i class="fas fa-eye"></i></button>
      </div></td>
    </tr>`;
  }

  function renderEntries(kind) {
    const acc = kind === 'accounting';
    const f = filters[kind];
    const heads = acc
      ? [l('الرقم التسلسلي', 'N° séq.'), l('التاريخ', 'Date'), l('العملية', 'Op.'), l('المرجع', 'Réf.'),
         l('الإجراء', 'Procédure'), l('الملف', 'Dossier'), l('المبلغ', 'Montant'), l('الوصل', 'Quittance'),
         l('الحالة', 'Statut'), l('المستخدم', 'Utilisateur'), '']
      : [l('الرقم التسلسلي', 'N° séq.'), l('التاريخ', 'Date'), l('الإجراء', 'Procédure'), l('الملف', 'Dossier'),
         l('النوع', 'Type'), l('الأطراف', 'Parties'), l('المحضر', 'PV'), l('الحالة', 'Statut'),
         l('المستخدم', 'Utilisateur'), ''];

    byId(acc ? 'reg-a-thead' : 'reg-d-thead').innerHTML =
      `<tr>${heads.map((h) => `<th>${h}</th>`).join('')}</tr>`;
    const tbody = byId(acc ? 'reg-a-tbody' : 'reg-d-tbody');
    tbody.innerHTML = f.rows.map(acc ? accountingRow : dailyRow).join('');

    const empty = byId(acc ? 'reg-a-empty' : 'reg-d-empty');
    empty.classList.toggle('hidden', f.rows.length > 0);

    const totalPages = Math.max(1, Math.ceil(f.total / f.pageSize));
    byId(acc ? 'reg-a-footer' : 'reg-d-footer').innerHTML = `
      <span>${esc(f.total)} ${l('قيد', 'écritures')}</span>
      <div class="toolbar-actions" style="margin:0">
        <button class="btn btn-ghost btn-sm" data-reg-page="${kind}:${f.page - 1}" ${f.page <= 1 ? 'disabled' : ''}><i class="fas fa-chevron-right"></i></button>
        <span class="page-ind">${f.page}/${totalPages}</span>
        <button class="btn btn-ghost btn-sm" data-reg-page="${kind}:${f.page + 1}" ${f.page >= totalPages ? 'disabled' : ''}><i class="fas fa-chevron-left"></i></button>
      </div>`;
  }

  /* ---------- فلاتر ---------- */
  function readFiltersFrom(kind) {
    const f = filters[kind];
    f.from = byId(kind === 'accounting' ? 'reg-a-from' : 'reg-d-from').value;
    f.to = byId(kind === 'accounting' ? 'reg-a-to' : 'reg-d-to').value;
    f.q = byId(kind === 'accounting' ? 'reg-a-q' : 'reg-d-q').value.trim();
    f.status = byId(kind === 'accounting' ? 'reg-a-status' : 'reg-d-status').value;
    f.user = byId(kind === 'accounting' ? 'reg-a-user' : 'reg-d-user').value.trim();
    f.dossier = byId(kind === 'accounting' ? 'reg-a-dossier' : 'reg-d-dossier').value.trim();
    f.page = 1;
  }

  function filtersPayload(kind) {
    const f = filters[kind];
    return {
      registerId: f.register ? f.register.id : (regOf(kind) || {}).id,
      kind, from: f.from, to: f.to, q: f.q, status: f.status, user: f.user, dossier: f.dossier, lang: state.lang
    };
  }

  async function exportKind(kind, api) {
    await loadPermissions();
    if (!permissions.export) { toast(l('ليست لديك صلاحية التصدير', 'No export permission'), true); return; }
    try {
      const res = await api(filtersPayload(kind));
      if (res && res.canceled) return;
      if (res && res.ok) toast(l('تم التصدير', 'Exporté'));
    } catch (e) {
      toast(errText(e), true);
    }
  }

  async function archivePeriodAction(kind) {
    await loadPermissions();
    if (!permissions.export) { toast(l('ليست لديك صلاحية الأرشفة', 'No archive permission'), true); return; }
    const f = filters[kind];
    const reg = f.register || regOf(kind);
    const from = f.from || new Date().toISOString().slice(0, 7) + '-01';
    const periodKey = from.slice(0, 7);
    if (!confirm(l('أرشفة فترة ' + periodKey + ' من السجل؟', 'Archive period ' + periodKey + ' ?'))) return;
    try {
      const res = await API.regArchivePeriod(reg.id, periodKey);
      toast(l('تمت الأرشفة: ' + res.filePath, 'Archived: ' + res.filePath));
    } catch (e) {
      toast(errText(e), true);
    }
  }

  /* ================================================================
     تفاصيل قيد
     ================================================================ */
  const fmtVal = (v) => (v == null || v === '' ? '—' : esc(String(v)));

  async function openEntry(id) {
    const e = await API.regEntryGet(id);
    const d = e.detail || {};
    const rowPairs = e.register.kind === 'daily'
      ? [['serial', esc(e.serial_no)], ['date', esc(e.entry_date)], ['procedure', esc(d.procedure_number)], ['dossier', esc(d.dossier_number)],
         ['type', esc(state.lang === 'fr' ? (d.type_name_fr || d.type_name_ar) : (d.type_name_ar || d.type_name_fr))], ['reference', esc(d.reference_number)], ['pv', esc(d.pv_number)],
         ['user', esc(e.created_by)], ['status', entryStatusBadge(e.status)],
         ...(e.reason ? [['reason', esc(d.reason || e.reason)]] : [])]
      : [['serial', esc(e.serial_no)], ['date', esc(e.entry_date)], ['reference', esc(d.reference)], ['procedure', esc(d.procedure_number)],
         ['dossier', esc(d.dossier_number)], ['amount', esc(fmtAmount(d.amount)) + ' ' + esc(d.currency || '')],
         ['receipt', esc(d.receipt_number || d.rc_receipt_number)], ['user', esc(e.created_by)],
         ['status', entryStatusBadge(e.status)], ...(e.reason ? [['reason', esc(e.reason)]] : [])];

    let html = `<div class="detail-grid">
      ${rowPairs.map(([k, v]) => `
        <div class="det-item"><span class="det-label">${esc(t('registers.entryProps.' + k) || k)}</span>
        <span class="det-value">${v}</span></div>`).join('')}`;

    if ((e.values || []).length) {
      html += `<div style="grid-column:1/-1" class="reg-values">
        <h4>${esc(l('البيانات', 'Données'))}</h4><ul>`;
      e.values.forEach((v) => { html += `<li><strong>${esc(v.field_key)}</strong>: ${fmtVal(v.value)}</li>`; });
      html += `</ul></div>`;
    }

    if ((e.audit || []).length) {
      html += `<div style="grid-column:1/-1" class="reg-values">
        <h4>${esc(l('سجل العمليات', 'Journal d\'opérations'))}</h4><ul>`;
      e.audit.slice().reverse().forEach((a) => {
        html += `<li>${auditActionBadge(a.action)} <span class="muted">${esc(a.created_by || '')} — ${esc(a.created_at || '')}</span>
          ${a.reason ? `<p class="muted" style="margin:2px 0">${esc(a.reason)}</p>` : ''}</li>`;
      });
      html += `</ul></div>`;
    }

    if ((e.corrections || []).length) {
      html += `<div style="grid-column:1/-1" class="reg-values">
        <h4>${esc(l('التصحيحات', 'Corrections'))}</h4><ul>`;
      e.corrections.forEach((c) => {
        html += `<li>#${esc(c.id)} ${corrBadge(c.status)} <span class="muted">${esc(c.requested_by || '')}</span>
          <p class="muted" style="margin:2px 0">${esc(c.reason || '')}</p></li>`;
      });
      html += `</ul></div>`;
    }
    html += `</div>`;

    if (e.period && e.period.status === 'LOCKED') {
      html += `<div class="data-note" style="margin-top:12px"><i class="fas fa-lock"></i>
        <div><strong>${esc(l('فترة مقفلة', 'Période vérouillée'))}</strong>
        <p>${esc(e.period.period_key)}</p></div></div>`;
    }

    modal.title.textContent = `${esc(t('nav.registers'))} — ${esc(e.serial_no)}`;
    modal.body.innerHTML = html;
    modal.footer.innerHTML = `
      <button class="btn btn-ghost" data-modal-cancel>${esc(l('إغلاق', 'Fermer'))}</button>
      ${permissions.correct ? `<button class="btn btn-ghost" data-reg-edit-cancel>${esc(l('إلغاء القيد', 'Annuler'))}</button>` : ''}
      ${e.status === 'ACTIVE' ? `<button class="btn btn-primary" data-reg-edit-corr>${esc(l('طلب تصحيح', 'Demander correction'))}</button>` : ''}`;
    openModal();

    modal.footer.querySelector('[data-modal-cancel]').addEventListener('click', closeModal);
    const corrBtn = modal.footer.querySelector('[data-reg-edit-corr]');
    if (corrBtn) corrBtn.addEventListener('click', () => { closeModal(); openCorrectionModal(e.id); });
    const canBtn = modal.footer.querySelector('[data-reg-edit-cancel]');
    if (canBtn) canBtn.addEventListener('click', () => { closeModal(); openCancelModal(e.id); });
  }

  /* ---------- نافذة طلب نصي (سبب/ملاحظة) ---------- */
  function askText(title, label, secret, cb) {
    modal.title.textContent = title;
    modal.body.innerHTML = `
      <div class="form-grid" style="grid-template-columns:1fr">
        <div class="form-field"><span>${esc(label)}</span>
          ${secret ? `<textarea class="form-input" id="ask-text" rows="3"></textarea>` : `<input class="form-input" id="ask-text" type="text">`}
        </div>
      </div>`;
    modal.footer.innerHTML = `
      <button class="btn btn-ghost" data-modal-cancel>${esc(l('إلغاء', 'Annuler'))}</button>
      <button class="btn btn-primary" data-modal-ok>${esc(l('تأكيد', 'Confirmer'))}</button>`;
    openModal();
    modal.footer.querySelector('[data-modal-cancel]').addEventListener('click', closeModal);
    modal.footer.querySelector('[data-modal-ok]').addEventListener('click', async () => {
      const v = byId('ask-text').value.trim();
      if (!v) { toast(l('هذا الحقل مطلوب', 'Required'), true); return; }
      closeModal();
      await cb(v);
    });
  }

  function openCorrectionModal(id) {
    askText(l('طلب تصحيح القيد', 'Demande de correction'), l('سبب التصحيح', 'Motif'), true, async (reason) => {
      try {
        await API.regCorrectionRequest(id, reason);
        toast(l('أُرسل طلب التصحيح', 'Correction requested'));
        await reloadCurrent();
      } catch (e) { toast(errText(e), true); }
    });
  }

  function openCancelModal(id) {
    askText(l('إلغاء القيد', 'Annulation'), l('سبب الإلغاء (إلزامي)', 'Motif (obligatoire)'), true, async (reason) => {
      try {
        await API.regEntryCancel(id, reason);
        toast(l('أُلغي القيد', 'Annulé'));
        await reloadCurrent();
      } catch (e) { toast(errText(e), true); }
    });
  }

  async function reloadCurrent() {
    await loadDashboard();
    await loadTab();
  }

  /* ================================================================
     التصحيحات
     ================================================================ */
  async function loadCorrections() {
    const res = await API.regCorrections({ page: correctionsPage, pageSize: 25 });
    correctionsTotal = res.total;
    const heads = [l('المعرف', 'ID'), l('السجل', 'Registre'), l('القيد الأصلي', 'Écriture'), l('السبب', 'Motif'),
                   l('الطالب', 'Demandeur'), l('الحالة', 'Statut'), l('البديل', 'Remplacement'), l('ملاحظة المراجعة', 'Note'), ''];
    byId('reg-c-thead').innerHTML = `<tr>${heads.map((h) => `<th>${h}</th>`).join('')}</tr>`;
    byId('reg-c-tbody').innerHTML = res.rows.map((c) => `
      <tr>
        <td>#${esc(c.id)}</td>
        <td>${esc(c.register_ar || c.register_code)}</td>
        <td>${esc(c.original_serial)} <small class="muted">(${esc(c.original_date)})</small></td>
        <td title="${esc(c.reason)}">${esc((c.reason || '').slice(0, 60))}</td>
        <td>${esc(c.requested_by || '—')}</td>
        <td>${corrBadge(c.status)}</td>
        <td>${c.replacement_serial ? esc(c.replacement_serial) : '—'}</td>
        <td>${esc(c.review_note || '—')}</td>
        <td><div class="row-actions">
          <button class="row-btn" data-reg-corr-view="${c.original_entry_id}" title="${l('عرض', 'Voir')}"><i class="fas fa-eye"></i></button>
          ${permissions.correct && c.status === 'REQUESTED' ? `
            <button class="row-btn" data-reg-corr-approve="${c.id}" title="${l('قبول', 'Approuver')}"><i class="fas fa-check"></i></button>
            <button class="row-btn" data-reg-corr-reject="${c.id}" title="${l('رفض', 'Rejeter')}"><i class="fas fa-xmark"></i></button>` : ''}
        </div></td>
      </tr>`).join('');
    byId('reg-c-empty').style.display = res.rows.length ? 'none' : 'flex';
    const totalPages = Math.max(1, Math.ceil(correctionsTotal / 25));
    byId('reg-c-footer').innerHTML = `
      <span>${esc(correctionsTotal)}</span>
      <div class="toolbar-actions" style="margin:0">
        <button class="btn btn-ghost btn-sm" data-reg-corr-page="${correctionsPage - 1}" ${correctionsPage <= 1 ? 'disabled' : ''}><i class="fas fa-chevron-right"></i></button>
        <span class="page-ind">${correctionsPage}/${totalPages}</span>
        <button class="btn btn-ghost btn-sm" data-reg-corr-page="${correctionsPage + 1}" ${correctionsPage >= totalPages ? 'disabled' : ''}><i class="fas fa-chevron-left"></i></button>
      </div>`;
  }

  /* ================================================================
     الفترات
     ================================================================ */
  function fillRegisterSelects() {
    const opts = (cfg.registers || []).map((r) => `<option value="${r.id}">${esc(r.name_ar)}</option>`).join('');
    byId('reg-p-register').innerHTML = opts;
    byId('reg-u-register').innerHTML = opts;
  }

  async function loadPeriods() {
    const sel = byId('reg-p-register');
    if (!sel.value && cfg.registers && cfg.registers.length) sel.value = cfg.registers[0].id;
    const rid = Number(sel.value);
    if (!rid) return;
    const res = await API.regPeriods(rid);
    const heads = [l('الفترة', 'Période'), l('الحالة', 'Statut'), l('القيود', 'Écritures'), l('أُنشئت من طرف', 'Créée par'), l('الأرشيف', 'Archive'), ''];
    byId('reg-p-thead').innerHTML = `<tr>${heads.map((h) => `<th>${h}</th>`).join('')}</tr>`;
    byId('reg-p-tbody').innerHTML = res.length
      ? res.map((p) => `
        <tr>
          <td><strong>${esc(p.period_key)}</strong></td>
          <td>${periodBadge(p.status)}</td>
          <td>${esc(p.entries_count)}</td>
          <td>${esc(p.created_by || '—')}</td>
          <td>
            ${p.archived_documents_count ? `<span class="badge st-info">${esc(p.archived_documents_count)}</span>` : '—'}
            ${p.seal_id ? `<span class="badge st-danger" title="${l('مختومة في ' + (p.sealed_at || '') + ' بواسطة ' + (p.sealed_by || ''), 'Scellée le ' + (p.sealed_at || '') + ' par ' + (p.sealed_by || ''))}">${l('مختومة', 'Scellée')}</span>` : ''}
          </td>
          <td><div class="row-actions">
            ${permissions.lock ? `
              <button class="row-btn" data-reg-period="${rid}:${p.period_key}:REVIEW" ${p.status === 'REVIEW' ? 'disabled' : ''} title="${l('مراجعة', 'Révision')}"><i class="fas fa-eye"></i></button>
              <button class="row-btn" data-reg-period="${rid}:${p.period_key}:LOCKED" ${p.status === 'LOCKED' || p.status === 'OPEN' ? 'disabled' : ''} title="${l('إقفال', 'Verrouiller')}"><i class="fas fa-lock"></i></button>
              <button class="row-btn" data-reg-period="${rid}:${p.period_key}:OPEN" ${p.status === 'OPEN' ? 'disabled' : ''} title="${l('فتح', 'Ouvrir')}"><i class="fas fa-unlock"></i></button>` : ''}
            ${permissions.export ? `<button class="row-btn" data-reg-period-arch="${rid}:${p.period_key}" ${p.seal_id ? 'disabled' : ''} title="${l('أرشفة', 'Archiver')}"><i class="fas fa-box-archive"></i></button>` : ''}
            ${permissions.seal && !p.seal_id ? `
              <button class="row-btn" data-reg-seal="${rid}:${p.period_key}" ${p.archived_documents_count ? '' : 'disabled'} title="${l('ختم الفترة (Sceau)', 'Sceller la période')}"><i class="fas fa-stamp"></i></button>` : ''}
            ${permissions.seal && p.seal_id ? `
              <button class="row-btn" data-reg-verify="${p.seal_id}" title="${l('التحقق من السلامة', 'Vérifier l\'intégrité')}"><i class="fas fa-shield-halved"></i></button>` : ''}
          </div></td>
        </tr>`).join('')
      : '';
    byId('reg-p-empty').style.display = res.length ? 'none' : 'flex';
  }

  /* ================================================================
     التدقيق
     ================================================================ */
  async function loadAudit() {
    const sel = byId('reg-u-register');
    if (!sel.value && cfg.registers && cfg.registers.length) sel.value = cfg.registers[0].id;
    auditRegisterId = Number(sel.value) || null;
    const res = await API.regAudit({ registerId: auditRegisterId, page: auditPage, pageSize: 50 });
    auditTotal = res.total;
    const heads = [l('العملية', 'Action'), l('القيد', 'Écriture'), l('التاريخ', 'Date'), l('المستخدم', 'Utilisateur'), l('السبب', 'Motif')];
    byId('reg-u-thead').innerHTML = `<tr>${heads.map((h) => `<th>${h}</th>`).join('')}</tr>`;
    byId('reg-u-tbody').innerHTML = res.rows.map((a) => `
      <tr>
        <td>${auditActionBadge(a.action)}</td>
        <td>${a.entry_id ? `<a href="#" class="link" data-reg-link="entry:${a.entry_id}">${esc(a.serial_no || a.entry_id)}</a>` : '—'}</td>
        <td nowrap>${esc(a.created_at || '')}</td>
        <td>${esc(a.created_by || '—')}</td>
        <td>${esc((a.reason || '').slice(0, 80))}</td>
      </tr>`).join('');
    byId('reg-u-empty').style.display = res.rows.length ? 'none' : 'flex';
    const totalPages = Math.max(1, Math.ceil(auditTotal / 50));
    byId('reg-u-footer').innerHTML = `
      <span>${esc(auditTotal)}</span>
      <div class="toolbar-actions" style="margin:0">
        <button class="btn btn-ghost btn-sm" data-reg-audit-page="${auditPage - 1}" ${auditPage <= 1 ? 'disabled' : ''}><i class="fas fa-chevron-right"></i></button>
        <span class="page-ind">${auditPage}/${totalPages}</span>
        <button class="btn btn-ghost btn-sm" data-reg-audit-page="${auditPage + 1}" ${auditPage >= totalPages ? 'disabled' : ''}><i class="fas fa-chevron-left"></i></button>
      </div>`;
  }

  /* ================================================================
     البحث الشامل
     ================================================================ */
  let searchTimer = null;
  function bindSearch() {
    byId('reg-search-q').addEventListener('input', (e) => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => runSearch(e.target.value.trim()), 350);
    });
    byId('reg-search-clear').addEventListener('click', () => {
      byId('reg-search-q').value = '';
      runSearch('');
    });
  }

  async function runSearch(q) {
    const thead = byId('reg-search-thead');
    const tbody = byId('reg-search-tbody');
    const empty = byId('reg-search-empty');
    if (!q) {
      thead.innerHTML = '';
      tbody.innerHTML = '';
      empty.classList.remove('hidden');
      empty.innerHTML = `<i class="fas fa-magnifying-glass"></i><p>${esc(l('اكتب للبحث في السجلات.', 'Tapez pour rechercher.'))}</p>`;
      return;
    }
    const res = await API.regSearch(q);
    const has = res.daily.length || res.accounting.length;
    const rows = [];
    const share = (list, kind) => list.map((r) => kind === 'daily'
      ? `<tr>
          <td><span class="badge st-primary">${esc(l('يومي', 'Journal'))}</span></td>
          <td><strong>${esc(r.serial_no)}</strong></td>
          <td nowrap>${esc(r.entry_date)}</td>
          <td>${esc(r.procedure_number || '—')}</td>
          <td>${esc(r.dossier_number || '—')}</td>
          <td>${esc((r.parties_summary || '').slice(0, 50))}</td>
          <td>${entryStatusBadge(r.status)}</td>
          <td><button class="row-btn" data-reg-view="${r.entry_id}"><i class="fas fa-eye"></i></button></td>
        </tr>`
      : `<tr>
          <td><span class="badge st-info">${esc(l('حسابي', 'Comptable'))}</span></td>
          <td><strong>${esc(r.serial_no)}</strong></td>
          <td nowrap>${esc(r.entry_date)}</td>
          <td>${esc(r.procedure_number || '—')}</td>
          <td>${esc(r.dossier_number || '—')}</td>
          <td>${fmtAmount(r.amount)} ${esc(r.currency || '')}</td>
          <td>${entryStatusBadge(r.status)}</td>
          <td><button class="row-btn" data-reg-view="${r.entry_id}"><i class="fas fa-eye"></i></button></td>
        </tr>`);
    const total = res.daily.length + res.accounting.length;
    const slicedDaily = res.daily.slice(0, 20);
    const slicedAcc = res.accounting.slice(0, 20);
    rows.push(...share(slicedDaily, 'daily'), ...share(slicedAcc, 'accounting'));

    thead.innerHTML = `<tr>${[l('السجل', 'Registre'), l('الرقم', 'N°'), l('التاريخ', 'Date'), l('الإجراء', 'Procédure'), l('الملف', 'Dossier'), l('المحتوى', 'Contenu'), l('الحالة', 'Statut'), ''].map((h) => `<th>${h}</th>`).join('')}</tr>`;
    tbody.innerHTML = rows.join('');
    empty.classList.add('hidden');
    if (!has) {
      empty.classList.remove('hidden');
      empty.innerHTML = `<i class="fas fa-magnifying-glass"></i><p>${esc(l('لا نتائج.', 'Aucun résultat.'))}</p>`;
      tbody.innerHTML = '';
    }
  }

  /* ================================================================
     الإعدادات (Admin)
     ================================================================ */
  async function renderSettings() {
    const box = byId('reg-settings-body');
    if (!permissions.config) {
      box.innerHTML = `<div class="data-note"><i class="fas fa-lock"></i><div>
        <strong>${esc(l('إعدادات السجلات متاحة للمسؤول فقط', 'Registre settings available to admin only'))}</strong></div></div>`;
      return;
    }
    const freqLabels = { year: l('سنوي', 'Annuel'), month: l('شهري', 'Mensuel'), day: l('يومي', 'Journalier'), continuous: l('مستمر', 'Continu') };
    box.innerHTML = (cfg.registers || []).map((r, idx) => `
      <div class="card" style="margin-bottom:16px">
        <div class="card-header"><h3>${esc(r.name_ar)} <small class="muted">${esc(r.code)}</small></h3></div>
        <div class="form-grid">
          <div class="form-field"><span>${esc(l('نمط الترقيم', 'Modèle de numérotation'))}</span>
            <input class="form-input" id="rset-pattern-${r.id}" value="${esc(r.numbering_pattern)}">
            <small class="muted">${esc(l('متغيرات: {year} {month} {day} {seq:0000000} — المادة 37: ترقيم تسلسلي متصاعد دون فراغات', 'Variables: {year} {month} {day} {seq:0000000}'))}</small>
          </div>
          <div class="form-field"><span>${esc(l('دورة الترقيم', 'Cycle'))}</span>
            <select class="form-input" id="rset-freq-${r.id}">
              ${Object.keys(freqLabels).map((k) => `<option value="${k}" ${r.seq_frequency === k ? 'selected' : ''}>${esc(freqLabels[k])}</option>`).join('')}
            </select>
          </div>
          <div class="form-field" style="grid-column:1/-1"><span>${esc(l('البيانات (schema، إن وجدت)', 'Données (schéma si existant)'))}</span>
            <textarea class="form-input" id="rset-schema-${r.id}" rows="3" dir="ltr">${esc(JSON.stringify(r.schema || [], null, 2))}</textarea>
          </div>
          <div class="form-field" style="grid-column:1/-1"><span>${esc(l('مرجع النص التنظيمي', 'Réf. réglementaire'))}</span>
            <input class="form-input" id="rset-official-${r.id}" value="${esc(r.official_template_ref || '')}" placeholder="${esc(l('مثال: م 37 من القانون 46.21 — النموذج الرسمي لم يُنشر بعد', 'ex: art.37 loi 46.21 — modèle officiel non publié'))}">
          </div>
          <div class="form-field"><label class="check-inline"><input type="checkbox" id="rset-active-${r.id}" ${r.active ? 'checked' : ''}><span>${esc(l('السجل نشط', 'Registre actif'))}</span></label></div>
        </div>
      </div>`).join('') + `
      <div class="card" style="margin-bottom:16px">
        <div class="card-header"><h3>${esc(l('التسجيل التلقائي', 'Enregistrement auto'))}</h3></div>
        <div class="form-grid">
          <div class="form-field"><label class="check-inline"><input type="checkbox" id="rset-auto-daily" ${cfg.settings.autoDaily ? 'checked' : ''}><span>${esc(l('عند إنشاء إجراء → قيد في السجل اليومي', 'Création procédure → écriture journal'))}</span></label></div>
          <div class="form-field"><label class="check-inline"><input type="checkbox" id="rset-auto-acc" ${cfg.settings.autoAccounting ? 'checked' : ''}><span>${esc(l('عند تأكيد أداء → قيد في السجل الحسابي', 'Confirmation paiement → écriture comptable'))}</span></label></div>
        </div>
        <div class="form-actions">
          <button class="btn btn-primary" id="reg-settings-save"><i class="fas fa-save"></i><span>${esc(l('حفظ الإعدادات', 'Enregistrer'))}</span></button>
        </div>
      </div>`;
  }

  async function saveSettings() {
    if (!permissions.config) return;
    for (const r of cfg.registers || []) {
      const schemaRaw = byId('rset-schema-' + r.id).value;
      try {
        await API.regUpdateConfig({
          registerId: r.id,
          numberingPattern: byId('rset-pattern-' + r.id).value,
          seqFrequency: byId('rset-freq-' + r.id).value,
          schemaJson: schemaRaw,
          officialTemplateRef: byId('rset-official-' + r.id).value,
          active: byId('rset-active-' + r.id).checked
        });
      } catch (e) {
        toast(errText(e), true);
        return;
      }
    }
    try {
      await API.regUpdateConfig({
        registerId: cfg.registers[0] ? cfg.registers[0].id : null,
        autoDaily: byId('rset-auto-daily').checked,
        autoAccounting: byId('rset-auto-acc').checked
      });
    } catch (e) { toast(errText(e), true); }
    cfg = await API.regConfig();
    toast(l('تم حفظ إعدادات السجلات', 'Paramètres enregistrés'));
  }

  /* ================================================================
     الإدخال اليدوي
     ================================================================ */
  async function openManualEntry(kind) {
    const acc = kind === 'accounting';
    modal.title.textContent = acc ? l('إدخال يدوي في السجل الحسابي', 'Saisie manuelle (comptable)') : l('إدخال يدوي في السجل اليومي', 'Saisie manuelle (journal)');
    modal.body.innerHTML = `
      <div class="form-grid" style="grid-template-columns:1fr">
        <div class="form-field" style="grid-column:1/-1">
          <span>${esc(acc ? l('اختر أداءً', 'Choisir un paiement') : l('اختر إجراءً', 'Choisir une procédure'))}</span>
          <input class="form-input" id="manual-search" placeholder="...">
          <div class="dos-results hidden" id="manual-results"></div>
        </div>
        ${acc ? `
          <div class="form-field"><span>${esc(l('نوع العملية', 'Type'))}</span>
            <select class="form-input" id="manual-flow"><option value="income">${esc(l('إيراد', 'Recette'))}</option><option value="refund">${esc(l('استرداد', 'Remboursement'))}</option></select>
          </div>
          <div class="form-field"><span>${esc(l('المبلغ', 'Montant'))}</span><input class="form-input" id="manual-amount" type="number" step="0.01"></div>
          <div class="form-field"><span>${esc(l('العملة', 'Devise'))}</span><input class="form-input" id="manual-currency" value="MAD"></div>` : ''}
        <div class="form-field"><span>${esc(l('تاريخ القيد', 'Date'))}</span><input class="form-input" id="manual-date" type="date" value="${new Date().toISOString().slice(0, 10)}"></div>
      </div>`;
    modal.footer.innerHTML = `
      <button class="btn btn-ghost" data-modal-cancel>${esc(l('إلغاء', 'Annuler'))}</button>
      <button class="btn btn-primary" data-modal-ok disabled>${esc(l('تسجيل', 'Enregistrer'))}</button>`;
    openModal();
    modal.footer.querySelector('[data-modal-cancel]').addEventListener('click', closeModal);

    const results = byId('manual-results');
    const okBtn = modal.footer.querySelector('[data-modal-ok]');
    let picked = null;

    byId('manual-search').addEventListener('input', async (e) => {
      const q = e.target.value.trim();
      if (!q) { results.classList.add('hidden'); results.innerHTML = ''; return; }
      let data;
      if (acc) data = await API.payList({ q: undefined,page: 1, pageSize: 8 }).catch(() => ({ rows: [] }));
      else data = await API.procList({ q, page: 1, pageSize: 8 });
      results.classList.remove('hidden');
      results.innerHTML = (data.rows || []).map((r) => `
        <div class="dos-result" data-pick="${r.id}">
          <strong>${esc(acc ? l('أداء #', 'Paiement #') + r.id : (r.procedure_number || l('إجراء #', 'Procédure #') + r.id))}</strong>
          <small>${esc((r.dossier_number ? r.dossier_number + ' — ' : '') + ((state.lang === 'fr' ? (r.type_name_fr || r.type_name_ar) : (r.type_name_ar || r.type_name_fr)) || ''))}</small>
        </div>`).join('') || `<div class="dos-result">${esc(l('لا نتائج', 'Aucun'))}</div>`;
      results.querySelectorAll('[data-pick]').forEach((el) => {
        el.onclick = () => {
          picked = Number(el.getAttribute('data-pick'));
          results.innerHTML = `<div class="dos-result selected">${esc(el.textContent)}</div>`;
          okBtn.disabled = false;
          if (acc) {
            const pay = (data.rows || []).find((x) => x.id === picked);
            if (pay && pay.amount) byId('manual-amount').value = pay.amount;
          }
        };
      });
    });

    okBtn.addEventListener('click', async () => {
      if (!picked) { toast(l('اختر عنصراً', 'Veuillez choisir'), true); return; }
      try {
        const payload = acc
          ? { kind: 'accounting', paymentId: picked, flowType: byId('manual-flow').value,
              amount: byId('manual-amount').value, currency: byId('manual-currency').value,
              entryDate: byId('manual-date').value }
          : { kind: 'daily', procedureId: picked, entryDate: byId('manual-date').value };
        await API.regEntryCreateManual(payload);
        closeModal();
        toast(l('سُجل القيد', 'Escriture enregistrée'));
        await reloadCurrent();
      } catch (e) {
        toast(errText(e), true);
      }
    });
  }

  /* ================================================================
     الأحداث
     ================================================================ */
  function bindEvents() {
    bindTabs();
    bindSearch();

    // فلاتر + تصدير السجل اليومي
    const wire = (kind) => {
      const p = kind === 'accounting' ? 'a' : 'd';
      byId('reg-' + p + '-apply').onclick = () => { readFiltersFrom(kind); loadEntries(kind); };
      byId('reg-' + p + '-manual').onclick = () => openManualEntry(kind);
      byId('reg-' + p + '-csv').onclick = () => exportKind(kind, () => API.regExportCsv('csv', filtersPayload(kind)));
      byId('reg-' + p + '-xls').onclick = () => exportKind(kind, () => API.regExportCsv('xls', filtersPayload(kind)));
      byId('reg-' + p + '-pdf').onclick = () => exportKind(kind, () => API.regExportPdf(filtersPayload(kind)));
      byId('reg-' + p + '-print').onclick = () => exportKind(kind, () => API.regPrint(filtersPayload(kind)));
      byId('reg-' + p + '-archive').onclick = () => archivePeriodAction(kind);
    };
    wire('daily');
    wire('accounting');

    // صفحات القوائم والتدقيق والتصحيحات
    document.addEventListener('click', (e) => {
      const pageBtn = e.target.closest('[data-reg-page]');
      if (pageBtn) {
        const [kind, pg] = pageBtn.getAttribute('data-reg-page').split(':');
        filters[kind].page = Number(pg);
        loadEntries(kind);
        return;
      }
      const corrPage = e.target.closest('[data-reg-corr-page]');
      if (corrPage) {
        correctionsPage = Number(corrPage.getAttribute('data-reg-corr-page'));
        loadCorrections();
        return;
      }
      const auPage = e.target.closest('[data-reg-audit-page]');
      if (auPage) {
        auditPage = Number(auPage.getAttribute('data-reg-audit-page'));
        loadAudit();
        return;
      }
      const view = e.target.closest('[data-reg-view]');
      if (view) { openEntry(Number(view.getAttribute('data-reg-view'))); return; }
      const link = e.target.closest('[data-reg-link]');
      if (link) {
        const [type, val] = link.getAttribute('data-reg-link').split(':');
        if (type === 'proc' && val) { closeModal(); if (window.ProceduresModule) window.ProceduresModule.openDetail(Number(val)); }
        else if (type === 'pv' && val) { closeModal(); if (window.PvsModule) window.PvsModule.openDetail(Number(val)); }
        else if (type === 'entry' && val) { closeModal(); openEntry(Number(val)); }
        return;
      }
      const corrApprove = e.target.closest('[data-reg-corr-approve]');
      if (corrApprove) {
        const id = Number(corrApprove.getAttribute('data-reg-corr-approve'));
        askText(l('قبول التصحيح', 'Approuver'), l('ملاحظة المراجعة', 'Note'), true, async (note) => {
          try { await API.regCorrectionApprove(id, note); toast(l('نُفذ التصحيح', 'Correction exécutée')); await loadTab(); }
          catch (err) { toast(errText(err), true); }
        });
        return;
      }
      const corrReject = e.target.closest('[data-reg-corr-reject]');
      if (corrReject) {
        const id = Number(corrReject.getAttribute('data-reg-corr-reject'));
        askText(l('رفض التصحيح', 'Rejeter'), l('ملاحظة الرفض', 'Note'), true, async (note) => {
          try { await API.regCorrectionReject(id, note); toast(l('رُفض الطلب', 'Rejeté')); await loadTab(); }
          catch (err) { toast(errText(err), true); }
        });
        return;
      }
    });

    // الفترات
    byId('reg-p-register').addEventListener('change', () => { loadPeriods(); });
    byId('reg-u-register').addEventListener('change', () => { auditPage = 1; loadAudit(); });
    document.addEventListener('click', (e) => {
      const pbtn = e.target.closest('[data-reg-period]');
      if (pbtn) {
        const [rid, pk, st] = pbtn.getAttribute('data-reg-period').split(':');
        askText(l('حالة الفترة ' + st, 'Statut période ' + st), l('ملاحظة (إلزامية للإقفال)', 'Note (obligatoire pour verrouiller)'), true, async (note) => {
          try { await API.regPeriodSetStatus(Number(rid), pk, st, note); toast(l('حُدثت الفترة', 'Période mise à jour')); await loadPeriods(); }
          catch (err) { toast(errText(err), true); }
        });
        return;
      }
      const abtn = e.target.closest('[data-reg-period-arch]');
      if (abtn) {
        const [rid, pk] = abtn.getAttribute('data-reg-period-arch').split(':');
        if (!confirm(l('أرشفة ' + pk + '؟', 'Archiver ' + pk + ' ?'))) return;
        API.regArchivePeriod(Number(rid), pk)
          .then((r) => toast(l('أُرشف: ' + r.filePath, 'Archivé: ' + r.filePath)))
          .catch((err) => toast(errText(err), true));
        return;
      }
      const sbtn = e.target.closest('[data-reg-seal]');
      if (sbtn) {
        const [rid, pk] = sbtn.getAttribute('data-reg-seal').split(':');
        askText(l('ختم الفترة ' + pk, 'Sceller la période ' + pk), l('سبب الختم (إلزامي)', 'Motif du sceau (obligatoire)'), true, async (note) => {
          try {
            const s = await API.regSealPeriod(Number(rid), pk, note);
            toast(l('خُتمت الفترة — ' + s.doc_count + ' وثيقة (مختومة الآن)', 'Période scellée — ' + s.doc_count + ' document(s) scellé(s)'));
            await loadPeriods();
          } catch (err) { toast(errText(err), true); }
        });
        return;
      }
      const vbtn = e.target.closest('[data-reg-verify]');
      if (vbtn) {
        const sealId = Number(vbtn.getAttribute('data-reg-verify'));
        API.regSealVerify(sealId)
          .then((v) => {
            if (v.corrupted_docs === 0 && v.manifest_ok) {
              toast(l('السلامة سليمة: ' + v.ok_docs + '/' + v.doc_count + ' وثيقة + البيان', 'Intégrité OK : ' + v.ok_docs + '/' + v.doc_count + ' + manifeste'));
            } else {
              toast(l('تنبيه! وثائق معدّلة: ' + v.corrupted_docs + ' أو بيان غير مطابق', 'Attention ! documents modifiés : ' + v.corrupted_docs + ' ou manifeste non conforme'), true);
            }
          })
          .catch((err) => toast(errText(err), true));
        return;
      }
    });

    // الإعدادات
    const settingsSave = byId('reg-settings-save');
    if (settingsSave) settingsSave.addEventListener('click', saveSettings);
  }

  /* ================================================================
     التحميل العام
     ================================================================ */
  async function loadDashboard() {
    dash = await API.regDashboard();
    renderStats();
  }

  async function render() {
    cfg = await API.regConfig();
    await loadPermissions();
    fillRegisterSelects();
    await loadDashboard();
    await loadTab();
  }

  async function init() {
    await loadPermissions();
    await loadDashboard();
    bindEvents();
    fillRegisterSelects();
    cfg = await API.regConfig();
    await loadTab();
  }

  window.RegistersModule = { init, render, reload: () => render() };
})();