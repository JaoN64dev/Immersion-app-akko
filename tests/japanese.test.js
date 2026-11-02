// Japanese: word splitting (Lindera + grouping), furigana, what counts as a word, grammar marks,
// dictionary lookups (JMdict, conjugation, kanji, pitch accent), and the expressions page's
// catalogue (sets, search, the expression of the day).
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

test('the expressions page: every expression in sets, searchable, and one for the day', async () => {
  for (let i = 0; i < 600 && !dictionary.ready.expressions; i++) await sleep(50);
  assert.ok(dictionary.ready.expressions, 'the expressions index is ready');
  const express = require('express');
  const app = express();
  app.use('/api', dictionary.router);
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  try {
    const all = await (await fetch(`${base}/expressions?limit=5`)).json();
    assert.ok(all.total > 5000, `the catalogue (${all.total})`);
    assert.equal(all.items.length, 5, 'paged');
    const counts = Object.fromEntries(all.sets.map((s) => [s.id, s.count]));
    assert.ok(counts.all >= all.total, 'the "all" button counts everything');
    assert.ok(counts.idioms > 1000 && counts.yoji > 100 && counts.phrases > 1000, 'the sets have something in them');
    assert.ok(all.items.every((it) => it.key && typeof it.kind === 'string'), 'each has its words and kind');

    const yoji = await (await fetch(`${base}/expressions?set=yoji&limit=1`)).json();
    assert.ok(yoji.items[0].sets.includes('yoji'), 'a 四字熟語 from that set');

    const body = await (await fetch(`${base}/expressions?part=${encodeURIComponent('手')}&limit=1`)).json();
    assert.ok(body.items[0].parts.includes('手'), 'with 手 in it');

    const found = await (await fetch(`${base}/expressions?q=${encodeURIComponent('首を長く')}`)).json();
    assert.ok(found.items.some((it) => it.key === '首を長くする'), 'search finds 首を長くする');

    const day = await (await fetch(`${base}/expressions/today`)).json();
    assert.match(day.day, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(day.item && day.item.key, 'an expression of the day');
  } finally {
    server.close();
  }
});
