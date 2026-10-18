// 復習 Review page (review.html): flashcards of the words marked "learning", for days without Anki,
// scheduled with FSRS (scripts/words/fsrs.js): each word comes back just before you'd forget it.
// A session is the words due, then up to NEW_PER_DAY words never reviewed. A mined word shows its
// sentence, the scene's picture and plays the line (kept by scripts/core/media.js).
// Grades: 1 again · 2 hard · 3 good · 4 easy, K known (leaves the review). A word whose next
// review is GRADUATE days away or more becomes known (like Anki's "mature" cards when importing).
// Saved in "akko-review" / -en {lemma: card} and "akko-review-new" / -en {day, n}.

import { $ } from "../core/dom.js";
import { store, escapeHtml, getJson } from "../core/utils.js";
import { idbAll } from "../core/idb.js";
import { keyFor, target, ofTarget, nativeLang, NATIVE_LANGUAGES } from "../core/target.js";
import { setWordStatus, wordStatus } from "../words/status.js";
import { review, preview, isDue, intervalDays, describe } from "../words/fsrs.js";
import { mediaOf } from "../core/media.js";
import { dayOf } from "../core/today.js";

const NEW_PER_DAY = 20;
const GRADUATE = 21;                          // days
const WORDS = keyFor("akko-words");
const CARDS = keyFor("akko-review");          // {lemma: {s, d, due, last, reps, lapses}}
const NEW_TODAY = keyFor("akko-review-new");  // {day, n}

const ui = { card: $("#review-card"), progress: $("#review-progress") };

let queue = [];       // [{lemma, mined, isNew}]
let at = 0;
let shown = false;
let urls = [];        // object URLs of the card on screen
let audio = null;
const counts = { again: 0, hard: 0, good: 0, easy: 0, known: 0, graduated: 0 };
const GRADES = { 1: "again", 2: "hard", 3: "good", 4: "easy" };

// a card from before FSRS ({last, again, good}) starts again as new
const cardOf = (cards, lemma) => (cards[lemma] && cards[lemma].s ? cards[lemma] : null);

function newToday() {
    const n = store.get(NEW_TODAY, {});
    return n.day === dayOf() ? n.n : 0;
}

// ---------- building a session ----------

async function startSession() {
    const words = store.get(WORDS, {});
    const cards = store.get(CARDS, {});
    const learning = Object.keys(words).filter((w) => words[w] === "learning");
    // the sentence each word was mined from (newest card wins)
    const mined = new Map();
    for (const m of (await idbAll("mined").catch(() => [])).filter(ofTarget).sort((a, b) => a.added - b.added)) {
        for (const key of [m.word, m.surface]) if (key) mined.set(key, m);
    }
    const now = Date.now();
    const due = learning.filter((w) => isDue(cardOf(cards, w), now))
        .sort((a, b) => cards[a].due - cards[b].due)
        .map((lemma) => ({ lemma, mined: mined.get(lemma) || null, isNew: false }));
    // new words: the mined ones first (they have a sentence), then the rest at random
    const fresh = learning.filter((w) => !cardOf(cards, w))
        .map((lemma) => ({ lemma, mined: mined.get(lemma) || null, isNew: true, r: Math.random() }))
        .sort((a, b) => (!!b.mined - !!a.mined) || a.r - b.r)
        .slice(0, Math.max(0, NEW_PER_DAY - newToday()));
    queue = [...due, ...fresh];
    at = 0;
    Object.keys(counts).forEach((k) => { counts[k] = 0; });
    show();
}

// ---------- one card ----------

const lang = () => target();

function sentenceHtml(m, lemma) {
    if (!m || !m.sentence) return "";
    const mark = [m.surface, m.word, lemma].filter(Boolean).find((w) => m.sentence.includes(w));
    const html = escapeHtml(m.sentence);
    return `<p class="review-sentence" lang="${lang()}">${mark ? html.split(escapeHtml(mark)).join(`<mark>${escapeHtml(mark)}</mark>`) : html}</p>`;
}

function clearMedia() {
    if (audio) audio.pause();
    audio = null;
    urls.forEach((u) => URL.revokeObjectURL(u));
    urls = [];
}

function nothingDue() {
    const words = store.get(WORDS, {});
    const cards = store.get(CARDS, {});
    const learning = Object.keys(words).filter((w) => words[w] === "learning");
    if (!learning.length) {
        return `<p class="review-empty">No words to review. Mark words as <b>learning</b> with key <kbd>2</kbd> while you watch or read (mining a word does it too).</p>`;
    }
    const next = learning.map((w) => cardOf(cards, w)).filter(Boolean).reduce((m, c) => Math.min(m, c.due), Infinity);
    const waiting = learning.filter((w) => !cardOf(cards, w)).length;
    return `<p class="review-empty">Nothing to review right now ✓${isFinite(next) ? ` The next word comes back in <b>${escapeHtml(describe(next - Date.now()))}</b>.` : ""}
        ${waiting ? `<br>${waiting} new word${waiting > 1 ? "s" : ""} wait${waiting > 1 ? "" : "s"} for tomorrow (${NEW_PER_DAY} new a day).` : ""}</p>`;
}

