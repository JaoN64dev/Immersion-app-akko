// English: word splitting, contractions, dictionary forms, grammar marks (including "not after"),
// and offline lookups (WordNet definitions, CMU pronunciation, Japanese from JMdict).
process.env.AKKO_OFFLINE = '1';

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const english = require('../server/english');

let dict;
before(() => { dict = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'dict.json'), 'utf8')); });

const words = (line) => english.tokenize(line, dict).filter((t) => t.b);
const lemma = (line, s) => (words(line).find((t) => t.s === s) || {}).b;
const grammarOf = (line) => new Set(english.tokenize(line, dict).flatMap((t) => t.gr || []));

test('irregular and regular forms find their dictionary word', () => {
  assert.equal(lemma('They went home.', 'went'), 'go');
  assert.equal(lemma('She studies hard.', 'studies'), 'study');
  assert.equal(lemma('The children are here.', 'children'), 'child');
  assert.equal(lemma('Those boxes are bigger.', 'bigger'), 'big');
  assert.equal(lemma('I was running.', 'running'), 'run');
  assert.equal(lemma('I was stopped.', 'stopped'), 'stop');
});

test('words that only look like forms of another word stay themselves', () => {
  assert.equal(lemma('See you in the evening.', 'evening'), 'evening');
  assert.equal(lemma('He fell to the ground.', 'ground'), 'ground');
  assert.equal(lemma('We have a meeting.', 'meeting'), 'meeting');
  assert.equal(lemma('This movie is boring.', 'boring'), 'boring');
  assert.equal(lemma('I found my keys.', 'found'), 'find');
});

test('contractions stay one clickable word', () => {
  const ws = words("I don't think I'm late.");
  assert.deepEqual(ws.map((t) => t.s), ['I', "don't", 'think', "I'm", 'late']);
  assert.equal(ws[1].b, 'do');
});

test('grammar words do not count as words to know; names are spotted', () => {
  const ws = words('Yesterday the dog saw Mary at the park.');
  assert.equal(ws.find((t) => t.s === 'the').c, undefined);
  assert.equal(ws.find((t) => t.s === 'dog').c, 1);
  assert.equal(ws.find((t) => t.s === 'Yesterday').n, undefined, 'a capital at the start of a sentence is not a name');
});

test('spaces and punctuation are kept', () => {
  assert.equal(english.tokenize('That hurts!', dict).map((t) => t.s).join(''), 'That hurts!');
});

test('grammar from the lessons is marked', () => {
  assert.ok(grammarOf("I'm going to eat lunch.").has('going-to'));
  assert.ok(grammarOf('If it rains, I will stay home.').has('first-conditional'));
  assert.ok(grammarOf('The house was built in 1990.').has('passive'));
});

test('"not after" steps: present perfect, but not after would', () => {
  assert.ok(grammarOf('I have seen this movie.').has('present-perfect'));
  const wouldHave = grammarOf('I would have seen it.');
  assert.ok(!wouldHave.has('present-perfect'));
  assert.ok(wouldHave.has('modal-perfect'));
});

test('looking up offline: definitions, American IPA, the clicked form explained', async () => {
  const r = await english.lookup(['run', 'running'], 'running', dict, '');
  const e = r.entries[0];
  assert.equal(e.word, 'run');
  assert.equal(e.reading, '/ɹʌn/');
  assert.ok(e.senses.length > 0 && e.senses[0].gloss[0].length > 10);
  assert.deepEqual(r.inflection, ['-ing form']);
  assert.equal(e.audio, '', 'no recording offline');
});

test('phrases and Japanese translations', async () => {
  const r = await english.lookup(['give up'], 'give up', dict, 'ja');
  const e = r.entries[0];
  assert.equal(e.reading, '/ɡɪv ʌp/');
  assert.ok(e.tr.some((s) => s.words.some((w) => w.includes('諦める'))), 'あきらめる among the Japanese');
});
