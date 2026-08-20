'use strict';

/* ================================================================
   BackupService — النسخ الاحتياطي والاسترجاع
   ================================================================ */

const fs = require('fs');
const path = require('path');

function getBackupDir(app) {
  const dir = path.join(app.getPath('userData'), 'backups');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function list(app) {
  const dir = getBackupDir(app);
  try {
    return fs.readdirSync(dir)
      .filter((f) => f.endsWith('.db'))
      .map((f) => {
        const stat = fs.statSync(path.join(dir, f));
        return { name: f, size: stat.size, date: stat.mtime.toISOString() };
      })
      .sort((a, b) => b.date.localeCompare(a.date));
  } catch (e) { return []; }
}

function create(app, dbPath) {
  const dir = getBackupDir(app);
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dest = path.join(dir, `backup-${ts}.db`);
  fs.copyFileSync(dbPath, dest);
  return { name: path.basename(dest), size: fs.statSync(dest).size };
}

function remove(app, name) {
  const dir = getBackupDir(app);
  const target = path.join(dir, name);
  if (!target.startsWith(dir)) throw new Error('INVALID_PATH');
  if (fs.existsSync(target)) fs.unlinkSync(target);
  return true;
}

function restore(app, name, dbPath) {
  const dir = getBackupDir(app);
  const src = path.join(dir, name);
  if (!src.startsWith(dir)) throw new Error('INVALID_PATH');
  if (!fs.existsSync(src)) throw new Error('BACKUP_NOT_FOUND');
  fs.copyFileSync(src, dbPath);
  return true;
}

function restoreFromBuffer(app, buffer, name, dbPath) {
  fs.writeFileSync(dbPath, Buffer.from(buffer));
  const dir = getBackupDir(app);
  const safeName = (name || 'restore.db').replace(/[^a-zA-Z0-9._-]/g, '_');
  const dest = path.join(dir, safeName);
  if (!dest.startsWith(dir)) throw new Error('INVALID_PATH');
  fs.copyFileSync(dbPath, dest);
  return true;
}

module.exports = { list, create, remove, restore, restoreFromBuffer };
