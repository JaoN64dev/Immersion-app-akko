// 聴解 Listening page (listening.html, Japanese only): JLPT-style listening exercises, N5 → N1.
//   - 会話 conversations: a question, a short conversation, the question again; pick the answer
//   - 応答 quick replies: one line, then three spoken replies; pick the one that fits
//   - 文 sentences: a sentence from the grammar lessons of that level; pick what it means
//   - 書き取り dictation: hear a sentence, type it; checked by its reading, so kana is fine
//   - 復習 mistakes: the questions you got wrong (until you get them right)
// Sets come from listening/*.md (server/listening.js); the voices from scripts/listening/speech.js.
// After answering, the script shows with clickable words (pop-up dictionary, mining) and a ▶ on
// each line to hear it again.
// Saved: "akko-listening" {setId: {best, total, at}}, "akko-listening-mistakes" {"set\nheading":
// {set, heading, level, at}}, "akko-listening-view" (level, speed, voice, show text, exam mode).

import { $ } from "../core/dom.js";
import { store, escapeHtml, getJson } from "../core/utils.js";
import * as popup from "../popup.js";
import { initKeys } from "../keys.js";
import { tokenize, tokensHtml, plainHtml, recolor } from "../words/render.js";
import { bindWordDisplay } from "../words/display.js";
import { watchHover } from "../words/hover.js";
import { learningEnglish, nativeLang } from "../core/target.js";
import * as speech from "../listening/speech.js";

const PROGRESS = "akko-listening";
const MISTAKES = "akko-listening-mistakes";
const VIEW = "akko-listening-view";
const ROUND = 10;                    // sentences and dictation: this many a round
const VOICEVOX_SITE = "https://voicevox.hiroshiba.jp/";
// the JLPT's own sample tests, with real exam audio (free to try; not ours to copy into akko)
const OFFICIAL = (level) => `https://www.jlpt.jp/e/samples/${level.toLowerCase()}/index.html`;

const ui = {
    voice: $("#listen-voice"), levels: $("#listen-levels"), progress: $("#listen-progress"),
    list: $("#listen-list"), official: $("#listen-official"), myFolder: $("#listen-my-folder"),
    player: $("#listen-player"), rate: $("#listen-rate"), showText: $("#listen-show-text"),
    exam: $("#listen-exam"), voicePick: $("#listen-voice-pick"), credit: $("#listen-credit"), vv: $("#listen-vv"),
};

let sets = [];
let levels = [];
let round = null;          // {id, title, level, kind, questions, i, right, missed, answered, practice}
let voiceReady = new Promise(() => {});     // set in init(): resolves once we know the voices
let job = 0;               // bumps when another round starts, so late work is dropped
const view = { level: "N5", rate: 1, showText: false, exam: false, voice: "auto", ...store.get(VIEW, {}) };
const saveView = () => store.set(VIEW, view);
const progress = () => store.get(PROGRESS, {});
const mistakes = () => store.get(MISTAKES, {});

const TASKS = {
    dialogue: "Listen to the question and the conversation, then pick the answer.",
    response: "Listen to the line and the three replies, then pick the reply that fits.",
    sentences: "Listen to the sentence, then pick what it means.",
    dictation: "Listen to the sentence and type it. Kana is fine: it's checked by how it's read.",
    situation: "Listen to the situation and the three things you could say, then pick the right one.",
    summary: "Listen to the whole talk: the question only comes at the end.",
};

const shuffle = (list) => {
    const a = [...list];
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
};
const onButton = () => document.activeElement?.tagName === "BUTTON";
const other = (voice) => (voice === "man" ? "woman" : "man");
const kindOf = (q) => q.kind || round.kind;
const mistakeKey = (setId, heading) => `${setId}\n${heading}`;

// ---------- the list of sets ----------

function renderLevels() {
    if (!levels.includes(view.level)) view.level = levels[0];
    ui.levels.innerHTML = levels.map((l) =>
        `<button role="tab" data-level="${l}" aria-selected="${l === view.level}">${l}</button>`).join("");
}

function setsOf(level) {
    const missed = Object.values(mistakes()).filter((m) => m.level === level).length;
    return [
        ...sets.filter((s) => s.level === level),
        { id: `sentences-${level}`, title: "文 sentences", level, kind: "sentences", count: ROUND },
        { id: `dictation-${level}`, title: "書き取り dictation", level, kind: "dictation", count: ROUND },
        ...(missed ? [{ id: `mistakes-${level}`, title: "復習 mistakes", level, kind: "mistakes", count: missed }] : []),
    ];
}

const NOTES = {
    sentences: "from the grammar lessons' examples",
    dictation: "type what you hear",
};

