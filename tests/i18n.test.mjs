// The interface's translations (scripts/lang/*.js): every language has every entry, with the same
// {placeholders}, and the same data-i18n blocks with the same links.
import { test } from "node:test";
import assert from "node:assert/strict";
import ja from "../scripts/lang/ja.js";
import pt from "../scripts/lang/pt.js";
import es from "../scripts/lang/es.js";
import de from "../scripts/lang/de.js";
import fr from "../scripts/lang/fr.js";
import it from "../scripts/lang/it.js";
import ru from "../scripts/lang/ru.js";
import zh from "../scripts/lang/zh.js";
import ko from "../scripts/lang/ko.js";

const COMPLETE = { ja, pt, es };
// the ones that are growing: the chrome is translated, the long explanations are still English
const GROWING = { de, fr, it, ru, zh, ko };

const holes = (s) => (s.match(/\{\w+\}/g) || []).sort().join(" ");
const links = (s) => (s.match(/href="[^"]*"/g) || []).join(" ");

// the tables themselves: a translation added outside `text` or `html` is never used
for (const [name, table] of Object.entries(COMPLETE)) {
    test(`${name}: a table is text and html, nothing else`, () => {
        assert.deepEqual(Object.keys(table).sort(), ["html", "text"],
            "translations must live inside text (plain sentences) or html (data-i18n blocks)");
        assert.ok(Object.keys(table.text).length > 500, "the table is filled in");
    });
}

// a key that English doesn't have is a typo, and a translation nobody will ever see
for (const [name, table] of Object.entries({ ...COMPLETE, ...GROWING })) {
    test(`${name}: every key is a string the app really says`, () => {
        const unknown = Object.keys(table.text).filter((k) => !(k in ja.text));
        assert.deepEqual(unknown, [], "not on any page or in any script (spelling? punctuation?)");
        const unknownHtml = Object.keys(table.html).filter((k) => !(k in ja.html));
        assert.deepEqual(unknownHtml, [], "not a data-i18n block of the English");
    });
}

// the growing ones: the navigation and the buttons have to be there, or the interface is a mix of
// two languages with no way to read the menu
const CORE = [
    "Pages", "Watch", "Read", "Listen", "Grammar", "Keys", "Review", "Settings", "About",
    "save", "cancel", "delete", "close", "done", "search", "show", "hide",
    "Learning", "Display", "Stats", "Dictionaries", "Backup", "Diagnostics",
    "Interface language", "language you learn", "theme", "light", "dark",
    "learning", "known", "again", "hard", "good", "easy",
];
for (const [name, table] of Object.entries(GROWING)) {
    test(`${name}: the menu and the buttons are translated`, () => {
        const missing = CORE.filter((k) => !(k in table.text));
        assert.deepEqual(missing, []);
        assert.ok(Object.keys(table.text).length >= 100, "a table starts at 100 entries, not 5");
        for (const [en, tr] of Object.entries(table.text)) {
            assert.ok(tr.trim(), `${en}: empty`);
            assert.equal(holes(tr), holes(en), `${en} -> ${tr}`);
        }
        for (const [key, html] of Object.entries(table.html)) assert.equal(links(html), links(ja.html[key]), key);
    });
}

for (const [name, table] of Object.entries({ pt, es })) {
    test(`${name}: the same entries as ja`, () => {
        const missing = Object.keys(ja.text).filter((k) => !(k in table.text));
        const extra = Object.keys(table.text).filter((k) => !(k in ja.text));
        assert.deepEqual(missing, [], "missing");
        assert.deepEqual(extra, [], "not in ja.js");
        assert.deepEqual(Object.keys(table.html).sort(), Object.keys(ja.html).sort());
    });

    test(`${name}: placeholders and links are kept`, () => {
        for (const [en, tr] of Object.entries(table.text)) {
            assert.ok(tr.trim(), `${en}: empty`);
            assert.equal(holes(tr), holes(en), `${en} -> ${tr}`);
        }
        for (const [key, html] of Object.entries(table.html)) assert.equal(links(html), links(ja.html[key]), key);
    });
}
