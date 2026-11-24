// Shadowing's melody comparison (scripts/core/prosody.js), on made-up voices: a tone with harmonics
// whose pitch follows a contour, with pauses — enough to check the rules that matter.
import { test } from 'node:test';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { pitchTrack, semitones, compare, HOP } from '../scripts/core/prosody.js';

const RATE = 16000;

// a "voice": f0(t) for t in 0..1 over `seconds`, silent where f0 returns 0
function voice(seconds, f0, { noise = 0 } = {}) {
    const n = Math.round(seconds * RATE);
    const out = new Float32Array(n);
    let phase = 0;
    for (let i = 0; i < n; i++) {
        const hz = f0(i / n);
        if (!hz) { phase = 0; out[i] = noise * (Math.random() - 0.5); continue; }
        phase += (2 * Math.PI * hz) / RATE;
        out[i] = 0.5 * Math.sin(phase) + 0.25 * Math.sin(2 * phase) + 0.12 * Math.sin(3 * phase) + noise * (Math.random() - 0.5);
    }
    return out;
}
// rise, fall, pause, rise: a melody
const melody = (base) => (x) => (x < 0.3 ? base * (1 + x) : x < 0.55 ? base * (1.3 - (x - 0.3) * 1.6) : x < 0.65 ? 0 : base * (0.9 + (x - 0.65) * 0.8));
const flat = (base) => (x) => (x > 0.55 && x < 0.65 ? 0 : base);
const upsideDown = (base) => { const m = melody(base); return (x) => { const v = m(x); return v ? (base * base * 1.1) / v : 0; }; };

test('the pitch of a steady tone is found', () => {
    const track = pitchTrack(voice(0.5, () => 220), RATE);
    const voiced = track.filter(Boolean);
    assert.ok(voiced.length > track.length * 0.8, 'mostly voiced');
    const avg = voiced.reduce((a, b) => a + b, 0) / voiced.length;
    assert.ok(Math.abs(avg - 220) < 4, `found ${avg.toFixed(1)} Hz`);
});

test('silence is unvoiced', () => {
    const track = pitchTrack(voice(0.6, (x) => (x < 0.5 ? 200 : 0)), RATE);
    const tail = track.slice(Math.round(0.35 / HOP));
    assert.ok(tail.filter((v) => v === null).length > tail.length * 0.7);
});

test('semitones are measured from the speaker\'s own middle, so a low and a high voice match', () => {
    const low = semitones(pitchTrack(voice(1, () => 110), RATE)).filter((v) => v !== null);
    const high = semitones(pitchTrack(voice(1, () => 220), RATE)).filter((v) => v !== null);
    assert.ok(Math.abs(low[5]) < 0.3 && Math.abs(high[5]) < 0.3);
});

test('the same melody scores high, an octave apart and a bit faster too', () => {
    const original = pitchTrack(voice(1.2, melody(220)), RATE);
    assert.ok(compare(original, pitchTrack(voice(1.2, melody(220)), RATE)).score >= 90, 'identical');
    const r = compare(original, pitchTrack(voice(1.0, melody(110), { noise: 0.02 }), RATE));
    assert.ok(r.score >= 75, `an octave lower, 20% faster, a little noise: ${r.score}`);
});

test('a flat or upside-down melody scores clearly lower', () => {
    const original = pitchTrack(voice(1.2, melody(200)), RATE);
    const same = compare(original, pitchTrack(voice(1.2, melody(150)), RATE)).score;
    const monotone = compare(original, pitchTrack(voice(1.2, flat(150)), RATE)).score;
    const inverted = compare(original, pitchTrack(voice(1.2, upsideDown(150)), RATE)).score;
    assert.ok(monotone < same - 20, `monotone ${monotone} vs same ${same}`);
    assert.ok(inverted < same - 25 && inverted < 75, `upside down ${inverted} vs same ${same}`);
});

test('nothing to compare says why instead of a number', () => {
    const original = pitchTrack(voice(1, melody(200)), RATE);
    const silent = pitchTrack(new Float32Array(RATE), RATE);
    assert.equal(compare(original, silent).score, null);
    assert.match(compare(original, silent).reason, /microphone/);
    assert.match(compare(silent, original).reason, /original/);
});

// ---------- real speech ----------
// Pitch tracks measured from real recordings (tests/fixtures/prosody-tracks.json): the sample video's
// voice, and another voice saying the same sentence (from a file, faster, and through a microphone that
// loops it) or a different one. The same sentence has to score well above any different sentence.
const fixture = JSON.parse(fs.readFileSync(new URL("./fixtures/prosody-tracks.json", import.meta.url), "utf8")).tracks;
const tr = (prefix) => Object.entries(fixture).find(([k]) => k.startsWith(prefix))[1];

test("real speech: the same sentence in another voice scores high, other sentences low", () => {
    const line2 = tr("line2"), line3 = tr("line3");
    const same = [
        compare(line2, tr("other voice: 名前")).score,
        compare(line2, tr("other voice through a microphone")).score,
        compare(tr("other voice: 名前"), tr("other voice, faster")).score,
    ];
    const other = [
        compare(line2, tr("other voice: 明日")).score,
        compare(line3, tr("other voice: 名前")).score,
        compare(line2, line3).score,
        compare(tr("other voice: 名前"), tr("other voice: 明日")).score,
    ];
    assert.ok(Math.min(...same) >= 78, `same sentence: ${same}`);
    assert.ok(Math.max(...other) <= 72, `other sentences: ${other}`);
    assert.ok(Math.min(...same) - Math.max(...other) >= 8, "a clear gap between the two");
});
