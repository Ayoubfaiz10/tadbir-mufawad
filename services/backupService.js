'use strict';

/* ================================================================
   BackupService — نسخ احتياطي واستعادة (P4).
   - النسخ الاحتياطي: ZIP واحد فيه app.sqlite + مجلد الأرشيف + Manifest.
   - الاستعادة: فحص الشكل والمصدر ثم استبدال قاعدة البيانات والأرشيف.
   لا يعتمد على Electron (مقابل للاختبار مباشرة).
   ================================================================ */

const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const { persist, getDbPath } = require('../db/database');
const { getCurrentUser, requireAuth } = require('./auth');

const FORMAT = 1;
const APP_ID = 'huissier';

/* فك ضغط ZIP إلى مجلد — محلل ZIP محلي (متزامن بالكامل عبر fs + zlib).
   لا يعتمد على extract-zip/yauzl (تجمّد مع Node 26). يكفي للنسخ الاحتياطي الصغيرة. */
function extractZipFile(zipPath, destDir) {
  const zlib = require('zlib');
  const buf = fs.readFileSync(zipPath);
  const view = { buf, pos: 0, u16: (o) => buf.readUInt16LE(o), u32: (o) => buf.readUInt32LE(o) };
  const find = (sig, from) => {
    let i = from;
    while (i >= 0) { if (buf.readUInt32LE(i) === sig) return i; i -= 1; }
    return -1;
  };
  const eocdOff = find(0x06054b50, buf.length - 22);
  if (eocdOff < 0) throw new Error('BACKUP:INVALID_ZIP');
  view.pos = eocdOff + 16;
  const cdEntries = view.u16(eocdOff + 10);
  let cdOff = view.u32(eocdOff + 16);
  for (let n = 0; n < cdEntries; n++) {
    if (buf.readUInt32LE(cdOff) !== 0x02014b50) throw new Error('BACKUP:INVALID_ZIP');
    const method = view.u16(cdOff + 10);
    const compSize = view.u32(cdOff + 20);
    const nameLen = view.u16(cdOff + 28);
    const extraLen = view.u16(cdOff + 30);
    const commentLen = view.u16(cdOff + 32);
    const lho = view.u32(cdOff + 42);
    let name = buf.toString('utf8', cdOff + 46, cdOff + 46 + nameLen);
    if (name.charCodeAt(0) === 0xFEFF) name = name.slice(1);
    const target = path.join(destDir, name);
    if (name.endsWith('/')) {
      fs.mkdirSync(target, { recursive: true });
    } else {
      if (name.includes('..')) throw new Error('BACKUP:INVALID_ZIP');
      if (buf.readUInt32LE(lho) !== 0x04034b50) throw new Error('BACKUP:INVALID_ZIP');
      const lNameLen = view.u16(lho + 26);
      const lExtraLen = view.u16(lho + 28);
      const dataStart = lho + 30 + lNameLen + lExtraLen;
      const chunk = buf.slice(dataStart, dataStart + compSize);
      let raw;
      try {
        raw = method === 0 ? chunk : zlib.inflateRawSync(chunk);
      } catch (e) { throw new Error('BACKUP:INVALID_ZIP'); }
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, raw);
    }
    cdOff += 46 + nameLen + extraLen + commentLen;
  }
  return true;
}

function buildManifest() {
  const user = getCurrentUser();
  return {
    app: APP_ID,
    format: FORMAT,
    createdAt: new Date().toISOString(),
    createdBy: user ? user.username : 'system',
    files: { sqlite: 'app.sqlite', archive: 'archive' }
  };
}

/* ---------- الإنشاء ---------- */
function createBackupZip(zipPath, archiveDir) {
  requireAuth('backup.manage');
  const dbPath = getDbPath();
  if (!dbPath || !fs.existsSync(dbPath)) throw new Error('BACKUP:NO_DB');
  persist();

  const manifest = buildManifest();
  const zipSize = () => {
    try { return fs.statSync(zipPath).size; } catch (e) { return 0; }
  };

  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', () => resolve({ ok: true, path: zipPath, bytes: zipSize(), manifest }));
    archive.on('error', (e) => reject(e));
    output.on('error', (e) => reject(e));

    archive.pipe(output);
    archive.file(dbPath, { name: 'app.sqlite' });
    if (archiveDir && fs.existsSync(archiveDir)) {
      archive.directory(archiveDir, 'archive');
    }
    archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });
    archive.finalize();
  });
}

/* ---------- الفحص ---------- */
async function validateBackupZip(zipPath) {
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'huissier-bk-'));
  try {
    extractZipFile(zipPath, tmp);
  } catch (e) {
    fs.rmSync(tmp, { recursive: true, force: true });
    throw e;
  }
  const sqlite = path.join(tmp, 'app.sqlite');
  const archiveDir = path.join(tmp, 'archive');
  if (!fs.existsSync(sqlite)) throw new Error('BACKUP:INVALID_NO_SQLITE');
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(path.join(tmp, 'manifest.json'), 'utf8')); } catch (e) { manifest = null; }
  if (manifest && manifest.app && manifest.app !== APP_ID) throw new Error('BACKUP:INVALID_APP');
  return { tmp, sqlite, archiveDir, manifest, docs: fs.existsSync(archiveDir)
    ? fs.readdirSync(archiveDir, { recursive: true }).filter((f) => !fs.statSync(path.join(archiveDir, f)).isDirectory()).length
    : 0 };
}

/* ---------- الاستعادة (ملفات فقط — يعيد تشغيل التطبيق الطالب بعده) ---------- */
async function restoreBackup(zipPath, dataDir, archiveDir) {
  requireAuth('backup.manage');
  if (!fs.existsSync(zipPath)) throw new Error('BACKUP:NOT_FOUND');
  const v = await validateBackupZip(zipPath);
  if (!v.manifest || v.manifest.format !== FORMAT) throw new Error('BACKUP:INVALID_FORMAT');

  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  /* قاعدة البيانات */
  if (fs.existsSync(path.join(dataDir, 'app.sqlite'))) {
    fs.renameSync(path.join(dataDir, 'app.sqlite'), path.join(dataDir, 'app.sqlite.restore-bak'));
  }
  fs.copyFileSync(v.sqlite, path.join(dataDir, 'app.sqlite'));

  /* الأرشيف: استبدال كامل */
  const archAbs = path.resolve(archiveDir);
  const backupAbs = path.resolve(v.archiveDir);
  if (backupAbs !== archAbs) {
    const old = archAbs + '.restore-bak';
    fs.rmSync(old, { recursive: true, force: true });
    if (fs.existsSync(archAbs)) fs.renameSync(archAbs, old);
    if (fs.existsSync(backupAbs)) {
      fs.renameSync(backupAbs, archAbs);
    } else {
      fs.mkdirSync(archAbs, { recursive: true });
    }
  }
  v.tmp && fs.rmSync(v.tmp, { recursive: true, force: true });
  return { ok: true, docs: v.docs, restoredAt: new Date().toISOString() };
}

module.exports = { createBackupZip, validateBackupZip, restoreBackup, buildManifest };