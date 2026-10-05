// More dictionaries, next to the built-in JMdict: Yomitan-format .zip files (Jitendex, 新明解,
// 大辞泉, English dictionaries…). Each shows in the word popup under JMdict, in your order.
// Frequency lists (JPDB, Innocent Corpus…, Yomitan term_meta banks) add a rank badge to each
// entry instead.
//
//   GET    /api/dictionaries              -> the list (title, revision, entries, language, kind, on/off)
//   POST   /api/dictionaries/:id {enabled} -> turn one on or off
//   POST   /api/dictionaries/order {ids}   -> new order
//   DELETE /api/dictionaries/:id          -> remove one
// Adding one goes through POST /api/dictionary/upload (server/dictionary.js), which sees what
// kind of file it is and calls importZip() here.
//
// On disk, in <data>/dictionaries/<id>/: info.json, terms.jsonl (one entry per line), and the
// index: keys.txt (every word and reading, sorted, one per line) + index.bin (for each key, where
// its lines are in terms.jsonl). A lookup finds the key by halving the sorted list, then reads
// only the lines it needs: Jitendex (440,000 entries) costs about 50 MB of memory this way.

const fs = require('fs');
const path = require('path');
const express = require('express');
const AdmZip = require('adm-zip');
const { DATA } = require('./paths');

const DIR = path.join(DATA, 'dictionaries');
const LIST_FILE = path.join(DIR, 'list.json');
const PER_DICTIONARY = 8;                 // entries shown per dictionary in the popup

const router = express.Router();

// ---------- the list ----------

let list = null;                          // [{id, title, revision, lang, count, enabled}], in order

function readList() {
  if (!list) {
    try { list = JSON.parse(fs.readFileSync(LIST_FILE, 'utf8')); } catch { list = []; }
    // a folder that's gone (deleted by hand) drops out of the list
    list = list.filter((d) => fs.existsSync(path.join(DIR, d.id, 'terms.jsonl')));
  }
  return list;
}

function saveList() {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(LIST_FILE + '.new', JSON.stringify(list, null, 2));
  fs.renameSync(LIST_FILE + '.new', LIST_FILE);
}

