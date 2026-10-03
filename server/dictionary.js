// Japanese tokenizer (kuromoji) + offline dictionary (JMdict via jmdict-simplified),
// kanji info (KANJIDIC2) and pitch accent (Kanjium)
//
//   POST /api/tokenize  {lines: [...]}      -> words with dictionary forms + furigana
//   GET  /api/dict?q=食べる&q=食べられなかった&form=食べられなかった
//        -> dictionary entries for the first q that hits, with pitch accent, the kanji in
//           the word, and what the conjugation of `form` means
//   Both take lang=en for English (server/english.js), which uses this file's JMdict too.
//   GET  /api/dictionary                    -> what's installed (Settings → Dictionary)
//   POST /api/dictionary/upload  (the file) -> install a JMdict / KANJIDIC2 file from jmdict-simplified
//   POST /api/dictionary/update             -> download and install the newest ones
//
// On first start the data is downloaded into ./data (JMdict ~12 MB, KANJIDIC2 ~1 MB,
// accents ~3 MB) and squeezed. After that everything works offline.

const fs = require('fs');
const path = require('path');
const express = require('express');
const AdmZip = require('adm-zip');
const kuromoji = require('kuromoji');
const { UA, cached, fetchText, asyncRoute } = require('./http');
const grammar = require('./grammar');
const english = require('./english');
const dictionaries = require('./dictionaries');

const { DATA } = require('./paths');
const DICT_FILE = path.join(DATA, 'dict.json');
const ZIP_FILE = path.join(DATA, 'jmdict.zip');
const KANJI_FILE = path.join(DATA, 'kanji.json');
const ACCENTS_FILE = path.join(DATA, 'accents.txt');
const ACCENTS_URL = 'https://raw.githubusercontent.com/mifunetoshiro/kanjium/master/data/source_files/raw/accents.txt';
const KUROMOJI_DICT = path.join(path.dirname(require.resolve('kuromoji/package.json')), 'dict');

let dict = null;          // { entries, tags }
let index = null;         // Map(text -> [entry index])
let tokenizer = null;
let kanji = null;         // { 雨: {m, on, kun, j, s, g} }
let pitch = null;         // Map("word\treading" -> [accent numbers])
const ready = { dict: false, tokenizer: false, kanji: false, pitch: false, error: null };

// ---------- downloads ----------

async function download(url, what) {
  let res;
  try {
    res = await fetch(url, { headers: { 'User-Agent': UA } });
  } catch {
    throw new Error(`couldn't download ${what}: are you connected to the internet?`);
  }
  if (!res.ok) throw new Error(`${res.status} downloading ${what}`);
  return Buffer.from(await res.arrayBuffer());
}

// Newest zip from the jmdict-simplified releases whose name matches `pattern`
async function downloadRelease(pattern) {
  let res;
  try {
    res = await fetch('https://api.github.com/repos/scriptin/jmdict-simplified/releases/latest', { headers: { 'User-Agent': UA } });
  } catch {
    throw new Error("can't reach GitHub: are you connected to the internet?");
  }
  // without a login GitHub allows 60 requests an hour (shared with the subtitle search)
  if (res.status === 403 || res.status === 429) throw new Error('GitHub is limiting requests right now, try again in an hour');
  if (!res.ok) throw new Error(`GitHub answered ${res.status}, try again later`);
  const rel = await res.json();
  const asset = (rel.assets || []).find((a) => pattern.test(a.name));
  if (!asset) throw new Error(`${pattern} not found in the latest release`);
  console.log(`dictionary: downloading ${asset.name} (${(asset.size / 1e6).toFixed(1)} MB)…`);
  return download(asset.browser_download_url, asset.name);
}

const firstJsonIn = (buf) => {
  const entry = new AdmZip(buf).getEntries().find((e) => e.entryName.endsWith('.json'));
  return JSON.parse(entry.getData().toString('utf8'));
};

// ---------- building the dictionary ----------

async function downloadJmdict() {
  fs.writeFileSync(ZIP_FILE, await downloadRelease(/^jmdict-eng-\d.*\.json\.zip$/));
}

