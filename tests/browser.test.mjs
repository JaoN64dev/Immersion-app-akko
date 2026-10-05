// The browser-side logic, run in Node with a pretend localStorage: which language's data is used
// (storage keys), word statuses, turning tokens into HTML, % understood, sentences around a word,
// the lesson Markdown renderer, and the Japanese interface dictionary.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// ---------- a pretend browser ----------
const saved = new Map();
globalThis.localStorage = {
    getItem: (k) => (saved.has(k) ? saved.get(k) : null),
    setItem: (k, v) => saved.set(k, String(v)),
    removeItem: (k) => saved.delete(k),
    key: (i) => [...saved.keys()][i] ?? null,
    get length() { return saved.size; },
};
globalThis.window = { addEventListener() {}, dispatchEvent() {} };
globalThis.Event = class { constructor(type) { this.type = type; } };
Object.defineProperty(globalThis, 'navigator', { value: { language: 'pt-BR' }, configurable: true });

const target = await import('../scripts/core/target.js');

test('learning Japanese keeps the original storage names; English adds -en', () => {
    assert.equal(target.target(), 'ja');
    assert.equal(target.chosen(), false);
    assert.equal(target.keyFor('akko-words'), 'akko-words');
    target.setTarget('en');
    assert.equal(target.chosen(), true);
    assert.equal(target.keyFor('akko-words'), 'akko-words-en');
    assert.equal(target.ofTarget({ lang: 'en' }), true);
    assert.equal(target.ofTarget({}), false, 'old records without lang are Japanese');
    target.setTarget('ja');
});

test('your language comes from the browser until you pick one', () => {
    assert.equal(target.nativeLang(), 'pt');
    target.setNative('');
    assert.equal(target.nativeLang(), '');
    target.setNative('es');
    assert.equal(target.nativeLang(), 'es');
});

// status and render read the target when they load: Japanese
const status = await import('../scripts/words/status.js');
const render = await import('../scripts/words/render.js');

test('word statuses are saved per dictionary form', () => {
    assert.equal(status.wordStatus('食べる'), 'new');
    status.setWordStatus('食べる', 'known');
    assert.equal(status.wordStatus('食べる'), 'known');
    assert.equal(JSON.parse(localStorage.getItem('akko-words'))['食べる'], 'known');
    status.setWordStatus('食べる', 'new');
    assert.equal(JSON.parse(localStorage.getItem('akko-words'))['食べる'], undefined, '"new" is not stored');
});

test('tokens become clickable words with furigana, status and grammar', () => {
    const html = render.tokensHtml([
        { s: '食べている', b: '食べる', c: 1, gr: ['te-iru'], f: [{ t: '食', r: 'た' }, { t: 'べている' }] },
        { s: '。' },
        { s: '<b>', b: '<b>' },
    ]);
    assert.match(html, /<span class="w s-new" data-b="食べる" data-c="1" data-gr="te-iru"><ruby>食<rt>た<\/rt><\/ruby>べている<\/span>/);
    assert.match(html, /。/);
    assert.match(html, /&lt;b&gt;/, 'text is escaped');
});

test('% understood counts content words, and lines with one unknown word', () => {
    status.setWordStatus('猫', 'known');
    status.setWordStatus('犬', 'ignored');
    const lines = [
        [{ s: '猫', b: '猫', c: 1 }, { s: 'が' }, { s: '好き', b: '好き', c: 1 }],     // one unknown: i+1
        [{ s: '猫', b: '猫', c: 1 }, { s: '犬', b: '犬', c: 1 }],                      // all known/ignored
    ];
    const c = render.comprehension(lines);
    assert.equal(c.total, 3, 'ignored words do not count');
    assert.equal(c.known, 2);
    assert.equal(c.unknown, 1);
    assert.equal(c.iPlus1, 1);
    assert.equal(c.pct, 67);
});

test('the sentence around a word', () => {
    const text = '雨だ。今日は家で本を読む。明日は晴れ。';
    assert.equal(render.sentenceAround(text, text.indexOf('本')), '今日は家で本を読む。');
});

test('English sentences: abbreviations and initials do not end them', () => {
    target.setTarget('en');
    try {
        const text = 'It rained. Mr. Smith went to Washington D.C. yesterday, at 3.30 p.m. with Dr. Lee! Then we left.';
        assert.equal(render.sentenceAround(text, text.indexOf('Smith')), 'Mr. Smith went to Washington D.C. yesterday, at 3.30 p.m. with Dr. Lee!');
        assert.equal(render.sentenceAround(text, text.indexOf('left')), 'Then we left.');
        assert.equal(render.sentenceAround('"Stop." She ran.', 9), 'She ran.');
    } finally {
        target.setTarget('ja');
    }
});

const today = await import('../scripts/core/today.js');

test("today's minutes and the streak, per language", () => {
    const at = (day, h = 12) => new Date(`2026-10-${day}T${String(h).padStart(2, '0')}:00:00`);
    today.addSeconds('ja', 600, at('01'));
    today.addSeconds('ja', 30, at('02'));            // under a minute: doesn't count for the streak
    today.addSeconds('ja', 120, at('03'));
    today.addSeconds('ja', 300, at('04'));
    today.addSeconds('ja', 60, at('04', 20));
    assert.equal(today.secondsOn('ja', '2026-10-04'), 360);
    assert.equal(today.streak('ja', at('04')), 2, '3rd and 4th');
    assert.equal(today.streak('ja', at('05')), 2, 'nothing yet on the 5th: the streak is still alive');
    assert.equal(today.streak('ja', at('06')), 0, 'a day missed');
    assert.equal(today.streak('en', at('04')), 0, 'English keeps its own');
    assert.equal(today.dayOf(at('04', 23)), '2026-10-04', 'local date, not UTC');
});

const { markdown } = await import('../scripts/grammar/markdown.js');

test('lesson Markdown: headings, lists, tables, notes, inline styles', () => {
    const html = markdown('## Title\n\n- **bold** and *it*\n- `x*y*`\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n> note');
    assert.match(html, /<h3>Title<\/h3>/);
    assert.match(html, /<li><b>bold<\/b> and <i>it<\/i><\/li>/);
    assert.match(html, /<code>x\*y\*<\/code>/, 'no formatting inside code');
    assert.match(html, /<th>a<\/th>.*<td>1<\/td>/s);
    assert.match(html, /<blockquote>note<\/blockquote>/);
});

test('lesson Markdown is safe: HTML is escaped, only http(s) and site links', () => {
    const html = markdown('<script>x</script> [a](javascript:alert(1)) [b](https://x.org) [c](/grammar.html)');
    assert.doesNotMatch(html, /<script>/);
    assert.doesNotMatch(html, /href="javascript/);
    assert.match(html, /href="https:\/\/x.org" target="_blank"/);
    assert.match(html, /href="\/grammar.html"/);
});

test('the Japanese interface dictionary has no repeated entries, and keeps its placeholders', () => {
    const src = readFileSync(new URL('../scripts/lang/ja.js', import.meta.url), 'utf8');
    const keys = [...src.matchAll(/^ {8}"((?:[^"\\]|\\.)+)":/gm)].map((m) => m[1]);
    const repeated = keys.filter((k, i) => keys.indexOf(k) !== i);
    assert.deepEqual(repeated, [], 'a repeated key silently replaces the first one');
    const ja = new Function(src.replace('export default', 'return'))();
    for (const [en, jp] of Object.entries(ja.text)) {
        for (const ph of en.match(/\{\w+\}/g) || []) assert.ok(jp.includes(ph), `"${en}": the Japanese lost ${ph}`);
    }
});
