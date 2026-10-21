// The extension's translations (extension/lang.js): every row in all four languages with the same
// {placeholders}, and every English row is text the extension really shows.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DIR = path.join(__dirname, '..', 'extension');
const sandbox = { navigator: { language: 'en' }, chrome: {}, globalThis: {} };
sandbox.globalThis = sandbox;
vm.runInNewContext(fs.readFileSync(path.join(DIR, 'lang.js'), 'utf8'), sandbox);
const { ROWS, HTML } = sandbox.akkoLang;

const holes = (s) => (s.match(/\{\w+\}/g) || []).sort().join(' ');
const source = ['popup.html', 'popup.js', 'options.html', 'options.js', 'content/common.js', 'content/youtube.js', 'content/netflix.js', 'content/generic.js']
  .map((f) => fs.readFileSync(path.join(DIR, f), 'utf8')).join('\n').replace(/\s+/g, ' ');

test('every row has its four languages, with the same placeholders', () => {
  const seen = new Set();
  for (const row of ROWS) {
    assert.equal(row.length, 4, row[0]);
    assert.ok(!seen.has(row[0]), `twice: ${row[0]}`);
    seen.add(row[0]);
    for (const tr of row.slice(1)) {
      assert.ok(tr && tr.trim(), `${row[0]}: empty`);
      assert.equal(holes(tr), holes(row[0]), `${row[0]} -> ${tr}`);
    }
  }
  for (const [key, list] of Object.entries(HTML)) assert.equal(list.length, 3, key);
});

// rows put together at run time from pieces (`${i + 1} ${label}`, `${LANG_NAMES[lang]} subtitles`…)
const BUILT = new Set(['{lists} (from akko) · {n} changes waiting for akko', '{lists} (from akko) · 1 change waiting for akko',
  'Japanese subtitles', 'listening practice: blur the Japanese until paused', 'listening practice: blur the English until paused',
  'in step with akko just now ·', 'in step with akko {n} min ago ·', '1 new', '2 learning', '3 known ✓', '4 ignore',
  'idiom · part of', 'phrase · part of', '{word}: new', '{word}: learning', '{word}: known', '{word}: ignored', 'subtitles on time',
  'translation: always', 'translation: blurred until the mouse is on it', 'translation: never',
  'pause at the end of every line: on', 'pause at the end of every line: off', 'listening practice: on', 'listening practice: off']);

test('every English row is in the extension', () => {
  const missing = ROWS.map((r) => r[0]).filter((en) => !BUILT.has(en)).filter((en) => {
    // the text around the placeholders must be there (built with template literals)
    const parts = en.split(/\{\w+\}/).map((p) => p.trim()).filter((p) => p.length > 2);
    return parts.length ? !parts.every((p) => source.includes(p)) : !source.includes(en);
  });
  assert.deepEqual([...missing], []);
  for (const key of Object.keys(HTML)) assert.ok(source.includes(`data-l="${key}"`), key);
});