// Keep only what the popup needs: forms, readings, common flag, senses
function compact(jm) {
  const entries = jm.words.map((w) => {
    const e = {
      k: w.kanji.filter((k) => !k.tags.includes('sK')).map((k) => k.text),
      r: w.kana.filter((r) => !r.tags.includes('sk')).map((r) => r.text),
      s: w.sense.slice(0, 8).map((s) => {
        const sense = { p: s.partOfSpeech, g: s.gloss.map((g) => g.text) };
        if (s.misc.length) sense.m = s.misc;
        return sense;
      }),
    };
    if (w.kanji.some((k) => k.common) || w.kana.some((r) => r.common)) e.c = 1;
    // search-only spellings still need to be findable
    const hidden = [...w.kanji.filter((k) => k.tags.includes('sK')), ...w.kana.filter((r) => r.tags.includes('sk'))];
    if (hidden.length) e.h = hidden.map((x) => x.text);
    return e;
  });
  return { entries, tags: jm.tags, version: jm.dictDate };
}

// Put a word dictionary in use. Lookups keep using the old one until the new one is indexed.
function useDict(d) {
  const idx = new Map();
  d.entries.forEach((e, i) => {
    for (const text of new Set([...e.k, ...e.r, ...(e.h || [])])) {
      const list = idx.get(text);
      if (list) list.push(i); else idx.set(text, [i]);
    }
  });
  dict = d;
  index = idx;
  ready.dict = true;
}

let loadingDict = false;      // true while the start-up load (maybe a first download + build) runs

async function loadDict() {
  loadingDict = true;
  try {
    await readOrBuildDict();
  } finally {
    loadingDict = false;
  }
}

async function readOrBuildDict() {
  if (!fs.existsSync(DICT_FILE)) {
    fs.mkdirSync(DATA, { recursive: true });
    if (!fs.existsSync(ZIP_FILE)) await downloadJmdict();
    console.log('dictionary: building (one time, ~20s)…');
    const zip = new AdmZip(ZIP_FILE);
    const entry = zip.getEntries().find((e) => e.entryName.endsWith('.json'));
    fs.writeFileSync(DICT_FILE, JSON.stringify(compact(JSON.parse(entry.getData().toString('utf8')))));
    fs.unlinkSync(ZIP_FILE);
  }
  useDict(JSON.parse(fs.readFileSync(DICT_FILE, 'utf8')));
  console.log(`dictionary: ${dict.entries.length} entries ready`);
}

// KANJIDIC2, keeping meanings, readings, JLPT (converted to N-levels), strokes, school grade
function compactKanji(kd) {
  const N = { 4: 'N5', 3: 'N4', 2: 'N3–N2', 1: 'N1' };      // KANJIDIC still uses the old 4 levels
  const out = {};
  for (const c of kd.characters) {
    const groups = c.readingMeaning ? c.readingMeaning.groups : [];
    const readings = groups.flatMap((g) => g.readings);
    const entry = {
      m: groups.flatMap((g) => g.meanings.filter((m) => m.lang === 'en').map((m) => m.value)),
      on: readings.filter((r) => r.type === 'ja_on').map((r) => r.value),
      kun: readings.filter((r) => r.type === 'ja_kun').map((r) => r.value),
      s: c.misc.strokeCounts[0],
    };
    if (c.misc.jlptLevel) entry.j = N[c.misc.jlptLevel];
    if (c.misc.grade) entry.g = c.misc.grade;
    out[c.literal] = entry;
  }
  return out;
}

async function loadKanji() {
  if (!fs.existsSync(KANJI_FILE)) {
    fs.mkdirSync(DATA, { recursive: true });
    fs.writeFileSync(KANJI_FILE, JSON.stringify(compactKanji(firstJsonIn(await downloadRelease(/^kanjidic2-en-\d.*\.json\.zip$/)))));
  }
  kanji = JSON.parse(fs.readFileSync(KANJI_FILE, 'utf8'));
  ready.kanji = true;
  console.log(`kanji: ${Object.keys(kanji).length} ready`);
}

// ---------- installing another dictionary (Settings → Dictionary) ----------
// Takes the jmdict-simplified files: jmdict-eng-….json.zip (words) or kanjidic2-en-….json.zip
// (kanji), zipped or as the .json itself. The new file replaces the old one in ./data and is
// used straight away, no restart.

let installing = false;