// ---------- turning Yomitan's entries into safe HTML ----------

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Only plain formatting tags survive, without their attributes (no links, scripts, styles or
// images), so a dictionary file can't put anything into the page.
const TAGS = new Set(['span', 'div', 'ol', 'ul', 'li', 'ruby', 'rt', 'rp', 'table', 'thead', 'tbody', 'tfoot',
  'tr', 'td', 'th', 'b', 'i', 'small', 'sub', 'sup', 'details', 'summary']);
const safeName = (s) => String(s).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

function contentHtml(node) {
  if (node == null) return '';
  if (typeof node === 'string') return escapeHtml(node);
  if (Array.isArray(node)) return node.map(contentHtml).join('');
  if (typeof node !== 'object') return '';
  if (node.tag === 'br') return '<br>';
  if (node.tag === 'img' || node.type === 'image' || node.tag === 'script' || node.tag === 'style') return '';
  const inner = contentHtml(node.content);
  if (!TAGS.has(node.tag)) return inner;            // a, unknown tags: keep only their text
  // Yomitan's data-* names (e.g. Jitendex "sense-number") become classes, for styling
  const names = node.data && typeof node.data === 'object'
    ? Object.values(node.data).map(safeName).filter(Boolean).map((n) => 'yd-' + n) : [];
  const cls = names.length ? ` class="${names.join(' ')}"` : '';
  const lang = typeof node.lang === 'string' && /^[a-z]{2,3}(-[a-z0-9]+)?$/i.test(node.lang) ? ` lang="${node.lang}"` : '';
  return `<${node.tag}${cls}${lang}>${inner}</${node.tag}>`;
}

// one meaning: a string, {type: 'text'}, {type: 'structured-content'}; images and
// deinflection pairs are left out
function glossHtml(g) {
  if (typeof g === 'string') return escapeHtml(g);
  if (!g || typeof g !== 'object' || Array.isArray(g)) return '';
  if (g.type === 'text') return escapeHtml(g.text || '');
  if (g.type === 'structured-content') return contentHtml(g.content);
  return '';
}

// A term bank row: [term, reading, definition tags, rules, score, meanings, sequence, term tags]
// (format 3), or [term, reading, tags, rules, score, ...meanings] (format 1)
function entryFrom(row, format) {
  if (!Array.isArray(row) || typeof row[0] !== 'string' || !row[0]) return null;
  const meanings = format === 1 ? row.slice(5) : (Array.isArray(row[5]) ? row[5] : []);
  const h = meanings.map(glossHtml).filter((s) => s.trim());
  if (!h.length) return null;
  const tags = [row[2], format === 1 ? '' : row[7]].filter((t) => typeof t === 'string' && t.trim())
    .join(' ').split(/\s+/).filter(Boolean);
  const entry = { e: row[0], h };
  if (typeof row[1] === 'string' && row[1] && row[1] !== row[0]) entry.r = row[1];
  if (tags.length) entry.t = [...new Set(tags)];
  if (typeof row[4] === 'number' && row[4]) entry.s = row[4];
  return entry;
}

// A frequency row (term_meta_bank, Yomitan): [term, "freq", data], data being 1234, "1234",
// {value, displayValue} or {reading, frequency: any of those}. -> {e, r?, v (to sort), f (to show)}
function freqValue(data) {
  if (typeof data === 'number') return { v: data, f: String(data) };
  if (typeof data === 'string') { const n = parseFloat(data); return { v: Number.isNaN(n) ? Infinity : n, f: data }; }
  if (data && typeof data === 'object' && 'value' in data) {
    const v = Number(data.value);
    return { v: Number.isNaN(v) ? Infinity : v, f: String(data.displayValue ?? data.value) };
  }
  return null;
}

function freqFrom(row) {
  if (!Array.isArray(row) || typeof row[0] !== 'string' || !row[0] || row[1] !== 'freq') return null;
  const data = row[2];
  const withReading = data && typeof data === 'object' && 'frequency' in data;
  const value = freqValue(withReading ? data.frequency : data);
  if (!value) return null;
  const entry = { e: row[0], ...value };
  if (withReading && typeof data.reading === 'string' && data.reading !== row[0]) entry.r = data.reading;
  return entry;
}

// ---------- adding one ----------

// Is this zip a Yomitan dictionary? (index.json at the top, and term_bank files)
function isYomitan(buf) {
  if (buf[0] !== 0x50 || buf[1] !== 0x4b) return false;
  try {
    const names = new AdmZip(buf).getEntries().map((e) => e.entryName);
    return names.includes('index.json') && names.some((n) => /^(term|kanji|term_meta|kanji_meta)_bank_\d+\.json$/.test(n));
  } catch {
    return false;
  }
}

const bankNumber = (name) => Number((name.match(/_(\d+)\.json$/) || [])[1] || 0);
const pause = () => new Promise((r) => setImmediate(r));        // let other requests through

// lang: the language the dictionary is for, if its index.json doesn't say ('ja' or 'en')
async function importZip(buf, lang = 'ja') {
  const zip = new AdmZip(buf);
  let info;
  try { info = JSON.parse(zip.getEntry('index.json').getData().toString('utf8')); } catch { info = null; }
  if (!info || typeof info.title !== 'string' || !info.title.trim()) throw new Error("this dictionary's index.json is missing or has no title");
  const format = Number(info.format || info.version || 3);
  const bankFiles = (re) => zip.getEntries().filter((e) => re.test(e.entryName))
    .sort((a, b) => bankNumber(a.entryName) - bankNumber(b.entryName));
  // definitions (term banks), or else a frequency list (term_meta banks with "freq" rows)
  let banks = bankFiles(/^term_bank_\d+\.json$/);
  const kind = banks.length ? 'terms' : 'freq';
  if (kind === 'freq') banks = bankFiles(/^term_meta_bank_\d+\.json$/);
  if (!banks.length) {
    throw new Error('this dictionary has no word definitions or frequencies: pitch accent and kanji dictionaries aren\'t supported yet');
  }
  const convert = kind === 'terms' ? (row) => entryFrom(row, format) : freqFrom;

  const title = info.title.trim().slice(0, 100);
  readList();
  // the same dictionary again (a newer version): same update address, or else same title.
  // Jitendex puts the date in its title, so the title alone would add it twice.
  const source = String(info.indexUrl || info.downloadUrl || '');
  const old = list.find((d) => (source && d.source === source) || d.title === title);
  let id = old ? old.id : safeName(title) || 'dictionary';
  if (!old) for (let n = 2; list.some((d) => d.id === id); n++) id = `${safeName(title) || 'dictionary'}-${n}`;

  // build it next to the old one, then swap
  fs.mkdirSync(DIR, { recursive: true });
  const tmp = path.join(DIR, id + '.new');
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp);
  const out = fs.openSync(path.join(tmp, 'terms.jsonl'), 'w');
  const index = new Map();
  const add = (key, at, len) => { const l = index.get(key); if (l) l.push(at, len); else index.set(key, [at, len]); };
  let offset = 0;
  let count = 0;
  try {
    for (const bank of banks) {
      let rows;
      try { rows = JSON.parse(bank.getData().toString('utf8')); } catch { throw new Error(`${bank.entryName} in this dictionary is damaged`); }
      if (!Array.isArray(rows)) continue;
      const lines = [];
      for (const row of rows) {
        const entry = convert(row);
        if (!entry) continue;
        const line = Buffer.from(JSON.stringify(entry) + '\n');
        lines.push(line);
        add(entry.e, offset, line.length);
        // a frequency belongs to the word; its reading only says which reading
        if (entry.r && kind === 'terms') add(entry.r, offset, line.length);
        offset += line.length;
        count++;
      }
      fs.writeSync(out, Buffer.concat(lines));
      await pause();
    }
  } catch (err) {
    fs.closeSync(out);
    fs.rmSync(tmp, { recursive: true, force: true });
    throw err;
  }
  fs.closeSync(out);
  if (!count) {
    fs.rmSync(tmp, { recursive: true, force: true });
    throw new Error(kind === 'terms' ? 'no entries with definitions were found in this dictionary'
      : 'no frequencies were found in this dictionary (pitch accent dictionaries aren\'t supported yet)');
  }
  const dictLang = /^en/i.test(info.sourceLanguage || '') ? 'en' : /^ja/i.test(info.sourceLanguage || '') ? 'ja' : lang;
  const meta = { id, title, revision: String(info.revision || ''), lang: dictLang, kind, count, enabled: true, source };
  writeIndex(tmp, index);
  fs.writeFileSync(path.join(tmp, 'info.json'), JSON.stringify({ ...meta, author: info.author || '', url: info.url || '', attribution: info.attribution || '' }));

  close(id);
  const final = path.join(DIR, id);
  fs.rmSync(final, { recursive: true, force: true });
  fs.renameSync(tmp, final);
  if (old) Object.assign(old, meta, { enabled: old.enabled });
  else list.push(meta);
  saveList();
  console.log(`dictionaries: ${old ? 'updated' : 'added'} ${title} (${count} entries)`);
  return { kind: 'dictionary', title, revision: meta.revision, count, replaced: !!old };
}

