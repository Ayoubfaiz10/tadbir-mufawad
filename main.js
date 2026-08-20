'use strict';

const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');
const { initDatabase } = require('./db/database');
const ipc = require('./ipc');

let mainWindow = null;

/* ---------- النافذة ---------- */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1024,
    minHeight: 680,
    title: 'تسيير المفوض القضائي — Gestion Huissier',
    backgroundColor: '#f4f6fb',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) e.preventDefault();
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => { mainWindow = null; });
}

/* ---------- القائمة ---------- */
function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'Export Dossiers CSV', click: () => mainWindow && mainWindow.webContents.send('menu:export', 'dossiers') },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* ---------- الإطلاق ---------- */
app.whenReady().then(async () => {
  try {
    await initDatabase(path.join(app.getPath('userData'), 'data'));
    const documentService = require('./services/documentService');
    documentService.setOutputDir(path.join(app.getPath('userData'), 'data', 'output'));
    const archiveStorage = require('./services/archiveStorage');
    archiveStorage.setArchiveRoot(path.join(app.getPath('userData'), 'data', 'archive'));
    console.log('✔ قاعدة البيانات جاهزة:', path.join(app.getPath('userData'), 'data', 'app.sqlite'));
  } catch (e) {
    console.error('فشل تهيئة قاعدة البيانات:', e);
    app.quit();
    return;
  }

  ipc.register();
  buildMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

process.on('unhandledRejection', (reason) => {
  console.error('UNHANDLED REJECTION:', reason);
});