function renderList() {
    const done = progress();
    const shown = setsOf(view.level).filter((s) => s.kind !== "mistakes");
    const tried = shown.filter((s) => done[s.id]).length;
    ui.progress.textContent = `${tried} / ${shown.length} tried at ${view.level}`;
    ui.list.innerHTML = `<ul translate="no">${setsOf(view.level).map((s) => {
        const p = done[s.id];
        const note = NOTES[s.kind] ? (s.kind === "mistakes" ? `${s.count} question${s.count === 1 ? "" : "s"} you got wrong` : NOTES[s.kind])
            : `${s.count} questions${s.mine ? " · your set" : ""}`;
        return `<li><a href="#${encodeURIComponent(s.id)}" class="grammar-item${s.kind === "mistakes" ? " lq-mistakes-item" : ""}"${round && round.id === s.id ? ` aria-current="true"` : ""}>
            <span class="gi-title" lang="ja">${escapeHtml(s.title)}</span>
            ${p ? `<span class="${p.best === p.total ? "gi-done" : "gi-quiz"}" title="best score">${p.best} / ${p.total}</span>` : ""}
            <small>${note}</small>
        </a></li>`;
    }).join("")}</ul>`;
    ui.official.href = OFFICIAL(view.level);
    ui.official.querySelector("b").textContent = view.level;
}

// ---------- starting a round ----------

// the questions of a file set, ready to play: choices shuffled so the right one isn't always in
// the same place (not with a recording: there the choices are said in its order, or are numbers)
async function setQuestions(id) {
    const set = await getJson(`/api/listening/${encodeURIComponent(id)}`);
    return set.questions.map((q, i) => ({
        ...q, kind: set.kind, setId: set.id, level: set.level, questionAfter: set.questionAfter,
        voice: i % 2 ? "man" : "woman",          // who says a situation's choices
        choices: q.audio ? q.choices : shuffle(q.choices),
    }));
}

async function start(id, { only = null } = {}) {
    const myJob = ++job;
    speech.stop();
    let set = setsOf(view.level).find((s) => s.id === id);
    if (!set) {
        const level = levels.find((l) => id.endsWith(`-${l}`) && /^(sentences|dictation|mistakes)-/.test(id)) || sets.find((s) => s.id === id)?.level;
        if (!level) return;
        view.level = level;
        saveView();
        renderLevels();
        set = setsOf(level).find((s) => s.id === id);
        if (!set) return;
    }
    ui.player.innerHTML = `<p class="muted">loading…</p>`;
    let questions;
    try {
        if (only) questions = only;
        else if (set.kind === "sentences") questions = await sentenceQuestions(set.level);
        else if (set.kind === "dictation") questions = await dictationQuestions(set.level);
        else if (set.kind === "mistakes") questions = await mistakeQuestions(set.level);
        else questions = await setQuestions(id);
    } catch (err) {
        if (myJob === job) ui.player.innerHTML = `<p class="status bad">couldn't load it: ${escapeHtml(err.message)}</p>`;
        return;
    }
    if (myJob !== job) return;
    if (!questions.length) {
        ui.player.innerHTML = `<p>Nothing to practise here right now.</p>`;
        return;
    }
    round = { ...set, questions, i: 0, right: 0, missed: [], answered: false, practice: !!only || set.kind === "mistakes" };
    renderList();
    renderQuestion();
}

// make the audio of this question and the next in the background, so they play straight away
// (not the whole round: with VOICEVOX a line takes about a second to make)
function prepareAhead() {
    const r = round;
    const qs = r.questions.slice(r.i, r.i + 2);
    voiceReady.then(() => { if (round === r) speech.prepare(qs.flatMap((q) => linesOf(q))); });
}

const sentencesOf = async (level) => (await getJson(`/api/listening/sentences?${new URLSearchParams({ level, native: nativeLang() })}`)).sentences;

// 文 sentences: grammar examples of the level as questions, with three other meanings as choices
async function sentenceQuestions(level) {
    const sentences = await sentencesOf(level);
    if (sentences.length < 4) throw new Error("not enough example sentences at this level");
    return shuffle(sentences).slice(0, ROUND).map((s, n) => {
        const others = shuffle(sentences.filter((x) => x.en !== s.en)).slice(0, 3);
        return {
            kind: "sentences",
            heading: s.title,
            question: null,
            script: [{ speaker: n % 2 ? "man" : "woman", text: s.ja, en: s.en }],
            choices: shuffle([{ text: s.en, correct: true }, ...others.map((o) => ({ text: o.en, correct: false }))]),
            explanation: "",
            lesson: s.lesson,
        };
    });
}

