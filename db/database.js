'use strict';

/* ================================================================
   نواة قاعدة البيانات (sql.js) — فتح، تهجير، بذر، استيراد JSON،
   مساعدة استعلامات، معاملات مع حفظ تلقائي.
   كل الوصول يتم عبر main process فقط. لا يُكشف للـRenderer.
   ================================================================ */

const fs = require('fs');
const path = require('path');
const initSqlJs = require('../node_modules/sql.js/dist/sql-wasm.js');
const { MIGRATIONS, VERSION } = require('./schema');
const { seedIfEmpty, seedTemplateLibrary, seedPvConfig, seedPaymentMethods, seedRegisters, seedDocumentTypes } = require('./seed');

let SQL = null;
let db = null;
let dbPath = null;

/* ---------- عداد ترتيبي لكل سنة لتوليد أرقام فريدة ---------- */
const SEQ_KEY_PREFIX = 'seq:';

/* ---------- مساعدات استعلامات ---------- */
function prepare(sql) {
  return db.prepare(sql);
}

function all(sql, params = []) {
  const stmt = db.prepare(sql);
  try {
    if (params.length) stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    return rows;
  } finally {
    stmt.free();
  }
}

function get(sql, params = []) {
  const rows = all(sql, params);
  return rows[0] || null;
}

function run(sql, params = []) {
  const stmt = db.prepare(sql);
  let changed = 0;
  try {
    if (params.length) stmt.bind(params);
    stmt.step();
    changed = db.getRowsModified();
  } finally {
    stmt.free();
  }
  return {
    lastId: db.exec('SELECT last_insert_rowid() AS id')[0].values[0][0],
    changed
  };
}

function exec(sql) {
  db.exec(sql);
}

/* ---------- تسلسل أرقام فريدة ---------- */
function nextSequence(key) {
  const metaKey = SEQ_KEY_PREFIX + key;
  const row = get('SELECT value FROM meta WHERE key = ?', [metaKey]);
  let n = row ? parseInt(row.value, 10) : 0;
  n += 1;
  if (row) {
    run('UPDATE meta SET value = ? WHERE key = ?', [String(n), metaKey]);
  } else {
    run('INSERT INTO meta (key, value) VALUES (?,?)', [metaKey, String(n)]);
  }
  return n;
}

/* ---------- معاملة مع حفظ تلقائي (تدعم التداخل عبر Savepoints) ---------- */
let txDepth = 0;

function tx(fn) {
  const depth = ++txDepth;
  const savepoint = 'sp' + depth;
  if (depth === 1) {
    db.run('BEGIN TRANSACTION');
  } else {
    db.run(`SAVEPOINT ${savepoint}`);
  }
  try {
    const result = fn();
    if (depth === 1) {
      db.run('COMMIT');
      txDepth = 0;
      persist();
    } else {
      db.run(`RELEASE ${savepoint}`);
      txDepth = depth - 1;
    }
    return result;
  } catch (e) {
    try {
      if (depth === 1) {
        db.run('ROLLBACK');
        txDepth = 0;
      } else {
        db.run(`ROLLBACK TO ${savepoint}`);
        db.run(`RELEASE ${savepoint}`);
        txDepth = depth - 1;
      }
    } catch (e2) {}
    throw e;
  }
}

function persist() {
  if (!dbPath) return;
  const data = Buffer.from(db.export());
  const tmp = dbPath + '.tmp';
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, dbPath);
}

function getDbPath() {
  return dbPath;
}

/* ---------- استيراد بيانات JSON القديمة ---------- */
function importLegacyJSON(legacyStorePath) {
  if (!fs.existsSync(legacyStorePath)) return;
  let legacy;
  try {
    legacy = JSON.parse(fs.readFileSync(legacyStorePath, 'utf8'));
  } catch (e) {
    return;
  }
  const dossierCount = get('SELECT COUNT(*) AS c FROM dossiers').c;
  const clientCount = get('SELECT COUNT(*) AS c FROM clients').c;
  if (dossierCount === 0 && Array.isArray(legacy.dossiers)) {
    tx(() => {
      legacy.dossiers.forEach((d) => {
        run(
          `INSERT INTO dossiers (id, numero, demandeur, defendeur, court, type, status, date, notes, created_at)
           VALUES (?,?,?,?,?,?,?,?,?, COALESCE(NULLIF(?, ''), datetime('now')))`,
          [d.id || null, d.numero || 'N/A', d.demandeur || '', d.defendeur || '',
           d.court || '', d.type || '', d.status || 'open', d.date || '', d.notes || '', d.date || '']
        );
        // أطراف تلقائية من الحقول النصية للملف
        if (d.demandeur) {
          run(
            `INSERT INTO parties (dossier_id, role, name, created_at) VALUES (?, 'demandeur', ?, datetime('now'))`,
            [d.id, d.demandeur]
          );
        }
        if (d.defendeur) {
          run(
            `INSERT INTO parties (dossier_id, role, name, created_at) VALUES (?, 'defendeur', ?, datetime('now'))`,
            [d.id, d.defendeur]
          );
        }
      });
    });
  }
  if (clientCount === 0 && Array.isArray(legacy.clients)) {
    tx(() => {
      legacy.clients.forEach((c) => {
        run(
          `INSERT INTO clients (id, name, phone, email, type, notes, created_at)
           VALUES (?,?,?,?,?,?, COALESCE(NULLIF(?, ''), datetime('now')))`,
          [c.id || null, c.name || 'N/A', c.phone || '', c.email || '', c.type || '', c.notes || '', '']
        );
      });
    });
  }
  try {
    fs.renameSync(legacyStorePath, legacyStorePath + '.imported');
  } catch (e) {}
}

/* ---------- التهيئة ---------- */
async function initDatabase(dataDir) {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  dbPath = path.join(dataDir, 'app.sqlite');
  SQL = await initSqlJs({ locateFile: () => path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm') });

  if (fs.existsSync(dbPath)) {
    const data = fs.readFileSync(dbPath);
    db = new SQL.Database(data);
  } else {
    db = new SQL.Database();
  }
  db.run('PRAGMA foreign_keys = ON');

  // التهجير: قارن إصدار meta
  let current = 0;
  try {
    const row = db.exec("SELECT value FROM meta WHERE key = 'schema_version'");
    if (row.length && row[0].values.length) current = parseInt(row[0].values[0][0], 10);
  } catch (e) {}

  if (current < VERSION) {
    tx(() => {
      MIGRATIONS.forEach((m) => {
        if (m.version > current) {
          db.exec(m.up);
          run("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', ?)", [String(m.version)]);
        }
      });
    });
    current = VERSION;
  }

  seedIfEmpty({ get, run, tx });
  seedTemplateLibrary({ get, run, tx });
  seedPvConfig({ get, run, tx });
  seedPaymentMethods({ get, run, tx });
  seedRegisters({ get, run, tx });
  seedDocumentTypes({ get, run, tx });

  // كلمات المرور تُنشأ عبر "التسجيل الأول" (auth.setupInitial) — لا افتراضيات
  persist();

  // استيراد البيانات القديمة من JSON (نسخة أولى من التطبيق)
  importLegacyJSON(path.join(dataDir, 'store.json'));

  return db;
}

const helpers = { all, get, run, exec, tx, persist, nextSequence, prepare };

module.exports = { initDatabase, helpers, getDbPath, persist };
