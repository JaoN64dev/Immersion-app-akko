// Time with the language, day by day: for "today" and the streak on the welcome screen.
// Loaded on every page (scripts/site.js). Every 15 seconds it counts 15 seconds if you're
// watching or listening (a video or audio is playing), or reading, reviewing or doing listening
// exercises (on the Read, Review or 聴解 page, with the page in front and the mouse, keyboard or
// scrolling used in the last minute).
//
// Saved per language you learn: "akko-days" (Japanese) / "akko-days-en": {"2026-10-05": seconds}.
// Other devices' days (akko's other windows, browsers, phones, and the browser extension) come in
// through scripts/core/sync.js as "akko-days-others" / -en {device: days}; "today" and the streak
// add them all up.

import { store } from "./utils.js";
import { target } from "./target.js";

const TICK = 15;                       // seconds
const IDLE = 60e3;                     // those pages count while you did something in the last minute
const KEEP_DAYS = 400;
export const STREAK_MIN = 60;          // a day counts for the streak after a minute

export const daysKey = (lang) => (lang === "en" ? "akko-days-en" : "akko-days");

// the local date, "2026-10-05"
export function dayOf(date = new Date()) {
    const d = new Date(date.getTime() - date.getTimezoneOffset() * 60e3);
    return d.toISOString().slice(0, 10);
}

const OTHERS = { ja: "akko-days-others", en: "akko-days-others-en" };

// every device's days added up
export function allDays(lang) {
    const days = { ...store.get(daysKey(lang), {}) };
    for (const other of Object.values(store.get(OTHERS[lang === "en" ? "en" : "ja"], {}))) {
        for (const [day, s] of Object.entries(other || {})) days[day] = (days[day] || 0) + (Number(s) || 0);
    }
    return days;
}

export const secondsOn = (lang, day = dayOf()) => allDays(lang)[day] || 0;

// days in a row with some time, up to today (today not done yet doesn't break it)
export function streak(lang, now = new Date()) {
    const days = allDays(lang);
    const d = new Date(now);
    if (!((days[dayOf(d)] || 0) >= STREAK_MIN)) d.setDate(d.getDate() - 1);
    let n = 0;
    while ((days[dayOf(d)] || 0) >= STREAK_MIN) {
        n++;
        d.setDate(d.getDate() - 1);
    }
    return n;
}

export function addSeconds(lang, seconds, now = new Date()) {
    const key = daysKey(lang);
    const days = store.get(key, {});
    const today = dayOf(now);
    days[today] = (days[today] || 0) + seconds;
    // drop very old days
    const oldest = dayOf(new Date(now.getTime() - KEEP_DAYS * 86400e3));
    for (const day of Object.keys(days)) if (day < oldest) delete days[day];
    store.set(key, days);
}

// ---------- counting ----------

let lastAction = 0;
const playing = () => [...document.querySelectorAll("video, audio")].some((m) => !m.paused && !m.ended && m.readyState > 2);
const ACTIVE_PAGES = ["/reading.html", "/review.html", "/listening.html"];
const studying = () => ACTIVE_PAGES.includes(location.pathname) && document.visibilityState === "visible"
    && Date.now() - lastAction < IDLE;

export function start() {
    if (typeof document === "undefined") return;
    for (const type of ["mousemove", "keydown", "wheel", "touchstart", "scroll"]) {
        addEventListener(type, () => { lastAction = Date.now(); }, { passive: true, capture: true });
    }
    setInterval(() => {
        if (playing() || studying()) addSeconds(target(), TICK);
    }, TICK * 1000);
}
