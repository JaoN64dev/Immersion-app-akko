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
    // ticked: asked once, then akko opens the same way (the welcome screen greets you each time)
    checkboxLabel: 'Remember my choice (change it later in the akko menu)',
    checkboxChecked: true,
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

  win.loadURL(url);
  win.on('closed', () => {
    win = null;
    // in browser mode the server keeps running in the tray; otherwise closing the window quits
    if (!tray) app.quit();
  });
}

const openBrowser = () => shell.openExternal(url);

// ---------- links (every window: the main one, and any a link opens) ----------
//
//   <a href="/grammar.html" target="_blank">            akko page  -> a new akko window
//   <a href="https://jisho.org" target="_blank">        other site -> your normal browser
//   <a href="https://jisho.org" target="akko-window">   other site -> a new window inside akko
//
// A site opened inside akko can be browsed freely in its window. It runs like in a browser tab:
// no access to your computer, and akko's server refuses changes from it (server/guard.js).

const IN_APP = 'akko-window';
const isOurs = (link) => link === url || link.startsWith(url + '/');
const isWeb = (link) => /^https?:\/\//.test(link);
const siteWindows = new WeakSet();          // windows showing another site, opened with akko-window

const windowOptions = (width, height) => ({
  width, height, icon: ICON, autoHideMenuBar: true,
  webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
});

app.on('web-contents-created', (event, contents) => {
  contents.setWindowOpenHandler(({ url: link, frameName }) => {
    if (isOurs(link)) return { action: 'allow', overrideBrowserWindowOptions: windowOptions(1200, 850) };
    if (frameName === IN_APP && isWeb(link)) return { action: 'allow', overrideBrowserWindowOptions: windowOptions(1100, 800) };
    // a site opened inside akko (nyaa.si…) opening more windows, ads included: they stay inside
    // akko too, so they can't open tabs in your normal browser
    if (siteWindows.has(contents) && isWeb(link)) return { action: 'allow', overrideBrowserWindowOptions: windowOptions(1100, 800) };
    if (isWeb(link)) shell.openExternal(link);
    return { action: 'deny' };
  });
  contents.on('did-create-window', (child, { url: link }) => {
    if (!isOurs(link)) siteWindows.add(child.webContents);
  });
  // akko's own windows stay on akko: a plain link to another site goes to your browser
  contents.on('will-navigate', (e, link) => {
    if (siteWindows.has(contents) || isOurs(link)) return;
    e.preventDefault();
    if (isWeb(link)) shell.openExternal(link);
  });
});

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
        { label: 'Check for updates', click: () => checkForUpdate({ quiet: false }) },
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
  setTimeout(() => checkForUpdate({ quiet: true }), 5000);
});

// ---------- is there a newer akko? ----------
// Asks GitHub for the newest release, at most once a day (or when you pick Help → Check for
// updates). Nothing is installed: it offers to open the download page. AKKO_UPDATE_URL points it
// somewhere else (for testing).

const RELEASES = 'https://github.com/JaoN64dev/japaneselocalwebapp/releases/latest';
const UPDATE_URL = process.env.AKKO_UPDATE_URL || 'https://api.github.com/repos/JaoN64dev/japaneselocalwebapp/releases/latest';
const DAY = 24 * 3600e3;

// "v1.10.0" > "1.9.2"
function newer(a, b) {
  const nums = (v) => String(v).replace(/^v/i, '').split(/[.+-]/).slice(0, 3).map((n) => parseInt(n, 10) || 0);
  const [x, y] = [nums(a), nums(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}

async function checkForUpdate({ quiet }) {
  const config = readConfig();
  if (quiet && config.lastUpdateCheck && Date.now() - config.lastUpdateCheck < DAY) return;
  let latest;
  try {
    const res = await fetch(UPDATE_URL, { headers: { 'User-Agent': 'akko/' + app.getVersion(), Accept: 'application/vnd.github+json' } });
    if (!res.ok) throw new Error(res.status === 404 ? 'no releases published yet' : `GitHub answered ${res.status}`);
    latest = await res.json();
  } catch (err) {
    if (!quiet) dialog.showMessageBox({ type: 'info', message: "Couldn't check for updates", detail: err.message });
    return;
  }
  saveConfig({ lastUpdateCheck: Date.now() });
  const version = String(latest.tag_name || '').replace(/^v/i, '');
  if (!version || !newer(version, app.getVersion()) || (quiet && config.skipVersion === version)) {
    if (!quiet) dialog.showMessageBox({ type: 'info', message: 'You have the newest akko', detail: `Version ${app.getVersion()}.` });
    return;
  }
  const { response } = await dialog.showMessageBox({
    type: 'info',
    title: 'akko',
    message: `akko ${version} is out`,
    detail: `You have ${app.getVersion()}. Download the new installer from the release page and run it: your words and progress are kept.`,
    buttons: ['Open the download page', 'Later', 'Skip this version'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  });
  if (response === 0) shell.openExternal(latest.html_url || RELEASES);
  if (response === 2) saveConfig({ skipVersion: version });
}

// Without a tray icon, closing the last window ends everything (except on macOS, as usual there).
// With one (browser mode), the server keeps running until "Quit akko".
app.on('window-all-closed', () => {
  if (!tray && process.platform !== 'darwin') app.quit();
});
