/* ================================================================
   ArchiveModule — واجهة الأرشيف المركزي لإدارة الوثائق
   Tab 1: Documents (documents_v2)
   Tab 2: Archived Templates (document_templates.archived=1)
   ================================================================ */

'use strict';

(function () {
  const H = window.HuissierApp;
  if (!H) return;
  const { API, state, t, toast, escapeHtml: esc, fmtDate, modal, openModal, closeModal } = H;

  const LS = { page: 1, pageSize: 25, filters: {}, query: '', activeTab: 'docs' };
  let stats = {};
  let docTypes = [];

  /* ---------- Helpers ---------- */
  function fileSize(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
  }

  function mimeIcon(mime) {
    if (!mime) return 'fa-file';
    if (mime.includes('pdf')) return 'fa-file-pdf';
    if (mime.includes('image')) return 'fa-file-image';
    if (mime.includes('word') || mime.includes('document')) return 'fa-file-word';
    if (mime.includes('sheet') || mime.includes('excel')) return 'fa-file-excel';
    if (mime.includes('text')) return 'fa-file-lines';
    return 'fa-file';
  }

  function statusBadge(status) {
    const colors = {
      active: 'success', archived: 'info', draft: 'warning',
      deleted: 'danger', locked: 'primary'
    };
    return `<span class="badge ${colors[status] || 'gray'}">${esc(status)}</span>`;
  }

  function typeIconHTML(typeInfo) {
    const icon = typeInfo && typeInfo.icon ? typeInfo.icon : 'fa-file';
    return `<i class="fas ${esc(icon)}" style="opacity:.7"></i>`;
  }

  function renderTabs() {
    const docsTab = document.getElementById('arc-tab-docs');
    const tplTab = document.getElementById('arc-tab-templates');
    const docsPanel = document.getElementById('arc-panel-docs');
    const tplPanel = document.getElementById('arc-panel-templates');

    if (docsTab) docsTab.classList.toggle('active', LS.activeTab === 'docs');
    if (tplTab) tplTab.classList.toggle('active', LS.activeTab === 'templates');
    if (docsPanel) docsPanel.classList.toggle('active', LS.activeTab === 'docs');
    if (tplPanel) tplPanel.classList.toggle('active', LS.activeTab === 'templates');
  }

  /* ---------- Render Stats ---------- */
  function renderStats() {
    const el = document.getElementById('arc-stats');
    if (!el) return;
    el.innerHTML = `
      <div class="stat-card" data-accent="primary">
        <div class="stat-icon"><i class="fas fa-box-archive"></i></div>
        <div class="stat-info"><span class="stat-value">${stats.total || 0}</span><span class="stat-label">${t('arc.stats.total')}</span></div>
      </div>
      <div class="stat-card" data-accent="success">
        <div class="stat-icon"><i class="fas fa-check-circle"></i></div>
        <div class="stat-info"><span class="stat-value">${stats.active || 0}</span><span class="stat-label">${t('arc.stats.active')}</span></div>
      </div>
      <div class="stat-card" data-accent="info">
        <div class="stat-icon"><i class="fas fa-box-archive"></i></div>
        <div class="stat-info"><span class="stat-value">${stats.archived || 0}</span><span class="stat-label">${t('arc.stats.archived')}</span></div>
      </div>
      <div class="stat-card" data-accent="warning">
        <div class="stat-icon"><i class="fas fa-lock"></i></div>
        <div class="stat-info"><span class="stat-value">${stats.locked || 0}</span><span class="stat-label">${t('arc.stats.locked')}</span></div>
      </div>
      <div class="stat-card" data-accent="danger">
        <div class="stat-icon"><i class="fas fa-trash"></i></div>
        <div class="stat-info"><span class="stat-value">${stats.deleted || 0}</span><span class="stat-label">${t('arc.stats.deleted')}</span></div>
      </div>
      <div class="stat-card" data-accent="primary">
        <div class="stat-icon"><i class="fas fa-hard-drive"></i></div>
        <div class="stat-info"><span class="stat-value">${fileSize(stats.totalSize || 0)}</span><span class="stat-label">${t('arc.stats.totalSize')}</span></div>
      </div>
    `;
  }

  /* ---------- Render Documents Table ---------- */
  function renderDocsTable() {
    const tbody = document.getElementById('arc-docs-tbody');
    const empty = document.getElementById('arc-docs-empty');
    const countEl = document.getElementById('arc-docs-count');
    const moreBtn = document.getElementById('arc-docs-more');
    if (!tbody) return;

    const q = LS.query;
    const filters = { ...LS.filters, q, page: LS.page, pageSize: LS.pageSize };

    API.arcSearch(filters).then((result) => {
      const rows = result.rows || [];
      const total = result.total || 0;

      tbody.innerHTML = rows.map((d) => {
        const typeInfo = d.type_info || {};
        const tagsHtml = (d.tags || []).map((tg) =>
          `<span class="arc-tag" style="background:${esc(tg.color)}">${esc(tg.name)}</span>`
        ).join(' ');

        return `<tr class="${d.locked ? 'row-locked' : ''} ${d.deleted_at ? 'row-deleted' : ''}">
          <td>${typeIconHTML(typeInfo)} ${esc(d.doc_number || '')}</td>
          <td title="${esc(d.description || '')}"><strong>${esc(d.title || '—')}</strong></td>
          <td>${esc(typeInfo.name_ar || typeInfo.name_fr || d.type_code || '—')}</td>
          <td>${statusBadge(d.status)}</td>
          <td>${d.locked ? '<i class="fas fa-lock" style="color:var(--primary)"></i>' : ''} ${d.deleted_at ? '<i class="fas fa-trash" style="color:var(--danger)"></i>' : ''}</td>
          <td>${fileSize(d.size_bytes)}</td>
          <td>${fmtDate(d.created_at)}</td>
          <td>${tagsHtml}</td>
          <td><div class="row-actions">
            <button class="row-btn" data-arc-view="${d.id}" title="${t('arc.view')}"><i class="fas fa-eye"></i></button>
            <button class="row-btn" data-arc-edit="${d.id}" title="${t('common.edit')}"><i class="fas fa-pen"></i></button>
            ${d.file_path ? `<button class="row-btn" data-arc-open="${d.id}" title="${t('arc.open')}"><i class="fas fa-external-link"></i></button>` : ''}
            ${d.file_path ? `<button class="row-btn" data-arc-dl="${d.id}" title="${t('arc.download')}"><i class="fas fa-download"></i></button>` : ''}
            ${!d.locked && !d.deleted_at ? `<button class="row-btn del" data-arc-del="${d.id}" title="${t('common.delete')}"><i class="fas fa-trash"></i></button>` : ''}
            ${d.deleted_at ? `<button class="row-btn" data-arc-restore="${d.id}" title="${t('arc.restore')}"><i class="fas fa-undo"></i></button>` : ''}
          </div></td>
        </tr>`;
      }).join('');

      empty.style.display = rows.length ? 'none' : 'flex';
      countEl.textContent = `${total} ${t('arc.results')}`;
      moreBtn.style.display = (LS.page * LS.pageSize < total) ? '' : 'none';
      bindDocRowActions();
    }).catch((e) => toast(String(e.message || e), true));
  }

  /* ---------- Render Archived Templates Table ---------- */
  let tplPage = 1;
  function renderTemplatesTable() {
    const tbody = document.getElementById('arc-tpl-tbody');
    const empty = document.getElementById('arc-tpl-empty');
    const countEl = document.getElementById('arc-tpl-count');
    const moreBtn = document.getElementById('arc-tpl-more');
    if (!tbody) return;

    API.arcArchivedTemplates({ page: tplPage, pageSize: LS.pageSize }).then((result) => {
      const rows = result.rows || [];
      const total = result.total || 0;

      tbody.innerHTML = rows.map((tpl) => {
        const langLabel = tpl.language === 'fr' ? 'FR' : 'AR';
        return `<tr>
          <td><strong>${esc(tpl.name || '—')}</strong></td>
          <td>${esc(tpl.category_name_ar || tpl.category_name_fr || '—')}</td>
          <td><span class="badge">${langLabel}</span></td>
          <td>${fmtDate(tpl.updated_at || tpl.created_at)}</td>
          <td><div class="row-actions">
            <button class="row-btn" data-arc-tpl-view="${tpl.id}" title="${t('arc.view')}"><i class="fas fa-eye"></i></button>
            <button class="row-btn" data-arc-tpl-restore="${tpl.id}" title="${t('arc.restore')}"><i class="fas fa-undo"></i></button>
          </div></td>
        </tr>`;
      }).join('');

      empty.style.display = rows.length ? 'none' : 'flex';
      countEl.textContent = `${total} ${t('arc.results')}`;
      moreBtn.style.display = (tplPage * LS.pageSize < total) ? '' : 'none';
      bindTplRowActions();
    }).catch((e) => toast(String(e.message || e), true));
  }

  /* ---------- Bind Document Row Actions ---------- */
  function bindDocRowActions() {
    document.querySelectorAll('[data-arc-view]').forEach((b) => {
      b.addEventListener('click', () => openDocDetail(Number(b.getAttribute('data-arc-view'))));
    });
    document.querySelectorAll('[data-arc-edit]').forEach((b) => {
      b.addEventListener('click', () => openEditModal(Number(b.getAttribute('data-arc-edit'))));
    });
    document.querySelectorAll('[data-arc-open]').forEach((b) => {
      b.addEventListener('click', async () => {
        try { await API.arcOpenDoc(Number(b.getAttribute('data-arc-open'))); } catch (e) { toast(String(e), true); }
      });
    });
    document.querySelectorAll('[data-arc-dl]').forEach((b) => {
      b.addEventListener('click', async () => {
        try { await API.docDownload(Number(b.getAttribute('data-arc-dl'))); } catch (e) { toast(String(e), true); }
      });
    });
    document.querySelectorAll('[data-arc-del]').forEach((b) => {
      b.addEventListener('click', async () => {
        const id = Number(b.getAttribute('data-arc-del'));
        if (!confirm(t('arc.deleteConfirm'))) return;
        try { await API.arcDelete(id); toast(t('common.delete')); renderDocsTable(); renderStats(); } catch (e) { toast(String(e), true); }
      });
    });
    document.querySelectorAll('[data-arc-restore]').forEach((b) => {
      b.addEventListener('click', async () => {
        try { await API.arcRestore(Number(b.getAttribute('data-arc-restore'))); toast(t('arc.restored')); renderDocsTable(); renderStats(); } catch (e) { toast(String(e), true); }
      });
    });
  }

  /* ---------- Bind Template Row Actions ---------- */
  function bindTplRowActions() {
    document.querySelectorAll('[data-arc-tpl-view]').forEach((b) => {
      b.addEventListener('click', async () => {
        const id = Number(b.getAttribute('data-arc-tpl-view'));
        toast(t('arc.switchToTemplates'));
        if (window.TemplatesModule) { H.goTo('documents'); window.TemplatesModule.render(); }
      });
    });
    document.querySelectorAll('[data-arc-tpl-restore]').forEach((b) => {
      b.addEventListener('click', async () => {
        const id = Number(b.getAttribute('data-arc-tpl-restore'));
        if (!confirm(t('arc.restoreTemplateConfirm'))) return;
        try {
          await API.tplSetArchived(id, false);
          toast(t('arc.restored'));
          renderTemplatesTable();
        } catch (e) { toast(String(e), true); }
      });
    });
  }

  /* ---------- Document Detail Modal ---------- */
  async function openDocDetail(id) {
    const doc = await API.arcGet(id);
    if (!doc) return;
    const versions = await API.arcVersions(id);
    const auditLog = await API.arcAuditLog(id);
    const relations = await API.arcRelations(id);
    const typeInfo = doc.type_info || {};

    modal.title.textContent = t('arc.detailTitle');
    modal.body.innerHTML = `
      <div class="arc-detail">
        <div class="arc-detail-header">
          <div class="arc-detail-icon">${typeIconHTML(typeInfo)}</div>
          <div class="arc-detail-meta">
            <h2>${esc(doc.title || doc.doc_number)}</h2>
            <p class="hint">${esc(doc.doc_number)} — ${esc(typeInfo.name_ar || typeInfo.name_fr || '—')}</p>
            <div class="arc-detail-badges">
              ${statusBadge(doc.status)}
              ${doc.locked ? '<span class="badge primary"><i class="fas fa-lock"></i> ' + t('arc.locked') + '</span>' : ''}
              ${doc.deleted_at ? '<span class="badge danger"><i class="fas fa-trash"></i> ' + t('arc.softDeleted') + '</span>' : ''}
              <span class="badge gray">${esc(doc.language || 'ar')}</span>
            </div>
          </div>
        </div>

        <div class="arc-detail-grid">
          <div><strong>${t('arc.file')}</strong> ${esc(doc.original_name || doc.file_name || '—')}</div>
          <div><strong>${t('arc.size')}</strong> ${fileSize(doc.size_bytes)}</div>
          <div><strong>${t('arc.mime')}</strong> ${esc(doc.mime || '—')}</div>
          <div><strong>${t('arc.version')}</strong> v${doc.version || 1}</div>
          <div><strong>${t('arc.period')}</strong> ${esc(doc.period_key || '—')}</div>
          <div><strong>${t('arc.source')}</strong> ${esc(doc.source || '—')}</div>
          <div style="grid-column:1/-1"><strong>${t('arc.sha256')}</strong> <code class="arc-hash">${esc(doc.sha256 || '—')}</code></div>
          ${doc.description ? `<div style="grid-column:1/-1"><strong>${t('arc.description')}</strong> ${esc(doc.description)}</div>` : ''}
          ${doc.entity_type ? `<div><strong>${t('arc.entity')}</strong> ${esc(doc.entity_type)} #${doc.entity_id}</div>` : ''}
        </div>

        ${doc.tags && doc.tags.length ? `
          <div class="arc-tags-section">
            <strong>${t('arc.tags')}</strong>
            <div class="arc-tags">${doc.tags.map((tg) =>
              `<span class="arc-tag" style="background:${esc(tg.color)}">${esc(tg.name)}
                <button class="arc-tag-remove" data-arc-rmtag="${doc.id}" data-tag-id="${tg.id}">×</button>
              </span>`
            ).join(' ')}</div>
          </div>
        ` : ''}

        ${versions.length ? `
          <div class="arc-section">
            <h4>${t('arc.versions')} (${versions.length})</h4>
            <table class="data-table compact">
              <thead><tr><th>${t('arc.versionNo')}</th><th>${t('arc.versionNote')}</th><th>${t('arc.versionBy')}</th><th>${t('arc.versionDate')}</th></tr></thead>
              <tbody>${versions.map((v) => `<tr><td>v${v.version}</td><td>${esc(v.note || '—')}</td><td>${esc(v.created_by)}</td><td>${fmtDate(v.created_at)}</td></tr>`).join('')}</tbody>
            </table>
          </div>
        ` : ''}

        ${relations.length ? `
          <div class="arc-section">
            <h4>${t('arc.relations')} (${relations.length})</h4>
            <table class="data-table compact">
              <thead><tr><th>${t('arc.relDocNo')}</th><th>${t('arc.relTitle')}</th><th>${t('arc.relType')}</th></tr></thead>
              <tbody>${relations.map((r) => `<tr><td>${esc(r.doc_number || '')}</td><td>${esc(r.title || '')}</td><td>${esc(r.relation_type)}</td></tr>`).join('')}</tbody>
            </table>
          </div>
        ` : ''}

        ${auditLog.length ? `
          <div class="arc-section">
            <h4>${t('arc.auditLog')} (${auditLog.length})</h4>
            <table class="data-table compact">
              <thead><tr><th>${t('arc.auditAction')}</th><th>${t('arc.auditBy')}</th><th>${t('arc.auditDate')}</th></tr></thead>
              <tbody>${auditLog.slice(0, 20).map((a) => `<tr><td>${esc(a.action)}</td><td>${esc(a.by_user)}</td><td>${fmtDate(a.created_at)}</td></tr>`).join('')}</tbody>
            </table>
          </div>
        ` : ''}
      </div>
    `;
    modal.footer.innerHTML = `
      <button class="btn btn-ghost" data-modal-cancel>${t('common.close')}</button>
      ${doc.file_path ? `<button class="btn btn-ghost" id="arc-detail-open"><i class="fas fa-external-link"></i> ${t('arc.open')}</button>` : ''}
      ${doc.file_path ? `<button class="btn btn-ghost" id="arc-detail-dl"><i class="fas fa-download"></i> ${t('arc.download')}</button>` : ''}
      ${doc.file_path && doc.sha256 ? `<button class="btn btn-ghost" id="arc-detail-verify"><i class="fas fa-shield-halved"></i> ${t('arc.verifyIntegrity')}</button>` : ''}
      ${!doc.locked && !doc.deleted_at ? `
        <button class="btn btn-ghost" id="arc-detail-lock"><i class="fas fa-lock"></i> ${t('arc.lock')}</button>
        <button class="btn btn-primary" id="arc-detail-edit"><i class="fas fa-pen"></i> ${t('common.edit')}</button>
      ` : ''}
      ${doc.locked ? `<button class="btn btn-ghost" id="arc-detail-unlock"><i class="fas fa-unlock"></i> ${t('arc.unlock')}</button>` : ''}
    `;
    openModal();

    modal.footer.querySelector('[data-modal-cancel]').addEventListener('click', closeModal);
    const editBtn = modal.footer.querySelector('#arc-detail-edit');
    if (editBtn) editBtn.addEventListener('click', () => { closeModal(); openEditModal(id); });
    const openBtn = modal.footer.querySelector('#arc-detail-open');
    if (openBtn) openBtn.addEventListener('click', async () => { try { await API.arcOpenDoc(id); } catch (e) { toast(String(e), true); } });
    const dlBtn = modal.footer.querySelector('#arc-detail-dl');
    if (dlBtn) dlBtn.addEventListener('click', async () => { try { await API.docDownload(id); } catch (e) { toast(String(e), true); } });
    const lockBtn = modal.footer.querySelector('#arc-detail-lock');
    if (lockBtn) lockBtn.addEventListener('click', async () => { await API.arcLock(id); closeModal(); toast(t('arc.locked')); renderDocsTable(); renderStats(); });
    const unlockBtn = modal.footer.querySelector('#arc-detail-unlock');
    if (unlockBtn) unlockBtn.addEventListener('click', async () => { await API.arcUnlock(id); closeModal(); toast(t('arc.unlocked')); renderDocsTable(); renderStats(); });
    const verifyBtn = modal.footer.querySelector('#arc-detail-verify');
    if (verifyBtn) verifyBtn.addEventListener('click', async () => {
      try {
        const result = await API.arcVerifyIntegrity(id);
        if (result.verified) toast(t('arc.integrityOk'));
        else toast(t('arc.integrityFail'), true);
      } catch (e) { toast(String(e), true); }
    });

    document.querySelectorAll('[data-arc-rmtag]').forEach((b) => {
      b.addEventListener('click', async (e) => {
        e.stopPropagation();
        const docId = Number(b.getAttribute('data-arc-rmtag'));
        const tagId = Number(b.getAttribute('data-tag-id'));
        await API.arcTagRemove(docId, tagId);
        openDocDetail(docId);
      });
    });
  }

  /* ---------- Edit Modal ---------- */
  async function openEditModal(id) {
    const doc = await API.arcGet(id);
    if (!doc) return;
    if (!docTypes.length) docTypes = await API.arcDocTypes();

    modal.title.textContent = t('arc.editTitle');
    modal.body.innerHTML = `
      <div class="form-grid" style="grid-template-columns:1fr">
        <div class="form-field"><label>${t('arc.titleLabel')}</label>
          <input class="form-input" id="arc-f-title" type="text" value="${esc(doc.title || '')}"></div>
        <div class="form-field"><label>${t('arc.descLabel')}</label>
          <textarea class="form-input" id="arc-f-desc" rows="2">${esc(doc.description || '')}</textarea></div>
        <div class="form-field"><label>${t('arc.typeLabel')}</label>
          <select class="form-input" id="arc-f-type">
            <option value="">—</option>
            ${docTypes.map((dt) => `<option value="${dt.id}" ${dt.id === doc.document_type_id ? 'selected' : ''}>${esc(dt.name_ar || dt.name_fr)}</option>`).join('')}
          </select></div>
        <div class="form-field"><label>${t('arc.statusLabel')}</label>
          <select class="form-input" id="arc-f-status">
            <option value="active" ${doc.status === 'active' ? 'selected' : ''}>${t('arc.statusActive')}</option>
            <option value="archived" ${doc.status === 'archived' ? 'selected' : ''}>${t('arc.statusArchived')}</option>
            <option value="draft" ${doc.status === 'draft' ? 'selected' : ''}>${t('arc.statusDraft')}</option>
          </select></div>
        <div class="form-field"><label>${t('arc.langLabel')}</label>
          <select class="form-input" id="arc-f-lang">
            <option value="ar" ${doc.language === 'ar' ? 'selected' : ''}>العربية</option>
            <option value="fr" ${doc.language === 'fr' ? 'selected' : ''}>Français</option>
          </select></div>
      </div>
    `;
    modal.footer.innerHTML = `
      <button class="btn btn-ghost" data-modal-cancel>${t('common.cancel')}</button>
      <button class="btn btn-primary" id="arc-edit-ok">${t('common.save')}</button>
    `;
    openModal();

    modal.footer.querySelector('[data-modal-cancel]').addEventListener('click', closeModal);
    modal.footer.querySelector('#arc-edit-ok').addEventListener('click', async () => {
      const typeVal = document.getElementById('arc-f-type').value;
      await API.arcUpdate(id, {
        title: document.getElementById('arc-f-title').value.trim(),
        description: document.getElementById('arc-f-desc').value.trim(),
        document_type_id: typeVal ? Number(typeVal) : null,
        status: document.getElementById('arc-f-status').value,
        language: document.getElementById('arc-f-lang').value
      });
      closeModal();
      toast(t('common.save'));
      renderDocsTable();
    });
  }

  /* ---------- Filter Handling ---------- */
  function applyFilters() {
    LS.page = 1;
    LS.query = (document.getElementById('arc-search') || {}).value || '';
    LS.filters = {};
    const typeFilter = document.getElementById('arc-filter-type');
    const statusFilter = document.getElementById('arc-filter-status');
    if (typeFilter && typeFilter.value) LS.filters.document_type_id = Number(typeFilter.value);
    if (statusFilter && statusFilter.value) LS.filters.status = statusFilter.value;
    renderDocsTable();
  }

  /* ---------- Load Filters ---------- */
  async function loadFilters() {
    try {
      docTypes = await API.arcDocTypes();
      const typeSel = document.getElementById('arc-filter-type');
      if (typeSel) {
        typeSel.innerHTML = '<option value="">' + t('arc.allTypes') + '</option>' +
          docTypes.map((dt) => `<option value="${dt.id}">${esc(dt.name_ar || dt.name_fr)} (${dt.doc_count || 0})</option>`).join('');
      }
    } catch (e) {}
  }

  /* ---------- Init ---------- */
  async function init() {
    const searchEl = document.getElementById('arc-search');
    const searchClear = document.getElementById('arc-search-clear');
    const typeFilter = document.getElementById('arc-filter-type');
    const statusFilter = document.getElementById('arc-filter-status');
    const moreDocsBtn = document.getElementById('arc-docs-more');
    const moreTplBtn = document.getElementById('arc-tpl-more');
    const tabDocs = document.getElementById('arc-tab-docs');
    const tabTpl = document.getElementById('arc-tab-templates');

    if (searchEl) searchEl.addEventListener('input', () => applyFilters());
    if (searchClear) searchClear.addEventListener('click', () => { searchEl.value = ''; applyFilters(); });
    if (typeFilter) typeFilter.addEventListener('change', () => applyFilters());
    if (statusFilter) statusFilter.addEventListener('change', () => applyFilters());
    if (moreDocsBtn) moreDocsBtn.addEventListener('click', () => { LS.page++; renderDocsTable(); });
    if (moreTplBtn) moreTplBtn.addEventListener('click', () => { tplPage++; renderTemplatesTable(); });
    if (tabDocs) tabDocs.addEventListener('click', () => { LS.activeTab = 'docs'; renderTabs(); });
    if (tabTpl) tabTpl.addEventListener('click', () => { LS.activeTab = 'templates'; renderTabs(); renderTemplatesTable(); });

    await loadFilters();
  }

  /* ---------- Render ---------- */
  async function render() {
    try {
      stats = await API.arcStats();
      renderStats();
    } catch (e) {}
    renderTabs();
    if (LS.activeTab === 'docs') renderDocsTable();
    else renderTemplatesTable();
  }

  /* ---------- Expose ---------- */
  window.ArchiveModule = { init, render };
})();