// What an uploaded file is: {kind: 'words' | 'kanji', data}
function readDictionaryFile(buf) {
  let text = null;
  if (buf[0] === 0x50 && buf[1] === 0x4b) {            // "PK": a zip
    let entry;
    try {
      entry = new AdmZip(buf).getEntries().find((e) => e.entryName.endsWith('.json'));
    } catch {
      throw new Error('this zip file is damaged');
    }
    if (!entry) throw new Error('there is no .json file inside this zip');
    text = entry.getData().toString('utf8');
  } else {
    // a JSON file starts with "{" (after spaces or a BOM): anything else (a video picked by
    // mistake…) is refused before reading the whole thing
    const start = buf.subarray(0, 64).toString('utf8').replace(/^[\s﻿]+/, '');
    if (!start.startsWith('{')) throw new Error('this is not a JMdict or KANJIDIC2 file from jmdict-simplified');
    text = buf.toString('utf8');
  }
  let data;
  try { data = JSON.parse(text); } catch { data = null; }
  if (data && Array.isArray(data.words)) return { kind: 'words', data };
  if (data && Array.isArray(data.characters)) return { kind: 'kanji', data };
  throw new Error('this is not a JMdict or KANJIDIC2 file from jmdict-simplified');
}

// Save next to the old file first, then swap, so a failure never leaves a half-written file
function replaceFile(file, text) {
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(file + '.new', text);
  fs.renameSync(file + '.new', file);
}

function install({ kind, data }) {
  if (kind === 'words') {
    let d;
    try { d = compact(data); } catch { throw new Error('this JMdict file is in a format akko doesn\'t know'); }
    if (!d.entries.length) throw new Error('this JMdict file has no words in it');
    const previous = dict && dict.version;
    const previousCount = dict ? dict.entries.length : 0;
    replaceFile(DICT_FILE, JSON.stringify(d));
    useDict(d);
    console.log(`dictionary: installed JMdict ${d.version || ''} (${d.entries.length} entries)`);
    // previousCount lets the page warn about a much smaller dictionary (e.g. jmdict-eng-common)
    return { kind, count: d.entries.length, version: d.version || null, previous: previous || null, previousCount };
  }
  let k;
  try { k = compactKanji(data); } catch { throw new Error('this KANJIDIC2 file is in a format akko doesn\'t know'); }
  const count = Object.keys(k).length;
  if (!count) throw new Error('this KANJIDIC2 file has no kanji in it');
  replaceFile(KANJI_FILE, JSON.stringify(k));
  kanji = k;
  ready.kanji = true;
  console.log(`kanji: installed ${count}`);
  return { kind, count, version: data.dictDate || null };
}

// One install at a time: they use a lot of memory for a few seconds
// replacesJmdict: false for adding a Yomitan dictionary, which doesn't touch JMdict
async function oneAtATime(job, { replacesJmdict = true } = {}) {
  const busy = (message) => Object.assign(new Error(message), { status: 409 });
  if (installing) throw busy('a dictionary is already being installed, wait a moment');
  // on the very first start the dictionary is still being downloaded and built: installing one
  // now would be overwritten when that finishes
  if (replacesJmdict && loadingDict) throw busy('the dictionary is still loading, wait a moment');
  installing = true;
  try { return await job(); } finally { installing = false; }
}

const dictionaryInfo = () => ({
  words: dict ? { count: dict.entries.length, version: dict.version || null } : null,
  kanji: kanji ? { count: Object.keys(kanji).length } : null,
  loading: loadingDict,
  installing,
  error: ready.error,
});

// Kanjium accents.txt: "橋\tはし\t2" / "１\tひと\t0,2" (reading column is empty when it's the word itself)
async function loadPitch() {
  if (!fs.existsSync(ACCENTS_FILE)) {
    fs.mkdirSync(DATA, { recursive: true });
    fs.writeFileSync(ACCENTS_FILE, await download(ACCENTS_URL, 'pitch accents'));
  }
  pitch = new Map();
  for (const line of fs.readFileSync(ACCENTS_FILE, 'utf8').split('\n')) {
    const [word, reading, accents] = line.trim().split('\t');
    if (!word || !accents) continue;
    const nums = accents.split(',').map((n) => parseInt(n, 10)).filter((n) => !isNaN(n));
    if (nums.length) pitch.set(`${word}\t${reading || word}`, nums);
  }
  ready.pitch = true;
  console.log(`pitch accent: ${pitch.size} words ready`);
}

