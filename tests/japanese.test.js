// Japanese: word splitting (kuromoji + grouping), furigana, what counts as a word, grammar marks,
// and dictionary lookups (JMdict, conjugation, kanji, pitch accent).
process.env.AKKO_OFFLINE = '1';

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const dictionary = require('../server/dictionary');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

before(async () => {
  await dictionary.init();
  // kanji and pitch accent load on the side
  for (let i = 0; i < 200 && !(dictionary.ready.kanji && dictionary.ready.pitch); i++) await sleep(50);
});

const words = (line) => dictionary.tokenize(line).filter((t) => t.b);
const word = (line, s) => words(line).find((t) => t.s === s);

test('a verb is one word together with its endings', () => {
  const w = word('今、ご飯を食べている。', '食べている');
  assert.ok(w, '食べている should be one word');
  assert.equal(w.b, '食べる');
  assert.equal(w.c, 1);
});

test('する-nouns and name suffixes are grouped', () => {
  assert.equal(word('毎日勉強している', '勉強している').b, '勉強');      // JMdict lists する-nouns without する
  const name = word('田中さんが来た', '田中さん');
  assert.ok(name, '田中さん should be one word');
  assert.equal(name.n, 1);
});

test('furigana goes over the kanji only', () => {
  assert.deepEqual(word('食べる', '食べる').f, [{ t: '食', r: 'た' }, { t: 'べる' }]);
});

test('particles and names do not count as words to know', () => {
  const ws = words('田中さんは本を読む');
  assert.equal(ws.find((t) => t.s === 'は').c, undefined);
  assert.equal(ws.find((t) => t.s === '田中さん').c, undefined);
  assert.equal(ws.find((t) => t.s === '読む').c, 1);
});

test('line breaks and punctuation are kept as they are', () => {
  const out = dictionary.tokenize('雨。\n晴れ');
  assert.deepEqual(out.map((t) => t.s), ['雨', '。', '\n', '晴れ']);
});

test('grammar from the lessons is marked on the words', () => {
  assert.ok(word('雨が降っているから、行かない。', '降っている').gr.includes('te-iru'));
  assert.ok(word('雨が降っているから、行かない。', 'から').gr.includes('kara-node'));
  assert.ok(word('宿題を忘れちゃった。', '忘れちゃった').gr.includes('te-shimau'));
  assert.equal(word('本を読む。', '読む').gr, undefined);
});

test('looking a word up: meaning, conjugation, kanji, pitch accent', () => {
  const r = dictionary.lookup(['食べる'], '食べられなかった');
  assert.equal(r.query, '食べる');
  assert.equal(r.entries[0].word, '食べる');
  assert.ok(r.entries[0].senses[0].gloss.some((g) => /eat/.test(g)));
  assert.deepEqual(r.inflection, ['passive / potential', 'negative', 'past']);
  assert.equal(r.kanji[0].char, '食');
  assert.ok(r.entries[0].pitch.length, 'pitch accent for 食べる');
});

test('a word that is not in the dictionary falls back to its first word', () => {
  const r = dictionary.lookup(['猫が好き']);
  assert.equal(r.query, '猫');
});
