/* ================================================================
   وحدة الأرشيف — ArchiveModule
   صفحة "الأرشيف": كل وثائق التطبيق (محاضر، وصولات، مستندات، أرشيف سجلات)
   بنية منظمة + بصمات SHA-256 + حالات (نشط/مؤرشف/مختوم) + فتح/تحميل/حذف.
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

  const BK_ERRORS = {
    'BACKUP:INVALID_NO_SQLITE': ['النسخة الاحتياطية لا تحتوي على قاعدة بيانات', 'La sauvegarde ne contient pas de base de données'],
    'BACKUP:INVALID_APP': ['هذه النسخة ليست من هذا التطبيق', 'Cette sauvegarde ne provient pas de cette application'],
    'BACKUP:INVALID_FORMAT': ['صيغة النسخة غير مدعومة', 'Format de sauvegarde non pris en charge'],
    'BACKUP:NOT_FOUND': ['ملف النسخة غير موجود', 'Fichier de sauvegarde introuvable'],
    'BACKUP:NO_DB': ['قاعدة البيانات غير متاحة', 'Base de données indisponible'],
    'ARCHIVE:NOT_INITIALIZED': ['مجلد الأرشيف غير مهيأ — حدده من الإعدادات', "Le dossier d'archives n'est pas configuré dans les réglages"],
    'ARCHIVE:OPEN_FAILED': ['تعذّر فتح مجلد الأرشيف في المستكشف', "Impossible d'ouvrir le dossier d'archives dans l'explorateur"],
    'DOC:SEALED:NO_DELETE': ['وثيقة مختومة — لا يمكن حذفها', 'Document scellé — suppression impossible']
  };
  function errTxt(e) {
    const msg = e && e.message ? e.message : String(e || '');
    const p = BK_ERRORS[msg];
    if (p) return l(p[0], p[1]);
    if (msg.indexOf('AUTH:UNAUTHORIZED:') === 0) return l('ليست لديك الصلاحية لهذا الإجراء', 'Action non autorisée');
    return msg;
  }

  let bound = false;
  let isAdmin = false;
  let isBackupAdmin = false;
  let rows = [];
  let limit = 50;

  const filters = { kind: '', status: '', q: '' };

  const KIND_LABELS = {
    pv: ['محضر', 'PV'], receipt: ['وصل', 'Reçu'], document: ['مستند', 'Document'],
    'register-archive': ['أرشيف سجل', 'Archive registre'],
    dossier: ['ملف قضائي', 'Dossier'], procedure: ['إجراء قضائي', 'Procédure'],
    other: ['أخرى', 'Autre']
  };
  const KIND_COLORS = { pv: 'info', receipt: 'success', document: 'primary', 'register-archive': 'warning', dossier: 'danger', procedure: 'primary', other: 'gray' };
  const STATUS_LABELS = { active: ['نشط', 'Actif'], archived: ['مؤرشف', 'Archivé'], sealed: ['مختوم', 'Scellé'] };
  const STATUS_COLORS = { active: 'success', archived: 'info', sealed: 'danger' };

  function isReference(d) {
    return d.kind === 'dossier' || d.kind === 'procedure';
  }

  /* ---------- أدوات ---------- */
  function kindBadge(kind) {
    const k = KIND_LABELS[kind] ? kind : 'other';
    return `<span class="badge st-${KIND_COLORS[k]}">${esc(l(KIND_LABELS[k][0], KIND_LABELS[k][1]))}</span>`;
  }

  function statusBadge(status) {
    const pair = STATUS_LABELS[status];
    return pair ? `<span class="badge st-${STATUS_COLORS[status]}">${esc(l(pair[0], pair[1]))}</span>` : esc(status || '—');
  }

  function fmtBytes(n) {
    const v = Number(n || 0);
    if (v < 1024) return v + ' B';
    if (v < 1024 * 1024) return (v / 1024).toFixed(1) + ' KB';
    return (v / (1024 * 1024)).toFixed(2) + ' MB';
  }

  function refOf(d) {
    if (d.procedure_number) return `<strong>${esc(d.procedure_number)}</strong>`;
    if (d.entity_type === 'template') return esc('#' + d.entity_id);
    return esc(`${d.entity_type || ''}#${d.entity_id || 0}`);
  }

  /* ---------- البطاقات ---------- */
  function renderCards(s) {
    const cards = [
      { icon: 'fa-file', accent: 'info', v: s.total, k: l('العناصر', 'Éléments') },
      { icon: 'fa-database', accent: 'primary', v: fmtBytes(s.bytes), k: l('الحجم الإجمالي', 'Taille totale') },
      { icon: 'fa-lock', accent: 'danger', v: s.sealed, k: l('مختومة', 'Scellées') }
    ];
    const top = (s.byKind || []).slice(0, 5);
    top.forEach((k) => {
      const pair = KIND_LABELS[k.kind];
      if (pair) cards.push({ icon: k.kind === 'dossier' ? 'fa-folder' : k.kind === 'procedure' ? 'fa-scale-balanced' : 'fa-box', accent: KIND_COLORS[k.kind] || 'warning', v: k.c, k: l(pair[0], pair[1]) });
    });
    byId('arch-cards').innerHTML = cards.map((c) => `
      <div class="stat-card" data-accent="${c.accent}">
        <div class="stat-icon"><i class="fas ${c.icon}"></i></div>
        <div class="stat-info"><span class="stat-value">${esc(c.v)}</span><span class="stat-label">${esc(c.k)}</span></div>
      </div>`).join('');
  }

  /* ---------- القائمة ---------- */
  function renderTable() {
    byId('arch-thead').innerHTML = `<tr>${[
      l('النوع', 'Type'), l('العنوان', 'Titre'), l('المرجع', 'Réf.'), l('التاريخ', 'Date'),
      l('الحجم', 'Taille'), l('الحالة', 'Statut'), l('المستخدم', 'Utilisateur'), l('البصمة', 'SHA-256'), ''
    ].map((h) => `<th>${h}</th>`).join('')}</tr>`;

    byId('arch-empty').classList.toggle('hidden', rows.length > 0);
    byId('arch-tbody').innerHTML = rows.map((d) => {
      const ref = isReference(d);
      return `<tr>
        <td>${kindBadge(d.kind)}</td>
        <td><strong>${esc(d.title)}</strong></td>
        <td>${refOf(d)}</td>
        <td nowrap>${esc(fmtDate(d.created_at))}</td>
        <td nowrap>${ref ? '—' : esc(fmtBytes(d.size_bytes))}</td>
        <td>${statusBadge(d.status)}</td>
        <td>${esc(d.created_by || '—')}</td>
        <td>${ref ? '—' : `<span class="muted-cell" title="${esc(d.sha256 || '')}">${esc(String(d.sha256 || '').slice(0, 10) + '…')}</span>`}</td>
        <td><div class="row-actions">
          ${ref
            ? `<button class="row-btn" data-arch-nav="${d.entity_type}:${d.entity_id}" title="${l('فتح', 'Ouvrir')}"><i class="fas fa-arrow-up-right-from-square"></i></button>`
            : `<button class="row-btn" data-arch-open="${d.id}" title="${l('فتح', 'Ouvrir')}"><i class="fas fa-eye"></i></button>
               <button class="row-btn" data-arch-dl="${d.id}" title="${l('تحميل', 'Télécharger')}"><i class="fas fa-download"></i></button>`}
          ${d.status !== 'sealed' && isAdmin ? `<button class="row-btn del" data-arch-del="${d.id}" title="${l('حذف', 'Supprimer')}"><i class="fas fa-trash"></i></button>` : ''}
        </div></td>
      </tr>`;
    }).join('');

    const more = rows.length >= limit;
    byId('arch-footer').innerHTML = `
      <span class="page-ind">${rows.length} ${l('عنصر', 'éléments')}</span>
      ${more ? `<button class="btn btn-ghost btn-sm" id="arch-more"><i class="fas fa-angles-down"></i> ${l('تحميل المزيد', 'Charger plus')}</button>` : ''}`;
    const moreBtn = byId('arch-more');
    if (moreBtn) moreBtn.addEventListener('click', loadMore);
  }

  /* ---------- الجلب ---------- */
  async function loadList() {
    try {
      const res = await API.archiveList({
        kind: filters.kind, status: filters.status, q: filters.q, limit
      });
      rows = res || [];
      renderTable();
    } catch (e) { toast(errTxt(e), true); }
  }

  async function loadMore() {
    limit += 50;
    await loadList();
  }

  async function loadStats() {
    try {
      const s = await API.archiveStats();
      renderCards(s || {});
    } catch (e) { toast(errTxt(e), true); }
  }

  /* ---------- الأحداث ---------- */
  function bindEvents() {
    if (bound) return;
    bound = true;

    byId('arch-filter-kind').addEventListener('change', (e) => { filters.kind = e.target.value; limit = 50; loadList(); });
    byId('arch-filter-status').addEventListener('change', (e) => { filters.status = e.target.value; limit = 50; loadList(); });
    byId('arch-search').addEventListener('input', debounce((e) => { filters.q = e.target.value.trim(); limit = 50; loadList(); }, 350));
    byId('arch-search-clear').addEventListener('click', () => {
      byId('arch-search').value = ''; filters.q = ''; limit = 50; loadList();
    });
    byId('arch-open-dir').addEventListener('click', async () => {
      try { await API.archiveOpenDir(); } catch (e) { toast(errTxt(e), true); }
    });

    byId('arch-backup').addEventListener('click', async () => {
      try {
        const r = await API.archiveBackup();
        if (r && r.canceled) return;
        if (r && r.ok) toast(l('أُنشئت النسخة الاحتياطية: ' + r.path + ' (' + fmtBytes(r.bytes) + ')', 'Sauvegarde créée : ' + r.path + ' (' + fmtBytes(r.bytes) + ')'));
      } catch (e) { toast(errTxt(e), true); }
    });

    byId('arch-restore').addEventListener('click', async () => {
      if (!confirm(l('استعادة نسخة احتياطية ستحل محل قاعدة البيانات والأرشيف الحاليين نهائياً. متابعة؟', 'Restaurer remplacera définitivement la base de données et les archives actuelles. Continuer ?'))) return;
      if (!confirm(l('تأكيد نهائي؟ سيُعاد تشغيل التطبيق تلقائياً بعد الاستعادة.', 'Confirmation finale ? L\'application redémarrera automatiquement.'))) return;
      try {
        const r = await API.archiveRestore();
        if (r && r.canceled) return;
        toast(l('تمت الاستعادة (' + r.docs + ' وثيقة) — إعادة تشغيل...', 'Restauration effectuée (' + r.docs + ' documents) — redémarrage...'));
      } catch (e) { toast(errTxt(e), true); }
    });

    byId('arch-tbody').addEventListener('click', async (e) => {
      const navBtn = e.target.closest('[data-arch-nav]');
      const openBtn = e.target.closest('[data-arch-open]');
      const dlBtn = e.target.closest('[data-arch-dl]');
      const delBtn = e.target.closest('[data-arch-del]');
      if (navBtn) {
        const [type, id] = navBtn.getAttribute('data-arch-nav').split(':');
        if (type === 'procedure') { goTo('procedures'); setTimeout(() => { if (window.ProceduresModule && window.ProceduresModule.openDetail) window.ProceduresModule.openDetail(Number(id)); }, 100); }
        else if (type === 'dossier') { goTo('dossiers'); }
      } else if (openBtn) {
        try { await API.docOpen(Number(openBtn.getAttribute('data-arch-open'))); } catch (err) { toast(errTxt(err), true); }
      } else if (dlBtn) {
        try {
          const r = await API.docDownload(Number(dlBtn.getAttribute('data-arch-dl')));
          if (r && r.ok) toast(l('تم التحميل', 'Téléchargé'));
        } catch (err) { toast(errTxt(err), true); }
      } else if (delBtn) {
        const id = Number(delBtn.getAttribute('data-arch-del'));
        if (!confirm(l('حذف هذه الوثيقة من الأرشيف نهائياً؟', 'Supprimer définitivement ce document ?'))) return;
        try {
          await API.docDelete(id);
          toast(l('تم الحذف', 'Supprimé'));
          loadList(); loadStats();
        } catch (err) { toast(errTxt(err), true); }
      }
    });
  }

  function debounce(fn, ms) {
    let timer = null;
    return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
  }

  /* ---------- API الوحدة ---------- */
  function render() {
    bindEvents();
    loadStats();
    loadList();
  }

  async function init() {
    try { isAdmin = await API.authIsAuthorized('document.delete'); } catch (e) { isAdmin = false; }
    try {
      isBackupAdmin = await API.authIsAuthorized('backup.manage');
      byId('arch-backup-actions').hidden = !isBackupAdmin;
    } catch (e) { byId('arch-backup-actions').hidden = true; }
    render();
  }

  window.ArchiveModule = { init, render };
})();