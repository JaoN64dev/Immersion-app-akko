// Everything else in step: the word list has its own route (server/words.js); this one keeps the
// rest of what akko's pages save in step between the desktop app's window, browsers and phones
// (scripts/core/sync.js): positions in videos, books and podcasts, 復習's cards, grammar and the
// course, the listening drills, mined words (with their recordings), the library, settings
// worth sharing, and the time spent per device.
//
// A collection is a set of records {key: {value, updated, deleted?, v}}. A change is kept when it's
// newer (updated, ms) than what's here: the last change wins, per record. Deleting leaves a
// tombstone, so it reaches every device; tombstones go after 120 days (pages that were away longer
// get everything again). v is the version the record last changed at, so a page asks only for
// what changed since its last sync.
//
//   POST /api/sync {id, collections: {name: {since, changes: [{k, value, updated, deleted}]}}, media?}
//        -> {id, collections: {name: {v, changes: [...]}}, media?: [mined ids with recordings]}
//        a page whose id isn't this server's (new data folder) starts again from nothing
//   PUT  /api/sync/media/<mined id>/<audio | picture>   the recording itself (its type in Content-Type)
//   GET  /api/sync/media/<mined id>/<audio | picture>
// Saved in DATA/sync/<collection>.json and DATA/sync/media/.

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DATA } = require('./paths');

const router = express.Router();
const DIR = path.join(DATA, 'sync');
const MEDIA = path.join(DIR, 'media');
const META = path.join(DIR, 'meta.json');            // {id, v}
const MEDIA_INDEX = path.join(MEDIA, 'index.json');   // {minedId: {audio: type, picture: type}}
const TOMBSTONE_DAYS = 120;
const NAME = /^[a-z][a-z0-9-]{0,39}$/;
const safeId = (id) => /^[\w-]{1,80}$/.test(String(id || ''));
const KINDS = ['audio', 'picture'];
const TYPES = /^(audio\/(webm|ogg|mpeg|wav|mp4)|image\/(jpeg|png|webp))$/;

let meta = null;
const collections = new Map();        // name -> {floor, records}
const dirty = new Set();
let mediaIndex = null;

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(value));
  fs.renameSync(`${file}.tmp`, file);
}

function getMeta() {
  if (!meta) meta = readJson(META, null);
  if (!meta || !meta.id) { meta = { id: crypto.randomBytes(6).toString('hex'), v: 0 }; dirty.add('meta'); save(); }
  return meta;
}
function coll(name) {
  if (!collections.has(name)) {
    const c = readJson(path.join(DIR, `${name}.json`), null) || { floor: 0, records: {} };
    collections.set(name, c);
  }
  return collections.get(name);
}

// written a moment after changes
let timer = null;
function save() { clearTimeout(timer); timer = setTimeout(writeNow, 400); }
function writeNow() {
  clearTimeout(timer);
  timer = null;
  for (const name of dirty) {
    if (name === 'meta') writeJson(META, meta);
    else if (name === 'media') writeJson(MEDIA_INDEX, mediaIndex);
    else writeJson(path.join(DIR, `${name}.json`), collections.get(name));
  }
  dirty.clear();
}
process.on('exit', () => { if (timer) writeNow(); });

// does the newer one win? (the same time: the larger value, so every device decides alike)
const newer = (a, b) => a.updated > b.updated || (a.updated === b.updated && JSON.stringify(a.value ?? null) > JSON.stringify(b.value ?? null));

// a change from a page (or akko itself); true if it was kept
function put(name, k, { value = null, updated, deleted = false }) {
  if (typeof k !== 'string' || !k || k.length > 300 || !Number.isFinite(updated)) return false;
  const c = coll(name);
  const now = c.records[k];
  const rec = { value: deleted ? null : value, updated, deleted: !!deleted };
  if (now && !newer(rec, now)) return false;
  rec.v = ++getMeta().v;
  c.records[k] = rec;
  dirty.add(name);
  dirty.add('meta');
  if (deleted && name === 'mined') dropMedia(k);
  return true;
}

