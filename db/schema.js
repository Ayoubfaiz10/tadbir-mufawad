'use strict';

/* ================================================================
   Schema قاعدة البيانات — SQLite (عبر sql.js)
   Migrations خطية بترتيب إضافة.
   ================================================================ */

const VERSION = 8;

const MIGRATIONS = [
  {
    version: 1,
    up: `
      PRAGMA foreign_keys = ON;

      -- ---------- إعدادات عامة ----------
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT
      );

      -- ---------- فئات الإجراءات (JUDICIAL / DIRECT) ----------
      CREATE TABLE IF NOT EXISTS procedure_categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT UNIQUE NOT NULL,
        name_ar TEXT NOT NULL,
        name_fr TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        sort_order INTEGER NOT NULL DEFAULT 0
      );

      -- ---------- أنظمة الحالة (قابلة للتهيئة) ----------
      CREATE TABLE IF NOT EXISTS procedure_statuses (
        code TEXT PRIMARY KEY,
        name_ar TEXT NOT NULL,
        name_fr TEXT NOT NULL,
        color TEXT NOT NULL DEFAULT 'gray',
        active INTEGER NOT NULL DEFAULT 1,
        sort_order INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS procedure_status_transitions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        from_status TEXT NOT NULL,
        to_status TEXT NOT NULL,
        UNIQUE (from_status, to_status)
      );

      -- ---------- أنواع الإجراءات (قابلة للتهيئة) ----------
      CREATE TABLE IF NOT EXISTS procedure_types (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category_id INTEGER NOT NULL REFERENCES procedure_categories(id) ON DELETE CASCADE,
        code TEXT UNIQUE NOT NULL,
        name_ar TEXT NOT NULL,
        name_fr TEXT NOT NULL,
        description_ar TEXT NOT NULL DEFAULT '',
        description_fr TEXT NOT NULL DEFAULT '',
        active INTEGER NOT NULL DEFAULT 1,
        sort_order INTEGER NOT NULL DEFAULT 0
      );

      -- ---------- حقول النوع (Dynamic Form Schema) ----------
      CREATE TABLE IF NOT EXISTS procedure_fields (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        procedure_type_id INTEGER NOT NULL REFERENCES procedure_types(id) ON DELETE CASCADE,
        field_key TEXT NOT NULL,
        label_ar TEXT NOT NULL,
        label_fr TEXT NOT NULL,
        field_type TEXT NOT NULL DEFAULT 'text',
        required INTEGER NOT NULL DEFAULT 0,
        sort_order INTEGER NOT NULL DEFAULT 0,
        options TEXT NOT NULL DEFAULT '',
        UNIQUE (procedure_type_id, field_key)
      );

      -- ---------- قوالب المحاضر ----------
      CREATE TABLE IF NOT EXISTS pv_templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT UNIQUE NOT NULL,
        title_ar TEXT NOT NULL,
        title_fr TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        sort_order INTEGER NOT NULL DEFAULT 0
      );

      -- ---------- المستخدمون ----------
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        display_name TEXT NOT NULL DEFAULT '',
        role TEXT NOT NULL DEFAULT 'agent',
        active INTEGER NOT NULL DEFAULT 1
      );

      -- ---------- الملفات القضائية (Dossiers) ----------
      CREATE TABLE IF NOT EXISTS dossiers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        numero TEXT NOT NULL,
        demandeur TEXT NOT NULL DEFAULT '',
        defendeur TEXT NOT NULL DEFAULT '',
        court TEXT NOT NULL DEFAULT '',
        type TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'open',
        date TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_dossiers_numero ON dossiers(numero);

      -- ---------- العملاء ----------
      CREATE TABLE IF NOT EXISTS clients (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        phone TEXT NOT NULL DEFAULT '',
        email TEXT NOT NULL DEFAULT '',
        type TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- ---------- الأطراف ----------
      CREATE TABLE IF NOT EXISTS parties (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        dossier_id INTEGER NOT NULL REFERENCES dossiers(id) ON DELETE CASCADE,
        role TEXT NOT NULL DEFAULT '',
        name TEXT NOT NULL,
        cin TEXT NOT NULL DEFAULT '',
        address TEXT NOT NULL DEFAULT '',
        phone TEXT NOT NULL DEFAULT '',
        email TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_parties_dossier ON parties(dossier_id);
      CREATE INDEX IF NOT EXISTS idx_parties_cin ON parties(cin);
      CREATE INDEX IF NOT EXISTS idx_parties_name ON parties(name);

      -- ---------- الإجراءات (المحور الأساسي) ----------
      CREATE TABLE IF NOT EXISTS procedures (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        procedure_number TEXT UNIQUE NOT NULL,
        dossier_id INTEGER REFERENCES dossiers(id) ON DELETE SET NULL,
        category_id INTEGER NOT NULL REFERENCES procedure_categories(id),
        procedure_type_id INTEGER NOT NULL REFERENCES procedure_types(id),
        status TEXT NOT NULL DEFAULT 'NEW' REFERENCES procedure_statuses(code),
        requested_by TEXT NOT NULL DEFAULT '',
        amount REAL NOT NULL DEFAULT 0,
        currency TEXT NOT NULL DEFAULT 'MAD',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        started_at TEXT,
        completed_at TEXT,
        created_by TEXT NOT NULL DEFAULT 'system',
        assigned_to TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT ''
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_procedures_number ON procedures(procedure_number);
      CREATE INDEX IF NOT EXISTS idx_procedures_dossier ON procedures(dossier_id);
      CREATE INDEX IF NOT EXISTS idx_procedures_type ON procedures(procedure_type_id);
      CREATE INDEX IF NOT EXISTS idx_procedures_status ON procedures(status);
      CREATE INDEX IF NOT EXISTS idx_procedures_assigned ON procedures(assigned_to);
      CREATE INDEX IF NOT EXISTS idx_procedures_created ON procedures(created_at);

      -- ---------- ربط الإجراء بالأطراف ----------
      CREATE TABLE IF NOT EXISTS procedure_parties (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        procedure_id INTEGER NOT NULL REFERENCES procedures(id) ON DELETE CASCADE,
        party_id INTEGER NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
        role TEXT NOT NULL DEFAULT '',
        UNIQUE (procedure_id, party_id, role)
      );
      CREATE INDEX IF NOT EXISTS idx_proc_parties_proc ON procedure_parties(procedure_id);

      -- ---------- قيم الحقول الديناميكية ----------
      CREATE TABLE IF NOT EXISTS procedure_field_values (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        procedure_id INTEGER NOT NULL REFERENCES procedures(id) ON DELETE CASCADE,
        field_id INTEGER NOT NULL REFERENCES procedure_fields(id) ON DELETE CASCADE,
        value TEXT NOT NULL DEFAULT '',
        UNIQUE (procedure_id, field_id)
      );
      CREATE INDEX IF NOT EXISTS idx_pfv_proc ON procedure_field_values(procedure_id);

      -- ---------- سجل تغييرات الحالة ----------
      CREATE TABLE IF NOT EXISTS procedure_status_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        procedure_id INTEGER NOT NULL REFERENCES procedures(id) ON DELETE CASCADE,
        from_status TEXT NOT NULL DEFAULT '',
        to_status TEXT NOT NULL,
        by_user TEXT NOT NULL DEFAULT 'system',
        note TEXT NOT NULL DEFAULT '',
        changed_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_psh_proc ON procedure_status_history(procedure_id);

      -- ---------- الأداءات ----------
      CREATE TABLE IF NOT EXISTS payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        procedure_id INTEGER NOT NULL REFERENCES procedures(id) ON DELETE CASCADE,
        amount REAL NOT NULL,
        method TEXT NOT NULL DEFAULT '',
        payment_date TEXT NOT NULL DEFAULT (datetime('now')),
        status TEXT NOT NULL DEFAULT 'pending',
        reference TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_payments_proc ON payments(procedure_id);

      -- ---------- الوصولات ----------
      CREATE TABLE IF NOT EXISTS receipts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        payment_id INTEGER NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
        receipt_number TEXT UNIQUE NOT NULL,
        generated_at TEXT NOT NULL DEFAULT (datetime('now')),
        file_path TEXT NOT NULL DEFAULT '',
        document_id INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_receipts_payment ON receipts(payment_id);

      -- ---------- الوثائق / الأرشيف ----------
      CREATE TABLE documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entity_type TEXT NOT NULL DEFAULT 'procedure',
        entity_id INTEGER NOT NULL,
        kind TEXT NOT NULL DEFAULT 'document',
        title TEXT NOT NULL,
        file_name TEXT NOT NULL DEFAULT '',
        file_path TEXT NOT NULL DEFAULT '',
        mime TEXT NOT NULL DEFAULT '',
        archived INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        created_by TEXT NOT NULL DEFAULT 'system'
      );
      CREATE INDEX IF NOT EXISTS idx_documents_entity ON documents(entity_type, entity_id);
      CREATE INDEX IF NOT EXISTS idx_documents_kind ON documents(kind);

      -- ---------- ربط الوثائق بالإجراء ----------
      CREATE TABLE IF NOT EXISTS procedure_documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        procedure_id INTEGER NOT NULL REFERENCES procedures(id) ON DELETE CASCADE,
        document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        UNIQUE (procedure_id, document_id)
      );
      CREATE INDEX IF NOT EXISTS idx_procdoc_proc ON procedure_documents(procedure_id);

      -- ---------- سجل التدقيق ----------
      CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        action TEXT NOT NULL,
        entity TEXT NOT NULL,
        entity_id INTEGER NOT NULL DEFAULT 0,
        by_user TEXT NOT NULL DEFAULT 'system',
        metadata TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity, entity_id);
      CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
    `
  },
  {
    version: 2,
    up: `
      -- ---------- تصنيفات قوالب الوثائق (قابلة للتعديل من الإعدادات) ----------
      CREATE TABLE IF NOT EXISTS template_categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT UNIQUE NOT NULL,
        name_ar TEXT NOT NULL,
        name_fr TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        active INTEGER NOT NULL DEFAULT 1
      );

      -- ---------- النماذج (الكيان المنطقي) ----------
      CREATE TABLE IF NOT EXISTS document_templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        category_id INTEGER REFERENCES template_categories(id) ON DELETE SET NULL,
        procedure_type_id INTEGER REFERENCES procedure_types(id) ON DELETE SET NULL,
        language TEXT NOT NULL DEFAULT 'ar',
        description TEXT NOT NULL DEFAULT '',
        active INTEGER NOT NULL DEFAULT 1,
        archived INTEGER NOT NULL DEFAULT 0,
        current_version_id INTEGER NOT NULL DEFAULT 0,
        created_by TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_dt_category ON document_templates(category_id);
      CREATE INDEX IF NOT EXISTS idx_dt_type ON document_templates(procedure_type_id);
      CREATE INDEX IF NOT EXISTS idx_dt_active ON document_templates(active);

      -- ---------- إصدارات النموذج (كل تعديل = نسخة جديدة) ----------
      CREATE TABLE IF NOT EXISTS template_versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        template_id INTEGER NOT NULL REFERENCES document_templates(id) ON DELETE CASCADE,
        version TEXT NOT NULL,
        content TEXT NOT NULL DEFAULT '',
        variables TEXT NOT NULL DEFAULT '[]',
        note TEXT NOT NULL DEFAULT '',
        created_by TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_tv_template ON template_versions(template_id);

      -- كل وثيقة تولَّد من نموذج تتذكر النسخة المستعملة
      ALTER TABLE documents ADD COLUMN template_version_id INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE documents ADD COLUMN template_id INTEGER NOT NULL DEFAULT 0;
    `
  },
  {
    version: 3,
    up: `
      -- ---------- أنواع المحاضر (قابلة للتهيئة) ----------
      CREATE TABLE IF NOT EXISTS pv_types (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT UNIQUE NOT NULL,
        name_ar TEXT NOT NULL,
        name_fr TEXT NOT NULL,
        description_ar TEXT NOT NULL DEFAULT '',
        description_fr TEXT NOT NULL DEFAULT '',
        active INTEGER NOT NULL DEFAULT 1,
        sort_order INTEGER NOT NULL DEFAULT 0
      );

      -- ---------- حالات المحضر (قابلة للتهيئة) ----------
      CREATE TABLE IF NOT EXISTS pv_statuses (
        code TEXT PRIMARY KEY,
        name_ar TEXT NOT NULL,
        name_fr TEXT NOT NULL,
        color TEXT NOT NULL DEFAULT 'gray',
        active INTEGER NOT NULL DEFAULT 1,
        sort_order INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS pv_status_transitions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        from_status TEXT NOT NULL,
        to_status TEXT NOT NULL,
        UNIQUE (from_status, to_status)
      );

      -- ---------- المحاضر (الكيان الأساسي) ----------
      CREATE TABLE IF NOT EXISTS pvs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pv_number TEXT UNIQUE NOT NULL,
        procedure_id INTEGER NOT NULL REFERENCES procedures(id) ON DELETE CASCADE,
        dossier_id INTEGER REFERENCES dossiers(id) ON DELETE SET NULL,
        pv_type_id INTEGER REFERENCES pv_types(id) ON DELETE SET NULL,
        template_id INTEGER NOT NULL DEFAULT 0,
        template_version_id INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'DRAFT' REFERENCES pv_statuses(code),
        title TEXT NOT NULL DEFAULT '',
        language TEXT NOT NULL DEFAULT 'ar',
        content TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        created_by TEXT NOT NULL DEFAULT 'system',
        finalized_at TEXT,
        finalized_by TEXT NOT NULL DEFAULT '',
        archived_at TEXT,
        archived_by TEXT NOT NULL DEFAULT '',
        cancelled_at TEXT,
        cancelled_by TEXT NOT NULL DEFAULT ''
      );
      CREATE INDEX IF NOT EXISTS idx_pvs_procedure ON pvs(procedure_id);
      CREATE INDEX IF NOT EXISTS idx_pvs_dossier ON pvs(dossier_id);
      CREATE INDEX IF NOT EXISTS idx_pvs_type ON pvs(pv_type_id);
      CREATE INDEX IF NOT EXISTS idx_pvs_status ON pvs(status);
      CREATE INDEX IF NOT EXISTS idx_pvs_created ON pvs(created_at);

      -- ---------- إصدارات المحضر (كل حفظ = نسخة جديدة) ----------
      CREATE TABLE IF NOT EXISTS pv_versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pv_id INTEGER NOT NULL REFERENCES pvs(id) ON DELETE CASCADE,
        version INTEGER NOT NULL,
        content TEXT NOT NULL DEFAULT '',
        variables TEXT NOT NULL DEFAULT '[]',
        note TEXT NOT NULL DEFAULT '',
        created_by TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_pvv_pv ON pv_versions(pv_id);

      -- ---------- نظائر المحضر (النسخ) ----------
      CREATE TABLE IF NOT EXISTS pv_copies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pv_id INTEGER NOT NULL REFERENCES pvs(id) ON DELETE CASCADE,
        copy_number INTEGER NOT NULL,
        destination TEXT NOT NULL DEFAULT '',
        label_ar TEXT NOT NULL DEFAULT '',
        label_fr TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'generated',
        delivered_at TEXT,
        delivered_by TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        document_id INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (pv_id, copy_number)
      );
      CREATE INDEX IF NOT EXISTS idx_pvc_pv ON pv_copies(pv_id);

      -- ---------- سجل تغييرات الحالة ----------
      CREATE TABLE IF NOT EXISTS pv_status_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pv_id INTEGER NOT NULL REFERENCES pvs(id) ON DELETE CASCADE,
        from_status TEXT NOT NULL DEFAULT '',
        to_status TEXT NOT NULL,
        by_user TEXT NOT NULL DEFAULT 'system',
        note TEXT NOT NULL DEFAULT '',
        changed_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_pvsh_pv ON pv_status_history(pv_id);

      -- ---------- ربط المحضر بالوثائق ----------
      CREATE TABLE IF NOT EXISTS pv_documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pv_id INTEGER NOT NULL REFERENCES pvs(id) ON DELETE CASCADE,
        document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        UNIQUE (pv_id, document_id)
      );
      CREATE INDEX IF NOT EXISTS idx_pvd_pv ON pv_documents(pv_id);
      CREATE INDEX IF NOT EXISTS idx_pvd_doc ON pv_documents(document_id);

      -- ---------- سجل تدقيق المحضر ----------
      CREATE TABLE IF NOT EXISTS pv_audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pv_id INTEGER NOT NULL REFERENCES pvs(id) ON DELETE CASCADE,
        action TEXT NOT NULL,
        by_user TEXT NOT NULL DEFAULT 'system',
        metadata TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_pval_pv ON pv_audit_logs(pv_id);
      CREATE INDEX IF NOT EXISTS idx_pval_created ON pv_audit_logs(created_at);
    `
  },
  {
    version: 4,
    up: `
      -- ================================================================
      -- وحدة الأداءات والحسابات (Payments & Fees) — Migration v4
      -- المبالغ لا تُفترَض في الكود: جدول تعريفة قابل للتهيئة فقط.
      -- ================================================================

      -- ---------- طرق الدفع (قابلة للتهيئة من الإعدادات) ----------
      CREATE TABLE IF NOT EXISTS payment_methods (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT UNIQUE NOT NULL,
        name_ar TEXT NOT NULL,
        name_fr TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        sort_order INTEGER NOT NULL DEFAULT 0
      );

      -- ---------- التعريفات/الرسوم (Tariff Table — لا أتعاب مكتوبة) ----------
      CREATE TABLE IF NOT EXISTS fee_tariffs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT UNIQUE NOT NULL,
        name_ar TEXT NOT NULL,
        name_fr TEXT NOT NULL,
        description_ar TEXT NOT NULL DEFAULT '',
        description_fr TEXT NOT NULL DEFAULT '',
        default_amount REAL NOT NULL DEFAULT 0,
        currency TEXT NOT NULL DEFAULT 'MAD',
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        valid_from TEXT,
        valid_to TEXT,
        active INTEGER NOT NULL DEFAULT 1,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_ft_status ON fee_tariffs(status);
      CREATE INDEX IF NOT EXISTS idx_ft_active ON fee_tariffs(active);

      -- ---------- قواعد التعريفة (ربط التعريفات بأنواع الإجراءات) ----------
      CREATE TABLE IF NOT EXISTS fee_rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tariff_id INTEGER NOT NULL REFERENCES fee_tariffs(id) ON DELETE CASCADE,
        procedure_type_id INTEGER REFERENCES procedure_types(id) ON DELETE SET NULL,
        override_amount REAL,
        active INTEGER NOT NULL DEFAULT 1,
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (tariff_id, procedure_type_id)
      );
      CREATE INDEX IF NOT EXISTS idx_fr_tariff ON fee_rules(tariff_id);
      CREATE INDEX IF NOT EXISTS idx_fr_type ON fee_rules(procedure_type_id);

      -- ---------- تقييم الأتعاب (Assessment — يدوي مع اقتراح تلقائي) ----------
      CREATE TABLE IF NOT EXISTS fee_assessments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        procedure_id INTEGER NOT NULL REFERENCES procedures(id) ON DELETE CASCADE,
        total_amount REAL NOT NULL DEFAULT 0,
        currency TEXT NOT NULL DEFAULT 'MAD',
        status TEXT NOT NULL DEFAULT 'DRAFT',
        notes TEXT NOT NULL DEFAULT '',
        assessed_by TEXT NOT NULL DEFAULT 'system',
        assessed_at TEXT,
        confirmed_by TEXT NOT NULL DEFAULT '',
        confirmed_at TEXT,
        created_by TEXT NOT NULL DEFAULT 'system',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_fa_proc ON fee_assessments(procedure_id);
      CREATE INDEX IF NOT EXISTS idx_fa_status ON fee_assessments(status);

      -- ---------- بنود التقييم (فقرات التعريفة داخل تقييم) ----------
      CREATE TABLE IF NOT EXISTS fee_assessment_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        assessment_id INTEGER NOT NULL REFERENCES fee_assessments(id) ON DELETE CASCADE,
        tariff_id INTEGER REFERENCES fee_tariffs(id) ON DELETE SET NULL,
        description_ar TEXT NOT NULL DEFAULT '',
        description_fr TEXT NOT NULL DEFAULT '',
        amount REAL NOT NULL DEFAULT 0,
        quantity INTEGER NOT NULL DEFAULT 1,
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_fai_assess ON fee_assessment_items(assessment_id);

      -- ---------- توسعة جدول الأداءات ----------
      ALTER TABLE payments ADD COLUMN assessment_id INTEGER DEFAULT 0;
      ALTER TABLE payments ADD COLUMN payment_method_id INTEGER DEFAULT 0;
      ALTER TABLE payments ADD COLUMN confirmed_at TEXT;
      ALTER TABLE payments ADD COLUMN confirmed_by TEXT NOT NULL DEFAULT '';
      ALTER TABLE payments ADD COLUMN overpay_amount REAL DEFAULT 0;

      -- ---------- معاملات الدفع (سجل تفصيلي لكل دفعة/جزء/استرداد) ----------
      CREATE TABLE IF NOT EXISTS payment_transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        payment_id INTEGER NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
        amount REAL NOT NULL,
        type TEXT NOT NULL DEFAULT 'initial',
        transaction_date TEXT NOT NULL DEFAULT (datetime('now')),
        reference TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        created_by TEXT NOT NULL DEFAULT 'system',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_pt_payment ON payment_transactions(payment_id);
      CREATE INDEX IF NOT EXISTS idx_pt_type ON payment_transactions(type);

      -- ---------- توسعة جدول الوصولات ----------
      ALTER TABLE receipts ADD COLUMN status TEXT NOT NULL DEFAULT 'ACTIVE';
      ALTER TABLE receipts ADD COLUMN cancelled_at TEXT;
      ALTER TABLE receipts ADD COLUMN cancelled_by TEXT NOT NULL DEFAULT '';
      ALTER TABLE receipts ADD COLUMN cancellation_reason TEXT NOT NULL DEFAULT '';

      -- ---------- المرتجعات ----------
      CREATE TABLE IF NOT EXISTS refunds (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        payment_id INTEGER NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
        amount REAL NOT NULL,
        reason TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'PENDING',
        refund_date TEXT NOT NULL DEFAULT (datetime('now')),
        refunded_at TEXT,
        refunded_by TEXT NOT NULL DEFAULT '',
        receipt_id INTEGER DEFAULT 0,
        notes TEXT NOT NULL DEFAULT '',
        created_by TEXT NOT NULL DEFAULT 'system',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_refund_payment ON refunds(payment_id);
      CREATE INDEX IF NOT EXISTS idx_refund_status ON refunds(status);

      -- ---------- دفتر الحسابات (Accounting Ledger) ----------
      CREATE TABLE IF NOT EXISTS accounting_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entity_type TEXT NOT NULL DEFAULT 'payment',
        entity_id INTEGER NOT NULL DEFAULT 0,
        type TEXT NOT NULL DEFAULT 'income',
        amount REAL NOT NULL DEFAULT 0,
        currency TEXT NOT NULL DEFAULT 'MAD',
        description TEXT NOT NULL DEFAULT '',
        reference_number TEXT NOT NULL DEFAULT '',
        procedure_id INTEGER DEFAULT 0,
        recorded_at TEXT NOT NULL DEFAULT (datetime('now')),
        recorded_by TEXT NOT NULL DEFAULT 'system',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_ar_entity ON accounting_records(entity_type, entity_id);
      CREATE INDEX IF NOT EXISTS idx_ar_type ON accounting_records(type);
      CREATE INDEX IF NOT EXISTS idx_ar_procedure ON accounting_records(procedure_id);
      CREATE INDEX IF NOT EXISTS idx_ar_recorded ON accounting_records(recorded_at);

      -- ---------- فهارس أداءات إضافية ----------
      CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
      CREATE INDEX IF NOT EXISTS idx_payments_method ON payments(payment_method_id);
      CREATE INDEX IF NOT EXISTS idx_payments_date ON payments(payment_date);
    `
  },
  {
    version: 5,
    up: `
      -- ================================================================
      -- السجلات المهنية — Professional Registers (Migration v5)
      -- وفق المادة 37 من القانون رقم 46.21 المتعلق بتنظيم مهنة
      -- المفوضين القضائيين: سجل يومي للإجراءات + سجل يومي للعمليات
      -- الحسابية، بأرقام تسلسلية، دون بياض أو شطب أو فراغ بين السطور.
      -- النموذج الرسمي يحدَّد بنص تنظيمي (لم يُنشر بعد) ➜ كل شيء قابل
      -- للتهيئة ولا يُفترَض شكل رسمي.
      -- ================================================================

      -- ---------- السجلات (الكيان الأب) ----------
      CREATE TABLE IF NOT EXISTS registers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT UNIQUE NOT NULL,
        kind TEXT NOT NULL DEFAULT 'daily',
        name_ar TEXT NOT NULL,
        name_fr TEXT NOT NULL,
        description_ar TEXT NOT NULL DEFAULT '',
        description_fr TEXT NOT NULL DEFAULT '',
        numbering_pattern TEXT NOT NULL DEFAULT '{year}-{seq:000000}',
        seq_frequency TEXT NOT NULL DEFAULT 'year',
        schema_json TEXT NOT NULL DEFAULT '[]',
        effective_from TEXT,
        official_template_ref TEXT NOT NULL DEFAULT '',
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- ---------- مدخلات السجل (قلب غير قابل للحذف/الترقيم/التاريخ) ----------
      CREATE TABLE IF NOT EXISTS register_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        register_id INTEGER NOT NULL REFERENCES registers(id) ON DELETE RESTRICT,
        serial_no TEXT NOT NULL,
        entry_date TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        reason TEXT NOT NULL DEFAULT '',
        created_by TEXT NOT NULL DEFAULT 'system',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (register_id, serial_no)
      );
      CREATE INDEX IF NOT EXISTS idx_re_reg ON register_entries(register_id, entry_date);
      CREATE INDEX IF NOT EXISTS idx_re_reg_status ON register_entries(register_id, status);
      CREATE INDEX IF NOT EXISTS idx_re_created ON register_entries(created_at);

      -- مناعة السجل على مستوى قاعدة البيانات
      CREATE TRIGGER IF NOT EXISTS trg_re_no_delete
      BEFORE DELETE ON register_entries
      BEGIN SELECT RAISE(ABORT, 'REGISTER:NO_DELETE'); END;

      CREATE TRIGGER IF NOT EXISTS trg_re_no_core_update
      BEFORE UPDATE OF register_id, serial_no, entry_date ON register_entries
      BEGIN SELECT RAISE(ABORT, 'REGISTER:NO_CORE_UPDATE'); END;

      CREATE TRIGGER IF NOT EXISTS trg_re_status_requires_reason
      BEFORE UPDATE OF status ON register_entries
      WHEN NEW.status != OLD.status AND length(NEW.reason || '') = 0 AND NEW.status != 'ACTIVE'
      BEGIN SELECT RAISE(ABORT, 'REGISTER:REASON_REQUIRED'); END;

      -- ---------- تفاصيل السجل اليومي للإجراءات ----------
      CREATE TABLE IF NOT EXISTS daily_procedure_register_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entry_id INTEGER NOT NULL UNIQUE REFERENCES register_entries(id) ON DELETE RESTRICT,
        procedure_id INTEGER REFERENCES procedures(id) ON DELETE SET NULL,
        dossier_id INTEGER REFERENCES dossiers(id) ON DELETE SET NULL,
        procedure_type_id INTEGER REFERENCES procedure_types(id) ON DELETE SET NULL,
        pv_id INTEGER REFERENCES pvs(id) ON DELETE SET NULL,
        procedure_number_snapshot TEXT NOT NULL DEFAULT '',
        pv_number TEXT NOT NULL DEFAULT '',
        reference_number TEXT NOT NULL DEFAULT '',
        parties_summary TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_dpre_proc ON daily_procedure_register_entries(procedure_id);
      CREATE INDEX IF NOT EXISTS idx_dpre_dossier ON daily_procedure_register_entries(dossier_id);
      CREATE INDEX IF NOT EXISTS idx_dpre_pv ON daily_procedure_register_entries(pv_id);
      CREATE INDEX IF NOT EXISTS idx_dpre_entry ON daily_procedure_register_entries(entry_id);

      -- ---------- تفاصيل السجل الحسابي ----------
      CREATE TABLE IF NOT EXISTS accounting_register_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entry_id INTEGER NOT NULL UNIQUE REFERENCES register_entries(id) ON DELETE RESTRICT,
        payment_id INTEGER REFERENCES payments(id) ON DELETE SET NULL,
        receipt_id INTEGER REFERENCES receipts(id) ON DELETE SET NULL,
        procedure_id INTEGER REFERENCES procedures(id) ON DELETE SET NULL,
        dossier_id INTEGER REFERENCES dossiers(id) ON DELETE SET NULL,
        flow_type TEXT NOT NULL DEFAULT 'income',
        amount REAL NOT NULL DEFAULT 0,
        currency TEXT NOT NULL DEFAULT 'MAD',
        amount_text TEXT NOT NULL DEFAULT '',
        receipt_number TEXT NOT NULL DEFAULT '',
        reference TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_are_payment ON accounting_register_entries(payment_id);
      CREATE INDEX IF NOT EXISTS idx_are_proc ON accounting_register_entries(procedure_id);
      CREATE INDEX IF NOT EXISTS idx_are_dossier ON accounting_register_entries(dossier_id);
      CREATE INDEX IF NOT EXISTS idx_are_entry ON accounting_register_entries(entry_id);

      -- ---------- قيم الحقول القابلة للتهيئة (النموذج الرسمي مستقبلاً) ----------
      CREATE TABLE IF NOT EXISTS register_entry_values (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entry_id INTEGER NOT NULL REFERENCES register_entries(id) ON DELETE RESTRICT,
        field_key TEXT NOT NULL,
        value TEXT NOT NULL DEFAULT '',
        UNIQUE (entry_id, field_key)
      );
      CREATE INDEX IF NOT EXISTS idx_rev_entry ON register_entry_values(entry_id);

      -- ---------- فترات الإغلاق (ميزة إدارية قابلة للتفعيل — ليست شكلاً رسمياً) ----------
      CREATE TABLE IF NOT EXISTS register_periods (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        register_id INTEGER NOT NULL REFERENCES registers(id) ON DELETE CASCADE,
        period_key TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'OPEN',
        reviewed_at TEXT,
        reviewed_by TEXT NOT NULL DEFAULT '',
        review_note TEXT NOT NULL DEFAULT '',
        locked_at TEXT,
        locked_by TEXT NOT NULL DEFAULT '',
        unlock_reason TEXT NOT NULL DEFAULT '',
        UNIQUE (register_id, period_key)
      );
      CREATE INDEX IF NOT EXISTS idx_rp_reg ON register_periods(register_id, status);

      -- ---------- التصحيحات (Workflow موثق) ----------
      CREATE TABLE IF NOT EXISTS register_corrections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        register_id INTEGER NOT NULL REFERENCES registers(id) ON DELETE RESTRICT,
        original_entry_id INTEGER NOT NULL REFERENCES register_entries(id) ON DELETE RESTRICT,
        replacement_entry_id INTEGER REFERENCES register_entries(id) ON DELETE SET NULL,
        snapshot_old TEXT NOT NULL DEFAULT '{}',
        reason TEXT NOT NULL DEFAULT '',
        requested_by TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'REQUESTED',
        reviewed_by TEXT NOT NULL DEFAULT '',
        reviewed_at TEXT,
        review_note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_rc_orig ON register_corrections(original_entry_id);
      CREATE INDEX IF NOT EXISTS idx_rc_reg ON register_corrections(register_id, status);

      -- ---------- سجل تدقيق السجلات (لا يعدله المستخدم العادي) ----------
      CREATE TABLE IF NOT EXISTS register_audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        register_id INTEGER NOT NULL REFERENCES registers(id) ON DELETE CASCADE,
        entry_id INTEGER REFERENCES register_entries(id) ON DELETE SET NULL,
        action TEXT NOT NULL,
        by_user TEXT NOT NULL DEFAULT 'system',
        old_value TEXT NOT NULL DEFAULT '',
        new_value TEXT NOT NULL DEFAULT '',
        reason TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_ral_reg ON register_audit_logs(register_id, entry_id);
      CREATE INDEX IF NOT EXISTS idx_ral_action ON register_audit_logs(action);
      CREATE INDEX IF NOT EXISTS idx_ral_created ON register_audit_logs(created_at);

      -- ---------- أرشيف السجلات (السجل + الوثيقة معاً) ----------
      CREATE TABLE IF NOT EXISTS register_archives (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        register_id INTEGER NOT NULL REFERENCES registers(id) ON DELETE CASCADE,
        period_key TEXT NOT NULL DEFAULT '',
        entry_id INTEGER REFERENCES register_entries(id) ON DELETE SET NULL,
        document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        archived_at TEXT NOT NULL DEFAULT (datetime('now')),
        archived_by TEXT NOT NULL DEFAULT ''
      );
      CREATE INDEX IF NOT EXISTS idx_ra_reg ON register_archives(register_id, period_key);
      CREATE INDEX IF NOT EXISTS idx_ra_entry ON register_archives(entry_id);
    `
  },
  {
    version: 6,
    up: `
      -- ---------- نظام الأرشيف: بنية منظمة + سلامة (Migration v6) ----------
      ALTER TABLE documents ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
      ALTER TABLE documents ADD COLUMN sha256 TEXT NOT NULL DEFAULT '';
      ALTER TABLE documents ADD COLUMN size_bytes INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE documents ADD COLUMN period_key TEXT NOT NULL DEFAULT '';
      ALTER TABLE documents ADD COLUMN source TEXT NOT NULL DEFAULT 'auto';
      CREATE INDEX IF NOT EXISTS idx_documents_period ON documents(period_key);
      CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(status);

      -- ---------- الختم القانوني للفترات (Seal) ----------
      CREATE TABLE IF NOT EXISTS archive_seals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        register_id INTEGER NOT NULL REFERENCES registers(id) ON DELETE CASCADE,
        period_key TEXT NOT NULL,
        doc_count INTEGER NOT NULL DEFAULT 0,
        sha256_manifest TEXT NOT NULL DEFAULT '',
        file_path TEXT NOT NULL DEFAULT '',
        note TEXT NOT NULL DEFAULT '',
        sealed_at TEXT NOT NULL DEFAULT (datetime('now')),
        sealed_by TEXT NOT NULL DEFAULT ''
      );
      CREATE INDEX IF NOT EXISTS idx_as_reg ON archive_seals(register_id, period_key);

      -- ---------- الوثائق المختومة: لا حذف ولا تعديل ----------
      CREATE TRIGGER IF NOT EXISTS trg_docs_sealed_no_delete
      BEFORE DELETE ON documents FOR EACH ROW
      WHEN OLD.status = 'sealed'
      BEGIN SELECT RAISE(ABORT, 'DOC:SEALED:NO_DELETE'); END;
      CREATE TRIGGER IF NOT EXISTS trg_docs_sealed_no_update
      BEFORE UPDATE ON documents FOR EACH ROW
      WHEN OLD.status = 'sealed'
        AND (NEW.file_path <> OLD.file_path OR NEW.sha256 <> OLD.sha256 OR NEW.status <> 'sealed')
      BEGIN SELECT RAISE(ABORT, 'DOC:SEALED:NO_MODIFY'); END;
    `
  },
  {
    version: 7,
    up: `
      -- ---------- Manifest بيانات الختم (لأغراض التحقق من السلامة) ----------
      ALTER TABLE archive_seals ADD COLUMN manifest_json TEXT NOT NULL DEFAULT '';
    `
  },
  {
    version: 8,
    up: `
      -- ---------- كلمات مرور المستخدمين (مصادقة بالدخول) ----------
      ALTER TABLE users ADD COLUMN password_hash TEXT NOT NULL DEFAULT '';
    `
  }
];

module.exports = { VERSION, MIGRATIONS };
