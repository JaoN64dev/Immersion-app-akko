// Expressions: idioms, proverbs and set phrases found across akko's words, in Japanese (JMdict)
// and English (WordNet), conjugated or not (server/expressions.js).
process.env.AKKO_OFFLINE = '1';

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const dictionary = require('../server/dictionary');
const english = require('../server/english');
const { ExpressionIndex } = require('../server/expressions');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let dict;
before(async () => {
  await dictionary.init();
  for (let i = 0; i < 600 && !dictionary.ready.expressions; i++) await sleep(50);
  dict = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'dict.json'), 'utf8'));
});

// the expressions in a line, with the text each covers
function found(tokens) {
  const out = [];
  let last = null;
  for (const t of tokens) {
    if (t.ex && last && last.key === t.ex) { last.text += t.s; continue; }
    if (!t.ex && last && /^[ \t]+$/.test(t.s)) { last.text += t.s; continue; }   // spaces between English words
    last = t.ex ? { key: t.ex, kind: t.et, text: t.s } : null;
    if (last) out.push(last);
  }
  return out.map(({ key, kind, text }) => ({ key, kind, text: text.trim() }));
}
const ja = (line) => found(dictionary.tokenize(line));
const en = (line) => found(english.tokenize(line, dict));
const has = (list, key) => list.find((x) => x.key === key);

test('the five idioms are found in conjugated sentences', () => {
  assert.ok(dictionary.ready.expressions, 'the expression index should be ready');
  const cases = [
    ['ずっと首を長くして待っていた。', '首を長くする'],
    ['人の話に口を挟んだ。', '口を挟む'],
    ['猿も木から落ちるって言うでしょう。', '猿も木から落ちる'],
    ['階段を下りたら膝が笑ってしまった。', '膝が笑う'],
    ['余計なお世話だよ。', '余計なお世話'],
  ];
  for (const [line, key] of cases) {
    const hit = has(ja(line), key);
    assert.ok(hit, `${key} in ${line}: ${JSON.stringify(ja(line))}`);
  }
  assert.equal(has(ja('階段を下りたら膝が笑ってしまった。'), '膝が笑う').kind, 'i');
});

test('kana spellings find the same expression', () => {
  assert.ok(has(ja('人の話に口をはさむな。'), '口を挟む'), JSON.stringify(ja('人の話に口をはさむな。')));
});

test('words apart, or across punctuation, are not an expression', () => {
  assert.equal(has(ja('膝が、笑った。'), '膝が笑う'), undefined);
  assert.equal(has(ja('首をとても長くして待った。'), '首を長くする'), undefined);
});

test('the longest expression wins', () => {
  const index = new ExpressionIndex();
  index.add('AB', ['a', 'b'], 'p');
  index.add('ABC', ['a', 'b', 'c'], 'i');
  index.finish();
  const tokens = index.mark([{ s: 'a', b: 'a' }, { s: 'b', b: 'b' }, { s: 'c', b: 'c' }, { s: 'a', b: 'a' }, { s: 'b', b: 'b' }]);
  assert.deepEqual(tokens.map((t) => t.ex), ['ABC', 'ABC', 'ABC', 'AB', 'AB']);
  assert.deepEqual(ExpressionIndex.fromList(index.toList()).toList(), index.toList());
});

test('English phrasal verbs and idioms, in any form', () => {
  assert.ok(has(en('She gave up smoking last year.'), 'give up'), JSON.stringify(en('She gave up smoking last year.')));
  assert.ok(has(en("I'm looking forward to it."), 'look forward'), JSON.stringify(en("I'm looking forward to it.")));
  assert.ok(has(en('I feel under the weather today.'), 'under the weather'), JSON.stringify(en('I feel under the weather today.')));
  assert.ok(has(en("Let's call it a day."), 'call it a day'), JSON.stringify(en("Let's call it a day.")));
  assert.equal(has(en('She gave up smoking last year.'), 'give up').text, 'gave up');
});