function loadTokenizer() {
  return new Promise((resolve, reject) => {
    kuromoji.builder({ dicPath: KUROMOJI_DICT }).build((err, t) => {
      if (err) return reject(err);
      tokenizer = t;
      ready.tokenizer = true;
      console.log('tokenizer: ready');
      resolve();
    });
  });
}

function init() {
  // kanji + pitch are extras: if they fail, lookups still work without them
  loadKanji().catch((err) => console.error('kanji data failed:', err.message));
  loadPitch().catch((err) => console.error('pitch accent data failed:', err.message));
  return Promise.all([loadDict(), loadTokenizer()]).catch((err) => {
    ready.error = err.message;
    console.error('dictionary/tokenizer failed:', err.message);
  });
}

// ---------- helpers ----------

const toHiragana = (s) => (s || '').replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
const hasKanji = (s) => /[一-鿿㐀-䶿々〆ヵヶ]/.test(s);
const KANJI_RUN = /[一-鿿㐀-䶿々〆ヵヶ]+/g;

// Split "食べられなかった" + "たべられなかった" into [{t:"食",r:"た"},{t:"べられなかった"}]
function furigana(surface, reading) {
  if (!reading || !hasKanji(surface)) return null;
  const parts = [];
  let last = 0;
  surface.replace(KANJI_RUN, (m, at) => {
    if (at > last) parts.push({ t: surface.slice(last, at) });
    parts.push({ t: m, kanji: true });
    last = at + m.length;
  });
  if (last < surface.length) parts.push({ t: surface.slice(last) });

  const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp('^' + parts.map((p) => (p.kanji ? '(.+?)' : escape(toHiragana(p.t)))).join('') + '$');
  const m = toHiragana(reading).match(re);
  if (!m) return [{ t: surface, r: toHiragana(reading) }];
  let g = 1;
  return parts.map((p) => (p.kanji ? { t: p.t, r: m[g++] } : { t: p.t }));
}

// ---------- tokenizing ----------

const CONTENT = new Set(['名詞', '動詞', '形容詞', '副詞', '連体詞', '感動詞', '接続詞', '接頭詞', 'フィラー']);

// Glue kuromoji's pieces back into words a learner would look up:
// 食べ+られ+なかっ+た -> 食べられなかった, 勉強+し+て+いる -> 勉強している, 田中+さん -> 田中さん
function groupTokens(tokens) {
  const groups = [];
  let prefix = null;
  for (const t of tokens) {
    const g = groups[groups.length - 1];
    const d1 = t.pos_detail_1;
    const verbal = g && g.verbal;
    const attach = g && !prefix && (
      (t.pos === '助動詞' && verbal) ||
      (t.pos === '動詞' && (d1 === '非自立' || d1 === '接尾') && verbal) ||
      (t.pos === '形容詞' && d1 === '非自立' && verbal) ||
      (t.pos === '助詞' && d1 === '接続助詞' && /^(て|で|ちゃ|じゃ|ば)$/.test(t.surface_form) && verbal) ||
      (t.pos === '動詞' && t.basic_form === 'する' && g.head.pos_detail_1 === 'サ変接続') ||
      (t.pos === '名詞' && d1 === '接尾' && g.head.pos === '名詞' && g.head.pos_detail_1 !== '数')
    );
    if (attach) {
      g.tokens.push(t);
      if (t.pos === '動詞') g.verbal = true;
      continue;
    }
    const group = { head: t, tokens: [t], verbal: t.pos === '動詞' || t.pos === '形容詞' };
    if (prefix) { group.tokens.unshift(prefix); prefix = null; }
    if (t.pos === '接頭詞') { prefix = t; continue; }
    groups.push(group);
  }
  if (prefix) groups.push({ head: prefix, tokens: [prefix], verbal: false });
  return groups;
}

// Best dictionary form to look up / track as "known"
function lemmaOf(group, surface) {
  const h = group.head;
  const base = h.basic_form && h.basic_form !== '*' ? h.basic_form : h.surface_form;
  const candidates = group.verbal ? [base, surface] : [surface, base, h.surface_form];
  if (!index) return candidates[0];
  return candidates.find((c) => index.has(c)) || candidates[0];
}

