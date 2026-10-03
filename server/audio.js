// Word pronunciation audio: GET /api/audio?word=食べる&reading=たべる[&form=喰べる…][&lang=en]
//   -> {data: base64, ext, source} or 404 {error}
// Japanese: tries JapanesePod101 (the source Yomitan uses) first, then Lingua Libre recordings on
// Wikimedia Commons. English: the American recording from dictionaryapi.dev (server/english.js).
// All free, no key needed.

const express = require('express');
const crypto = require('crypto');
const { UA, cached, fetchBuffer, asyncRoute } = require('./http');
const english = require('./english');

const router = express.Router();
const DAY = 24 * 60 * 60 * 1000;

// JapanesePod101 answers every request with 200; missing words get this "not available" clip
const JPOD_MISSING = '7e2c2f954ef6051373ba916f000168dc';

const isKana = (s) => /^[\p{scx=Hiragana}\p{scx=Katakana}ー]+$/u.test(s);

// it only finds a word when given its kana
async function jpod101(word, kana) {
  const params = new URLSearchParams({ kanji: word });
  if (kana) params.set('kana', kana);
  const buf = await fetchBuffer(`https://assets.languagepod101.com/dictionary/japanese/audiomp3.php?${params}`);
  if (!buf.length || crypto.createHash('md5').update(buf).digest('hex') === JPOD_MISSING) return null;
  return { buf, ext: 'mp3', source: 'JapanesePod101' };
}

// Lingua Libre files are named "LL-Q5287 (jpn)-<speaker>-<word>.wav"
async function linguaLibre(word) {
  const api = (params) => fetch('https://commons.wikimedia.org/w/api.php?' + new URLSearchParams({ format: 'json', ...params }),
    { headers: { 'User-Agent': UA } }).then((r) => r.json());
  const found = await api({
    action: 'query', list: 'search', srnamespace: '6', srlimit: '20',
    srsearch: `intitle:"LL-Q5287 (jpn)" intitle:"${word.replace(/"/g, '')}"`,
  });
  const hit = (found.query?.search || []).find((s) => s.title.endsWith(`-${word}.wav`));
  if (!hit) return null;
  const info = await api({ action: 'query', titles: hit.title, prop: 'imageinfo', iiprop: 'url' });
  const url = Object.values(info.query?.pages || {})[0]?.imageinfo?.[0]?.url;
  if (!url) return null;
  return { buf: await fetchBuffer(url), ext: 'wav', source: 'Lingua Libre' };
}

// forms = other spellings of the word (e.g. しおり is filed under 栞 on JapanesePod101)
async function findAudio(word, reading, forms) {
  const kana = reading || (isKana(word) ? word : '');    // kana-only words come without a reading
  const sources = [
    () => jpod101(word, kana),
    ...forms.map((form) => () => jpod101(form, kana)),
    () => linguaLibre(word),
    () => reading && reading !== word && linguaLibre(reading),
  ];
  for (const source of sources) {
    try {
      const hit = await source();
      if (hit) return hit;
    } catch (err) {
      console.error('word audio:', err.message);
    }
  }
  return null;
}

router.get('/', asyncRoute(async (req, res) => {
  const word = String(req.query.word || '').trim();
  const reading = String(req.query.reading || '').trim();
  const forms = [].concat(req.query.form || []).map((f) => String(f).trim()).filter((f) => f && f !== word).slice(0, 5);
  if (!word) return res.status(400).json({ error: 'no word' });
  const hit = req.query.lang === 'en'
    ? await cached(`audio-en:${word}`, DAY, () => english.audio(word))
    : await cached(`audio:${word}:${reading}:${forms}`, DAY, () => findAudio(word, reading, forms));
  if (!hit) return res.status(404).json({ error: `no audio for ${word}` });
  res.json({ data: hit.buf.toString('base64'), ext: hit.ext, source: hit.source });
}));

module.exports = { router };
