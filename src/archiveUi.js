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
  const l = (ar, fr) => (state.lang === 'ar' ? ar : fr);

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
              <span class="badge gray">v${doc.version || 1}</span>
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
          <div><strong>${l('أنشأه', 'Créé par')}</strong> ${esc(doc.created_by || '—')}</div>
          <div><strong>${l('أنشئ', 'Créé le')}</strong> ${fmtDate(doc.created_at)}</div>
        </div>

        <div class="arc-section">
          <h4>${t('arc.tags')} <button class="btn btn-sm btn-ghost" id="arc-detail-addtag"><i class="fas fa-plus"></i></button></h4>
          ${doc.tags && doc.tags.length ?
            `<div class="arc-tags">${doc.tags.map((tg) =>
              `<span class="arc-tag" style="background:${esc(tg.color)}">${esc(tg.name)}
                <button class="arc-tag-remove" data-arc-rmtag="${doc.id}" data-tag-id="${tg.id}">×</button>
              </span>`
            ).join(' ')}</div>` :
            `<p style="color:var(--muted)">${l('لا توجد وسوم', 'Aucun tag')}</p>`}
        </div>

        ${versions.length ? `
          <div class="arc-section">
            <h4>${t('arc.versions')} (${versions.length})</h4>
            <table class="data-table compact">
              <thead><tr><th>${t('arc.versionNo')}</th><th>${l('الملف', 'Fichier')}</th><th>${l('الحجم', 'Taille')}</th><th>${t('arc.versionNote')}</th><th>${t('arc.versionBy')}</th><th>${t('arc.versionDate')}</th></tr></thead>
              <tbody>${versions.map((v) => `<tr>
                <td><strong>v${v.version}</strong> ${v.version === doc.version ? '<span class="badge success">latest</span>' : ''}</td>
                <td><small>${esc(v.original_name || v.file_name || '—')}</small></td>
                <td>${fileSize(v.size_bytes)}</td>
                <td>${esc(v.note || '—')}</td>
                <td>${esc(v.created_by)}</td>
                <td>${fmtDate(v.created_at)}</td>
              </tr>`).join('')}</tbody>
            </table>
          </div>` : ''}

        <div class="arc-section">
          <h4>${t('arc.relations')} (${relations.length}) <button class="btn btn-sm btn-ghost" id="arc-detail-addrel"><i class="fas fa-plus"></i></button></h4>
          ${relations.length ?
            `<table class="data-table compact">
              <thead><tr><th>${t('arc.relDocNo')}</th><th>${t('arc.relTitle')}</th><th>${t('arc.relType')}</th><th>${l('ملاحظة', 'Note')}</th><th></th></tr></thead>
              <tbody>${relations.map((r) => `<tr>
                <td><strong>${esc(r.doc_number || '')}</strong></td>
                <td>${esc(r.title || '—')}</td>
                <td><span class="badge info">${esc(r.relation_type)}</span></td>
                <td><small>${esc(r.note || '—')}</small></td>
                <td><button class="row-btn del" data-arc-rmrel="${r.from_doc_id}" data-rmrel-to="${r.to_doc_id}" data-rmrel-type="${r.relation_type}" title="${t('common.delete')}"><i class="fas fa-trash"></i></button></td>
              </tr>`).join('')}</tbody>
            </table>` :
            <p style="color:var(--muted)">${l('لا علاقات', 'Aucune relation')}</p>}
        </div>

        ${auditLog.length ? `
          <div class="arc-section">
            <h4>${t('arc.auditLog')} (${auditLog.length})</h4>
            <table class="data-table compact">
              <thead><tr><th>${t('arc.auditAction')}</th><th>${l('القيم القديمة', 'Ancien')}</th><th>${l('القيم الجديدة', 'Nouveau')}</th><th>${t('arc.auditBy')}</th><th>${t('arc.auditDate')}</th></tr></thead>
              <tbody>${auditLog.slice(0, 20).map((a) => `<tr>
                <td><span class="badge info">${esc(a.action)}</span></td>
                <td><small>${esc(a.old_value || '—')}</small></td>
                <td><small>${esc(a.new_value || '—')}</small></td>
                <td>${esc(a.by_user)}</td>
                <td>${fmtDate(a.created_at)}</td>
              </tr>`).join('')}</tbody>
            </table>
          </div>` : ''}
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
      ${state.role === 'admin' ? `<button class="btn btn-danger" id="arc-detail-permdel"><i class="fas fa-skull"></i> ${l('حذف نهائي', 'Supprimer définitivement')}</button>` : ''}
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
    const permDelBtn = modal.footer.querySelector('#arc-detail-permdel');
    if (permDelBtn) permDelBtn.addEventListener('click', () => permanentDeleteDoc(id));
    const addTagBtn = modal.body.querySelector('#arc-detail-addtag');
    if (addTagBtn) addTagBtn.addEventListener('click', () => openAddTagToDocModal(id));
    const addRelBtn = modal.body.querySelector('#arc-detail-addrel');
    if (addRelBtn) addRelBtn.addEventListener('click', () => openAddRelationModal(id));

    document.querySelectorAll('[data-arc-rmtag]').forEach((b) => {
      b.addEventListener('click', async (e) => {
        e.stopPropagation();
        const docId = Number(b.getAttribute('data-arc-rmtag'));
        const tagId = Number(b.getAttribute('data-tag-id'));
        await removeTagFromDoc(docId, tagId);
      });
    });

    document.querySelectorAll('[data-arc-rmrel]').forEach((b) => {
      b.addEventListener('click', async (e) => {
        e.stopPropagation();
        const fromId = Number(b.getAttribute('data-arc-rmrel'));
        const toId = Number(b.getAttribute('data-rmrel-to'));
        const relType = b.getAttribute('data-rmrel-type');
        if (!confirm(l('إزالة العلاقة؟', 'Supprimer cette relation ?'))) return;
        await removeRelation(fromId, toId, relType);
      });
    });
  }

  /* ================================================================
     رفع وثيقة من الأرشيف
     ================================================================ */
  async function openUploadModal() {
    if (!docTypes.length) docTypes = await API.arcDocTypes();
    modal.title.textContent = l('رفع وثيقة جديدة', 'Nouveau document');
    modal.body.innerHTML = `
      <div class="form-grid" style="grid-template-columns:1fr">
        <div class="form-field">
          <label>${l('الملف', 'Fichier')} *</label>
          <div id="arc-upload-drop" style="border:2px dashed var(--border);border-radius:8px;padding:24px;text-align:center;cursor:pointer;transition:.2s">
            <i class="fas fa-cloud-upload-alt" style="font-size:2em;color:var(--primary);margin-bottom:8px"></i>
            <p style="margin:0;color:var(--muted)">${l('اسحب الملف هنا أو انقر للاختيار', 'Glissez un fichier ici ou cliquez')}</p>
            <input type="file" id="arc-upload-file" style="display:none" accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.txt,.zip" />
          </div>
          <div id="arc-upload-preview" style="display:none;margin-top:8px;padding:8px;background:var(--bg);border-radius:6px">
            <span id="arc-upload-name"></span>
            <span id="arc-upload-size" style="color:var(--muted);margin-left:8px"></span>
            <button class="row-btn del" id="arc-upload-clear" style="float:right"><i class="fas fa-times"></i></button>
          </div>
        </div>
        <div class="form-field"><label>${l('العنوان', 'Titre')}</label>
          <input class="form-input" id="arc-upload-title" /></div>
        <div class="form-field"><label>${l('الوصف', 'Description')}</label>
          <textarea class="form-input" id="arc-upload-desc" rows="2"></textarea></div>
        <div class="form-field"><label>${l('نوع الوثيقة', 'Type')}</label>
          <select class="form-input" id="arc-upload-type">
            <option value="">—</option>
            ${docTypes.filter((dt) => dt.active).map((dt) => `<option value="${dt.id}">${esc(dt.name_ar || dt.name_fr)}</option>`).join('')}
          </select></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div class="form-field"><label>${l('نوع الربط', 'Entité')}</label>
            <select class="form-input" id="arc-upload-entity">
              <option value="">${l('بدون', 'Aucune')}</option>
              <option value="procedure">${l('إجراء', 'Procédure')}</option>
              <option value="dossier">${l('ملف قضائي', 'Dossier')}</option>
              <option value="pv">${l('محضر', 'PV')}</option>
            </select></div>
          <div class="form-field"><label>${l('رقم الربط', 'ID Entité')}</label>
            <input class="form-input" id="arc-upload-entity-id" type="number" min="1" /></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div class="form-field"><label>${l('اللغة', 'Langue')}</label>
            <select class="form-input" id="arc-upload-lang">
              <option value="ar">العربية</option><option value="fr">Français</option>
            </select></div>
          <div class="form-field"><label>${l('الحالة', 'Statut')}</label>
            <select class="form-input" id="arc-upload-status">
              <option value="active">${l('نشط', 'Actif')}</option>
              <option value="draft">${l('مسودة', 'Brouillon')}</option>
              <option value="archived">${l('مؤرشف', 'Archivé')}</option>
            </select></div>
        </div>
      </div>`;
    modal.footer.innerHTML = `
      <button class="btn btn-ghost" data-modal-cancel>${t('common.cancel')}</button>
      <button class="btn btn-primary" id="arc-upload-ok"><i class="fas fa-cloud-upload"></i> ${l('رفع', 'Téléverser')}</button>`;
    openModal();

    let selectedFile = null;
    const dropZone = document.getElementById('arc-upload-drop');
    const fileInput = document.getElementById('arc-upload-file');
    const preview = document.getElementById('arc-upload-preview');

    dropZone.onclick = () => fileInput.click();
    dropZone.ondragover = (e) => { e.preventDefault(); dropZone.style.borderColor = 'var(--primary)'; };
    dropZone.ondragleave = () => { dropZone.style.borderColor = ''; };
    dropZone.ondrop = (e) => { e.preventDefault(); dropZone.style.borderColor = ''; if (e.dataTransfer.files.length) selectFile(e.dataTransfer.files[0]); };
    fileInput.onchange = () => { if (fileInput.files.length) selectFile(fileInput.files[0]); };

    function selectFile(f) {
      selectedFile = f;
      document.getElementById('arc-upload-name').textContent = f.name;
      document.getElementById('arc-upload-size').textContent = fileSize(f.size);
      preview.style.display = 'block';
      dropZone.style.display = 'none';
      if (!document.getElementById('arc-upload-title').value) {
        document.getElementById('arc-upload-title').value = f.name.replace(/\.[^.]+$/, '');
      }
    }

    document.getElementById('arc-upload-clear').onclick = () => {
      selectedFile = null;
      preview.style.display = 'none';
      dropZone.style.display = '';
      fileInput.value = '';
    };

    modal.footer.querySelector('[data-modal-cancel]').addEventListener('click', closeModal);
    modal.footer.querySelector('#arc-upload-ok').addEventListener('click', async () => {
      if (!selectedFile) { toast(l('اختر ملفاً', 'Choisir un fichier'), true); return; }
      try {
        const filePath = selectedFile.path || selectedFile.name;
        const entityType = document.getElementById('arc-upload-entity').value || '';
        const entityId = Number(document.getElementById('arc-upload-entity-id').value) || 0;
        await API.arcCreateWithFile({
          filePath,
          originalName: selectedFile.name,
          mime: selectedFile.type || '',
          title: document.getElementById('arc-upload-title').value.trim(),
          description: document.getElementById('arc-upload-desc').value.trim(),
          document_type_id: Number(document.getElementById('arc-upload-type').value) || null,
          language: document.getElementById('arc-upload-lang').value,
          status: document.getElementById('arc-upload-status').value,
          entity_type: entityType,
          entity_id: entityId,
          dossier_id: entityType === 'dossier' ? entityId : null,
          procedure_id: entityType === 'procedure' ? entityId : null,
          pv_id: entityType === 'pv' ? entityId : null
        });
        closeModal();
        toast(l('تم رفع الوثيقة', 'Document téléversé'));
        renderDocsTable();
        renderStats();
      } catch (e) { toast(String(e.message || e), true); }
    });
  }

  /* ================================================================
     إدارة أنواع الوثائق
     ================================================================ */
  async function openDocTypesModal() {
    docTypes = await API.arcDocTypes();
    modal.title.textContent = l('أنواع الوثائق', 'Types de documents');
    renderDocTypesList();
    modal.footer.innerHTML = `
      <button class="btn btn-ghost" data-modal-cancel>${t('common.close')}</button>
      <button class="btn btn-primary" id="arc-dt-add"><i class="fas fa-plus"></i> ${l('نوع جديد', 'Nouveau type')}</button>`;
    openModal();
    modal.footer.querySelector('[data-modal-cancel]').addEventListener('click', closeModal);
    modal.footer.querySelector('#arc-dt-add').addEventListener('click', () => openDocTypeForm(null));
  }

  function renderDocTypesList() {
    modal.body.innerHTML = docTypes.length ? `<div class="table-wrap"><table class="data-table">
      <thead><tr><th>${l('الكود', 'Code')}</th><th>${l('الاسم', 'Nom')}</th><th>${l('العدد', 'Count')}</th><th>${l('الحالة', 'Statut')}</th><th></th></tr></thead>
      <tbody>${docTypes.map((dt) => `<tr>
        <td><code>${esc(dt.code)}</code></td>
        <td><strong>${esc(dt.name_ar)}</strong><br><small class="muted">${esc(dt.name_fr)}</small></td>
        <td>${dt.doc_count || 0}</td>
        <td>${dt.active ? `<span class="badge success">${l('نشط', 'Actif')}</span>` : `<span class="badge danger">${l('معطّل', 'Inactif')}</span>`}</td>
        <td><div class="row-actions">
          <button class="row-btn" data-dt-edit="${dt.id}"><i class="fas fa-pen"></i></button>
          <button class="row-btn del" data-dt-del="${dt.id}"><i class="fas fa-trash"></i></button>
        </div></td>
      </tr>`).join('')}</tbody>
    </table></div>` : `<p style="color:var(--muted);text-align:center">${l('لا توجد أنواع', 'Aucun type')}</p>`;

    modal.body.querySelectorAll('[data-dt-edit]').forEach((b) => {
      b.onclick = () => {
        const dt = docTypes.find((x) => x.id === Number(b.getAttribute('data-dt-edit')));
        if (dt) openDocTypeForm(dt);
      };
    });
    modal.body.querySelectorAll('[data-dt-del]').forEach((b) => {
      b.onclick = async () => {
        const id = Number(b.getAttribute('data-dt-del'));
        if (!confirm(l('هل تريد حذف هذا النوع؟', 'Supprimer ce type ?'))) return;
        try {
          await API.arcDocTypeDelete(id);
          toast(t('common.delete'));
          docTypes = await API.arcDocTypes();
          renderDocTypesList();
        } catch (e) { toast(String(e.message || e), true); }
      };
    });
  }

  function openDocTypeForm(item) {
    const isEdit = item && item.id;
    modal.title.textContent = isEdit ? l('تعديل النوع', 'Modifier le type') : l('نوع جديد', 'Nouveau type');
    const d = item || {};
    modal.body.innerHTML = `
      <div class="form-grid" style="grid-template-columns:1fr">
        ${!isEdit ? `<div class="form-field"><label>${l('الكود', 'Code')} *</label>
          <input class="form-input" id="dt-code" maxlength="20" placeholder="e.g. NOTIF" /></div>` : ''}
        <div class="form-field"><label>${l('الاسم بالعربية', 'Nom AR')} *</label>
          <input class="form-input" id="dt-nameAr" value="${esc(d.name_ar || '')}" /></div>
        <div class="form-field"><label>${l('الاسم بالفرنسية', 'Nom FR')} *</label>
          <input class="form-input" id="dt-nameFr" value="${esc(d.name_fr || '')}" /></div>
        <div class="form-field"><label>${l('الوصف بالعربية', 'Desc AR')}</label>
          <textarea class="form-input" id="dt-descAr" rows="2">${esc(d.description_ar || '')}</textarea></div>
        <div class="form-field"><label>${l('الوصف بالفرنسية', 'Desc FR')}</label>
          <textarea class="form-input" id="dt-descFr" rows="2">${esc(d.description_fr || '')}</textarea></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div class="form-field"><label>${l('الأيقونة', 'Icône')}</label>
            <input class="form-input" id="dt-icon" value="${esc(d.icon || 'fa-file')}" placeholder="fa-file" /></div>
          <div class="form-field"><label>${l('الترتيب', 'Ordre')}</label>
            <input class="form-input" id="dt-sort" type="number" value="${d.sort_order || 0}" /></div>
        </div>
        ${isEdit ? `<div class="form-field"><label>${l('نشط', 'Actif')}</label>
          <select class="form-input" id="dt-active"><option value="1" ${d.active ? 'selected' : ''}>${l('نعم', 'Oui')}</option><option value="0" ${!d.active ? 'selected' : ''}>${l('لا', 'Non')}</option></select></div>` : ''}
      </div>`;
    modal.footer.innerHTML = `
      <button class="btn btn-ghost" data-modal-cancel>${t('common.cancel')}</button>
      <button class="btn btn-primary" id="dt-ok">${t('common.save')}</button>`;
    openModal();
    modal.footer.querySelector('[data-modal-cancel]').addEventListener('click', closeModal);
    modal.footer.querySelector('#dt-ok').addEventListener('click', async () => {
      const payload = {
        nameAr: document.getElementById('dt-nameAr').value.trim(),
        nameFr: document.getElementById('dt-nameFr').value.trim(),
        descriptionAr: document.getElementById('dt-descAr').value.trim(),
        descriptionFr: document.getElementById('dt-descFr').value.trim(),
        icon: document.getElementById('dt-icon').value.trim() || 'fa-file',
        sortOrder: Number(document.getElementById('dt-sort').value) || 0
      };
      if (!payload.nameAr || !payload.nameFr) { toast(l('الحقول المطلوبة', 'Champs requis'), true); return; }
      if (isEdit) {
        payload.active = document.getElementById('dt-active').value === '1';
        await API.arcDocTypeUpdate(item.id, payload);
      } else {
        payload.code = document.getElementById('dt-code').value.trim();
        if (!payload.code) { toast(l('الكود مطلوب', 'Code requis'), true); return; }
        await API.arcDocTypeAdd(payload);
      }
      toast(t('common.save'));
      docTypes = await API.arcDocTypes();
      openDocTypesModal();
    });
  }

  /* ================================================================
     إدارة الوسوم
     ================================================================ */
  async function openTagsModal() {
    const tags = await API.arcTags();
    modal.title.textContent = l('إدارة الوسوم', 'Gestion des tags');
    renderTagsList(tags);
    modal.footer.innerHTML = `
      <button class="btn btn-ghost" data-modal-cancel>${t('common.close')}</button>
      <button class="btn btn-primary" id="arc-tag-add"><i class="fas fa-plus"></i> ${l('وسم جديد', 'Nouveau tag')}</button>`;
    openModal();
    modal.footer.querySelector('[data-modal-cancel]').addEventListener('click', closeModal);
    modal.footer.querySelector('#arc-tag-add').addEventListener('click', () => openTagForm(null, tags));
  }

  function renderTagsList(tags) {
    modal.body.innerHTML = tags.length ? `<div style="display:flex;flex-wrap:wrap;gap:8px;padding:8px 0">
      ${tags.map((tg) => `<div style="display:flex;align-items:center;gap:6px;padding:6px 12px;border-radius:20px;background:${esc(tg.color)}22;border:1px solid ${esc(tg.color)}44">
        <span style="color:${esc(tg.color)};font-weight:600">${esc(tg.name)}</span>
        <button class="row-btn del" data-tag-del="${tg.id}" style="margin:0;padding:2px" title="${t('common.delete')}"><i class="fas fa-times"></i></button>
      </div>`).join('')}
    </div>` : `<p style="color:var(--muted);text-align:center">${l('لا توجد وسوم', 'Aucun tag')}</p>`;

    modal.body.querySelectorAll('[data-tag-del]').forEach((b) => {
      b.onclick = async () => {
        const id = Number(b.getAttribute('data-tag-del'));
        if (!confirm(l('حذف الوسم؟', 'Supprimer le tag ?'))) return;
        try {
          await API.arcTagRemove(0, id);
          const newTags = await API.arcTags();
          renderTagsList(newTags);
        } catch (e) { toast(String(e.message || e), true); }
      };
    });
  }

  function openTagForm(item, allTags) {
    const isEdit = item && item.id;
    modal.title.textContent = isEdit ? l('تعديل الوسم', 'Modifier le tag') : l('وسم جديد', 'Nouveau tag');
    const d = item || {};
    modal.body.innerHTML = `
      <div class="form-grid" style="grid-template-columns:1fr">
        <div class="form-field"><label>${l('الاسم', 'Nom')} *</label>
          <input class="form-input" id="tag-name" value="${esc(d.name || '')}" /></div>
        <div class="form-field"><label>${l('اللون', 'Couleur')}</label>
          <div style="display:flex;gap:8px;align-items:center">
            <input type="color" id="tag-color" value="${esc(d.color || '#1f4e8c')}" style="width:48px;height:36px;border:none;cursor:pointer" />
            <input class="form-input" id="tag-color-hex" value="${esc(d.color || '#1f4e8c')}" style="flex:1" />
          </div>
          <div style="display:flex;gap:6px;margin-top:8px">
            ${['#1f4e8c','#e74c3c','#27ae60','#f39c12','#8e44ad','#1abc9c','#e67e22','#34495e'].map((c) => `<span data-tag-pick="${c}" style="width:24px;height:24px;border-radius:50%;background:${c};cursor:pointer;border:2px solid transparent"></span>`).join('')}
          </div>
        </div>
      </div>`;
    modal.footer.innerHTML = `
      <button class="btn btn-ghost" data-modal-cancel>${t('common.cancel')}</button>
      <button class="btn btn-primary" id="tag-ok">${t('common.save')}</button>`;
    openModal();

    const colorInput = document.getElementById('tag-color');
    const hexInput = document.getElementById('tag-color-hex');
    colorInput.oninput = () => { hexInput.value = colorInput.value; };
    hexInput.oninput = () => { if (/^#[0-9a-f]{6}$/i.test(hexInput.value)) colorInput.value = hexInput.value; };
    document.querySelectorAll('[data-tag-pick]').forEach((s) => {
      s.onclick = () => { const c = s.getAttribute('data-tag-pick'); colorInput.value = c; hexInput.value = c; };
    });

    modal.footer.querySelector('[data-modal-cancel]').addEventListener('click', closeModal);
    modal.footer.querySelector('#tag-ok').addEventListener('click', async () => {
      const name = document.getElementById('tag-name').value.trim();
      const color = document.getElementById('tag-color-hex').value.trim();
      if (!name) { toast(l('الاسم مطلوب', 'Nom requis'), true); return; }
      try {
        if (isEdit) {
          await API.arcTagRemove(0, item.id);
          await API.arcTagAdd(0, name, color);
        } else {
          await API.arcTagAdd(0, name, color);
        }
        toast(t('common.save'));
        const newTags = await API.arcTags();
        renderTagsList(newTags);
      } catch (e) { toast(String(e.message || e), true); }
    });
  }

  /* ================================================================
     ربط وثيقة بوثيقة أخرى
     ================================================================ */
  async function openAddRelationModal(fromDocId) {
    modal.title.textContent = l('إضافة علاقة', 'Ajouter une relation');
    modal.body.innerHTML = `
      <div class="form-grid" style="grid-template-columns:1fr">
        <div class="form-field"><label>${l('رقم الوثيقة المرتبطة', 'N° document')} *</label>
          <input class="form-input" id="rel-search" placeholder="${l('بحث بالرقم أو العنوان...', 'Rechercher...')}" />
          <div id="rel-results" style="max-height:150px;overflow-y:auto;margin-top:4px"></div>
          <input type="hidden" id="rel-to-id" /></div>
        <div class="form-field"><label>${l('نوع العلاقة', 'Type de relation')} *</label>
          <select class="form-input" id="rel-type">
            <option value="related">${l('مرتبط', 'Relié')}</option>
            <option value="copy_of">${l('نسخة من', 'Copie de')}</option>
            <option value="original_of">${l('أصل ل', 'Original de')}</option>
            <option value="amendment">${l('تعديل ل', 'Amendement de')}</option>
            <option value="attachment">${l('مرفق', 'Pièce jointe')}</option>
            <option value="successor">${l('تابع ل', 'Successeur de')}</option>
          </select></div>
        <div class="form-field"><label>${l('ملاحظة', 'Note')}</label>
          <input class="form-input" id="rel-note" /></div>
      </div>`;
    modal.footer.innerHTML = `
      <button class="btn btn-ghost" data-modal-cancel>${t('common.cancel')}</button>
      <button class="btn btn-primary" id="rel-ok">${t('common.save')}</button>`;
    openModal();

    const searchInput = document.getElementById('rel-search');
    const resultsDiv = document.getElementById('rel-results');
    const toIdInput = document.getElementById('rel-to-id');
    let searchTimeout;

    searchInput.oninput = () => {
      clearTimeout(searchTimeout);
      const q = searchInput.value.trim();
      if (q.length < 2) { resultsDiv.innerHTML = ''; toIdInput.value = ''; return; }
      searchTimeout = setTimeout(async () => {
        try {
          const res = await API.arcSearch({ q, page: 1, pageSize: 10 });
          const rows = (res.rows || []).filter((d) => d.id !== fromDocId);
          resultsDiv.innerHTML = rows.map((d) =>
            `<div data-rel-pick="${d.id}" style="padding:6px 8px;cursor:pointer;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:8px">
              <i class="fas ${mimeIcon(d.mime)}" style="opacity:.5"></i>
              <div><strong>${esc(d.doc_number || '')}</strong> — ${esc(d.title || '—')}</div>
            </div>`
          ).join('') || `<p style="color:var(--muted);padding:8px">${l('لا نتائج', 'Aucun résultat')}</p>`;
          resultsDiv.querySelectorAll('[data-rel-pick]').forEach((el) => {
            el.onclick = () => {
              toIdInput.value = el.getAttribute('data-rel-pick');
              searchInput.value = el.textContent.trim();
              resultsDiv.innerHTML = '';
            };
          });
        } catch (e) { /* silent */ }
      }, 300);
    };

    modal.footer.querySelector('[data-modal-cancel]').addEventListener('click', closeModal);
    modal.footer.querySelector('#rel-ok').addEventListener('click', async () => {
      const toId = Number(toIdInput.value);
      const relType = document.getElementById('rel-type').value;
      const note = document.getElementById('rel-note').value.trim();
      if (!toId) { toast(l('اختر وثيقة', 'Choisir un document'), true); return; }
      try {
        await API.arcRelationAdd(fromDocId, toId, relType, note);
        toast(t('common.save'));
        closeModal();
        openDocDetail(fromDocId);
      } catch (e) { toast(String(e.message || e), true); }
    });
  }

  /* ================================================================
     حذف نهائي (مدير فقط)
     ================================================================ */
  async function permanentDeleteDoc(id) {
    if (!confirm(l('⚠ تحذير: الحذف النهائي لا رجعة فيه!', '⚠ Attention: suppression irréversible !'))) return;
    const reason = prompt(l('سبب الحذف النهائي (مطلوب)', 'Motif de la suppression'));
    if (reason === null) return;
    try {
      await API.arcPermanentDelete(id);
      toast(l('حذف نهائي', 'Supprimé définitivement'));
      closeModal();
      renderDocsTable();
      renderStats();
    } catch (e) { toast(String(e.message || e), true); }
  }

  /* ================================================================
     حذف وسم من وثيقة
     ================================================================ */
  async function removeTagFromDoc(docId, tagId) {
    try {
      await API.arcTagRemove(docId, tagId);
      openDocDetail(docId);
    } catch (e) { toast(String(e.message || e), true); }
  }

  /* ================================================================
     إضافة وسم لوثيقة
     ================================================================ */
  async function openAddTagToDocModal(docId) {
    const allTags = await API.arcTags();
    modal.title.textContent = l('إضافة وسم للوثيقة', 'Ajouter un tag');
    modal.body.innerHTML = `
      <div class="form-grid" style="grid-template-columns:1fr">
        <div class="form-field"><label>${l('اختر وسماً', 'Choisir un tag')}</label>
          <select class="form-input" id="addtag-select">
            <option value="">—</option>
            ${allTags.map((tg) => `<option value="${tg.id}">${esc(tg.name)}</option>`).join('')}
          </select></div>
        <p style="color:var(--muted);margin:0;font-size:.85em">${l('أو أنشئ وسماً جديداً', 'Ou créer un nouveau tag')}</p>
        <div style="display:grid;grid-template-columns:2fr 1fr;gap:8px">
          <div class="form-field"><label>${l('الاسم', 'Nom')}</label>
            <input class="form-input" id="addtag-name" /></div>
          <div class="form-field"><label>${l('اللون', 'Couleur')}</label>
            <input type="color" id="addtag-color" value="#1f4e8c" style="width:100%;height:36px;border:none;cursor:pointer" /></div>
        </div>
      </div>`;
    modal.footer.innerHTML = `
      <button class="btn btn-ghost" data-modal-cancel>${t('common.cancel')}</button>
      <button class="btn btn-primary" id="addtag-ok">${t('common.save')}</button>`;
    openModal();
    modal.footer.querySelector('[data-modal-cancel]').addEventListener('click', closeModal);
    modal.footer.querySelector('#addtag-ok').addEventListener('click', async () => {
      let tagId = Number(document.getElementById('addtag-select').value);
      if (!tagId) {
        const name = document.getElementById('addtag-name').value.trim();
        const color = document.getElementById('addtag-color').value;
        if (!name) { toast(l('اختر وسماً أو أدخل اسماً', 'Choisir ou saisir un nom'), true); return; }
        try {
          await API.arcTagAdd(docId, name, color);
          toast(t('common.save'));
          closeModal();
          openDocDetail(docId);
        } catch (e) { toast(String(e.message || e), true); }
        return;
      }
      const tag = allTags.find((t) => t.id === tagId);
      try {
        await API.arcTagAdd(docId, tag ? tag.name : '', tag ? tag.color : '#1f4e8c');
        toast(t('common.save'));
        closeModal();
        openDocDetail(docId);
      } catch (e) { toast(String(e.message || e), true); }
    });
  }

  /* ================================================================
     حذف علاقة
     ================================================================ */
  async function removeRelation(fromDocId, toDocId, relType) {
    try {
      await API.arcRelationRemove(fromDocId, toDocId, relType);
      openDocDetail(fromDocId);
    } catch (e) { toast(String(e.message || e), true); }
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
    const uploadBtn = document.getElementById('arc-btn-upload');
    const doctypesBtn = document.getElementById('arc-btn-doctypes');
    const tagsBtn = document.getElementById('arc-btn-tags');

    if (searchEl) searchEl.addEventListener('input', () => applyFilters());
    if (searchClear) searchClear.addEventListener('click', () => { searchEl.value = ''; applyFilters(); });
    if (typeFilter) typeFilter.addEventListener('change', () => applyFilters());
    if (statusFilter) statusFilter.addEventListener('change', () => applyFilters());
    if (moreDocsBtn) moreDocsBtn.addEventListener('click', () => { LS.page++; renderDocsTable(); });
    if (moreTplBtn) moreTplBtn.addEventListener('click', () => { tplPage++; renderTemplatesTable(); });
    if (tabDocs) tabDocs.addEventListener('click', () => { LS.activeTab = 'docs'; renderTabs(); });
    if (tabTpl) tabTpl.addEventListener('click', () => { LS.activeTab = 'templates'; renderTabs(); renderTemplatesTable(); });
    if (uploadBtn) uploadBtn.addEventListener('click', () => openUploadModal());
    if (doctypesBtn) doctypesBtn.addEventListener('click', () => openDocTypesModal());
    if (tagsBtn) tagsBtn.addEventListener('click', () => openTagsModal());

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
