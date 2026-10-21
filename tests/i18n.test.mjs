// The interface's translations (scripts/lang/*.js): every language has every entry, with the same
// {placeholders}, and the same data-i18n blocks with the same links.
import { test } from "node:test";
import assert from "node:assert/strict";
import ja from "../scripts/lang/ja.js";
import pt from "../scripts/lang/pt.js";
import es from "../scripts/lang/es.js";

const holes = (s) => (s.match(/\{\w+\}/g) || []).sort().join(" ");
const links = (s) => (s.match(/href="[^"]*"/g) || []).join(" ");

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
