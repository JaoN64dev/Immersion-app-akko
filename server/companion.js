// The akko companion browser extension (extension/) and akko's pages meet here, so they keep in
// step even when akko only runs in its own window, whose storage the extension can't reach:
//   - the extension adds what you did while watching to a log: word statuses, mined words, and
//     time spent on Japanese videos. Every akko window applies the log to its own storage
//     (scripts/core/companion.js) and remembers how far it got, so the desktop app and akko in a
//     browser both get everything.
//   - akko's windows send their word list, Anki settings and language; the extension reads them.
// Saved in DATA/companion.json. The log keeps the last 5000 entries, 60 days at most.
//
//   GET  /api/companion[?from=extension] -> {words, anki, native, at, seen}
//        words: akko's list, with the log's statuses akko hasn't applied yet on top
//   PUT  /api/companion/app  {words, anki, native, seq, epoch}       (akko's pages)
//   POST /api/companion/log  {entries: [...]}                         (the extension)
//        {kind: "status", lemma, status} | {kind: "mined", item} | {kind: "time", day, seconds, site, key, title, url}
//   GET  /api/companion/log?after=<seq>&epoch=<epoch> -> {epoch, last, entries: [{seq, at, kind, ...}]}
//        epoch changes if the file is started again, and then the whole log comes back
//   GET  /api/companion/extension -> {folder, version}; POST /api/companion/extension/open (the computer only)

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DATA } = require('./paths');

const router = express.Router();
const FILE = path.join(DATA, 'companion.json');
const KEEP = 5000;
const KEEP_DAYS = 60;
const STATUSES = ['new', 'learning', 'known', 'ignored'];

let cache = null;
function read() {
  if (cache) return cache;
  try { cache = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { cache = null; }
  if (!cache || !cache.epoch) cache = { epoch: crypto.randomBytes(6).toString('hex'), next: 1, log: [], app: { words: {}, anki: null, native: '', at: 0, seq: 0 }, seen: 0 };
  return cache;
}
function save() {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(cache));
  fs.renameSync(tmp, FILE);
}

const text = (v, max = 2000) => String(v ?? '').slice(0, max);

// only what each kind needs, in sensible sizes
function clean(e) {
  if (!e || typeof e !== 'object') return null;
  if (e.kind === 'status') {
    if (!STATUSES.includes(e.status) || !e.lemma || String(e.lemma).length > 100) return null;
    return { kind: 'status', lemma: String(e.lemma), status: e.status };
  }
  if (e.kind === 'time') {
    const seconds = Math.round(Number(e.seconds));
    if (!/^\d{4}-\d\d-\d\d$/.test(e.day) || !(seconds > 0 && seconds <= 3600)) return null;
    return { kind: 'time', day: e.day, seconds, site: text(e.site, 20), key: text(e.key, 300), title: text(e.title, 300), url: text(e.url, 500) };
  }
  if (e.kind === 'mined') {
    const m = e.item || {};
    if (!m.word) return null;
    return { kind: 'mined', item: {
      id: text(m.id || `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`, 80),
      word: text(m.word, 100), reading: text(m.reading, 100),
      forms: Array.isArray(m.forms) ? m.forms.slice(0, 10).map((f) => text(f, 100)) : [],
      pitch: Array.isArray(m.pitch) ? m.pitch.filter(Number.isInteger).slice(0, 5) : [],
      meaning: text(m.meaning), surface: text(m.surface, 100), sentence: text(m.sentence), translation: text(m.translation),
      source: text(m.source, 300), time: text(m.time, 20), url: text(m.url, 500), videoName: text(m.videoName, 300),
      cueStart: Number.isFinite(m.cueStart) ? m.cueStart : null, cueEnd: Number.isFinite(m.cueEnd) ? m.cueEnd : null,
      ankiNoteId: Number.isFinite(m.ankiNoteId) ? m.ankiNoteId : undefined,
      lang: 'ja', added: Number.isFinite(m.added) ? m.added : Date.now(),
    } };
  }
  return null;
}

// akko's word list as the extension should see it: the statuses akko hasn't applied yet on top
function wordsNow(c) {
  const words = { ...(c.app.words || {}) };
  for (const e of c.log) {
    if (e.kind !== 'status' || e.seq <= (c.app.seq || 0)) continue;
    if (e.status === 'new') delete words[e.lemma]; else words[e.lemma] = e.status;
  }
  return words;
}

router.get('/', (req, res) => {
  const c = read();
  // when the extension last asked (shown in akko's settings); written at most once a minute
  if (req.query.from === 'extension') { const was = c.seen; c.seen = Date.now(); if (c.seen - was > 60e3) save(); }
  res.json({ words: wordsNow(c), anki: c.app.anki, native: c.app.native, at: c.app.at, seen: c.seen });
});

router.put('/app', express.json({ limit: '20mb' }), (req, res) => {
  const c = read();
  const b = req.body || {};
  if (!b.words || typeof b.words !== 'object' || Array.isArray(b.words)) return res.status(400).json({ error: 'no word list' });
  c.app = {
    words: b.words,
    anki: b.anki && typeof b.anki === 'object' ? b.anki : null,
    native: text(b.native, 20),
    at: Date.now(),
    // how far into the log this list already is
    seq: b.epoch === c.epoch && Number.isInteger(b.seq) ? Math.min(b.seq, c.next - 1) : 0,
  };
  save();
  res.json({ ok: true });
});

router.post('/log', express.json({ limit: '5mb' }), (req, res) => {
  const list = Array.isArray(req.body && req.body.entries) ? req.body.entries : null;
  if (!list) return res.status(400).json({ error: 'no entries' });
  const c = read();
  const now = Date.now();
  let added = 0;
  for (const raw of list.slice(0, 1000)) {
    const e = clean(raw);
    if (!e) continue;
    c.log.push({ seq: c.next++, at: now, ...e });
    added++;
  }
  const oldest = now - KEEP_DAYS * 864e5;
  c.log = c.log.filter((e) => e.at >= oldest).slice(-KEEP);
  save();
  res.json({ added, last: c.next - 1 });
});

router.get('/log', (req, res) => {
  const c = read();
  const after = req.query.epoch === c.epoch ? Number(req.query.after) || 0 : 0;
  res.json({ epoch: c.epoch, last: c.next - 1, entries: c.log.filter((e) => e.seq > after) });
});

// the extension's folder on this computer (the desktop app installs it next to itself), and
// opening it, so it can be picked in Chrome's "Load unpacked"
const extensionDir = () => process.env.AKKO_EXTENSION || path.join(__dirname, '..', 'extension');
router.get('/extension', (req, res) => {
  const folder = extensionDir();
  let version = null;
  try { version = JSON.parse(fs.readFileSync(path.join(folder, 'manifest.json'), 'utf8')).version; } catch { /* not there */ }
  res.json({ folder: req.viaLan ? null : folder, version });
});
router.post('/extension/open', (req, res) => {
  if (req.viaLan) return res.status(403).json({ error: 'only on the computer akko runs on' });
  const folder = extensionDir();
  if (!fs.existsSync(path.join(folder, 'manifest.json'))) return res.status(404).json({ error: 'the extension folder is missing' });
  const opener = process.platform === 'win32' ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  try {
    require('child_process').spawn(opener, [folder], { detached: true, stdio: 'ignore' }).unref();
    res.json({ ok: true, folder });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// for tests
const reset = () => { cache = null; };

module.exports = { router, reset, FILE };
