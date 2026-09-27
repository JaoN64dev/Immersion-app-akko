// Manga OCR with mokuro, run on this computer (https://github.com/kha-white/mokuro)
//   GET    /api/ocr/status               -> {installed, version, python, busy}
//   GET    /api/ocr/cached/:key          -> the .mokuro JSON saved for this volume, or 404
//   POST   /api/ocr/jobs  {key, title, total}          -> {id}
//   PUT    /api/ocr/jobs/:id/pages/:name  (raw image)  -> {ok}
//   POST   /api/ocr/jobs/:id/run                        -> {ok}
//   GET    /api/ocr/jobs/:id              -> {state, done, total, error}
//   DELETE /api/ocr/jobs/:id              -> cancels and cleans up
// The browser sends the pages it has open (it can't give us a folder path), mokuro reads
// them in a temp folder, and the result is kept in data/ocr/<key>.mokuro so each volume is
// only done once. mokuro is a Python program: `pip install mokuro`. Set AKKO_PYTHON to
// use a specific python.exe.

const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFile } = require('child_process');

const router = express.Router();
const PYTHON = process.env.AKKO_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const CACHE = path.join(__dirname, '..', 'data', 'ocr');
const WORK = path.join(os.tmpdir(), 'akko-ocr');
const IMAGE = /^[\w-]+\.(jpe?g|png|webp|gif|avif|bmp)$/i;

const jobs = new Map();         // id -> {id, key, title, total, dir, pagesDir, state, error, proc, log}
let running = null;             // only one mokuro at a time: it uses all the CPU

const safeKey = (k) => /^[a-f0-9]{16,64}$/.test(k) ? k : null;
const cacheFile = (key) => path.join(CACHE, key + '.mokuro');

// ---------- is mokuro installed? ----------

let statusCache = null;
function checkMokuro() {
  if (statusCache) return statusCache;
  statusCache = new Promise((resolve) => {
    execFile(PYTHON, ['-c', 'import importlib.metadata as m; print(m.version("mokuro"))'],
      { timeout: 30000, windowsHide: true }, (err, stdout) => {
        const version = !err && stdout.trim();
        if (!version) statusCache = null;          // check again next time (maybe installed since)
        resolve({ installed: !!version, version: version || null, python: PYTHON });
      });
  });
  return statusCache;
}

router.get('/status', async (req, res) => {
  res.json({ ...(await checkMokuro()), busy: !!running });
});

// ---------- saved results ----------

router.get('/cached/:key', (req, res) => {
  const key = safeKey(req.params.key);
  if (!key || !fs.existsSync(cacheFile(key))) return res.status(404).json({ error: 'not done yet' });
  res.type('application/json').sendFile(cacheFile(key));
});

// ---------- jobs ----------

function cleanup(job) {
  fs.rm(job.dir, { recursive: true, force: true }, () => {});
}

router.post('/jobs', express.json(), (req, res) => {
  const key = safeKey(String(req.body.key || ''));
  const total = Number(req.body.total);
  if (!key || !(total > 0)) return res.status(400).json({ error: 'bad request' });
  if (running) return res.status(409).json({ error: 'another volume is being read, wait for it to finish' });
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const dir = path.join(WORK, id);
  const pagesDir = path.join(dir, 'volume');
  fs.mkdirSync(pagesDir, { recursive: true });
  jobs.set(id, { id, key, title: String(req.body.title || ''), total, dir, pagesDir, state: 'uploading', error: null, log: '' });
  res.json({ id });
});

router.put('/jobs/:id/pages/:name', express.raw({ type: '*/*', limit: '60mb' }), (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job || job.state !== 'uploading') return res.status(404).json({ error: 'no such job' });
  if (!IMAGE.test(req.params.name)) return res.status(400).json({ error: 'bad page name' });
  fs.writeFileSync(path.join(job.pagesDir, req.params.name), req.body);
  res.json({ ok: true });
});

// pages mokuro has finished: it writes one .json per page into _ocr/volume/
function pagesDone(job) {
  try { return fs.readdirSync(path.join(job.dir, '_ocr', 'volume')).filter((f) => f.endsWith('.json')).length; }
  catch { return 0; }
}

router.post('/jobs/:id/run', async (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job || job.state !== 'uploading') return res.status(404).json({ error: 'no such job' });
  if (running) return res.status(409).json({ error: 'another volume is being read' });
  const status = await checkMokuro();
  if (!status.installed) return res.status(503).json({ error: 'mokuro is not installed (pip install mokuro)' });

  job.state = 'running';
  running = job;
  job.proc = spawn(PYTHON, ['-m', 'mokuro', job.pagesDir, '--disable_confirmation=True', '--legacy_html=False'], {
    cwd: job.dir,
    windowsHide: true,
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
  });
  const keep = (d) => { job.log = (job.log + d.toString()).slice(-4000); };
  job.proc.stdout.on('data', keep);
  job.proc.stderr.on('data', keep);
  job.proc.on('error', (err) => { job.state = 'failed'; job.error = err.message; running = null; });
  job.proc.on('close', (code) => {
    running = null;
    if (job.state === 'cancelled') return cleanup(job);
    const out = path.join(job.dir, 'volume.mokuro');
    if (code === 0 && fs.existsSync(out)) {
      fs.mkdirSync(CACHE, { recursive: true });
      fs.copyFileSync(out, cacheFile(job.key));
      job.state = 'done';
    } else {
      job.state = 'failed';
      const lines = job.log.trim().split('\n').filter((l) => !/%\|/.test(l));
      job.error = lines.slice(-3).join(' ').slice(0, 400) || `mokuro stopped (code ${code})`;
      console.error('ocr failed:', job.log.slice(-1500));
    }
    cleanup(job);
  });
  console.log(`ocr: reading ${job.total} pages of ${job.title || job.key}`);
  res.json({ ok: true });
});

router.get('/jobs/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'no such job' });
  const done = job.state === 'done' ? job.total : pagesDone(job);
  // the first run downloads the OCR models; say so while nothing is done yet
  const loadingModels = job.state === 'running' && done === 0;
  res.json({ state: job.state, done, total: job.total, error: job.error, loadingModels, key: job.key });
});

router.delete('/jobs/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'no such job' });
  if (job.proc && job.state === 'running') {
    job.state = 'cancelled';
    // mokuro may start helpers; take the whole tree down
    if (process.platform === 'win32') execFile('taskkill', ['/pid', String(job.proc.pid), '/T', '/F'], () => {});
    else job.proc.kill();
  } else {
    job.state = 'cancelled';
    cleanup(job);
  }
  res.json({ ok: true });
});

module.exports = { router };
