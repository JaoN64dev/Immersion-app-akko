// 文法 Grammar page (grammar.html): lessons from grammar/*.md with clickable examples,
// a quiz and a "learned" mark. The open lesson is in the address (#te-iru).

import { $ } from "../core/dom.js";
import { store, escapeHtml } from "../core/utils.js";
import * as popup from "../popup.js";
import { initKeys } from "../keys.js";
import { tokenize, tokensHtml, plainHtml, recolor } from "../words/render.js";
import { bindWordDisplay } from "../words/display.js";
import { watchHover } from "../words/hover.js";
import { markdown } from "../grammar/markdown.js";
import { loadLessons, loadLesson, allProgress, lessonProgress, saveProgress } from "../grammar/lessons.js";
import { keyFor, target } from "../core/target.js";

const VIEW = keyFor("akko-grammar-view");      // {level, hideTranslations, last}

const ui = {
    problems: $("#grammar-problems"), filter: $("#grammar-filter"), levels: $("#grammar-levels"),
    progress: $("#grammar-progress"), list: $("#grammar-list"), lesson: $("#grammar-lesson"),
    hideTranslations: $("#hide-translations"),
};

let lessons = [];
let current = null;
let job = 0;                   // bumps when another lesson opens, so a late tokenize is dropped
const view = { level: "all", hideTranslations: false, last: null, ...store.get(VIEW, {}) };
const saveView = () => store.set(VIEW, view);

// ---------- list ----------

const levelsOf = () => [...new Set(lessons.map((l) => l.level))];

function renderLevels() {
    const levels = ["all", ...levelsOf()];
    if (!levels.includes(view.level)) view.level = "all";
    ui.levels.innerHTML = levels.map((l) =>
        `<button role="tab" data-level="${escapeHtml(l)}" aria-selected="${l === view.level}">${l === "all" ? "all" : escapeHtml(l)}</button>`).join("");
}

function visible() {
    const q = ui.filter.value.trim().toLowerCase();
    return lessons.filter((l) => (view.level === "all" || l.level === view.level)
        && (!q || `${l.title} ${l.meaning} ${l.id}`.toLowerCase().includes(q)));
}

function renderList() {
    const progress = allProgress();
    const shown = visible();
    const learned = lessons.filter((l) => progress[l.id]?.learned).length;
    ui.progress.textContent = lessons.length ? `${learned} / ${lessons.length} learned` : "";
    if (!shown.length) {
        ui.list.innerHTML = `<p class="empty-light">${lessons.length ? "no lesson matches" : "no lessons yet: add .md files to the grammar folder"}</p>`;
        return;
    }
    const groups = new Map();
    shown.forEach((l) => { if (!groups.has(l.level)) groups.set(l.level, []); groups.get(l.level).push(l); });
    ui.list.innerHTML = [...groups].map(([level, list]) => `
        <h3 class="grammar-level">${escapeHtml(level)}</h3>
        <ul translate="no">${list.map((l) => {
            const p = progress[l.id] || {};
            return `<li><a href="#${encodeURIComponent(l.id)}" class="grammar-item${p.learned ? " learned" : ""}"${current && current.id === l.id ? ` aria-current="true"` : ""}>
                <span class="gi-title" lang="${target()}">${escapeHtml(l.title)}</span>
                ${p.learned ? `<span class="gi-done" title="learned">✓</span>` : p.passed ? `<span class="gi-quiz" title="quiz passed">◎</span>` : ""}
                ${l.meaning ? `<small>${escapeHtml(l.meaning)}</small>` : ""}
            </a></li>`;
        }).join("")}</ul>`).join("");
}

// ---------- one lesson ----------

async function open(id) {
    const lesson = lessons.find((l) => l.id === id) || lessons[0];
    if (!lesson) return;
    const myJob = ++job;
    current = lesson;
    view.last = lesson.id;
    saveView();
    renderList();
    // the list only has titles: the lesson itself comes from the server the first time it's opened
    if (!("examples" in lesson)) {
        ui.lesson.innerHTML = `<p class="muted">loading…</p>`;
        try {
            Object.assign(lesson, await loadLesson(lesson.id));
        } catch (err) {
            if (myJob === job) ui.lesson.innerHTML = `<p class="status bad">couldn't load the lesson: ${escapeHtml(err.message)}</p>`;
            return;
        }
        if (myJob !== job) return;
    }
    renderLesson(lesson);
    const item = ui.list.querySelector("[aria-current]");
    if (item) item.scrollIntoView({ block: "nearest" });
}

