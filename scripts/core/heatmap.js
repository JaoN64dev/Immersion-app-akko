// The year at a glance (3.0, feature 14's heatmap): one square per day for the last year, darker the
// longer you spent with the language, one column per week (Monday on top). Pure: it takes the
// {"2026-11-24": seconds} days that scripts/core/today.js keeps and returns the grid and its totals
// (tests/heatmap.test.mjs); scripts/pages/stats.js draws it.

export const ACTIVE_SECONDS = 60;                      // a day counts once it has a minute, like the streak
const LEVELS = [15 * 60, 30 * 60, 60 * 60];           // under 15 min, under 30, under an hour, an hour or more
const DAY = 864e5;

const parse = (day) => Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10));
const format = (ms) => new Date(ms).toISOString().slice(0, 10);

// 0 nothing, 1–4 more and more time
export function levelOf(seconds) {
    if (!(seconds >= ACTIVE_SECONDS)) return 0;
    return 1 + LEVELS.filter((s) => seconds >= s).length;
}

// days: {day: seconds}; today: "YYYY-MM-DD"; weeks: how many columns.
// -> {weeks: [[{day, seconds, level} | null] × 7], months: [{week, month}], active, longest, hours}
//    null cells are the days after today in this week. months: where each month's first column is.
export function yearGrid(days, today, weeks = 53) {
    const end = parse(today);
    const weekday = (new Date(end).getUTCDay() + 6) % 7;          // Monday 0 … Sunday 6
    const start = end - (weekday + (weeks - 1) * 7) * DAY;
    const grid = [];
    const months = [];
    let active = 0, longest = 0, run = 0, seconds = 0;
    for (let w = 0; w < weeks; w++) {
        const column = [];
        for (let d = 0; d < 7; d++) {
            const t = start + (w * 7 + d) * DAY;
            if (t > end) { column.push(null); continue; }
            const day = format(t);
            const s = Math.max(0, Number(days && days[day]) || 0);
            const level = levelOf(s);
            column.push({ day, seconds: s, level });
            seconds += s;
            if (level) { active++; run++; longest = Math.max(longest, run); } else run = 0;
            if (day.endsWith("-01") || (w === 0 && d === 0)) months.push({ week: w, month: +day.slice(5, 7) - 1, year: +day.slice(0, 4) });
        }
        grid.push(column);
    }
    // a month whose first day falls late in a column is labelled on that column; drop a label that
    // would sit right on top of the next one
    const labels = months.filter((m, i) => !months[i + 1] || months[i + 1].week - m.week >= 2);
    return { weeks: grid, months: labels, active, longest, hours: Math.round(seconds / 360) / 10 };
}