// tombstones older than TOMBSTONE_DAYS go; a page that last synced before them gets everything
function prune(name) {
  const c = coll(name);
  const oldest = Date.now() - TOMBSTONE_DAYS * 864e5;
  for (const [k, r] of Object.entries(c.records)) {
    if (r.deleted && r.updated < oldest) { c.floor = Math.max(c.floor, r.v); delete c.records[k]; dirty.add(name); }
  }
}

function changesSince(name, since) {
  const c = coll(name);
  const from = since < c.floor ? 0 : since;
  const out = [];
  for (const [k, r] of Object.entries(c.records)) if (r.v > from) out.push({ k, value: r.value, updated: r.updated, deleted: r.deleted || undefined });
  return out;
}

// time per device (scripts/core/today.js adds them up): the extension's time counts here as its
// own device, once, however many akko windows there are (server/companion.js)
function addSeconds(lang, device, day, seconds) {
  const name = lang === 'en' ? 'days-en' : 'days';
  const now = coll(name).records[device];
  const days = { ...((now && !now.deleted && now.value) || {}) };
  days[day] = (days[day] || 0) + seconds;
  put(name, device, { value: days, updated: Math.max(Date.now(), (now && now.updated + 1) || 0) });
  save();
}

router.post('/', express.json({ limit: '60mb' }), (req, res) => {
  const b = req.body || {};
  const m = getMeta();
  const fresh = b.id !== m.id;            // a new page, or this data folder is new: everything
  const out = {};
  for (const [name, c] of Object.entries(b.collections || {})) {
    if (!NAME.test(name) || !c || typeof c !== 'object') continue;
    for (const ch of Array.isArray(c.changes) ? c.changes.slice(0, 20000) : []) put(name, ch && ch.k, ch || {});
    prune(name);
    out[name] = { v: m.v, changes: changesSince(name, fresh ? 0 : Number(c.since) || 0) };
  }
  if (dirty.size) save();
  const reply = { id: m.id, collections: out };
  if (b.media) reply.media = Object.keys(media());
  res.json(reply);
});

// ---------- recordings ----------
function media() {
  if (!mediaIndex) mediaIndex = readJson(MEDIA_INDEX, {});
  return mediaIndex;
}
const mediaFile = (id, kind) => path.join(MEDIA, `${id}.${kind}`);
function dropMedia(id) {
  const idx = media();
  if (!idx[id]) return;
  for (const kind of KINDS) fs.rmSync(mediaFile(id, kind), { force: true });
  delete idx[id];
  dirty.add('media');
}

router.put('/media/:id/:kind', express.raw({ type: () => true, limit: '15mb' }), (req, res) => {
  const { id, kind } = req.params;
  const type = String(req.headers['content-type'] || '').split(';')[0].trim();
  if (!safeId(id) || !KINDS.includes(kind) || !TYPES.test(type) || !Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'not a recording' });
  fs.mkdirSync(MEDIA, { recursive: true });
  fs.writeFileSync(mediaFile(id, kind), req.body);
  const idx = media();
  idx[id] = { ...(idx[id] || {}), [kind]: type };
  dirty.add('media');
  save();
  res.json({ ok: true });
});

router.get('/media/:id/:kind', (req, res) => {
  const { id, kind } = req.params;
  const type = safeId(id) && KINDS.includes(kind) && (media()[id] || {})[kind];
  if (!type || !fs.existsSync(mediaFile(id, kind))) return res.status(404).json({ error: 'no such recording' });
  res.type(type).sendFile(mediaFile(id, kind));
});

// for tests
const reset = () => { if (timer) writeNow(); meta = null; mediaIndex = null; collections.clear(); };

module.exports = { router, put, addSeconds, reset, DIR };