function renderLesson(l) {
    const p = lessonProgress(l.id);
    const at = lessons.indexOf(l);
    const prev = lessons[at - 1], next = lessons[at + 1];
    const byId = new Map(lessons.map((x) => [x.id, x]));
    const see = l.see.map((id) => byId.get(id)).filter(Boolean);

    ui.lesson.innerHTML = `
        <div class="lesson-head">
            <span class="chip lesson-level" translate="no">${escapeHtml(l.level)}</span>
            <h2 lang="${target()}">${escapeHtml(l.title)}</h2>
            <button id="lesson-learned" class="lesson-learned${p.learned ? " on" : ""}" aria-pressed="${!!p.learned}">${p.learned ? "✓ learned" : "mark as learned"}</button>
        </div>
        ${l.meaning ? `<p class="lesson-meaning" translate="no">${escapeHtml(l.meaning)}</p>` : ""}
        <div class="lesson-body" translate="no">${markdown(l.explanation)}</div>

        ${l.examples.length ? `
        <h3 class="lesson-heading">${target() === "en" ? "Examples" : "例文 <small>examples</small>"}</h3>
        <ol class="lesson-examples">${l.examples.map((e, i) => `
            <li><span class="ex-ja" lang="${target()}" data-i="${i}">${plainHtml(e.ja)}</span>${e.en ? `<span class="ex-en" translate="no">${escapeHtml(e.en)}</span>` : ""}</li>`).join("")}
        </ol>
        ${l.rules.length ? `<p class="lesson-detect" id="lesson-detect" title="${escapeHtml("detect: " + l.rules.join("\ndetect: "))}">checking the detect rules…</p>` : ""}` : ""}

        ${l.quiz.length ? `
        <h3 class="lesson-heading">${target() === "en" ? "Quiz" : "練習 <small>quiz</small>"}</h3>
        <ol class="lesson-quiz" id="lesson-quiz"></ol>
        <p class="quiz-score" id="quiz-score"></p>` : ""}

        ${see.length ? `<p class="lesson-see">see also: ${see.map((s) => `<a href="#${encodeURIComponent(s.id)}" lang="${target()}" translate="no">${escapeHtml(s.title)}</a>`).join(" · ")}</p>` : ""}

        <nav class="lesson-nav">
            ${prev ? `<a href="#${encodeURIComponent(prev.id)}">← <span lang="${target()}" translate="no">${escapeHtml(prev.title)}</span></a>` : "<span></span>"}
            ${next ? `<a href="#${encodeURIComponent(next.id)}"><span lang="${target()}" translate="no">${escapeHtml(next.title)}</span> →</a>` : "<span></span>"}
        </nav>`;

    $("#lesson-learned").addEventListener("click", () => {
        saveProgress(l.id, { learned: !lessonProgress(l.id).learned });
        renderLesson(l);
        renderList();
    });
    if (l.quiz.length) renderQuiz(l);
    if (l.examples.length) tokenizeExamples(l, job);
}

// Split the examples into words (clickable, coloured, grammar underlined) and report
// how many of them the lesson's own detect rules found
async function tokenizeExamples(l, myJob) {
    let tokens;
    try { tokens = await tokenize(l.examples.map((e) => e.ja)); } catch { return; }
    if (myJob !== job) return;
    ui.lesson.querySelectorAll(".ex-ja").forEach((el, i) => { el.innerHTML = tokensHtml(tokens[i]); });
    const note = $("#lesson-detect");
    if (!note) return;
    const found = tokens.filter((line) => line.some((t) => t.gr && t.gr.includes(l.id))).length;
    note.textContent = `the detect rules find this grammar in ${found} of ${l.examples.length} examples`;
    note.classList.toggle("partial", found < l.examples.length);
}

// ---------- quiz ----------

const shuffle = (list) => {
    const a = [...list];
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
};
const normalize = (s) => s.replace(/[\s。．.!！?？、,]/g, "").toLowerCase();

