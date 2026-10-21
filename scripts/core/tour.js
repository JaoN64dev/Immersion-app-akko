// The welcome tour: right after the very first choice of language (scripts/site.js), three small
// bubbles show the way, across pages:
//   1. the sample: 吾輩は猫である's first 40 seconds on Watch (Japanese), or Alice in Wonderland's
//      first chapter in Read (English)
//   2. click a word in it
//   3. the 復習 tab, where the words you mark come back
// Each bubble points at its element (or at the tab of the page it's on), moves on by itself when
// that's done, and can be skipped. Saved in "akko-tour": {step, lang} while it runs, "done" after.

import { store } from "./utils.js";

const KEY = "akko-tour";

const STEPS = {
    ja: [
        { page: "/index.html", anchor: "#try-sample", tab: 'a.tab[href="/"]',
          text: "Start here: a 40-second scene with Japanese subtitles. Click it.",
          away: "Start in 観る Watch: a 40-second scene to try akko.",
          done: () => !!document.querySelector("#sub-overlay .w[data-c]") },
        { page: "/index.html", anchor: "#sub-overlay .w[data-c]", tab: 'a.tab[href="/"]',
          text: "Click any word you don't know: its meaning, and keys 1–4 for how well you know it (2 = learning).",
          away: "Back to 観る Watch, and click a word in the subtitles.",
          done: () => { const p = document.getElementById("popup"); return !!p && !p.hidden; } },
        { anchor: 'a.tab[href="/review.html"]',
          text: "Words you mark as learning come back in 復習, just before you'd forget them. That's the whole idea: have fun!",
          last: true, done: () => here() === "/review.html" },
    ],
    en: [
        { page: "/reading.html", anchor: "#library-list .library-item", tab: 'a.tab[href="/reading.html"]',
          text: "Start here: the first chapter of Alice in Wonderland is waiting. Open it.",
          away: "Start in Read: the first chapter of Alice in Wonderland is waiting.",
          done: () => !!document.querySelector("#reader-text .w[data-c]") },
        { page: "/reading.html", anchor: "#reader-text .w[data-c]", tab: 'a.tab[href="/reading.html"]',
          text: "Click any word you don't know: its meaning, and keys 1–4 for how well you know it (2 = learning).",
          away: "Back to Read, and click a word in the text.",
          done: () => { const p = document.getElementById("popup"); return !!p && !p.hidden; } },
        { anchor: 'a.tab[href="/review.html"]',
          text: "Words you mark as learning come back in review, just before you'd forget them. That's the whole idea: have fun!",
          last: true, done: () => here() === "/review.html" },
    ],
};

const here = () => (location.pathname === "/" ? "/index.html" : location.pathname);
const visible = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";

// called by the welcome screen, the first time a language is chosen
export const begin = (lang) => store.set(KEY, { step: 0, lang: lang === "en" ? "en" : "ja" });

export function start() {
    const state = store.get(KEY, null);
    if (!state || state === "done" || typeof state !== "object") return;
    const steps = STEPS[state.lang] || STEPS.ja;
    let step = state.step || 0;
    if (!steps[step]) { store.set(KEY, "done"); return; }

    const bubble = document.createElement("div");
    bubble.className = "tour";
    bubble.setAttribute("role", "status");
    document.body.appendChild(bubble);
    let target = null, shownFor = "";

    const finish = () => {
        store.set(KEY, "done");
        clearInterval(timer);
        removeEventListener("resize", place);
        removeEventListener("scroll", place, true);
        if (target) target.classList.remove("tour-target");
        bubble.remove();
    };

    function show(s, onPage) {
        const text = onPage ? s.text : s.away;
        const key = `${step}|${text}`;
        if (key === shownFor) return;
        shownFor = key;
        bubble.innerHTML = `<p></p><div class="tour-actions"><span class="tour-count">${step + 1} / ${steps.length}</span>
            ${s.last ? `<button type="button" class="tour-done">done</button>` : `<button type="button" class="tour-skip">skip the tour</button>`}</div>`;
        bubble.querySelector("p").textContent = text;
        bubble.querySelector("button").onclick = finish;
    }

    function place() {
        const r = target && visible(target) ? target.getBoundingClientRect() : null;
        bubble.classList.toggle("floating", !r);
        if (!r) { bubble.style.left = bubble.style.top = ""; return; }
        const w = bubble.offsetWidth, h = bubble.offsetHeight;
        const below = r.bottom + 12 + h < innerHeight || r.top - 12 - h < 0;
        bubble.classList.toggle("above", !below);
        bubble.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2))}px`;
        bubble.style.top = `${below ? r.bottom + 12 : r.top - 12 - h}px`;
    }

    function tick() {
        const s = steps[step];
        if (s.done && s.done()) {
            step++;
            if (!steps[step]) return finish();
            store.set(KEY, { ...state, step });
            return tick();
        }
        const onPage = !s.page || s.page === here();
        const el = document.querySelector(onPage ? s.anchor : s.tab);
        if (el !== target) {
            if (target) target.classList.remove("tour-target");
            target = el;
            if (target) target.classList.add("tour-target");
        }
        show(s, onPage);
        place();
    }

    const timer = setInterval(tick, 500);
    addEventListener("resize", place);
    addEventListener("scroll", place, true);
    tick();
}
