// akko accounts: your word list and mined words (with their recordings) in step between
// computers anywhere, through akko's online service (cloud/; its address: AKKO_CLOUD, or
// "akko.cloud" in package.json). This server talks to it, not the pages: what it sends is what
// akko's other parts already keep here (the word lists, server/words.js; the mined words and
// their recordings, server/sync.js), and what comes back goes into them, so the pages, phones and
// the browser extension get it the usual way.
//
// Every minute while signed in, and a few seconds after something changes here:
//   - the words and mined words that changed here since last time go out (the very first time,
//     everything, and for a word or mined word both sides have, the account's wins)
//   - what changed elsewhere comes in; the last change wins, per word and per mined word
//   - recordings go both ways, 10 each way at a time
// Offline, everything keeps working; changes wait and go when the service is back.
//
//   GET  /api/cloud                 -> {available, signedIn, email, last, error, words, mined, syncing}
//   POST /api/cloud/signup  {email, password, agree} -> {recovery} (shown once, to keep)
//   POST /api/cloud/signin  {email, password}
//   POST /api/cloud/recover {email, recovery, password} -> {recovery} (a new one)
//   POST /api/cloud/signout · POST /api/cloud/sync (now)
//   GET  /api/cloud/devices · DELETE /api/cloud/devices/<id>
//   GET  /api/cloud/export          everything the account holds, as a file
//   POST /api/cloud/delete {password}   the account and everything in it
// The computer akko runs on only. Saved in DATA/cloud.json (the e-mail, this computer's token,
// how far the sync got); the data folder never goes into git or the installer.

const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DATA } = require('./paths');
const words = require('./words');
const sync = require('./sync');
const { cloudUrl } = require('./diagnostics');

const router = express.Router();
const FILE = path.join(DATA, 'cloud.json');
const LANGS = { 'words-ja': 'ja', 'words-en': 'en' };
const CHUNK = 1000;           // changes per request (the service takes up to 1000)
const EVERY = 60e3;
const SOON = 8e3;

