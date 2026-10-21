// The akko companion browser extension (extension/) and akko's pages meet here, so they keep in
// step even when akko only runs in its own window, whose storage the extension can't reach:
//   - word statuses from the extension go straight into akko's one word list (server/words.js)
//   - the extension adds the rest of what you did while watching to a log: mined words, and time
//     spent on Japanese videos. Every akko window applies the log to its own storage
//     (scripts/core/companion.js) and remembers how far it got, so the desktop app and akko in a
//     browser both get everything.
//   - akko's windows send their Anki settings, your language, the language you're learning and the
//     interface's; the extension reads them, and the word lists (Japanese and English).
// Everything from the extension says which language it was in (lang "ja" or "en"; "ja" when missing,
// as older versions of the extension only did Japanese).
// Saved in DATA/companion.json. The log keeps the last 5000 entries, 60 days at most.
//
//   GET  /api/companion[?from=extension] -> {words, wordsEn (the word lists), anki, native, target, ui, at, seen}
//   PUT  /api/companion/app  {anki, native, target, ui}               (akko's pages)
//   POST /api/companion/log  {entries: [...]}                         (the extension)
//        {kind: "status", lemma, status, lang} | {kind: "mined", item (with lang)} | {kind: "time", day, seconds, site, key, title, url, lang}
//   GET  /api/companion/log?after=<seq>&epoch=<epoch> -> {epoch, last, entries: [{seq, at, kind, ...}]}
//        epoch changes if the file is started again, and then the whole log comes back
//   GET  /api/companion/extension -> {folder, version}; POST /api/companion/extension/open (the computer only)
//   POST /api/companion/media/<mined id> {kind: "audio" | "picture", ext, data (base64)}   (the extension)
//   GET  /api/companion/media/<mined id>/<kind>     a mined word's line audio / picture, for akko's windows
//        (in DATA/companion-media, kept as long as the log: 60 days)

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DATA } = require('./paths');
const wordList = require('./words');
const sync = require('./sync');

const router = express.Router();
const FILE = path.join(DATA, 'companion.json');
const KEEP = 5000;
const KEEP_DAYS = 60;
const MEDIA = path.join(DATA, 'companion-media');
const MEDIA_TYPES = { webm: 'audio/webm', ogg: 'audio/ogg', mp3: 'audio/mpeg', wav: 'audio/wav', jpg: 'image/jpeg' };
const safeId = (id) => /^[\w-]{1,80}$/.test(String(id || ''));
const STATUSES = ['new', 'learning', 'known', 'ignored'];

let cache = null;
function read() {
  if (cache) return cache;
  try { cache = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { cache = null; }
  if (!cache || !cache.epoch) cache = { epoch: crypto.randomBytes(6).toString('hex'), next: 1, log: [], app: { anki: null, native: '', at: 0 }, seen: 0 };
  return cache;
}
function save() {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(cache));
  fs.renameSync(tmp, FILE);
}

const text = (v, max = 2000) => String(v ?? '').slice(0, max);
const langOf = (l) => (l === 'en' ? 'en' : 'ja');

// only what each kind needs, in sensible sizes
function clean(e) {
  if (!e || typeof e !== 'object') return null;
  if (e.kind === 'status') {
    if (!STATUSES.includes(e.status) || !e.lemma || String(e.lemma).length > 100) return null;
    return { kind: 'status', lemma: String(e.lemma), status: e.status, lang: langOf(e.lang) };
  }
  if (e.kind === 'time') {
    const seconds = Math.round(Number(e.seconds));
    if (!/^\d{4}-\d\d-\d\d$/.test(e.day) || !(seconds > 0 && seconds <= 3600)) return null;
    return { kind: 'time', day: e.day, seconds, site: text(e.site, 20), key: text(e.key, 300), title: text(e.title, 300), url: text(e.url, 500), lang: langOf(e.lang) };
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
      // which recordings were sent with it (POST /media): {audio: "webm", picture: "jpg"}
      media: m.media && typeof m.media === 'object'
        ? Object.fromEntries(['audio', 'picture'].filter((k) => MEDIA_TYPES[m.media[k]]).map((k) => [k, m.media[k]])) : undefined,
      lang: langOf(m.lang), added: Number.isFinite(m.added) ? m.added : Date.now(),
    } };
  }
  return null;
}