// 書き取り dictation: short grammar examples of the level (long ones are no fun to type)
async function dictationQuestions(level) {
    const sentences = (await sentencesOf(level)).filter((s) => s.ja.length <= 30);
    return shuffle(sentences).slice(0, ROUND).map((s, n) => ({
        kind: "dictation",
        heading: s.title,
        question: null,
        script: [{ speaker: n % 2 ? "man" : "woman", text: s.ja, en: s.en }],
        choices: [],
        explanation: "",
        lesson: s.lesson,
    }));
}

// 復習 mistakes: the questions of this level you got wrong, from their sets
async function mistakeQuestions(level) {
    const wanted = Object.values(mistakes()).filter((m) => m.level === level);
    const out = [];
    for (const setId of new Set(wanted.map((m) => m.set))) {
        let qs;
        try { qs = await setQuestions(setId); } catch { continue; }       // the set is gone
        for (const m of wanted.filter((w) => w.set === setId)) {
            const q = qs.find((x) => x.heading === m.heading);
            if (q) out.push(q);
            else forget(setId, m.heading);           // the question was changed or removed
        }
    }
    return shuffle(out);
}

function remember(q, right) {
    if (!q.setId) return;                            // sentences and dictation aren't kept
    const all = mistakes();
    const key = mistakeKey(q.setId, q.heading);
    if (right) delete all[key];
    else all[key] = { set: q.setId, heading: q.heading, level: q.level, at: Date.now() };
    store.set(MISTAKES, all);
}
function forget(setId, heading) {
    const all = mistakes();
    delete all[mistakeKey(setId, heading)];
    store.set(MISTAKES, all);
}

const recordingUrl = (q) => `/api/listening/audio?${new URLSearchParams({ set: q.setId || round.id, file: q.audio.file })}`;

// what gets said for a question, in order (a recording: just that)
function linesOf(q) {
    if (q.audio) return [{ url: recordingUrl(q), start: q.audio.start, end: q.audio.end, part: "recording" }];
    const lines = [];
    const askFirst = q.question && !q.questionAfter;
    if (askFirst) lines.push({ text: q.question.text, voice: "narrator", part: "q" });
    q.script.forEach((l, i) => lines.push({ text: l.text, voice: l.speaker, part: "line", i, pause: i || askFirst ? 700 : 0 }));
    if (q.kind === "response" || q.kind === "situation") {
        // a situation's choices: said by the person in it; a reply's: by the other speaker
        const replier = q.kind === "situation" ? q.voice || "woman" : other(q.script[q.script.length - 1].speaker);
        q.choices.forEach((c, i) => lines.push({ text: c.text, voice: replier, part: "choice", i, pause: 900 }));
    }
    // the question again at the end (or only there); a situation is described once
    if (q.question && q.kind !== "situation") lines.push({ text: q.question.text, voice: "narrator", part: "q", pause: 1000 });
    return lines;
}

// ---------- one question ----------

function renderQuestion() {
    const r = round;
    const q = r.questions[r.i];
    const kind = kindOf(q);
    r.answered = false;
    r.plays = 0;
    const showText = view.showText && !view.exam;
    const spokenChoices = kind === "response" || kind === "situation";
    const fromSet = r.kind === "mistakes" ? `<span class="lq-from" lang="ja">${escapeHtml(sets.find((s) => s.id === q.setId)?.title || "")}</span>` : "";
    ui.player.innerHTML = `
        <div class="lesson-head">
            <span class="chip lesson-level" translate="no">${escapeHtml(r.level)}</span>
            <h2 lang="ja">${escapeHtml(r.title)}</h2>
            <span class="lq-count">question ${r.i + 1} / ${r.questions.length}</span>
        </div>
        <p class="lq-task">${TASKS[q.questionAfter ? "summary" : kind]}${fromSet ? ` ${fromSet}` : ""}${view.exam ? ` <b class="lq-exam-badge">exam mode: it plays once</b>` : ""}</p>
        <div class="lq-controls">
            <button type="button" id="lq-play" class="lq-play">▶ play</button>
            <span id="lq-now" class="lq-now" aria-live="polite"></span>
        </div>
        <div id="lq-script" class="lq-script" lang="ja" ${showText && kind !== "dictation" ? "" : "hidden"}>${scriptHtml(q, false)}</div>
        ${kind === "dictation" ? `
        <form id="lq-dictation" class="lq-dictation">
            <input id="lq-typed" type="text" lang="ja" autocomplete="off" spellcheck="false" placeholder="type what you hear (kana or kanji)">
            <button type="submit">check</button>
        </form>` : `
        <ol class="lq-choices${spokenChoices ? " spoken" : ""}" id="lq-choices">${q.choices.map((c, i) => `
            <li><button type="button" data-i="${i}" ${kind === "sentences" ? "" : `lang="ja"`} translate="no">
                ${spokenChoices ? `<span class="lq-hidden-choice">${showText ? escapeHtml(c.text) : `reply ${i + 1}`}</span>` : escapeHtml(c.text)}
            </button></li>`).join("")}
        </ol>`}
        <div id="lq-after" class="lq-after" hidden></div>`;
    $("#lq-play").addEventListener("click", play);
    if (kind === "dictation") {
        $("#lq-dictation").addEventListener("submit", (e) => { e.preventDefault(); checkDictation(); });
    } else {
        $("#lq-choices").addEventListener("click", (e) => {
            const b = e.target.closest("button[data-i]");
            if (b && !round.answered) answer(Number(b.dataset.i));
        });
    }
    // no voice at all: nothing to play (the note above says how to add one), unless it's a recording
    const button = $("#lq-play");
    if (!q.audio) voiceReady.then(() => { if (!speech.available()) button.disabled = true; });
    prepareAhead();
}

