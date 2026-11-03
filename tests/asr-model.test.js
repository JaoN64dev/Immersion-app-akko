// server/asr.js model download: the pinned URL, the sha256 check, and the route.
// Nothing here touches the network except a local http server serving a fake "model".
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('node:http');
const crypto = require('node:crypto');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const asr = require('../server/asr');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'akko-asr-model-test-'));
let requests = 0;                        // how many times the fake server was asked for the file
const content = Buffer.from('not a real whisper model — just bytes for the hash test');
const hash = crypto.createHash('sha256').update(content).digest('hex');
const modelServer = http.createServer((req, res) => {
    requests += 1;
    res.setHeader('content-type', 'application/octet-stream');
    res.setHeader('content-length', String(content.length));
    res.end(content);
});
let modelPort;

before(async () => {
    await new Promise((resolve) => modelServer.listen(0, '127.0.0.1', resolve));
    modelPort = modelServer.address().port;
});

after(() => {
    modelServer.close();
    fs.rmSync(dir, { recursive: true, force: true });
});

test('downloadModel: checks the sha256 and keeps what it downloaded', async () => {
    const target = path.join(dir, 'ggml-base.bin');
    const got = await asr.downloadModel({
        url: `http://127.0.0.1:${modelPort}/model.bin`,
        hash,
        file: 'ggml-base.bin',
        dir,
    });
    assert.equal(got, target);
    assert.equal(fs.readFileSync(target).toString('hex'), content.toString('hex'), 'the file is what the server sent');
    const before = requests;
    const again = await asr.downloadModel({
        url: `http://127.0.0.1:${modelPort}/model.bin`,
        hash,
        file: 'ggml-base.bin',
        dir,
    });
    assert.equal(again, target);
    assert.equal(requests, before, 'a model that already matches its checksum is not downloaded again');
});

test('downloadModel: a wrong sha256 is refused and nothing is left behind', async () => {
    const tmp = path.join(dir, 'ggml-base.bin.part');
    await assert.rejects(asr.downloadModel({
        url: `http://127.0.0.1:${modelPort}/model.bin`,
        hash: '0'.repeat(64),
        file: 'ggml-base.bin',
        dir,
    }), /checksum didn't match/);
    assert.equal(fs.existsSync(tmp), false, 'no partial file left after a bad checksum');
});

test('POST /api/asr/model: with no tool installed, nothing is downloaded', async () => {
    const app = express();
    app.use('/api/asr', asr.router);
    const server = app.listen(0);
    try {
        const port = server.address().port;
        const res = await fetch(`http://127.0.0.1:${port}/api/asr/model`, { method: 'POST' });
        assert.equal(res.status, 403);
        const body = await res.json();
        assert.match(body.error, /no speech recognition tool is installed yet/);
    } finally {
        server.close();
    }
});
