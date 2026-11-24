// OpenAI whisper without ffmpeg: the WAV 読む makes (scripts/core/wav.js) is exactly what the server
// reads without ffmpeg (server/asr.js isPcmWav, then server/whisper-wav.py), and anything else is
// sent back with code needs-wav instead of failing inside whisper.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { encodeWav, RATE } from '../scripts/core/wav.js';

const require = createRequire(import.meta.url);
const asr = require('../server/asr.js');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'akko-wav-test-'));

test('the browser-made WAV is a 16 kHz mono 16-bit PCM file the server accepts as is', () => {
    const samples = new Float32Array(RATE / 10).map((_, i) => Math.sin(i / 10));
    const bytes = Buffer.from(encodeWav(samples));
    assert.equal(bytes.length, 44 + samples.length * 2);
    assert.equal(bytes.toString('latin1', 0, 4), 'RIFF');
    assert.equal(bytes.readUInt32LE(24), 16000);
    assert.equal(bytes.readUInt16LE(22), 1, 'mono');
    const file = path.join(dir, 'made.wav');
    fs.writeFileSync(file, bytes);
    assert.equal(asr.isPcmWav(file), true);
});

test('samples are clipped, not wrapped, past ±1', () => {
    const bytes = Buffer.from(encodeWav(new Float32Array([2, -2, 0])));
    assert.equal(bytes.readInt16LE(44), 0x7fff);
    assert.equal(bytes.readInt16LE(46), -0x8000);
    assert.equal(bytes.readInt16LE(48), 0);
});

test('an mp3, or a WAV that is not 16-bit PCM, is not taken for one', () => {
    const mp3 = path.join(dir, 'a.mp3');
    fs.writeFileSync(mp3, Buffer.from('ID3\x03\x00\x00\x00\x00\x00\x00 not a wav at all, just bytes'));
    assert.equal(asr.isPcmWav(mp3), false);
    const float = Buffer.from(encodeWav(new Float32Array(10)));
    float.writeUInt16LE(3, 20);            // format 3: IEEE float
    float.writeUInt16LE(32, 34);
    fs.writeFileSync(path.join(dir, 'float.wav'), float);
    assert.equal(asr.isPcmWav(path.join(dir, 'float.wav')), false);
    assert.equal(asr.isPcmWav(path.join(dir, 'missing.wav')), false);
});

test('OpenAI whisper with no ffmpeg: an mp3 comes back as needs-wav, before anything runs', { skip: process.platform !== 'win32' && 'uses a .cmd stand-in for whisper' }, async (t) => {
    const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'akko-wav-bin-'));
    fs.writeFileSync(path.join(bin, 'whisper.cmd'), '@echo off\r\nexit /b 1\r\n');
    const saved = { PATH: process.env.PATH, AKKO_WHISPER: process.env.AKKO_WHISPER };
    process.env.PATH = bin;                 // whisper here, ffmpeg nowhere
    delete process.env.AKKO_WHISPER;
    t.after(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
    assert.equal(asr.status().tools[0].family, 'openai');
    await assert.rejects(asr.transcribe(path.join(dir, 'a.mp3'), { lang: 'ja' }), (err) => err.code === 'needs-wav' && /ffmpeg/.test(err.message));
});