// the script; after answering, each line gets a ▶ to hear it again
function scriptHtml(q, after) {
    const replay = (i) => (after && !q.audio && speech.available() ? `<button type="button" class="lq-say" data-say="${i}" title="hear this line again" aria-label="hear this line again">▶</button>` : "");
    const line = (speaker, text, en, i, cls = "") => `
        <p class="lq-line ${cls}"><span class="lq-speaker">${speaker}</span>
            <span class="lq-ja ex-ja" data-text="${escapeHtml(text)}">${plainHtml(text)}</span>${replay(i)}
            ${after && en ? `<span class="ex-en" translate="no">${escapeHtml(en)}</span>` : ""}</p>`;
    const who = (s) => (s === "man" ? "男" : "女");
    return [
        q.question ? line("問", q.question.text, q.question.en, "q", "lq-question") : "",
        ...q.script.map((l, i) => line(who(l.speaker), l.text, l.en, i)),
    ].join("");
}

async function play() {
    const q = round.questions[round.i];
    await voiceReady;
    if (!q.audio && !speech.available()) return;
    const button = $("#lq-play");
    const now = $("#lq-now");
    const lines = linesOf(q).map((l) => ({
        ...l,
        onStart: () => {
            now.textContent = l.part === "q" ? "question" : l.part === "choice" ? `reply ${l.i + 1}` : "";
            ui.player.querySelectorAll(".lq-choices li").forEach((li, i) => li.classList.toggle("speaking", l.part === "choice" && i === l.i));
        },
    }));
    button.textContent = "■ stop";
    button.onclick = () => speech.stop();
    button.removeEventListener("click", play);
    round.plays++;
    try {
        await speech.sequence(lines, view.rate);
    } catch (err) {
        now.textContent = "couldn't play it: " + err.message;
    } finally {
        if (button.isConnected) {
            button.onclick = null;
            ui.player.querySelectorAll(".lq-choices li.speaking").forEach((li) => li.classList.remove("speaking"));
            if (now.textContent && !now.textContent.startsWith("couldn't")) now.textContent = "";
            // exam mode: once, like the real test (until you've answered)
            if (view.exam && !round.answered) {
                button.textContent = "played";
                button.disabled = true;
            } else {
                button.textContent = "▶ play again";
                button.addEventListener("click", play);
            }
            if (kindOf(q) === "dictation" && !round.answered) $("#lq-typed")?.focus({ preventScroll: true });
        }
    }
}

// what happens after any answer: the verdict, the script with translations, next
function showAfter(q, right, extra = "") {
    const r = round;
    if (right) r.right++; else r.missed.push(q);
    remember(q, right);
    renderList();          // 復習 mistakes appears (or goes) right away
    // the play button works again (exam mode only limits listening before answering)
    const button = $("#lq-play");
    if (button.disabled && (q.audio || speech.available())) {
        button.disabled = false;
        button.textContent = "▶ play again";
        button.addEventListener("click", play);
    }
    const last = r.i === r.questions.length - 1;
    const after = $("#lq-after");
    after.hidden = false;
    after.innerHTML = `
        <p class="lq-verdict ${right ? "right" : "wrong"}">${right ? "正解！" : "Not this one."}</p>
        ${extra}
        ${q.explanation ? `<p class="lq-explanation">${escapeHtml(q.explanation)}</p>` : ""}
        ${q.lesson ? `<p class="lq-explanation">grammar: <a href="/grammar.html#${encodeURIComponent(q.lesson)}" lang="ja">${escapeHtml(q.heading)}</a></p>` : ""}
        ${q.question || q.script.length ? `
        <h3 class="lesson-heading">スクリプト <small>what was said: click a word to look it up, ▶ to hear a line again</small></h3>
        <div class="lq-script lq-full" lang="ja">${scriptHtml(q, true)}</div>` : ""}
        <div class="lq-next"><button type="button" id="lq-next">${last ? "see the score" : "next question →"}</button></div>`;
    $("#lq-script").hidden = true;
    after.querySelectorAll(".lq-say").forEach((b) => b.addEventListener("click", () => sayLine(q, b.dataset.say)));
    $("#lq-next").addEventListener("click", next);
    $("#lq-next").focus({ preventScroll: true });
    tokenizeScript(after, job);
}