function tokenizeLine(line) {
  const out = [];
  const raw = tokenizer.tokenize(line);
  const groups = groupTokens(raw);
  for (const g of groups) {
    const s = g.tokens.map((t) => t.surface_form).join('');
    const h = g.head;
    // punctuation, ♪, ～ … (kuromoji calls unknown symbols nouns, so check for real letters)
    if (h.pos === '記号' || !/[\p{L}\p{N}]/u.test(s)) { out.push({ s }); continue; }
    const reading = g.tokens.every((t) => t.reading) ? g.tokens.map((t) => t.reading).join('') : null;
    const tok = { s, b: lemmaOf(g, s) };
    const f = furigana(s, reading);
    if (f) tok.f = f;
    // content words count towards "how much of this do I know"; particles, names and numbers don't
    const isName = h.pos === '名詞' && h.pos_detail_1 === '固有名詞';
    const isNumber = h.pos === '名詞' && h.pos_detail_1 === '数';
    if (CONTENT.has(h.pos) && !isName && !isNumber && !(h.pos === '名詞' && h.pos_detail_1 === '非自立')) tok.c = 1;
    if (isName) tok.n = 1;
    out.push(tok);
  }
  markGrammar(raw, groups, out);
  return out;
}

// gr: ids of the grammar lessons (server/grammar.js) whose pattern covers this word
function markGrammar(raw, groups, out) {
  const found = grammar.detect(raw);
  if (!found.length) return;
  const wordOf = new Map();          // kuromoji token -> index in out (one word per group)
  groups.forEach((g, i) => g.tokens.forEach((t) => wordOf.set(t, i)));
  for (const { id, start, end } of found) {
    for (let k = start; k < end; k++) {
      const tok = out[wordOf.get(raw[k])];
      if (tok && tok.b && !(tok.gr ||= []).includes(id)) tok.gr.push(id);
    }
  }
}

// One subtitle line may contain line breaks; keep them as {s:"\n"}
function tokenize(text) {
  const out = [];
  text.split('\n').forEach((line, i) => {
    if (i) out.push({ s: '\n' });
    out.push(...tokenizeLine(line));
  });
  return out;
}

// ---------- lookup ----------

function describePos(code) {
  return (dict.tags[code] || code).replace(/ \(.*\)$/, '');
}

// Pitch accent numbers for a reading of this word ([] if Kanjium doesn't have it)
function pitchFor(spellings, reading) {
  if (!pitch) return [];
  for (const w of [...spellings, reading]) {
    const hit = pitch.get(`${w}\t${reading}`);
    if (hit) return hit;
  }
  return [];
}

function formatEntry(e, query) {
  const usuallyKana = e.s.some((s) => s.m && s.m.includes('uk'));
  const matchedKana = e.r.includes(query) && !e.k.includes(query);
  const word = (usuallyKana && matchedKana) || !e.k.length ? (matchedKana ? query : e.r[0]) : (e.k.includes(query) ? query : e.k[0]);
  const spellings = [word, ...e.k.slice(0, 2)];
  return {
    word,
    reading: e.r[0] || '',
    // [{reading: "はし", accents: [2]}] for the main readings that have data
    pitch: e.r.slice(0, 3).map((r) => ({ reading: r, accents: pitchFor(spellings, r) })).filter((p) => p.accents.length),
    forms: [...e.k, ...e.r].filter((f) => f !== word && f !== e.r[0]).slice(0, 5),
    common: !!e.c,
    senses: e.s.map((s) => ({
      pos: s.p.map(describePos),
      gloss: s.g,
      misc: (s.m || []).filter((m) => m !== 'uk').map(describePos),
    })),
  };
}

function lookupExact(q) {
  const hits = index.get(q);
  if (!hits) return [];
  const kanjiQuery = hasKanji(q);
  return hits
    .map((i) => dict.entries[i])
    .sort((a, b) => (b.c || 0) - (a.c || 0)
      || (kanjiQuery ? (b.k.includes(q) - a.k.includes(q)) : (b.r[0] === q) - (a.r[0] === q)))
    .slice(0, 6)
    .map((e) => formatEntry(e, q));
}

