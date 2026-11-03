// Dictionary packs (server/packs.js): the free dictionary a language can install with one click.
// No network here — the addresses are checked, not fetched.
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.AKKO_OFFLINE = '1';
process.env.AKKO_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'akko-packs-test-'));

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const packs = require('../server/packs');
const dictionary = require('../server/dictionary');

let server, base;
before(async () => {
    const app = express();
    app.use('/api', dictionary.router);
    await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
    base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => {
    server.close();
    fs.rmSync(process.env.AKKO_DATA, { recursive: true, force: true });
});

test('Korean, Mandarin and Cantonese have a pack; a language without one says nothing', () => {
    for (const lang of ['ko', 'cmn', 'yue']) {
        const list = packs.list(lang);
        assert.equal(list.length, 1, lang);
        const [p] = list;
        assert.ok(p.id && p.title && p.size > 0, lang);
        assert.match(p.licence, /CC BY/, `${lang} says its licence`);
        assert.ok(p.thanks.length > 5, `${lang} says whose dictionary it is`);
        assert.equal(p.url, undefined, 'the page is not given the address');
    }
    assert.deepEqual(packs.list('de'), [], 'no pack yet for German: the file picker is the way');
    assert.deepEqual(packs.list(''), []);
    assert.equal(packs.find('nope'), null);
});

test('every address is a versioned GitHub release, so a pack keeps working', () => {
    for (const list of Object.values(packs.packs)) {
        for (const p of list) {
            const url = new URL(p.url);
            assert.equal(url.protocol, 'https:');
            assert.equal(url.host, 'github.com');
            assert.match(url.pathname, /^\/[^/]+\/[^/]+\/releases\/download\/[^/]+\/.+\.zip$/, p.url);
            assert.doesNotMatch(url.pathname, /\/latest\//, 'a moving address is a broken pack later');
            assert.ok(p.lang, `${p.id} says which language it is for`);
        }
    }
});

test('Settings sees the packs for the language being learnt, and only those', async () => {
    const ko = await (await fetch(base + '/dictionary/packs?lang=ko')).json();
    assert.equal(ko.packs[0].id, 'ko-krdict');
    assert.equal(ko.packs[0].url, undefined);
    const de = await (await fetch(base + '/dictionary/packs?lang=de')).json();
    assert.deepEqual(de.packs, []);
});

test('installing a pack that is not there is a message, not a crash', async () => {
    const res = await fetch(base + '/dictionary/packs/install', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: 'nope' }),
    });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /does not exist/);
});
