// Spaced repetition for 復習 (scripts/pages/review.js): when to see a word again, with FSRS-4.5
// (the scheduler Anki uses, https://github.com/open-spaced-repetition), its default weights.
// A card: {s: stability in days, d: difficulty 1-10, due (ms), last (ms), reps, lapses}.
// Grades: 1 again, 2 hard, 3 good, 4 easy. A card with no s is new.
// Pure functions: no storage, no page (tested in tests/fsrs.test.mjs).

const W = [0.4872, 1.4003, 3.7145, 13.8206, 5.1618, 1.2298, 0.8975, 0.031, 1.6474, 0.1367, 1.0461,
    2.1072, 0.0793, 0.3246, 1.587, 0.2272, 2.8755];
const DECAY = -0.5;
const FACTOR = 19 / 81;            // so that retrievability is 90% after S days
export const RETENTION = 0.9;      // the chance to remember a word when it comes back
const DAY = 864e5;
const MAX_DAYS = 3650;

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

// how likely the word is remembered `days` after the last review
export const retrievability = (days, s) => Math.pow(1 + FACTOR * days / s, DECAY);

// the interval (days) that keeps the chance at RETENTION
export const intervalDays = (s) => clamp(Math.round((s / FACTOR) * (Math.pow(RETENTION, 1 / DECAY) - 1)), 1, MAX_DAYS);

const initialS = (g) => W[g - 1];
const initialD = (g) => clamp(W[4] - (g - 3) * W[5], 1, 10);

function nextD(d, g) {
    const d1 = d - W[6] * (g - 3);
    return clamp(W[7] * initialD(4) + (1 - W[7]) * d1, 1, 10);       // a little back towards the middle
}

function recallS(d, s, r, g) {
    const hard = g === 2 ? W[15] : 1;
    const easy = g === 4 ? W[16] : 1;
    return s * (Math.exp(W[8]) * (11 - d) * Math.pow(s, -W[9]) * (Math.exp(W[10] * (1 - r)) - 1) * hard * easy + 1);
}

const forgetS = (d, s, r) => W[11] * Math.pow(d, -W[12]) * (Math.pow(s + 1, W[13]) - 1) * Math.exp(W[14] * (1 - r));

// The card after a grade, at `now`. "again" brings it back in the same session (due in a minute).
export function review(card, grade, now = Date.now()) {
    const g = clamp(Math.round(grade), 1, 4);
    const c = { reps: 0, lapses: 0, ...card };
    let s, d;
    if (!c.s) {
        s = initialS(g);
        d = initialD(g);
    } else {
        const days = Math.max(0, (now - (c.last || now)) / DAY);
        const r = retrievability(days, c.s);
        d = nextD(c.d || initialD(3), g);
        // seen again the same day: stability barely moves (FSRS's short-term rule, simplified)
        if (days < 0.5 && g >= 2) s = g === 4 ? c.s * 1.2 : c.s;
        else s = g === 1 ? Math.min(forgetS(d, c.s, r), c.s) : recallS(d, c.s, r, g);
    }
    const out = { ...c, s, d, last: now, reps: c.reps + 1 };
    if (g === 1) {
        out.lapses = c.s ? c.lapses + 1 : c.lapses;
        out.due = now + 60e3;
    } else {
        out.due = now + intervalDays(s) * DAY;
    }
    return out;
}

// What each grade would do, for the buttons: {1: "1 min", 2: "2 d", …}
export function preview(card, now = Date.now()) {
    const out = {};
    for (const g of [1, 2, 3, 4]) out[g] = describe(review(card, g, now).due - now);
    return out;
}

export function describe(ms) {
    const min = ms / 60e3;
    if (min < 60) return `${Math.max(1, Math.round(min))} min`;
    const days = ms / DAY;
    if (days < 1) return `${Math.round(min / 60)} h`;
    if (days < 31) return `${Math.round(days)} d`;
    if (days < 365) return `${Math.round(days / 30)} mo`;
    return `${(days / 365).toFixed(1)} y`;
}

export const isDue = (card, now = Date.now()) => !!card && !!card.s && (card.due || 0) <= now;