// ---------- looking up ----------

// index.bin, all 32-bit numbers: [number of keys, then for key i where its pairs start (keys + 1
// numbers), then the pairs (offset, length in terms.jsonl)]
function writeIndex(dir, index) {
  const keys = [...index.keys()].filter((k) => !k.includes('\n')).sort();
  const pairCount = keys.reduce((n, k) => n + index.get(k).length, 0);
  const nums = new Uint32Array(1 + keys.length + 1 + pairCount);
  nums[0] = keys.length;
  let at = 0;
  keys.forEach((k, i) => {
    nums[1 + i] = at;
    nums.set(index.get(k), 2 + keys.length + at);
    at += index.get(k).length;
  });
  nums[1 + keys.length] = at;
  fs.writeFileSync(path.join(dir, 'keys.txt'), keys.join('\n'));
  fs.writeFileSync(path.join(dir, 'index.bin'), Buffer.from(nums.buffer));
}

const opened = new Map();                // id -> {keys, nums, fd}

function open(id) {
  let o = opened.get(id);
  if (!o) {
    const dir = path.join(DIR, id);
    const bin = fs.readFileSync(path.join(dir, 'index.bin'));
    const nums = new Uint32Array(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.length));
    o = { keys: fs.readFileSync(path.join(dir, 'keys.txt'), 'utf8').split('\n'), nums, fd: fs.openSync(path.join(dir, 'terms.jsonl'), 'r') };
    opened.set(id, o);
  }
  return o;
}

