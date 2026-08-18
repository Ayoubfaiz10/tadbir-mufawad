/* ================================================================
   مكتبة النماذج — TemplatesModule (وحدة النماذج)
   قائمة | بحث | تصفية | محرر | معاينة | توليد PDF | إصدارات
   ================================================================ */

'use strict';

(function () {
  const {
    API, state, t, toast, escapeHtml: esc, fmtDate, badge,
    modal, openModal, closeModal, field, goTo
  } = window.HuissierApp;

  const byId = (id) => document.getElementById(id);

  const state2 = {
    page: 1,
    pageSize: 12,
    search: '',
    category: '',
    procedureTypeId: '',
    language: '',
    status: 'active',
    includeArchived: false,
    loaded: 0,
    total: 0,
    rows: [],
    canManage: false,
    categories: [],
    types: [],
    variables: null,
    editorId: null,
    preview: { versionId: null, procedureId: 0, notes: '', html: null, lang: 'ar' }
  };

  let debounceTimer = null;
  let bound = false;

  /* ---------- تهيئة ---------- */
  async function init() {
    try {
      state2.canManage = await API.authIsAuthorized('template.manage');
    } catch (e) { state2.canManage = false; }
    try {
      state2.categories = await API.tplCategories();
    } catch (e) { state2.categories = []; }
    try {
      state2.types = await API.configTypes();
    } catch (e) { state2.types = []; }
    try {
      state2.variables = await API.tplVariables();
      buildVarsPalette();
    } catch (e) { state2.variables = null; }
    buildToolbar();
    if (!bound) {
      bindEvents();
      bound = true;
    }
  }

  /* ---------- التنقل (ثنائي اللغة) ---------- */
  function typeName(id) {
    const x = state2.types.find((tp) => tp.id === id);
    if (!x) return '';
    return state.lang === 'fr' ? (x.name_fr || x.name_ar) : (x.name_ar || x.name_fr);
  }

  function catName(id) {
    const x = state2.categories.find((c) => c.id === id);
    if (!x) return '';
    return state.lang === 'fr' ? (x.name_fr || x.name_ar) : (x.name_ar || x.name_fr);
  }

  function langLabel(l) {
    return l === 'fr' ? 'FR' : 'AR';
  }

  function stBadge(s) {
    const map = {
      active: '<span class="badge success">' + (state.lang === 'fr' ? 'Actif' : 'نشط') + '</span>',
      inactive: '<span class="badge">' + (state.lang === 'fr' ? 'Inactif' : 'غير نشط') + '</span>',
      archived: '<span class="badge error">' + (state.lang === 'fr' ? 'Archivé' : 'مؤرشف') + '</span>'
    };
    return map[s] || '<span class="badge">' + esc(s) + '</span>';
  }

  /* ---------- العرض الرئيسي ---------- */
  async function render() {
    byId('tpl-thead').innerHTML = `<tr>
      <th>${state.lang === 'fr' ? 'Modèle' : 'النموذج'}</th>
      <th>${state.lang === 'fr' ? 'Catégorie' : 'التصنيف'}</th>
      <th>${state.lang === 'fr' ? 'Type' : 'النوع'}</th>
      <th>${state.lang === 'fr' ? 'Version' : 'النسخة'}</th>
      <th>${state.lang === 'fr' ? 'Lang' : 'اللغة'}</th>
      <th>${state.lang === 'fr' ? 'Statut' : 'الحالة'}</th>
      <th>${state.lang === 'fr' ? 'Actions' : 'إجراءات'}</th>
    </tr>`;
    byId('tpl-filter-chip').hidden = !(state2.category || state2.procedureTypeId || state2.language || state2.status !== 'active' || state2.includeArchived);
    byId('tpl-archive-toggle').classList.toggle('active', state2.includeArchived);
    await loadList(false);
    await loadStats();
  }

  async function loadStats() {
    try {
      const s = await API.tplStats();
      byId('tplstat-total').textContent = s.total;
      byId('tplstat-active').textContent = s.active;
      byId('tplstat-inactive').textContent = s.inactive;
      byId('tplstat-archived').textContent = s.archived;
    } catch (e) { }
  }

  async function loadList(append) {
    const page = append ? state2.page + 1 : 1;
    try {
      const filters = {
        search: state2.search || undefined,
        category: state2.category || undefined,
        procedureTypeId: state2.procedureTypeId || undefined,
        language: state2.language || undefined,
        status: state2.status || undefined,
        includeArchived: state2.includeArchived,
        page,
        pageSize: state2.pageSize
      };
      const res = await API.tplList(filters);
      state2.page = page;
      state2.total = res.total;
      state2.loaded = append ? state2.loaded + res.rows.length : res.rows.length;
      state2.rows = append ? state2.rows.concat(res.rows) : res.rows;
      const tbody = byId('tpl-tbody');
      if (!append) tbody.innerHTML = '';
      const rowsHtml = res.rows.map(rowHtml).join('');
      tbody.insertAdjacentHTML('beforeend', rowsHtml);
      byId('tpl-empty').classList.toggle('hidden', state2.loaded > 0);
      byId('tpl-footer').hidden = state2.total <= 0;
      byId('tpl-more').hidden = state2.loaded >= state2.total;
      const showing = state.lang === 'fr'
        ? `Affichage de ${state2.loaded} sur ${state2.total}`
        : `${state2.loaded} من أصل ${state2.total}`;
      byId('tpl-count').textContent = showing;
    } catch (e) {
      toast(t('procedures.errors.load'), true);
    }
  }

  function rowHtml(x) {
    const actions = [
      `<button class="row-btn" data-tpl-action="pdf" data-tpl-id="${x.id}" data-tpl-ver="${x.current_version_id || ''}" title="${state.lang === 'fr' ? 'Générer PDF' : 'توليد PDF'}"><i class="fas fa-file-pdf"></i></button>`,
      `<button class="row-btn" data-tpl-action="view" data-tpl-id="${x.id}" title="${state.lang === 'fr' ? 'Détails' : 'التفاصيل'}"><i class="fas fa-eye"></i></button>`
    ];
    if (state2.canManage && !x.archived) {
      actions.push(
        `<button class="row-btn" data-tpl-action="edit" data-tpl-id="${x.id}" title="${state.lang === 'fr' ? 'Modifier' : 'تعديل'}"><i class="fas fa-pen"></i></button>`,
        `<button class="row-btn" data-tpl-action="dup" data-tpl-id="${x.id}" title="${state.lang === 'fr' ? 'Dupliquer' : 'نسخ'}"><i class="fas fa-copy"></i></button>`,
        `<button class="row-btn" data-tpl-action="active" data-tpl-id="${x.id}" title="${x.active ? (state.lang === 'fr' ? 'Désactiver' : 'تعطيل') : (state.lang === 'fr' ? 'Activer' : 'تفعيل')}"><i class="fas fa-toggle-${x.active ? 'off' : 'on'}"></i></button>`,
        `<button class="row-btn del" data-tpl-action="archive" data-tpl-id="${x.id}" title="${state.lang === 'fr' ? 'Archiver' : 'أرشفة'}"><i class="fas fa-box-archive"></i></button>`
      );
    }
    return `<tr>
      <td><strong>${esc(x.name)}</strong>${x.description ? `<div class="muted small">${esc(x.description)}</div>` : ''}</td>
      <td>${esc(catName(x.category_id))}</td>
      <td>${esc(typeName(x.procedure_type_id)) || '<span class="muted">—</span>'}</td>
      <td><span class="badge">v${esc(x.current_version)}</span></td>
      <td><span class="lang-chip">${langLabel(x.language)}</span></td>
      <td>${stBadge(x.archived ? 'archived' : (x.active ? 'active' : 'inactive'))}</td>
      <td><div class="row-actions">${actions.join('')}</div></td>
    </tr>`;
  }

  /* ---------- تصفية ---------- */
  function openFilters() {
    modal.title.textContent = t('procedures.filters.title');
    const opts = [{ v: '', l: state.lang === 'fr' ? 'Toutes' : 'الكل' }]
      .concat(state2.categories.map((c) => ({ v: c.id, l: (state.lang === 'fr' ? c.name_fr : c.name_ar) || c.code })));
    const typeOpts = [{ v: '', l: state.lang === 'fr' ? 'Tous' : 'الكل' }]
      .concat(state2.types.map((x) => ({ v: x.id, l: typeName(x.id) })));
    const langOpts = [
      { v: '', l: state.lang === 'fr' ? 'Toutes' : 'الكل' },
      { v: 'ar', l: state.lang === 'fr' ? 'Arabe' : 'العربية' },
      { v: 'fr', l: state.lang === 'fr' ? 'Français' : 'الفرنسية' }
    ];
    modal.body.innerHTML = `
      <div class="form-grid">
        <div class="form-field">${state.lang === 'fr' ? 'Catégorie' : 'التصنيف'}
          <select class="form-input" id="f-tpl-cat">${fieldSelect(opts, state2.category)}</select>
        </div>
        <div class="form-field">${state.lang === 'fr' ? 'Type d\'acte' : 'نوع الإجراء'}
          <select class="form-input" id="f-tpl-type">${fieldSelect(typeOpts, state2.procedureTypeId)}</select>
        </div>
        <div class="form-field">${state.lang === 'fr' ? 'Langue' : 'اللغة'}
          <select class="form-input" id="f-tpl-lang">${fieldSelect(langOpts, state2.language)}</select>
        </div>
        <div class="form-field">${state.lang === 'fr' ? 'Statut' : 'الحالة'}
          <select class="form-input" id="f-tpl-status">${fieldSelect([
            { v: 'active', l: state.lang === 'fr' ? 'Actifs' : 'النشطة' },
            { v: 'inactive', l: state.lang === 'fr' ? 'Inactifs' : 'غير النشطة' },
            { v: 'all', l: state.lang === 'fr' ? 'Tous' : 'الكل' }
          ], state2.status)}</select>
        </div>
        <label class="check-inline"><input type="checkbox" id="f-tpl-arch" ${state2.includeArchived ? 'checked' : ''}> ${state.lang === 'fr' ? 'Inclure les archivés' : 'شمل المؤرشفة'}</label>
      </div>
      <div class="modal-actions">
        <button class="btn btn-ghost" data-fclear>${t('procedures.clearFilters')}</button>
        <button class="btn btn-primary" data-fapply>${t('procedures.filters.apply')}</button>
      </div>`;
    openModal();
    modal.footer.innerHTML = '';
    modal.body.querySelector('[data-fapply]').onclick = () => {
      state2.category = byId('f-tpl-cat').value;
      state2.procedureTypeId = byId('f-tpl-type').value;
      state2.language = byId('f-tpl-lang').value;
      state2.status = byId('f-tpl-status').value;
      state2.includeArchived = byId('f-tpl-arch').checked;
      closeModal();
      render();
    };
    modal.body.querySelector('[data-fclear]').onclick = () => {
      state2.category = ''; state2.procedureTypeId = '';
      state2.language = ''; state2.status = 'active'; state2.includeArchived = false;
      closeModal();
      render();
    };
  }

  function fieldSelect(ops, current) {
    return ops.map((o) => `<option value="${esc(String(o.v))}" ${String(o.v) === String(current) ? 'selected' : ''}>${esc(String(o.l))}</option>`).join('');
  }

  /* ---------- محرر النموذج ---------- */
  async function openEditor(tpl) {
    state2.editorId = tpl ? tpl.id : null;
    byId('tpl-editor-title').textContent = tpl
      ? (state.lang === 'fr' ? `Modifier — ${tpl.name}` : `تعديل — ${tpl.name}`)
      : (state.lang === 'fr' ? 'Nouveau modèle' : 'نموذج جديد');
    byId('te-name').value = tpl ? tpl.name : '';
    byId('te-desc').value = tpl ? (tpl.description || '') : '';
    byId('te-lang').value = tpl ? tpl.language : (state.lang === 'fr' ? 'fr' : 'ar');
    byId('te-active').checked = tpl ? !!tpl.active : true;
    byId('te-major').checked = false;

    const catOpts = [{ v: '', l: state.lang === 'fr' ? '— Choisir —' : '— اختر —' }]
      .concat(state2.categories.map((c) => ({ v: c.id, l: (state.lang === 'fr' ? c.name_fr : c.name_ar) || c.code })));
    byId('te-cat-wrap').innerHTML = `<div class="form-field">${state.lang === 'fr' ? 'Catégorie' : 'التصنيف'}<select class="form-input" id="te-cat">${fieldSelect(catOpts, tpl ? tpl.category_id : '')}</select></div>`;

    const typeOpts = [{ v: '', l: state.lang === 'fr' ? '— Aucun (générique) —' : '— لا شيء (عام) —' }]
      .concat(state2.types.map((x) => ({ v: x.id, l: typeName(x.id) })));
    byId('te-type-wrap').innerHTML = `<div class="form-field">${state.lang === 'fr' ? 'Type d\'acte' : 'نوع الإجراء'}<select class="form-input" id="te-type">${fieldSelect(typeOpts, tpl ? tpl.procedure_type_id : '')}</select></div>`;

    if (tpl) {
      const ver = tpl.current_version;
      byId('te-version').value = ver;
      byId('te-version-hint').textContent = state.lang === 'fr'
        ? `Version courante v${ver} — toute modification crée une nouvelle version`
        : `النسخة الحالية v${ver} — أي تعديل يُحدث نسخة جديدة`;
      try {
        const detail = await API.tplGet(tpl.id);
        byId('te-area').innerHTML = detail.versions[0].content;
      } catch (e) { byId('te-area').innerHTML = ''; }
    } else {
      byId('te-version').value = '1.0';
      byId('te-version-hint').textContent = state.lang === 'fr'
        ? 'Nouveau modèle — première version v1.0'
        : 'نموذج جديد — النسخة الأولى v1.0';
      byId('te-area').innerHTML = '<p></p>';
    }
    byId('tpl-editor-backdrop').classList.add('show');
    byId('te-major').classList.toggle('hidden', !tpl);
    renderVarsPalette();
    byId('te-name').focus();
  }

  function closeEditor() {
    byId('tpl-editor-backdrop').classList.remove('show');
    state2.editorId = null;
  }

  async function saveEditor() {
    const name = byId('te-name').value.trim();
    const categoryId = Number(byId('te-cat').value);
    const procedureTypeId = Number(byId('te-type').value) || null;
    const language = byId('te-lang').value;
    const description = byId('te-desc').value.trim();
    const active = byId('te-active').checked;
    const major = byId('te-major').checked;
    const version = major ? '' : byId('te-version').value.trim();
    const content = byId('te-area').innerHTML;
    const note = major ? (state.lang === 'fr' ? 'Version majeure' : 'نسخة رئيسية') : '';

    if (!name) { toast(state.lang === 'fr' ? 'Nom requis' : 'الاسم مطلوب', true); return; }
    if (!categoryId) { toast(state.lang === 'fr' ? 'Catégorie requise' : 'التصنيف مطلوب', true); return; }
    if (!content || content === '<p></p>' || content === '<p><br></p>') {
      toast(state.lang === 'fr' ? 'Contenu requis' : 'المحتوى مطلوب', true); return;
    }
    try {
      const payload = { name, categoryId, procedureTypeId, language, description, active, major, version, content, note };
      if (state2.editorId) {
        await API.tplUpdate(state2.editorId, payload);
        toast(state.lang === 'fr' ? 'Modèle enregistré (nouvelle version créée)' : 'تم حفظ النموذج (أنشئت نسخة جديدة)');
      } else {
        await API.tplAdd(payload);
        toast(state.lang === 'fr' ? 'Modèle créé' : 'تم إنشاء النموذج');
      }
      closeEditor();
      render();
    } catch (e) {
      toast(e.message || e, true);
    }
  }

  /* ---------- شريط أدوات المحرر ---------- */
  const TOOLBAR = [
    ['bold', 'fa-bold'],
    ['italic', 'fa-italic'],
    ['underline', 'fa-underline'],
    ['h2', 'fa-heading'],
    ['h3', 'fa-text-height'],
    ['h4', 'fa-i-cursor'],
    ['p', 'fa-paragraph'],
    ['justifyRight', 'fa-align-right'],
    ['justifyCenter', 'fa-align-center'],
    ['justifyLeft', 'fa-align-left'],
    ['insertUnorderedList', 'fa-list-ul'],
    ['insertOrderedList', 'fa-list-ol'],
    ['table', 'fa-table'],
    ['date', 'fa-calendar-days'],
    ['hr', 'fa-minus']
  ];

  const TOOLBAR_LABELS = {
    bold: ['عريض', 'Gras'], italic: ['مائل', 'Italique'], underline: ['تسطير', 'Souligné'],
    h2: ['عنوان', 'Titre'], h3: ['عنوان فرعي', 'Sous-titre'], h4: ['عنوان صغير', 'Petit titre'],
    p: ['فقرة', 'Paragraphe'], justifyRight: ['يمين', 'Droite'], justifyCenter: ['وسط', 'Centre'],
    justifyLeft: ['يسار', 'Gauche'], insertUnorderedList: ['قائمة', 'Liste'], insertOrderedList: ['قائمة مرقمة', 'Liste numérotée'],
    table: ['جدول', 'Tableau'], date: ['تاريخ', 'Date'], hr: ['خط فاصل', 'Séparateur']
  };

  function buildToolbar() {
    byId('te-toolbar').innerHTML = TOOLBAR.map(([cmd, icon]) =>
      `<button class="te-btn" data-cmd="${cmd}" title="${TOOLBAR_LABELS[cmd][state.lang === 'fr' ? 1 : 0]}"><i class="fas ${icon}"></i></button>`
    ).join('');
  }

  function onClickToolbar(e) {
    const btn = e.target.closest('[data-cmd]');
    if (!btn) return;
    const cmd = btn.getAttribute('data-cmd');
    byId('te-area').focus();
    if (cmd === 'h2' || cmd === 'h3' || cmd === 'h4' || cmd === 'p') {
      document.execCommand('formatBlock', false, cmd.toUpperCase());
    } else if (cmd === 'table') {
      document.execCommand('insertHTML', false,
        '<table border="1" cellpadding="4" style="border-collapse:collapse"><tbody><tr><td>' + (state.lang === 'fr' ? 'Cellule' : 'خانة') + '</td><td>' + (state.lang === 'fr' ? 'Cellule' : 'خانة') + '</td></tr><tr><td>' + (state.lang === 'fr' ? 'Cellule' : 'خانة') + '</td><td>' + (state.lang === 'fr' ? 'Cellule' : 'خانة') + '</td></tr><tr><td>' + (state.lang === 'fr' ? 'Cellule' : 'خانة') + '</td><td>' + (state.lang === 'fr' ? 'Cellule' : 'خانة') + '</td></tr></tbody></table><p></p>');
    } else if (cmd === 'date') {
      document.execCommand('insertHTML', false, `<span>${new Date().toLocaleDateString(state.lang === 'fr' ? 'fr-MA' : 'ar-MA')}</span>`);
    } else if (cmd === 'hr') {
      document.execCommand('insertHTML', false, '<hr>');
    } else {
      document.execCommand(cmd, false, null);
    }
  }

  /* ---------- لوحة المتغيرات ---------- */
  function buildVarsPalette() {
    const body = byId('te-vars');
    if (!body || !state2.variables) return;
    body.innerHTML = '';
    for (const [gkey, gmeta] of Object.entries(state2.variables.groups)) {
      const section = document.createElement('div');
      section.className = 'te-var-group';
      const title = document.createElement('div');
      title.className = 'te-var-group-title';
      title.textContent = state.lang === 'fr' ? gmeta.fr : gmeta.ar;
      section.appendChild(title);
      const varList = document.createElement('div');
      varList.className = 'te-var-list';
      for (const [name, meta] of Object.entries(state2.variables.variables)) {
        if (meta.group !== gkey) continue;
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'te-var-chip';
        chip.setAttribute('data-var', name);
        chip.textContent = '{{' + name + '}}';
        chip.title = state.lang === 'fr' ? meta.fr : meta.ar;
        varList.appendChild(chip);
      }
      section.appendChild(varList);
      body.appendChild(section);
    }
  }

  function renderVarsPalette() {
    buildVarsPalette();
  }

  function insertVar(name) {
    byId('te-area').focus();
    try {
      document.execCommand('insertHTML', false,
        `<span class="tpl-token" contenteditable="false" data-var="${name}">{{${name}}}</span>&nbsp;`);
    } catch (e) {
      const area = byId('te-area');
      area.innerHTML += `<span class="tpl-token" data-var="${name}">{{${name}}}</span> `;
    }
  }

  function onClickVars(e) {
    const chip = e.target.closest('[data-var]');
    if (!chip) return;
    insertVar(chip.getAttribute('data-var'));
  }

  /* ---------- المعاينة ---------- */
  function previewPick(mode) {
    byId('tpl-preview-title').textContent = state.lang === 'fr' ? 'Aperçu du modèle' : 'معاينة النموذج';
    const resBox = byId('tpl-preview-results');
    resBox.innerHTML = '';
    resBox.classList.add('hidden');
    byId('tpl-preview-search').value = '';
    byId('tpl-preview-search').placeholder = state.lang === 'fr'
      ? 'Choisir un acte pour les vraies valeurs (optionnel)'
      : 'اختر إجراءً لمعاينة القيم الحقيقية (اختياري)';
    const genBtn = byId('tpl-preview-gen');
    genBtn.querySelector('span')?.remove();
    if (mode === 'draft') {
      state2.preview.versionId = null;
      genBtn.disabled = true;
      genBtn.title = state.lang === 'fr' ? 'Enregistrer d\'abord pour générer' : 'احفظ النموذج أولاً للتوليد';
    } else {
      genBtn.disabled = false;
      genBtn.title = '';
    }
    byId('tpl-preview-backdrop').classList.add('show');
  }

  async function renderPreview() {
    const p = state2.preview;
    try {
      const html = p.versionId
        ? await API.tplRenderPreview(p.versionId, p.procedureId, p.lang, '')
        : await API.tplRenderDraft(p.html || '<p></p>', p.lang);
      byId('tpl-preview-frame').srcdoc = html;
    } catch (e) {
      toast(e.message || e, true);
    }
  }

  function closePreview() {
    byId('tpl-preview-backdrop').classList.remove('show');
    state2.preview = { versionId: null, procedureId: 0, notes: '', html: null, lang: 'ar' };
  }

  async function previewSearch(q) {
    const box = byId('tpl-preview-results');
    if (!q) {
      box.innerHTML = '';
      box.classList.add('hidden');
      return;
    }
    box.classList.remove('hidden');
    box.innerHTML = `<p class="hint">${state.lang === 'fr' ? 'Recherche…' : 'جارٍ البحث…'}</p>`;
    try {
      const res = await API.procList({ search: q, page: 1, pageSize: 8 });
      box.innerHTML = res.rows.length
        ? res.rows.map((r) => `<button type="button" class="dos-result" data-pid="${r.id}">
            <strong>${esc(r.procedure_number)}</strong>
            <span class="muted small">${esc(r.dossier ? r.dossier.numero : '')} — ${esc(r.type ? (state.lang === 'fr' ? (r.type.name_fr || r.type.name_ar) : (r.type.name_ar || r.type.name_fr)) : '')}</span>
          </button>`).join('')
        : `<p class="hint">${state.lang === 'fr' ? 'Aucun acte trouvé' : 'لا توجد نتائج'}</p>`;
      box.querySelectorAll('[data-pid]').forEach((b) => {
        b.onclick = () => {
          state2.preview.procedureId = Number(b.getAttribute('data-pid'));
          box.innerHTML = '';
          box.classList.add('hidden');
          byId('tpl-preview-search').value = b.querySelector('strong').textContent;
          renderPreview();
        };
      });
    } catch (e) {
      box.classList.add('hidden');
    }
  }

  async function generatePdf() {
    const p = state2.preview;
    if (!p.versionId) { toast(state.lang === 'fr' ? 'Enregistrez d\'abord le modèle' : 'احفظ النموذج أولاً', true); return; }
    try {
      const res = await API.docGenerateTemplate(p.versionId, p.procedureId, p.lang, '');
      if (res && res.path) {
        toast((state.lang === 'fr' ? 'PDF généré : ' : 'تم توليد PDF: ') + res.fileName);
      } else {
        toast(state.lang === 'fr' ? 'PDF généré' : 'تم توليد PDF');
      }
    } catch (e) {
      toast(e.message || e, true);
    }
  }

  /* ---------- تفاصيل النموذج + الإصدارات ---------- */
  async function openView(id) {
    try {
      const d = await API.tplGet(id);
      byId('tpl-view-title').textContent = d.name;
      const meta = `
        <div class="det-grid">
          <div class="det-item"><span>${state.lang === 'fr' ? 'Catégorie' : 'التصنيف'}</span><strong>${esc(catName(d.category_id))}</strong></div>
          <div class="det-item"><span>${state.lang === 'fr' ? 'Type' : 'النوع'}</span><strong>${esc(typeName(d.procedure_type_id)) || '—'}</strong></div>
          <div class="det-item"><span>${state.lang === 'fr' ? 'Langue' : 'اللغة'}</span><strong>${langLabel(d.language)}</strong></div>
          <div class="det-item"><span>${state.lang === 'fr' ? 'Version' : 'النسخة'}</span><strong>${d.current ? 'v' + esc(d.current.version) : '—'}</strong></div>
          <div class="det-item"><span>${state.lang === 'fr' ? 'Statut' : 'الحالة'}</span><strong>${stBadge(d.archived ? 'archived' : (d.active ? 'active' : 'inactive'))}</strong></div>
          <div class="det-item"><span>${state.lang === 'fr' ? 'Créé' : 'تاريخ الإنشاء'}</span><strong>${fmtDate(d.created_at)}</strong></div>
          ${d.description ? `<div class="det-item full"><span>${state.lang === 'fr' ? 'Description' : 'الوصف'}</span><strong class="wht">${esc(d.description)}</strong></div>` : ''}
        </div>
        <h5 class="det-sec-title"><i class="fas fa-code-branch"></i> ${state.lang === 'fr' ? 'Versions' : 'الإصدارات'} (${d.versions.length})</h5>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>v</th><th>${state.lang === 'fr' ? 'Créée' : 'تاريخ الإنشاء'}</th><th>${state.lang === 'fr' ? 'Par' : 'بواسطة'}</th><th>${state.lang === 'fr' ? 'Note' : 'ملاحظة'}</th><th>${state.lang === 'fr' ? 'Actions' : 'إجراءات'}</th></tr></thead>
            <tbody>
              ${d.versions.map((v) => `<tr>
                <td><span class="badge">v${esc(v.version)}</span>${v.id === d.current_version_id ? ' <i class="fas fa-circle-check" style="color:var(--success)"></i>' : ''}</td>
                <td>${fmtDate(v.created_at)}</td>
                <td>${esc(v.created_by_name || v.created_by || '')}</td>
                <td class="muted">${esc(v.note || '—')}</td>
                <td><div class="row-actions">
                  <button class="row-btn" data-ver-preview="${v.id}" title="${state.lang === 'fr' ? 'Aperçu' : 'معاينة'}"><i class="fas fa-eye"></i></button>
                  <button class="row-btn" data-ver-pdf="${v.id}" title="${state.lang === 'fr' ? 'Générer PDF' : 'توليد PDF'}"><i class="fas fa-file-pdf"></i></button>
                </div></td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>`;
      byId('tpl-view-body').innerHTML = meta;
      const footer = byId('tpl-view-footer');
      footer.innerHTML = state2.canManage && !d.archived
        ? `<button class="btn btn-ghost" data-vact="edit"><i class="fas fa-pen"></i> ${state.lang === 'fr' ? 'Modifier' : 'تعديل'}</button>
           <button class="btn btn-ghost" data-vact="dup"><i class="fas fa-copy"></i> ${state.lang === 'fr' ? 'Dupliquer' : 'نسخ'}</button>
           <button class="btn btn-ghost" data-vact="active"><i class="fas fa-toggle-${d.active ? 'off' : 'on'}"></i> ${d.active ? (state.lang === 'fr' ? 'Désactiver' : 'تعطيل') : (state.lang === 'fr' ? 'Activer' : 'تفعيل')}</button>
           <button class="btn btn-danger" data-vact="archive"><i class="fas fa-box-archive"></i> ${state.lang === 'fr' ? 'Archiver' : 'أرشفة'}</button>`
        : `<button class="btn btn-primary" data-vact="pdf"><i class="fas fa-file-pdf"></i> ${state.lang === 'fr' ? 'Générer PDF' : 'توليد PDF'}</button>`;
      footer.querySelectorAll('[data-vact]').forEach((b) => {
        b.onclick = () => {
          const act = b.getAttribute('data-vact');
          if (act === 'edit') { closeView(); openEditor(d); }
          else if (act === 'dup') { duplicateTemplate(d.id); }
          else if (act === 'active') { toggleActive(d.id, !d.active); }
          else if (act === 'archive') { archiveTemplate(d.id); }
          else if (act === 'pdf') { openPdfFromVersion(d.current_version_id); }
        };
      });
      byId('tpl-view-body').querySelectorAll('[data-ver-preview]').forEach((b) => {
        b.onclick = () => { state2.preview = { versionId: Number(b.getAttribute('data-ver-preview')), procedureId: 0, lang: d.language, html: null }; previewPick('saved'); renderPreview(); };
      });
      byId('tpl-view-body').querySelectorAll('[data-ver-pdf]').forEach((b) => {
        b.onclick = () => { openPdfFromVersion(Number(b.getAttribute('data-ver-pdf'))); };
      });
      byId('tpl-view-backdrop').classList.add('show');
    } catch (e) {
      toast(e.message || e, true);
    }
  }

  function openPdfFromVersion(versionId) {
    closeView();
    state2.preview = { versionId, procedureId: 0, lang: state.lang === 'fr' ? 'fr' : 'ar', html: null };
    previewPick('saved');
    renderPreview();
  }

  async function openPdfFromTemplate(templateId) {
    const row = state2.rows.find((r) => r.id === templateId);
    const ver = row && row.current_version_id ? row.current_version_id : 0;
    if (ver) {
      openPdfFromVersion(ver);
      return;
    }
    try {
      const d = await API.tplGet(templateId);
      if (d && d.current_version_id) {
        openPdfFromVersion(d.current_version_id);
      } else {
        toast(state.lang === 'fr' ? "Ce modèle n'a pas encore de version" : 'لا توجد نسخة لهذا النموذج بعد', true);
      }
    } catch (e) {
      toast(e.message || e, true);
    }
  }

  function closeView() {
    byId('tpl-view-backdrop').classList.remove('show');
  }

  /* ---------- إجراءات ---------- */
  async function duplicateTemplate(id) {
    try {
      const res = await API.tplDuplicate(id, {});
      toast(state.lang === 'fr' ? `Modèle dupliqué : ${res.name}` : `تم نسخ النموذج: ${res.name}`);
      render();
    } catch (e) { toast(e.message || e, true); }
  }

  async function toggleActive(id, active) {
    try {
      await API.tplSetActive(id, active);
      toast(active ? (state.lang === 'fr' ? 'Modèle activé' : 'تم تفعيل النموذج') : (state.lang === 'fr' ? 'Modèle désactivé' : 'تم تعطيل النموذج'));
      render();
    } catch (e) { toast(e.message || e, true); }
  }

  async function archiveTemplate(id) {
    const msg = state.lang === 'fr' ? 'Archiver ce modèle ?' : 'أرشفة هذا النموذج؟';
    if (!confirm(msg)) return;
    try {
      await API.tplSetArchived(id, true);
      toast(state.lang === 'fr' ? 'Modèle archivé' : 'تمت أرشفة النموذج');
      render();
    } catch (e) { toast(e.message || e, true); }
  }

  /* ---------- الأحداث ---------- */
  function bindEvents() {
    byId('tpl-tbody').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-tpl-action]');
      if (!btn) return;
      const id = Number(btn.getAttribute('data-tpl-id'));
      const act = btn.getAttribute('data-tpl-action');
      const row = state2.rows.find((r) => r.id === id);
      if (act === 'view') openView(id);
      else if (act === 'edit') openEditor(row);
      else if (act === 'pdf') openPdfFromTemplate(id);
      else if (state2.canManage && row) {
        if (act === 'dup') duplicateTemplate(id);
        else if (act === 'active') toggleActive(id, !row.active);
        else if (act === 'archive') archiveTemplate(id);
      }
    });

    byId('tpl-search').addEventListener('input', (e) => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => { state2.search = e.target.value.trim(); render(); }, 350);
    });

    byId('tpl-add').addEventListener('click', () => openEditor(null));
    byId('tpl-filter').addEventListener('click', openFilters);
    byId('tpl-archive-toggle').addEventListener('click', () => {
      state2.includeArchived = !state2.includeArchived;
      render();
    });
    byId('tpl-more').addEventListener('click', () => loadList(true));
    byId('tpl-filter-chip').addEventListener('click', () => {
      state2.category = ''; state2.procedureTypeId = ''; state2.language = '';
      state2.status = 'active'; state2.includeArchived = false;
      render();
    });

    /* editor */
    byId('tpl-editor-close').addEventListener('click', closeEditor);
    byId('te-cancel').addEventListener('click', closeEditor);
    byId('te-save').addEventListener('click', saveEditor);
    byId('te-preview').addEventListener('click', () => {
      const html = byId('te-area').innerHTML;
      const lang = byId('te-lang').value;
      state2.preview = { versionId: null, procedureId: 0, lang, html, notes: '' };
      previewPick('draft');
      renderPreview();
      closeEditor();
    });
    byId('te-toolbar').addEventListener('click', onClickToolbar);
    byId('te-vars').addEventListener('click', onClickVars);

    /* preview */
    byId('tpl-preview-close').addEventListener('click', closePreview);
    byId('tpl-preview-search').addEventListener('input', (e) => previewSearch(e.target.value.trim()));
    byId('tpl-preview-gen').addEventListener('click', generatePdf);

    /* view */
    byId('tpl-view-close').addEventListener('click', closeView);

    if (state2.canManage) {
      byId('tpl-add').hidden = false;
    } else {
      byId('tpl-add').hidden = true;
    }
  }

  window.TemplatesModule = { init, render, reload: () => render() };
})();