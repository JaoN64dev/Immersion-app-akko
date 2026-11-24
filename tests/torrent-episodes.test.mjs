// Which episode of a season torrent opens (scripts/player/torrent-episodes.js): the one you watched
// last, the next one if you finished it, the first one if you never started.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickEpisode } from '../scripts/player/torrent-episodes.js';

const H = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);
const files = [
    { index: 2, name: 'Show - 01.mkv' },
    { index: 0, name: 'Show - 02.mkv' },
    { index: 1, name: 'Show - 03.mkv' },
];
const rec = (hash, index, time, duration, updated) => ({ url: `/api/torrent/${hash}/${index}/x.mkv`, time, duration, updated });

test('never watched: the first episode', () => {
    assert.equal(pickEpisode([], H, files).name, 'Show - 01.mkv');
    assert.equal(pickEpisode([rec(OTHER, 0, 100, 1400, 9)], H, files).name, 'Show - 01.mkv', 'another torrent does not count');
    assert.equal(pickEpisode([{ url: 'https://example.com/a.mp4', time: 1 }], H, files).name, 'Show - 01.mkv');
});

test('half-way through an episode: that episode again', () => {
    assert.equal(pickEpisode([rec(H, 0, 600, 1400, 5)], H, files).name, 'Show - 02.mkv');
});

test('finished an episode: the next one', () => {
    assert.equal(pickEpisode([rec(H, 0, 1350, 1400, 5)], H, files).name, 'Show - 03.mkv');
});

test('the most recent record wins', () => {
    const records = [rec(H, 2, 1390, 1400, 1), rec(H, 1, 200, 1400, 7), rec(H, 0, 1390, 1400, 3)];
    assert.equal(pickEpisode(records, H, files).name, 'Show - 03.mkv');
});

test('finished the last episode: stays on it, and an unknown file index is skipped', () => {
    assert.equal(pickEpisode([rec(H, 1, 1390, 1400, 5)], H, files).name, 'Show - 03.mkv');
    assert.equal(pickEpisode([rec(H, 9, 10, 1400, 8), rec(H, 0, 10, 1400, 2)], H, files).name, 'Show - 02.mkv');
    assert.equal(pickEpisode([], H, []), null);
});
