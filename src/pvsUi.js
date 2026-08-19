/* ================================================================
   المحاضر — PvsModule (وحدة المحاضر / Procès-Verbaux)
   قائمة | بحث | تصفية | إنشاء من إجراء+قالب | تحرير | معاينة |
   إنهاء | نظائر (نسخ) | إصدارات | سجل/تدقيق
   ================================================================ */

'use strict';

(function () {
  const {
    API, state, t, toast, escapeHtml: esc, fmtDate
  } = window.HuissierApp;

  const byId = (id) => document.getElementById(id);

  const S = {
    page: 1,
    pageSize: 12,
    search: '',
    status: '',
    typeId: '',
    loaded: 0,
    total: 0,
    rows: [],
    statuses: [],
    types: [],
    canDelete: false,
    current: null,
    detailTab: 'info'
  };

  let bound = false;
  let debounceTimer = null;

  /* ---------- أدوات ---------- */
  function statusOf(code) {
    return S.statuses.find((x) => x.code === code) || null;
  }

  function statusBadge(code) {
    const st = statusOf(code);
    const cls = (st && st.color) || 'gray';
    const label = st ? (state.lang === 'fr' ? st.name_fr : st.name_ar) : code;
    return `<span class="badge st-${esc(cls)}">${esc(label)}</span>`;
  }

  function typeName(id) {
    const x = S.types.find((tp) => tp.id === id);
    if (!x) return '—';
    return state.lang === 'fr' ? (x.name_fr || x.name_ar) : (x.name_ar || x.name_fr);
  }

  function copyStatusBadge(st) {
    const map = {
      generated: [state.lang === 'fr' ? 'Générée' : 'مولدة', 'st-gray'],
      delivered: [state.lang === 'fr' ? 'Livrée' : 'سُلمت', 'st-blue'],
      deposited: [state.lang === 'fr' ? 'Déposée' : 'أودعت', 'st-green']
    };
    const m = map[st] || [esc(st), 'st-gray'];
    return `<span class="badge ${m[1]}">${esc(m[0])}</span>`;
  }

  function copyDestLabel(c) {
    return state.lang === 'fr' ? (c.label_fr || c.destination) : (c.label_ar || c.destination);
  }

  /* ---------- تهيئة ---------- */
  async function init() {
    try {
      S.statuses = await API.pvStatuses();
    } catch (e) { S.statuses = []; }
    try {
      S.types = await API.pvTypes();
    } catch (e) { S.types = []; }
    try {
      S.transitions = await API.pvTransitions();
    } catch (e) { S.transitions = []; }
    try {
      S.canDelete = await API.authIsAuthorized('pv.delete');
    } catch (e) { S.canDelete = false; }
    buildStatusSelect();
    buildTypeSelect();
    if (!bound) { bindEvents(); bound = true; }
  }

  function buildStatusSelect() {
    const sel = byId('pv-filter-status');
    if (!sel) return;
    sel.innerHTML = `<option value="">${esc(t('pvs.filterAll'))}</option>` +
      S.statuses.map((s) => {
        const label = state.lang === 'fr' ? s.name_fr : s.name_ar;
        return `<option value="${esc(s.code)}" ${s.code === S.status ? 'selected' : ''}>${esc(label)}</option>`;
      }).join('');
  }

  function buildTypeSelect() {
    const sel = byId('pv-filter-type');
    if (!sel) return;
    sel.innerHTML = `<option value="">${esc(state.lang === 'fr' ? 'Tous les types' : 'جميع الأنواع')}</option>` +
      S.types.map((tp) => {
        const label = state.lang === 'fr' ? tp.name_fr : tp.name_ar;
        return `<option value="${tp.id}" ${String(tp.id) === String(S.typeId) ? 'selected' : ''}>${esc(label)}</option>`;
      }).join('');
  }

  /* ---------- العرض الرئيسي ---------- */
  async function render() {
    byId('pv-thead').innerHTML = `<tr>
      <th>${state.lang === 'fr' ? 'N° PV' : 'رقم المحضر'}</th>
      <th>${state.lang === 'fr' ? 'Titre' : 'العنوان'}</th>
      <th>${state.lang === 'fr' ? 'Type' : 'النوع'}</th>
      <th>${state.lang === 'fr' ? 'Procédure' : 'الإجراء'}</th>
      <th>${state.lang === 'fr' ? 'Dossier' : 'الملف'}</th>
      <th>${state.lang === 'fr' ? 'Statut' : 'الحالة'}</th>
      <th>${state.lang === 'fr' ? 'Copies' : 'النظائر'}</th>
      <th>${state.lang === 'fr' ? 'Date' : 'التاريخ'}</th>
      <th>${state.lang === 'fr' ? 'Actions' : 'إجراءات'}</th>
    </tr>`;
    byId('pv-filter-chip').hidden = !(S.status || S.typeId);
    await loadStats();
    await loadList(false);
  }

  async function loadStats() {
    try {
      const s = await API.pvStats();
      byId('pvstat-total').textContent = s.total;
      byId('pvstat-drafts').textContent = s.drafts;
      byId('pvstat-finalized').textContent = s.finalized;
      byId('pvstat-archived').textContent = s.archived;
      byId('pvstat-cancelled').textContent = s.cancelled;
    } catch (e) { }
  }

  async function loadList(append) {
    const page = append ? S.page + 1 : 1;
    try {
      const res = await API.pvList({
        page,
        pageSize: S.pageSize,
        q: S.search || undefined,
        status: S.status || undefined,
        pvTypeId: S.typeId ? Number(S.typeId) : undefined
      });
      S.page = page;
      S.total = res.total;
      S.loaded = res.rows.length;
      const rows = append ? S.rows.concat(res.rows) : res.rows;
      S.rows = rows;

      byId('pv-tbody').innerHTML = rows.map((r) => `
        <tr>
          <td><strong>${esc(r.pv_number)}</strong></td>
          <td>${esc(r.title || '—')}</td>
          <td>${esc(r.type_name_ar ? typeName(r.pv_type_id) : '—')}</td>
          <td>${esc(r.procedure_number || '—')}</td>
          <td>${esc(r.dossier_number || '—')}${esc(r.dossier_demandeur ? '<br><small>' + r.dossier_demandeur + '</small>' : '')}</td>
          <td>${statusBadge(r.status)}</td>
          <td>${r.copies_count || 0}${r.copies_delivered ? ' / ' + r.copies_delivered : ''}</td>
          <td>${fmtDate(r.created_at)}</td>
          <td><div class="row-actions">
            <button class="row-btn" data-pv-view="${r.id}" title="${state.lang === 'fr' ? 'Voir' : 'عرض'}"><i class="fas fa-eye"></i></button>
            ${S.canDelete ? `<button class="row-btn del" data-pv-del="${r.id}" title="${state.lang === 'fr' ? 'Supprimer' : 'حذف'}"><i class="fas fa-trash"></i></button>` : ''}
          </div></td>
        </tr>`).join('');

      byId('pv-empty').classList.toggle('hidden', rows.length > 0);
      byId('pv-count').textContent = state.lang === 'fr'
        ? `${rows.length} / ${S.total} PV`
        : `${rows.length} من ${S.total} محضر`;
      byId('pv-more').style.display = S.loaded >= S.total ? 'none' : '';

      bindRowActions();
    } catch (e) {
      toast(e.message, true);
    }
  }

  function bindRowActions() {
    document.querySelectorAll('[data-pv-view]').forEach((b) => {
      b.addEventListener('click', () => openDetail(Number(b.getAttribute('data-pv-view'))));
    });
    document.querySelectorAll('[data-pv-del]').forEach((b) => {
      b.addEventListener('click', async () => {
        const id = Number(b.getAttribute('data-pv-del'));
        if (!confirm(state.lang === 'fr' ? 'Supprimer ce PV ?' : 'حذف هذا المحضر؟')) return;
        try {
          await API.pvDelete(id);
          toast(t('common.delete'));
          render();
        } catch (e) { toast(e.message, true); }
      });
    });
  }

  /* ================================================================
     إنشاء محضر (إجراء → نوع → قالب → لغة)
     ================================================================ */
  let createState = { proc: null, templates: [] };

  function openCreate() {
    createState = { proc: null, templates: [] };
    byId('pv-create-search').value = '';
    byId('pv-create-procedures').innerHTML = '';
    byId('pv-create-fields').hidden = true;
    byId('pv-create-modal').querySelector('.modal-header h3').textContent =
      state.lang === 'fr' ? 'Nouveau PV' : 'محضر جديد';
    byId('pv-create-backdrop').classList.add('show');
    byId('pv-create-search').focus();
  }

  function closeCreate() {
    byId('pv-create-backdrop').classList.remove('show');
  }

  async function searchProcedures(q) {
    const box = byId('pv-create-procedures');
    if (!q) { box.innerHTML = ''; return; }
    try {
      const res = await API.procList({ q, page: 1, pageSize: 8 });
      box.innerHTML = res.rows.length
        ? res.rows.map((p) => `
          <button class="dos-result" data-pv-proc="${p.id}">
            <div class="cell-stack"><strong>${esc(p.procedure_number)}</strong>
              <small>${esc(p.type_name_ar || p.type_name_fr || '')} — ${esc(p.dossier_number || '')}</small>
              <small class="muted">${esc(p.dossier_demandeur || '')} / ${esc(p.dossier_defendeur || '')}</small></div>
            <small class="muted">${esc(p.type_name_fr || '')}</small>
          </button>`).join('')
        : `<p class="hint">${state.lang === 'fr' ? 'Aucun résultat' : 'لا توجد نتائج'}</p>`;
      box.querySelectorAll('[data-pv-proc]').forEach((el) => {
        el.addEventListener('click', () => selectProcedure(Number(el.getAttribute('data-pv-proc'))));
      });
    } catch (e) {
      box.innerHTML = '';
    }
  }

  async function selectProcedure(id) {
    try {
      const proc = await API.procGet(id);
      createState.proc = proc;
      byId('pv-create-search').value = proc.procedure_number + ' — ' + (proc.type ? (state.lang === 'fr' ? proc.type.name_fr : proc.type.name_ar) : '');
      byId('pv-create-procedures').innerHTML = '';

      const templates = await API.tplForProcedure(proc.procedure_type_id, state.lang);
      createState.templates = templates.filter((tp) => tp.current_version_id > 0);

      byId('pv-create-selected').innerHTML = `
        <div class="form-field full">
          <span class="hint">${state.lang === 'fr' ? 'Procédure sélectionnée' : 'الإجراء المختار'}</span>
          <strong>${esc(proc.procedure_number)}</strong> — ${esc(proc.dossier ? proc.dossier.numero : '')} — ${esc(proc.dossier ? proc.dossier.demandeur : '')}
        </div>`;

      const typeOpts = S.types.map((tp) => {
        const inferred = inferPvType(proc.type ? proc.type.code : null);
        const selected = inferred && tp.id === inferred.id ? 'selected' : S.types[0] && tp.id === S.types[0].id ? 'selected' : '';
        return `<option value="${tp.id}" ${selected}>${esc(state.lang === 'fr' ? tp.name_fr : tp.name_ar)}</option>`;
      }).join('');
      byId('pv-create-type-wrap').innerHTML = `<div class="form-field">${state.lang === 'fr' ? 'Type de PV' : 'نوع المحضر'}<select class="form-input" id="pv-create-type">${typeOpts}</select></div>`;

      const tplOpts = createState.templates.length
        ? createState.templates.map((tp) =>
          `<option value="${tp.current_version_id}">${esc(tp.name)} (v${esc(tp.current_version || '')})</option>`).join('')
        : `<option value="">${state.lang === 'fr' ? 'Aucun modèle' : 'لا يوجد قالب'}</option>`;
      byId('pv-create-template-wrap').innerHTML = `<div class="form-field">${state.lang === 'fr' ? 'Modèle' : 'القالب'}<select class="form-input" id="pv-create-template">${tplOpts}</select></div>`;

      byId('pv-create-lang-wrap').innerHTML = `<div class="form-field">${state.lang === 'fr' ? 'Langue' : 'اللغة'}
        <select class="form-input" id="pv-create-lang">
          <option value="ar">${state.lang === 'fr' ? 'Arabe' : 'العربية'}</option>
          <option value="fr">${state.lang === 'fr' ? 'Français' : 'الفرنسية'}</option>
        </select></div>`;

      byId('pv-create-title-wrap').innerHTML = `<div class="form-field">${state.lang === 'fr' ? 'Titre' : 'العنوان'}<input class="form-input" id="pv-create-title" type="text"></div>`;
      byId('pv-create-notes-wrap').innerHTML = `<div class="form-field">${state.lang === 'fr' ? 'Notes' : 'ملاحظات'}<textarea class="form-input" id="pv-create-notes" rows="2"></textarea></div>`;

      byId('pv-create-fields').hidden = false;
    } catch (e) {
      toast(e.message, true);
    }
  }

  async function doCreate() {
    const tplSel = byId('pv-create-template');
    if (!createState.proc) { toast(t('pvs.create.needProc'), true); return; }
    if (!tplSel || !tplSel.value) { toast(t('pvs.create.needTemplate'), true); return; }
    try {
      const pv = await API.pvCreate({
        procedure_id: createState.proc.id,
        pv_type_id: Number(byId('pv-create-type').value),
        template_version_id: Number(tplSel.value),
        language: byId('pv-create-lang').value,
        title: byId('pv-create-title').value.trim(),
        notes: byId('pv-create-notes').value.trim()
      });
      closeCreate();
      toast(t('common.save'));
      render();
      openDetail(pv.id);
    } catch (e) {
      toast(e.message, true);
    }
  }

  /* ================================================================
     تفاصيل المحضر (تبويبات)
     ================================================================ */
  const TABS = ['info', 'document', 'copies', 'versions', 'timeline'];

  async function openDetail(id) {
    S.detailTab = 'info';
    try {
      S.current = await API.pvGet(id);
      byId('pv-detail-title').textContent = S.current.pv_number + ' — ' + (S.current.title || '');
      renderDetailTabs();
      renderDetailTab();
      byId('pv-detail-backdrop').classList.add('show');
    } catch (e) {
      toast(e.message, true);
    }
  }

  function closeDetail() {
    byId('pv-detail-backdrop').classList.remove('show');
    S.current = null;
  }

  function renderDetailTabs() {
    const labels = {
      info: state.lang === 'fr' ? 'Informations' : 'المعلومات',
      document: state.lang === 'fr' ? 'Document' : 'الوثيقة',
      copies: state.lang === 'fr' ? 'Copies' : 'النظائر',
      versions: state.lang === 'fr' ? 'Versions' : 'الإصدارات',
      timeline: state.lang === 'fr' ? 'Historique' : 'السجل'
    };
    byId('pv-detail-tabs').innerHTML = TABS.map((k) =>
      `<button class="dtab ${k === S.detailTab ? 'active' : ''}" data-pv-tab="${k}">${labels[k]}</button>`).join('');
    byId('pv-detail-tabs').querySelectorAll('[data-pv-tab]').forEach((b) => {
      b.addEventListener('click', () => {
        S.detailTab = b.getAttribute('data-pv-tab');
        renderDetailTabs();
        renderDetailTab();
      });
    });
  }

  async function renderDetailTab() {
    const pv = S.current;
    if (!pv) return;
    const body = byId('pv-detail-body');
    const footer = byId('pv-detail-footer');

    if (S.detailTab === 'info') body.innerHTML = infoHtml(pv);
    else if (S.detailTab === 'document') await renderDocumentTab(body, pv);
    else if (S.detailTab === 'copies') body.innerHTML = copiesHtml(pv);
    else if (S.detailTab === 'versions') body.innerHTML = versionsHtml(pv);
    else body.innerHTML = timelineHtml(pv);

    footer.innerHTML = footerActions(pv);
    bindFooterActions();
    bindTabActions();
  }

  function kv(label, val) {
    return `<tr><td class="k">${esc(label)}</td><td class="v">${val === '' || val === null || val === undefined ? '—' : val}</td></tr>`;
  }

  function infoHtml(pv) {
    const proc = pv.procedure || {};
    const d = proc.dossier || {};
    const steps = ['DRAFT', 'IN_REVIEW', 'FINALIZED', 'ARCHIVED'];
    const stepIdx = steps.indexOf(pv.status);
    const lifecycleHtml = pv.status !== 'CANCELLED' ? `
      <div class="pv-lifecycle" style="display:flex;align-items:center;gap:0;margin:16px 0;padding:12px 16px;background:var(--bg);border-radius:8px">
        ${steps.map((s, i) => {
          const st = statusOf(s);
          const label = st ? (state.lang === 'fr' ? st.name_fr : st.name_ar) : s;
          const done = i <= stepIdx;
          const current = i === stepIdx;
          return `<div style="flex:1;text-align:center;position:relative">
            <div style="width:32px;height:32px;border-radius:50%;margin:0 auto 4px;display:flex;align-items:center;justify-content:center;font-size:.8em;font-weight:700;
              background:${current ? 'var(--primary)' : done ? 'var(--success)' : 'var(--border)'};
              color:${done ? '#fff' : 'var(--muted)'}">${i + 1}</div>
            <div style="font-size:.7em;color:${current ? 'var(--primary)' : done ? 'var(--text)' : 'var(--muted)'};font-weight:${current ? '700' : '400'}">${esc(label)}</div>
          </div>${i < steps.length - 1 ? `<div style="flex:0.5;height:2px;background:${i < stepIdx ? 'var(--success)' : 'var(--border)'}"></div>` : ''}`;
        }).join('')}
      </div>` : '';

    return `
      <div style="text-align:right;margin-bottom:8px">
        <button class="btn btn-sm btn-ghost" data-pv-edit-meta="${pv.id}"><i class="fas fa-pen"></i> ${state.lang === 'fr' ? 'Modifier' : 'تعديل البيانات'}</button>
      </div>
      ${lifecycleHtml}
      <table class="kv-table">
        ${kv(state.lang === 'fr' ? 'N° PV' : 'رقم المحضر', `<strong>${esc(pv.pv_number)}</strong>`)}
        ${kv(state.lang === 'fr' ? 'Titre' : 'العنوان', esc(pv.title))}
        ${kv(state.lang === 'fr' ? 'Type' : 'النوع', esc(typeName(pv.pv_type_id)))}
        ${kv(state.lang === 'fr' ? 'Statut' : 'الحالة', statusBadge(pv.status))}
        ${kv(state.lang === 'fr' ? 'Langue' : 'اللغة', pv.language === 'fr' ? 'FR' : 'AR')}
        ${kv(state.lang === 'fr' ? 'Procédure' : 'الإجراء', `<a href="#" class="link" data-goto-proc="${pv.procedure_id}">${esc(proc.procedure_number || '—')}</a>`)}
        ${kv(state.lang === 'fr' ? 'Dossier' : 'الملف', esc(d.numero || '—') + (d.demandeur ? '<br><small>' + esc(d.demandeur) + '</small>' : ''))}
        ${kv(state.lang === 'fr' ? 'Tribunal' : 'المحكمة', esc(d.court || ''))}
        ${kv(state.lang === 'fr' ? 'Modèle' : 'القالب', pv.template_version_id ? '#' + pv.template_version_id : '—')}
        ${kv(state.lang === 'fr' ? 'Version' : 'الإصدار', `v${pv.versions.length || 1}`)}
        ${kv(state.lang === 'fr' ? 'Copies' : 'النظائر', `${pv.copies.length} ${state.lang === 'fr' ? 'copie(s)' : 'نظائر'}`)}
        ${kv(state.lang === 'fr' ? 'Créé le' : 'تاريخ الإنشاء', fmtDate(pv.created_at) + ' — ' + esc(pv.created_by))}
        ${pv.finalized_at ? kv(state.lang === 'fr' ? 'Finalisé' : 'مُنهى', fmtDate(pv.finalized_at) + ' — ' + esc(pv.finalized_by)) : ''}
        ${pv.archived_at ? kv(state.lang === 'fr' ? 'Archivé' : 'مؤرشف', fmtDate(pv.archived_at) + ' — ' + esc(pv.archived_by)) : ''}
        ${pv.cancelled_at ? kv(state.lang === 'fr' ? 'Annulé' : 'ملغى', fmtDate(pv.cancelled_at) + ' — ' + esc(pv.cancelled_by)) : ''}
        ${kv(state.lang === 'fr' ? 'Notes' : 'ملاحظات', esc(pv.notes))}
      </table>`;
  }

  async function renderDocumentTab(body, pv) {
    body.innerHTML = `
      <div class="doc-actions-row">
        ${pv.status === 'DRAFT' || pv.status === 'IN_REVIEW' ? `
          <button class="btn btn-primary" data-pv-edit="${pv.id}"><i class="fas fa-pen"></i> ${state.lang === 'fr' ? 'Éditer' : 'تحرير'}</button>
          <button class="btn btn-ghost" data-pv-refresh="${pv.id}"><i class="fas fa-rotate"></i> ${state.lang === 'fr' ? 'Régénérer du modèle' : 'إعادة التعبئة من القالب'}</button>` : ''}
        ${pv.copies.some((c) => c.document_id) ? `
          <button class="btn btn-ghost" data-pv-print="${pv.id}"><i class="fas fa-print"></i> ${state.lang === 'fr' ? 'Imprimer' : 'طباعة'}</button>` : ''}
      </div>
      <div class="pv-preview-wrap">
        <iframe class="tpl-preview-frame" id="pv-preview-frame" sandbox="allow-scripts"></iframe>
      </div>`;
    try {
      const html = await API.pvPreview(pv.id, state.lang);
      byId('pv-preview-frame').srcdoc = html;
    } catch (e) {
      body.querySelector('.pv-preview-wrap').innerHTML = `<p class="hint">${esc(e.message)}</p>`;
    }
  }

  function copiesHtml(pv) {
    if (!pv.copies.length) {
      return `<div class="empty-state"><i class="fas fa-copy"></i><p>${state.lang === 'fr' ? 'Aucune copie. Finalisez le PV pour générer les 3 copies.' : 'لا توجد نظائر بعد. أنهِ المحضر لتوليد النظائر الثلاثة.'}</p></div>`;
    }
    return `
      <table class="data-table">
        <thead><tr>
          <th>#</th>
          <th>${state.lang === 'fr' ? 'Copie' : 'النسخة'}</th>
          <th>${state.lang === 'fr' ? 'Destination' : 'الوجهة'}</th>
          <th>${state.lang === 'fr' ? 'Statut' : 'الحالة'}</th>
          <th>${state.lang === 'fr' ? 'Livrée le' : 'تاريخ التسليم'}</th>
          <th>${state.lang === 'fr' ? 'Actions' : 'إجراءات'}</th>
        </tr></thead>
        <tbody>
        ${pv.copies.map((c) => `
          <tr>
            <td><strong>${c.copy_number}</strong></td>
            <td>${esc(copyDestLabel(c))}</td>
            <td><code>${esc(c.destination)}</code></td>
            <td>${copyStatusBadge(c.status)}</td>
            <td>${c.delivered_at ? fmtDate(c.delivered_at) + '<br><small>' + esc(c.delivered_by) + '</small>' : '—'}</td>
            <td><div class="row-actions">
              ${c.document_id ? `
                <button class="row-btn" data-pv-doc-open="${c.document_id}" title="${state.lang === 'fr' ? 'Ouvrir' : 'فتح'}"><i class="fas fa-eye"></i></button>
                <button class="row-btn" data-pv-doc-dl="${c.document_id}" title="${state.lang === 'fr' ? 'Télécharger' : 'تحميل'}"><i class="fas fa-download"></i></button>` : ''}
              ${(pv.status === 'FINALIZED' || pv.status === 'ARCHIVED') ? `
                <button class="row-btn" data-pv-copy-status="${c.id}:delivered" title="${state.lang === 'fr' ? 'Remettre' : 'تسليم'}"><i class="fas fa-hand"></i></button>
                <button class="row-btn" data-pv-copy-status="${c.id}:deposited" title="${state.lang === 'fr' ? 'Déposer' : 'إيداع'}"><i class="fas fa-bank"></i></button>
                <button class="row-btn" data-pv-copy-reg="${c.id}" title="${state.lang === 'fr' ? 'Régénérer' : 'إعادة توليد'}"><i class="fas fa-rotate"></i></button>` : ''}
            </div></td>
          </tr>`).join('')}
        </tbody>
      </table>`;
  }

  function versionsHtml(pv) {
    return pv.versions.length
      ? `<table class="data-table"><thead><tr>
          <th>${state.lang === 'fr' ? 'Version' : 'الإصدار'}</th>
          <th>${state.lang === 'fr' ? 'Note' : 'الملاحظة'}</th>
          <th>${state.lang === 'fr' ? 'Par' : 'بواسطة'}</th>
          <th>${state.lang === 'fr' ? 'Date' : 'التاريخ'}</th>
          <th>${state.lang === 'fr' ? 'Contenu' : 'المحتوى'}</th>
        </tr></thead><tbody>
        ${pv.versions.map((v) => `
          <tr>
            <td><strong>v${v.version}</strong></td>
            <td>${esc(v.note)}</td>
            <td>${esc(v.created_by)}</td>
            <td>${fmtDate(v.created_at)}</td>
            <td><button class="row-btn" data-pv-ver="${v.id}" title="${state.lang === 'fr' ? 'Aperçu' : 'معاينة'}"><i class="fas fa-eye"></i></button></td>
          </tr>`).join('')}
      </tbody></table>`
      : `<div class="empty-state"><i class="fas fa-layer-group"></i><p>${state.lang === 'fr' ? 'Aucune version' : 'لا توجد إصدارات'}</p></div>`;
  }

  function timelineHtml(pv) {
    const events = pv.timeline || [];
    return events.length
      ? `<ul class="timeline">${events.map((ev) => `
          <li class="timeline-item ${ev.type === 'status' ? 'tl-status' : ''}">
            <div class="tl-date">${fmtDate(ev.date)}</div>
            <div class="tl-title">${esc(ev.type === 'status' ? (statusOf(ev.status) ? (state.lang === 'fr' ? statusOf(ev.status).name_fr : statusOf(ev.status).name_ar) : ev.text) : ev.text)}</div>
            <div class="tl-desc">${esc(ev.desc || '')}</div>
            <small class="tl-user">${esc(ev.user || '')}</small>
          </li>`).join('')}</ul>`
      : `<div class="empty-state"><i class="fas fa-clock-rotate-left"></i><p>${state.lang === 'fr' ? 'Aucun événement' : 'لا توجد أحداث'}</p></div>`;
  }

  function footerActions(pv) {
    const btns = [];
    const transitions = S.transitions || [];
    const allowed = transitions.filter((tr) => tr.from_status === pv.status);

    if (pv.status === 'DRAFT' || pv.status === 'IN_REVIEW') {
      const hasFinalize = allowed.some((tr) => tr.to_status === 'FINALIZED');
      if (hasFinalize) {
        btns.push(`<button class="btn btn-success" data-pv-finalize="${pv.id}"><i class="fas fa-file-pdf"></i> ${state.lang === 'fr' ? 'Finaliser + PDF' : 'إنهاء وتوليد PDF'}</button>`);
      }
    }

    allowed.forEach((tr) => {
      const st = statusOf(tr.to_status);
      const label = st ? (state.lang === 'fr' ? st.name_fr : st.name_ar) : tr.to_status;
      const isDanger = tr.to_status === 'CANCELLED';
      const icon = tr.to_status === 'IN_REVIEW' ? 'fa-magnifying-glass' : tr.to_status === 'DRAFT' ? 'fa-arrow-rotate-left' : tr.to_status === 'ARCHIVED' ? 'fa-box-archive' : tr.to_status === 'FINALIZED' ? 'fa-file-pdf' : 'fa-ban';
      btns.push(`<button class="btn ${isDanger ? 'btn-ghost danger' : 'btn-primary'}" data-pv-status="${tr.to_status}"><i class="fas ${icon}"></i> ${esc(label)}</button>`);
    });

    btns.push(`<button class="btn btn-ghost" data-pv-close-detail><i class="fas fa-xmark"></i> ${state.lang === 'fr' ? 'Fermer' : 'إغلاق'}</button>`);
    return btns.join('');
  }

  function bindFooterActions() {
    const footer = byId('pv-detail-footer');
    footer.querySelectorAll('[data-pv-status]').forEach((b) => {
      b.addEventListener('click', async () => {
        const to = b.getAttribute('data-pv-status');
        const note = prompt(state.lang === 'fr' ? 'Note (optionnel)' : 'ملاحظة (اختياري)') || '';
        try {
          S.current = await API.pvApplyStatus(S.current.id, to, note);
          renderDetailTabs();
          renderDetailTab();
          toast(t('common.save'));
        } catch (e) { toast(e.message, true); }
      });
    });
    footer.querySelector('[data-pv-finalize]')?.addEventListener('click', async () => {
      const b = footer.querySelector('[data-pv-finalize]');
      b.disabled = true;
      try {
        S.current = await API.pvFinalize(S.current.id);
        renderDetailTabs();
        renderDetailTab();
        toast(t('common.save'));
      } catch (e) {
        toast(e.message, true);
        b.disabled = false;
      }
    });
    footer.querySelector('[data-pv-close-detail]')?.addEventListener('click', closeDetail);
  }

  function bindTabActions() {
    const body = byId('pv-detail-body');

    body.querySelectorAll('[data-pv-edit]').forEach((b) => {
      b.addEventListener('click', () => openEditor(S.current));
    });
    body.querySelectorAll('[data-pv-refresh]').forEach((b) => {
      b.addEventListener('click', async () => {
        try {
          S.current = await API.pvRefreshFromTemplate(S.current.id);
          toast(t('common.save'));
          renderDetailTab();
        } catch (e) { toast(e.message, true); }
      });
    });
    body.querySelectorAll('[data-pv-print]').forEach((b) => {
      b.addEventListener('click', async () => {
        const copy = S.current.copies.find((c) => c.document_id);
        if (copy) { try { await API.pvPrintDoc(copy.document_id); } catch (e) { toast(e.message, true); } }
      });
    });
    body.querySelectorAll('[data-pv-doc-open]').forEach((b) => {
      b.addEventListener('click', async () => {
        try { await API.pvOpenDoc(Number(b.getAttribute('data-pv-doc-open'))); } catch (e) { toast(e.message, true); }
      });
    });
    body.querySelectorAll('[data-pv-doc-dl]').forEach((b) => {
      b.addEventListener('click', async () => {
        try { await API.pvDownloadDoc(Number(b.getAttribute('data-pv-doc-dl'))); } catch (e) { toast(e.message, true); }
      });
    });
    body.querySelectorAll('[data-pv-copy-status]').forEach((b) => {
      b.addEventListener('click', async () => {
        const [copyId, status] = b.getAttribute('data-pv-copy-status').split(':');
        const note = prompt(state.lang === 'fr' ? 'Note (optionnel)' : 'ملاحظة (اختياري)') || '';
        try {
          await API.pvSetCopyStatus(Number(copyId), status, note);
          S.current = await API.pvGet(S.current.id);
          renderDetailTab();
          toast(t('common.save'));
        } catch (e) { toast(e.message, true); }
      });
    });
    body.querySelectorAll('[data-pv-copy-reg]').forEach((b) => {
      b.addEventListener('click', async () => {
        try {
          S.current = await API.pvRegenerateCopy(Number(b.getAttribute('data-pv-copy-reg')));
          renderDetailTab();
          toast(t('common.save'));
        } catch (e) { toast(e.message, true); }
      });
    });
    body.querySelectorAll('[data-pv-ver]').forEach((b) => {
      b.addEventListener('click', async () => {
        const vId = Number(b.getAttribute('data-pv-ver'));
        const ver = S.current.versions.find((v) => v.id === vId);
        if (!ver) return;
        const html = await API.pvPreview(S.current.id, state.lang).catch(() => '');
        const win = window.open('', '_blank');
        if (win) {
          const doc = win.document;
          doc.open();
          doc.write(`<!DOCTYPE html><html lang="${state.lang}" dir="${state.lang === 'fr' ? 'ltr' : 'rtl'}"><head><meta charset="utf-8"><title>v${ver.version}</title></head><body style="margin:0">${esc(ver.content)}</body></html>`);
          doc.close();
        }
      });
    });
    body.querySelectorAll('[data-pv-edit-meta]').forEach((b) => {
      b.addEventListener('click', () => {
        if (S.current) openEditMetaModal(S.current);
      });
    });
    body.querySelectorAll('[data-goto-proc]').forEach((b) => {
      b.addEventListener('click', (e) => {
        e.preventDefault();
        closeDetail();
        window.HuissierApp.goTo('procedures');
        if (window.ProceduresModule) window.ProceduresModule.openDetail(Number(b.getAttribute('data-goto-proc')));
      });
    });
  }

  /* ================================================================
     تعديل metadata المحضر
     ================================================================ */
  function openEditMetaModal(pv) {
    const { modal, openModal, closeModal } = window.HuissierApp;
    const l = (ar, fr) => (state.lang === 'ar' ? ar : fr);
    modal.title.textContent = l('تعديل بيانات المحضر', 'Modifier les métadonnées du PV');
    const typeOpts = S.types.map((tp) =>
      `<option value="${tp.id}" ${tp.id === pv.pv_type_id ? 'selected' : ''}>${esc(state.lang === 'fr' ? tp.name_fr : tp.name_ar)}</option>`).join('');
    modal.body.innerHTML = `
      <div class="form-grid" style="grid-template-columns:1fr">
        <div class="form-field"><label>${l('العنوان', 'Titre')}</label>
          <input class="form-input" id="pv-meta-title" type="text" value="${esc(pv.title || '')}"></div>
        <div class="form-field"><label>${l('نوع المحضر', 'Type de PV')}</label>
          <select class="form-input" id="pv-meta-type"><option value="">—</option>${typeOpts}</select></div>
        <div class="form-field"><label>${l('اللغة', 'Langue')}</label>
          <select class="form-input" id="pv-meta-lang">
            <option value="ar" ${pv.language === 'ar' ? 'selected' : ''}>${l('العربية', 'Arabe')}</option>
            <option value="fr" ${pv.language === 'fr' ? 'selected' : ''}>${l('الفرنسية', 'Français')}</option>
          </select></div>
        <div class="form-field"><label>${l('ملاحظات', 'Notes')}</label>
          <textarea class="form-input" id="pv-meta-notes" rows="3">${esc(pv.notes || '')}</textarea></div>
      </div>`;
    modal.footer.innerHTML = `
      <button class="btn btn-ghost" data-modal-cancel>${t('common.cancel')}</button>
      <button class="btn btn-primary" data-modal-ok>${t('common.save')}</button>`;
    openModal();
    modal.footer.querySelector('[data-modal-cancel]').addEventListener('click', closeModal);
    modal.footer.querySelector('[data-modal-ok]').addEventListener('click', async () => {
      try {
        const result = await API.pvUpdateMeta(pv.id, {
          title: byId('pv-meta-title').value.trim(),
          pv_type_id: Number(byId('pv-meta-type').value) || null,
          notes: byId('pv-meta-notes').value.trim()
        });
        S.current = result || await API.pvGet(pv.id);
        closeModal();
        toast(t('common.save'));
        byId('pv-detail-title').textContent = S.current.pv_number + ' — ' + (S.current.title || '');
        renderDetailTabs();
        renderDetailTab();
        render();
      } catch (e) { toast(e.message, true); }
    });
  }

  /* ================================================================
     ربط نوع الإجراء بالقالب تلقائياً
     ================================================================ */
  const PV_TYPE_MAP = {
    NOTIFICATION: 'NOTIFICATION',
    EXECUTION_JUGEMENTS: 'EXECUTION',
    EXECUTION_ORDONNANCES: 'EXECUTION',
    FAIRE: 'GENERAL',
    NOTIFICATION_EXECUTION: 'NOTIFICATION',
    NOTIFICATIONS: 'NOTIFICATION',
    CONSTATATIONS: 'CONSTATATION',
    OFFRE_REELLE: 'GENERAL'
  };

  function inferPvType(procedureTypeCode) {
    if (!procedureTypeCode) return null;
    const pvCode = PV_TYPE_MAP[procedureTypeCode] || 'GENERAL';
    return S.types.find((tp) => tp.code === pvCode) || null;
  }

  /* ================================================================
     محرر المحضر (HTML)
     ================================================================ */
  let editor = { pvId: null, vars: null };

  function openEditor(pv) {
    editor.pvId = pv.id;
    byId('pv-editor-title').textContent = pv.pv_number + ' — ' + (state.lang === 'fr' ? 'Éditeur' : 'محرر');
    byId('pv-editor-area').innerHTML = pv.content || '';
    byId('pv-editor-hint').textContent = state.lang === 'fr'
      ? 'Éditez le HTML du PV. Chaque sauvegarde crée une nouvelle version.'
      : 'حرر HTML المحضر. كل حفظ ينشئ نسخة جديدة.';
    buildEditorToolbar();
    loadVarsPalette();
    byId('pv-editor-backdrop').classList.add('show');
  }

  function closeEditor() {
    byId('pv-editor-backdrop').classList.remove('show');
    editor.pvId = null;
  }

  function buildEditorToolbar() {
    const toolbar = byId('pv-editor-toolbar');
    const actions = [
      { icon: 'fa-bold', fn: 'bold' },
      { icon: 'fa-italic', fn: 'italic' },
      { icon: 'fa-underline', fn: 'underline' },
      { icon: 'fa-list-ul', fn: 'insertUnorderedList' },
      { icon: 'fa-list-ol', fn: 'insertOrderedList' },
      { icon: 'fa-table', fn: 'insertTable' },
      { icon: 'fa-eraser', fn: 'removeFormat' }
    ];
    toolbar.innerHTML = actions.map((a) =>
      `<button class="te-btn" data-pv-cmd="${a.fn}"><i class="fas ${a.icon}"></i></button>`).join('');
    toolbar.querySelectorAll('[data-pv-cmd]').forEach((b) => {
      b.addEventListener('click', () => {
        const cmd = b.getAttribute('data-pv-cmd');
        if (cmd === 'insertTable') {
          document.execCommand('insertHTML', false, '<table><tr><td> &nbsp; </td><td> &nbsp; </td></tr><tr><td> &nbsp; </td><td> &nbsp; </td></tr></table>');
        } else {
          document.execCommand(cmd, false, null);
        }
        byId('pv-editor-area').focus();
      });
    });
  }

  async function loadVarsPalette() {
    try {
      if (!editor.vars) editor.vars = await API.tplVariables();
      const box = byId('pv-editor-vars');
      const groups = editor.vars.groups || {};
      const list = Object.entries(editor.vars.variables || {}).map(([key, meta]) => ({ key, group: meta.group || 'misc', labelAr: meta.labelAr || key, labelFr: meta.labelFr || key }));
      const order = ['pv', 'procedure', 'dossier', 'party', 'office', 'payment', 'field', 'misc'];
      box.innerHTML = order.map((g) => {
        const groupVars = list.filter((v) => v.group === g);
        if (!groupVars.length) return '';
        return `<div class="te-var-group"><div class="te-var-group-title">${esc((groups[g] && (state.lang === 'fr' ? groups[g].fr : groups[g].ar)) || g)}</div>
          <div class="te-var-list">${groupVars.map((v) =>
            `<button type="button" class="te-var-chip" data-pv-var="{{${esc(v.key)}}}">${esc(state.lang === 'fr' ? v.labelFr : v.labelAr)}</button>`).join('')}</div></div>`;
      }).join('');
    } catch (e) { byId('pv-editor-vars').innerHTML = ''; }
  }

  async function saveEditor() {
    if (!editor.pvId) return;
    const content = byId('pv-editor-area').innerHTML;
    const note = prompt(state.lang === 'fr' ? 'Note de version (optionnel)' : 'ملاحظة النسخة (اختياري)') || '';
    try {
      S.current = await API.pvSaveContent(editor.pvId, content, note);
      closeEditor();
      if (S.current) {
        byId('pv-detail-title').textContent = S.current.pv_number + ' — ' + (S.current.title || '');
        renderDetailTabs();
        renderDetailTab();
      }
      toast(t('common.save'));
      render();
    } catch (e) {
      toast(e.message, true);
    }
  }

  async function previewEditor() {
    if (!editor.pvId) return;
    try {
      const html = await API.pvPreview(editor.pvId, state.lang);
      const win = window.open('', '_blank');
      if (win) { win.document.write(html); win.document.close(); }
    } catch (e) { toast(e.message, true); }
  }

  /* ---------- الأحداث ---------- */
  function bindEvents() {
    byId('pv-add').addEventListener('click', openCreate);
    byId('pv-search').addEventListener('input', (e) => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        S.search = e.target.value.trim();
        S.page = 1;
        loadList(false);
      }, 300);
    });
    byId('pv-search-clear').addEventListener('click', () => {
      byId('pv-search').value = '';
      S.search = '';
      loadList(false);
    });
    byId('pv-filter-status').addEventListener('change', (e) => {
      S.status = e.target.value;
      byId('pv-filter-chip').hidden = !S.status && !S.typeId;
      loadList(false);
    });
    byId('pv-filter-type').addEventListener('change', (e) => {
      S.typeId = e.target.value;
      byId('pv-filter-chip').hidden = !S.status && !S.typeId;
      loadList(false);
    });
    byId('pv-filter').addEventListener('click', () => {
      byId('pv-filter-chip').hidden = !(S.status || S.typeId);
    });
    byId('pv-filter-chip').addEventListener('click', () => {
      S.status = '';
      S.typeId = '';
      byId('pv-filter-status').value = '';
      byId('pv-filter-type').value = '';
      byId('pv-filter-chip').hidden = true;
      loadList(false);
    });
    byId('pv-more').addEventListener('click', () => loadList(true));

    // إنشاء
    byId('pv-create-close').addEventListener('click', closeCreate);
    byId('pv-create-cancel').addEventListener('click', closeCreate);
    byId('pv-create-backdrop').addEventListener('click', (e) => {
      if (e.target === byId('pv-create-backdrop')) closeCreate();
    });
    byId('pv-create-search').addEventListener('input', (e) => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => searchProcedures(e.target.value.trim()), 300);
    });
    byId('pv-create-ok').addEventListener('click', doCreate);

    // تفاصيل
    byId('pv-detail-close').addEventListener('click', closeDetail);
    byId('pv-detail-backdrop').addEventListener('click', (e) => {
      if (e.target === byId('pv-detail-backdrop')) closeDetail();
    });

    // محرر
    byId('pv-editor-close').addEventListener('click', closeEditor);
    byId('pv-editor-cancel').addEventListener('click', closeEditor);
    byId('pv-editor-backdrop').addEventListener('click', (e) => {
      if (e.target === byId('pv-editor-backdrop')) closeEditor();
    });
    byId('pv-editor-save').addEventListener('click', saveEditor);
    byId('pv-editor-preview').addEventListener('click', previewEditor);
    byId('pv-editor-vars').addEventListener('click', (e) => {
      const chip = e.target.closest('[data-pv-var]');
      if (!chip) return;
      const area = byId('pv-editor-area');
      area.focus();
      document.execCommand('insertHTML', false, chip.getAttribute('data-pv-var'));
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (byId('pv-editor-backdrop').classList.contains('show')) closeEditor();
        else if (byId('pv-detail-backdrop').classList.contains('show')) closeDetail();
      }
    });
  }

  window.PvsModule = { init, render, reload: () => render(), openDetail };
})();
