/* ================================================================
   تطبيق تسيير المفوض القضائي — أمام التطبيق (Renderer)
   اللغة | المظهر | التنقل | CRUD | نماذج | تصدير
   ================================================================ */

'use strict';

(function () {
  const API = window.appAPI;

  /* ---------- الحالة ---------- */
  const state = {
    lang: 'ar',
    theme: 'light',
    dossiers: [],
    clients: [],
    activities: [],
    stats: { totalDossiers: 0, totalClients: 0, byStatus: {}, recent: [] },
    locale: {},
    currentUser: null,
    currentPage: 'dashboard'
  };

  const STATUS_KEYS = ['open', 'in_progress', 'closed', 'pending'];

  /* ---------- تعريب النصوص ---------- */
  function t(path) {
    const parts = path.split('.');
    let node = state.locale;
    for (const p of parts) {
      if (!node || node[p] === undefined) return path;
      node = node[p];
    }
    return node;
  }

  function pickLocale(loc, path) {
    const parts = path.split('.');
    let node = loc;
    for (const p of parts) {
      if (!node || node[p] === undefined) return undefined;
      node = node[p];
    }
    return node;
  }

  function typeLabel(listKey, val) {
    if (!val) return '';
    const cur = t(listKey);
    if (!Array.isArray(cur)) return val;
    if (cur.includes(val)) return val;
    const other = state.lang === 'fr' ? state.localeAr : state.localeFr;
    const otherList = pickLocale(other, listKey);
    if (!Array.isArray(otherList)) return val;
    const idx = otherList.indexOf(val);
    return (idx >= 0 && cur[idx]) ? cur[idx] : val;
  }

  function applyLocale() {
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      el.textContent = t(key);
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
      el.placeholder = t(el.getAttribute('data-i18n-placeholder'));
    });
    document.querySelectorAll('[data-i18n-title]').forEach((el) => {
      el.title = t(el.getAttribute('data-i18n-title'));
    });
    document.querySelectorAll('[data-i18n-aria]').forEach((el) => {
      const key = el.getAttribute('data-i18n-aria');
      const val = t(key);
      if (val !== key) el.setAttribute('aria-label', val);
    });
    document.title = t('appName');
    const sec = state.currentPage;
    document.getElementById('page-title').textContent = t(`nav.${sec}`);
    document.getElementById('page-subtitle').textContent = t(`${sec}.subtitle`);
  }

  async function loadLocale(lang) {
    state.locale = await API.getLocale(lang);
    if (!state.localeAr) state.localeAr = await API.getLocale('ar');
    if (!state.localeFr) state.localeFr = await API.getLocale('fr');
    applyLocale();
    renderAll();
    if (state.currentPage === 'documents' && window.TemplatesModule) window.TemplatesModule.render();
    if (state.currentPage === 'archive' && window.ArchiveModule) window.ArchiveModule.render();
    if (state.currentPage === 'pvs' && window.PvsModule) window.PvsModule.render();
    if (state.currentPage === 'finance' && window.FinanceModule) window.FinanceModule.render();
    if (state.currentPage === 'registers' && window.RegistersModule) window.RegistersModule.render();
  }

  /* ---------- اللغة ---------- */
  function setLang(lang, notify) {
    state.lang = lang;
    const html = document.documentElement;
    if (lang === 'fr') {
      html.setAttribute('lang', 'fr');
      html.setAttribute('dir', 'ltr');
      document.getElementById('lang-label').textContent = 'AR';
    } else {
      html.setAttribute('lang', 'ar');
      html.setAttribute('dir', 'rtl');
      document.getElementById('lang-label').textContent = 'FR';
    }
    try { localStorage.setItem('huissier-lang', lang); } catch (e) {}
    loadLocale(lang);
    if (notify) toast(t('common.save'));
  }

  /* ---------- المظهر ---------- */
  function setTheme(value, notify) {
    state.theme = value;
    document.documentElement.setAttribute('data-theme', value);
    localStorage.setItem('huissier-theme', value);
    document.querySelectorAll('.theme-option').forEach((o) => {
      o.classList.toggle('active', o.getAttribute('data-theme') === value);
    });
    document.getElementById('theme-toggle').innerHTML =
      value === 'light' ? '<i class="fas fa-moon"></i>' : '<i class="fas fa-sun"></i>';
    if (notify) toast(t('common.save'));
  }

  /* ---------- التنقل ---------- */
  function goTo(page, fromKeyboard) {
    state.currentPage = page;
    document.querySelectorAll('.nav-item').forEach((b) => {
      b.classList.toggle('active', b.getAttribute('data-page') === page);
    });
    document.querySelectorAll('.page').forEach((s) => {
      s.classList.toggle('active', s.id === 'page-' + page);
    });
    document.getElementById('page-title').textContent = t(`nav.${page}`);
    document.getElementById('page-subtitle').textContent = t(`${page}.subtitle`);
    closeSidebar();
    if (page === 'dossiers') renderDossiers();
    if (page === 'clients') renderClients();
    if (page === 'procedures' && window.ProceduresModule) window.ProceduresModule.render();
    if (page === 'documents' && window.TemplatesModule) window.TemplatesModule.render();
    if (page === 'archive' && window.ArchiveModule) window.ArchiveModule.render();
    if (page === 'pvs' && window.PvsModule) window.PvsModule.render();
    if (page === 'finance' && window.FinanceModule) window.FinanceModule.render();
    if (page === 'registers' && window.RegistersModule) window.RegistersModule.render();
    if (fromKeyboard) {
      const pageEl = document.getElementById('page-' + page);
      const first = pageEl ? focusablesIn(pageEl)[0] : null;
      if (first) first.focus();
      else if (pageEl) { pageEl.setAttribute('tabindex', '-1'); pageEl.focus(); }
    }
  }

  /* ---------- توست ---------- */
  function toast(message, isError) {
    const wrap = document.getElementById('toast-wrap');
    const el = document.createElement('div');
    el.className = 'toast' + (isError ? ' error' : '');
    el.innerHTML = `<i class="fas ${isError ? 'fa-circle-exclamation' : 'fa-check-circle'}"></i><span></span>`;
    el.querySelector('span').textContent = message;
    wrap.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(8px)';
      setTimeout(() => el.remove(), 250);
    }, 2600);
  }

  /* ---------- شارات الحالة ---------- */
  function badge(key) {
    return `<span class="badge ${key}">${t(`statusBadge.${key}`)}</span>`;
  }

  /* ---------- جداول ---------- */
  function buildHeaders(theadEl, translated) {
    theadEl.innerHTML = translated.map((h) => `<th>${h}</th>`).join('');
  }

  function fmtDate(d) {
    if (!d) return '—';
    const date = new Date(d);
    if (isNaN(date.getTime())) return d;
    return date.toLocaleDateString(state.lang === 'ar' ? 'ar-MA' : 'fr-MA', {
      year: 'numeric', month: '2-digit', day: '2-digit'
    });
  }

  /* ---------- الملفات ---------- */
  let dossierFilter = '';

  function renderDossiers() {
    const rows = state.dossiers
      .filter((d) => {
        if (!dossierFilter) return true;
        const q = dossierFilter.toLowerCase();
        return [d.numero, d.demandeur, d.defendeur, d.court, d.type]
          .some((v) => (v || '').toLowerCase().includes(q));
      })
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    document.getElementById('dossier-tbody').innerHTML = rows.length
      ? rows.map((d) => `
        <tr>
          <td><strong>${escapeHtml(d.numero || '—')}</strong></td>
          <td>${escapeHtml(d.demandeur || '')}</td>
          <td>${escapeHtml(d.defendeur || '')}</td>
          <td>${escapeHtml(d.court || '')}</td>
          <td>${escapeHtml(typeLabel('dossiers.types', d.type))}</td>
          <td>${badge(d.status || 'autre')}</td>
          <td>${fmtDate(d.date)}</td>
          <td><div class="row-actions">
            <button class="row-btn edit" data-dos-edit="${d.id}" title="${t('common.edit')}"><i class="fas fa-pen"></i></button>
            <button class="row-btn del" data-dos-del="${d.id}" title="${t('common.delete')}"><i class="fas fa-trash"></i></button>
          </div></td>
        </tr>`).join('')
      : '';

    document.getElementById('dossier-empty').style.display = rows.length ? 'none' : 'flex';
    bindDossierRowActions();
  }

  function renderRecentDossiers() {
    const recent = [...state.dossiers].sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 5);
    const body = document.getElementById('recent-tbody');
    const empty = document.getElementById('recent-empty');

    buildHeaders(document.getElementById('recent-thead'), t('dossiers.columns').slice(0, 6));

    body.innerHTML = recent.length
      ? recent.map((d) => `
        <tr>
          <td><strong>${escapeHtml(d.numero || '—')}</strong></td>
          <td>${escapeHtml(d.demandeur || '')}</td>
          <td>${escapeHtml(d.defendeur || '')}</td>
          <td>${escapeHtml(d.court || '')}</td>
          <td>${escapeHtml(typeLabel('dossiers.types', d.type))}</td>
          <td>${badge(d.status || 'autre')}</td>
        </tr>`).join('')
      : '';
    empty.classList.toggle('hidden', recent.length > 0);
  }

  /* ---------- العملاء ---------- */
  let clientFilter = '';

  function renderClients() {
    const rows = state.clients
      .filter((c) => {
        if (!clientFilter) return true;
        const q = clientFilter.toLowerCase();
        return [c.name, c.phone, c.email, c.type].some((v) => (v || '').toLowerCase().includes(q));
      })
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    document.getElementById('client-tbody').innerHTML = rows.length
      ? rows.map((c) => `
        <tr>
          <td><strong>${escapeHtml(c.name || '')}</strong></td>
          <td>${escapeHtml(c.phone || '—')}</td>
          <td>${escapeHtml(c.email || '—')}</td>
          <td>${escapeHtml(typeLabel('clients.types', c.type))}</td>
          <td><div class="row-actions">
            <button class="row-btn edit" data-cli-edit="${c.id}" title="${t('common.edit')}"><i class="fas fa-pen"></i></button>
            <button class="row-btn del" data-cli-del="${c.id}" title="${t('common.delete')}"><i class="fas fa-trash"></i></button>
          </div></td>
        </tr>`).join('')
      : '';

    document.getElementById('client-empty').style.display = rows.length ? 'none' : 'flex';
    bindClientRowActions();
  }

  /* ---------- الإحصائيات ---------- */
  function renderStats() {
    document.getElementById('stat-dossiers').textContent = state.stats.totalDossiers;
    document.getElementById('stat-clients').textContent = state.stats.totalClients;
    document.getElementById('stat-active').textContent = (state.stats.byStatus.open || 0) + (state.stats.byStatus.in_progress || 0);
    document.getElementById('stat-closed').textContent = state.stats.byStatus.closed || 0;
    renderActivity();
  }

  function renderActivity() {
    const list = document.getElementById('activity-list');
    const items = state.activities.slice(0, 8);
    list.innerHTML = items.length
      ? items.map((a) => `
        <li class="activity-item"><i class="fas fa-circle-plus"></i>
          <div>${escapeHtml(a.text)}<small>${fmtDate(a.date)}</small></div>
        </li>`).join('')
      : `<li class="activity-empty">${t('dashboard.emptyActivity')}</li>`;
  }

  function renderFinanceStats() {
    API.payStats().then((s) => {
      document.getElementById('stat-payments-total').textContent = s.total || 0;
      document.getElementById('stat-payments-amount').textContent = (() => {
        try { return Number(s.totalPaid || 0).toLocaleString(state.lang === 'ar' ? 'ar-MA' : 'fr-MA'); }
        catch (e) { return String(s.totalPaid || 0); }
      })();
    }).catch(() => {});
  }

  /* ---------- الحالة من الخادم ---------- */
  async function refresh() {
    const data = await API.getState();
    state.dossiers = data.dossiers;
    state.clients = data.clients;
    state.activities = data.activities;
    state.stats = data.stats;
    renderStats();
    renderFinanceStats();
    renderDossiers();
    renderClients();
    renderRecentDossiers();
  }

  function renderAll() {
    buildHeaders(document.getElementById('dossier-thead'), t('dossiers.columns'));
    buildHeaders(document.getElementById('client-thead'), t('clients.columns'));
    renderDossiers();
    renderClients();
    renderRecentDossiers();
    renderStats();
    renderFinanceStats();
  }

  /* ---------- النماذج (Modal) ---------- */
  const modal = {
    backdrop: document.getElementById('modal-backdrop'),
    title: document.getElementById('modal-title'),
    body: document.getElementById('modal-body'),
    footer: document.getElementById('modal-footer')
  };

  /* ---------- تنقل لوحة المفاتيح ---------- */
  const NAV_SEARCH = {
    procedures: 'proc-search', pvs: 'pv-search', dossiers: 'dossier-search',
    clients: 'client-search', documents: 'tpl-search', finance: 'fin-search',
    registers: 'reg-search-q', archive: 'arc-search'
  };

  function focusablesIn(scope) {
    if (!scope) return [];
    return Array.from(scope.querySelectorAll('input, select, textarea, button, a[href], [tabindex]:not([tabindex="-1"])'))
      .filter((el) => !el.disabled && !el.hidden &&
        el.getAttribute('aria-hidden') !== 'true' && el.offsetParent !== null);
  }

  function topBackdrop() {
    const all = document.querySelectorAll('.modal-backdrop.show');
    return all.length ? all[all.length - 1] : null;
  }

  function moveFieldFocus(dir) {
    const bd = topBackdrop();
    const scope = bd || document.querySelector('.page.active') || document.body;
    const items = focusablesIn(scope);
    if (!items.length) return;
    const i = items.indexOf(document.activeElement);
    let n = i < 0 ? (dir > 0 ? 0 : items.length - 1) : i + dir;
    if (n < 0) n = items.length - 1;
    if (n >= items.length) n = 0;
    items[n].focus();
  }

  let lastFocused = null;
  function openModal() {
    lastFocused = document.activeElement;
    modal.backdrop.classList.add('show');
    requestAnimationFrame(() => {
      const first = focusablesIn(modal.body)[0];
      const fallback = modal.footer.querySelector('button');
      (first || fallback || modal.backdrop).focus();
    });
  }
  function closeModal() {
    modal.backdrop.classList.remove('show');
    if (lastFocused && lastFocused.isConnected) { lastFocused.focus(); lastFocused = null; }
  }

  function field(id, labelKey, value, type, options, optionValues) {
    const isObjOptions = options && typeof options[0] === 'object';
    const opts = options
      ? options.map((o, i) => {
          const ov = isObjOptions ? o.v : (optionValues && optionValues[i]) || o;
          const label = isObjOptions ? o.l : o;
          return `<option value="${escapeHtml(ov)}" ${String(ov) === String(value) ? 'selected' : ''}>${escapeHtml(label)}</option>`;
        }).join('')
      : '';
    const control = options
      ? `<select class="form-input" id="${id}">${opts}</select>`
      : type === 'textarea'
        ? `<textarea class="form-input" id="${id}" rows="3">${escapeHtml(value || '')}</textarea>`
        : `<input class="form-input" id="${id}" type="${type || 'text'}" value="${escapeHtml(value || '')}">`;
    return `<div class="form-field">${t(labelKey)}${control}</div>`;
  }

  /* ---------- مشاركة الأدوات مع وحدات أخرى ---------- */
  window.HuissierApp = {
    API, state, t, toast, escapeHtml, fmtDate, badge,
    modal, openModal, closeModal, field, goTo
  };

  function openDossierModal(item) {
    const d = item || {};
    modal.title.textContent = t(item ? 'dossiers.editTitle' : 'dossiers.formTitle');
    modal.body.innerHTML = `
      <div class="form-grid" style="grid-template-columns:1fr">
        ${field('f-numero', 'dossiers.fields.numero', d.numero, 'text')}
        ${field('f-demandeur', 'dossiers.fields.demandeur', d.demandeur, 'text')}
        ${field('f-defendeur', 'dossiers.fields.defendeur', d.defendeur, 'text')}
        ${field('f-court', 'dossiers.fields.court', d.court, 'text')}
        ${field('f-type', 'dossiers.fields.type', typeLabel('dossiers.types', d.type), 'select', t('dossiers.types'))}
        ${field('f-status', 'dossiers.fields.status', d.status || 'open', 'select', STATUS_KEYS.map((k) => ({ v: k, l: t('statusBadge.' + k) })))}
        ${field('f-date', 'dossiers.fields.date', d.date || new Date().toISOString().slice(0,10), 'date')}
        ${field('f-notes', 'dossiers.fields.notes', d.notes, 'textarea')}
      </div>`;
    modal.footer.innerHTML = `
      <button class="btn btn-ghost" data-modal-cancel>${t('common.cancel')}</button>
      <button class="btn btn-primary" data-modal-ok>${t('common.save')}</button>`;
    openModal();

    modal.footer.querySelector('[data-modal-cancel]').addEventListener('click', closeModal);
    modal.footer.querySelector('[data-modal-ok]').addEventListener('click', async () => {
      const payload = {
        id: d.id,
        numero: document.getElementById('f-numero').value.trim(),
        demandeur: document.getElementById('f-demandeur').value.trim(),
        defendeur: document.getElementById('f-defendeur').value.trim(),
        court: document.getElementById('f-court').value.trim(),
        type: document.getElementById('f-type').value,
        status: document.getElementById('f-status').value,
        date: document.getElementById('f-date').value,
        notes: document.getElementById('f-notes').value.trim()
      };

      await API.saveDossier(payload);
      state.activities.unshift({ text: (item ? t('dossiers.activityEdit') : t('dossiers.activityAdd')) + payload.numero, date: new Date().toISOString() });
      closeModal();
      await refresh();
      toast(t('common.save'));
    });
  }

  function openClientModal(item) {
    const c = item || {};
    modal.title.textContent = t(item ? 'clients.editTitle' : 'clients.formTitle');
    modal.body.innerHTML = `
      <div class="form-grid" style="grid-template-columns:1fr">
        ${field('c-name', 'clients.fields.name', c.name, 'text')}
        ${field('c-phone', 'clients.fields.phone', c.phone, 'text')}
        ${field('c-email', 'clients.fields.email', c.email, 'text')}
        ${field('c-type', 'clients.fields.type', typeLabel('clients.types', c.type), 'select', t('clients.types'))}
        ${field('c-notes', 'clients.fields.notes', c.notes, 'textarea')}
      </div>`;
    modal.footer.innerHTML = `
      <button class="btn btn-ghost" data-modal-cancel>${t('common.cancel')}</button>
      <button class="btn btn-primary" data-modal-ok>${t('common.save')}</button>`;
    openModal();

    modal.footer.querySelector('[data-modal-cancel]').addEventListener('click', closeModal);
    modal.footer.querySelector('[data-modal-ok]').addEventListener('click', async () => {
      const sel = document.getElementById('c-type');
      const payload = {
        id: c.id,
        name: document.getElementById('c-name').value.trim(),
        phone: document.getElementById('c-phone').value.trim(),
        email: document.getElementById('c-email').value.trim(),
        type: sel.selectedOptions[0] ? sel.selectedOptions[0].text : '',
        notes: document.getElementById('c-notes').value.trim()
      };
      await API.saveClient(payload);
      closeModal();
      await refresh();
      toast(t('common.save'));
    });
  }

  /* ---------- ربط أحداث الصفوف ---------- */
  function bindDossierRowActions() {
    document.querySelectorAll('[data-dos-edit]').forEach((b) => {
      b.addEventListener('click', () => {
        const item = state.dossiers.find((d) => d.id === Number(b.getAttribute('data-dos-edit')));
        if (item) openDossierModal(item);
      });
    });
    document.querySelectorAll('[data-dos-del]').forEach((b) => {
      b.addEventListener('click', async () => {
        const id = Number(b.getAttribute('data-dos-del'));
        if (!confirm(t('dossiers.deleteConfirm'))) return;
        await API.deleteDossier(id);
        await refresh();
        toast(t('common.delete'));
      });
    });
  }

  function bindClientRowActions() {
    document.querySelectorAll('[data-cli-edit]').forEach((b) => {
      b.addEventListener('click', () => {
        const item = state.clients.find((c) => c.id === Number(b.getAttribute('data-cli-edit')));
        if (item) openClientModal(item);
      });
    });
    document.querySelectorAll('[data-cli-del]').forEach((b) => {
      b.addEventListener('click', async () => {
        const id = Number(b.getAttribute('data-cli-del'));
        if (!confirm(t('clients.deleteConfirm'))) return;
        await API.deleteClient(id);
        await refresh();
        toast(t('common.delete'));
      });
    });
  }

  /* ---------- أمان ---------- */
  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  const esc = escapeHtml;

  /* ---------- Sidebar ---------- */
  function openSidebar() {
    document.getElementById('sidebar').classList.add('open');
    let bd = document.querySelector('.sidebar-backdrop');
    if (!bd) {
      bd = document.createElement('div');
      bd.className = 'sidebar-backdrop';
      document.body.appendChild(bd);
    }
    bd.classList.add('show');
    bd.addEventListener('click', closeSidebar);
  }
  function closeSidebar() {
    document.getElementById('sidebar').classList.remove('open');
    const bd = document.querySelector('.sidebar-backdrop');
    if (bd) bd.classList.remove('show');
  }

  /* ---------- الإعدادات ---------- */
  async function loadOfficeSettings() {
    let o = {};
    try {
      const raw = localStorage.getItem('huissier-office');
      if (raw) o = Object.assign(o, JSON.parse(raw));
    } catch (e) {}
    try {
      const back = await API.settingsGetOffice();
      if (back) o = Object.assign(o, back);
    } catch (e) {}
    document.getElementById('office-name').value = o.name || '';
    document.getElementById('office-address').value = o.address || '';
    document.getElementById('office-phone').value = o.phone || '';
    document.getElementById('office-number').value = o.registration_number || o.number || '';
    if (document.getElementById('office-email')) document.getElementById('office-email').value = o.email || '';
    if (document.getElementById('office-ice')) document.getElementById('office-ice').value = o.ice || '';
  }

  function saveOfficeSettings(e) {
    e.preventDefault();
    const o = {
      name: document.getElementById('office-name').value.trim(),
      address: document.getElementById('office-address').value.trim(),
      phone: document.getElementById('office-phone').value.trim(),
      registration_number: document.getElementById('office-number').value.trim(),
      email: document.getElementById('office-email')?.value.trim() || '',
      ice: document.getElementById('office-ice')?.value.trim() || ''
    };
    try { localStorage.setItem('huissier-office', JSON.stringify(o)); } catch (e) {}
    API.settingsSaveOffice(o).catch(() => {});
    const st = document.getElementById('office-status');
    st.textContent = '✓ ' + t('settings.saved');
    setTimeout(() => { st.textContent = ''; }, 2500);
  }

  /* ---------- الأحداث (Event listeners) ---------- */
  function bindEvents() {
    document.getElementById('lang-toggle').addEventListener('click', () => {
      setLang(state.lang === 'ar' ? 'fr' : 'ar', false);
    });

    document.getElementById('theme-toggle').addEventListener('click', () => {
      setTheme(state.theme === 'light' ? 'dark' : 'light', false);
    });

    document.querySelectorAll('.nav-item').forEach((b) => {
      b.addEventListener('click', (e) => goTo(b.getAttribute('data-page'), e.detail === 0));
    });

    document.getElementById('sidebar-toggle').addEventListener('click', () => {
      if (window.innerWidth <= 768) openSidebar();
    });

    document.getElementById('modal-close').addEventListener('click', closeModal);
    modal.backdrop.addEventListener('click', (e) => {
      if (e.target === modal.backdrop) closeModal();
    });
    document.addEventListener('keydown', (e) => {
      const target = e.target;
      const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      const inForm = target && target.closest && target.closest('form');

      /* إغلاق النافذة المشتركة مع Escape */
      if (e.key === 'Escape' && topBackdrop() === modal.backdrop) { closeModal(); return; }

      /* حبس التبويب داخل النافذة المفتوحة (Focus Trap) */
      if (e.key === 'Tab') {
        const bd = topBackdrop();
        if (!bd) return;
        const items = focusablesIn(bd);
        if (!items.length) return;
        const first = items[0], last = items[items.length - 1];
        if (!bd.contains(target)) { e.preventDefault(); (e.shiftKey ? last : first).focus(); return; }
        if (e.shiftKey && target === first) { e.preventDefault(); last.focus(); return; }
        if (!e.shiftKey && target === last) { e.preventDefault(); first.focus(); return; }
        return;
      }

      /* Enter / Shift+Enter: القفز للخانة التالية / السابقة */
      const isField = target && (target.tagName === 'INPUT' || target.tagName === 'SELECT');
      if (e.key === 'Enter' && isField && !inForm && !e.ctrlKey && !e.altKey && !e.metaKey) {
        const skipType = target.type === 'checkbox' || target.type === 'radio' ||
          target.type === 'submit' || target.type === 'button' || target.type === 'file';
        if (!skipType) { e.preventDefault(); moveFieldFocus(e.shiftKey ? -1 : 1); return; }
      }

      /* التنقل بين أقسام الشريط الجانبي بالأسهم */
      if (target && target.classList && target.classList.contains('nav-item')) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          e.preventDefault();
          const items = Array.from(document.querySelectorAll('.nav-item'));
          const next = (e.key === 'ArrowDown' || e.key === 'ArrowRight') ? 1 : -1;
          items[(items.indexOf(target) + next + items.length) % items.length].focus();
          return;
        }
        if (e.key === 'Home' || e.key === 'End') {
          e.preventDefault();
          const items = Array.from(document.querySelectorAll('.nav-item'));
          items[e.key === 'Home' ? 0 : items.length - 1].focus();
          return;
        }
      }

      /* مفتاح "/": التركيز على بحث القسم الحالي */
      if (e.key === '/' && !typing && !topBackdrop()) {
        const id = NAV_SEARCH[state.currentPage];
        if (id) {
          const el = document.getElementById(id);
          if (el) { e.preventDefault(); el.focus(); }
        }
      }
    });

    // Dossiers page
    document.getElementById('dossier-add').addEventListener('click', () => openDossierModal(null));
    document.getElementById('dossier-search').addEventListener('input', (e) => {
      dossierFilter = e.target.value;
      renderDossiers();
    });
    document.getElementById('dossier-export').addEventListener('click', async () => {
      const res = await API.exportCsv('dossiers');
      if (res.ok) toast(t('common.save'));
    });

    // Clients page
    document.getElementById('client-add').addEventListener('click', () => openClientModal(null));
    document.getElementById('client-search').addEventListener('input', (e) => {
      clientFilter = e.target.value;
      renderClients();
    });
    document.getElementById('client-export').addEventListener('click', async () => {
      const res = await API.exportCsv('clients');
      if (res.ok) toast(t('common.save'));
    });

    // Quick actions
    document.getElementById('quick-dossier').addEventListener('click', () => { openDossierModal(null); });
    document.getElementById('quick-client').addEventListener('click', () => { openClientModal(null); });
    document.getElementById('quick-doc').addEventListener('click', () => goTo('documents'));

    // Settings
    document.getElementById('office-form').addEventListener('submit', saveOfficeSettings);
    document.querySelectorAll('.theme-option').forEach((o) => {
      o.addEventListener('click', () => setTheme(o.getAttribute('data-theme'), false));
    });

    // Security: change password + logout
    const pwForm = document.getElementById('password-form');
    if (pwForm) {
      pwForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const cur = document.getElementById('pw-current');
        const next = document.getElementById('pw-new');
        const st = document.getElementById('pw-status');
        st.textContent = '';
        if (!next.value || next.value.length < 6) {
          st.textContent = t('settings.passwordTooShort');
          st.style.color = 'var(--danger)';
          return;
        }
        try {
          await API.authChangePassword(cur.value, next.value);
          cur.value = '';
          next.value = '';
          st.textContent = t('settings.passwordChanged');
          st.style.color = 'var(--success)';
        } catch (err) {
          st.textContent = authErrorText(err);
          st.style.color = 'var(--danger)';
        }
      });
    }
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) logoutBtn.addEventListener('click', async () => {
      try { await API.authLogout(); } catch (e) {}
      location.reload();
    });

    // Users management (admin)
    const userForm = document.getElementById('user-form');
    if (userForm) {
      userForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const st = document.getElementById('user-form-status');
        st.textContent = '';
        try {
          await API.authUserCreate({
            username: document.getElementById('user-username').value.trim(),
            displayName: document.getElementById('user-displayname').value.trim(),
            role: document.getElementById('user-role').value,
            password: document.getElementById('user-password').value
          });
          document.getElementById('user-username').value = '';
          document.getElementById('user-displayname').value = '';
          document.getElementById('user-password').value = '';
          st.textContent = t('users.added');
          st.style.color = 'var(--success)';
          renderUsers();
        } catch (err) {
          st.textContent = authErrorText(err);
          st.style.color = 'var(--danger)';
        }
      });
    }
    const usersTbody = document.getElementById('users-tbody');
    if (usersTbody) {
      usersTbody.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-user-action]');
        if (!btn) return;
        const id = Number(btn.getAttribute('data-user-id'));
        const act = btn.getAttribute('data-user-action');
        if (act === 'toggle') {
          const row = usersTbody.querySelector(`[data-user-id="${id}"]`);
          API.authUserSetActive(id, !(btn.getAttribute('data-active') === '1'))
            .then(renderUsers)
            .catch((err) => toast(authErrorText(err), true));
        } else if (act === 'reset') {
          const np = prompt(t('users.resetPrompt'));
          if (np == null) return;
          API.authUserResetPassword(id, np)
            .then(() => toast(t('users.resetDone')))
            .catch((err) => toast(authErrorText(err), true));
        } else if (act === 'del') {
          if (!confirm(t('users.deleteConfirm'))) return;
          API.authUserDelete(id)
            .then(renderUsers)
            .catch((err) => toast(authErrorText(err), true));
        }
      });
    }

    // Menu export from main process
    API.onMenuExport((kind) => {
      API.exportCsv(kind);
    });
  }

  /* ---------- الأمان: تسجيل الدخول ---------- */
  function authErrorText(err) {
    const code = err && err.code ? String(err.code) : String((err && err.message) || err);
    if (code.startsWith('AUTH:WRONG_PASSWORD')) return t('auth.wrongPassword');
    if (code.startsWith('AUTH:USER_NOT_FOUND')) return t('auth.userNotFound');
    if (code.startsWith('AUTH:INACTIVE_USER')) return t('auth.inactive');
    if (code.startsWith('AUTH:PASSWORD_TOO_SHORT')) return t('settings.passwordTooShort');
    if (code.startsWith('AUTH:USERNAME_REQUIRED')) return t('users.usernameRequired');
    if (code.startsWith('AUTH:USERNAME_TAKEN')) return t('users.usernameTaken');
    if (code.startsWith('AUTH:INVALID_ROLE')) return t('users.invalidRole');
    if (code.startsWith('AUTH:CANNOT_SELF')) return t('users.cannotSelf');
    if (code.startsWith('AUTH:LAST_ADMIN')) return t('users.lastAdmin');
    if (code.startsWith('AUTH:ALREADY_SETUP')) return t('auth.alreadySetup');
    if (code.startsWith('AUTH:LOCKED')) return t('auth.locked').replace('{s}', code.split(':')[1] || '');
    if (code.startsWith('AUTH:LOGIN_REQUIRED')) return t('auth.notLoggedIn');
    if (code.startsWith('AUTH:UNAUTHORIZED:')) return t('common.error');
    return code;
  }

  function updateSecurityCard() {
    const el = document.getElementById('login-current-user');
    if (!el) return;
    const u = state.currentUser;
    el.textContent = (u && u.id)
      ? `${t('settings.loggedAs')} ${u.display_name || u.username} (${t('auth.role.' + (u.role || 'guest'))})`
      : t('auth.notLoggedIn');
    const usersCard = document.getElementById('users-card');
    if (usersCard) usersCard.style.display = (u && u.role === 'admin') ? '' : 'none';
  }

  /* ---------- إدارة المستخدمين (عرض الجدول) ---------- */
  async function renderUsers() {
    const tbody = document.getElementById('users-tbody');
    if (!tbody) return;
    try {
      const rows = await API.authUsers();
      const me = state.currentUser;
      tbody.innerHTML = rows.map((u) => `
        <tr>
          <td>${esc(u.username)}${u.id === me.id ? ' <i class="fas fa-user-check" title="' + t('users.you') + '"></i>' : ''}</td>
          <td>${esc(u.display_name || '—')}</td>
          <td><span class="badge">${esc(t('auth.role.' + (u.role || 'agent')))}</span></td>
          <td>${u.active ? t('users.active') : t('users.inactive')}</td>
          <td>
            ${u.id !== me.id ? `
              <button class="row-btn" data-user-action="toggle" data-user-id="${u.id}" data-active="${u.active ? 1 : 0}" title="${u.active ? t('users.disable') : t('users.enable')}"><i class="fas fa-toggle-${u.active ? 'off' : 'on'}"></i></button>
              <button class="row-btn" data-user-action="reset" data-user-id="${u.id}" title="${t('users.resetPassword')}"><i class="fas fa-key"></i></button>
              <button class="row-btn del" data-user-action="del" data-user-id="${u.id}" title="${t('common.delete')}"><i class="fas fa-trash"></i></button>
            ` : ''}
          </td>
        </tr>`).join('');
    } catch (e) {
      toast(authErrorText(e), true);
    }
  }

  /* ---------- الإقلاع ---------- */
  async function init() {
    let savedLang = null;
    try { savedLang = localStorage.getItem('huissier-lang'); } catch (e) {}
    state.lang = savedLang === 'fr' ? 'fr' : 'ar';

    let savedTheme = null;
    try { savedTheme = localStorage.getItem('huissier-theme'); } catch (e) {}
    setTheme(savedTheme === 'dark' ? 'dark' : 'light', false);

    await loadLocale(state.lang);
    bindEvents();

    let session = null;
    try { session = await API.authCurrent(); } catch (e) {}
    const sessUser = session && session.user ? session.user : null;
    const needsSetup = !!(session && session.needsSetup === true);
    state.currentUser = sessUser || { id: 0, username: '', display_name: '', role: 'guest' };
    if (!sessUser || !sessUser.id) {
      if (needsSetup) showSetup();
      else showLogin();
      return;
    }
    updateSecurityCard();
    bootApp();
  }

  /* ---------- شاشة الدخول ---------- */
  function showLogin() {
    const backdrop = document.getElementById('login-backdrop');
    backdrop.classList.add('show');
    const welcome = document.getElementById('login-welcome');
    if (welcome) welcome.textContent = t('auth.title');
    document.getElementById('login-error').textContent = '';
    document.getElementById('login-password').value = '';
    const usernameInput = document.getElementById('login-username');
    let savedUser = '';
    try { savedUser = localStorage.getItem('huissier-username') || ''; } catch (e) {}
    usernameInput.value = savedUser;
    usernameInput.readOnly = !!savedUser;
    document.getElementById(savedUser ? 'login-password' : 'login-username').focus();
    document.getElementById('login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const errEl = document.getElementById('login-error');
      const username = document.getElementById('login-username').value.trim();
      const password = document.getElementById('login-password').value;
      if (!username || !password) {
        errEl.textContent = t('auth.fillAll');
        return;
      }
      try {
        const user = await API.authLogin(username, password);
        state.currentUser = user;
        try { localStorage.setItem('huissier-username', username); } catch (e) {}
        backdrop.classList.remove('show');
        updateSecurityCard();
        bootApp();
      } catch (err) {
        errEl.textContent = authErrorText(err);
      }
    });
  }

  /* ---------- شاشة التسجيل الأول ---------- */
  function showSetup() {
    const backdrop = document.getElementById('login-backdrop');
    backdrop.classList.add('show');
    const welcome = document.getElementById('login-welcome');
    if (welcome) welcome.textContent = t('auth.createAccount');
    document.getElementById('login-form').style.display = 'none';
    const setupForm = document.getElementById('setup-form');
    setupForm.style.display = 'grid';
    document.getElementById('setup-error').textContent = '';
    document.getElementById('setup-password').value = '';
    document.getElementById('setup-password2').value = '';
    document.getElementById('setup-displayname').focus();
    setupForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const errEl = document.getElementById('setup-error');
      const username = document.getElementById('setup-username').value.trim();
      const displayName = document.getElementById('setup-displayname').value.trim();
      const password = document.getElementById('setup-password').value;
      const password2 = document.getElementById('setup-password2').value;
      if (!username) {
        errEl.textContent = t('users.usernameRequired');
        return;
      }
      if (password.length < 6) {
        errEl.textContent = t('settings.passwordTooShort');
        return;
      }
      if (password !== password2) {
        errEl.textContent = t('auth.passwordsDontMatch');
        return;
      }
      try {
        const user = await API.authSetupInitial(username, displayName, password);
        state.currentUser = user;
        try { localStorage.setItem('huissier-username', username); } catch (e) {}
        backdrop.classList.remove('show');
        location.reload();
      } catch (err) {
        errEl.textContent = authErrorText(err);
      }
    });
  }

  async function bootApp() {
    await refresh();
    await loadOfficeSettings();
    if (window.ProceduresModule && window.ProceduresModule.init) await window.ProceduresModule.init();
    if (window.TemplatesModule && window.TemplatesModule.init) await window.TemplatesModule.init();
    if (window.PvsModule && window.PvsModule.init) await window.PvsModule.init();
    if (window.FinanceModule && window.FinanceModule.init) await window.FinanceModule.init();
    if (window.RegistersModule && window.RegistersModule.init) await window.RegistersModule.init();
    if (window.ArchiveModule && window.ArchiveModule.init) await window.ArchiveModule.init();
    if (window.SettingsModule && window.SettingsModule.init) await window.SettingsModule.init();
    updateSecurityCard();
    renderUsers();
    goTo('dashboard');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
