// The local assistant (server/assistant.js) against a stand-in for Ollama on this computer: the model
// list, the explanation streamed through as Ollama writes it, and what is said when there is no Ollama
// or no model. The prompt carries the languages and akko's own analysis.
const http = require('http');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

let fake, fakeModels = ['qwen2.5:7b'], lastChat = null;
before(async () => {
    fake = http.createServer((req, res) => {
        if (req.url === '/api/tags') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ models: fakeModels.map((name) => ({ name })) })); }
        if (req.url === '/api/chat') {
            let body = '';
            req.on('data', (c) => { body += c; });
            req.on('end', () => {
                lastChat = JSON.parse(body);
                res.writeHead(200, { 'content-type': 'application/x-ndjson' });
                const parts = ['**Translation**: ', 'My name is ', 'not yet decided.'];
                let i = 0;
                const next = () => {
                    if (i < parts.length) { res.write(JSON.stringify({ message: { content: parts[i++] }, done: false }) + '\n'); setTimeout(next, 10); }
                    else res.end(JSON.stringify({ message: { content: '' }, done: true }) + '\n');
                };
                next();
            });
            return;
        }
        res.writeHead(404); res.end();
    });
    await new Promise((r) => fake.listen(0, '127.0.0.1', r));
    process.env.AKKO_OLLAMA = `http://127.0.0.1:${fake.address().port}`;
});
after(() => fake.close());

async function app() {
    delete require.cache[require.resolve('../server/assistant')];
    const assistant = require('../server/assistant');
    const express = require('express');
    const a = express();
    a.use('/api/assistant', assistant.router);
    const server = await new Promise((r) => { const s = a.listen(0, '127.0.0.1', () => r(s)); });
    return { base: `http://127.0.0.1:${server.address().port}/api/assistant`, close: () => server.close(), assistant };
}

const explain = (base, body) => fetch(`${base}/explain`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('the models Ollama has, and the explanation streamed through as it is written', async () => {
    const { base, close } = await app();
    try {
        const status = await (await fetch(base)).json();
        assert.deepEqual(status, { running: true, models: ['qwen2.5:7b'], url: process.env.AKKO_OLLAMA });
        const res = await explain(base, {
            sentence: '名前はまだ無い。', lang: 'ja', native: 'pt', model: 'qwen2.5:7b',
            words: [{ surface: '名前', base: '名前' }, { surface: '無い', base: '無い' }], grammar: ['は (topic)'],
        });
        assert.equal(res.status, 200);
        assert.equal(decodeURIComponent(res.headers.get('x-akko-model')), 'qwen2.5:7b');
        assert.equal(await res.text(), '**Translation**: My name is not yet decided.');
        // what the model was asked
        assert.equal(lastChat.model, 'qwen2.5:7b');
        assert.equal(lastChat.stream, true);
        assert.match(lastChat.messages[0].content, /patient Japanese teacher/);
        assert.match(lastChat.messages[0].content, /Write in Portuguese/);
        assert.match(lastChat.messages[1].content, /名前はまだ無い。/);
        assert.match(lastChat.messages[1].content, /名前, 無い/);
        assert.match(lastChat.messages[1].content, /は \(topic\)/);
    } finally { close(); }
});

test('a model that isn\'t installed falls back to one that is', async () => {
    const { base, close } = await app();
    try {
        const res = await explain(base, { sentence: '猫', lang: 'ja', model: 'not-here:1b' });
        await res.text();
        assert.equal(lastChat.model, 'qwen2.5:7b');
    } finally { close(); }
});

test('no model yet, no Ollama, or no sentence: said plainly', async () => {
    fakeModels = [];
    let { base, close } = await app();
    try {
        const res = await explain(base, { sentence: '猫' });
        assert.equal(res.status, 503);
        const body = await res.json();
        assert.equal(body.code, 'model');
        assert.match(body.error, /ollama pull/);
        assert.equal((await explain(base, { sentence: '  ' })).status, 400);
        assert.equal((await explain(base, { sentence: 'あ'.repeat(401) })).status, 400);
    } finally { close(); fakeModels = ['qwen2.5:7b']; }

    const real = process.env.AKKO_OLLAMA;
    process.env.AKKO_OLLAMA = 'http://127.0.0.1:9';           // nothing listens there
    ({ base, close } = await app());
    try {
        assert.deepEqual((await (await fetch(base)).json()).running, false);
        const res = await explain(base, { sentence: '猫' });
        assert.equal(res.status, 503);
        assert.equal((await res.json()).code, 'missing');
    } finally { close(); process.env.AKKO_OLLAMA = real; }
});