// [offset, length, offset, length…] of a word's entries, or null
function find(o, q) {
  let lo = 0;
  let hi = o.keys.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const k = o.keys[mid];
    if (k === q) {
      const n = o.keys.length;
      const from = 2 + n + o.nums[1 + mid];
      const to = 2 + n + o.nums[2 + mid];
      return o.nums.subarray(from, to);
    }
    if (k < q) lo = mid + 1; else hi = mid - 1;
  }
  return null;
}

// Windows can't delete or replace files that are still open
function close(id) {
  const o = opened.get(id);
  if (o) { fs.closeSync(o.fd); opened.delete(id); }
}

function read(o, at, len) {
  const buf = Buffer.alloc(len);
  fs.readSync(o.fd, buf, 0, len, at);
  return JSON.parse(buf.toString('utf8'));
}

// For each dictionary that's on (in order, for this language): the entries of the first word in
// `candidates` it has. -> [{title, entries: [{word, reading, tags, html: [...]}]}]
function lookup(candidates, lang) {
  const found = [];
  for (const d of readList()) {
    if (!d.enabled || d.lang !== lang || d.kind === 'freq') continue;
    let o;
    try { o = open(d.id); } catch (err) { console.error(`dictionaries: ${d.title}:`, err.message); continue; }
    for (const q of candidates) {
      const at = find(o, q);
      if (!at) continue;
      const entries = [];
      for (let i = 0; i < at.length; i += 2) entries.push(read(o, at[i], at[i + 1]));
      entries.sort((a, b) => (b.s || 0) - (a.s || 0));
      found.push({
        title: d.title,
        entries: entries.slice(0, PER_DICTIONARY).map((e) => ({ word: e.e, reading: e.r || '', tags: e.t || [], html: e.h })),
      });
      break;
    }
  }
  return found;
}

// ---------- routes ----------

// The frequency lists that are on, for each word: words = [{word, reading}] -> for each word
// [{title, value}] (value as the list shows it, e.g. "1234" or "1234㋕"), the best one per list
function frequencies(words, lang) {
  const lists = readList().filter((d) => d.enabled && d.lang === lang && d.kind === 'freq');
  if (!lists.length) return words.map(() => []);
  return words.map(({ word, reading }) => lists.flatMap((d) => {
    let o;
    try { o = open(d.id); } catch { return []; }
    const at = find(o, word);
    if (!at) return [];
    let best = null;
    for (let i = 0; i < at.length; i += 2) {
      const e = read(o, at[i], at[i + 1]);
      if (e.r && reading && e.r !== reading) continue;
      if (!best || e.v < best.v) best = e;
    }
    return best ? [{ title: d.title, value: best.f }] : [];
  }));
}

const shown = () => readList().map(({ id, title, revision, lang, kind, count, enabled }) => ({ id, title, revision, lang, kind: kind || 'terms', count, enabled }));

router.get('/', (req, res) => res.json({ dictionaries: shown() }));

router.post('/order', express.json(), (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids.map(String) : [];
  readList();
  const rank = (d) => { const i = ids.indexOf(d.id); return i < 0 ? ids.length : i; };
  list.sort((a, b) => rank(a) - rank(b));
  saveList();
  res.json({ dictionaries: shown() });
});

router.post('/:id', express.json(), (req, res) => {
  const d = readList().find((x) => x.id === req.params.id);
  if (!d) return res.status(404).json({ error: 'no such dictionary' });
  if (typeof req.body.enabled === 'boolean') d.enabled = req.body.enabled;
  saveList();
  res.json({ dictionaries: shown() });
});

router.delete('/:id', (req, res) => {
  const d = readList().find((x) => x.id === req.params.id);
  if (!d) return res.status(404).json({ error: 'no such dictionary' });
  close(d.id);
  fs.rmSync(path.join(DIR, d.id), { recursive: true, force: true });
  list = list.filter((x) => x !== d);
  saveList();
  console.log(`dictionaries: removed ${d.title}`);
  res.json({ dictionaries: shown() });
});

module.exports = { router, lookup, frequencies, importZip, isYomitan, contentHtml };
