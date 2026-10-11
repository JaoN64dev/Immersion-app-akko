// VOICEVOX's voice engine, run by akko: natural-sounding Japanese voices for the listening drills
// (server/speech.js uses whatever answers at 127.0.0.1:50021).
//   GET  /api/speech/voicevox            -> {state, autostart, found, progress, error, terms}
//   POST /api/speech/voicevox/install    download VOICEVOX's engine from its official release and start it
//   POST /api/speech/voicevox/settings   {autostart: true | false}
//
// When akko starts (start()), the engine is started too, with no window, if VOICEVOX is on this
// computer: one akko downloaded (<data>/voicevox/), or a normal VOICEVOX install (the installer,
// winget). When akko stops, the engine akko started stops with it.
//
// akko never ships VOICEVOX itself: its terms don't allow passing it on, and it's ~1.9 GB. The
// "install" button downloads it, on your computer, from VOICEVOX's own GitHub release, after you
// agree to its terms. The voices must be credited ("VOICEVOX:<name>"); the listening page does.

const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFile } = require('child_process');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const { DATA } = require('./paths');

const router = express.Router();
const PORT = Number(process.env.AKKO_VOICEVOX_PORT) || 50021;      // another port: tests
const URL_ = `http://127.0.0.1:${PORT}`;
const DIR = path.join(DATA, 'voicevox');
const CONFIG = path.join(DIR, 'akko.json');
const RELEASES = process.env.AKKO_VOICEVOX_RELEASES || 'https://api.github.com/repos/VOICEVOX/voicevox_engine/releases/latest';
const TERMS = 'https://voicevox.hiroshiba.jp/term/';
const NEEDS_BYTES = 4.5e9;            // the download, and the unpacked engine next to it

let state = 'off';                    // off | starting | running | installing | failed
let engine = null;                    // the engine process akko started
let progress = null;                  // installing: {done, total, step}
let error = '';

const readConfig = () => { try { return JSON.parse(fs.readFileSync(CONFIG, 'utf8')); } catch { return {}; } };
const autostart = () => readConfig().autostart !== false;
function saveConfig(changes) {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(CONFIG, JSON.stringify({ ...readConfig(), ...changes }, null, 2));
}

async function answering() {
  try {
    const res = await fetch(URL_ + '/version', { signal: AbortSignal.timeout(800) });
    return res.ok;
  } catch { return false; }
}

// run.exe somewhere under dir (the engine's own folder has it at the top, or one folder down)
function runExeIn(dir, depth = 2) {
  try {
    if (fs.statSync(path.join(dir, 'run.exe')).isFile()) return path.join(dir, 'run.exe');
  } catch { /* not here */ }
  if (!depth) return null;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return null; }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const found = runExeIn(path.join(dir, e.name), depth - 1);
    if (found) return found;
  }
  return null;
}

// where VOICEVOX's engine is on this computer, or null
function findEngine() {
  if (process.platform !== 'win32') return null;
  const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const candidates = [
    path.join(DIR, 'engine'),                                         // downloaded by akko
    path.join(local, 'Programs', 'VOICEVOX', 'vv-engine'),            // the VOICEVOX installer
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'VOICEVOX', 'vv-engine'),
  ];
  // winget: %LOCALAPPDATA%\Microsoft\WinGet\Packages\HiroshibaKazuyuki.VOICEVOX…\VOICEVOX\vv-engine
  const winget = path.join(local, 'Microsoft', 'WinGet', 'Packages');
  try {
    for (const d of fs.readdirSync(winget)) {
      if (/^HiroshibaKazuyuki\.VOICEVOX/i.test(d)) candidates.push(path.join(winget, d, 'VOICEVOX', 'vv-engine'));
    }
  } catch { /* no winget packages */ }
  for (const c of candidates) {
    const exe = runExeIn(c, c.endsWith('engine') && c.startsWith(DIR) ? 2 : 0);
    if (exe) return exe;
  }
  return null;
}

