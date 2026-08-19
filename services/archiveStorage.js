'use strict';

/* ================================================================
   ArchiveStorage — نظام تخزين آمن للوثائق
   UUID naming, SHA-256 hashing, MIME detection, period-based folders.
   ================================================================ */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
let archiveRoot = '';

function setArchiveRoot(dir) {
  archiveRoot = dir;
  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
}

function getArchiveRoot() { return archiveRoot; }

/* ---------- MIME Detection ---------- */
const MIME_MAP = {
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.tiff': 'image/tiff',
  '.tif': 'image/tiff',
  '.txt': 'text/plain',
  '.csv': 'text/csv',
  '.html': 'text/html',
  '.xml': 'application/xml',
  '.json': 'application/json',
  '.zip': 'application/zip'
};

function detectMime(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_MAP[ext] || 'application/octet-stream';
}

/* ---------- SHA-256 Hashing ---------- */
function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (data) => hash.update(data));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

function sha256Buffer(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/* ---------- UUID Generation ---------- */
function uuid() {
  return crypto.randomUUID ? crypto.randomUUID() :
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
}

/* ---------- Period Key ---------- */
function periodKey(dateStr) {
  const d = dateStr ? new Date(dateStr) : new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/* ---------- Directory Structure ---------- */
function ensurePeriodDir(period) {
  const dir = path.join(archiveRoot, period);
  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
  return dir;
}

/* ---------- Store File ---------- */
async function storeFile(buffer, originalName, opts = {}) {
  const ext = path.extname(originalName).toLowerCase();
  const storageName = uuid() + ext;
  const period = opts.period || periodKey();
  const dir = ensurePeriodDir(period);
  const filePath = path.join(dir, storageName);

  fs.writeFileSync(filePath, buffer);

  const hash = sha256Buffer(buffer);
  const mime = opts.mime || detectMime(originalName);

  return {
    storageName,
    filePath,
    originalName,
    mime,
    sizeBytes: buffer.length,
    sha256: hash,
    period
  };
}

/* ---------- Store File from Path ---------- */
async function storeFileFromPath(sourcePath, originalName, opts = {}) {
  const buffer = fs.readFileSync(sourcePath);
  return storeFile(buffer, originalName || path.basename(sourcePath), opts);
}

/* ---------- Read File ---------- */
function readFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath);
}

/* ---------- Delete File ---------- */
function deleteFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return;
  try { fs.unlinkSync(filePath); } catch (e) {}
}

/* ---------- Verify Integrity ---------- */
async function verifyIntegrity(filePath, expectedHash) {
  if (!filePath || !fs.existsSync(filePath)) return false;
  const hash = await sha256File(filePath);
  return hash === expectedHash;
}

/* ---------- Generate Document Number ---------- */
function generateDocNumber(docTypeCode, seq, year) {
  const y = year || new Date().getFullYear();
  const s = String(seq).padStart(6, '0');
  return `${docTypeCode}-${y}-${s}`;
}

module.exports = {
  setArchiveRoot,
  getArchiveRoot,
  detectMime,
  sha256File,
  sha256Buffer,
  uuid,
  periodKey,
  ensurePeriodDir,
  storeFile,
  storeFileFromPath,
  readFile,
  deleteFile,
  verifyIntegrity,
  generateDocNumber
};