router.get('/', (req, res) => {
  const c = read();
  // when the extension last asked (shown in akko's settings); written at most once a minute
  if (req.query.from === 'extension') { const was = c.seen; c.seen = Date.now(); if (c.seen - was > 60e3) save(); }
  res.json({ words: wordList.words('ja'), wordsEn: wordList.words('en'), anki: c.app.anki, native: c.app.native,
    target: c.app.target || 'ja', ui: c.app.ui || '', at: c.app.at || 1, seen: c.seen });
});

router.put('/app', express.json({ limit: '20mb' }), (req, res) => {
  const c = read();
  const b = req.body || {};
  if (b.anki !== undefined && b.anki !== null && (typeof b.anki !== 'object' || Array.isArray(b.anki))) return res.status(400).json({ error: 'bad Anki settings' });
  c.app = { anki: b.anki || null, native: text(b.native, 20), target: langOf(b.target), ui: /^(en|ja|pt|es)$/.test(b.ui) ? b.ui : '', at: Date.now() };
  save();
  res.json({ ok: true });
});

router.post('/log', express.json({ limit: '5mb' }), (req, res) => {
  const list = Array.isArray(req.body && req.body.entries) ? req.body.entries : null;
  if (!list) return res.status(400).json({ error: 'no entries' });
  const c = read();
  const now = Date.now();
  let added = 0;
  const statuses = { ja: {}, en: {} };
  for (const raw of list.slice(0, 1000)) {
    const e = clean(raw);
    if (!e) continue;
    added++;
    if (e.kind === 'status') { statuses[e.lang][e.lemma] = e.status; continue; }     // straight into the word list
    if (e.kind === 'time') sync.addSeconds(e.lang, 'extension', e.day, e.seconds);    // today and the streak, once
    c.log.push({ seq: c.next++, at: now, ...e });
  }
  for (const lang of ['ja', 'en']) if (Object.keys(statuses[lang]).length) wordList.apply(lang, statuses[lang]);
  const oldest = now - KEEP_DAYS * 864e5;
  c.log = c.log.filter((e) => e.at >= oldest).slice(-KEEP);
  save();
  pruneMedia(oldest);
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

// ---------- a mined word's line audio and picture, from the extension ----------

function pruneMedia(oldest) {
  let files = [];
  try { files = fs.readdirSync(MEDIA); } catch { return; }
  for (const f of files) {
    try { if (fs.statSync(path.join(MEDIA, f)).mtimeMs < oldest) fs.unlinkSync(path.join(MEDIA, f)); } catch { /* gone already */ }
  }
}

router.post('/media/:id', express.json({ limit: '15mb' }), (req, res) => {
  const { kind, ext, data } = req.body || {};
  if (!safeId(req.params.id) || !['audio', 'picture'].includes(kind) || !MEDIA_TYPES[ext] || typeof data !== 'string') {
    return res.status(400).json({ error: 'not a recording' });
  }
  if ((kind === 'picture') !== (ext === 'jpg')) return res.status(400).json({ error: 'not a recording' });
  fs.mkdirSync(MEDIA, { recursive: true });
  fs.writeFileSync(path.join(MEDIA, `${req.params.id}.${kind}.${ext}`), Buffer.from(data, 'base64'));
  res.json({ ok: true });
});

router.get('/media/:id/:kind', (req, res) => {
  if (!safeId(req.params.id) || !['audio', 'picture'].includes(req.params.kind)) return res.status(404).end();
  let files = [];
  try { files = fs.readdirSync(MEDIA); } catch { /* none yet */ }
  const name = files.find((f) => f.startsWith(`${req.params.id}.${req.params.kind}.`));
  if (!name) return res.status(404).end();
  res.type(MEDIA_TYPES[name.split('.').pop()]).sendFile(path.join(MEDIA, name));
});

// for tests
const reset = () => { cache = null; };

module.exports = { router, reset, FILE };
