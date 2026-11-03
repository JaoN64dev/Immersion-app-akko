// Which English prose is on the pages but has no translation yet.
//
// The interface is swapped by scripts/i18n.js: every text node that has a key in scripts/lang/*.js is
// translated, everything else stays English. That silent fallback is how "as melhorias não estão na
// versão japa" happens: the paragraph is there, in English, inside the Japanese interface.
//
//   npm run i18n-audit            → the text nodes with no key, per page
//   npm run i18n-audit -- --all   → including brand names and one-word labels
//
// A key can be a plain sentence, or a sentence with {n}/{lang} placeholders (tried as a pattern).
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const all = process.argv.includes('--all');
const keys = new Set();
for (const tag of ['ja', 'pt', 'es']) {
    const src = fs.readFileSync(path.join(root, 'scripts/lang', `${tag}.js`), 'utf8');
    for (const m of src.matchAll(/"((?:[^"\\]|\\.)*)"\s*:/g)) keys.add(m[1]);
    for (const m of src.matchAll(/'((?:[^'\\]|\\.)*)'\s*:/g)) keys.add(m[1]);
}
const patterns = [...keys].filter((k) => k.includes('{')).map((k) => ({
    re: new RegExp('^' + k.replace(/\{[a-z]+\}/g, '\u0000').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        .replace(/\u0000/g, '.+?') + '$'),
}));
const norm = (s) => s.replace(/\s+/g, ' ').trim().replace(/&amp;/g, '&');
const words = (t) => t.split(/\s+/).filter((w) => /[A-Za-zÀ-ÿ]{2}/.test(w)).length;

let total = 0;
for (const file of fs.readdirSync(root).filter((f) => f.endsWith('.html')).sort()) {
    const html = fs.readFileSync(path.join(root, file), 'utf8')
        .replace(/<script[\s\S]*?<\/script>/g, '')
        .replace(/<!--[\s\S]*?-->/g, '');
    const missing = [];
    for (const m of html.matchAll(/>([^<>]+)</g)) {
        const text = norm(m[1]);
        if (!text || !/[A-Za-zÀ-ÿ]{3}/.test(text)) continue;
        if (keys.has(text) || patterns.some((p) => p.re.test(text))) continue;
        if (!all && words(text) < 3) continue;          // "GitHub", "nyaa.si", "@akko_br"
        missing.push(text);
    }
    if (!missing.length) continue;
    total += missing.length;
    console.log(`\n${file}  (${missing.length})`);
    for (const text of missing) console.log('  · ' + (text.length > 110 ? text.slice(0, 110) + '…' : text));
}
console.log(`\n${total} text node(s) with no translation${all ? '' : ' (3+ words)'}. ` +
    'Add a key to scripts/lang/ja.js, pt.js and es.js — all three, or tests/i18n.test.mjs fails.');
process.exitCode = 0;