// Try each candidate; if nothing hits, tokenize the text and look up its first word
function findEntries(candidates) {
  for (const q of candidates) {
    const entries = lookupExact(q);
    if (entries.length) return { query: q, entries };
  }
  if (tokenizer && candidates[0]) {
    const first = tokenizeLine(candidates[0]).find((t) => t.b);
    if (first) {
      const entries = lookupExact(first.b);
      if (entries.length) return { query: first.b, entries };
    }
  }
  return { query: candidates[0] || '', entries: [] };
}

// form = the text that was clicked (食べられなかった), to explain its conjugation
function lookup(candidates, form) {
  const result = findEntries(candidates);
  const head = result.entries[0];
  result.kanji = head ? kanjiIn(head.word) : [];
  result.inflection = form && form !== result.query ? explainForm(form) : [];
  return result;
}

// ---------- kanji ----------

function kanjiIn(word) {
  if (!kanji) return [];
  return [...new Set(word)].filter((ch) => kanji[ch]).map((ch) => {
    const k = kanji[ch];
    return { char: ch, meanings: k.m.slice(0, 5), on: k.on.slice(0, 4), kun: k.kun.slice(0, 5), jlpt: k.j || null, strokes: k.s, grade: k.g || null };
  });
}

// ---------- conjugation ----------

// What each piece after the word's stem means. Keys are kuromoji's dictionary form of the piece.
const AUXILIARY = {                           // 助動詞
  ない: 'negative', ぬ: 'negative', ん: 'negative', た: 'past', だ: 'past', ます: 'polite',
  れる: 'passive / potential', られる: 'passive / potential', せる: 'causative', させる: 'causative',
  たい: 'want to', う: "volitional (let's)", よう: "volitional (let's)", まい: "won't / let's not", らしい: 'apparently',
};
const HELPER_VERB = {                         // 動詞 非自立 / 接尾 (mostly after て)
  れる: 'passive / potential', られる: 'passive / potential', せる: 'causative', させる: 'causative',
  いる: 'ongoing (〜ている)', ある: 'done and left so (〜てある)', しまう: 'completely / by accident (〜てしまう)',
  ちゃう: 'completely / by accident (〜ちゃう)', じゃう: 'completely / by accident (〜じゃう)',
  おく: 'in advance (〜ておく)', とく: 'in advance (〜とく)', みる: 'try doing (〜てみる)',
  くれる: 'for me (〜てくれる)', くださる: 'please (〜てください)', もらう: 'get someone to (〜てもらう)',
  あげる: 'for someone (〜てあげる)', いく: 'going on (〜ていく)', くる: 'coming / started (〜てくる)',
  がる: 'shows signs of (〜がる)',
};
const HELPER_ADJ = {                          // 形容詞 非自立
  ない: 'negative', ほしい: 'want someone to (〜てほしい)', やすい: 'easy to (〜やすい)', にくい: 'hard to (〜にくい)',
};
const PARTICLE = { て: 'て-form', で: 'て-form', ば: 'if (conditional)', ちゃ: 'ては (contraction)', じゃ: 'では (contraction)' };

// "食べられなかった" -> ["passive / potential", "negative", "past"]; [] if it isn't one conjugated word
function explainForm(form) {
  if (!tokenizer) return [];
  const groups = groupTokens(tokenizer.tokenize(form));
  const g = groups[0];
  if (!g || g.tokens.map((t) => t.surface_form).join('') !== form) return [];
  const labels = [];
  for (const t of g.tokens.slice(g.tokens.indexOf(g.head) + 1)) {
    const base = t.basic_form;
    const label = t.pos === '助動詞' ? AUXILIARY[base]
      : t.pos === '動詞' && base === 'する' && g.head.pos_detail_1 === 'サ変接続' ? 'する-verb'
      : t.pos === '動詞' ? HELPER_VERB[base]
      : t.pos === '形容詞' ? HELPER_ADJ[base]
      : t.pos === '助詞' ? PARTICLE[t.surface_form]
      : null;
    if (label && labels[labels.length - 1] !== label) labels.push(label);
  }
  return labels;
}