function sayLine(q, which) {
    const l = which === "q" ? { text: q.question.text, speaker: "narrator" } : q.script[Number(which)];
    speech.sequence([{ text: l.text, voice: l.speaker }], view.rate).catch(() => {});
}

function answer(i) {
    const r = round;
    const q = r.questions[r.i];
    r.answered = true;
    speech.stop();
    const right = q.choices[i].correct;
    ui.player.querySelectorAll("#lq-choices button").forEach((b, k) => {
        b.disabled = true;
        if (q.choices[k].correct) b.classList.add("correct");
        if (k === i && !right) b.classList.add("chosen-wrong");
        // spoken replies: now show what they said
        const hidden = b.querySelector(".lq-hidden-choice");
        if (hidden) hidden.innerHTML = `${escapeHtml(q.choices[k].text)}${q.choices[k].en ? `<small class="ex-en">${escapeHtml(q.choices[k].en)}</small>` : ""}`;
    });
    showAfter(q, right);
}

// ---------- dictation ----------

const toHiragana = (s) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
const PUNCTUATION = /[\s、。，．,.！？!?・「」『』（）()…〜~"'“”‘’：:；;]/g;

// how a line is read, in hiragana, without punctuation: 私は学生です → わたしはがくせいです
const readingOf = (tokens) => toHiragana(tokens.map((t) => (t.f ? t.f.map((p) => p.r || p.t).join("") : t.s)).join("")).replace(PUNCTUATION, "");

// which characters of `want` are in `got`, in order (longest common subsequence)
function matchChars(want, got) {
    const n = want.length, m = got.length;
    const len = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
        len[i][j] = want[i] === got[j] ? len[i + 1][j + 1] + 1 : Math.max(len[i + 1][j], len[i][j + 1]);
    }
    const wantOk = new Array(n).fill(false), gotOk = new Array(m).fill(false);
    for (let i = 0, j = 0; i < n && j < m;) {
        if (want[i] === got[j]) { wantOk[i++] = true; gotOk[j++] = true; }
        else if (len[i + 1][j] >= len[i][j + 1]) i++;
        else j++;
    }
    return { wantOk, gotOk, matched: wantOk.filter(Boolean).length };
}

const marked = (text, ok, cls) => [...text].map((c, i) => (ok[i] ? escapeHtml(c) : `<mark class="${cls}">${escapeHtml(c)}</mark>`)).join("");

async function checkDictation() {
    const r = round;
    const q = r.questions[r.i];
    const input = $("#lq-typed");
    const typed = input.value.trim();
    if (!typed || r.answered) return;
    r.answered = true;
    speech.stop();
    input.disabled = true;
    $("#lq-dictation button").disabled = true;
    const myJob = job;
    let want, got;
    try {
        const [a, b] = await tokenize([q.script[0].text, typed]);
        want = readingOf(a);
        got = readingOf(b);
    } catch {
        want = toHiragana(q.script[0].text).replace(PUNCTUATION, "");
        got = toHiragana(typed).replace(PUNCTUATION, "");
    }
    if (myJob !== job) return;
    const { wantOk, gotOk, matched } = matchChars(want, got);
    const right = want === got;
    const percent = want.length ? Math.round((matched / Math.max(want.length, got.length)) * 100) : 0;
    showAfter(q, right, `
        <div class="lq-compare" lang="ja">
            <p><span class="lq-compare-label">you heard</span> <span>${marked(got, gotOk, "extra")}</span></p>
            <p><span class="lq-compare-label">it was</span> <span>${marked(want, wantOk, "missed")}</span></p>
            ${right ? "" : `<p class="muted">${percent}% the same. Marked: what was missed or different.</p>`}
        </div>`);
}

