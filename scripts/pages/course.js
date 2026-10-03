// 道 Course page (course.html): the steps from course/*.md, with goals measured from what
// you've done in the app and a "done" mark per step (saved in "akko-course").

import { $ } from "../core/dom.js";
import { store, escapeHtml, getJson } from "../core/utils.js";
import { markdown } from "../grammar/markdown.js";
import { loadLessons } from "../grammar/lessons.js";
import { wordStats, watchStats, mangaStats, podcastStats, textStats, minedStats, grammarStats } from "../totals.js";
import { keyFor, target, nativeLang } from "../core/target.js";

const KEY = keyFor("akko-course");       // { stepId: {done, updated} }, one per language

const ui = {
    problems: $("#course-problems"), summary: $("#course-summary"), bar: $("#course-bar"),
    steps: $("#course-steps"), nav: $("#course-nav"),
};

let steps = [];
let measure = null;              // goal -> {have, need, unit}

// ---------- goals ----------

async function measurer() {
    const [text, mined, lessons] = await Promise.all([
        textStats(), minedStats(), loadLessons().then((d) => d.lessons).catch(() => []),
    ]);
    const known = wordStats().known;
    const hours = (watchStats().seconds + podcastStats().seconds) / 3600;
    const pages = mangaStats().pages;
    const learned = grammarStats().byId;

    return (g) => {
        switch (g.kind) {
            case "words": return { have: known, need: g.target, label: `know ${g.target} words` };
            case "mined": return { have: mined.count, need: g.target, label: `mine ${g.target} words` };
            case "read": return { have: text.chars, need: g.target, label: `read ${g.target.toLocaleString()} characters` };
            case "manga": return { have: pages, need: g.target, label: `read ${g.target} manga pages` };
            case "hours": return { have: Math.floor(hours * 10) / 10, need: g.target, label: `${g.target} hours of ${target() === "en" ? "English" : "Japanese"}` };
            case "grammar": {
                const inLevel = lessons.filter((l) => l.level === g.level);
                return { have: inLevel.filter((l) => learned[l.id]?.learned).length, need: inLevel.length, label: `learn all ${g.level} grammar lessons` };
            }
            default: return { have: 0, need: 1, label: g.kind };
        }
    };
}

const reached = (m) => m.need > 0 && m.have >= m.need;

function goalHtml(g) {
    const m = measure(g);
    const pct = m.need ? Math.min(100, (m.have / m.need) * 100) : 0;
    return `<li class="course-goal${reached(m) ? " reached" : ""}">
        <span class="goal-label">${reached(m) ? "✓ " : ""}${g.label
            ? `<span translate="no">${escapeHtml(g.label)}</span>`        // written in the step file: content
            : escapeHtml(m.label)}</span>
        <span class="goal-count">${m.have.toLocaleString()} / ${m.need.toLocaleString()}</span>
        <span class="goal-bar"><i style="width:${pct.toFixed(1)}%"></i></span>
    </li>`;
}

// ---------- steps ----------

const progress = () => store.get(KEY, {});

function render() {
    const done = progress();
    const current = steps.find((s) => !done[s.id]?.done);
    const doneCount = steps.filter((s) => done[s.id]?.done).length;

    ui.summary.innerHTML = current
        ? `<b>${doneCount} / ${steps.length} steps done</b> · now: <a href="#${encodeURIComponent(current.id)}" translate="no">${escapeHtml(current.title)}</a>`
        : `<b>${doneCount} / ${steps.length} steps done</b> · 全部終わった！ keep immersing every day.`;
    ui.bar.style.width = steps.length ? `${(doneCount / steps.length) * 100}%` : "0";

    ui.nav.innerHTML = steps.map((s, i) => `<li><a href="#${encodeURIComponent(s.id)}" translate="no"${s === current ? ` aria-current="step"` : ""}>${done[s.id]?.done ? "✓" : i + 1}. ${escapeHtml(s.title)}</a></li>`).join("");

    ui.steps.innerHTML = steps.map((s, i) => {
        const isDone = !!done[s.id]?.done;
        const goals = s.goals.map(goalHtml).join("");
        const allReached = s.goals.length && s.goals.every((g) => reached(measure(g)));
        return `<li id="${escapeHtml(s.id)}" class="course-step${isDone ? " done" : ""}${s === current ? " current" : ""}">
            <details${s === current || location.hash.slice(1) === s.id ? " open" : ""}>
                <summary>
                    <span class="step-num">${isDone ? "✓" : i + 1}</span>
                    <span class="step-head">
                        <b class="step-title" translate="no">${escapeHtml(s.title)}</b>
                        ${s.summary ? `<span class="step-summary" translate="no">${escapeHtml(s.summary)}</span>` : ""}
                    </span>
                    ${s.when ? `<span class="chip step-when" translate="no">${escapeHtml(s.when)}</span>` : ""}
                </summary>
                ${goals ? `<ul class="course-goals">${goals}</ul>` : ""}
                <div class="lesson-body step-body" translate="no">${markdown(s.body)}</div>
                <div class="step-actions">
                    <button class="step-done${isDone ? " on" : ""}" data-id="${escapeHtml(s.id)}" aria-pressed="${isDone}">${isDone ? "✓ done" : "mark as done"}</button>
                    ${!isDone && allReached ? `<span class="step-hint">goals reached: mark it as done when you're ready</span>` : ""}
                </div>
            </details>
        </li>`;
    }).join("");
}

function toggleDone(id) {
    const all = progress();
    all[id] = { ...all[id], done: !all[id]?.done, updated: Date.now() };
    store.set(KEY, all);
    render();
    // finishing a step opens the next one
    if (all[id].done) {
        const next = steps.find((s) => !all[s.id]?.done);
        if (next) document.getElementById(next.id).scrollIntoView({ behavior: "smooth", block: "start" });
    }
}

function openFromHash() {
    const el = document.getElementById(decodeURIComponent(location.hash.slice(1)));
    if (!el || !el.classList.contains("course-step")) return;
    el.querySelector("details").open = true;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
}

// ---------- start ----------

async function init() {
    if (target() === "en") document.querySelector("h1").textContent = "How to learn English";
    ui.steps.addEventListener("click", (e) => {
        const b = e.target.closest(".step-done");
        if (b) toggleDone(b.dataset.id);
    });
    window.addEventListener("hashchange", openFromHash);

    let data;
    try {
        [data, measure] = await Promise.all([getJson("/api/course?" + new URLSearchParams({ lang: target(), native: nativeLang() })), measurer()]);
    } catch (err) {
        ui.steps.innerHTML = `<li class="status bad">couldn't load the course: ${escapeHtml(err.message)}</li>`;
        return;
    }
    steps = data.steps;
    ui.problems.hidden = !data.problems.length;
    ui.problems.innerHTML = `<b>Some course files have problems</b> (also shown in the server's terminal):
        <ul translate="no">${data.problems.map((p) => `<li><code>course/${escapeHtml(p.file)}</code>: ${escapeHtml(p.problem)}</li>`).join("")}</ul>`;
    if (!steps.length) {
        ui.steps.innerHTML = `<li class="muted">No steps yet. Copy <code>course/_template.md</code> to start one.</li>`;
        return;
    }
    render();
    if (location.hash) openFromHash();
}

init();
