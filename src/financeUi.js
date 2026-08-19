/* ================================================================
   وحدة الأداءات والحسابات — FinanceModule
   الأداءات + التقييمات + التعريفات + الدفتر المحاسبي.
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

  /* ---------- الحالة ---------- */
  let activeTab = 'payments';
  let config = { types: [], methods: [] };

  /* ---------- صيغة المبلغ ---------- */
  function fmtAmount(n) {
    const v = Number(n || 0);
    try { return v.toLocaleString(state.lang === 'ar' ? 'ar-MA' : 'fr-MA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
    catch (e) { return String(v.toFixed(2)); }
  }

  function userName(u) {
    return esc(u || '—');
  }

  /* ---------- شارات الحالات المالية ---------- */
  function payBadge(status) {
    const colors = { PENDING: 'warning', CONFIRMED: 'info', PAID: 'success', CANCELLED: 'danger', REFUNDED: 'danger' };
    const key = `finance.payments.statuses.${status}`;
    const fallbacks = { PENDING: l('قيد الانتظار', 'En attente'), CONFIRMED: l('مؤكد', 'Confirmé'), PAID: l('محصّل', 'Payé'), CANCELLED: l('ملغى', 'Annulé'), REFUNDED: l('مسترد', 'Remboursé') };
    const c = colors[status] || 'gray';
    return `<span class="badge st-${c}">${esc(t(key) || fallbacks[status] || status)}</span>`;
  }

  function assessBadge(status) {
    const colors = { DRAFT: 'warning', CONFIRMED: 'info', PARTIALLY_PAID: 'primary', PAID: 'success', CANCELLED: 'danger' };
    const labels = { DRAFT: l('مسودة', 'Brouillon'), CONFIRMED: l('مؤكد', 'Confirmé'), PARTIALLY_PAID: l('محصّل جزئياً', 'Partiel'), PAID: l('محصّل', 'Payé'), CANCELLED: l('ملغى', 'Annulé') };
    const c = colors[status] || 'gray';
    return `<span class="badge st-${c}">${esc(labels[status] || status)}</span>`;
  }

  function typeBadge(type) {
    const colors = { income: 'success', expense: 'danger', refund: 'warning' };
    const labels = { income: l('إيراد', 'Recette'), expense: l('مصروف', 'Dépense'), refund: l('استرداد', 'Remboursement') };
    return `<span class="badge st-${colors[type] || 'gray'}">${esc(labels[type] || type)}</span>`;
  }

  /* ================================================================
     التبويبات
     ================================================================ */
  function bindTabs() {
    byId('fin-tabs').querySelectorAll('.fin-tab').forEach((btn) => {
      btn.onclick = () => {
        activeTab = btn.getAttribute('data-fin-tab');
        byId('fin-tabs').querySelectorAll('.fin-tab').forEach((b) => b.classList.toggle('active', b === btn));
        byId('fin-panel-payments').classList.toggle('active', activeTab === 'payments');
        byId('fin-panel-assessments').classList.toggle('active', activeTab === 'assessments');
        byId('fin-panel-tariffs').classList.toggle('active', activeTab === 'tariffs');
        byId('fin-panel-ledger').classList.toggle('active', activeTab === 'ledger');
        loadTab();
      };
    });
  }

  async function loadTab() {
    if (activeTab === 'payments') await loadPayments();
    else if (activeTab === 'assessments') await loadAssessments();
    else if (activeTab === 'tariffs') { await loadTariffs(); await loadPaymentMethods(); }
    else if (activeTab === 'ledger') { await loadLedger(); await loadFinancialAudit(); }
  }

  /* ================================================================
     الإحصائيات
     ================================================================ */
  async function loadStats() {
    try {
      const s = await API.payStats();
      byId('finstat-total').textContent = s.total || 0;
      byId('finstat-pending').textContent = (s.byStatus || {}).PENDING || 0;
      byId('finstat-confirmed').textContent = (s.byStatus || {}).CONFIRMED || 0;
      byId('finstat-paid').textContent = fmtAmount(s.totalPaid);
    } catch (e) { /* silent */ }
  }

  /* ================================================================
     البحث والتصفية (موصلة فعلياً)
     ================================================================ */
  function getFilters() {
    const q = (byId('fin-search') ? byId('fin-search').value : '').trim();
    const status = byId('fin-filter-status') ? byId('fin-filter-status').value : '';
    return { q, status };
  }

  function wireFilters() {
    const searchEl = byId('fin-search');
    const filterEl = byId('fin-filter-status');
    if (searchEl) searchEl.addEventListener('input', () => { loadTab(); });
    if (filterEl) filterEl.addEventListener('change', () => { loadTab(); });
  }

  /* ================================================================
     الأداءات
     ================================================================ */
  async function loadPayments() {
    try {
      const f = getFilters();
      const params = { page: 1, pageSize: 100 };
      if (f.status) params.status = f.status;
      if (f.q) params.method = f.q;
      const res = await API.payList(params);
      let rows = res.rows || [];
      if (f.q) {
        const q = f.q.toLowerCase();
        rows = rows.filter((r) =>
          (r.procedure_number || '').toLowerCase().includes(q) ||
          (r.reference || '').toLowerCase().includes(q) ||
          (r.method_name_ar || '').toLowerCase().includes(q) ||
          String(r.amount).includes(q)
        );
      }
      renderPayments(rows);
    } catch (e) { toast(t('finance.errors.load'), true); }
  }

  function renderPayments(rows) {
    byId('fin-pay-thead').innerHTML = `<tr>
      <th>${t('finance.payments.col.num')}</th>
      <th>${t('finance.payments.col.procedure')}</th>
      <th>${t('finance.payments.col.amount')}</th>
      <th>${t('finance.payments.col.method')}</th>
      <th>${t('finance.payments.col.date')}</th>
      <th>${t('finance.payments.col.status')}</th>
      <th>${t('finance.payments.col.reference')}</th>
      <th></th>
    </tr>`;

    if (!rows.length) {
      byId('fin-pay-tbody').innerHTML = '';
      byId('fin-pay-empty').classList.remove('hidden');
      byId('fin-pay-count').textContent = '0';
      return;
    }

    byId('fin-pay-empty').classList.add('hidden');
    byId('fin-pay-tbody').innerHTML = rows.map((p) => `
      <tr>
        <td><strong>#${p.id}</strong></td>
        <td><small>${esc(p.procedure_number || '—')}</small></td>
        <td><strong>${fmtAmount(p.amount)} ${esc(p.currency || 'MAD')}</strong></td>
        <td>${esc(p.method_name_ar || p.method || '—')}</td>
        <td>${fmtDate(p.payment_date)}</td>
        <td>${payBadge(p.status)}</td>
        <td><small>${esc(p.reference || '—')}</small></td>
        <td><div class="row-actions">
          <button class="row-btn" data-fin-pay-detail="${p.id}" title="${l('التفاصيل', 'Détails')}"><i class="fas fa-eye"></i></button>
          ${p.status === 'PENDING' ? `<button class="row-btn" data-fin-pay-confirm="${p.id}" title="${l('تأكيد', 'Confirmer')}"><i class="fas fa-check"></i></button>` : ''}
          ${p.status === 'PENDING' ? `<button class="row-btn del" data-fin-pay-cancel="${p.id}" title="${l('إلغاء', 'Annuler')}"><i class="fas fa-ban"></i></button>` : ''}
        </div></td>
      </tr>`).join('');

    byId('fin-pay-count').textContent = rows.length;

    /* ربط الأحداث */
    byId('fin-pay-tbody').querySelectorAll('[data-fin-pay-confirm]').forEach((b) => {
      b.onclick = async () => {
        const id = Number(b.getAttribute('data-fin-pay-confirm'));
        try {
          await API.payConfirm(id);
          toast(l('تم تأكيد الأداء', 'Paiement confirmé'));
          await loadPayments();
          await loadStats();
        } catch (e) { toast(e.message || e, true); }
      };
    });

    byId('fin-pay-tbody').querySelectorAll('[data-fin-pay-cancel]').forEach((b) => {
      b.onclick = async () => {
        const id = Number(b.getAttribute('data-fin-pay-cancel'));
        if (!confirm(l('هل تريد إلغاء هذا الأداء؟', 'Annuler ce paiement ?'))) return;
        try {
          await API.payCancel(id, l('إلغاء يدوي', 'Annulation manuelle'));
          toast(l('تم إلغاء الأداء', 'Paiement annulé'));
          await loadPayments();
          await loadStats();
        } catch (e) { toast(e.message || e, true); }
      };
    });

    byId('fin-pay-tbody').querySelectorAll('[data-fin-pay-detail]').forEach((b) => {
      b.onclick = async () => {
        const id = Number(b.getAttribute('data-fin-pay-detail'));
        await openPayDetail(id);
      };
    });
  }

  /* ---------- تفاصيل الدفع ---------- */
  async function openPayDetail(id) {
    try {
      const p = await API.payGet(id);
      modal.title.textContent = l('تفاصيل الأداء', 'Détail du paiement') + ' #' + id;
      modal.body.innerHTML = `
        <div class="det-grid">
          <div class="det-item"><span>${l('رقم الأداء', 'N° paiement')}</span><strong>#${p.id}</strong></div>
          <div class="det-item"><span>${t('finance.payments.detail.procedure')}</span><strong>${esc(p.procedure_number || '—')}</strong></div>
          <div class="det-item"><span>${t('finance.payments.detail.amount')}</span><strong>${fmtAmount(p.amount)} ${esc(p.currency || 'MAD')}</strong></div>
          <div class="det-item"><span>${t('finance.payments.detail.method')}</span><strong>${esc(p.method || '—')}</strong></div>
          <div class="det-item"><span>${t('finance.payments.detail.date')}</span><strong>${fmtDate(p.payment_date)}</strong></div>
          <div class="det-item"><span>${t('finance.payments.detail.status')}</span><strong>${payBadge(p.status)}</strong></div>
          <div class="det-item"><span>${t('finance.payments.detail.reference')}</span><strong>${esc(p.reference || '—')}</strong></div>
          <div class="det-item"><span>${t('finance.payments.detail.notes')}</span><strong>${esc(p.notes || '—')}</strong></div>
          ${p.confirmed_at ? `<div class="det-item"><span>${t('finance.payments.detail.confirmedBy')}</span><strong>${esc(p.confirmed_by)} — ${fmtDate(p.confirmed_at)}</strong></div>` : ''}
        </div>
        ${(p.transactions || []).length ? `
          <div class="det-section">
            <h5>${l('سجل المعاملات', 'Transactions')}</h5>
            <div class="table-wrap"><table class="data-table">
              <thead><tr>
                <th>${l('المبلغ', 'Montant')}</th>
                <th>${l('النوع', 'Type')}</th>
                <th>${l('التاريخ', 'Date')}</th>
                <th>${l('ملاحظات', 'Notes')}</th>
              </tr></thead>
              <tbody>${p.transactions.map((tx) => `
                <tr>
                  <td><strong>${fmtAmount(tx.amount)}</strong></td>
                  <td><span class="badge st-${tx.type === 'initial' ? 'info' : tx.type === 'refund' ? 'warning' : 'success'}">${esc(tx.type)}</span></td>
                  <td>${fmtDate(tx.transaction_date)}</td>
                  <td><small>${esc(tx.notes || '—')}</small></td>
                </tr>`).join('')}</tbody>
            </table></div>
          </div>` : ''}
        ${p.method_info ? `
          <div class="det-section">
            <h5>${l('طريقة الدفع', 'Mode de paiement')}</h5>
            <div class="det-grid">
              <div class="det-item"><span>${l('الكود', 'Code')}</span><strong>${esc(p.method_info.code)}</strong></div>
              <div class="det-item"><span>${l('الاسم', 'Nom')}</span><strong>${esc(p.method_info.name_ar)}</strong></div>
            </div>
          </div>` : ''}`;
      modal.footer.innerHTML = `
        <button class="btn btn-ghost" data-modal-cancel>${t('common.cancel')}</button>
        ${(p.status === 'CONFIRMED' || p.status === 'PAID') ? `<button class="btn btn-warning" data-fin-pay-refund="${p.id}"><i class="fas fa-undo"></i> ${l('استرداد', 'Rembourser')}</button>` : ''}
        ${(p.status === 'CONFIRMED' || p.status === 'PAID') ? `<button class="btn btn-info" data-fin-pay-cancel-receipt="${p.id}"><i class="fas fa-times-circle"></i> ${l('إلغاء الإيصال', 'Annuler reçu')}</button>` : ''}`;
      openModal();
      modal.footer.querySelector('[data-modal-cancel]').addEventListener('click', closeModal);
      const refundBtn = modal.footer.querySelector('[data-fin-pay-refund]');
      if (refundBtn) refundBtn.onclick = () => openRefundModal(p);
      const cancelReceiptBtn = modal.footer.querySelector('[data-fin-pay-cancel-receipt]');
      if (cancelReceiptBtn) cancelReceiptBtn.onclick = async () => {
        const reason = prompt(l('سبب إلغاء الإيصال', 'Motif de l\'annulation du reçu'));
        if (reason === null) return;
        try {
          await API.payCancelReceipt(p.id, reason || l('إلغاء يدوي', 'Annulation manuelle'));
          toast(l('تم إلغاء الإيصال', 'Reçu annulé'));
          closeModal();
          await loadPayments();
        } catch (e) { toast(e.message || e, true); }
      };
    } catch (e) { toast(e.message || e, true); }
  }

  /* ================================================================
     التقييمات
     ================================================================ */
  async function loadAssessments() {
    try {
      const f = getFilters();
      const params = { page: 1, pageSize: 100 };
      if (f.status) params.status = f.status;
      const res = await API.assessmentList(params);
      let rows = res.rows || [];
      if (f.q) {
        const q = f.q.toLowerCase();
        rows = rows.filter((r) =>
          (r.procedure_number || '').toLowerCase().includes(q) ||
          (r.notes || '').toLowerCase().includes(q) ||
          String(r.total_amount).includes(q)
        );
      }
      renderAssessments(rows);
    } catch (e) { toast(t('finance.errors.load'), true); }
  }

  function renderAssessments(rows) {
    byId('fin-assess-thead').innerHTML = `<tr>
      <th>${t('finance.assessments.col.num')}</th>
      <th>${t('finance.assessments.col.procedure')}</th>
      <th>${t('finance.assessments.col.total')}</th>
      <th>${t('finance.assessments.col.status')}</th>
      <th>${l('أنشأه', 'Créé par')}</th>
      <th>${l('التاريخ', 'Date')}</th>
      <th></th>
    </tr>`;

    if (!rows.length) {
      byId('fin-assess-tbody').innerHTML = '';
      byId('fin-assess-empty').classList.remove('hidden');
      byId('fin-assess-count').textContent = '0';
      return;
    }

    byId('fin-assess-empty').classList.add('hidden');
    byId('fin-assess-tbody').innerHTML = rows.map((a) => `
      <tr>
        <td><strong>#${a.id}</strong></td>
        <td><small>${esc(a.procedure_number || '—')}</small></td>
        <td><strong>${fmtAmount(a.total_amount)} ${esc(a.currency || 'MAD')}</strong></td>
        <td>${assessBadge(a.status)}</td>
        <td>${userName(a.assessed_by)}</td>
        <td>${fmtDate(a.created_at)}</td>
        <td><div class="row-actions">
          <button class="row-btn" data-fin-assess-detail="${a.id}" title="${l('التفاصيل', 'Détails')}"><i class="fas fa-eye"></i></button>
          ${a.status === 'DRAFT' ? `<button class="row-btn" data-fin-assess-confirm="${a.id}" title="${l('تأكيد', 'Confirmer')}"><i class="fas fa-check"></i></button>` : ''}
          ${a.status === 'DRAFT' ? `<button class="row-btn del" data-fin-assess-cancel="${a.id}" title="${l('إلغاء', 'Annuler')}"><i class="fas fa-ban"></i></button>` : ''}
        </div></td>
      </tr>`).join('');

    byId('fin-assess-count').textContent = rows.length;

    byId('fin-assess-tbody').querySelectorAll('[data-fin-assess-confirm]').forEach((b) => {
      b.onclick = async () => {
        const id = Number(b.getAttribute('data-fin-assess-confirm'));
        try {
          await API.assessmentConfirm(id);
          toast(l('تم تأكيد التقييم', 'Évaluation confirmée'));
          await loadAssessments();
        } catch (e) { toast(e.message || e, true); }
      };
    });

    byId('fin-assess-tbody').querySelectorAll('[data-fin-assess-cancel]').forEach((b) => {
      b.onclick = async () => {
        const id = Number(b.getAttribute('data-fin-assess-cancel'));
        if (!confirm(l('هل تريد إلغاء هذا التقييم؟', 'Annuler cette évaluation ?'))) return;
        try {
          await API.assessmentCancel(id, l('إلغاء يدوي', 'Annulation'));
          toast(l('تم إلغاء التقييم', 'Évaluation annulée'));
          await loadAssessments();
        } catch (e) { toast(e.message || e, true); }
      };
    });

    byId('fin-assess-tbody').querySelectorAll('[data-fin-assess-detail]').forEach((b) => {
      b.onclick = async () => {
        const id = Number(b.getAttribute('data-fin-assess-detail'));
        await openAssessDetail(id);
      };
    });
  }

  async function openAssessDetail(id) {
    try {
      const a = await API.assessmentGet(id);
      modal.title.textContent = l('تفاصيل التقييم', 'Détail de l\'évaluation') + ' #' + id;
      modal.body.innerHTML = `
        <div class="det-grid">
          <div class="det-item"><span>${l('رقم التقييم', 'N°')}</span><strong>#${a.id}</strong></div>
          <div class="det-item"><span>${t('finance.assessments.detail.procedure')}</span><strong>${esc(a.procedure_number || '—')}</strong></div>
          <div class="det-item"><span>${t('finance.assessments.detail.total')}</span><strong>${fmtAmount(a.total_amount)} ${esc(a.currency || 'MAD')}</strong></div>
          <div class="det-item"><span>${t('finance.assessments.detail.status')}</span><strong>${assessBadge(a.status)}</strong></div>
          <div class="det-item"><span>${l('أنشأه', 'Créé par')}</span><strong>${userName(a.assessed_by)}</strong></div>
          <div class="det-item"><span>${t('finance.assessments.detail.confirmedBy')}</span><strong>${userName(a.confirmed_by || '—')}</strong></div>
          <div class="det-item full"><span>${t('finance.assessments.detail.notes')}</span><strong>${esc(a.notes || '—')}</strong></div>
        </div>
        ${(a.items || []).length ? `
          <div class="det-section">
            <h5>${t('finance.assessments.detail.items')}</h5>
            <div class="table-wrap"><table class="data-table">
              <thead><tr>
                <th>${t('finance.assessments.detail.itemDesc')}</th>
                <th>${t('finance.assessments.detail.itemUnit')}</th>
                <th>${t('finance.assessments.detail.itemQty')}</th>
                <th>${t('finance.assessments.detail.itemTotal')}</th>
              </tr></thead>
              <tbody>${a.items.map((it) => `
                <tr>
                  <td>${esc(it.description_ar || it.tariff_name_ar || '—')}</td>
                  <td>${fmtAmount(it.amount)}</td>
                  <td>${it.quantity}</td>
                  <td><strong>${fmtAmount(it.amount * it.quantity)}</strong></td>
                </tr>`).join('')}</tbody>
            </table></div>
          </div>` : ''}`;
      modal.footer.innerHTML = `<button class="btn btn-ghost" data-modal-cancel>${t('common.cancel')}</button>`;
      openModal();
      modal.footer.querySelector('[data-modal-cancel]').addEventListener('click', closeModal);
    } catch (e) { toast(e.message || e, true); }
  }

  /* ================================================================
     نموذج الاسترداد
     ================================================================ */
  function openRefundModal(p) {
    modal.title.textContent = l('استرداد المبلغ', 'Rembourser le paiement') + ' #' + p.id;
    const paid = Number(p.amount) - listRefundTotal(p);
    modal.body.innerHTML = `
      <div class="det-grid" style="margin-bottom:12px">
        <div class="det-item"><span>${l('المبلغ المحصّل', 'Montant payé')}</span><strong>${fmtAmount(p.amount)} MAD</strong></div>
        <div class="det-item"><span>${l('المبلغ المتبقي للاسترداد', 'Montant remboursable')}</span><strong>${fmtAmount(paid)} MAD</strong></div>
      </div>
      <div class="form-grid" style="grid-template-columns:1fr">
        ${field('refund-amount', 'finance.payments.detail.amount', paid, 'number')}
        ${field('refund-reason', l('سبب الاسترداد', 'Motif'), '', 'text')}
        ${field('refund-notes', l('ملاحظات', 'Notes'), '', 'text')}
      </div>`;
    modal.footer.innerHTML = `
      <button class="btn btn-ghost" data-modal-cancel>${t('common.cancel')}</button>
      <button class="btn btn-warning" data-modal-ok><i class="fas fa-undo"></i> ${l('تأكيد الاسترداد', 'Confirmer remboursement')}</button>`;
    openModal();
    modal.footer.querySelector('[data-modal-cancel]').addEventListener('click', closeModal);
    modal.footer.querySelector('[data-modal-ok]').addEventListener('click', async () => {
      const amount = Number(byId('refund-amount').value) || 0;
      const reason = byId('refund-reason').value.trim();
      if (amount <= 0) { toast(l('أدخل مبلغاً صحيحاً', 'Montant invalide'), true); return; }
      if (amount > paid) { toast(l('المبلغ يتجاوز المتبقي', 'Montant trop élevé'), true); return; }
      if (!reason) { toast(l('أدخل السبب', 'Motif requis'), true); return; }
      try {
        await API.payRefund(p.id, { amount, reason, notes: byId('refund-notes').value.trim() });
        toast(l('تم الاسترداد', 'Remboursement effectué'));
        closeModal();
        await loadPayments();
        await loadStats();
      } catch (e) { toast(e.message || e, true); }
    });
  }

  function listRefundTotal(p) {
    return (p.transactions || []).filter((tx) => tx.type === 'refund').reduce((s, tx) => s + Math.abs(Number(tx.amount)), 0);
  }

  /* ================================================================
     إنشاء تقييم جديد (نموذج + إدارة البنود)
     ================================================================ */
  let _assessmentItems = [];
  let _tariffCache = [];

  async function openCreateAssessmentModal() {
    try {
      _assessmentItems = [];
      _tariffCache = (await API.tariffList({ activeOnly: true })) || [];
      let procedures = [];
      try {
        const procRes = await API.procList({ page: 1, pageSize: 200 });
        procedures = procRes.rows || [];
      } catch (e) { /* silent */ }
      config.procedures = procedures;
      modal.title.textContent = l('تقييم جديد', 'Nouvelle évaluation');
      renderAssessmentForm();
      openModal();
      bindAssessmentFormEvents();
    } catch (e) { toast(e.message || e, true); }
  }

  function renderAssessmentForm() {
    const procOpts = (config.procedures || []).map((p) => `<option value="${p.id}">${esc(p.number || p.title)}</option>`).join('');
    modal.body.innerHTML = `
      <div class="form-grid" style="grid-template-columns:1fr">
        <div class="form-field">
          <label>${l('الإجراء', 'Procédure')}</label>
          <select class="form-input" id="ca-procedure"><option value="">— ${l('اختر', 'Choisir')} —</option>${procOpts}</select>
        </div>
        ${field('ca-notes', l('ملاحظات', 'Notes'), '', 'text')}
        <div class="form-field">
          <label>${l('البنود', 'Lignes')}</label>
          <div id="ca-items-list" style="border:1px solid var(--border);border-radius:8px;padding:8px;min-height:60px"></div>
          <button class="btn btn-sm btn-ghost" id="ca-add-item" style="margin-top:6px"><i class="fas fa-plus"></i> ${l('إضافة بند', 'Ajouter une ligne')}</button>
        </div>
        <div id="ca-total" style="text-align:left;font-weight:700;font-size:1.1em"></div>
      </div>`;
    renderAssessmentItems();
  }

  function renderAssessmentItems() {
    const list = byId('ca-items-list');
    if (!list) return;
    if (!_assessmentItems.length) { list.innerHTML = `<p style="color:var(--muted);margin:0">${l('لا توجد بنود بعد', 'Aucune ligne')}</p>`; updateAssessmentTotal(); return; }
    list.innerHTML = _assessmentItems.map((it, i) => `
      <div style="display:flex;align-items:center;gap:6px;padding:6px;border-bottom:1px solid var(--border)">
        <span style="flex:1"><strong>${esc(it.descriptionAr || it.tariffName || '—')}</strong> × ${it.quantity}</span>
        <strong>${fmtAmount(it.amount * it.quantity)} MAD</strong>
        <button class="row-btn del" data-ca-remove="${i}" title="${l('حذف', 'Supprimer')}"><i class="fas fa-trash"></i></button>
      </div>`).join('');
    list.querySelectorAll('[data-ca-remove]').forEach((b) => {
      b.onclick = () => { _assessmentItems.splice(Number(b.getAttribute('data-ca-remove')), 1); renderAssessmentItems(); };
    });
    updateAssessmentTotal();
  }

  function updateAssessmentTotal() {
    const el = byId('ca-total');
    if (el) {
      const total = _assessmentItems.reduce((s, it) => s + it.amount * it.quantity, 0);
      el.textContent = l('الإجمالي', 'Total') + ': ' + fmtAmount(total) + ' MAD';
    }
  }

  function bindAssessmentFormEvents() {
    const addBtn = byId('ca-add-item');
    if (addBtn) addBtn.onclick = () => openAddAssessmentItemModal();
    const okBtn = modal.footer.querySelector('[data-modal-ok]');
    if (okBtn) okBtn.onclick = async () => {
      const procedureId = Number(byId('ca-procedure').value);
      if (!procedureId) { toast(l('اختر الإجراء', 'Choisir une procédure'), true); return; }
      if (!_assessmentItems.length) { toast(l('أضف بنداً واحداً على الأقل', 'Au moins une ligne'), true); return; }
      const notes = byId('ca-notes').value.trim();
      try {
        await API.assessmentCreate(procedureId, { currency: 'MAD', notes, items: _assessmentItems.map((it) => ({
          tariffId: it.tariffId || null,
          descriptionAr: it.descriptionAr,
          descriptionFr: it.descriptionFr || '',
          amount: it.amount,
          quantity: it.quantity
        }))});
        toast(l('تم إنشاء التقييم', 'Évaluation créée'));
        closeModal();
        await loadAssessments();
      } catch (e) { toast(e.message || e, true); }
    };
  }

  function openAddAssessmentItemModal() {
    const tariffOpts = _tariffCache.map((tt) => `<option value="${tt.id}" data-amt="${tt.default_amount}" data-nar="${tt.name_ar}" data-nfr="${tt.name_fr}">${esc(tt.name_ar)} (${tt.code}) — ${fmtAmount(tt.default_amount)} MAD</option>`).join('');
    const tmpDiv = document.createElement('div');
    tmpDiv.style.cssText = 'position:fixed;z-index:9999;background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:16px;box-shadow:0 8px 32px rgba(0,0,0,.3);width:380px;top:50%;left:50%;transform:translate(-50%,-50%)';
    tmpDiv.innerHTML = `
      <h5 style="margin:0 0 12px">${l('إضافة بند', 'Ajouter une ligne')}</h5>
      <div class="form-field">
        <label>${l('التعريفة', 'Tarification')}</label>
        <select class="form-input" id="cai-tariff"><option value="">— ${l('مخصص', 'Personnalisé')} —</option>${tariffOpts}</select>
      </div>
      <div class="form-field">
        <label>${l('الوصف', 'Description')}</label>
        <input class="form-input" id="cai-desc" />
      </div>
      <div style="display:flex;gap:8px">
        <div class="form-field" style="flex:1">
          <label>${l('المبلغ', 'Montant')}</label>
          <input class="form-input" id="cai-amount" type="number" />
        </div>
        <div class="form-field" style="flex:1">
          <label>${l('الكمية', 'Quantité')}</label>
          <input class="form-input" id="cai-qty" type="number" value="1" />
        </div>
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">
        <button class="btn btn-ghost" id="cai-cancel">${t('common.cancel')}</button>
        <button class="btn btn-primary" id="cai-ok"><i class="fas fa-plus"></i> ${t('common.save')}</button>
      </div>`;
    document.body.appendChild(tmpDiv);

    const tariffSel = tmpDiv.querySelector('#cai-tariff');
    tariffSel.onchange = () => {
      const opt = tariffSel.options[tariffSel.selectedIndex];
      if (opt.value) {
        tmpDiv.querySelector('#cai-amount').value = opt.getAttribute('data-amt') || '';
        tmpDiv.querySelector('#cai-desc').value = opt.getAttribute('data-nar') || '';
      }
    };

    tmpDiv.querySelector('#cai-cancel').onclick = () => tmpDiv.remove();
    tmpDiv.querySelector('#cai-ok').onclick = () => {
      const tariffId = Number(tariffSel.value) || null;
      const desc = tmpDiv.querySelector('#cai-desc').value.trim();
      const amount = Number(tmpDiv.querySelector('#cai-amount').value) || 0;
      const qty = Number(tmpDiv.querySelector('#cai-qty').value) || 1;
      if (!desc) { toast(l('أدخل الوصف', 'Description requise'), true); return; }
      if (amount <= 0) { toast(l('أدخل مبلغاً صحيحاً', 'Montant invalide'), true); return; }
      const tariff = _tariffCache.find((tt) => tt.id === tariffId);
      _assessmentItems.push({
        tariffId,
        descriptionAr: desc,
        descriptionFr: tariff ? tariff.name_fr : '',
        tariffName: tariff ? tariff.name_ar : '',
        amount,
        quantity: qty
      });
      renderAssessmentItems();
      tmpDiv.remove();
    };
  }

  /* ================================================================
     طرق الدفع (إدارة)
     ================================================================ */
  let _activePayMethods = [];
  async function loadPaymentMethods() {
    try {
      const methods = await API.payMethods();
      _activePayMethods = methods || [];
      renderPaymentMethods();
    } catch (e) { /* silent */ }
  }

  function renderPaymentMethods() {
    const container = byId('fin-methods-list');
    if (!container) return;
    if (!_activePayMethods.length) {
      container.innerHTML = `<p style="color:var(--muted)">${l('لا توجد طرق دفع', 'Aucun mode de paiement')}</p>`;
      return;
    }
    container.innerHTML = `<div class="table-wrap"><table class="data-table">
      <thead><tr><th>${l('الكود', 'Code')}</th><th>${l('الاسم', 'Nom')}</th><th>${l('الاسم بالفرنسية', 'Nom FR')}</th><th>${l('الترتيب', 'Ordre')}</th><th>${l('الحالة', 'Statut')}</th><th></th></tr></thead>
      <tbody>${_activePayMethods.map((m) => `<tr>
        <td><code>${esc(m.code)}</code></td>
        <td>${esc(m.name_ar)}</td>
        <td><small>${esc(m.name_fr)}</small></td>
        <td>${m.sort_order || 0}</td>
        <td>${m.active ? `<span class="badge st-success">${l('نشط', 'Actif')}</span>` : `<span class="badge st-danger">${l('معطّل', 'Inactif')}</span>`}</td>
        <td><div class="row-actions">
          <button class="row-btn" data-fm-edit="${m.id}"><i class="fas fa-pen"></i></button>
        </div></td>
      </tr>`).join('')}</tbody>
    </table></div>`;
    container.querySelectorAll('[data-fm-edit]').forEach((b) => {
      b.onclick = () => {
        const m = _activePayMethods.find((x) => x.id === Number(b.getAttribute('data-fm-edit')));
        if (m) openEditPaymentMethodModal(m);
      };
    });
  }

  function openEditPaymentMethodModal(method) {
    modal.title.textContent = l('تعديل طريقة الدفع', 'Modifier le mode de paiement');
    modal.body.innerHTML = `
      <div class="form-grid" style="grid-template-columns:1fr">
        ${field('fm-nameAr', l('الاسم بالعربية', 'Nom AR'), method.name_ar, 'text')}
        ${field('fm-nameFr', l('الاسم بالفرنسية', 'Nom FR'), method.name_fr, 'text')}
        ${field('fm-sort', l('الترتيب', 'Ordre'), method.sort_order || 0, 'number')}
        <div class="form-field">
          <label>${l('نشط', 'Actif')}</label>
          <select class="form-input" id="fm-active"><option value="1" ${method.active ? 'selected' : ''}>${l('نعم', 'Oui')}</option><option value="0" ${!method.active ? 'selected' : ''}>${l('لا', 'Non')}</option></select>
        </div>
      </div>`;
    modal.footer.innerHTML = `
      <button class="btn btn-ghost" data-modal-cancel>${t('common.cancel')}</button>
      <button class="btn btn-primary" data-modal-ok>${t('common.save')}</button>`;
    openModal();
    modal.footer.querySelector('[data-modal-cancel]').addEventListener('click', closeModal);
    modal.footer.querySelector('[data-modal-ok]').addEventListener('click', async () => {
      try {
        await API.payMethodUpdate(method.id, {
          nameAr: byId('fm-nameAr').value.trim(),
          nameFr: byId('fm-nameFr').value.trim(),
          sortOrder: Number(byId('fm-sort').value) || 0,
          active: byId('fm-active').value === '1'
        });
        toast(t('common.save'));
        closeModal();
        await loadPaymentMethods();
      } catch (e) { toast(e.message || e, true); }
    });
  }

  function openAddPaymentMethodModal() {
    modal.title.textContent = l('طريقة دفع جديدة', 'Nouveau mode de paiement');
    modal.body.innerHTML = `
      <div class="form-grid" style="grid-template-columns:1fr">
        ${field('fma-code', l('الكود', 'Code'), '', 'text')}
        ${field('fma-nameAr', l('الاسم بالعربية', 'Nom AR'), '', 'text')}
        ${field('fma-nameFr', l('الاسم بالفرنسية', 'Nom FR'), '', 'text')}
        ${field('fma-sort', l('الترتيب', 'Ordre'), 0, 'number')}
      </div>`;
    modal.footer.innerHTML = `
      <button class="btn btn-ghost" data-modal-cancel>${t('common.cancel')}</button>
      <button class="btn btn-primary" data-modal-ok>${t('common.save')}</button>`;
    openModal();
    modal.footer.querySelector('[data-modal-cancel]').addEventListener('click', closeModal);
    modal.footer.querySelector('[data-modal-ok]').addEventListener('click', async () => {
      const code = byId('fma-code').value.trim();
      const nameAr = byId('fma-nameAr').value.trim();
      const nameFr = byId('fma-nameFr').value.trim();
      if (!code || !nameAr) { toast(l('الكود والاسم مطلوبان', 'Code et nom requis'), true); return; }
      try {
        await API.payMethodAdd({ code, nameAr, nameFr, sortOrder: Number(byId('fma-sort').value) || 0 });
        toast(t('common.save'));
        closeModal();
        await loadPaymentMethods();
      } catch (e) { toast(e.message || e, true); }
    });
  }

  /* ================================================================
     السجل المالي (Financial Audit Log)
     ================================================================ */
  async function loadFinancialAudit() {
    try {
      const res = await API.payFinancialAudit({ page: 1, pageSize: 50 });
      renderFinancialAudit(res.rows || res || []);
    } catch (e) { /* silent */ }
  }

  function renderFinancialAudit(rows) {
    const container = byId('fin-audit-list');
    if (!container) return;
    if (!rows.length) {
      container.innerHTML = `<p style="color:var(--muted)">${l('لا توجد سجلات مالية بعد', 'Aucun journal financier')}</p>`;
      return;
    }
    container.innerHTML = `<div class="table-wrap"><table class="data-table">
      <thead><tr><th>${l('التاريخ', 'Date')}</th><th>${l('الحدث', 'Événement')}</th><th>${l('الكيان', 'Entité')}</th><th>${l('المبلغ', 'Montant')}</th><th>${l('المسؤول', 'Utilisateur')}</th><th>${l('التفاصيل', 'Détails')}</th></tr></thead>
      <tbody>${rows.map((r) => `<tr>
        <td>${fmtDate(r.created_at)}</td>
        <td><span class="badge st-info">${esc(r.action || '—')}</span></td>
        <td><small>${esc(r.entity_type || '—')} #${r.entity_id || '—'}</small></td>
        <td>${r.amount != null ? `<strong>${fmtAmount(r.amount)} MAD</strong>` : '—'}</td>
        <td>${userName(r.user_id)}</td>
        <td><small>${esc(r.description || r.details || '—')}</small></td>
      </tr>`).join('')}</tbody>
    </table></div>`;
  }

  /* ================================================================
     تقرير مالي للإجراء
     ================================================================ */
  async function openProcedureReport(procedureId) {
    if (!procedureId) {
      procedureId = Number(prompt(l('أدخل رقم الإجراء', 'Numéro de procédure')));
      if (!procedureId) return;
    }
    try {
      const report = await API.accountingProcedureReport(procedureId);
      modal.title.textContent = l('التقرير المالي للإجراء', 'Rapport financier de la procédure') + ' #' + procedureId;
      modal.body.innerHTML = `
        <div class="det-grid">
          <div class="det-item"><span>${l('الإجراء', 'Procédure')}</span><strong>#${procedureId}</strong></div>
          <div class="det-item"><span>${l('إجمالي المدفوعات', 'Total payé')}</span><strong style="color:var(--success)">${fmtAmount(report.totalPaid || 0)} MAD</strong></div>
          <div class="det-item"><span>${l('إجمالي المرتجعات', 'Total remboursé')}</span><strong style="color:var(--warning)">${fmtAmount(report.totalRefunded || 0)} MAD</strong></div>
          <div class="det-item"><span>${l('الصافي', 'Net')}</span><strong>${fmtAmount((report.totalPaid || 0) - (report.totalRefunded || 0))} MAD</strong></div>
        </div>
        ${(report.payments || []).length ? `
          <div class="det-section">
            <h5>${l('الأداءات', 'Paiements')}</h5>
            <div class="table-wrap"><table class="data-table">
              <thead><tr><th>#</th><th>${l('المبلغ', 'Montant')}</th><th>${l('التاريخ', 'Date')}</th><th>${l('الحالة', 'Statut')}</th></tr></thead>
              <tbody>${report.payments.map((p) => `<tr><td>#${p.id}</td><td>${fmtAmount(p.amount)} MAD</td><td>${fmtDate(p.payment_date)}</td><td>${payBadge(p.status)}</td></tr>`).join('')}</tbody>
            </table></div>
          </div>` : ''}
        ${(report.assessments || []).length ? `
          <div class="det-section">
            <h5>${l('التقييمات', 'Évaluations')}</h5>
            <div class="table-wrap"><table class="data-table">
              <thead><tr><th>#</th><th>${l('الإجمالي', 'Total')}</th><th>${l('التاريخ', 'Date')}</th><th>${l('الحالة', 'Statut')}</th></tr></thead>
              <tbody>${report.assessments.map((a) => `<tr><td>#${a.id}</td><td>${fmtAmount(a.total_amount)} MAD</td><td>${fmtDate(a.created_at)}</td><td>${assessBadge(a.status)}</td></tr>`).join('')}</tbody>
            </table></div>
          </div>` : ''}`;
      modal.footer.innerHTML = `<button class="btn btn-ghost" data-modal-cancel>${t('common.cancel')}</button>`;
      openModal();
      modal.footer.querySelector('[data-modal-cancel]').addEventListener('click', closeModal);
    } catch (e) { toast(e.message || e, true); }
  }

  /* ================================================================
     التعريفات والقواعد
     ================================================================ */
  async function loadTariffs() {
    try {
      const tariffs = await API.tariffList({});
      renderTariffs(tariffs || []);
      const rules = await API.tariffRules();
      renderRules(rules || []);
    } catch (e) { toast(t('finance.errors.load'), true); }
  }

  function renderTariffs(rows) {
    byId('fin-tariff-thead').innerHTML = `<tr>
      <th>${t('finance.tariffs.code')}</th>
      <th>${t('finance.tariffs.nameAr')}</th>
      <th>${t('finance.tariffs.defaultAmount')}</th>
      <th>${t('finance.tariffs.currency')}</th>
      <th>${l('الحالة', 'Statut')}</th>
      <th></th>
    </tr>`;

    if (!rows.length) {
      byId('fin-tariff-tbody').innerHTML = '';
      byId('fin-tariff-empty').classList.remove('hidden');
      return;
    }

    byId('fin-tariff-empty').classList.add('hidden');
    byId('fin-tariff-tbody').innerHTML = rows.map((t) => `
      <tr>
        <td><code>${esc(t.code)}</code></td>
        <td><strong>${esc(t.name_ar)}</strong><br><small class="muted">${esc(t.name_fr)}</small></td>
        <td><strong>${fmtAmount(t.default_amount)}</strong></td>
        <td>${esc(t.currency)}</td>
        <td>${t.active ? `<span class="badge st-success">${l('نشط', 'Actif')}</span>` : `<span class="badge st-danger">${l('معطّل', 'Inactif')}</span>`}</td>
        <td><div class="row-actions">
          <button class="row-btn" data-fin-tariff-edit="${t.id}" title="${t('common.edit')}"><i class="fas fa-pen"></i></button>
          <button class="row-btn del" data-fin-tariff-del="${t.id}" title="${t('common.delete')}"><i class="fas fa-trash"></i></button>
        </div></td>
      </tr>`).join('');

    byId('fin-tariff-tbody').querySelectorAll('[data-fin-tariff-del]').forEach((b) => {
      b.onclick = async () => {
        const id = Number(b.getAttribute('data-fin-tariff-del'));
        if (!confirm(l('هل تريد حذف هذه التعريفة؟', 'Supprimer cette tarification ?'))) return;
        try {
          await API.tariffDelete(id);
          toast(l('تم الحفظ', 'Supprimé'));
          await loadTariffs();
        } catch (e) { toast(e.message || e, true); }
      };
    });

    byId('fin-tariff-tbody').querySelectorAll('[data-fin-tariff-edit]').forEach((b) => {
      b.onclick = async () => {
        const id = Number(b.getAttribute('data-fin-tariff-edit'));
        const item = rows.find((r) => r.id === id);
        if (item) openTariffModal(item);
      };
    });
  }

  function renderRules(rows) {
    byId('fin-rule-thead').innerHTML = `<tr>
      <th>${t('finance.tariffs.code')}</th>
      <th>${l('نوع الإجراء', 'Type de procédure')}</th>
      <th>${t('finance.rules.overrideAmount')}</th>
      <th></th>
    </tr>`;

    if (!rows.length) {
      byId('fin-rule-tbody').innerHTML = '';
      byId('fin-rule-empty').classList.remove('hidden');
      return;
    }

    byId('fin-rule-empty').classList.add('hidden');
    byId('fin-rule-tbody').innerHTML = rows.map((r) => `
      <tr>
        <td><strong>${esc(r.tariff_name_ar || r.code || '—')}</strong></td>
        <td>${esc(state.lang === 'fr' ? (r.type_name_fr || r.type_name_ar || 'Général') : (r.type_name_ar || r.type_name_fr || 'عام'))}</td>
        <td>${r.override_amount != null ? `<strong>${fmtAmount(r.override_amount)}</strong> <small class="muted">(${l('بديل', 'remplace')})</small>` : `<small class="muted">${l('الافتراضي', 'Défaut')}: ${fmtAmount(r.default_amount)}</small>`}</td>
        <td><div class="row-actions">
          <button class="row-btn del" data-fin-rule-del="${r.id}" title="${l('حذف', 'Supprimer')}"><i class="fas fa-trash"></i></button>
        </div></td>
      </tr>`).join('');

    byId('fin-rule-tbody').querySelectorAll('[data-fin-rule-del]').forEach((b) => {
      b.onclick = async () => {
        const id = Number(b.getAttribute('data-fin-rule-del'));
        if (!confirm(l('هل تريد حذف هذه القاعدة؟', 'Supprimer cette règle ?'))) return;
        try {
          await API.tariffRuleDelete(id);
          toast(l('تم الحفظ', 'Supprimé'));
          await loadTariffs();
        } catch (e) { toast(e.message || e, true); }
      };
    });
  }

  /* ---------- نموذج التعريفة ---------- */
  function openTariffModal(item) {
    const isEdit = item && item.id;
    modal.title.textContent = isEdit ? l('تعديل التعريفة', 'Modifier la tarification') : l('تعريفة جديدة', 'Nouvelle tarification');
    const d = item || {};
    modal.body.innerHTML = `
      <div class="form-grid" style="grid-template-columns:1fr">
        ${field('ft-code', 'finance.tariffs.code', d.code || '', 'text')}
        ${field('ft-nameAr', 'finance.tariffs.nameAr', d.name_ar || '', 'text')}
        ${field('ft-nameFr', 'finance.tariffs.nameFr', d.name_fr || '', 'text')}
        ${field('ft-amount', 'finance.tariffs.defaultAmount', d.default_amount || '', 'number')}
        ${field('ft-currency', 'finance.tariffs.currency', d.currency || 'MAD', 'text')}
      </div>`;
    modal.footer.innerHTML = `
      <button class="btn btn-ghost" data-modal-cancel>${t('common.cancel')}</button>
      <button class="btn btn-primary" data-modal-ok>${t('common.save')}</button>`;
    openModal();
    modal.footer.querySelector('[data-modal-cancel]').addEventListener('click', closeModal);
    modal.footer.querySelector('[data-modal-ok]').addEventListener('click', async () => {
      const payload = {
        code: byId('ft-code').value.trim(),
        nameAr: byId('ft-nameAr').value.trim(),
        nameFr: byId('ft-nameFr').value.trim(),
        defaultAmount: Number(byId('ft-amount').value) || 0,
        currency: byId('ft-currency').value.trim() || 'MAD'
      };
      if (!payload.code || !payload.nameAr || !payload.nameFr) {
        toast(l('الحقول المطلوبة: الكود، الاسم بالعربية، الاسم بالفرنسية', 'Champs requis'), true); return;
      }
      try {
        if (isEdit) await API.tariffUpdate(item.id, payload);
        else await API.tariffAdd(payload);
        closeModal();
        toast(t('common.save'));
        await loadTariffs();
      } catch (e) { toast(e.message || e, true); }
    });
  }

  /* ---------- نموذج القاعدة ---------- */
  function openRuleModal() {
    modal.title.textContent = l('قاعدة ربط جديدة', 'Nouvelle règle');
    modal.body.innerHTML = `
      <div class="form-grid" style="grid-template-columns:1fr">
        <div class="form-field">
          <label>${l('التعريفة', 'Tarification')}</label>
          <select class="form-input" id="fr-tariff"><option value="">—</option></select>
        </div>
        <div class="form-field">
          <label>${l('نوع الإجراء', 'Type de procédure')}</label>
          <select class="form-input" id="fr-type"><option value="">${l('عام (لكل الأنواع)', 'Général')}</option></select>
        </div>
        ${field('fr-amount', 'finance.rules.overrideAmount', '', 'number')}
      </div>`;
    modal.footer.innerHTML = `
      <button class="btn btn-ghost" data-modal-cancel>${t('common.cancel')}</button>
      <button class="btn btn-primary" data-modal-ok>${t('common.save')}</button>`;

    /* تعبئة القوائم */
    API.tariffList({}).then((tariffs) => {
      const sel = byId('fr-tariff');
      (tariffs || []).forEach((tt) => {
        const opt = document.createElement('option');
        opt.value = tt.id;
        opt.textContent = tt.name_ar + ' (' + tt.code + ')';
        sel.appendChild(opt);
      });
    });
      API.configSnapshot().then((cfg) => {
      const sel = byId('fr-type');
      (cfg.types || []).forEach((tp) => {
        const opt = document.createElement('option');
        opt.value = tp.id;
        opt.textContent = l(tp.name_ar, tp.name_fr);
        sel.appendChild(opt);
      });
    }).catch(() => {});

    openModal();
    modal.footer.querySelector('[data-modal-cancel]').addEventListener('click', closeModal);
    modal.footer.querySelector('[data-modal-ok]').addEventListener('click', async () => {
      const tariffId = Number(byId('fr-tariff').value);
      const procedureTypeId = byId('fr-type').value ? Number(byId('fr-type').value) : null;
      const overrideAmount = byId('fr-amount').value ? Number(byId('fr-amount').value) : null;
      if (!tariffId) { toast(l('اختر التعريفة', 'Choisir une tarification'), true); return; }
      try {
        await API.tariffRuleAdd({ tariffId, procedureTypeId, overrideAmount });
        closeModal();
        toast(t('common.save'));
        await loadTariffs();
      } catch (e) { toast(e.message || e, true); }
    });
  }

  /* ================================================================
     الدفتر المحاسبي
     ================================================================ */
  async function loadLedger() {
    try {
      const [summary, dashboard, records] = await Promise.all([
        API.accountingSummary({}),
        API.accountingDashboard(),
        API.accountingList({ page: 1, pageSize: 100 })
      ]);
      renderSummary(summary);
      renderDashboard(dashboard);
      renderLedger(records.rows || []);
    } catch (e) { toast(t('finance.errors.load'), true); }
  }

  function renderSummary(s) {
    byId('fin-summary-body').innerHTML = `
      <div class="det-item"><span>${l('الإيرادات', 'Recettes')}</span><strong style="color:var(--success)">${fmtAmount(s.income)} MAD</strong></div>
      <div class="det-item"><span>${l('المصروفات', 'Dépenses')}</span><strong style="color:var(--danger)">${fmtAmount(s.expense)} MAD</strong></div>
      <div class="det-item"><span>${l('المرتجعات', 'Remboursements')}</span><strong style="color:var(--warning)">${fmtAmount(s.refund)} MAD</strong></div>
      <div class="det-item"><span>${l('الصافي', 'Net')}</span><strong>${fmtAmount(s.net)} MAD</strong></div>`;
  }

  function renderDashboard(d) {
    byId('fin-dashboard-body').innerHTML = `
      <div class="det-item"><span>${l('إجمالي الأداءات', 'Total paiements')}</span><strong>${d.totalPayments || 0}</strong></div>
      <div class="det-item"><span>${t('finance.stats.pending')}</span><strong>${d.pendingPayments || 0}</strong></div>
      <div class="det-item"><span>${t('finance.stats.confirmed')}</span><strong>${d.confirmedPayments || 0}</strong></div>
      <div class="det-item"><span>${l('اليوم', "Aujourd'hui")}</span><strong>${fmtAmount(d.todayTotal)} MAD</strong></div>
      <div class="det-item"><span>${l('هذا الأسبوع', 'Cette semaine')}</span><strong>${fmtAmount(d.weekTotal)} MAD</strong></div>
      <div class="det-item"><span>${l('هذا الشهر', 'Ce mois')}</span><strong>${fmtAmount(d.monthTotal)} MAD</strong></div>
      <div class="det-item"><span>${l('إجمالي المرتجعات', 'Total remboursé')}</span><strong>${fmtAmount(d.totalRefunded)} MAD</strong></div>
      <div class="det-item"><span>${l('تقييمات مسودة', 'Évaluations brouillon')}</span><strong>${d.assessmentsDraft || 0}</strong></div>`;
  }

  function renderLedger(rows) {
    byId('fin-ledger-thead').innerHTML = `<tr>
      <th>${t('finance.payments.col.num')}</th>
      <th>${t('finance.ledger.col.date')}</th>
      <th>${t('finance.ledger.col.type')}</th>
      <th>${l('المبلغ', 'Montant')}</th>
      <th>${t('finance.ledger.col.description')}</th>
      <th>${l('الإجراء', 'Procédure')}</th>
      <th>${l('المسؤول', 'Enregistré par')}</th>
    </tr>`;

    if (!rows.length) {
      byId('fin-ledger-tbody').innerHTML = '';
      byId('fin-ledger-empty').classList.remove('hidden');
      byId('fin-ledger-count').textContent = '0';
      return;
    }

    byId('fin-ledger-empty').classList.add('hidden');
    byId('fin-ledger-tbody').innerHTML = rows.map((r) => `
      <tr>
        <td><strong>#${r.id}</strong></td>
        <td>${fmtDate(r.recorded_at)}</td>
        <td>${typeBadge(r.type)}</td>
        <td><strong>${fmtAmount(r.amount)} ${esc(r.currency || 'MAD')}</strong></td>
        <td><small>${esc(r.description || '—')}</small></td>
        <td><small>${esc(r.procedure_number || '—')}</small></td>
        <td>${userName(r.recorded_by)}</td>
      </tr>`).join('');

    byId('fin-ledger-count').textContent = rows.length;
  }

  /* ================================================================
     التهيئة والربط
     ================================================================ */
  async function init() {
    try {
      const cfg = await API.configSnapshot();
      config.types = cfg.types || [];
      config.procedures = cfg.procedures || [];
    } catch (e) { /* silent */ }
    bindTabs();
    wireFilters();

    byId('fin-tariff-add').onclick = () => openTariffModal(null);
    byId('fin-rule-add').onclick = () => openRuleModal();

    const createAssessBtn = byId('fin-assess-create');
    if (createAssessBtn) createAssessBtn.onclick = () => openCreateAssessmentModal();

    const addMethodBtn = byId('fin-method-add');
    if (addMethodBtn) addMethodBtn.onclick = () => openAddPaymentMethodModal();

    const procReportBtn = byId('fin-proc-report');
    if (procReportBtn) procReportBtn.onclick = () => openProcedureReport();
  }

  async function render() {
    await loadStats();
    await loadTab();
  }

  window.FinanceModule = { init, render };
})();
