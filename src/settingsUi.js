'use strict';

/* ================================================================
   settingsUi.js — لوحة الإعدادات المتكاملة (7 تبويبات)
   ================================================================ */
(function () {
  const byId = (id) => document.getElementById(id);
  const { toast, t, state } = window.HuissierApp;
  const API = window.appAPI;
  const esc = (s) => { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; };
  const l = (ar, fr) => (state.lang === 'ar' ? ar : fr);
  const { modal, openModal, closeModal } = window.HuissierApp;

  let currentTab = 'general';

  /* ---------- Tab Switching ---------- */
  function switchTab(tab) {
    currentTab = tab;
    document.querySelectorAll('#settings-tabs .dtab').forEach((b) => b.classList.toggle('active', b.getAttribute('data-settings-tab') === tab));
    document.querySelectorAll('.settings-tab-content').forEach((c) => c.classList.toggle('active', c.id === 'settings-tab-' + tab));
    loadTab(tab);
  }

  async function loadTab(tab) {
    switch (tab) {
      case 'types': await loadPTypes(); break;
      case 'statuses': await Promise.all([loadStatuses(), loadTransitions()]); break;
      case 'pv': await Promise.all([loadPvTypes(), loadPvStatuses()]); break;
      case 'finance': await Promise.all([loadPayMethods(), loadTariffs()]); break;
      case 'backup': await loadBackupList(); break;
    }
  }

  /* ================================================================
     Types Tab — أنواع الإجراءات
     ================================================================ */
  let pTypes = [], pCategories = [];

  async function loadPTypes() {
    try {
      pTypes = await API.configTypesFull();
      pCategories = await API.configCategories();
    } catch (e) { pTypes = []; pCategories = []; }
    const tbody = byId('ptypes-tbody');
    if (!tbody) return;
    tbody.innerHTML = pTypes.map((tp) => {
      const cat = tp.category_name_ar || tp.category_name_fr || '';
      const name = state.lang === 'fr' ? tp.name_fr : tp.name_ar;
      return `<tr>
        <td><code>${esc(tp.code)}</code></td>
        <td>${esc(name)}</td>
        <td><span class="badge">${esc(cat)}</span></td>
        <td>${(tp.fields || []).length}</td>
        <td>${tp.active ? '<span class="badge success">' + l('نشط', 'Actif') + '</span>' : '<span class="badge">' + l('معطّل', 'Inactif') + '</span>'}</td>
        <td>
          <button class="btn btn-sm btn-ghost" data-ptype-edit="${tp.id}"><i class="fas fa-pen"></i></button>
        </td>
      </tr>`;
    }).join('');
  }

  function openPTypeModal(existing) {
    const isEdit = !!existing;
    modal.title.textContent = isEdit ? l('تعديل نوع الإجراء', 'Modifier le type') : l('نوع إجراء جديد', 'Nouveau type de procédure');
    const catOpts = pCategories.map((c) => `<option value="${c.id}" ${existing && existing.category_id === c.id ? 'selected' : ''}>${esc(state.lang === 'fr' ? c.name_fr : c.name_ar)}</option>`).join('');
    const fields = existing ? (existing.fields || []) : [];
    const fieldsHtml = fields.map((f, i) => pTypeFieldRow(i, f)).join('');
    modal.body.innerHTML = `
      <div class="form-grid" style="grid-template-columns:1fr">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div class="form-field"><label>${l('الكود', 'Code')}</label><input class="form-input" id="pt-code" value="${esc(existing ? existing.code : '')}" ${isEdit ? 'disabled' : ''}></div>
          <div class="form-field"><label>${l('التصنيف', 'Catégorie')}</label><select class="form-input" id="pt-cat">${catOpts}</select></div>
          <div class="form-field"><label>${l('الاسم (AR)', 'Nom (AR)')}</label><input class="form-input" id="pt-namear" value="${esc(existing ? existing.name_ar : '')}"></div>
          <div class="form-field"><label>${l('الاسم (FR)', 'Nom (FR)')}</label><input class="form-input" id="pt-namefr" value="${esc(existing ? existing.name_fr : '')}"></div>
        </div>
        <div class="form-field"><label>${l('الوصف (AR)', 'Description (AR)')}</label><input class="form-input" id="pt-descar" value="${esc(existing ? existing.description_ar : '')}"></div>
        <div class="form-field"><label>${l('الوصف (FR)', 'Description (FR)')}</label><input class="form-input" id="pt-descfr" value="${esc(existing ? existing.description_fr : '')}"></div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px">
          <strong>${l('الحقول الديناميكية', 'Champs dynamiques')}</strong>
          <button class="btn btn-sm btn-ghost" id="pt-add-field"><i class="fas fa-plus"></i> ${l('إضافة حقل', 'Ajouter champ')}</button>
        </div>
        <div id="pt-fields-container">${fieldsHtml}</div>
      </div>`;
    modal.footer.innerHTML = `<button class="btn btn-ghost" data-modal-cancel>${t('common.cancel')}</button><button class="btn btn-primary" data-modal-ok>${t('common.save')}</button>`;
    openModal();
    modal.footer.querySelector('[data-modal-cancel]').addEventListener('click', closeModal);
    byId('pt-add-field').addEventListener('click', () => {
      const c = byId('pt-fields-container');
      c.insertAdjacentHTML('beforeend', pTypeFieldRow(c.children.length));
    });
    cDelegate('pt-fields-container', '[data-pt-field-remove]', (el) => el.closest('.pt-field-row')?.remove());
    modal.footer.querySelector('[data-modal-ok]').addEventListener('click', async () => {
      const fields = [];
      byId('pt-fields-container').querySelectorAll('.pt-field-row').forEach((row) => {
        fields.push({
          fieldKey: row.querySelector('.pt-fk')?.value || '',
          labelAr: row.querySelector('.pt-la')?.value || '',
          labelFr: row.querySelector('.pt-lf')?.value || '',
          fieldType: row.querySelector('.pt-ft')?.value || 'text',
          required: row.querySelector('.pt-req')?.checked || false,
          options: []
        });
      });
      const payload = {
        categoryId: Number(byId('pt-cat').value),
        code: byId('pt-code').value.trim(),
        nameAr: byId('pt-namear').value.trim(),
        nameFr: byId('pt-namefr').value.trim(),
        descriptionAr: byId('pt-descar').value.trim(),
        descriptionFr: byId('pt-descfr').value.trim(),
        fields
      };
      try {
        if (isEdit) {
          await API.configTypeUpdate(existing.id, payload);
        } else {
          await API.configTypeAdd(payload);
        }
        closeModal();
        toast(t('common.save'));
        await loadPTypes();
      } catch (e) { toast(e.message, true); }
    });
  }

  function pTypeFieldRow(idx, f) {
    f = f || {};
    const types = ['text', 'number', 'date', 'select', 'textarea'];
    const opts = types.map((tp) => `<option value="${tp}" ${f.field_type === tp ? 'selected' : ''}>${tp}</option>`).join('');
    return `<div class="pt-field-row" style="display:grid;grid-template-columns:1fr 1fr 1fr 100px 40px 32px;gap:6px;margin-top:6px;align-items:center">
      <input class="form-input pt-fk" placeholder="${l('المفتاح', 'Clé')}" value="${esc(f.field_key || '')}">
      <input class="form-input pt-la" placeholder="${l('الاسم AR', 'Label AR')}" value="${esc(f.label_ar || '')}">
      <input class="form-input pt-lf" placeholder="${l('الاسم FR', 'Label FR')}" value="${esc(f.label_fr || '')}">
      <select class="form-input pt-ft">${opts}</select>
      <label style="font-size:.8em;display:flex;align-items:center;gap:4px"><input type="checkbox" class="pt-req" ${f.required ? 'checked' : ''}> ${l('مطلوب', 'Req')}</label>
      <button class="btn btn-sm btn-ghost danger" data-pt-field-remove><i class="fas fa-xmark"></i></button>
    </div>`;
  }

  /* ================================================================
     Statuses Tab — الحالات والانتقالات
     ================================================================ */
  let statuses = [], transitions = [];

  async function loadStatuses() {
    try { statuses = await API.configStatuses(); } catch (e) { statuses = []; }
    const tbody = byId('statuses-tbody');
    if (!tbody) return;
    tbody.innerHTML = statuses.map((s) => `<tr>
      <td><code>${esc(s.code)}</code></td>
      <td>${esc(state.lang === 'fr' ? s.name_fr : s.name_ar)}</td>
      <td><span class="badge" style="background:${esc(s.color)};color:#fff">${esc(s.color)}</span></td>
      <td>${s.active ? '<span class="badge success">' + l('نشط', 'Actif') + '</span>' : '<span class="badge">' + l('معطّل', 'Inactif') + '</span>'}</td>
      <td><button class="btn btn-sm btn-ghost" data-st-edit="${esc(s.code)}"><i class="fas fa-pen"></i></button></td>
    </tr>`).join('');
  }

  async function loadTransitions() {
    try { transitions = await API.configTransitions(); } catch (e) { transitions = []; }
    const tbody = byId('transitions-tbody');
    if (!tbody) return;
    const codeName = (code) => { const s = statuses.find((x) => x.code === code); return s ? (state.lang === 'fr' ? s.name_fr : s.name_ar) : code; };
    tbody.innerHTML = transitions.map((tr) => `<tr>
      <td>${esc(codeName(tr.from_status))}</td>
      <td><i class="fas fa-arrow-left" style="margin:0 4px"></i> ${esc(codeName(tr.to_status))}</td>
      <td><button class="btn btn-sm btn-ghost danger" data-tr-del="${tr.id}"><i class="fas fa-trash"></i></button></td>
    </tr>`).join('');
    tbody.querySelectorAll('[data-tr-del]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm(l('حذف هذا الانتقال؟', 'Supprimer cette transition ?'))) return;
      try { await API.configTransitionDelete(Number(b.getAttribute('data-tr-del'))); await loadTransitions(); } catch (e) { toast(e.message, true); }
    }));
  }

  function openStatusModal(existing) {
    const isEdit = !!existing;
    modal.title.textContent = isEdit ? l('تعديل الحالة', 'Modifier le statut') : l('حالة جديدة', 'Nouveau statut');
    const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#6b7280', '#06b6d4', '#f97316'];
    const colorOpts = colors.map((c) => `<option value="${c}" ${existing && existing.color === c ? 'selected' : ''}>${c}</option>`).join('');
    modal.body.innerHTML = `
      <div class="form-grid" style="grid-template-columns:1fr 1fr">
        <div class="form-field"><label>${l('الكود', 'Code')}</label><input class="form-input" id="st-code" value="${esc(existing ? existing.code : '')}" ${isEdit ? 'disabled' : ''}></div>
        <div class="form-field"><label>${l('اللون', 'Couleur')}</label><select class="form-input" id="st-color">${colorOpts}</select></div>
        <div class="form-field"><label>${l('الاسم AR', 'Nom AR')}</label><input class="form-input" id="st-namear" value="${esc(existing ? existing.name_ar : '')}"></div>
        <div class="form-field"><label>${l('الاسم FR', 'Nom FR')}</label><input class="form-input" id="st-namefr" value="${esc(existing ? existing.name_fr : '')}"></div>
      </div>`;
    modal.footer.innerHTML = `<button class="btn btn-ghost" data-modal-cancel>${t('common.cancel')}</button><button class="btn btn-primary" data-modal-ok>${t('common.save')}</button>`;
    openModal();
    modal.footer.querySelector('[data-modal-cancel]').addEventListener('click', closeModal);
    modal.footer.querySelector('[data-modal-ok]').addEventListener('click', async () => {
      const payload = { code: byId('st-code').value.trim(), nameAr: byId('st-namear').value.trim(), nameFr: byId('st-namefr').value.trim(), color: byId('st-color').value };
      try {
        if (isEdit) { await API.configStatusUpdate(existing.code, { ...payload, active: existing.active !== false }); }
        else { await API.configStatusAdd(payload.code, payload.nameAr, payload.nameFr, payload.color); }
        closeModal(); toast(t('common.save')); await loadStatuses();
      } catch (e) { toast(e.message, true); }
    });
  }

  function openTransitionModal() {
    modal.title.textContent = l('انتقال جديد', 'Nouvelle transition');
    const opts = statuses.map((s) => `<option value="${s.code}">${esc(state.lang === 'fr' ? s.name_fr : s.name_ar)}</option>`).join('');
    modal.body.innerHTML = `
      <div class="form-grid" style="grid-template-columns:1fr 1fr">
        <div class="form-field"><label>${l('من الحالة', 'De')}</label><select class="form-input" id="tr-from">${opts}</select></div>
        <div class="form-field"><label>${l('إلى الحالة', 'Vers')}</label><select class="form-input" id="tr-to">${opts}</select></div>
      </div>`;
    modal.footer.innerHTML = `<button class="btn btn-ghost" data-modal-cancel>${t('common.cancel')}</button><button class="btn btn-primary" data-modal-ok>${t('common.save')}</button>`;
    openModal();
    modal.footer.querySelector('[data-modal-cancel]').addEventListener('click', closeModal);
    modal.footer.querySelector('[data-modal-ok]').addEventListener('click', async () => {
      try {
        await API.configTransitionAdd(byId('tr-from').value, byId('tr-to').value);
        closeModal(); toast(t('common.save')); await loadTransitions();
      } catch (e) { toast(e.message, true); }
    });
  }

  /* ================================================================
     PV Types Tab — أنواع وحالات المحاضر
     ================================================================ */
  let pvTypes = [], pvStatuses = [];

  async function loadPvTypes() {
    try { pvTypes = await API.pvTypes(); } catch (e) { pvTypes = []; }
    const tbody = byId('pvtypes-tbody');
    if (!tbody) return;
    tbody.innerHTML = pvTypes.map((tp) => `<tr>
      <td><code>${esc(tp.code)}</code></td>
      <td>${esc(state.lang === 'fr' ? tp.name_fr : tp.name_ar)}</td>
      <td>${tp.active !== false ? '<span class="badge success">' + l('نشط', 'Actif') + '</span>' : '<span class="badge">' + l('معطّل', 'Inactif') + '</span>'}</td>
      <td><button class="btn btn-sm btn-ghost" data-pvtp-edit="${tp.id}"><i class="fas fa-pen"></i></button></td>
    </tr>`).join('');
    tbody.querySelectorAll('[data-pvtp-edit]').forEach((b) => b.addEventListener('click', () => {
      const tp = pvTypes.find((x) => x.id === Number(b.getAttribute('data-pvtp-edit')));
      if (tp) openPvTypeModal(tp);
    }));
  }

  async function loadPvStatuses() {
    try { pvStatuses = await API.pvStatuses(); } catch (e) { pvStatuses = []; }
    const tbody = byId('pvstatuses-tbody');
    if (!tbody) return;
    tbody.innerHTML = pvStatuses.map((s) => `<tr>
      <td><code>${esc(s.code)}</code></td>
      <td>${esc(state.lang === 'fr' ? s.name_fr : s.name_ar)}</td>
      <td><span class="badge" style="background:${esc(s.color)};color:#fff">${esc(s.color)}</span></td>
      <td><button class="btn btn-sm btn-ghost" data-pvst-edit="${esc(s.code)}"><i class="fas fa-pen"></i></button></td>
    </tr>`).join('');
    tbody.querySelectorAll('[data-pvst-edit]').forEach((b) => b.addEventListener('click', () => {
      const st = pvStatuses.find((x) => x.code === b.getAttribute('data-pvst-edit'));
      if (st) openPvStatusModal(st);
    }));
  }

  function openPvTypeModal(existing) {
    const isEdit = !!existing;
    modal.title.textContent = isEdit ? l('تعديل نوع المحضر', 'Modifier le type de PV') : l('نوع محضر جديد', 'Nouveau type de PV');
    modal.body.innerHTML = `
      <div class="form-grid" style="grid-template-columns:1fr 1fr">
        <div class="form-field"><label>${l('الكود', 'Code')}</label><input class="form-input" id="pvtp-code" value="${esc(existing ? existing.code : '')}" ${isEdit ? 'disabled' : ''}></div>
        <div class="form-field"><label>${l('نشط', 'Actif')}</label><select class="form-input" id="pvtp-active"><option value="1" ${!existing || existing.active !== false ? 'selected' : ''}>${l('نعم', 'Oui')}</option><option value="0" ${existing && existing.active === false ? 'selected' : ''}>${l('لا', 'Non')}</option></select></div>
        <div class="form-field"><label>${l('الاسم AR', 'Nom AR')}</label><input class="form-input" id="pvtp-namear" value="${esc(existing ? existing.name_ar : '')}"></div>
        <div class="form-field"><label>${l('الاسم FR', 'Nom FR')}</label><input class="form-input" id="pvtp-namefr" value="${esc(existing ? existing.name_fr : '')}"></div>
      </div>`;
    modal.footer.innerHTML = `<button class="btn btn-ghost" data-modal-cancel>${t('common.cancel')}</button><button class="btn btn-primary" data-modal-ok>${t('common.save')}</button>`;
    openModal();
    modal.footer.querySelector('[data-modal-cancel]').addEventListener('click', closeModal);
    modal.footer.querySelector('[data-modal-ok]').addEventListener('click', async () => {
      try {
        await API.pvTypeUpdate({
          id: existing ? existing.id : undefined,
          code: byId('pvtp-code').value.trim(),
          nameAr: byId('pvtp-namear').value.trim(),
          nameFr: byId('pvtp-namefr').value.trim(),
          active: Number(byId('pvtp-active').value)
        });
        closeModal(); toast(t('common.save')); await loadPvTypes();
      } catch (e) { toast(e.message, true); }
    });
  }

  function openPvStatusModal(existing) {
    modal.title.textContent = l('تعديل حالة المحضر', 'Modifier le statut PV');
    const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#6b7280'];
    modal.body.innerHTML = `
      <div class="form-grid" style="grid-template-columns:1fr 1fr">
        <div class="form-field"><label>${l('الكود', 'Code')}</label><input class="form-input" id="pvst-code" value="${esc(existing.code)}" disabled></div>
        <div class="form-field"><label>${l('اللون', 'Couleur')}</label><select class="form-input" id="pvst-color">${colors.map((c) => `<option value="${c}" ${existing.color === c ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
        <div class="form-field"><label>${l('الاسم AR', 'Nom AR')}</label><input class="form-input" id="pvst-namear" value="${esc(existing.name_ar)}"></div>
        <div class="form-field"><label>${l('الاسم FR', 'Nom FR')}</label><input class="form-input" id="pvst-namefr" value="${esc(existing.name_fr)}"></div>
      </div>`;
    modal.footer.innerHTML = `<button class="btn btn-ghost" data-modal-cancel>${t('common.cancel')}</button><button class="btn btn-primary" data-modal-ok>${t('common.save')}</button>`;
    openModal();
    modal.footer.querySelector('[data-modal-cancel]').addEventListener('click', closeModal);
    modal.footer.querySelector('[data-modal-ok]').addEventListener('click', async () => {
      try {
        await API.pvStatusUpdate({
          code: existing.code,
          nameAr: byId('pvst-namear').value.trim(),
          nameFr: byId('pvst-namefr').value.trim(),
          color: byId('pvst-color').value
        });
        closeModal(); toast(t('common.save')); await loadPvStatuses();
      } catch (e) { toast(e.message, true); }
    });
  }

  /* ================================================================
     Finance Tab — طرق الدفع والتعريفات
     ================================================================ */
  let payMethods = [], tariffs = [];

  async function loadPayMethods() {
    try { payMethods = await API.payMethods(); } catch (e) { payMethods = []; }
    const tbody = byId('paymethods-tbody');
    if (!tbody) return;
    tbody.innerHTML = payMethods.map((m) => `<tr>
      <td><code>${esc(m.code)}</code></td>
      <td>${esc(state.lang === 'fr' ? m.name_fr : m.name_ar)}</td>
      <td>${m.active !== false ? '<span class="badge success">' + l('نشط', 'Actif') + '</span>' : '<span class="badge">' + l('معطّل', 'Inactif') + '</span>'}</td>
      <td><button class="btn btn-sm btn-ghost" data-pm-edit="${m.id || m.code}"><i class="fas fa-pen"></i></button></td>
    </tr>`).join('');
    tbody.querySelectorAll('[data-pm-edit]').forEach((b) => b.addEventListener('click', () => {
      const m = payMethods.find((x) => String(x.id || x.code) === b.getAttribute('data-pm-edit'));
      if (m) openPayMethodModal(m);
    }));
  }

  async function loadTariffs() {
    try { tariffs = await API.tariffList(); } catch (e) { tariffs = []; }
    const tbody = byId('tariffs-tbody');
    if (!tbody) return;
    tbody.innerHTML = tariffs.map((tf) => `<tr>
      <td><code>${esc(tf.code)}</code></td>
      <td>${esc(state.lang === 'fr' ? (tf.name_fr || tf.code) : (tf.name_ar || tf.code))}</td>
      <td>${tf.default_amount} ${esc(tf.currency || 'MAD')}</td>
      <td>${esc(tf.currency || 'MAD')}</td>
      <td><button class="btn btn-sm btn-ghost" data-tf-edit="${tf.id}"><i class="fas fa-pen"></i></button></td>
    </tr>`).join('');
    tbody.querySelectorAll('[data-tf-edit]').forEach((b) => b.addEventListener('click', () => {
      const tf = tariffs.find((x) => x.id === Number(b.getAttribute('data-tf-edit')));
      if (tf) openTariffModal(tf);
    }));
  }

  function openPayMethodModal(existing) {
    const isEdit = !!existing;
    modal.title.textContent = isEdit ? l('تعديل طريقة الدفع', 'Modifier la méthode') : l('طريقة دفع جديدة', 'Nouvelle méthode de paiement');
    modal.body.innerHTML = `
      <div class="form-grid" style="grid-template-columns:1fr 1fr">
        <div class="form-field"><label>${l('الكود', 'Code')}</label><input class="form-input" id="pm-code" value="${esc(existing ? existing.code : '')}" ${isEdit ? 'disabled' : ''}></div>
        <div class="form-field"><label>${l('نشط', 'Actif')}</label><select class="form-input" id="pm-active"><option value="1" ${!existing || existing.active !== false ? 'selected' : ''}>${l('نعم', 'Oui')}</option><option value="0" ${existing && existing.active === false ? 'selected' : ''}>${l('لا', 'Non')}</option></select></div>
        <div class="form-field"><label>${l('الاسم AR', 'Nom AR')}</label><input class="form-input" id="pm-namear" value="${esc(existing ? existing.name_ar : '')}"></div>
        <div class="form-field"><label>${l('الاسم FR', 'Nom FR')}</label><input class="form-input" id="pm-namefr" value="${esc(existing ? existing.name_fr : '')}"></div>
      </div>`;
    modal.footer.innerHTML = `<button class="btn btn-ghost" data-modal-cancel>${t('common.cancel')}</button><button class="btn btn-primary" data-modal-ok>${t('common.save')}</button>`;
    openModal();
    modal.footer.querySelector('[data-modal-cancel]').addEventListener('click', closeModal);
    modal.footer.querySelector('[data-modal-ok]').addEventListener('click', async () => {
      try {
        if (isEdit) {
          await API.payMethodUpdate(existing.id || existing.code, {
            nameAr: byId('pm-namear').value.trim(), nameFr: byId('pm-namefr').value.trim(), active: Number(byId('pm-active').value)
          });
        } else {
          await API.payMethodAdd({
            code: byId('pm-code').value.trim(), nameAr: byId('pm-namear').value.trim(), nameFr: byId('pm-namefr').value.trim()
          });
        }
        closeModal(); toast(t('common.save')); await loadPayMethods();
      } catch (e) { toast(e.message, true); }
    });
  }

  function openTariffModal(existing) {
    const isEdit = !!existing;
    modal.title.textContent = isEdit ? l('تعديل التعريفة', 'Modifier le tarif') : l('تعريفة جديدة', 'Nouveau tarif');
    modal.body.innerHTML = `
      <div class="form-grid" style="grid-template-columns:1fr 1fr">
        <div class="form-field"><label>${l('الكود', 'Code')}</label><input class="form-input" id="tf-code" value="${esc(existing ? existing.code : '')}" ${isEdit ? 'disabled' : ''}></div>
        <div class="form-field"><label>${l('المبلغ', 'Montant')}</label><input class="form-input" id="tf-amount" type="number" value="${existing ? existing.default_amount : ''}"></div>
        <div class="form-field"><label>${l('العملة', 'Devise')}</label><input class="form-input" id="tf-currency" value="${esc(existing ? existing.currency || 'MAD' : 'MAD')}"></div>
        <div class="form-field"><label>${l('الاسم AR', 'Nom AR')}</label><input class="form-input" id="tf-namear" value="${esc(existing ? existing.name_ar || '' : '')}"></div>
        <div class="form-field"><label>${l('الاسم FR', 'Nom FR')}</label><input class="form-input" id="tf-namefr" value="${esc(existing ? existing.name_fr || '' : '')}"></div>
        <div class="form-field"><label>${l('الحالة', 'Statut')}</label><select class="form-input" id="tf-status"><option value="active" ${!existing || existing.status === 'active' ? 'selected' : ''}>${l('نشط', 'Actif')}</option><option value="inactive" ${existing && existing.status === 'inactive' ? 'selected' : ''}>${l('معطّل', 'Inactif')}</option></select></div>
      </div>`;
    modal.footer.innerHTML = `<button class="btn btn-ghost" data-modal-cancel>${t('common.cancel')}</button><button class="btn btn-primary" data-modal-ok>${t('common.save')}</button>`;
    openModal();
    modal.footer.querySelector('[data-modal-cancel]').addEventListener('click', closeModal);
    modal.footer.querySelector('[data-modal-ok]').addEventListener('click', async () => {
      const payload = {
        code: byId('tf-code').value.trim(),
        nameAr: byId('tf-namear').value.trim(),
        nameFr: byId('tf-namefr').value.trim(),
        defaultAmount: Number(byId('tf-amount').value),
        currency: byId('tf-currency').value.trim() || 'MAD',
        status: byId('tf-status').value
      };
      try {
        if (isEdit) { await API.tariffUpdate(existing.id, payload); }
        else { await API.tariffAdd(payload); }
        closeModal(); toast(t('common.save')); await loadTariffs();
      } catch (e) { toast(e.message, true); }
    });
  }

  /* ================================================================
     Backup Tab — النسخ الاحتياطي والاسترجاع
     ================================================================ */
  async function loadBackupList() {
    const container = byId('backup-list');
    if (!container) return;
    try {
      const list = await API.backupList();
      if (!list.length) {
        container.innerHTML = `<p class="hint">${l('لا توجد نسخ احتياطية', 'Aucune sauvegarde')}</p>`;
        return;
      }
      container.innerHTML = `<table class="data-table"><thead><tr><th>${l('الملف', 'Fichier')}</th><th>${l('الحجم', 'Taille')}</th><th>${l('التاريخ', 'Date')}</th><th>${l('إجراءات', 'Actions')}</th></tr></thead><tbody>${list.map((b) => `<tr>
        <td><code>${esc(b.name)}</code></td>
        <td>${b.size ? (b.size / 1024).toFixed(1) + ' KB' : '—'}</td>
        <td>${esc(b.date || '—')}</td>
        <td><button class="btn btn-sm btn-ghost" data-bk-restore="${esc(b.name)}"><i class="fas fa-rotate"></i></button> <button class="btn btn-sm btn-ghost danger" data-bk-del="${esc(b.name)}"><i class="fas fa-trash"></i></button></td>
      </tr>`).join('')}</tbody></table>`;
      container.querySelectorAll('[data-bk-del]').forEach((b) => b.addEventListener('click', async () => {
        if (!confirm(l('حذف هذه النسخة؟', 'Supprimer cette sauvegarde ?'))) return;
        try { await API.backupDelete(b.getAttribute('data-bk-del')); await loadBackupList(); } catch (e) { toast(e.message, true); }
      }));
      container.querySelectorAll('[data-bk-restore]').forEach((b) => b.addEventListener('click', async () => {
        if (!confirm(l('استرجاع هذه النسخة؟ سيتم استبدال البيانات الحالية!', 'Restaurer cette sauvegarde ? Les données actuelles seront remplacées !'))) return;
        try {
          await API.backupRestore(b.getAttribute('data-bk-restore'));
          toast(l('تم الاسترجاع — أعد تشغيل التطبيق', 'Restauration réussie — redémarrez l\'application'));
        } catch (e) { toast(e.message, true); }
      }));
    } catch (e) {
      container.innerHTML = `<p class="hint">${l('لا توجد نسخ احتياطية', 'Aucune sauvegarde')}</p>`;
    }
  }

  /* ================================================================
     Helpers
     ================================================================ */
  function cDelegate(containerId, selector, handler) {
    const c = byId(containerId);
    if (!c) return;
    c.addEventListener('click', (e) => {
      const el = e.target.closest(selector);
      if (el) handler(el);
    });
  }

  /* ================================================================
     Init —ربط الأحداث
     ================================================================ */
  function init() {
    /* Tab switching */
    document.querySelectorAll('#settings-tabs .dtab').forEach((b) => {
      b.addEventListener('click', () => switchTab(b.getAttribute('data-settings-tab')));
    });

    /* Types */
    byId('ptype-add')?.addEventListener('click', () => openPTypeModal(null));
    cDelegate('ptypes-tbody', '[data-ptype-edit]', (el) => {
      const tp = pTypes.find((x) => x.id === Number(el.getAttribute('data-ptype-edit')));
      if (tp) openPTypeModal(tp);
    });

    /* Statuses */
    byId('status-add')?.addEventListener('click', () => openStatusModal(null));
    cDelegate('statuses-tbody', '[data-st-edit]', (el) => {
      const s = statuses.find((x) => x.code === el.getAttribute('data-st-edit'));
      if (s) openStatusModal(s);
    });
    byId('transition-add')?.addEventListener('click', () => openTransitionModal());

    /* PV Types */
    byId('pvtype-add')?.addEventListener('click', () => openPvTypeModal(null));
    byId('pvstatus-add')?.addEventListener('click', () => openPvStatusModal({}));

    /* Payment Methods + Tariffs */
    byId('paymethod-add')?.addEventListener('click', () => openPayMethodModal(null));
    byId('tariff-add')?.addEventListener('click', () => openTariffModal(null));

    /* Backup */
    byId('backup-create')?.addEventListener('click', async () => {
      try {
        await API.backupCreate();
        toast(l('تم إنشاء النسخة الاحتياطية', 'Sauvegarde créée'));
        await loadBackupList();
      } catch (e) { toast(e.message, true); }
    });
    byId('restore-file')?.addEventListener('change', (e) => {
      const f = e.target.files[0];
      byId('restore-btn').disabled = !f;
      if (f) byId('restore-status').textContent = l('ملف مختار: ', 'Fichier sélectionné : ') + f.name;
    });
    byId('restore-btn')?.addEventListener('click', async () => {
      const f = byId('restore-file').files[0];
      if (!f) return;
      if (!confirm(l('هل أنت متأكد من الاسترجاع؟ سيتم استبدال جميع البيانات!', 'Êtes-vous sûr ? Toutes les données seront remplacées !'))) return;
      try {
        const arrayBuffer = await f.arrayBuffer();
        const uint8 = new Uint8Array(arrayBuffer);
        await API.backupRestoreUpload(uint8, f.name);
        toast(l('تم الاسترجاع — أعد تشغيل التطبيق', 'Restauration réussie — redémarrez l\'application'));
      } catch (e) { toast(e.message, true); }
    });
  }

  window.SettingsModule = { init, loadTab };
})();