// While JMdict is still being built on first start, ask jisho.org and reshape its answer
async function jishoLookup(q) {
  const data = await cached('jisho:' + q, 24 * 3600e3, async () =>
    JSON.parse(await fetchText(`https://jisho.org/api/v1/search/words?keyword=${encodeURIComponent(q)}`)));
  return {
    query: q,
    entries: data.data.slice(0, 6).map((e) => ({
      word: e.japanese[0].word || e.japanese[0].reading,
      reading: e.japanese[0].reading || '',
      forms: [],
      common: !!e.is_common,
      senses: e.senses.map((s) => ({ pos: s.parts_of_speech, gloss: s.english_definitions, misc: [] })),
    })),
  };
}

// ---------- routes ----------

const router = express.Router();

router.post('/tokenize', express.json({ limit: '5mb' }), (req, res) => {
  const lines = Array.isArray(req.body.lines) ? req.body.lines : [];
  // English (server/english.js) needs the dictionary, for its list of words
  if (req.body.lang === 'en') {
    if (!ready.dict) return res.status(503).json({ error: ready.error || 'dictionary still loading' });
    return res.json({ tokens: lines.map((l) => english.tokenize(String(l), dict)) });
  }
  if (!ready.tokenizer) return res.status(503).json({ error: ready.error || 'tokenizer still loading' });
  res.json({ tokens: lines.map((l) => tokenize(String(l))) });
});

router.get('/dict', asyncRoute(async (req, res) => {
  const qs = [].concat(req.query.q || []).map((q) => String(q).trim()).filter(Boolean);
  if (!qs.length) return res.json({ query: '', entries: [] });
  const form = String(req.query.form || '').trim();
  // more: entries from the dictionaries you added (Settings → Dictionaries), under JMdict's
  const withMore = (result, lang) => {
    const words = [...new Set([...qs, ...(result.entries || []).slice(0, 2).map((e) => e.word)])];
    return { ...result, more: dictionaries.lookup(lang === 'en' ? words.map((w) => w.toLowerCase()).concat(words) : words, lang) };
  };
  if (req.query.lang === 'en') {
    if (!ready.dict) return res.status(503).json({ error: ready.error || 'dictionary still loading' });
    return res.json(withMore(await english.lookup(qs, form, dict, String(req.query.native || '')), 'en'));
  }
  res.json(withMore(ready.dict ? lookup(qs, form) : await jishoLookup(qs[0]), 'ja'));
}));

// ---------- Settings → Dictionary ----------

// errors here are about the file or the download, so they go back as a message to show
const installRoute = (fn) => (req, res) => fn(req, res).catch((err) => {
  console.error('dictionary install:', err.message);
  res.status(err.status || 400).json({ error: err.message });
});

router.get('/dictionary', (req, res) => res.json(dictionaryInfo()));

// the file itself is the body (sent straight from the file picker). A Yomitan dictionary is
// added next to JMdict (server/dictionaries.js); a jmdict-simplified file replaces JMdict / KANJIDIC2.
// ?lang= is the language you're learning: the language of a Yomitan dictionary that doesn't say.
router.post('/dictionary/upload', express.raw({ type: () => true, limit: '1gb' }), installRoute(async (req, res) => {
  if (!Buffer.isBuffer(req.body) || !req.body.length) throw new Error('the file is empty');
  if (dictionaries.isYomitan(req.body)) {
    const lang = req.query.lang === 'en' ? 'en' : 'ja';
    const done = await oneAtATime(() => dictionaries.importZip(req.body, lang), { replacesJmdict: false });
    return res.json({ installed: [done], ...dictionaryInfo() });
  }
  const done = await oneAtATime(async () => install(readDictionaryFile(req.body)));
  res.json({ installed: [done], ...dictionaryInfo() });
}));

// the newest JMdict + KANJIDIC2 from jmdict-simplified's GitHub releases
router.post('/dictionary/update', installRoute(async (req, res) => {
  const installed = await oneAtATime(async () => {
    // both downloads first: if one fails, nothing has changed yet
    const wordsFile = readDictionaryFile(await downloadRelease(/^jmdict-eng-\d.*\.json\.zip$/));
    const kanjiFile = readDictionaryFile(await downloadRelease(/^kanjidic2-en-\d.*\.json\.zip$/));
    return [install(wordsFile), install(kanjiFile)];
  });
  res.json({ installed, ...dictionaryInfo() });
}));

// tokenize / lookup / ready are also used by the tests (tests/japanese.test.js)
module.exports = { init, router, tokenize, lookup, ready, data: () => dict };
