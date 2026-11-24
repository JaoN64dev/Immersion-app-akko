// Which model whisper.cpp is handed. OpenAI's whisper keeps its own models as .pt files in
// ~/.cache/whisper — one of akko's model folders — and whisper-cli can only read ggml .bin files,
// so a machine with both installed must never get the .pt.
const fs = require('fs');
const os = require('os');
const path = require('path');

// a home of our own, set before server/asr.js works out its model folders
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'akko-asr-home-'));
const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, PATH: process.env.PATH, AKKO_WHISPER: process.env.AKKO_WHISPER, AKKO_WHISPER_MODEL: process.env.AKKO_WHISPER_MODEL };
process.env.HOME = home;
process.env.USERPROFILE = home;

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const asr = require('../server/asr');

// whisper.cpp "installed": status() only looks for the file, it never runs it here
const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'akko-asr-bin-'));
fs.writeFileSync(path.join(bin, 'whisper-cli'), '');
process.env.PATH = bin;
delete process.env.AKKO_WHISPER;
delete process.env.AKKO_WHISPER_MODEL;

after(() => {
    for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
    }
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(bin, { recursive: true, force: true });
});

test('whisper.cpp with only an OpenAI .pt model around is not ready, and says it needs a model', () => {
    const openai = path.join(home, '.cache', 'whisper');
    fs.mkdirSync(openai, { recursive: true });
    fs.writeFileSync(path.join(openai, 'base.pt'), 'openai whisper model');
    const s = asr.status();
    assert.equal(s.tools[0].family, 'cpp');
    assert.equal(s.model, null, 'the .pt is not offered to whisper-cli');
    assert.equal(s.ready, false);
    assert.match(s.help, /needs a model/);
});

test('whisper.cpp picks the ggml .bin when both kinds are there', () => {
    const akko = path.join(home, '.cache', 'akko', 'whisper');
    fs.mkdirSync(akko, { recursive: true });
    fs.writeFileSync(path.join(akko, 'ggml-base.bin'), 'ggml model');
    const s = asr.status();
    assert.equal(path.basename(s.model), 'ggml-base.bin');
    assert.equal(s.ready, true);
    assert.equal(s.models.length, 2, 'both are still listed for Settings');
});
