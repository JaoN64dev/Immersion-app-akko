// One word list for everything: the desktop app's window, akko in any browser, phones on the
// Wi-Fi and the browser extension all use this list of word statuses (new / learning / known /
// ignored), one per language. Each page keeps a copy in its own storage, so it works instantly
// and while the server restarts, and keeps it in step (scripts/core/words-sync.js):
//   - what changed there is sent here (a word at a time, as you mark it)
//   - what changed elsewhere comes back: only the changes since the page's last sync, or the
//     whole list when it's too far behind (or new)
// The first time a page syncs, its list is merged in: words the server doesn't have are added;
// for a word both have, the server's status stays (or the page's, after a backup is restored).
// Saved in DATA/words.json.
//
//   POST /api/words/sync {lang, id, since, changes: {word: status}, merge?: {words, prefer: "server" | "local"}}
//        -> {id, v, changes: {word: status}} or {id, v, full: {word: status}}
//   GET  /api/words?lang=ja -> {id, v, words}
// "new" means the word isn't in the list (it's removed).

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { DATA } = require('./paths');

const router = express.Router();
const FILE = path.join(DATA, 'words.json');
const LANGS = ['ja', 'en'];
const STATUSES = ['new', 'learning', 'known', 'ignored'];
const KEEP = 20000;              // changes remembered, for pages catching up

const changed = new EventEmitter();     // "change" (lang): for akko accounts (server/cloud.js)
let cache = null;
function read() {
  if (cache) return cache;
  try { cache = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { cache = null; }
  if (!cache || !cache.id) cache = { id: crypto.randomBytes(6).toString('hex') };
  for (const lang of LANGS) if (!cache[lang]) cache[lang] = { v: 0, words: {}, journal: [] };
  return cache;
}

// written shortly after a change, not at every click
let timer = null;
function save() {
  clearTimeout(timer);
  timer = setTimeout(writeNow, 300);
}
function writeNow() {
  clearTimeout(timer);
  timer = null;
  if (!cache) return;
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(`${FILE}.tmp`, JSON.stringify(cache));
  fs.renameSync(`${FILE}.tmp`, FILE);
}
process.on('exit', () => { if (timer) writeNow(); });

const validWord = (w) => typeof w === 'string' && w.length > 0 && w.length <= 100;

// Set statuses; returns how many changed. Every change gets a version number.
function apply(lang, changes) {
  const list = read()[lang];
  let n = 0;
  for (const [w, s] of Object.entries(changes || {})) {
    if (!validWord(w) || !STATUSES.includes(s)) continue;
    if ((list.words[w] || 'new') === s) continue;
    if (s === 'new') delete list.words[w]; else list.words[w] = s;
    list.journal.push({ v: ++list.v, w, s });
    n++;
  }
  if (list.journal.length > KEEP) list.journal.splice(0, list.journal.length - KEEP);
  if (n) { save(); changed.emit('change', lang); }
  return n;
}

// what changed since version v, the latest status per word, for akko accounts (server/cloud.js):
// {v, changes: {word: status}}, or changes null when v is too far back
function since(lang, v) {
  const list = read()[lang];
  const oldest = list.journal.length ? list.journal[0].v : list.v + 1;
  if (v < oldest - 1 || v > list.v) return { v: list.v, changes: null };
  const changes = {};
  for (const e of list.journal) if (e.v > v) changes[e.w] = e.s;
  return { v: list.v, changes };
}

function merge(lang, words, prefer) {
  const list = read()[lang];
  const add = {};
  for (const [w, s] of Object.entries(words || {})) {
    if (s === 'new') continue;
    if (prefer === 'local' || !list.words[w]) add[w] = s;
  }
  return apply(lang, add);
}

const words = (lang) => read()[lang].words;

router.post('/sync', express.json({ limit: '20mb' }), (req, res) => {
  const b = req.body || {};
  const lang = LANGS.includes(b.lang) ? b.lang : null;
  if (!lang) return res.status(400).json({ error: 'which language?' });
  const c = read();
  const list = c[lang];
  if (b.merge && typeof b.merge.words === 'object') merge(lang, b.merge.words, b.merge.prefer);
  apply(lang, b.changes);
  const since = Number(b.since) || 0;
  const oldest = list.journal.length ? list.journal[0].v : list.v + 1;
  // a page from another list (a new file), a new page, or one too far behind: the whole list
  if (b.id !== c.id || b.merge || since < oldest - 1 || since > list.v) return res.json({ id: c.id, v: list.v, full: list.words });
  const changes = {};
  for (const e of list.journal) if (e.v > since) changes[e.w] = e.s;
  res.json({ id: c.id, v: list.v, changes });
});

router.get('/', (req, res) => {
  const c = read();
  const lang = LANGS.includes(req.query.lang) ? req.query.lang : 'ja';
  res.json({ id: c.id, v: c[lang].v, words: c[lang].words });
});

// for tests
const reset = () => { if (timer) writeNow(); cache = null; };

module.exports = { router, apply, words, since, changed, reset, FILE, writeNow };