// ---------- what's saved ----------
let state = null;
function read() {
  if (state) return state;
  try { state = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { state = {}; }
  state.since = state.since || {};
  state.pushed = state.pushed || {};
  return state;
}
function save() {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(`${FILE}.tmp`, JSON.stringify(state));
  fs.renameSync(`${FILE}.tmp`, FILE);
}
function signedOut(reason = '') {
  state = { since: {}, pushed: {}, error: reason };
  save();
}

// ---------- the service ----------
async function call(method, p, { body, raw, type } = {}) {
  const base = cloudUrl();
  if (!base) throw Object.assign(new Error("akko accounts aren't available in this version"), { status: 503 });
  const headers = {};
  const s = read();
  if (s.token) headers.Authorization = `Bearer ${s.token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (type) headers['Content-Type'] = type;
  let r;
  try {
    r = await fetch(base + p, { method, headers, body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined), signal: AbortSignal.timeout(30000) });
  } catch {
    throw Object.assign(new Error("can't reach akko's online service (no internet?)"), { status: 502 });
  }
  if (r.status === 401 && s.token && p !== '/account') {
    signedOut('signed out (from another device, or the password changed): sign in again');
    throw Object.assign(new Error('signed out: sign in again'), { status: 401 });
  }
  if (raw === undefined && method === 'GET' && p.startsWith('/media/')) return r;
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || `akko's online service answered ${r.status}`), { status: r.status });
  return j;
}
const deviceName = () => `${os.hostname()} · ${process.versions.electron ? 'akko desktop app' : 'akko'}`;

// ---------- one round ----------
const echo = new Map();       // what came in, so it doesn't go straight back out: "lang\tword" -> status

// a collection, in chunks: send `changes`, take what changed elsewhere (every page of it)
async function exchange(coll, changes, take, media = false) {
  const s = read();
  let there = null;
  let i = 0;
  do {
    let chunk = changes.slice(i, i + CHUNK);
    i += CHUNK;
    let more;
    do {
      const r = await call('POST', '/sync', { body: { collections: { [coll]: { since: s.since[coll] || 0, changes: chunk } }, media } });
      chunk = [];                 // sent: the next pages only take
      const got = r.collections[coll];
      await take(got.changes);
      s.since[coll] = got.v;
      if (r.media) there = r.media;
      more = got.more;
    } while (more);
  } while (i < changes.length);
  return there;
}

async function syncWords(coll, lang) {
  const s = read();
  const now = Date.now();
  const local = words.since(lang, s.pushed[lang] ?? -1);
  let changes;
  if (s.pushed[lang] === undefined || local.changes === null) {
    // the first time (or too long ago): every word, and the account's status wins where both have one
    changes = Object.entries(words.words(lang)).map(([k, value]) => ({ k, value, updated: 0 }));     // 0: only where the account has none
  } else {
    changes = [];
    for (const [k, st] of Object.entries(local.changes)) {
      const key = `${lang}\t${k}`;
      if (echo.get(key) === st) { echo.delete(key); continue; }
      changes.push(st === 'new' ? { k, deleted: true, updated: now } : { k, value: st, updated: now });
    }
  }
  await exchange(coll, changes, async (list) => {
    const apply = {};
    for (const c of list) {
      const st = c.deleted ? 'new' : String(c.value);
      if ((words.words(lang)[c.k] || 'new') === st) continue;
      apply[c.k] = st;
      echo.set(`${lang}\t${c.k}`, st);
    }
    words.apply(lang, apply);
  });
  s.pushed[lang] = local.v;
}

async function syncMined() {
  const s = read();
  const local = sync.since('mined', s.pushed.mined ?? 0);
  const changes = local.changes.filter((c) => { const back = echo.get(`mined\t${c.k}`) === c.updated; if (back) echo.delete(`mined\t${c.k}`); return !back; })
    .map((c) => (c.deleted ? { k: c.k, deleted: true, updated: c.updated } : { k: c.k, value: c.value, updated: c.updated }));
  const there = await exchange('mined', changes, async (list) => {
    for (const c of list) {
      if (sync.put('mined', c.k, { value: c.value, updated: c.updated, deleted: !!c.deleted })) echo.set(`mined\t${c.k}`, c.updated);
    }
  }, true);
  s.pushed.mined = local.v;
  return there || [];
}

// recordings both ways: the ones of mined words both sides have
async function recordings(there) {
  const remote = new Set(there);
  const here = sync.media();
  const minedHere = new Set(sync.since('mined', 0).changes.filter((c) => !c.deleted).map((c) => c.k));
  let up = 0, down = 0;
  for (const [id, kinds] of Object.entries(here)) {
    if (remote.has(id) || !minedHere.has(id) || up >= 10) continue;
    for (const kind of Object.keys(kinds)) {
      const m = sync.readMedia(id, kind);
      if (m) await call('PUT', `/media/${encodeURIComponent(id)}/${kind}`, { raw: m.bytes, type: m.type });
    }
    up++;
  }
  for (const id of remote) {
    if (here[id] || !minedHere.has(id) || down >= 10) continue;
    for (const kind of ['audio', 'picture']) {
      const r = await call('GET', `/media/${encodeURIComponent(id)}/${kind}`);
      if (r.ok) sync.writeMedia(id, kind, (r.headers.get('content-type') || '').split(';')[0], Buffer.from(await r.arrayBuffer()));
    }
    down++;
  }
}

let running = null;
function round() {
  if (running) return running;
  const job = (async () => {
    const s = read();
    if (!s.token || !cloudUrl()) return;
    try {
      for (const [coll, lang] of Object.entries(LANGS)) await syncWords(coll, lang);
      await recordings(await syncMined());
      s.last = Date.now();
      s.error = '';
    } catch (err) {
      if (read().token) s.error = err.message;
    } finally {
      if (read().token) save();
    }
  })();
  // (cleared once it's over, even when it's over at once: signed out, nothing to do)
  running = job.finally(() => { running = null; });
  return running;
}

// ---------- routes (the computer only) ----------
const fromComputer = (req, res, next) => (req.viaLan ? res.status(403).json({ error: 'only the computer akko runs on can change this' }) : next());
router.use(fromComputer);
const route = (fn) => async (req, res) => {
  try { res.json(await fn(req, res)); } catch (err) { res.status(err.status && err.status < 600 ? err.status : 500).json({ error: err.message }); }
};

function status() {
  const s = read();
  return {
    available: !!cloudUrl(),
    signedIn: !!s.token,
    email: s.email || '',
    last: s.last || 0,
    error: s.error || '',
    syncing: !!running,
    words: Object.keys(words.words('ja')).length + Object.keys(words.words('en')).length,
    mined: sync.since('mined', 0).changes.filter((c) => !c.deleted).length,
  };
}

function signedIn(email, token) {
  state = { email, token, since: {}, pushed: {}, error: '' };
  save();
  setTimeout(round, 100).unref?.();
}

router.get('/', (req, res) => res.json(status()));
router.post('/signup', express.json(), route(async (req) => {
  const b = req.body || {};
  if (b.agree !== true) throw Object.assign(new Error('read and accept how your data is kept first'), { status: 400 });
  const r = await call('POST', '/signup', { body: { email: b.email, password: b.password, device: deviceName() } });
  signedIn(String(b.email).trim().toLowerCase(), r.token);
  return { recovery: r.recovery };
}));
router.post('/signin', express.json(), route(async (req) => {
  const b = req.body || {};
  const r = await call('POST', '/signin', { body: { email: b.email, password: b.password, device: deviceName() } });
  signedIn(String(b.email).trim().toLowerCase(), r.token);
  return { ok: true };
}));
router.post('/recover', express.json(), route(async (req) => {
  const b = req.body || {};
  const r = await call('POST', '/recover', { body: { email: b.email, recovery: b.recovery, password: b.password, device: deviceName() } });
  signedIn(String(b.email).trim().toLowerCase(), r.token);
  return { recovery: r.recovery };
}));
router.post('/signout', route(async () => {
  await call('POST', '/signout').catch(() => {});
  signedOut();
  return { ok: true };
}));
router.post('/sync', route(async () => { await round(); return status(); }));
router.get('/devices', route(() => call('GET', '/devices')));
router.delete('/devices/:id', route((req) => call('DELETE', `/devices/${encodeURIComponent(req.params.id)}`)));
router.get('/export', async (req, res) => {
  try {
    const data = await call('GET', '/export');
    res.setHeader('Content-Disposition', `attachment; filename="akko-account-${new Date().toISOString().slice(0, 10)}.json"`);
    res.json(data);
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});
router.post('/delete', express.json(), route(async (req) => {
  await call('DELETE', '/account', { body: { password: (req.body || {}).password } });
  signedOut();
  return { ok: true };
}));

// ---------- running ----------
let timer = null, soon = null;
function start() {
  if (timer) return;
  timer = setInterval(round, EVERY);
  timer.unref?.();
  const later = () => { clearTimeout(soon); soon = setTimeout(round, SOON); soon.unref?.(); };
  words.changed.on('change', later);
  sync.changed.on('change', (name) => { if (name === 'mined' || name === 'media') later(); });
  setTimeout(round, 3000).unref?.();
}

// for tests
const reset = () => { state = null; echo.clear(); };

module.exports = { router, start, round, status, reset, FILE };
