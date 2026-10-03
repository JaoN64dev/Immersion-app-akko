// akko as a desktop app: runs the same server as `npm start` inside the app, and shows it either
// in its own window or in your normal browser (the "browser only" mode: no window, just an icon
// in the system tray that keeps the server running).
//   npm run desktop   try it from the folder (add -- --browser for the browser mode)
//   npm run dist      build the installer (into dist/)
//
// Your data (words, settings, books…) lives in the storage of whatever shows the pages: the app
// window's is kept by Electron in your user profile, the browser keeps its own. The server's files
// (dictionaries, caches) go to <user profile>/data instead of ./data, because an installed program
// can't write to its own folder.

const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, shell, dialog, Menu, Tray, nativeImage } = require('electron');

// Its own port, so the desktop app and `npm start` (3000) can run at the same time.
// Never change it: the pages' storage belongs to this address, so a new port = empty app.
const PORT = 3417;
const BUNDLED_DATA = path.join(__dirname, '..', 'data');
const ICON = path.join(__dirname, 'icon.png');

// Only one copy of the app: opening it again shows akko again (the window, or a browser tab)
if (!app.requestSingleInstanceLock()) app.quit();

// ---------- the saved choice: open in the app window or in the browser ----------

const configFile = () => path.join(app.getPath('userData'), 'desktop.json');

function readConfig() {
  try { return JSON.parse(fs.readFileSync(configFile(), 'utf8')); } catch { return {}; }
}

function saveConfig(changes) {
  fs.writeFileSync(configFile(), JSON.stringify({ ...readConfig(), ...changes }, null, 2));
}

// How to open akko this time: --browser / --window on the command line (for shortcuts), else the
// remembered choice, else ask. Returns null if the question was closed (= don't start).
async function startMode() {
  if (process.argv.includes('--browser')) return 'browser';
  if (process.argv.includes('--window')) return 'window';
  const saved = readConfig().mode;
  if (saved === 'browser' || saved === 'window') return saved;

  const { response, checkboxChecked } = await dialog.showMessageBox({
    type: 'question',
    title: 'akko',
    icon: nativeImage.createFromPath(ICON).resize({ width: 64, height: 64 }),
    message: 'How do you want to open akko?',
    detail: 'App window: akko in its own window.\n'
      + 'My browser: akko opens in your normal browser, and keeps running as an icon in the system tray '
      + '(next to the clock) until you quit it there.\n\n'
      + 'Each one keeps its own words and progress; Settings → Backup / Restore moves them.',
    buttons: ['App window', 'My browser', 'Cancel'],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
    checkboxLabel: 'Remember my choice (change it later in the akko menu)',
  });
  if (response === 2) return null;
  const mode = response === 1 ? 'browser' : 'window';
  if (checkboxChecked) saveConfig({ mode });
  return mode;
}

// The dictionaries that come with the app are copied out once, so the server doesn't have to
// download and build them on the first start
function prepareData(dir) {
  fs.mkdirSync(dir, { recursive: true });
  for (const name of ['dict.json', 'kanji.json', 'accents.txt']) {
    const from = path.join(BUNDLED_DATA, name);
    const to = path.join(dir, name);
    if (fs.existsSync(from) && !fs.existsSync(to)) fs.copyFileSync(from, to);
  }
}

let url = null;
let win = null;
let tray = null;

// ---------- the app window ----------

function openWindow() {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
    return;
  }
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    title: 'akko',
    icon: ICON,
    autoHideMenuBar: true,
    backgroundColor: '#ffffff',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });

  // Links to other sites open in your normal browser; the app's own pages stay in the window
  const isOurs = (link) => link.startsWith(url + '/') || link === url;
  win.webContents.setWindowOpenHandler(({ url: link }) => {
    if (isOurs(link)) return { action: 'allow' };
    if (/^https?:\/\//.test(link)) shell.openExternal(link);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, link) => {
    if (isOurs(link)) return;
    event.preventDefault();
    if (/^https?:\/\//.test(link)) shell.openExternal(link);
  });

  win.loadURL(url);
  win.on('closed', () => {
    win = null;
    // in browser mode the server keeps running in the tray; otherwise closing the window quits
    if (!tray) app.quit();
  });
}

const openBrowser = () => shell.openExternal(url);

// ---------- browser mode: an icon in the tray keeps the server running ----------

function showTray() {
  if (tray) return;
  tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 }));
  tray.setToolTip(`akko is running (${url})`);
  tray.on('click', openBrowser);
  tray.on('double-click', openBrowser);
  buildTrayMenu();
}

function buildTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open akko in the browser', click: openBrowser },
    { label: 'Open in the app window', click: openWindow },
    { type: 'separator' },
    modeMenuItem(),
    { label: 'Open the data folder', click: () => shell.openPath(process.env.AKKO_DATA) },
    { type: 'separator' },
    { label: 'Quit akko (stops the server)', click: () => app.quit() },
  ]));
}

// ---------- menus ----------

// What happens when akko starts: the same choice in the window menu and the tray menu
function modeMenuItem() {
  const saved = readConfig().mode;
  const choose = (mode) => () => {
    saveConfig({ mode });
    buildMenu();
    buildTrayMenu();
  };
  return {
    label: 'When akko starts',
    submenu: [
      { label: 'Ask every time', type: 'radio', checked: saved !== 'window' && saved !== 'browser', click: choose('ask') },
      { label: 'Open the app window', type: 'radio', checked: saved === 'window', click: choose('window') },
      { label: 'Open in my browser', type: 'radio', checked: saved === 'browser', click: choose('browser') },
    ],
  };
}

// A small menu: the usual edit shortcuts (copy/paste need it), reload, zoom, full screen
function buildMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    {
      label: 'akko',
      submenu: [
        { label: 'Open in my browser', accelerator: 'CmdOrCtrl+Shift+B', click: openBrowser },
        modeMenuItem(),
        { type: 'separator' },
        { label: 'Open the data folder', click: () => shell.openPath(process.env.AKKO_DATA) },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' }, { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        { label: 'Project page', click: () => shell.openExternal('https://github.com/JaoN64dev/japaneselocalwebapp') },
      ],
    },
  ]));
}

// ---------- start ----------

let mode = 'window';

app.on('second-instance', () => {
  if (!url) return;
  if (mode === 'browser') openBrowser(); else openWindow();
});

app.whenReady().then(async () => {
  process.env.AKKO_DATA = path.join(app.getPath('userData'), 'data');
  prepareData(process.env.AKKO_DATA);
  const chosen = await startMode();
  if (!chosen) { app.quit(); return; }
  mode = chosen;
  buildMenu();
  try {
    // required only now: the server modules read AKKO_DATA when they load
    url = await require('../server').start(PORT);
  } catch (err) {
    dialog.showErrorBox('akko could not start',
      err.code === 'EADDRINUSE' ? `Port ${PORT} is already used by another program.` : String(err.stack || err));
    app.quit();
    return;
  }
  if (mode === 'browser') {
    showTray();
    openBrowser();
  } else {
    openWindow();
  }
  app.on('activate', () => { if (mode === 'browser') openBrowser(); else openWindow(); });
});

// Without a tray icon, closing the last window ends everything (except on macOS, as usual there).
// With one (browser mode), the server keeps running until "Quit akko".
app.on('window-all-closed', () => {
  if (!tray && process.platform !== 'darwin') app.quit();
});