function renderQuiz(l) {
    const list = $("#lesson-quiz");
    const score = $("#quiz-score");
    const answered = new Map();      // question index -> right?

    list.innerHTML = l.quiz.map((q, i) => `
        <li data-i="${i}">
            <p class="quiz-q" lang="${target()}" translate="no">${escapeHtml(q.q)}</p>
            ${q.answers.length > 1
                ? `<div class="quiz-options" lang="${target()}">${shuffle(q.answers).map((a) =>
                    `<button type="button" data-answer="${escapeHtml(a)}" translate="no">${escapeHtml(a)}</button>`).join("")}</div>`
                : `<form class="quiz-typed"><input type="text" lang="${target()}" autocomplete="off" placeholder="type the answer"><button type="submit">check</button></form>`}
            <p class="quiz-feedback"></p>
        </li>`).join("");

    const finish = (li, right) => {
        const i = Number(li.dataset.i);
        const q = l.quiz[i];
        answered.set(i, right);
        li.classList.add(right ? "right" : "wrong");
        li.querySelectorAll("button, input").forEach((b) => { b.disabled = true; });
        li.querySelectorAll(".quiz-options button").forEach((b) => {
            if (b.dataset.answer === q.answers[0]) b.classList.add("correct");
        });
        const fb = li.querySelector(".quiz-feedback");
        fb.textContent = right ? (target() === "en" ? "Correct!" : "正解！") : "answer: ";
        if (!right) {
            const a = document.createElement("b");
            a.lang = target();
            a.translate = false;
            a.textContent = q.answers[0];
            fb.append(a);
        }
        if (answered.size < l.quiz.length) return;

        const n = [...answered.values()].filter(Boolean).length;
        const before = lessonProgress(l.id);
        const best = Math.max(n, before.quizBest || 0);
        saveProgress(l.id, { quizBest: best, quizTotal: l.quiz.length, passed: before.passed || n === l.quiz.length });
        score.innerHTML = `<b>${n} / ${l.quiz.length}</b> <button type="button" id="quiz-again">try again</button>`;
        $("#quiz-again").addEventListener("click", () => renderQuiz(l));
        renderList();
    };

    list.querySelectorAll(".quiz-options button").forEach((b) => b.addEventListener("click", () => {
        const li = b.closest("li");
        if (b.dataset.answer !== l.quiz[Number(li.dataset.i)].answers[0]) b.classList.add("chosen-wrong");
        finish(li, b.dataset.answer === l.quiz[Number(li.dataset.i)].answers[0]);
    }));
    list.querySelectorAll(".quiz-typed").forEach((form) => form.addEventListener("submit", (e) => {
        e.preventDefault();
        const li = form.closest("li");
        const input = form.querySelector("input");
        if (!input.value.trim()) return;
        finish(li, normalize(input.value) === normalize(l.quiz[Number(li.dataset.i)].answers[0]));
    }));

    const p = lessonProgress(l.id);
    score.textContent = p.quizTotal ? `best so far: ${p.quizBest} / ${p.quizTotal}` : "";
}

// ---------- problems in lesson files ----------

function renderProblems(problems) {
    ui.problems.hidden = !problems.length;
    if (!problems.length) return;
    ui.problems.innerHTML = `<b>Some lesson files have problems</b> (also shown in the server's terminal):
        <ul translate="no">${problems.map((p) => `<li><code>grammar/${escapeHtml(p.file)}</code>: ${escapeHtml(p.problem)}</li>`).join("")}</ul>`;
}

// ---------- start ----------

async function init() {
    popup.init();
    initKeys({
        arrowleft: () => { const i = lessons.indexOf(current); if (i > 0) location.hash = lessons[i - 1].id; },
        arrowright: () => { const i = lessons.indexOf(current); if (i >= 0 && i < lessons.length - 1) location.hash = lessons[i + 1].id; },
    });
    bindWordDisplay($("#furigana-mode"), $("#color-words"));
    watchHover(ui.lesson);
    // mined cards get the lesson as source and the example's translation
    popup.enableWordClicks(ui.lesson, ".ex-ja", (lineEl) => ({
        info: { source: `文法 ${current.title}`, translation: current.examples[Number(lineEl.dataset.i)]?.en || "" },
    }));
    window.addEventListener("akko-words-changed", () => recolor(ui.lesson));

    ui.hideTranslations.checked = view.hideTranslations;
    ui.lesson.classList.toggle("hide-translations", view.hideTranslations);
    ui.hideTranslations.addEventListener("input", () => {
        view.hideTranslations = ui.hideTranslations.checked;
        ui.lesson.classList.toggle("hide-translations", view.hideTranslations);
        saveView();
    });
    ui.filter.addEventListener("input", renderList);
    ui.levels.addEventListener("click", (e) => {
        const b = e.target.closest("[data-level]");
        if (!b) return;
        view.level = b.dataset.level;
        saveView();
        renderLevels();
        renderList();
    });

    let data;
    try {
        data = await loadLessons();
    } catch (err) {
        ui.lesson.innerHTML = `<p class="status bad">couldn't load the lessons: ${escapeHtml(err.message)}</p>`;
        return;
    }
    lessons = data.lessons;
    renderProblems(data.problems);
    renderLevels();
    if (!lessons.length) {
        renderList();
        ui.lesson.innerHTML = `<p>No lessons yet. Copy <code>grammar/_template.md</code> to start one.</p>`;
        return;
    }
    const fromHash = () => decodeURIComponent(location.hash.slice(1));
    window.addEventListener("hashchange", () => {
        if (lessons.some((l) => l.id === fromHash())) {
            open(fromHash());
            ui.lesson.scrollIntoView({ behavior: "smooth", block: "start" });
        }
    });
    open(lessons.some((l) => l.id === fromHash()) ? fromHash() : view.last);
}

init();
