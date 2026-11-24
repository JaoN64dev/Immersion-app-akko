// Shadowing (3.0, feature 10): how close your line's melody is to the original's. Pure: samples in,
// numbers out (tests/prosody.test.mjs); scripts/player/shadow.js records and draws.
//
// - pitchTrack: the voice's pitch every 10 ms (autocorrelation, 70–500 Hz), null where it's silent
//   or unvoiced
// - semitones: each voiced frame in semitones from that speaker's own median, so a low voice and a
//   high voice saying the same melody look the same
// - compare: the two contours lined up in time (dynamic time warping, so a slightly faster or slower
//   line isn't punished) and how far apart they are, as a 0–100 "melody match"

export const HOP = 0.01;                  // seconds between frames
const WINDOW = 0.04;                      // seconds analysed per frame
const MIN_HZ = 70, MAX_HZ = 500;
const STRETCH = 0.25;         // semitones added per step that stretches time (tuned on real speech)

// pitch in Hz per frame, or null
export function pitchTrack(samples, rate) {
    const win = Math.round(WINDOW * rate);
    const hop = Math.round(HOP * rate);
    const minLag = Math.floor(rate / MAX_HZ), maxLag = Math.ceil(rate / MIN_HZ);
    // a frame quieter than this (relative to the loudest) is silence
    let peak = 0;
    for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
    const floor = peak * 0.08;
    const out = [];
    for (let start = 0; start + win + maxLag <= samples.length; start += hop) {
        let rms = 0;
        for (let i = 0; i < win; i++) rms += samples[start + i] ** 2;
        rms = Math.sqrt(rms / win);
        if (rms < floor * 0.5) { out.push(null); continue; }
        // normalised autocorrelation. A periodic sound matches itself at 2, 3… periods almost as well
        // as at one, so the period is the shortest lag that is a peak and nearly as good as the best
        const energy0 = energy(samples, start, win);
        const r = new Float64Array(maxLag + 2);
        let best = 0;
        for (let lag = minLag; lag <= maxLag + 1; lag++) {
            let sum = 0;
            for (let i = 0; i < win; i++) sum += samples[start + i] * samples[start + i + lag];
            r[lag] = sum / Math.sqrt(energy0 * energy(samples, start + lag, win) || 1);
            if (lag <= maxLag && r[lag] > best) best = r[lag];
        }
        let period = 0;
        for (let lag = minLag + 1; lag <= maxLag; lag++) {
            if (r[lag] >= best * 0.9 && r[lag] >= r[lag - 1] && r[lag] >= r[lag + 1]) { period = lag; break; }
        }
        out.push(best > 0.6 && period ? refine(samples, start, win, period, rate) : null);
    }
    return out;
}

function energy(s, at, n) {
    let e = 0;
    for (let i = 0; i < n; i++) e += s[at + i] * s[at + i];
    return e;
}

// the period between whole samples, from the neighbouring lags (parabolic interpolation)
function refine(s, at, n, lag, rate) {
    const r = (l) => { let sum = 0; for (let i = 0; i < n; i++) sum += s[at + i] * s[at + i + l]; return sum; };
    const a = r(lag - 1), b = r(lag), c = r(lag + 1);
    const shift = (a - c) / (2 * (a - 2 * b + c) || 1);
    return rate / (lag + (Number.isFinite(shift) && Math.abs(shift) < 1 ? shift : 0));
}

// keep a frame only between voiced neighbours: one stray voiced frame in silence is noise
const tidy = (track) => track.map((v, i) => (v && (track[i - 1] || track[i + 1]) ? v : null));

// a frame far (> 3 semitones) from the median of its voiced neighbours is a tracking slip (an octave
// jump for a frame or two), not the melody: dropped
function despike(st) {
    return st.map((v, i) => {
        if (v === null) return null;
        const near = [];
        for (let k = Math.max(0, i - 4); k <= Math.min(st.length - 1, i + 4); k++) if (k !== i && st[k] !== null) near.push(st[k]);
        if (near.length < 2) return v;
        near.sort((a, b) => a - b);
        return Math.abs(v - near[near.length >> 1]) > 3 ? null : v;
    });
}