// the script's words become clickable and coloured, like everywhere else
async function tokenizeScript(root, myJob) {
    const els = [...root.querySelectorAll(".lq-ja")];
    let tokens;
    try { tokens = await tokenize(els.map((el) => el.dataset.text)); } catch { return; }
    if (myJob !== job) return;
    els.forEach((el, i) => { el.innerHTML = tokensHtml(tokens[i]); });
}

function next() {
    speech.stop();
    if (!round.answered) return;
    if (round.i < round.questions.length - 1) {
        round.i++;
        renderQuestion();
        ui.player.scrollIntoView({ block: "nearest" });
        return;
    }
    finish();
}

function finish() {
    const r = round;
    const all = progress();
    const before = all[r.id];
    // practice rounds (mistakes, retrying the missed ones) don't change the best score
    if (!r.practice) {
        all[r.id] = { best: Math.max(r.right, before?.best || 0), total: r.questions.length, at: Date.now() };
        store.set(PROGRESS, all);
    }
    const perfect = r.right === r.questions.length;
    const again = { sentences: "10 more sentences", dictation: "10 more sentences", mistakes: "go through them again" }[r.kind] || "try again";
    const after = nextSet(r);
    ui.player.innerHTML = `
        <div class="lesson-head">
            <span class="chip lesson-level" translate="no">${escapeHtml(r.level)}</span>
            <h2 lang="ja">${escapeHtml(r.title)}</h2>
        </div>
        <p class="lq-score"><b>${r.right} / ${r.questions.length}</b> ${perfect ? "全問正解！ Every one right." : r.right >= r.questions.length * 0.7 ? "Nice work." : "Listen to the scripts again and try once more."}</p>
        ${before && !r.practice ? `<p class="muted">best before: ${before.best} / ${before.total}</p>` : ""}
        <div class="lq-next">
            ${r.missed.length ? `<button type="button" id="lq-retry">retry the ${r.missed.length} I missed</button>` : ""}
            ${r.kind === "mistakes" && !setsOf(r.level).some((s) => s.kind === "mistakes") ? "" : `<button type="button" id="lq-again">${again}</button>`}
            ${after ? `<a class="lq-next-set" href="#${encodeURIComponent(after.id)}">next: <span lang="ja">${escapeHtml(after.title)}</span> (${after.level}) →</a>` : ""}
        </div>`;
    $("#lq-again")?.addEventListener("click", () => start(r.id));
    $("#lq-retry")?.addEventListener("click", () => {
        const missed = r.missed.map((q) => (q.audio || !q.choices.length ? q : { ...q, choices: shuffle(q.choices) }));
        start(r.id, { only: missed });
    });
    renderList();
}

function nextSet(r) {
    const all = levels.flatMap(setsOf).filter((s) => s.kind !== "mistakes");
    const at = all.findIndex((s) => s.id === r.id);
    return at < 0 ? null : all[at + 1] || null;
}

// ---------- voices ----------

function renderVoices(info) {
    ui.voicePick.innerHTML = `<option value="auto">the best one here</option>` + info.options.map((o) =>
        `<option value="${escapeHtml(o.id)}">${escapeHtml(o.name)}: ${escapeHtml(o.voices.woman)}${o.voices.man ? ` / ${escapeHtml(o.voices.man)}` : ""}</option>`).join("");
    ui.voicePick.value = info.options.some((o) => o.id === view.voice) ? view.voice : "auto";
    ui.voicePick.disabled = !info.options.length;
    renderVoiceNotes(info);
}

function renderVoiceNotes(info) {
    const current = info.current;
    // VOICEVOX asks for its voices to be credited
    ui.credit.hidden = !current?.credit;
    ui.credit.textContent = current?.credit ? `voices: ${current.credit}` : "";
    if (!info.options.length) {
        ui.voice.hidden = false;
        ui.voice.innerHTML = `<p><b>No Japanese voice found on this computer.</b> The exercises need one to speak (recordings in your own sets still play).</p>
            <p>The easiest: install <a href="${VOICEVOX_SITE}" target="_blank" rel="noopener">VOICEVOX</a> (free, natural voices) and keep it open while you practise.
            Or on Windows: <b>Settings → Time &amp; language → Speech → Add voices → Japanese</b>, then reopen akko.</p>`;
        return;
    }
    ui.voice.hidden = true;
    ui.voice.innerHTML = "";
}

function loadVoices() {
    voiceReady = speech.init(view.voice).then((info) => { voiceInfo = info; renderVoices(info); return info; });
    return voiceReady;
}

// ---------- VOICEVOX: started by akko, or downloaded with one click (server/voicevox.js) ----------

