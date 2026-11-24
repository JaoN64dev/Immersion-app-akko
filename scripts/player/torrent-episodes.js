// Which episode of a batch torrent to open (pure, tests/torrent-episodes.test.mjs).
// records: the "continue watching" records ({url, time, duration, updated}); hash: the torrent's;
// files: its episodes in watching order ({index, name}). The one watched last, or the one after it
// when that one was finished; the first episode when none of them was watched yet.

const LINK = /^\/api\/torrent\/([a-f0-9]{40})\/(\d+)\//;
export const FINISHED = 0.9;            // watched this far: the episode counts as seen

export function pickEpisode(records, hash, files) {
    if (!files.length) return null;
    const mine = (records || [])
        .filter((r) => r && typeof r.url === "string" && (LINK.exec(r.url) || [])[1] === hash)
        .sort((a, b) => (b.updated || 0) - (a.updated || 0));
    for (const r of mine) {
        const at = files.findIndex((f) => f.index === Number(LINK.exec(r.url)[2]));
        if (at < 0) continue;
        const done = r.duration > 0 && r.time / r.duration >= FINISHED;
        return done && at + 1 < files.length ? files[at + 1] : files[at];
    }
    return files[0];
}
