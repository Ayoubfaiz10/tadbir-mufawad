/* ================================================================
   وحدة الإجراءات — ProceduresModule
   القائمة + الإحصائيات + البحث + التصفية + معالج الإنشاء (Wizard)
   + التفاصيل + تغيير الحالة + المحاضر + الأداءات + الوصولات + الأرشيف.
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
  let config = { categories: [], types: [], statuses: [], transitions: [], templates: [], users: [] };
  let filters = { q: '', category: '', typeId: '', status: '', dateRange: '', from: '', to: '', assignedTo: '' };
  let page = 1, pageSize = 25, total = 0, rows = [], loading = false;
  let searchTimer = null;

  /* ---------- تفاصيل ---------- */
  const TABS = ['info', 'timeline', 'parties', 'documents', 'payments', 'audit'];
  let detail = null;
  let detailTab = 'info';

  /* ---------- المعالج ---------- */
  const w = { category: null, categoryObj: null, typeId: null, dossier: null, parties: [], partiesLoaded: false, partyIds: [], fieldValues: {} };
  let wStep = 1;
  let wizAct = 'next';

  const PAY_STATUS = { paid: 0, pending: 1, cancelled: 2, PENDING: 1, CONFIRMED: 0, PAID: 0, CANCELLED: 2, REFUNDED: 3 };

  /* ---------- أدوات مساعدة ---------- */
  function typeSel(typeId) { return config.types.find((x) => x.id === Number(typeId)); }
  function typeName(tp) { return tp ? l(tp.name_ar, tp.name_fr) : '—'; }
  function statusLabel(code) {
    const s = config.statuses.find((x) => x.code === code);
    return s ? l(s.name_ar, s.name_fr) : esc(code);
  }
  function statusColor(code) {
    const s = config.statuses.find((x) => x.code === code);
    return (s && s.color) || 'gray';
  }
  function stBadge(code) { return `<span class="badge st-${statusColor(code)}">${esc(statusLabel(code))}</span>`; }
  function catLabel(ar, fr) { return l(ar, fr); }
  function fmtAmount(n) {
    const v = Number(n || 0);
    try { return v.toLocaleString(state.lang === 'ar' ? 'ar-MA' : 'fr-MA'); } catch (e) { return String(v); }
  }
  function userName(u) {
    const uu = (config.users || []).find((x) => x.username === u);
    return esc(uu ? uu.display_name || uu.username : u || '—');
  }
  function payStatusLabel(s) {
    const arr = t('procDetails.payments.statuses');
    const i = PAY_STATUS[s];
    return (i !== undefined && arr && arr[i]) ? arr[i] : esc(s);
  }
  function payMethodLabel(m) {
    const arr = t('procDetails.payments.methods');
    if (m && arr) { const i = arr.indexOf(m); if (i >= 0) return arr[i]; }
    return esc(m || '—');
  }
  function fieldLabel(f) { return l(f.label_ar, f.label_fr); }
  function isNum(v) { return /^[\d.]+$/.test(String(v)); }

  /* ================================================================
     الإحصائيات والقائمة
     ================================================================ */
  function renderHeaders() {
    byId('proc-thead').innerHTML = `<tr>${t('procedures.columns').map((c) => `<th>${esc(c)}</th>`).join('')}</tr>`;
  }

  async function loadStats() {
    try {
      const s = await API.procStats();
      byId('procstat-total').textContent = s.total;
      byId('procstat-today').textContent = s.today;
      byId('procstat-progress').textContent = s.inProgress;
      byId('procstat-complete').textContent = s.completed;
      byId('procstat-postponed').textContent = s.postponed;
    } catch (e) { toast(t('procedures.errors.load'), true); }
  }

  async function loadList(append) {
    if (loading) return;
    loading = true;
    try {
      const res = await API.procList({ ...filters, page: append ? page + 1 : 1, pageSize });
      total = res.total;
      rows = append ? rows.concat(res.rows) : res.rows;
      page = res.page;
      renderTable();
      byId('proc-count').textContent = `${t('procedures.showing')} ${rows.length} ${t('procedures.of')} ${total} ${t('procedures.items')}`;
      byId('proc-more').style.display = rows.length < total ? '' : 'none';
      byId('proc-empty').classList.toggle('hidden', rows.length > 0);
      renderFilterChip();
    } catch (e) { toast(t('procedures.errors.load'), true); }
    finally { loading = false; }
  }

  function renderTable() {
    byId('proc-tbody').innerHTML = rows.length
      ? rows.map((p) => `
        <tr>
          <td><strong>${esc(p.procedure_number)}</strong></td>
          <td>
            <div class="cell-stack">
              <strong>${esc(p.dossier_number || '—')}</strong>
              <small>${esc(p.dossier_demandeur || p.dossier_defendeur || '')}</small>
            </div>
          </td>
          <td>${esc(typeName(p))}</td>
          <td><span class="cat-tag">${esc(catLabel(p.category_name_ar, p.category_name_fr))}</span></td>
          <td>${esc(p.requested_by || '—')}</td>
          <td>${Number(p.parties_count || 0)}</td>
          <td>${fmtDate(p.created_at)}</td>
          <td>${stBadge(p.status)}</td>
          <td><strong>${fmtAmount(p.amount)} <small class="muted">${esc(p.currency || '')}</small></strong></td>
          <td class="muted-cell">${fmtDate(p.updated_at)}</td>
          <td><div class="row-actions">
            <button class="row-btn edit" data-proc-action="${p.id}" data-role="view" title="${t('procedures.actions.view')}"><i class="fas fa-eye"></i></button>
            <button class="row-btn" data-proc-action="${p.id}" data-role="edit" title="${t('procedures.actions.edit')}"><i class="fas fa-pen"></i></button>
            <button class="row-btn" data-proc-action="${p.id}" data-role="pv" title="${t('procedures.actions.pv')}"><i class="fas fa-clipboard-list"></i></button>
            <button class="row-btn" data-proc-action="${p.id}" data-role="pay" title="${t('procedures.actions.payment')}"><i class="fas fa-coins"></i></button>
            <button class="row-btn del" data-proc-action="${p.id}" data-role="del" title="${t('procedures.actions.delete')}"><i class="fas fa-trash"></i></button>
          </div></td>
        </tr>`).join('')
      : '';
  }

  function renderFilterChip() {
    const chip = byId('proc-filter-chip');
    const active = ['category', 'typeId', 'status', 'dateRange', 'assignedTo'].filter((k) => filters[k]);
    chip.removeAttribute('hidden');
    chip.innerHTML = `${active.length ? `${active.length} ` : ''}<i class="fas fa-filter"></i> `;
    const clear = document.createElement('button');
    clear.className = 'chip-clear';
    clear.innerHTML = '<i class="fas fa-xmark"></i>';
    clear.title = t('procedures.clearFilters');
    clear.onclick = () => { filters = { q: filters.q, category: '', typeId: '', status: '', dateRange: '', from: '', to: '', assignedTo: '' }; render(); };
    chip.appendChild(clear);
    chip.style.display = active.length ? 'inline-flex' : 'none';
  }

  /* ---------- تصفية (Modal عام) ---------- */
  function openFilterModal() {
    modal.title.textContent = t('procedures.filters.title');
    renderFilterBody();
    modal.footer.innerHTML = `
      <button class="btn btn-ghost" data-fclear>${t('procedures.clearFilters')}</button>
      <button class="btn btn-primary" data-fapply>${t('procedures.filters.apply')}</button>`;
    openModal();
    byId('modal-body').querySelectorAll('[data-fclear],[data-fapply]');
    modal.footer.querySelector('[data-fclear]').addEventListener('click', () => {
      const keep = filters.q;
      filters = { q: keep, category: '', typeId: '', status: '', dateRange: '', from: '', to: '', assignedTo: '' };
      closeModal();
      render();
    });
    modal.footer.querySelector('[data-fapply]').addEventListener('click', () => {
      filters.category = byId('flt-category') ? byId('flt-category').value : filters.category;
      filters.typeId = byId('flt-type') ? byId('flt-type').value : filters.typeId;
      filters.status = byId('flt-status').value;
      filters.dateRange = byId('flt-range').value;
      const custom = filters.dateRange === 'custom';
      filters.from = custom && byId('flt-from') ? byId('flt-from').value : '';
      filters.to = custom && byId('flt-to') ? byId('flt-to').value : '';
      filters.assignedTo = byId('flt-user').value;
      closeModal();
      render();
    });
  }

  function renderFilterBody() {
    const catOps = config.categories.map((c) => ({ v: c.id, l: l(c.name_ar, c.name_fr) }));
    const cats = [{ v: '', l: t('procedures.filters.allCategories') }].concat(catOps);
    const selCat = filters.category || '';
    const types = config.types.filter((x) => Number(x.category_id) === Number(selCat));
    const typeOps = [{ v: '', l: t('procedures.filters.allTypes') }].concat(
      types.map((x) => ({ v: x.id, l: typeName(x) }))
    );
    const stats = config.statuses.filter((s) => s.active);
    const stOps = [{ v: '', l: t('procedures.filters.allStatuses') }].concat(
      stats.map((s) => ({ v: s.code, l: l(s.name_ar, s.name_fr) }))
    );
    const userOps = [{ v: '', l: t('procedures.filters.allUsers') }].concat(
      (config.users || []).filter((u) => u.active).map((u) => ({ v: u.username, l: u.display_name || u.username }))
    );
    const ranges = ['today', 'week', 'month', 'custom'].map((k) => ({ v: k, l: t('procedures.filters.' + k) }));

    modal.body.innerHTML = `
      <div class="form-grid" style="grid-template-columns:1fr">
        ${field('flt-category', 'procedures.filters.category', selCat, 'select', cats)}
        <div id="flt-type-wrap">${field('flt-type', 'procedures.filters.type', filters.typeId || '', 'select', typeOps)}</div>
        ${field('flt-status', 'procedures.filters.status', filters.status || '', 'select', stOps)}
        ${field('flt-range', 'procedures.filters.dateRange', filters.dateRange || '', 'select', ranges)}
        <div class="range-row" id="flt-custom" style="${filters.dateRange === 'custom' ? '' : 'display:none'}">
          ${field('flt-from', 'procedures.filters.from', filters.from || '', 'date')}
          ${field('flt-to', 'procedures.filters.to', filters.to || '', 'date')}
        </div>
        ${field('flt-user', 'procedures.filters.user', filters.assignedTo || '', 'select', userOps)}
      </div>`;

    const cat = byId('flt-category');
    const typeWrap = byId('flt-type-wrap');
    cat.addEventListener('change', () => {
      const ts = config.types.filter((x) => Number(x.category_id) === Number(cat.value));
      typeWrap.innerHTML = field('flt-type', 'procedures.filters.type', '', 'select',
        [{ v: '', l: t('procedures.filters.allTypes') }].concat(ts.map((x) => ({ v: x.id, l: typeName(x) }))));
    });
    byId('flt-range').addEventListener('change', () => {
      byId('flt-custom').style.display = byId('flt-range').value === 'custom' ? '' : 'none';
    });
  }

  /* ================================================================
     حذف
     ================================================================ */
  async function deleteProc(id) {
    if (!confirm(t('procedures.deleteConfirm'))) return;
    try {
      await API.procDelete(id);
      toast(t('common.delete'));
      closeDetail();
      render();
    } catch (e) { toast(e.message || t('procedures.errors.permission'), true); }
  }

  /* ================================================================
     تفاصيل الإجراء
     ================================================================ */
  const dBackdrop = () => byId('detail-backdrop');
  const wBackdrop = () => byId('wizard-backdrop');

  async function openDetail(id) {
    try {
      detail = await API.procGet(id);
    } catch (e) { toast(t('procedures.errors.load'), true); return; }
    detailTab = 'info';
    dBackdrop().classList.add('show');
    await renderDetailShell();
  }

  function closeDetail() { dBackdrop().classList.remove('show'); detail = null; }

  async function renderDetailShell() {
    byId('detail-title').innerHTML = `${esc(detail.procedure_number)} ${stBadge(detail.status)}`;
    byId('detail-tabs').innerHTML = TABS.map((k) =>
      `<button class="dtab ${k === detailTab ? 'active' : ''}" data-tab="${k}">${esc(t('procDetails.' + k))}</button>`).join('');
    byId('detail-body').innerHTML = await renderDetailBody();
    byId('detail-footer').innerHTML = `
      <button class="btn btn-ghost" data-df="edit" title="${t('procDetails.btnEdit')}"><i class="fas fa-pen"></i>${t('procDetails.btnEdit')}</button>
      <button class="btn btn-ghost" data-df="status" title="${t('procDetails.btnStatus')}"><i class="fas fa-arrows-turn-right"></i>${t('procDetails.btnStatus')}</button>
      <button class="btn btn-ghost" data-df="pv" title="${t('procDetails.btnPv')}"><i class="fas fa-clipboard-list"></i>${t('procDetails.btnPv')}</button>
      <button class="btn btn-ghost" data-df="pay" title="${t('procDetails.btnPayment')}"><i class="fas fa-coins"></i>${t('procDetails.btnPayment')}</button>
      <button class="btn btn-danger" data-df="del" title="${t('procDetails.btnDelete')}"><i class="fas fa-trash"></i></button>`;
  }

  async function renderDetailBody() {
    const body = byId('detail-body');
    switch (detailTab) {
      case 'info': body.innerHTML = infoHtml(); break;
      case 'timeline': body.innerHTML = timelineHtml(); break;
      case 'parties': body.innerHTML = partiesHtml(); break;
      case 'documents': body.innerHTML = await documentsHtml(); break;
      case 'payments': body.innerHTML = paymentsHtml(); break;
      case 'audit': body.innerHTML = await auditHtml(); break;
    }
    bindDetailActions();
    return body.innerHTML;
  }

  function fv(key) {
    const f = (detail.fieldValues || []).find((x) => x.field_key === key);
    return f ? f.value : '';
  }

  function infoHtml() {
    const startTime = detail.started_at ? `<div class="det-item"><span>${t('procDetails.dfields.started')}</span><strong>${fmtDate(detail.started_at)}</strong></div>` : '';
    const endTime = detail.completed_at ? `<div class="det-item"><span>${t('procDetails.dfields.completed')}</span><strong>${fmtDate(detail.completed_at)}</strong></div>` : '';
    return `
      <div class="det-grid">
        <div class="det-item"><span>${t('procDetails.dfields.number')}</span><strong>${esc(detail.procedure_number)}</strong></div>
        <div class="det-item"><span>${t('procDetails.dfields.dossier')}</span><strong>${esc(detail.dossier ? (detail.dossier.numero || '—') : '—')}</strong></div>
        <div class="det-item"><span>${t('procDetails.dfields.category')}</span><strong>${esc(catLabel(detail.category.name_ar, detail.category.name_fr))}</strong></div>
        <div class="det-item"><span>${t('procDetails.dfields.type')}</span><strong>${esc(typeName(detail.type))}</strong></div>
        <div class="det-item"><span>${t('procDetails.dfields.status')}</span><strong>${stBadge(detail.status)}</strong></div>
        <div class="det-item"><span>${t('procDetails.dfields.requester')}</span><strong>${esc(detail.requested_by || '—')}</strong></div>
        <div class="det-item"><span>${t('procDetails.dfields.created')}</span><strong>${fmtDate(detail.created_at)}</strong></div>
        <div class="det-item"><span>${t('procDetails.dfields.updated')}</span><strong>${fmtDate(detail.updated_at)}</strong></div>
        ${startTime}
        ${endTime}
        <div class="det-item"><span>${t('procDetails.dfields.createdBy')}</span><strong>${userName(detail.created_by)}</strong></div>
        <div class="det-item"><span>${t('procDetails.dfields.assignedTo')}</span><strong>${userName(detail.assigned_to)}</strong></div>
        <div class="det-item"><span>${t('procDetails.dfields.amount')}</span><strong>${fmtAmount(detail.amount)} ${esc(detail.currency || '')}</strong></div>
        <div class="det-item full"><span>${t('procDetails.dfields.notes')}</span><strong class="wht">${esc(detail.notes || '—')}</strong></div>
      </div>
      <div class="det-section">
        <h5>${t('procDetails.statusHistory')}</h5>
        ${statusHistoryHtml()}
      </div>
      <div class="det-section">
        <h5>${t('procDetails.dfields.type')} — ${t('wizard.step5.fields')}</h5>
        ${dynFieldsHtml()}
      </div>`;
  }

  function statusHistoryHtml() {
    const evs = (detail.statusHistory && detail.statusHistory.length ? detail.statusHistory
      : (detail.timeline || []).filter((e) => e.type === 'status'));
    if (!evs.length) return `<p class="hint">${t('procDetails.emptyTimeline')}</p>`;
    return `<div class="mini-timeline">${evs.reverse().map((e) => `
      <div class="mt-row">
        <span class="mt-node st-${statusColor(e.to_status)}"></span>
        <div>
          <strong>${esc(statusLabel(e.to_status))}</strong>
          ${e.from_status ? `<small>${esc(statusLabel(e.from_status))} → </small>` : ''}
          <small>${fmtDate(e.changed_at || e.date)} · ${userName(e.by_user || e.user)}</small>
          ${esc(e.note || '')}
        </div>
      </div>`).join('')}</div>`;
  }

  function dynFieldsHtml() {
    const vals = detail.fieldValues || [];
    if (!vals.length) return `<p class="hint">—</p>`;
    return `<div class="det-grid">${vals.map((f) => `
      <div class="det-item"><span>${esc(fieldLabel(f))}</span><strong>${esc(f.value || '—')}</strong></div>`).join('')}</div>`;
  }

  function timelineHtml() {
    const evs = detail.timeline || [];
    if (!evs.length) return `<p class="hint">${t('procDetails.emptyTimeline')}</p>`;
    const icon = (e) => {
      if (e.status || e.type === 'status') return 'fa-arrows-turn-right st-' + statusColor(e.to_status || e.status);
      const act = e.text || '';
      if (act.includes('payment')) return 'fa-coins';
      if (act.includes('receipt')) return 'fa-receipt';
      if (act.includes('pv') || act.includes('document')) return 'fa-file-lines';
      return 'fa-circle';
    };
    return `<div class="tl">${evs.map((e) => `
      <div class="tl-row">
        <div class="tl-icon"><i class="fas ${icon(e)}"></i></div>
        <div class="tl-body">
          <strong>${esc(actLabel(e.text))}</strong>
          ${e.status ? `<span class="badge st-${statusColor(e.to_status || e.status)}">${esc(statusLabel(e.to_status || e.status))}</span>` : ''}
          <p>${esc(descText(e.desc, e.text))}</p>
          <small>${fmtDate(e.date)} · ${userName(e.user)}</small>
        </div>
      </div>`).join('')}</div>`;
  }

  function actLabel(raw) {
    if (!raw) return '—';
    if (/(from)/i.test(raw) && /status/i.test(String(raw))) return esc(raw);
    return esc(String(raw).replace(/\./g, ' · '));
  }

  function descText(desc, text) {
    if (typeof desc === 'string' && desc && desc !== text) return desc;
    if (desc && typeof desc === 'object') {
      try { return esc(JSON.stringify(desc).slice(0, 160)); } catch (e) { return ''; }
    }
    return '';
  }

  function partiesHtml() {
    const pts = detail.parties || [];
    if (!pts.length) return `<p class="hint">${t('wizard.step3.noParties')}</p>`;
    return `<table class="data-table">
      <thead><tr><th>${t('wizard.step3.name')}</th><th>CIN</th><th>${t('wizard.step3.address')}</th><th>${t('wizard.step3.phone')}</th></tr></thead>
      <tbody>${pts.map((p) => `
        <tr>
          <td><strong>${esc(p.name)}</strong> ${p.link_role ? `<span class="cat-tag">${esc(p.link_role)}</span>` : ''}</td>
          <td>${esc(p.cin || '—')}</td>
          <td>${esc(p.address || '—')}</td>
          <td>${esc(p.phone || '—')}</td>
        </tr>`).join('')}</tbody></table>`;
  }

  async function documentsHtml() {
    const docs = detail.documents || [];
    const groups = { pv: [], receipt: [], document: [], other: [] };
    docs.forEach((x) => { (groups[x.kind] ? groups[x.kind] : groups.other).push(x); });
    const rowsPer = (list) => list.length ? list.map((x, i) => `
      <tr>
        <td>${i + 1}</td>
        <td><strong>${esc(x.title || x.file_name)}</strong><br><small class="muted">${fmtDate(x.created_at)} · ${esc(x.kind || '')}</small></td>
        <td>${esc(x.archived ? t('procDetails.docs.generated') : '—')}</td>
        <td><div class="row-actions">
          <button class="row-btn" data-doc-action="${x.id}" data-op="open" title="${t('procDetails.docs.open')}"><i class="fas fa-folder-open"></i></button>
          <button class="row-btn" data-doc-action="${x.id}" data-op="download" title="${t('procDetails.docs.download')}"><i class="fas fa-download"></i></button>
          <button class="row-btn" data-doc-action="${x.id}" data-op="print" title="${t('procDetails.docs.print')}"><i class="fas fa-print"></i></button>
          <button class="row-btn del" data-doc-action="${x.id}" data-op="delete" title="${t('procDetails.docs.delete')}"><i class="fas fa-trash"></i></button>
        </div></td>
      </tr>`).join('') : `<tr><td colspan="4" class="muted-cell" style="text-align:center">${t('procDetails.emptyDocs')}</td></tr>`;

    const block = (label, list, icon) => `
      <div class="det-group">
        <h5><i class="fas ${icon}"></i> ${label} (${list.length})</h5>
        <div class="table-wrap"><table class="data-table"><tbody>${rowsPer(list)}</tbody></table></div>
      </div>`;

    return `
      <div class="det-actions">
        <button class="btn btn-primary" data-doc-newpv><i class="fas fa-clipboard-list"></i>${t('procDetails.btnPv')}</button>
      </div>
      ${block(t('procDetails.docs.pv'), groups.pv, 'fa-file-circle-check')}
      ${block(t('procDetails.docs.receipt'), groups.receipt, 'fa-receipt')}
      ${block(t('procDetails.docs.other'), groups.other, 'fa-file-lines')}`;
  }

  function paymentsHtml() {
    const pays = detail.payments || [];
    function payStatusBadge(s) {
      const colors = { PENDING: 'warning', CONFIRMED: 'info', PAID: 'success', CANCELLED: 'danger', REFUNDED: 'danger' };
      const labels = {
        PENDING: l('قيد الانتظار', 'En attente'),
        CONFIRMED: l('مؤكد', 'Confirmé'),
        PAID: l('محصّل', 'Payé'),
        CANCELLED: l('ملغى', 'Annulé'),
        REFUNDED: l('مسترد', 'Remboursé')
      };
      return `<span class="badge st-${colors[s] || 'gray'}">${esc(labels[s] || s)}</span>`;
    }
    return `
      <div class="det-actions">
        <button class="btn btn-primary" data-doc-newpay><i class="fas fa-coins"></i>${t('procDetails.payment.addPayment')}</button>
      </div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr>
          <th>${t('procDetails.payments.amount')}</th>
          <th>${t('procDetails.payments.method')}</th>
          <th>${t('procDetails.payments.date')}</th>
          <th>${t('procDetails.payments.status')}</th>
          <th>${t('procDetails.payments.reference')}</th>
          <th>${t('procDetails.payments.notes')}</th>
          <th></th>
        </tr></thead>
        <tbody>
          ${(pays.length ? pays : [null]).map((p) => p ? `
            <tr>
              <td><strong>${fmtAmount(p.amount)} ${esc(detail.currency || '')}</strong></td>
              <td>${payMethodLabel(p.method)}</td>
              <td>${fmtDate(p.payment_date)}</td>
              <td>${payStatusBadge(p.status)}</td>
              <td>${esc(p.reference || '—')}</td>
              <td><small>${esc(p.notes || '—')}</small></td>
              <td><div class="row-actions">
                ${p.status === 'PENDING' ? `<button class="row-btn" data-pay-confirm="${p.id}" title="${l('تأكيد', 'Confirmer')}"><i class="fas fa-check"></i></button>` : ''}
                ${p.status === 'PENDING' ? `<button class="row-btn del" data-pay-cancel="${p.id}" title="${l('إلغاء', 'Annuler')}"><i class="fas fa-ban"></i></button>` : ''}
                <button class="row-btn" data-receipt="${p.id}" title="${t('procDetails.btnReceipt')}"><i class="fas fa-receipt"></i></button>
              </div></td>
            </tr>` : `<tr><td colspan="7" class="muted-cell" style="text-align:center">${t('procDetails.emptyPayments')}</td></tr>`).join('')}
        </tbody></table></div>
      ${receiptsHtml()}`;
  }

  function receiptsHtml() {
    const receipts = detail.receipts || [];
    if (!receipts.length) return '';
    return `
      <div class="det-group">
        <h5><i class="fas fa-receipt"></i> ${t('procDetails.docs.receipt')} (${receipts.length})</h5>
        <div class="table-wrap"><table class="data-table"><tbody>
          ${receipts.map((r) => `
            <tr>
              <td><strong>${esc(r.receipt_number)}</strong><br><small class="muted">${fmtDate(r.generated_at)}</small></td>
              <td>${fmtAmount(r.amount)} ${esc(detail.currency || '')}</td>
              <td>${payMethodLabel(r.method)}</td>
              <td><div class="row-actions">
                <button class="row-btn" data-doc-action="${r.document_id}" data-op="open" title="${t('procDetails.docs.open')}"><i class="fas fa-folder-open"></i></button>
                <button class="row-btn" data-doc-action="${r.document_id}" data-op="print" title="${t('procDetails.docs.print')}"><i class="fas fa-print"></i></button>
              </div></td>
            </tr>`).join('')}
        </tbody></table></div>
      </div>`;
  }

  async function auditHtml() {
    let list;
    try { list = await API.auditProcedure(detail.id); } catch (e) { return `<p class="hint">—</p>`; }
    if (!list.length) return `<p class="hint">${t('procDetails.emptyTimeline')}</p>`;
    return `<div class="table-wrap"><table class="data-table">
      <thead><tr><th>${t('procDetails.timeline')}</th><th>${t('procDetails.dfields.createdBy')}</th><th>${t('common.actions')}</th></tr></thead>
      <tbody>${list.map((a) => `
        <tr>
          <td>${fmtDate(a.created_at)}</td>
          <td>${userName(a.by_user)}</td>
          <td><code class="audit-act">${esc(a.action)}</code></td>
        </tr>`).join('')}</tbody></table></div>`;
  }

  function bindDetailActions() {
    byId('detail-tabs').querySelectorAll('.dtab').forEach((b) => {
      b.onclick = () => { detailTab = b.getAttribute('data-tab'); renderDetailShell(); };
    });
    byId('detail-footer').querySelectorAll('[data-df]').forEach((b) => {
      b.onclick = () => boundFooterAction(b.getAttribute('data-df'));
    });
    const body = byId('detail-body');
    body.querySelectorAll('[data-doc-action]').forEach((b) => {
      b.onclick = () => docAction(b.getAttribute('data-op'), Number(b.getAttribute('data-doc-action')));
    });
    body.querySelectorAll('[data-doc-newpv]').forEach((b) => { b.onclick = () => openPvModal(detail.id, true); });
    body.querySelectorAll('[data-doc-newpay]').forEach((b) => { b.onclick = () => openPaymentModal(detail.id, true); });
    body.querySelectorAll('[data-receipt]').forEach((b) => { b.onclick = () => generateReceipt(Number(b.getAttribute('data-receipt'))); });
    body.querySelectorAll('[data-pay-confirm]').forEach((b) => {
      b.onclick = async () => {
        const id = Number(b.getAttribute('data-pay-confirm'));
        try { await API.payConfirm(id); toast(l('تم تأكيد الأداء', 'Paiement confirmé')); await openDetail(detail.id); }
        catch (e) { toast(e.message || e, true); }
      };
    });
    body.querySelectorAll('[data-pay-cancel]').forEach((b) => {
      b.onclick = async () => {
        const id = Number(b.getAttribute('data-pay-cancel'));
        if (!confirm(l('هل تريد إلغاء هذا الأداء؟', 'Voulez-vous annuler ce paiement ?'))) return;
        try { await API.payCancel(id, l('إلغاء من الإجراء', 'Annulation depuis la procédure')); toast(l('تم إلغاء الأداء', 'Paiement annulé')); await openDetail(detail.id); }
        catch (e) { toast(e.message || e, true); }
      };
    });
  }

  function boundFooterAction(act) {
    if (act === 'edit') openEditModal(detail.id, true);
    else if (act === 'status') openStatusModal(detail.id);
    else if (act === 'pv') openPvModal(detail.id, true);
    else if (act === 'pay') openPaymentModal(detail.id, true);
    else if (act === 'del') deleteProc(detail.id);
  }

  async function docAction(op, docId) {
    try {
      if (op === 'open') { await API.docOpen(docId); }
      else if (op === 'download') { const r = await API.docDownload(docId); if (!r || !r.ok) return; toast(t('common.save')); }
      else if (op === 'print') { await API.docPrint(docId); }
      else if (op === 'delete') {
        if (!confirm(t('dossiers.deleteConfirm'))) return;
        await API.docDelete(docId);
        toast(t('common.delete'));
        await openDetail(detail.id);
        return;
      }
    } catch (e) { toast(e.message || e, true); }
  }

  async function generateReceipt(paymentId) {
    try {
      await API.docGenerateReceipt(paymentId, state.lang);
      toast(t('procDetails.payment.receiptDone'));
      await openDetail(detail.id);
    } catch (e) { toast(e.message || e, true); }
  }

  /* ================================================================
     معالج إنشاء إجراء (Wizard)
     ================================================================ */
  function openWizard() {
    Object.assign(w, { category: null, categoryObj: null, typeId: null, dossier: null, parties: [], partiesLoaded: false, partyIds: [], fieldValues: {} });
    wStep = 1;
    wBackdrop().classList.add('show');
    renderWizard();
  }

  function closeWizard() { wBackdrop().classList.remove('show'); }

  function renderWizard() {
    renderWizardSteps();
    byId('wizard-body').innerHTML = renderWizardBody();
    renderWizardFooter();
  }

  function renderWizardSteps() {
    const labels = t('wizard.steps');
    byId('wizard-steps').innerHTML = labels.map((sLabel, i) => {
      const n = i + 1;
      return `<div class="wz-step ${n === wStep ? 'active' : ''} ${n < wStep ? 'done' : ''}"><span>${n}</span>${esc(sLabel)}</div>`;
    }).join('');
  }

  function renderWizardBody() {
    switch (wStep) {
      case 1: return wStep1();
      case 2: return wStep2Base();
      case 3: return wStep3();
      case 4: return wStep4();
      case 5: return wStep5();
    }
    return '';
  }

  function wStep1() {
    const cats = config.categories;
    return `
      <h4>${t('wizard.step1.title')}</h4>
      <div class="cat-cards">
        ${cats.map((c) => `
          <div class="cat-card ${w.category === c.id ? 'sel' : ''}" data-cat="${c.id}">
            <i class="fas ${c.code === 'JUDICIAL' ? 'fa-gavel' : 'fa-handshake'}"></i>
            <div><strong>${esc(l(c.name_ar, c.name_fr))}</strong>
              <small>${esc(c.code === 'JUDICIAL' ? t('wizard.step1.judicialDesc') : t('wizard.step1.directDesc'))}</small>
            </div>
          </div>`).join('')}
      </div>
      <div class="wiz-sub" id="wiz-types-wrap" style="${w.category ? '' : 'display:none'}">
        <h5>${t('wizard.step1.chooseType')}</h5>
        <div class="type-list" id="wiz-types">${typesHtml()}</div>
      </div>`;
  }

  function typesHtml() {
    const ts = config.types.filter((x) => Number(x.category_id) === Number(w.category));
    return ts.map((x) => `
      <label class="type-item ${w.typeId === x.id ? 'sel' : ''}">
        <input type="radio" name="wiz-type" value="${x.id}" ${w.typeId === x.id ? 'checked' : ''}>
        <div><strong>${esc(typeName(x))}</strong>
          <small>${esc(l(x.description_ar, x.description_fr) || '')}</small>
        </div>
      </label>`).join('');
  }

  function wStep2Base() {
    const d = w.dossier;
    return `
      <h4>${t('wizard.step2.title')}</h4>
      ${d ? `
        <div class="dos-selected">
          <div class="cell-stack">
            <strong>${esc(d.numero || '—')}</strong>
            <small>${esc([d.demandeur, d.defendeur].filter(Boolean).join(' · ') || '')}</small>
          </div>
          <span class="cat-tag">${esc(d.court || '')}</span>
          <button class="btn btn-ghost" data-dos-change>${t('wizard.step2.change')}</button>
        </div>` : `
        <div class="search-box"><i class="fas fa-search"></i>
          <input type="text" id="wiz-dos-search" placeholder="${t('wizard.step2.searchPlaceholder')}">
        </div>
        <div class="dos-results" id="wiz-dos-results"></div>`}`;
  }

  function wStep3() {
    const parties = w.parties || [];
    return `
      <h4>${t('wizard.step3.title')}</h4>
      <p class="hint">${t('wizard.step3.autoloaded')}</p>
      ${parties.length
        ? `<div class="party-checks">${parties.map((p) => `
            <label class="party-check ${w.partyIds.includes(p.id) ? 'sel' : ''}">
              <input type="checkbox" data-party="${p.id}" ${w.partyIds.includes(p.id) ? 'checked' : ''}>
              <div class="cell-stack">
                <strong>${esc(p.name)}</strong>
                <small>${esc([p.role, p.cin, p.address].filter(Boolean).join(' · ') || '')}</small>
              </div>
            </label>`).join('')}</div>`
        : `<p class="hint">${t('wizard.step3.noParties')}</p>`}`;
  }

  function wStep4() {
    const type = typeSel(w.typeId);
    const fieldsHtml = (type.fields || []).map((f) => {
      const val = w.fieldValues[f.field_key] || '';
      const req = f.required ? ' *' : '';
      let control = '';
      if (f.field_type === 'textarea') {
        control = `<textarea class="form-input" id="wiz-f-${f.field_key}" rows="2">${esc(val)}</textarea>`;
      } else if (f.field_type === 'select' && Array.isArray(f.options) && f.options.length) {
        control = `<select class="form-input" id="wiz-f-${f.field_key}"><option value="">—</option>${f.options.map((o) =>
          `<option value="${esc(o)}" ${String(o) === String(val) ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
      } else {
        const typeAttr = f.field_type === 'number' ? 'number' : f.field_type === 'date' ? 'date' : 'text';
        control = `<input class="form-input" id="wiz-f-${f.field_key}" type="${typeAttr}" value="${esc(val)}">`;
      }
      return `<div class="form-field">${esc(fieldLabel(f))}${req}${control}</div>`;
    }).join('');

    const userOps = [{ v: '', l: '—' }].concat(
      (config.users || []).filter((u) => u.active).map((u) => ({ v: u.username, l: u.display_name || u.username }))
    );

    return `
      <h4>${t('wizard.step4.title')}</h4>
      <p class="hint">${t('wizard.step4.requiredHint')}</p>
      <div class="form-grid" style="grid-template-columns:1fr 1fr">
        ${fieldsHtml}
        ${field('wiz-f-amount', 'wizard.step4.amount', w.fieldValues.__amount || '', 'number')}
        ${field('wiz-f-currency', 'wizard.step4.currency', w.fieldValues.__currency || 'MAD', 'text')}
        ${field('wiz-f-assigned', 'wizard.step4.assignedTo', w.fieldValues.__assigned || '', 'select', userOps)}
        <div class="form-field full">${t('wizard.step4.notes')}<textarea class="form-input" id="wiz-f-notes" rows="3">${esc(w.fieldValues.__notes || '')}</textarea></div>
      </div>`;
  }

  function wStep5() {
    const type = typeSel(w.typeId);
    const fieldsList = (type.fields || []).map((f) => {
      const v = w.fieldValues[f.field_key];
      if (v === undefined || v === '') return '';
      return `<div class="det-item"><span>${esc(fieldLabel(f))}</span><strong>${esc(v)}</strong></div>`;
    }).join('');
    const partiesList = (w.parties || []).filter((p) => w.partyIds.includes(p.id)).map((p) => esc(p.name)).join(state.lang === 'fr' ? ', ' : '، ');
    return `
      <h4>${t('wizard.step5.title')}</h4>
      <div class="det-grid">
        <div class="det-item"><span>${t('wizard.step5.dossier')}</span><strong>${esc(w.dossier ? w.dossier.numero : '—')}</strong></div>
        <div class="det-item"><span>${t('wizard.step5.category')}</span><strong>${esc(w.categoryObj ? catLabel(w.categoryObj.name_ar, w.categoryObj.name_fr) : '—')}</strong></div>
        <div class="det-item"><span>${t('wizard.step5.type')}</span><strong>${esc(typeName(type))}</strong></div>
        <div class="det-item full"><span>${t('wizard.step5.parties')}</span><strong>${esc(partiesList || '—')}</strong></div>
        <div class="det-item"><span>${t('wizard.step5.amount')}</span><strong>${esc(w.fieldValues.__amount || '—')} ${esc(w.fieldValues.__currency || '')}</strong></div>
        <div class="det-item"><span>${t('wizard.step5.assignedTo')}</span><strong>${esc((config.users || []).find((u) => u.username === w.fieldValues.__assigned)?.display_name || '—')}</strong></div>
        ${fieldsList}
      </div>
      <input type="hidden" id="wiz-confirm">`;
  }

  function renderWizardFooter() {
    const back = byId('wizard-back');
    const next = byId('wizard-next');
    if (!back || !next) return;
    back.style.visibility = wStep === 1 ? 'hidden' : 'visible';
    if (wStep === 5) {
      next.innerHTML = `${t('wizard.create')}<i class="fas fa-check"></i>`;
    } else {
      next.innerHTML = `${t('wizard.next')}<i class="fas fa-arrow-left"></i>`;
    }
    back.onclick = () => { if (wStep > 1) { wStep--; renderWizard(); } };
    next.onclick = wizNext;
    if (wStep === 5) next.onclick = wizCreate;
  }

  /* ---------- التجميع تجاه الخطوة الأخيرة ---------- */
  function collectFields() {
    const type = typeSel(w.typeId);
    (type.fields || []).forEach((f) => {
      const el = byId('wiz-f-' + f.field_key);
      if (el) w.fieldValues[f.field_key] = el.value;
    });
    w.fieldValues.__amount = byId('wiz-f-amount') ? byId('wiz-f-amount').value : '';
    w.fieldValues.__currency = byId('wiz-f-currency') ? byId('wiz-f-currency').value : 'MAD';
    w.fieldValues.__assigned = byId('wiz-f-assigned') ? byId('wiz-f-assigned').value : '';
    w.fieldValues.__notes = byId('wiz-f-notes') ? byId('wiz-f-notes').value : '';
  }

  function bindWizardStepEvents() {
    const body = byId('wizard-body');
    body.querySelectorAll('[data-cat]').forEach((c) => {
      c.onclick = () => {
        w.category = Number(c.getAttribute('data-cat'));
        w.categoryObj = config.categories.find((x) => x.id === w.category);
        w.typeId = null;
        renderWizard();
      };
    });
    body.querySelectorAll('.type-item input').forEach((inp) => {
      inp.onclick = (e) => { w.typeId = Number(e.target.value); renderWizard(); };
    });
    body.querySelectorAll('[data-dos-change]').forEach((b) => { b.onclick = () => { w.dossier = null; renderWizard(); }; });
    body.querySelectorAll('[data-party]').forEach((cb) => {
      cb.onchange = () => {
        const id = Number(cb.getAttribute('data-party'));
        if (cb.checked) { if (!w.partyIds.includes(id)) w.partyIds.push(id); }
        else { w.partyIds = w.partyIds.filter((x) => x !== id); }
        cb.closest('.party-check').classList.toggle('sel', cb.checked);
      };
    });
    const search = byId('wiz-dos-search');
    if (search) {
      search.addEventListener('input', () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(async () => {
          const q = search.value.trim();
          const res = q ? await API.dossierSearch(q) : [];
          const box = byId('wiz-dos-results');
          box.innerHTML = res.length
            ? res.map((d) => `
              <button class="dos-result" data-dos="${d.id}">
                <div class="cell-stack"><strong>${esc(d.numero || '—')}</strong>
                  <small>${esc([d.demandeur, d.defendeur].filter(Boolean).join(' · ') || '')}</small></div>
                <small class="muted">${esc(d.court || '')}</small>
              </button>`).join('')
            : `<p class="hint">${t('wizard.step2.noResults')}</p>`;
          box.querySelectorAll('[data-dos]').forEach((b) => {
            b.onclick = () => {
              w.dossier = res.find((d) => d.id === Number(b.getAttribute('data-dos')));
              renderWizard();
            };
          });
        }, 300);
      });
    }
  }

  function wizNext() {
    if (wStep === 1) {
      if (!w.category || !w.typeId) { toast(t('procedures.errors.invalid'), true); return; }
      wStep = 2;
    } else if (wStep === 2) {
      if (!w.dossier) { toast(t('procedures.errors.invalid'), true); return; }
      wStep = 3;
    } else if (wStep === 3) {
      wStep = 4;
    } else if (wStep === 4) {
      collectFields();
      const type = typeSel(w.typeId);
      const missing = (type.fields || []).filter((f) => f.required && !String(w.fieldValues[f.field_key] || '').trim());
      if (missing.length) { toast(t('procedures.errors.invalid'), true); return; }
      wStep = 5;
    } else { return; }
    renderWizard();
  }

  /* ---------- الإنشاء ---------- */
  async function wizCreate() {
    collectFields();
    const type = typeSel(w.typeId);
    const missing = (type.fields || []).filter((f) => f.required && !String(w.fieldValues[f.field_key] || '').trim());
    if (missing.length) { toast(t('procedures.errors.invalid'), true); return; }

    const fieldValues = {};
    (type.fields || []).forEach((f) => { fieldValues[f.field_key] = w.fieldValues[f.field_key] || ''; });

    const requester = (w.parties || []).find((p) => p.role === 'demandeur' && w.partyIds.includes(p.id));
    const payload = {
      dossier_id: w.dossier.id,
      procedure_type_id: w.typeId,
      status: 'NEW',
      requested_by: requester ? requester.name : (w.dossier.demandeur || ''),
      amount: w.fieldValues.__amount || 0,
      currency: w.fieldValues.__currency || 'MAD',
      assigned_to: w.fieldValues.__assigned || '',
      notes: w.fieldValues.__notes || '',
      party_ids: w.partyIds,
      field_values: fieldValues
    };
    try {
      const created = await API.procCreate(payload);
      toast(t('common.save'));
      closeWizard();
      await openDetail(created.id);
      render();
    } catch (e) { toast(e.message || t('procedures.errors.create'), true); }
  }

  /* ================================================================
     نماذج مشتركة (حالة/محضر/أداء/تعديل)
     ================================================================ */
  function openStatusModal(id) {
    const d = detail;
    modal.title.textContent = t('procDetails.statusDlg.title');
    const trs = (d && d.transitions) || [];
    if (!trs.length) {
      modal.body.innerHTML = `<p class="hint">${t('procDetails.emptyTimeline')}</p>`;
      modal.footer.innerHTML = `<button class="btn btn-ghost" data-modal-cancel>${t('common.cancel')}</button>`;
      openModal();
      modal.footer.querySelector('[data-modal-cancel]').addEventListener('click', closeModal);
      return;
    }
    const opts = trs.map((to) => ({
      v: to,
      l: `${statusLabel(d.status)} → ${statusLabel(to)}`
    }));
    modal.body.innerHTML = `
      <div class="form-grid" style="grid-template-columns:1fr">
        <div class="form-field">${t('procDetails.statusDlg.current')}${stBadge(d.status)}</div>
        ${field('st-to', 'procDetails.statusDlg.to', '', 'select', opts)}
        ${field('st-note', 'procDetails.statusDlg.note', '', 'textarea')}
      </div>`;
    modal.footer.innerHTML = `
      <button class="btn btn-ghost" data-modal-cancel>${t('common.cancel')}</button>
      <button class="btn btn-primary" data-modal-ok>${t('procDetails.statusDlg.save')}</button>`;
    openModal();
    modal.footer.querySelector('[data-modal-cancel]').addEventListener('click', closeModal);
    modal.footer.querySelector('[data-modal-ok]').addEventListener('click', async () => {
      const to = byId('st-to').value;
      const note = byId('st-note').value;
      if (!to) { toast(t('procedures.errors.invalid'), true); return; }
      try {
        await API.procStatusChange(id, to, note);
        closeModal();
        toast(t('common.save'));
        if (detail && detailTab === 'info') await openDetail(id); else render();
      } catch (e) { toast(e.message || e, true); }
    });
  }

  function openPvModal(id, reopen) {
    const templates = config.templates || [];
    modal.title.textContent = t('procDetails.pv.title');
    modal.body.innerHTML = `
      <div class="form-grid" style="grid-template-columns:1fr">
        ${templates.length
          ? field('pv-tpl', 'procDetails.pv.chooseTemplate', templates[0].id, 'select',
              templates.map((x) => ({ v: x.id, l: l(x.title_ar, x.title_fr) })))
          : `<p class="hint">—</p>`}
        ${field('pv-notes', 'procDetails.pv.notes', '', 'textarea')}
      </div>`;
    modal.footer.innerHTML = `
      <button class="btn btn-ghost" data-modal-cancel>${t('common.cancel')}</button>
      <button class="btn btn-primary" data-modal-ok>${t('procDetails.pv.generate')}</button>`;
    openModal();
    modal.footer.querySelector('[data-modal-cancel]').addEventListener('click', closeModal);
    modal.footer.querySelector('[data-modal-ok]').addEventListener('click', async () => {
      const tpl = byId('pv-tpl') ? byId('pv-tpl').value : (templates[0] ? templates[0].id : 0);
      const notes = byId('pv-notes') ? byId('pv-notes').value : '';
      try {
        await API.docGeneratePv(id, Number(tpl), state.lang, notes);
        closeModal();
        toast(t('procDetails.pv.done'));
        if (reopen && detail) await openDetail(id); else render();
      } catch (e) { toast(e.message || t('procDetails.pv.error'), true); }
    });
  }

  function openPaymentModal(id, reopen) {
    modal.title.textContent = t('procDetails.payment.title');
    const methods = t('procDetails.payments.methods');
    modal.body.innerHTML = `
      <div class="form-grid" style="grid-template-columns:1fr">
        ${field('pay-amount', 'procDetails.payments.amount', '', 'number')}
        ${field('pay-method', 'procDetails.payments.method', methods[0] || '', 'select', methods)}
        ${field('pay-date', 'procDetails.payments.date', new Date().toISOString().slice(0, 10), 'date')}
        ${field('pay-reference', 'procDetails.payments.reference', '', 'text')}
        ${field('pay-notes', 'procDetails.payments.notes', '', 'textarea')}
      </div>`;
    modal.footer.innerHTML = `
      <button class="btn btn-ghost" data-modal-cancel>${t('common.cancel')}</button>
      <button class="btn btn-primary" data-modal-ok>${t('common.save')}</button>`;
    openModal();
    modal.footer.querySelector('[data-modal-cancel]').addEventListener('click', closeModal);
    modal.footer.querySelector('[data-modal-ok]').addEventListener('click', async () => {
      const amount = byId('pay-amount').value;
      if (!amount || !isNum(amount) || Number(amount) < 0) { toast(t('procedures.errors.invalid'), true); return; }
      try {
        await API.payAdd(id, {
          amount: Number(amount),
          method: byId('pay-method').value,
          payment_date: byId('pay-date').value,
          reference: byId('pay-reference').value,
          notes: byId('pay-notes').value
        });
        closeModal();
        toast(t('procDetails.payment.saved'));
        if (reopen && detail) await openDetail(id); else render();
      } catch (e) { toast(e.message || e, true); }
    });
  }

  function openEditModal(id, reopen) {
    const d = detail;
    const userOps = [{ v: '', l: '—' }].concat(
      (config.users || []).filter((u) => u.active).map((u) => ({ v: u.username, l: u.display_name || u.username }))
    );
    modal.title.textContent = t('procedures.actions.edit');
    modal.body.innerHTML = `
      <div class="form-grid" style="grid-template-columns:1fr">
        ${field('ed-requested', 'procDetails.dfields.requester', d.requested_by || '', 'text')}
        ${field('ed-amount', 'wizard.step4.amount', d.amount || '', 'number')}
        ${field('ed-currency', 'wizard.step4.currency', d.currency || 'MAD', 'text')}
        ${field('ed-assigned', 'wizard.step4.assignedTo', d.assigned_to || '', 'select', userOps)}
        ${field('ed-notes', 'wizard.step4.notes', d.notes || '', 'textarea')}
      </div>`;
    modal.footer.innerHTML = `
      <button class="btn btn-ghost" data-modal-cancel>${t('common.cancel')}</button>
      <button class="btn btn-primary" data-modal-ok>${t('common.save')}</button>`;
    openModal();
    modal.footer.querySelector('[data-modal-cancel]').addEventListener('click', closeModal);
    modal.footer.querySelector('[data-modal-ok]').addEventListener('click', async () => {
      try {
        await API.procUpdate(id, {
          requested_by: byId('ed-requested').value,
          amount: byId('ed-amount').value || 0,
          currency: byId('ed-currency').value,
          assigned_to: byId('ed-assigned').value,
          notes: byId('ed-notes').value
        });
        closeModal();
        toast(t('common.save'));
        if (reopen && detail) await openDetail(id); else render();
      } catch (e) { toast(e.message || e, true); }
    });
  }

  /* ================================================================
     تهيئة ورسم
     ================================================================ */
  function bindListEvents() {
    byId('proc-add').onclick = openWizard;
    byId('proc-filter').onclick = openFilterModal;
    byId('proc-more').onclick = () => loadList(true);
    byId('proc-search-clear').onclick = () => {
      byId('proc-search').value = '';
      filters.q = '';
      render();
    };
    byId('proc-search').addEventListener('input', (e) => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        filters.q = e.target.value.trim();
        render();
      }, 350);
    });
    byId('proc-tbody').onclick = (e) => {
      const btn = e.target.closest('[data-proc-action]');
      if (!btn) return;
      const id = Number(btn.getAttribute('data-proc-action'));
      const role = btn.getAttribute('data-role');
      if (role === 'view') openDetail(id);
      else if (role === 'edit') openEditModal(id, false);
      else if (role === 'pv') { detail = null; openPvModal(id, false); }
      else if (role === 'pay') { detail = null; openPaymentModal(id, false); }
      else if (role === 'del') deleteProc(id);
    };
  }

  function loadDossierPartiesIfNeeded() {
    if (w.dossier && !w.partiesLoaded) {
      const did = w.dossier.id;
      API.dossierParties(did).then((list) => {
        w.parties = list || [];
        w.partiesLoaded = true;
        w.partyIds = [];
        if (wStep === 3) renderWizard();
      });
    }
  }

  function renderWizard() {
    renderWizardSteps();
    byId('wizard-body').innerHTML = renderWizardBody();
    bindWizardStepEvents();
    if (wStep === 3) loadDossierPartiesIfNeeded();
    renderWizardFooter();
  }

  async function render() {
    renderHeaders();
    await loadStats();
    page = 1; rows = [];
    await loadList(false);
  }

  async function init() {
    try {
      config = await API.configSnapshot();
    } catch (e) { toast(t('procedures.errors.load'), true); return; }
    bindListEvents();
    byId('wizard-close').onclick = closeWizard;
    byId('detail-close').onclick = closeDetail;
    dBackdrop().addEventListener('click', (e) => { if (e.target === dBackdrop()) closeDetail(); });
    wBackdrop().addEventListener('click', (e) => { if (e.target === wBackdrop()) closeWizard(); });
    renderHeaders();
  }

  window.ProceduresModule = { init, render, openDetail };
})();