async function show() {
    shown = false;
    clearMedia();
    if (!queue.length) {
        ui.card.innerHTML = nothingDue();
        ui.progress.textContent = "";
        return;
    }
    if (at >= queue.length) return finish();
    const { lemma, mined, isNew } = queue[at];
    ui.card.innerHTML = `
        ${isNew ? `<p class="review-new">new</p>` : ""}
        <div class="review-word" lang="${lang()}" translate="no">${escapeHtml(lemma)}</div>
        ${sentenceHtml(mined, lemma)}
        <div class="review-media"></div>
        <div class="review-answer" hidden></div>
        <div class="review-buttons">
            <button class="review-show">show <kbd>space</kbd></button>
        </div>`;
    ui.card.querySelector(".review-show").addEventListener("click", reveal);
    const left = queue.length - at;
    ui.progress.textContent = `${left} to go`;
    // the scene and the line, if the word was mined from a video
    const media = mined ? await mediaOf(mined.id) : null;
    if (!media || !queue[at] || queue[at].lemma !== lemma) return;
    const box = ui.card.querySelector(".review-media");
    if (media.picture) {
        const u = URL.createObjectURL(media.picture);
        urls.push(u);
        box.insertAdjacentHTML("beforeend", `<img class="review-picture" src="${u}" alt="the scene the word comes from">`);
    }
    if (media.audio) {
        const u = URL.createObjectURL(media.audio);
        urls.push(u);
        audio = new Audio(u);
        box.insertAdjacentHTML("beforeend", `<button class="review-play" title="hear the line (P)">▶ the line</button>`);
        box.querySelector(".review-play").addEventListener("click", play);
    }
}

function play() {
    if (!audio) return;
    audio.currentTime = 0;
    audio.play().catch(() => {});
}

async function reveal() {
    if (shown || at >= queue.length) return;
    shown = true;
    const { lemma, mined } = queue[at];
    const answer = ui.card.querySelector(".review-answer");
    answer.hidden = false;
    answer.innerHTML = `<p class="muted">…</p>`;
    play();
    const when = preview(cardOf(store.get(CARDS, {}), lemma) || {});
    ui.card.querySelector(".review-buttons").innerHTML = `
        ${[1, 2, 3, 4].map((g) => `<button data-grade="${g}">${GRADES[g]} <small>${escapeHtml(when[g])}</small> <kbd>${g}</kbd></button>`).join("")}
        <button data-grade="known" class="review-known">known ✓ <kbd>K</kbd></button>`;
    ui.card.querySelectorAll("[data-grade]").forEach((b) => b.addEventListener("click", () => grade(b.dataset.grade)));

    let entry = null;
    try {
        const qs = new URLSearchParams({ q: lemma, lang: lang(), native: nativeLang() });
        entry = (await getJson("/api/dict?" + qs)).entries[0] || null;
    } catch { /* offline: the mined card's meaning below */ }
    if (!queue[at] || queue[at].lemma !== lemma) return;     // already graded
    const tr = entry && entry.tr && entry.tr.length
        ? `<p class="review-tr" translate="no"><small>${escapeHtml(NATIVE_LANGUAGES[nativeLang()] || "")}</small> ${escapeHtml([...new Set(entry.tr.flatMap((s) => s.words))].slice(0, 5).join(", "))}</p>` : "";
    const senses = entry ? entry.senses.slice(0, 3).map((s) => `<li>${escapeHtml(s.gloss.join("; "))}</li>`).join("") : "";
    answer.innerHTML = `
        ${entry && entry.reading ? `<p class="review-reading" lang="${lang()}" translate="no">${escapeHtml(entry.reading)}</p>` : ""}
        ${tr}
        ${senses ? `<ol class="review-senses" translate="no">${senses}</ol>` : mined && mined.meaning ? `<p translate="no">${escapeHtml(mined.meaning)}</p>` : `<p class="muted">no dictionary entry</p>`}
        ${mined && mined.translation ? `<p class="review-translation" translate="no">${escapeHtml(mined.translation)}</p>` : ""}`;
}

function grade(how) {
    if (!shown) return;
    const { lemma, isNew } = queue[at];
    if (how === "known") {
        setWordStatus(lemma, "known");
        counts.known++;
    } else {
        const g = Number(how);
        const cards = store.get(CARDS, {});
        const card = review(cardOf(cards, lemma) || {}, g);
        cards[lemma] = card;
        store.set(CARDS, cards);
        counts[GRADES[g]]++;
        if (isNew && !queue.slice(0, at).some((q) => q.lemma === lemma)) {
            store.set(NEW_TODAY, { day: dayOf(), n: newToday() + 1 });
        }
        if (g === 1) {
            // again: back at the end of this session
            if (queue.slice(at + 1).every((q) => q.lemma !== lemma)) queue.push({ ...queue[at], isNew: false });
        } else if (intervalDays(card.s) >= GRADUATE && wordStatus(lemma) === "learning") {
            setWordStatus(lemma, "known");          // it stuck: it leaves the review
            counts.graduated++;
        }
    }
    at++;
    show();
}

function finish() {
    clearMedia();
    const parts = [["again", counts.again], ["hard", counts.hard], ["good", counts.good], ["easy", counts.easy], ["known", counts.known + counts.graduated]]
        .filter(([, n]) => n).map(([k, n]) => `${n} ${k}`);
    ui.card.innerHTML = `
        <p class="review-done">Done! ${parts.join(" · ") || "nothing reviewed"}</p>
        ${counts.graduated ? `<p class="muted">${counts.graduated} word${counts.graduated > 1 ? "s" : ""} won't be due for 3 weeks or more: marked known.</p>` : ""}
        <div class="review-buttons"><button class="review-again">check again</button></div>`;
    ui.card.querySelector(".review-again").addEventListener("click", startSession);
    ui.progress.textContent = "";
}

document.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.target.matches("input, textarea, select")) return;
    if (e.key === " ") { e.preventDefault(); reveal(); }
    else if (e.key === "p" || e.key === "P") play();
    else if (shown && GRADES[e.key]) grade(e.key);
    else if (shown && (e.key === "k" || e.key === "K")) grade("known");
});

startSession();
