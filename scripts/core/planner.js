// The planner (3.0): what to read this week, from what you already have.
//
// "Read more" is not a plan. This takes the texts in your library, asks the coverage engine
// (scripts/core/coverage.js) how much of each one you know, and lays out a week: the texts in the
// 85–94% band first — one unknown word every line or two, which is where you actually learn — then
// the ones you already read comfortably, then the ones too hard for now. A text you have started
// comes before an unstarted one in the same band, because finishing something is worth more than
// starting a fourth thing. Everything here is pure: tokens in, a plan out, no storage, no network.

import { coverage, prime as primeOf } from "./coverage.js";

// The bands a learner can act on (the same three Settings → Stats draws). Highest first, so
// bandOf() can stop at the first floor a % clears.
export const BANDS = [
    { key: "comfortable", label: "comfortable", from: 95, hint: "read it for the story, and mine the few words left" },
    { key: "stretch", label: "the stretch", from: 85, hint: "one unknown word every line or two: the fastest way in" },
    { key: "hard", label: "too hard for now", from: 0, hint: "keep it for later, after the words in between" },
];

export const bandOf = (pct) => BANDS.find((b) => pct >= b.from) || BANDS[BANDS.length - 1];

// Words a minute is a plan, not a promise: Japanese is read slower than a Latin alphabet, and the
// point is an order of magnitude (this text is 10 minutes, that one is an hour).
const WORDS_PER_MINUTE = 100;
export const minutesFor = (words) => Math.max(5, Math.round((words || 0) / WORDS_PER_MINUTE));

// One item per text you have: {id, title, lines} (lines are what /api/tokenize gives, one array of
// tokens per paragraph), plus whether you're already in it, and how long it is.
// -> the same items with {pct, total, unknown, iPlus1, band, minutes, started}
export function assess(items, { status } = {}) {
    return items.map((item) => {
        // A video or a podcast already knows its number: its page recorded the coverage it was
        // showing (scripts/player/render.js, scripts/podcasts/player.js), so there are no tokens here
        // to count — and nothing to re-tokenize just to plan a week.
        if (!item.lines && typeof item.pct === "number") {
            return {
                ...item,
                total: item.total || 0,
                unknown: item.unknown || 0,
                iPlus1: item.iPlus1 || 0,
                band: bandOf(item.pct).key,
                minutes: item.minutes || 15,
                started: !!item.started || item.position > 0,
            };
        }
        const c = coverage(item.lines || [], status ? { status } : undefined);
        const words = c.total;
        return {
            ...item,
            pct: c.pct,
            total: words,
            unknown: c.unknown.size,
            iPlus1: c.iPlus1,
            band: bandOf(c.pct).key,
            minutes: item.minutes || minutesFor(words),
            started: c.total > 0 && (item.started || item.position > 0),
        };
    });
}

const ORDER = { stretch: 0, comfortable: 1, hard: 2 };

// The week: `days` sessions of about `minutes` each, in band order, no text twice.
// -> {days: [{day, items: [...], minutes}], left: [...], words: Map}
export function planWeek(items, { days = 7, minutes = 20 } = {}) {
    const assessed = assess(items);
    const sorted = [...assessed].sort((a, b) => (ORDER[a.band] - ORDER[b.band])
        || (Number(b.started) - Number(a.started))
        || (b.pct - a.pct)
        || a.minutes - b.minutes);
    const plan = [];
    let at = 0;
    for (let day = 1; day <= days; day++) {
        const today = [];
        let spent = 0;
        while (at < sorted.length && (spent === 0 || spent + sorted[at].minutes <= minutes)) {
            today.push(sorted[at]);
            spent += sorted[at].minutes;
            at++;
        }
        if (!today.length) break;
        plan.push({ day, items: today, minutes: spent });
    }
    return { days: plan, left: sorted.slice(at), items: assessed };
}

// The words that would make the plan easier: the ones shared by most of the planned texts, ranked
// the way the reader ranks a single text (scripts/core/coverage.js prime).
export function planPriming(plan, { limit = 12, status } = {}) {
    const lines = plan.days.flatMap((d) => d.items.flatMap((i) => i.lines || []));
    return primeOf(lines, { limit, ...(status ? { status } : {}) });
}