let vv = null;             // its state on the server
let vvTimer = 0;
let voiceInfo = { options: [] };
const onWindows = /windows/i.test(navigator.userAgent);
const mb = (n) => Math.round(n / 1e6).toLocaleString();

async function checkVoicevox() {
    try { vv = await getJson("/api/speech/voicevox"); } catch { vv = null; }
    renderVoicevox();
    clearTimeout(vvTimer);
    if (vv && (vv.state === "starting" || vv.state === "installing")) vvTimer = setTimeout(checkVoicevox, vv.state === "installing" ? 1000 : 2000);
    // it has just come up: ask for the voices again, so it's in the menu (and used)
    if (vv?.state === "running" && !voiceInfo.options.some((o) => o.id === "voicevox")) {
        await new Promise((r) => setTimeout(r, 2100));          // the server rechecks after 2 s
        loadVoices();
    }
}

async function voicevoxAction(action, body = {}) {
    try {
        vv = await getJson(`/api/speech/voicevox/${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    } catch (err) {
        vv = { ...(vv || {}), state: "failed", error: err.message };
    }
    renderVoicevox();
    setTimeout(checkVoicevox, 800);
}

function renderVoicevox() {
    const box = ui.vv;
    if (!vv) { box.hidden = true; return; }
    box.hidden = false;
    const autostartBox = vv.found ? `<label class="lq-vv-auto"><input type="checkbox" id="vv-autostart" ${vv.autostart ? "checked" : ""}> start it with akko</label>` : "";
    const terms = `<a href="${escapeHtml(vv.terms)}" target="_blank" rel="noopener">VOICEVOX's terms</a>`;
    if (vv.state === "running") {
        box.innerHTML = `<p class="lq-vv-line">✓ <b>VOICEVOX</b> natural voices are on. ${autostartBox}</p>`;
    } else if (vv.state === "starting") {
        box.innerHTML = `<p class="lq-vv-line">Starting VOICEVOX's voices… (a few seconds)</p>`;
    } else if (vv.state === "installing") {
        const p = vv.progress || {};
        box.innerHTML = `<p class="lq-vv-line"><b>${escapeHtml(p.step || "installing VOICEVOX")}</b>
            ${p.total ? `${mb(p.done)} / ${mb(p.total)} MB` : ""}</p>
            ${p.total ? `<progress class="lq-vv-progress" max="${p.total}" value="${p.done}"></progress>` : `<progress class="lq-vv-progress"></progress>`}
            <p class="muted lq-vv-small">You can keep practising with the other voices meanwhile.</p>`;
    } else if (vv.found) {
        box.innerHTML = `<p class="lq-vv-line">${vv.state === "failed" ? `VOICEVOX didn't start: ${escapeHtml(vv.error)}. ` : "VOICEVOX is on this computer but not running. "}
            <button type="button" id="vv-start">start it</button> ${autostartBox}</p>`;
    } else if (onWindows) {
        box.innerHTML = `<p class="lq-vv-line">Want voices that sound like real people? <button type="button" id="vv-install">get VOICEVOX's natural voices</button></p>
            <p class="muted lq-vv-small">Free. akko downloads it from VOICEVOX's official release (about 1.9 GB; needs 4.5 GB free) and starts it whenever akko opens.
            By getting it you agree to ${terms}; the voices are credited under the exercises.${vv.state === "failed" && vv.error ? ` <b>Last try: ${escapeHtml(vv.error)}</b>` : ""}</p>`;
    } else {
        box.innerHTML = `<p class="lq-vv-line">Want voices that sound like real people? Get <a href="${VOICEVOX_SITE}" target="_blank" rel="noopener">VOICEVOX</a> (free) and keep it open: akko uses it by itself.</p>`;
    }
    $("#vv-start")?.addEventListener("click", () => voicevoxAction("start"));
    $("#vv-autostart")?.addEventListener("input", (e) => voicevoxAction("settings", { autostart: e.target.checked }));
    $("#vv-install")?.addEventListener("click", () => {
        const ok = confirm("Download VOICEVOX's voices?\n\nAbout 1.9 GB from VOICEVOX's official GitHub release, unpacked into akko's data folder (4.5 GB free space needed). "
            + "It's free; by installing you agree to VOICEVOX's terms (voicevox.hiroshiba.jp/term), which ask for the voices to be credited: akko does that under the exercises.");
        if (ok) voicevoxAction("install", { agree: true });
    });
}

// ---------- start ----------

async function init() {
    if (learningEnglish()) {
        ui.player.innerHTML = `<p>聴解 listening exercises are for learning Japanese. Pick Japanese on the welcome screen or in Settings to use them.</p>`;
        return;
    }
    popup.init();
    const pick = (n) => () => {
        const b = ui.player.querySelector(`#lq-choices button[data-i="${n}"]`);
        if (b && !b.disabled) b.click();
    };
    initKeys({
        // on a focused button, Space and Enter press that button as usual
        " ": (e) => { const b = $("#lq-play"); if (b && !b.disabled && !onButton()) { e.preventDefault(); b.click(); } },
        enter: (e) => { const b = $("#lq-next"); if (b && !onButton()) { e.preventDefault(); b.click(); } },
        arrowright: () => $("#lq-next")?.click(),
        // 1-4 pick an answer (when the mouse isn't on a word: then they mark the word)
        1: pick(0), 2: pick(1), 3: pick(2), 4: pick(3),
    });
    bindWordDisplay($("#furigana-mode"), $("#color-words"));
    watchHover(ui.player);
    popup.enableWordClicks(ui.player, ".lq-ja", (lineEl) => ({
        info: { source: `聴解 ${round?.title || ""}`.trim(), translation: lineEl.closest(".lq-line")?.querySelector(".ex-en")?.textContent || "" },
    }));
    window.addEventListener("akko-words-changed", () => recolor(ui.player));

    ui.rate.value = String(view.rate);
    ui.rate.addEventListener("input", () => { view.rate = Number(ui.rate.value) || 1; saveView(); });
    const rerender = () => { if (round && !round.answered && ui.player.querySelector("#lq-play")) renderQuestion(); };
    ui.showText.checked = view.showText;
    ui.showText.addEventListener("input", () => { view.showText = ui.showText.checked; saveView(); rerender(); });
    ui.exam.checked = view.exam;
    ui.exam.addEventListener("input", () => { view.exam = ui.exam.checked; saveView(); rerender(); });
    ui.voicePick.addEventListener("input", () => {
        view.voice = ui.voicePick.value;
        saveView();
        speech.stop();
        const current = speech.choose(view.voice);
        voiceReady.then((info) => renderVoiceNotes({ ...info, current }));
        if (round) prepareAhead();
    });
    // the set that's already open, clicked again: start it over (the address doesn't change)
    ui.list.addEventListener("click", (e) => {
        const a = e.target.closest("a[href^='#']");
        if (a && a.getAttribute("href") === location.hash) start(decodeURIComponent(location.hash.slice(1)));
    });
    ui.levels.addEventListener("click", (e) => {
        const b = e.target.closest("[data-level]");
        if (!b) return;
        view.level = b.dataset.level;
        saveView();
        renderLevels();
        renderList();
    });

    // which voices there are: asked once (the server's speech helper takes a second to start)
    loadVoices();
    checkVoicevox();

    let data;
    try {
        data = await getJson("/api/listening");
    } catch (err) {
        ui.player.innerHTML = `<p class="status bad">couldn't load the exercises: ${escapeHtml(err.message)}</p>`;
        return;
    }
    sets = data.sets;
    levels = data.levels;
    ui.myFolder.textContent = data.myFolder;
    if (data.problems.length) {
        const box = $("#listen-problems");
        box.hidden = false;
        box.innerHTML = `<b>Some exercise files have problems</b> (also shown in the server's terminal):
            <ul translate="no">${data.problems.map((p) => `<li><code>listening/${escapeHtml(p.file)}</code>: ${escapeHtml(p.problem)}</li>`).join("")}</ul>`;
    }
    renderLevels();
    renderList();
    const fromHash = () => decodeURIComponent(location.hash.slice(1));
    window.addEventListener("hashchange", () => { if (fromHash()) start(fromHash()); });
    if (fromHash()) start(fromHash());
    else ui.player.innerHTML = `
        <h2 class="lq-intro-title">聴解 <small>listening, JLPT style</small></h2>
        <p>Pick a level and a set on the left. Each question plays as audio: listen first, answer, then read the script.
        Words in the script can be clicked and mined like anywhere else.</p>
        <ul>
            <li><b lang="ja">会話</b> conversations: a question, a conversation, the question again.</li>
            <li><b lang="ja">応答</b> quick replies: one line, three spoken replies. Pick the natural one.</li>
            <li><b lang="ja">文</b> sentences: a sentence from that level's grammar lessons. Pick its meaning.</li>
            <li><b lang="ja">書き取り</b> dictation: hear a sentence and type it, in kana or kanji.</li>
            <li><b lang="ja">復習</b> mistakes: the questions you got wrong come back until you get them right.</li>
        </ul>
        <p class="muted">Space plays, 1–4 answer, Enter goes on. Too fast? Slow it down above. <b>Exam mode</b> plays each question once, like the real test.</p>`;
}

init();
