// 復習 Review page (review.html): flashcards of the words marked "learning", for days without Anki.
// The ones not reviewed for longest come first; a mined word shows the sentence it was found in.
// "known" marks the word known (it leaves the review); review dates are saved in "akko-review".

import { $ } from "../core/dom.js";
import { store, escapeHtml, getJson } from "../core/utils.js";
import { idbAll } from "../core/idb.js";
import { keyFor, target, ofTarget, nativeLang, NATIVE_LANGUAGES } from "../core/target.js";
import { setWordStatus } from "../words/status.js";

const SESSION = 20;
const WORDS = keyFor("akko-words");
const REVIEWED = keyFor("akko-review");     // {lemma: {last, again, good}}

const ui = { card: $("#review-card"), progress: $("#review-progress") };

let queue = [];       // [{lemma, mined}]
let at = 0;
let shown = false;
const counts = { again: 0, good: 0, known: 0 };

// ---------- building a session ----------

async function startSession() {
    const words = store.get(WORDS, {});
    const reviewed = store.get(REVIEWED, {});
    const learning = Object.keys(words).filter((w) => words[w] === "learning");
    // the sentence each word was mined from (newest card wins)
    const mined = new Map();
    for (const m of (await idbAll("mined").catch(() => [])).filter(ofTarget).sort((a, b) => a.added - b.added)) {
        for (const key of [m.word, m.surface]) if (key) mined.set(key, m);
    }
    queue = learning
        .map((lemma) => ({ lemma, mined: mined.get(lemma) || null, last: (reviewed[lemma] || {}).last || 0, r: Math.random() }))
        .sort((a, b) => a.last - b.last || a.r - b.r)
        .slice(0, SESSION);
    at = 0;
    Object.assign(counts, { again: 0, good: 0, known: 0 });
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

function show() {
    shown = false;
    if (!queue.length) {
        ui.card.innerHTML = `<p class="review-empty">No words to review. Mark words as <b>learning</b> with key <kbd>2</kbd> while you watch or read (mining a word does it too).</p>`;
        ui.progress.textContent = "";
        return;
    }
    if (at >= queue.length) return finish();
    const { lemma, mined } = queue[at];
    ui.card.innerHTML = `
        <div class="review-word" lang="${lang()}" translate="no">${escapeHtml(lemma)}</div>
        ${sentenceHtml(mined, lemma)}
        <div class="review-answer" hidden></div>
        <div class="review-buttons">
            <button class="review-show">show <kbd>space</kbd></button>
        </div>`;
    ui.card.querySelector(".review-show").addEventListener("click", reveal);
    ui.progress.textContent = `${at + 1} / ${queue.length}`;
}

async function reveal() {
    if (shown || at >= queue.length) return;
    shown = true;
    const { lemma, mined } = queue[at];
    const answer = ui.card.querySelector(".review-answer");
    answer.hidden = false;
    answer.innerHTML = `<p class="muted">…</p>`;
    ui.card.querySelector(".review-buttons").innerHTML = `
        <button data-grade="again">again <kbd>1</kbd></button>
        <button data-grade="good">good <kbd>2</kbd></button>
        <button data-grade="known" class="review-known">known ✓ <kbd>3</kbd></button>`;
    ui.card.querySelectorAll("[data-grade]").forEach((b) => b.addEventListener("click", () => grade(b.dataset.grade)));

    let entry = null;
    try {
        const qs = new URLSearchParams({ q: lemma, lang: lang(), native: nativeLang() });
        entry = (await getJson("/api/dict?" + qs)).entries[0] || null;
    } catch { /* offline: the mined card's meaning below */ }
    if (queue[at] && queue[at].lemma !== lemma) return;     // already graded
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
    const { lemma } = queue[at];
    const reviewed = store.get(REVIEWED, {});
    const r = reviewed[lemma] || { again: 0, good: 0 };
    reviewed[lemma] = { ...r, last: Date.now(), [how === "again" ? "again" : "good"]: (r[how === "again" ? "again" : "good"] || 0) + 1 };
    store.set(REVIEWED, reviewed);
    if (how === "known") setWordStatus(lemma, "known");
    counts[how]++;
    // "again" comes back at the end of this session
    if (how === "again" && queue.slice(at + 1).every((q) => q.lemma !== lemma)) queue.push(queue[at]);
    at++;
    show();
}

function finish() {
    ui.card.innerHTML = `
        <p class="review-done">Done! ${counts.known} known · ${counts.good} good · ${counts.again} again</p>
        <div class="review-buttons"><button class="review-again">review more</button></div>`;
    ui.card.querySelector(".review-again").addEventListener("click", startSession);
    ui.progress.textContent = "";
}

document.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.target.matches("input, textarea, select")) return;
    if (e.key === " ") { e.preventDefault(); reveal(); }
    else if (shown && e.key === "1") grade("again");
    else if (shown && e.key === "2") grade("good");
    else if (shown && e.key === "3") grade("known");
});

startSession();
