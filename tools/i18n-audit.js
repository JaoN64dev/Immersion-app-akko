// Which English prose is on the pages but has no translation yet.
//
// The interface is swapped by scripts/i18n.js: every text node that has a key in scripts/lang/*.js is
// translated, everything else stays English. That silent fallback is how "as melhorias não estão na
// versão japa" happens: the paragraph is there, in English, inside the Japanese interface.
//
//   npm run i18n-audit               → the text nodes with no key, per page
//   npm run i18n-audit -- --all      → including brand names and one-word labels
//   npm run i18n-audit -- --lang de  → what German is still missing (and how far along each table is)
//
// A key can be a plain sentence, or a sentence with {n}/{lang} placeholders (tried as a pattern).
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const all = process.argv.includes('--all');
const only = process.argv.includes('--lang') ? process.argv[process.argv.indexOf('--lang') + 1] : null;

// read a table file: its text keys (the html blocks are counted, not matched)
const tableKeys = (tag) => {
    const src = fs.readFileSync(path.join(root, 'scripts/lang', `${tag}.js`), 'utf8');
    return new Set([...src.matchAll(/"((?:[^"\\]|\\.)*)"\s*:/g)].map((m) => m[1]));
};
const english = tableKeys('ja');
const wanted = only ? tableKeys(only) : english;
const patterns = [...wanted].filter((k) => k.includes('{')).map((k) => ({
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
        if (wanted.has(text) || patterns.some((p) => p.re.test(text))) continue;
        if (!all && words(text) < 3) continue;          // "GitHub", "nyaa.si", "@akko_br"
        missing.push(text);
    }
    if (!missing.length) continue;
    total += missing.length;
    console.log(`\n${file}  (${missing.length})`);
    for (const text of missing) console.log('  · ' + (text.length > 110 ? text.slice(0, 110) + '…' : text));
}
if (!only) {
    // how far along each table is, against the English
    console.log('\ncover');
    for (const tag of ['ja', 'pt', 'es', 'de', 'fr', 'it', 'ru', 'zh', 'ko']) {
        const have = [...tableKeys(tag)].filter((k) => english.has(k)).length;
        console.log(`  ${tag}  ${String(have).padStart(4)} / ${english.size}  ${Math.round((have / english.size) * 100)}%`);
    }
}

console.log(`\n${total} text node(s) with no translation${only ? ` in ${only}` : ''}${all ? '' : ' (3+ words)'}. ` +
    (only
        ? `Anything else stays English: add the strings above to scripts/lang/${only}.js.`
        : 'Add a key to scripts/lang/ja.js, pt.js and es.js — all three, or tests/i18n.test.mjs fails.'));
process.exitCode = 0;