// semitones from the speaker's median (null where unvoiced)
export function semitones(track) {
    const voiced = tidy(track).filter(Boolean).sort((a, b) => a - b);
    if (!voiced.length) return track.map(() => null);
    const median = voiced[Math.floor(voiced.length / 2)];
    return despike(tidy(track).map((v) => (v ? 12 * Math.log2(v / median) : null)));
}

// The voiced part of a contour only, each value smoothed a little (5 frames); frames: where each
// value came from in the full track
function voicedPart(st) {
    const values = [], frames = [];
    st.forEach((v, i) => {
        if (v === null) return;
        const near = st.slice(Math.max(0, i - 2), i + 3).filter((x) => x !== null);
        values.push(near.reduce((a, b) => a + b, 0) / near.length);
        frames.push(i);
    });
    return { values, frames };
}

// Dynamic time warping: the cheapest way to pair the two sequences in order
// -> {mean distance, from, to: the stretch of b it used}
function dtw(a, b) {
    const n = a.length, m = b.length;
    // Subsequence alignment: all of the original (a) is matched, but your recording (b) may start
    // and end anywhere — an "eh…" before the line, a restart or an extra word after it cost nothing.
    // The stretch of b that is used has to be between 2/3 and 1.5 times the original's length (you
    // shadow at about the line's own speed), so the line can't be squeezed onto a few frames of b.
    let prev = new Float64Array(m + 1).fill(0);           // row 0: start anywhere in b
    let prevSteps = new Float64Array(m + 1);
    let prevFrom = Int32Array.from({ length: m + 1 }, (_, j) => j);
    for (let i = 1; i <= n; i++) {
        const cur = new Float64Array(m + 1).fill(Infinity);
        const steps = new Float64Array(m + 1);
        const from = new Int32Array(m + 1);
        for (let j = 1; j <= m; j++) {
            const d = Math.abs(a[i - 1] - b[j - 1]);
            // stretching time (a non-diagonal step) costs a little, so the alignment only bends
            // where that really fits better: without it, any melody can be matched by stalling
            let best = prev[j - 1], s = prevSteps[j - 1], f = prevFrom[j - 1];
            if (prev[j] + STRETCH < best) { best = prev[j] + STRETCH; s = prevSteps[j]; f = prevFrom[j]; }
            if (cur[j - 1] + STRETCH < best) { best = cur[j - 1] + STRETCH; s = steps[j - 1]; f = from[j - 1]; }
            cur[j] = best + d;
            steps[j] = s + 1;
            from[j] = f;
        }
        prev = cur;
        prevSteps = steps;
        prevFrom = from;
    }
    let best = { mean: Infinity, from: 0, to: m - 1 };
    for (let j = 1; j <= m; j++) {
        const span = j - prevFrom[j];
        if (span < (n * 2) / 3 || span > n * 1.5) continue;
        const mean = prev[j] / (prevSteps[j] || 1);
        if (mean < best.mean) best = { mean, from: prevFrom[j], to: j - 1 };
    }
    if (best.mean === Infinity) best = { mean: prev[m] / (prevSteps[m] || 1), from: 0, to: m - 1 };   // b far shorter: all of it
    return best;
}

// -> {score 0–100, semitonesOff (mean distance after lining up), voiced: [original, yours] in seconds,
//     match: {from, to} the frames of `yours` that were compared, reason when there's nothing to compare}
export function compare(original, yours) {
    const pa = voicedPart(semitones(original)), pb = voicedPart(semitones(yours));
    const a = pa.values, b = pb.values;
    const voiced = [a.length * HOP, b.length * HOP];
    if (a.length < 10) return { score: null, voiced, reason: "no voice found in the original line" };
    if (b.length < 10) return { score: null, voiced, reason: "no voice found in your recording: check the microphone" };
    const aligned = dtw(a, b);
    const off = aligned.mean;
    // 0 semitones apart: 100; 2.5 apart on average: 0. Japanese pitch moves in small steps, so a
    // different sentence read by the same voice is only about one semitone off (checked on real speech)
    const score = Math.round(Math.max(0, Math.min(100, 100 * (1 - off / 2.5))));
    return { score, semitonesOff: Math.round(off * 100) / 100, voiced, match: { from: pb.frames[aligned.from], to: pb.frames[aligned.to] } };
}