// start the engine (no window) if it's here and not running yet; resolves once it answers
async function startEngine() {
  if (await answering()) { state = 'running'; return true; }
  const exe = findEngine();
  if (!exe) { state = 'off'; return false; }
  state = 'starting';
  error = '';
  engine = spawn(exe, ['--host', '127.0.0.1', '--port', String(PORT)], { cwd: path.dirname(exe), windowsHide: true, stdio: 'ignore' });
  watchSignals();
  engine.on('error', (err) => { error = err.message; state = 'failed'; engine = null; });
  engine.on('exit', () => { engine = null; if (state !== 'installing') state = 'off'; });
  // it takes a few seconds to load
  for (let i = 0; i < 90 && engine; i++) {
    if (await answering()) { state = 'running'; return true; }
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (state === 'starting') { state = 'failed'; error ||= "VOICEVOX didn't start"; }
  return false;
}

function stop() {
  if (engine) { engine.kill(); engine = null; }
}
process.on('exit', stop);
// Ctrl+C in the terminal (npm start) ends Node without 'exit': stop the engine first
let signalsWatched = false;
function watchSignals() {
  if (signalsWatched) return;
  signalsWatched = true;
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.once(sig, () => { stop(); process.exit(0); });
}

// when akko starts: start VOICEVOX too, unless that's turned off (doesn't wait for it)
function start() {
  if (autostart() && findEngine()) startEngine().catch(() => {});
}

// ---------- installing ----------

const freeBytes = (dir) => { try { const s = fs.statfsSync(dir); return s.bavail * s.bsize; } catch { return Infinity; } };

async function install() {
  state = 'installing';
  error = '';
  progress = { step: 'finding the newest VOICEVOX', done: 0, total: 0 };
  const tmp = path.join(DIR, 'download.vvpp');
  try {
    if (process.platform !== 'win32') throw new Error('this only works on Windows; get VOICEVOX from voicevox.hiroshiba.jp');
    fs.mkdirSync(DIR, { recursive: true });
    if (freeBytes(DIR) < NEEDS_BYTES) throw new Error(`not enough free space: it needs about ${Math.round(NEEDS_BYTES / 1e9)} GB`);
    const release = await (await fetch(RELEASES, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'akko' } })).json();
    // the CPU version works on every PC; one .vvpp file (a zip)
    const asset = (release.assets || []).find((a) => /windows-cpu.*\.vvpp$/i.test(a.name));
    if (!asset) throw new Error("couldn't find VOICEVOX's Windows download");
    progress = { step: `downloading VOICEVOX ${release.tag_name || ''}`.trim(), done: 0, total: asset.size };
    const res = await fetch(asset.browser_download_url, { headers: { 'User-Agent': 'akko' } });
    if (!res.ok || !res.body) throw new Error(`the download failed (${res.status})`);
    const counter = new (require('stream').Transform)({
      transform(chunk, enc, done) { progress.done += chunk.length; done(null, chunk); },
    });
    await pipeline(Readable.fromWeb(res.body), counter, fs.createWriteStream(tmp));
    progress = { step: 'unpacking (a minute or two)', done: 0, total: 0 };
    const dest = path.join(DIR, 'engine');
    fs.rmSync(dest, { recursive: true, force: true });
    fs.mkdirSync(dest, { recursive: true });
    // .vvpp is a zip; Windows' own tar unpacks zips (by its full path: another tar, like Git's,
    // may come first in PATH and can't)
    const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
    await new Promise((resolve, reject) => execFile(tar, ['-xf', tmp, '-C', dest], { windowsHide: true, maxBuffer: 1e7 },
      (err) => (err ? reject(new Error("couldn't unpack it: " + err.message)) : resolve())));
    if (!runExeIn(dest)) throw new Error('the download had no engine in it');
    fs.rmSync(tmp, { force: true });
    saveConfig({ autostart: true, installed: release.tag_name || '' });
    progress = { step: 'starting VOICEVOX', done: 0, total: 0 };
    state = 'starting';
    await startEngine();
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    error = err.message;
    state = 'failed';
  } finally {
    progress = null;
  }
}

// ---------- routes ----------

const status = () => ({ state, autostart: autostart(), found: !!findEngine(), progress, error, terms: TERMS });

router.get('/', async (req, res) => {
  if (state !== 'installing' && state !== 'starting') state = (await answering()) ? 'running' : state === 'failed' ? 'failed' : 'off';
  res.json(status());
});

router.post('/install', express.json(), (req, res) => {
  if (state === 'installing') return res.json(status());
  if (!req.body || req.body.agree !== true) return res.status(400).json({ error: "VOICEVOX's terms need to be accepted first" });
  install();
  res.json(status());
});

router.post('/start', async (req, res) => {
  if (state !== 'installing') startEngine().catch(() => {});
  res.json(status());
});

router.post('/settings', express.json(), async (req, res) => {
  if (typeof req.body?.autostart === 'boolean') {
    saveConfig({ autostart: req.body.autostart });
    if (req.body.autostart && state !== 'running') startEngine().catch(() => {});
    if (!req.body.autostart) stop();
  }
  res.json(status());
});

module.exports = { router, start, stop, findEngine, startEngine, status };
