// akko companion: what YouTube and Netflix share. A site script (content/youtube.js,
// content/netflix.js) finds the video and its subtitles, then calls akkoCompanion.overlay(),
// which draws the subtitles over the video with every word clickable:
//   - words are split and looked up by akko (through background.js), coloured by your word list
//     (new: red, learning: yellow), with furigana on the ones you don't know yet
//   - click a word: akko's dictionary entry (with its pronunciation, pitch accent, conjugation,
//     kanji, and akko's grammar lessons it's part of), its status (1-4), "+ mine" to Anki with the
//     sentence, the line's audio, a screenshot and the word's pronunciation, using akko's Anki settings
//   - ★ on lines with exactly one word you don't know (i+1: the best sentences to mine)
//   - ☰ every line of the video in a list (Shift+T): click a line to go there, a word to look it up
//   - hovering the subtitles pauses the video; [ and ] go to the previous / next line, P replays
//     (Shift+P slowly), A pauses at the end of every line, R changes how the translation shows;
//     the subtitles can be moved earlier / later when they're out of time
//   - a translation line shows when the video is paused (or always, or blurred until the mouse is on it)
//   - akko gets it all (through background.js and akko's server): word statuses, mined words (in
//     akko's mined list and 復習) and the time watched (it counts for today and the streak)
// Everything lives in a shadow root inside the player, so the site's styles don't touch it and
// it stays visible in full screen.
//
// Japanese or English: the site script picks the video's language from what you learn (prefs.learn:
// "auto" follows akko, or "ja", "en", "both"; learning()) and passes it as site.lang. The overlay
// splits words, looks them up and keeps statuses, mined words and time in that language.
//
// Saved in chrome.storage.local: words / wordsEn {lemma: status} (akko's lists, copied by
// background.js), outbox (what's waiting to go to akko), anki (akko's Anki settings), akkoTarget
// (what akko is learning), native (your language), prefs.

(() => {
    if (window.akkoCompanion) return;

    // ---------- talking to akko (through background.js) ----------

    const ask = (msg) => new Promise((resolve, reject) => {
        try {
            chrome.runtime.sendMessage(msg, (r) => {
                if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
                if (!r) return reject(new Error("no answer from the extension"));
                if (r.error) reject(new Error(r.error)); else resolve(r.data);
            });
        } catch (err) {
            reject(new Error("the extension was updated: reload this page"));
        }
    });
    const api = (path, opts = {}) => ask({ type: "akko", path, ...opts });

    // ---------- your words, settings ----------

    const PREFS = {
        size: 100, hoverPause: true, translation: "paused", furigana: "unknown", translateTo: "en", on: { youtube: true, netflix: true },
        autoPause: false,         // pause at the end of every line
        hideJa: false,            // the subtitle line blurred while playing: listen first
        learn: "auto",            // auto: what akko is learning | ja | en | both
        position: 11,             // the subtitles' distance from the bottom, % of the player
        bg: 65,                   // the subtitles' background, % opacity
        font: "sans",             // sans | serif | round
        mineTo: "anki",           // anki: Anki and akko | akko: only akko's mined list
        iPlusOne: true,           // ★ on lines with exactly one word you don't know
        keepMedia: true,          // the line's audio and the picture also kept in akko (復習)
    };
    const ANKI = { deck: "", model: "", maps: {}, tags: "akko immersion", audio: true, wordAudio: true, shot: true };
    const lists = { ja: {}, en: {} };   // your words, per language
    let lang = "ja";                    // the language of the subtitles on this page (overlay())
    let akkoTarget = "ja", native = "";
    let prefs = { ...PREFS };
    let anki = { ...ANKI };
    const changed = new Set();          // callbacks when words/prefs change

    const ready = chrome.storage.local.get(["words", "wordsEn", "prefs", "anki", "akkoTarget", "native"]).then((s) => {
        lists.ja = s.words || {};
        lists.en = s.wordsEn || {};
        akkoTarget = s.akkoTarget === "en" ? "en" : "ja";
        native = s.native || "";
        prefs = { ...PREFS, ...(s.prefs || {}), on: { ...PREFS.on, ...((s.prefs || {}).on || {}) } };
        anki = { ...ANKI, ...(s.anki || {}) };
    });
    chrome.storage.onChanged.addListener((c) => {
        if (c.words) lists.ja = c.words.newValue || {};
        if (c.wordsEn) lists.en = c.wordsEn.newValue || {};
        if (c.akkoTarget) akkoTarget = c.akkoTarget.newValue === "en" ? "en" : "ja";
        if (c.native) native = c.native.newValue || "";
        if (c.prefs) { const p = c.prefs.newValue || {}; prefs = { ...PREFS, ...p, on: { ...PREFS.on, ...(p.on || {}) } }; }
        if (c.anki) anki = { ...ANKI, ...(c.anki.newValue || {}) };
        changed.forEach((fn) => fn());
    });

    const statusOf = (lemma) => lists[lang][lemma] || "new";

    // the languages to look for in a video, in order (the site scripts pick the first one it has)
    const learning = () => ({ ja: ["ja"], en: ["en"], both: ["ja", "en"] }[prefs.learn] || [akkoTarget]);
    const LANG_NAMES = { ja: "Japanese", en: "English" };
    const isUnknown = (lemma) => ["new", "learning"].includes(statusOf(lemma));

    // to akko: through background.js's outbox, so nothing is lost while akko is closed
    const toAkko = (entries) => ask({ type: "log", entries });
    const sync = (ifOlderThan = 0) => ask({ type: "sync", ifOlderThan }).catch(() => {});

    async function setStatus(lemma, status) {
        if (!(chrome.runtime && chrome.runtime.id)) throw new Error("the extension was updated: reload this page");
        const words = lists[lang];
        if (status === "new") delete words[lemma]; else words[lemma] = status;
        await chrome.storage.local.set({ [lang === "en" ? "wordsEn" : "words"]: words });
        await toAkko([{ kind: "status", lemma, status, lang }]);
    }
    const today = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60e3).toISOString().slice(0, 10); };
    // takes effect here at once (two quick changes mustn't undo each other), then saved for every tab
    const savePrefs = (patch) => {
        prefs = { ...prefs, ...patch };
        changed.forEach((fn) => fn());
        return chrome.storage.local.set({ prefs });
    };

    // ---------- splitting lines into words (akko's tokenizer), cached ----------

    const tokenCache = new Map();       // "<lang>|<line>" -> tokens
    const toks = (line) => tokenCache.get(`${lang}|${line}`);
    async function tokenize(lines) {
        const todo = [...new Set(lines.filter((l) => !toks(l)))];
        for (let i = 0; i < todo.length; i += 300) {
            const part = todo.slice(i, i + 300);
            const { tokens } = await api("/api/tokenize", { method: "POST", body: { lines: part, lang } });
            part.forEach((l, k) => tokenCache.set(`${lang}|${l}`, tokens[k]));
        }
        return lines.map(toks);
    }

    // akko's grammar lessons (id, title, meaning, level), for the grammar a word is part of
    const lessonLists = {};
    const grammarLessons = () => {
        const l = lang;
        if (!lessonLists[l]) lessonLists[l] = api(`/api/grammar?lang=${l}`).then((r) => r.lessons || []).catch(() => { delete lessonLists[l]; return []; });
        return lessonLists[l];
    };

    // what language a subtitle file is in: "ja", "en" or "" (anything else)
    const STOP = new Set(["the", "and", "you", "to", "is", "it", "that", "of", "a", "i", "what", "this", "in", "my", "your", "we", "don't", "it's", "i'm", "be", "have", "do", "not", "are"]);
    function langOfText(lines) {
        const sample = lines.slice(0, 80).join(" ");
        if ((sample.match(/[぀-ヿ一-鿿]/g) || []).length > sample.length * 0.3) return "ja";
        const words = sample.toLowerCase().match(/[a-z']+/g) || [];
        return words.length >= 10 && words.filter((w) => STOP.has(w)).length > words.length * 0.15 ? "en" : "";
    }

    // ---------- small helpers ----------

    // text put together from pieces, translated piece by piece (the rest is done by lang.js's watch)
    const L10N = (s) => (globalThis.akkoLang ? akkoLang.t(s) : s);

    const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const clock = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
    const typing = (el) => !!el && (el.isContentEditable || /^(input|textarea|select)$/i.test(el.tagName));

    // pitch accent, as akko's cards have it (scripts/words/pitch.js)
    const morae = (kana) => kana.match(/.[ゃゅょぁぃぅぇぉゎャュョァィゥェォヮ]?/g) || [];
    const isHigh = (n, i) => (n === 0 ? i > 0 : n === 1 ? i === 0 : i >= 1 && i < n);
    const pattern = (n, count) => (n === 0 ? "heiban: low, then stays high" : n === 1 ? "atamadaka: high, then drops"
        : n === count ? "odaka: rises, drops after the word" : `nakadaka: rises, drops after mora ${n}`);
    const pitchNotes = (reading, n) => `[${n}] ${pattern(n, morae(reading).length)}`;
    function pitchCardHtml(reading, n) {
        const kata = reading.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
        const line = "border-color:currentColor;display:block;user-select:none;pointer-events:none;position:absolute;top:0.1em;left:0;right:0;height:0;border-top-width:0.1em;border-top-style:solid;";
        const drop = "right:-0.1em;height:0.4em;border-right-width:0.1em;border-right-style:solid;";
        const runs = [];
        morae(kata).forEach((m, i) => {
            const last = runs[runs.length - 1];
            if (last && last.high === isHigh(n, i)) last.text += m; else runs.push({ high: isHigh(n, i), text: m, falls: false });
            if (n > 0 && i === n - 1) runs[runs.length - 1].falls = true;
        });
        return runs.map(({ high, text, falls }) => (!high ? esc(text)
            : `<span style="display:inline-block;position:relative;${falls ? "padding-right:0.1em;margin-right:0.1em;" : ""}"><span style="display:inline;">${esc(text)}</span><span style="${line}${falls ? drop : ""}"></span></span>`)).join("");
    }

    // ---------- Anki (through akko's relay, with akko's Anki settings) ----------

    const ankiCall = async (action, params = {}) => {
        const r = await api("/api/anki", { method: "POST", body: { action, version: 6, params } });
        if (r.error) throw new Error(r.error);
        return r.result;
    };

    // the field mapping akko guesses (scripts/anki/client.js), for a note type akko hasn't seen
    const GUESSES = [
        [/^is[A-Z]|^is /, ""], [/sentence.?(eng|translation|meaning)/i, "translation"], [/sentence.?furigana/i, ""],
        [/(word|expression|vocab|term|reading).?audio/i, "wordAudio"], [/pitch.*(notes|pattern)/i, "pitchNotes"], [/pitch|accent/i, "pitch"],
        [/sentence.?audio|^audio$/i, "audio"], [/audio/i, ""], [/picture|image|screenshot|photo/i, "screenshot"],
        [/^(sentence|context|example)$|sentence$/i, "sentenceBold"], [/furigana/i, "furigana"], [/reading|kana/i, "reading"],
        [/meaning|definition|glossary|english|back/i, "meaning"], [/word|expression|vocab|front|kanji|term|key/i, "word"], [/source|notes|misc/i, "source"],
    ];
    const guess = (field) => (GUESSES.find(([re]) => re.test(field)) || [null, ""])[1];

    async function fieldMap() {
        if (!anki.deck || !anki.model) throw new Error("pick an Anki deck and note type in the extension's options (or open akko in this browser once: its Anki settings are copied)");
        let map = anki.maps[anki.model];
        if (!map) {
            const names = await ankiCall("modelFieldNames", { modelName: anki.model });
            map = Object.fromEntries(names.map((f) => [f, guess(f)]));
            await chrome.storage.local.set({ anki: { ...anki, maps: { ...anki.maps, [anki.model]: map } } });
        }
        return map;
    }

    function fieldValue(source, item) {
        const bold = item.surface && item.sentence.includes(item.surface)
            ? esc(item.sentence).replace(esc(item.surface), `<b>${esc(item.surface)}</b>`) : esc(item.sentence);
        switch (source) {
            case "word": return esc(item.word);
            case "reading": return esc(item.reading);
            case "furigana": return item.lang !== "en" && item.reading && item.reading !== item.word ? `${esc(item.word)}[${esc(item.reading)}]` : esc(item.word);
            case "meaning": return esc(item.meaning);
            case "pitch": return item.pitch.map((n) => pitchCardHtml(item.reading || item.word, n)).join("・");
            case "pitchNotes": return item.pitch.map((n) => esc(pitchNotes(item.reading || item.word, n))).join("<br>");
            case "sentence": return esc(item.sentence);
            case "sentenceBold": return bold;
            case "translation": return esc(item.translation);
            case "source": return item.url ? `<a href="${esc(item.url)}">${esc(item.source)}</a>` : esc(item.source);
            default: return "";
        }
    }

    // ---------- the overlay ----------

    const CSS = `
:host {all: initial;}
.root {position: absolute; inset: 0; pointer-events: none; z-index: 60; font-family: "Hiragino Sans", "Yu Gothic UI", "Meiryo", "Noto Sans JP", sans-serif; --size: 28px; --bottom: 11%; --bg: #000000a6;}
.root.serif {font-family: "Yu Mincho", "Hiragino Mincho ProN", "Noto Serif JP", "MS Mincho", serif;}
.root.en {font-family: system-ui, "Segoe UI", Roboto, Arial, sans-serif;}
.root.round {font-family: "M PLUS Rounded 1c", "Kosugi Maru", "Hiragino Maru Gothic ProN", "Yu Gothic UI", "Meiryo", sans-serif;}
.lines {position: absolute; left: 50%; bottom: var(--bottom); transform: translateX(-50%); max-width: 90%; text-align: center; pointer-events: auto; display: flex; flex-direction: column; align-items: center; gap: .2em;}
.line {font-size: var(--size); line-height: 1.75; color: #fff; background: var(--bg); padding: .05em .45em; border-radius: .25em; text-shadow: 0 0 3px #000; white-space: pre-wrap; transition: filter .15s;}
.line:empty {display: none;}
.line.blurred:not(:hover) {filter: blur(.3em);}
.tr {font-size: calc(var(--size) * .62); color: #e6e6e6; background: var(--bg); padding: .1em .5em; border-radius: .25em; font-family: system-ui, sans-serif; transition: filter .15s;}
.tr:empty {display: none;}
.tr.blurred:not(:hover) {filter: blur(.35em);}
.pill .mode {color: #ffd479;}
.w {cursor: pointer; border-radius: .15em;}
.w:hover {background: #ff5a7acc;}
.w.new {text-decoration: underline #ff5a7a .12em; text-underline-offset: .22em;}
.w.learning {text-decoration: underline #f2c94c .12em; text-underline-offset: .22em;}
/* idioms (膝が笑う, 首を長くする): a teal line under the whole expression until it's known */
.w[data-et="i"]:not([data-exs="known"]):not([data-exs="ignored"]) {box-shadow: inset 0 -.14em 0 #5eead4;}
rt {font-size: .5em; color: #f0f0f0;}
.pill {position: absolute; top: 12px; right: 12px; pointer-events: auto; display: flex; gap: 6px; align-items: center; font: 600 13px/1.2 system-ui, sans-serif;}
.pill button, .panel button, .popup button {font: inherit; cursor: pointer; border-radius: 8px; border: 1px solid #ffffff55; background: #000000b3; color: #fff; padding: 4px 10px;}
.pill .pct {color: #9ee6a0;}
.panel h3 {font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: #9a9aa8; margin: 12px 0 2px; border-top: 1px solid #ffffff1f; padding-top: 8px;}
.panel h3:first-child {margin-top: 0; border: 0; padding: 0;}
.panel a {color: #9ecbff;}
.panel {position: absolute; top: 46px; right: 12px; width: 300px; max-height: calc(100% - 70px); overflow: auto; pointer-events: auto; background: #1f2027f2; color: #eee; border-radius: 12px; padding: 12px 14px; font: 13px/1.5 system-ui, sans-serif; box-shadow: 0 4px 18px #0008;}
.panel label {display: block; margin: 6px 0;}
.panel select, .panel input[type=range] {width: 100%; margin-top: 3px; font: inherit;}
.panel select {background: #2c2d36; color: #eee; border: 1px solid #555; border-radius: 6px; padding: 3px;}
.panel .row {display: flex; gap: 6px; margin-top: 8px;}
.panel .muted {color: #aaa; font-size: 12px; margin: 6px 0 0;}
.popup {position: absolute; width: min(380px, 90%); max-height: 55%; overflow: auto; pointer-events: auto; background: #f4f4f8; color: #222; border-radius: 12px; padding: 10px 14px 12px; font: 14px/1.45 system-ui, sans-serif; box-shadow: 0 6px 22px #000a; border: 3px solid #ff6565;}
.popup .head {display: flex; align-items: center; gap: 8px; border-bottom: 1px dashed #aaa; padding-bottom: 6px; margin-bottom: 6px;}
.popup .head b {font-size: 1.5em; font-family: "Hiragino Sans", "Yu Gothic UI", "Meiryo", sans-serif;}
.popup .head .x {margin-left: auto;}
.popup button {background: #fff; color: #384775; border-color: #8e8d98; font-weight: 700; padding: 2px 9px;}
.popup .st {display: flex; gap: 4px; flex-wrap: wrap; margin: 4px 0 8px;}
.popup .st button.on {background: #ffe69e;}
.popup .entry {border-top: 1px dashed #ccc; padding-top: 6px; margin-top: 6px;}
.popup .entry:first-of-type {border: 0; margin: 0; padding: 0;}
.popup .hw {font-size: 1.25em; font-weight: 700; font-family: "Hiragino Sans", "Yu Gothic UI", "Meiryo", sans-serif;}
.popup .rd {color: #555; margin-left: 6px;}
.popup .tag {font-size: .75em; background: #b2ffac; border-radius: 99px; padding: 0 6px; margin-left: 6px;}
.popup .mine {float: right;}
.popup ol {margin: 4px 0 0; padding-left: 1.3em;}
.popup small {color: #777;}
.popup .msg {color: #555;}
.popup .infl {margin: -2px 0 6px; color: #555; font-size: .9em;}
.popup .say {padding: 0 6px; margin-left: 6px; font-size: .9em;}
.popup .pitch {display: inline-block; margin-left: 8px; color: #384775; font-family: "Hiragino Sans", "Yu Gothic UI", "Meiryo", sans-serif;}
.popup .pitch small {margin-left: 2px;}
.popup .expr {margin: 0 0 8px; padding: 6px 8px; border-radius: 8px; background: #e6f6f4; border-left: 4px solid #14a89b;}
.popup .expr .lbl {display: block; font-size: .78em; font-weight: 700; color: #0f766e;}
.popup .expr .st {margin: 6px 0 0;}
.popup .trs {margin: 2px 0 0; font-weight: 600; color: #384775;}
.popup .extra {border-top: 1px dashed #ccc; margin-top: 8px; padding-top: 6px; font-size: .9em;}
.popup .extra p {margin: 2px 0;}
.popup .extra b {font-family: "Hiragino Sans", "Yu Gothic UI", "Meiryo", sans-serif; font-size: 1.15em;}
.popup .extra a {color: #2d5bd3;}
.star {color: #ffd479; font-size: .6em; vertical-align: super; margin-left: .25em; cursor: help;}
.pill .tx.on {background: #384775;}
.side {position: absolute; top: 46px; bottom: 60px; left: 12px; width: min(380px, 40%); pointer-events: auto; background: #1f2027ee; color: #eee; border-radius: 12px; display: flex; flex-direction: column; font: 13px/1.5 system-ui, sans-serif; box-shadow: 0 4px 18px #0008;}
.side[hidden], .panel[hidden], .popup[hidden] {display: none;}
.side .bar {display: flex; gap: 8px; align-items: center; padding: 8px 12px; border-bottom: 1px solid #ffffff1f;}
.side .bar b {margin-right: auto;}
.side .bar label {font-size: 12px; color: #bbb;}
.side ol {list-style: none; margin: 0; padding: 4px 0; overflow: auto; flex: 1;}
.side li {display: flex; gap: 8px; padding: 4px 12px; cursor: pointer; border-left: 3px solid transparent;}
.side li:hover {background: #ffffff10;}
.side li.now {background: #ff5a7a22; border-left-color: #ff5a7a;}
.side li time {color: #888; font-size: 11px; min-width: 3.2em; padding-top: .35em; font-variant-numeric: tabular-nums;}
.side li .t {font-family: "Hiragino Sans", "Yu Gothic UI", "Meiryo", sans-serif; font-size: 16px; line-height: 1.7;}
.side li .t rt {font-size: .55em;}
.side li .st1 {color: #ffd479; padding-top: .3em;}
.side.only1 li:not(.one) {display: none;}
.toast {position: absolute; left: 50%; top: 14px; transform: translateX(-50%); background: #000000d9; color: #fff; padding: 6px 14px; border-radius: 10px; font: 600 14px/1.4 system-ui, sans-serif; pointer-events: none; opacity: 0; transition: opacity .2s;}
.toast.show {opacity: 1;}
.toast.bad {background: #b00020e6;}
`;

    // site = {name, video(), recordable: bool, screenshot: bool, onTrack(id), onTranslation(id), title(), url(t)}
    function overlay(container, site) {
        lang = site.lang === "en" ? "en" : "ja";
        const host = document.createElement("div");
        host.setAttribute("data-akko", "");
        host.style.cssText = "position:absolute;inset:0;pointer-events:none;z-index:60;";
        const shadow = host.attachShadow({ mode: "open" });
        shadow.innerHTML = `<style>${CSS}</style>
            <div class="root">
                <div class="lines"><div class="line" lang="${lang}"></div><div class="tr" translate="no"></div></div>
                <div class="pill"><span class="mode"></span><span class="pct"></span><button class="tx" title="all the lines (Shift+T)">☰</button><button class="open" title="akko companion">akko ▾</button></div>
                <div class="side" hidden></div>
                <div class="panel" hidden></div>
                <div class="popup" hidden></div>
                <div class="toast"></div>
            </div>`;
        container.append(host);
        // the menus and messages in akko's interface language (lang.js)
        if (globalThis.akkoLang) akkoLang.watch(shadow);
        const $ = (sel) => shadow.querySelector(sel);
        $(".root").classList.toggle("en", lang === "en");
        const ui = { root: $(".root"), lines: $(".lines"), line: $(".line"), tr: $(".tr"), pct: $(".pct"), mode: $(".mode"), open: $(".open"), tx: $(".tx"), side: $(".side"), panel: $(".panel"), popup: $(".popup"), toast: $(".toast") };

        let cues = [], cues2 = [];
        let delay = 0;                   // seconds the subtitles are moved by (+ later, - earlier), for this video
        let slowUntil = -1;              // slow replay: back to normal speed after this time
        let hiddenForShot = false;       // akko's subtitles out of the way while the tab's picture is taken
        const timeNow = (v) => v.currentTime - delay;      // the subtitles' clock
        let tracks = [], current = "", translations = [], currentTr = "";
        let shown = -1, shownTr = "";
        let hovered = null;              // the word under the mouse
        let popupWord = null;            // {lemma, el}
        let pausedByHover = false;
        let recording = false;
        let note = "";

        // ----- the look: size follows the player; height, background, font from the panel -----
        const resize = () => {
            const st = ui.root.style;
            st.setProperty("--size", `${Math.max(16, container.clientHeight * 0.05 * (prefs.size / 100))}px`);
            st.setProperty("--bottom", `${prefs.position}%`);
            st.setProperty("--bg", `rgba(0, 0, 0, ${prefs.bg / 100})`);
            ui.root.classList.toggle("serif", prefs.font === "serif");
            ui.root.classList.toggle("round", prefs.font === "round");
            ui.mode.textContent = [prefs.autoPause ? L10N("⏸ each line") : "", prefs.hideJa ? L10N("👂 listening") : ""].filter(Boolean).join(" · ");
        };
        const ro = new ResizeObserver(resize);
        ro.observe(container);
        resize();
        let autoPausedAt = -1;           // the line auto-pause last stopped at

        // ----- the line -----
        const lineAt = (list, t) => {
            for (let i = 0; i < list.length; i++) if (t >= list[i].start && t < list[i].end) return i;
            return -1;
        };
        function wordHtml(t) {
            // particles (ぞ, ね, は…) can be looked up too; only content words get a status underline
            if (!t.b || (lang === "ja" && !/[぀-ヿ㐀-鿿]/.test(t.s))) return esc(t.s);
            const status = statusOf(t.b);
            const cls = t.c && (status === "new" || status === "learning") ? ` ${status}` : "";
            const ruby = t.f && (prefs.furigana === "always" || (prefs.furigana === "unknown" && isUnknown(t.b)))
                ? t.f.map((p) => (p.r ? `<ruby>${esc(p.t)}<rt>${esc(p.r)}</rt></ruby>` : esc(p.t))).join("") : esc(t.s);
            const gr = t.gr && t.gr.length ? ` data-gr="${esc(t.gr.join(" "))}"` : "";
            // the idiom or set phrase it's part of (server/expressions.js)
            const ex = t.ex ? ` data-ex="${esc(t.ex)}" data-et="${t.et === "i" ? "i" : "p"}" data-exs="${statusOf(t.ex)}"` : "";
            return `<span class="w${cls}" data-b="${esc(t.b)}"${gr}${ex}>${ruby}</span>`;
        }
        // a word's text without its furigana
        const plainOf = (w) => [...w.childNodes].map((n) => (n.nodeName === "RUBY" ? [...n.childNodes].filter((x) => x.nodeName !== "RT").map((x) => x.textContent).join("") : n.textContent)).join("");
        // the whole expression a word is part of, as written here: its neighbours with the same data-ex
        // (and, in English, the spaces between them)
        function expressionText(w) {
            const same = (n) => n && n.nodeType === 1 && n.dataset.ex === w.dataset.ex;
            const gap = (n) => n && n.nodeType === 3 && /^[ \t]*$/.test(n.nodeValue);
            let first = w;
            for (;;) {
                let p = first.previousSibling;
                if (gap(p) && same(p.previousSibling)) p = p.previousSibling;
                if (!same(p)) break;
                first = p;
            }
            let text = "";
            for (let n = first; n; n = n.nextSibling) {
                if (same(n)) text += plainOf(n);
                else if (gap(n) && same(n.nextSibling)) text += n.nodeValue;
                else break;
            }
            return text;
        }
        const lineHtml = (c) => { const tokens = toks(c.text); return tokens ? tokens.map(wordHtml).join("") : esc(c.text); };
        // i+1: exactly one word you don't know yet, the best sentences to mine
        const unknownIn = (c) => new Set((toks(c.text) || []).filter((t) => t.c && isUnknown(t.b)).map((t) => t.b)).size;
        const STAR = `<span class="star" title="one new word: a good sentence to mine">★</span>`;
        function render(force = false) {
            const v = site.video();
            // no video right now (an ad is playing): out of the way, so the ad's own buttons work
            const visibility = v && !hiddenForShot ? "" : "hidden";
            if (ui.root.style.visibility !== visibility) ui.root.style.visibility = visibility;
            if (!v) {
                if (shown !== -1 || shownTr) { shown = -1; shownTr = ""; ui.line.textContent = ""; ui.tr.textContent = ""; }
                return;
            }
            const now = timeNow(v);
            const i = lineAt(cues, now);
            if (i !== shown || force) {
                shown = i;
                const c = cues[i];
                if (!c) ui.line.textContent = "";
                else ui.line.innerHTML = lineHtml(c) + (prefs.iPlusOne && unknownIn(c) === 1 ? STAR : "");
                markTranscript();
            }
            // slow replay: normal speed again after the line
            if (slowUntil >= 0 && now >= slowUntil) { v.playbackRate = 1; slowUntil = -1; }
            // auto-pause: stop at the end of each line (not while recording one for Anki)
            const c = cues[shown];
            if (prefs.autoPause && c && !v.paused && !recording && autoPausedAt !== shown && now >= c.end - 0.08) {
                autoPausedAt = shown;
                v.pause();
            }
            // listening mode: the line stays blurred while it plays
            ui.line.classList.toggle("blurred", prefs.hideJa && !v.paused && !pausedByHover);
            // the translation: when paused (or always, or blurred), the line(s) at this moment
            const showTr = prefs.translation === "always" || prefs.translation === "blur" || (prefs.translation === "paused" && (v.paused || pausedByHover));
            const tr = showTr ? cues2.filter((x) => now >= x.start - 0.3 && now < x.end + 0.3).map((x) => x.text).join(" ") : "";
            if (tr !== shownTr) { shownTr = tr; ui.tr.textContent = tr; }
            ui.tr.classList.toggle("blurred", prefs.translation === "blur");
        }
        // ~16 times a second is plenty for subtitles (YouTube's own update 4 times a second), and
        // nothing at all while the tab is in the background
        const RENDER_EVERY = 60;
        const renderTimer = setInterval(() => { if (!document.hidden) render(); }, RENDER_EVERY);
        const redraw = () => { resize(); render(true); renderPct(); renderTranscript(); };
        changed.add(redraw);

        function renderPct() {
            let total = 0, known = 0;
            for (const c of cues) for (const t of toks(c.text) || []) {
                if (!t.c || statusOf(t.b) === "ignored") continue;
                total++;
                if (!isUnknown(t.b)) known++;
            }
            ui.pct.textContent = total ? `${Math.round((known / total) * 100)}% ${lang === "en" ? "understood" : "理解"}` : "";
        }

        // ----- the transcript: every line, the one playing marked; click a line to go there -----
        let only1 = false;               // show only the i+1 lines
        function renderTranscript() {
            if (ui.side.hidden) return;
            const ones = cues.filter((c) => unknownIn(c) === 1).length;
            ui.side.classList.toggle("only1", only1);
            ui.side.innerHTML = `<div class="bar"><b>${cues.length} lines</b>
                    <label title="lines with exactly one word you don't know"><input type="checkbox" class="only1"${only1 ? " checked" : ""}> only ★ (${ones})</label>
                    <button class="close" title="close (Shift+T)">✕</button></div>
                <ol>${cues.map((c, i) => {
                    const one = unknownIn(c) === 1;
                    return `<li data-i="${i}"${one ? ` class="one"` : ""}><time>${clock(c.start)}</time><span class="t" lang="${lang}">${lineHtml(c)}</span>${one ? `<span class="st1" title="one new word">★</span>` : ""}</li>`;
                }).join("")}</ol>`;
            ui.side.querySelector(".close").onclick = () => showTranscript(false);
            ui.side.querySelector(".only1").onchange = (e) => { only1 = e.target.checked; ui.side.classList.toggle("only1", only1); };
            markTranscript(true);
        }
        function markTranscript(scroll = false) {
            if (ui.side.hidden) return;
            const was = ui.side.querySelector("li.now");
            const li = ui.side.querySelector(`li[data-i="${shown}"]`);
            if (was && was !== li) was.classList.remove("now");
            if (!li) return;
            li.classList.add("now");
            // follow the video, unless the mouse is in the list (reading back)
            if (scroll || was !== li) { if (!ui.side.matches(":hover")) li.scrollIntoView({ block: "center" }); }
        }
        function showTranscript(on) {
            ui.side.hidden = !on;
            ui.tx.classList.toggle("on", on);
            if (on) renderTranscript();
        }
        ui.tx.addEventListener("click", () => showTranscript(ui.side.hidden));
        ui.side.addEventListener("click", (e) => {
            e.stopPropagation();
            const w = e.target.closest(".w");
            if (w) { lookup(w); return; }
            const li = e.target.closest("li[data-i]");
            if (li) jumpTo(cues[Number(li.dataset.i)]);
        });
        ui.side.addEventListener("mouseover", (e) => { hovered = e.target.closest(".w"); });
        for (const type of ["dblclick", "mousedown", "pointerdown", "wheel"]) ui.side.addEventListener(type, (e) => e.stopPropagation());

        // ----- hover: pause, and remember the word for the 1-4 keys -----
        ui.lines.addEventListener("mouseenter", () => {
            const v = site.video();
            if (prefs.hoverPause && v && !v.paused && !recording) { v.pause(); pausedByHover = true; }
        });
        ui.lines.addEventListener("mouseleave", () => {
            hovered = null;
            const v = site.video();
            if (pausedByHover && v && ui.popup.hidden) v.play();
            pausedByHover = false;
        });
        ui.line.addEventListener("mouseover", (e) => { hovered = e.target.closest(".w"); });

        // ----- the dictionary -----
        ui.line.addEventListener("click", (e) => {
            const w = e.target.closest(".w");
            if (!w) return;
            e.stopPropagation();
            lookup(w);
        });
        // clicks on the overlay mustn't reach the player (which would play / pause)
        for (const el of [ui.lines, ui.popup, ui.panel, ui.open, ui.tx]) {
            for (const type of ["click", "dblclick", "mousedown", "pointerdown"]) el.addEventListener(type, (e) => e.stopPropagation());
        }

        function place(el) {
            const r = el.getBoundingClientRect();
            const c = container.getBoundingClientRect();
            ui.popup.hidden = false;
            const pw = ui.popup.offsetWidth, ph = ui.popup.offsetHeight;
            let left = r.left - c.left + r.width / 2 - pw / 2;
            left = Math.max(8, Math.min(left, c.width - pw - 8));
            let top = r.top - c.top - ph - 10;
            if (top < 8) top = Math.min(r.bottom - c.top + 10, c.height - ph - 8);
            ui.popup.style.left = `${left}px`;
            ui.popup.style.top = `${Math.max(8, top)}px`;
        }

        async function lookup(w) {
            const lemma = w.dataset.b;
            const plain = plainOf(w);
            const expression = w.dataset.ex ? { key: w.dataset.ex, kind: w.dataset.et, text: expressionText(w) } : null;
            // a word in the transcript: its own line is the sentence for the card
            const li = w.closest("li[data-i]");
            popupWord = { lemma, el: w, surface: plain, expression, grammar: (w.dataset.gr || "").split(" ").filter(Boolean), cue: li ? Number(li.dataset.i) : null };
            const v = site.video();
            if (v && !v.paused) { v.pause(); pausedByHover = true; }
            ui.popup.innerHTML = `<div class="head"><b>${esc(plain)}</b><button class="x" title="close (Esc)">✕</button></div><p class="msg">looking up…</p>`;
            place(w);
            ui.popup.querySelector(".x").onclick = closePopup;
            try {
                const qs = new URLSearchParams();
                [...new Set([lemma, plain].filter(Boolean))].forEach((q) => qs.append("q", q));
                qs.set("form", plain);
                qs.set("lang", lang);
                if (lang === "en" && native) qs.set("native", native);       // translations into your language
                // the expression the word is part of, looked up at the same time
                const [r, ex] = await Promise.all([api(`/api/dict?${qs}`),
                    expression ? api(`/api/dict?${new URLSearchParams({ q: expression.key, lang, ...(lang === "en" && native ? { native } : {}) })}`).catch(() => null) : null]);
                if (!popupWord || popupWord.el !== w) return;
                if (expression && ex && ex.entries && ex.entries[0]) expression.entry = ex.entries[0];
                await renderEntries(r, lemma, plain);
                if (!popupWord || popupWord.el !== w) return;
                place(w);
            } catch (err) {
                ui.popup.querySelector(".msg").textContent = "couldn't look it up: " + err.message;
            }
        }

        // attr: data-st for the clicked word (keys 1-4), data-xst for the expression it's part of
        function statusButtons(lemma, attr = "data-st") {
            const now = statusOf(lemma);
            const keys = attr === "data-st";
            return `<div class="st">${[["new", "new"], ["learning", "learning"], ["known", "known ✓"], ["ignored", "ignore"]]
                .map(([s, label], i) => `<button ${attr}="${s}" class="${now === s ? "on" : ""}">${keys ? `${i + 1} ` : ""}${label}</button>`).join("")}</div>`;
        }
        // the idiom or set phrase the word is part of, above the word's own entry: its meaning is
        // usually not its words' (膝が笑う: knees giving way, not "knee" + "laugh")
        function expressionHtml(ex) {
            if (!ex || !ex.entry) return "";
            const e = ex.entry;
            const label = lang === "en" ? `${ex.kind === "i" ? "idiom" : "phrase"} · part of` : `${ex.kind === "i" ? "慣用句 idiom" : "表現 phrase"} · この単語を含む`;
            return `<div class="expr"><span class="lbl">${label}</span>
                <button class="mine xmine">+ mine</button>
                <span class="hw" translate="no">${esc(e.word)}</span><span class="rd" translate="no">${e.reading && e.reading !== e.word ? esc(e.reading) : ""}</span>
                ${trHtml(e)}<ol translate="no">${e.senses.slice(0, 3).map((x) => `<li>${esc(x.gloss.join("; "))}</li>`).join("")}</ol>
                ${statusButtons(ex.key, "data-xst")}</div>`;
        }

        // English: the word in your language (akko's translations), above the English definitions
        const trHtml = (e) => (e.tr && e.tr.length ? `<p class="trs" translate="no">${esc(e.tr.slice(0, 3).map((t) => t.words.join(", ")).join(" · "))}</p>` : "");

        async function renderEntries(r, lemma, plain) {
            const entries = r.entries || [];
            const pitchOf = (e) => ((e.pitch || []).find((p) => p.reading === e.reading) || (e.pitch || [])[0] || {}).accents || [];
            // grammar this word is part of: akko's lessons, a click away
            const lessons = popupWord && popupWord.grammar.length ? (await grammarLessons()).filter((l) => popupWord.grammar.includes(l.id)) : [];
            let akkoUrl = "";
            try { if (lessons.length) akkoUrl = (await chrome.storage.local.get("akkoUrl")).akkoUrl || ""; } catch { /* the extension was reloaded */ }
            const kanji = (r.kanji || []).slice(0, 4);
            ui.popup.innerHTML = `<div class="head"><b translate="no">${esc(plain)}</b>${lemma && lemma !== plain ? `<span translate="no">→ ${esc(lemma)}</span>` : ""}<button class="x" title="close (Esc)">✕</button></div>
                ${r.inflection && r.inflection.length ? `<p class="infl" translate="no">${esc(plain)} = ${esc(r.query || lemma)} + ${esc(r.inflection.join(" + "))}</p>` : ""}
                ${lemma ? statusButtons(lemma) : ""}
                ${expressionHtml(popupWord && popupWord.expression)}
                ${entries.length ? entries.slice(0, 4).map((e, i) => `<div class="entry">
                    <button class="mine" data-i="${i}">+ mine</button>
                    <span class="hw" translate="no">${esc(e.word)}</span><span class="rd" translate="no">${e.reading && e.reading !== e.word ? esc(e.reading) : ""}</span>${e.common ? `<span class="tag">common</span>` : ""}<button class="say" data-i="${i}" title="hear it">🔊</button>
                    ${pitchOf(e).length ? `<span class="pitch" title="pitch accent" translate="no">${pitchOf(e).map((n) => `${pitchCardHtml(e.reading || e.word, n)}<small>[${n}]</small>`).join(" ")}</span>` : ""}
                    ${trHtml(e)}<ol translate="no">${e.senses.slice(0, 4).map((s) => `<li>${esc(s.gloss.join("; "))} <small>${esc(s.pos.join(", "))}</small></li>`).join("")}</ol>
                </div>`).join("") : `<p class="msg">no dictionary entry for this</p>`}
                ${lessons.length || kanji.length ? `<div class="extra" translate="no">
                    ${lessons.map((l) => `<p>${lang === "en" ? "grammar" : "文法"} <a href="${esc(akkoUrl ? `${akkoUrl}/grammar.html#${encodeURIComponent(l.id)}` : "#")}" target="_blank" rel="noopener"><b>${esc(l.title)}</b></a> ${esc(l.meaning)} <small>${esc(l.level || "")}</small></p>`).join("")}
                    ${kanji.map((k) => `<p><b>${esc(k.char)}</b> ${esc((k.meanings || []).slice(0, 3).join(", "))} <small>${esc([(k.on || []).slice(0, 2).join("・"), (k.kun || []).slice(0, 2).join("・"), k.jlpt ? `JLPT ${k.jlpt}` : ""].filter(Boolean).join(" · "))}</small></p>`).join("")}
                </div>` : ""}`;
            ui.popup.querySelector(".x").onclick = closePopup;
            ui.popup.querySelectorAll("[data-st]").forEach((b) => { b.onclick = () => markWord(lemma, b.dataset.st); });
            ui.popup.querySelectorAll(".mine:not(.xmine)").forEach((b) => { b.onclick = () => mine(entries[Number(b.dataset.i)], b); });
            // the expression: its own status, and mined as itself (the whole phrase bold in the sentence)
            const ex = popupWord && popupWord.expression;
            ui.popup.querySelectorAll("[data-xst]").forEach((b) => { b.onclick = () => markWord(ex.key, b.dataset.xst); });
            const xmine = ui.popup.querySelector(".xmine");
            if (xmine) xmine.onclick = () => mine({ ...ex.entry, word: ex.key }, xmine, ex.text);
            ui.popup.querySelectorAll(".say").forEach((b) => { b.onclick = () => say(entries[Number(b.dataset.i)], b); });
        }

        // the word's pronunciation (akko: recordings, or its voices)
        async function say(e, btn) {
            btn.disabled = true;
            try {
                const a = await api(`/api/audio?${new URLSearchParams({ word: e.word, reading: e.reading || "", lang })}`);
                const type = { mp3: "audio/mpeg", ogg: "audio/ogg", opus: "audio/ogg", wav: "audio/wav", m4a: "audio/mp4", webm: "audio/webm" }[a.ext] || "audio/mpeg";
                const bytes = Uint8Array.from(atob(a.data), (ch) => ch.charCodeAt(0));
                const url = URL.createObjectURL(new Blob([bytes], { type }));
                const audio = new Audio(url);
                audio.onended = () => URL.revokeObjectURL(url);
                await audio.play();
            } catch (err) {
                toast(`${e.word}: ${err.message || "no recording"}`, true);
            } finally { btn.disabled = false; }
        }

        function closePopup() {
            ui.popup.hidden = true;
            popupWord = null;
            const v = site.video();
            if (pausedByHover && v && !ui.lines.matches(":hover")) { v.play(); pausedByHover = false; }
        }

        async function markWord(lemma, status) {
            try { await setStatus(lemma, status); } catch (err) { toast(err.message, true); return; }
            if (popupWord && popupWord.lemma === lemma) {
                ui.popup.querySelectorAll("[data-st]").forEach((b) => b.classList.toggle("on", b.dataset.st === status));
            }
            if (popupWord && popupWord.expression && popupWord.expression.key === lemma) {
                ui.popup.querySelectorAll("[data-xst]").forEach((b) => b.classList.toggle("on", b.dataset.xst === status));
            }
            toast(`${lemma}: ${status}`);
        }

        // ----- mining -----
        // the line's audio and the picture: from the video itself (YouTube), or from the whole tab
        // when the video is copy-protected (Netflix: site.recordable / site.screenshot = "tab")
        const byTab = (what) => site[what] === "tab" || prefs.tabCapture;
        // Chrome only lets an extension record a tab after its toolbar button was clicked on that tab
        const CLICK = "for the line's audio and a picture, click the akko companion button in Chrome's toolbar once on this tab";
        const needsClick = (err) => /invoked|activeTab|all_urls|permission/i.test(err.message || "");
        async function recordLine(c) {
            return byTab("recordable") ? recordLineTab(c) : recordLineVideo(c);
        }
        async function recordLineTab(c) {
            const v = site.video();
            if (!v) throw new Error("no video");
            const from = c.start + delay - 0.1, to = c.end + delay + 0.15;
            const back = v.currentTime, wasPaused = v.paused;
            recording = true;
            try {
                if (site.seek) site.seek(from); else v.currentTime = from;
                for (let i = 0; i < 60 && Math.abs(v.currentTime - from) > 0.4; i++) await wait(50);
                await ask({ type: "tabAudioStart" });
                await v.play();
                const until = Date.now() + (to - from) * 1000 + 8000;      // never record forever
                while (v.currentTime < to && !v.paused && Date.now() < until) await wait(40);
                const a = await ask({ type: "tabAudioStop" });
                v.pause();
                return a;
            } catch (err) {
                await ask({ type: "tabAudioStop" }).catch(() => {});
                throw needsClick(err) ? Object.assign(new Error(CLICK), { click: true }) : err;
            } finally {
                if (site.seek) site.seek(back); else v.currentTime = back;
                if (!wasPaused) v.play().catch(() => {});
                recording = false;
            }
        }
        async function recordLineVideo(c) {
            const v = site.video();
            if (!site.recordable || !v || !v.captureStream) throw new Error("no audio here");
            const stream = v.captureStream();
            const tracksA = stream.getAudioTracks();
            if (!tracksA.length) throw new Error("no audio track");
            const mime = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/webm"].find((m) => MediaRecorder.isTypeSupported(m));
            const back = v.currentTime, wasPaused = v.paused;
            recording = true;
            try {
                v.playbackRate = 1;
                v.currentTime = Math.max(0, c.start + delay - 0.1);
                await new Promise((r) => v.addEventListener("seeked", r, { once: true }));
                const rec = new MediaRecorder(new MediaStream(tracksA), { mimeType: mime });
                const parts = [];
                rec.ondataavailable = (e) => { if (e.data.size) parts.push(e.data); };
                const done = new Promise((r) => { rec.onstop = r; });
                rec.start();
                await v.play();
                while (v.currentTime < c.end + delay + 0.15 && !v.paused) await wait(40);
                rec.stop();
                await done;
                v.pause();
                const blob = new Blob(parts, { type: mime });
                const data = await new Promise((r) => { const f = new FileReader(); f.onload = () => r(String(f.result).split(",")[1]); f.readAsDataURL(blob); });
                return { data, ext: mime.includes("ogg") ? "ogg" : "webm" };
            } finally {
                v.currentTime = back;
                if (!wasPaused) v.play().catch(() => {});
                recording = false;
            }
        }

        async function screenshot() {
            return byTab("screenshot") ? screenshotTab() : screenshotVideo();
        }
        // a picture of the tab, cut to the video, with akko's subtitles and menus out of the way
        async function screenshotTab() {
            const v = site.video();
            if (!v) throw new Error("no video");
            hiddenForShot = true;
            ui.root.style.visibility = "hidden";
            await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
            let data;
            try { data = (await ask({ type: "tabShot" })).data; }
            catch (err) { throw needsClick(err) ? Object.assign(new Error(CLICK), { click: true }) : err; }
            finally { hiddenForShot = false; ui.root.style.visibility = ""; }
            const img = await new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = () => reject(new Error("no picture")); i.src = data; });
            const r = v.getBoundingClientRect();
            const k = img.width / innerWidth;
            const sx = Math.max(0, r.left * k), sy = Math.max(0, r.top * k);
            const sw = Math.min(img.width - sx, r.width * k), sh = Math.min(img.height - sy, r.height * k);
            const w = Math.min(640, Math.round(sw)), h = Math.round((sh / sw) * w);
            const canvas = Object.assign(document.createElement("canvas"), { width: w, height: h });
            const g = canvas.getContext("2d");
            g.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
            // copy-protected video can come out black (Chrome's hardware acceleration hides it)
            const px = g.getImageData(0, 0, w, h).data;
            let sum = 0;
            for (let i = 0; i < px.length; i += 400) sum += px[i] + px[i + 1] + px[i + 2];
            if (sum / (px.length / 400) < 8) throw new Error("the picture came out black (in Chrome's settings, turning off \"Use graphics acceleration\" fixes it on Netflix)");
            return canvas.toDataURL("image/jpeg", 0.85).split(",")[1];
        }
        function screenshotVideo() {
            const v = site.video();
            if (!site.screenshot || !v || !v.videoWidth) throw new Error("no screenshot here");
            const w = Math.min(640, v.videoWidth), h = Math.round((v.videoHeight / v.videoWidth) * w);
            const canvas = Object.assign(document.createElement("canvas"), { width: w, height: h });
            canvas.getContext("2d").drawImage(v, 0, 0, w, h);
            return canvas.toDataURL("image/jpeg", 0.85).split(",")[1];
        }

        // surface: what's bold in the sentence (an expression's own text), else the clicked word
        async function mine(entry, btn, surface = "") {
            if (!entry) return;
            const c = popupWord && popupWord.cue !== null ? cues[popupWord.cue]
                : cues[shown] || (site.video() ? cues[lineAt(cues, timeNow(site.video()))] : null);
            const v = site.video();
            btn.disabled = true;
            btn.textContent = "adding…";
            const problems = [];
            const toAnki = prefs.mineTo !== "akko";
            try {
                const map = toAnki ? await fieldMap() : {};
                const wants = (src) => Object.values(map).includes(src);
                const t = c ? c.start : v ? v.currentTime : 0;
                const item = {
                    lang,
                    forms: entry.forms || [],
                    word: entry.word,
                    reading: entry.reading || "",
                    pitch: ((entry.pitch || []).find((p) => p.reading === entry.reading) || {}).accents || [],
                    meaning: entry.senses.slice(0, 3).map((s) => s.gloss.join("; ")).join(" / "),
                    surface: surface || (popupWord ? popupWord.surface : ""),
                    sentence: c ? c.text.replace(/\n/g, " ") : "",
                    translation: c ? cues2.filter((x) => x.end > c.start && x.start < c.end).map((x) => x.text).join(" ") : "",
                    source: `${site.title()} ${clock(t)}`.trim(),
                    url: site.url(t),
                };
                // akko's mined list (and 復習, which shows the sentence) gets every card
                const added = Date.now();
                const forAkko = {
                    ...item, id: `${added}-${Math.random().toString(36).slice(2, 8)}`, added, lang,
                    source: site.title(), time: clock(t), videoName: site.title(),
                    cueStart: c ? c.start : null, cueEnd: c ? c.end : null,
                };
                // the picture and the line's audio: for Anki (when its fields want them), and kept in
                // akko for 復習 (sent to akko's server, which hands them to akko's windows)
                const keep = prefs.keepMedia !== false;
                const fieldsFor = (src) => Object.keys(map).filter((f) => map[f] === src);
                let shot = null, line = null;
                if ((toAnki && anki.shot && wants("screenshot")) || keep) {
                    try { shot = await screenshot(); } catch (err) { problems.push(err.click ? err.message : "screenshot: " + err.message); }
                }
                if (c && ((toAnki && anki.audio && wants("audio")) || keep)) {
                    btn.textContent = "recording…";
                    try { line = await recordLine(c); } catch (err) { problems.push(err.click ? err.message : "line audio: " + err.message); }
                }
                const media = {};
                if (keep) {
                    for (const [kind, ext, data] of [["picture", "jpg", shot], ["audio", line && line.ext, line && line.data]]) {
                        if (!data) continue;
                        try { await api(`/api/companion/media/${encodeURIComponent(forAkko.id)}`, { method: "POST", body: { kind, ext, data } }); media[kind] = ext; }
                        catch { problems.push("recording not kept in akko"); }
                    }
                }
                if (!toAnki) {
                    await toAkko([{ kind: "mined", item: { ...forAkko, media } }]);
                    btn.textContent = "saved ✓";
                    if (statusOf(entry.word) === "new") await setStatus(entry.word, "learning");
                    toast(`saved ${entry.word} in akko ✓${problems.length ? ` (${[...new Set(problems)].join(", ")})` : ""}`);
                    return;
                }
                const fields = Object.fromEntries(Object.entries(map).map(([f, src]) => [f, fieldValue(src, item)]));
                const stamp = `akko_${Date.now()}`;
                const audio = [], picture = [];
                if (shot && anki.shot && wants("screenshot")) picture.push({ data: shot, filename: `${stamp}.jpg`, fields: fieldsFor("screenshot") });
                if (line && anki.audio && wants("audio")) audio.push({ data: line.data, filename: `${stamp}.${line.ext}`, fields: fieldsFor("audio") });
                if (anki.wordAudio && wants("wordAudio")) {
                    try {
                        const a = await api(`/api/audio?${new URLSearchParams({ word: item.word, reading: item.reading, lang })}`);
                        audio.push({ data: a.data, filename: `${stamp}_word.${a.ext}`, fields: fieldsFor("wordAudio") });
                    } catch (err) { problems.push("word audio: " + err.message); }
                }
                const noteId = await ankiCall("addNote", { note: {
                    deckName: anki.deck, modelName: anki.model, fields,
                    tags: String(anki.tags || "").split(/\s+/).filter(Boolean),
                    options: { allowDuplicate: false, duplicateScope: "deck" },
                    audio, picture,
                } });
                await toAkko([{ kind: "mined", item: { ...forAkko, media, ankiNoteId: noteId } }]).catch(() => problems.push("not saved in akko"));
                btn.textContent = "added ✓";
                if (statusOf(entry.word) === "new") await setStatus(entry.word, "learning");
                toast(`added ${entry.word} to ${anki.deck} ✓${problems.length ? ` (${[...new Set(problems)].join(", ")})` : ""}`);
            } catch (err) {
                btn.disabled = false;
                btn.textContent = "+ mine";
                toast(`${entry.word}: ${err.message}`, true);
            }
        }

        // ----- messages -----
        let toastTimer = 0;
        function toast(text, bad = false) {
            ui.toast.textContent = text;
            ui.toast.classList.toggle("bad", bad);
            ui.toast.classList.add("show");
            clearTimeout(toastTimer);
            toastTimer = setTimeout(() => ui.toast.classList.remove("show"), bad ? 6000 : 3000);
        }

        // ----- the panel: tracks, translation, size, the rest -----
        function renderPanel() {
            const opt = (list, cur, none) => (none ? `<option value="">${none}</option>` : "") + list.map((t) => `<option value="${esc(t.id)}"${t.id === cur ? " selected" : ""}>${esc(t.label)}</option>`).join("");
            const check = (cls, on, text) => `<label><input class="${cls}" type="checkbox" ${on ? "checked" : ""}> ${text}</label>`;
            ui.panel.innerHTML = `
                <h3>Subtitles</h3>
                <label>${LANG_NAMES[lang]} subtitles<select class="tracks">${tracks.length ? opt(tracks, current) : `<option>none found on this video</option>`}</select></label>
                ${translations.length ? `<label>translation<select class="trs">${opt(translations, currentTr, "none")}</select></label>` : ""}
                <label>show the translation <small>(R)</small><select class="trmode">
                    <option value="paused">when paused</option><option value="always">always</option>
                    <option value="blur">always, blurred until the mouse is on it</option><option value="off">never</option></select></label>
                ${lang === "ja" ? `<label>furigana<select class="furi"><option value="unknown">on words I don't know</option><option value="always">always</option><option value="off">off</option></select></label>` : ""}
                ${check("iplus1", prefs.iPlusOne, "★ lines with exactly one new word (the best to mine)")}
                <label>timing <small>(when the subtitles are early or late)</small></label>
                <div class="row"><button class="earlier" title="show the subtitles earlier">− 0.25 s</button><span class="delay" style="align-self:center;min-width:5em;text-align:center">${delay > 0 ? "+" : ""}${delay.toFixed(2)} s</span><button class="later" title="show the subtitles later">+ 0.25 s</button></div>
                <h3>Watching</h3>
                ${check("hover", prefs.hoverPause, "pause when the mouse is on the subtitles")}
                ${check("autopause", prefs.autoPause, "pause at the end of every line <small>(A)</small>")}
                ${check("hideja", prefs.hideJa, `listening practice: blur the ${LANG_NAMES[lang]} until paused <small>(L)</small>`)}
                <div class="row"><button class="prev" title="previous line ([)">⏮ line</button><button class="again" title="replay the line (P)">↻</button><button class="slow" title="replay the line slowly (Shift+P)">🐢</button><button class="next" title="next line (])">line ⏭</button></div>
                <div class="row"><button class="transcript" title="all the lines (Shift+T)">☰ all the lines</button></div>
                <h3>Look</h3>
                <label>size <input class="size" type="range" min="60" max="180" step="10" value="${prefs.size}"></label>
                <label>height <input class="position" type="range" min="2" max="45" step="1" value="${prefs.position}"></label>
                <label>background <input class="bg" type="range" min="0" max="100" step="5" value="${prefs.bg}"></label>
                <label>font<select class="font"><option value="sans">gothic (plain)</option><option value="serif">mincho (book style)</option><option value="round">rounded</option></select></label>
                <h3>Mining</h3>
                ${site.recordable === "tab" ? `<p class="muted">For the line's audio and a picture on cards, click the akko companion button in Chrome's toolbar once on this tab (Chrome only lets extensions record a tab after that).</p>` : ""}
                ${check("keepmedia", prefs.keepMedia !== false, "keep the line's audio and a picture in akko too (復習 plays them)")}
                <label>“+ mine” sends the card to<select class="mineto"><option value="anki">Anki, and akko's mined list</option><option value="akko">only akko's mined list</option></select></label>
                <p class="muted">${esc(note)}</p>
                <p class="muted"><span class="synced"></span> <a class="akko-link" href="#" target="_blank" rel="noopener">open akko ↗</a></p>
                <div class="row"><button class="off" title="turn akko off on ${esc(site.name)}">turn off here</button></div>`;
            const $p = (s) => ui.panel.querySelector(s);
            $p(".trmode").value = prefs.translation;
            if ($p(".furi")) $p(".furi").value = prefs.furigana;
            $p(".font").value = prefs.font;
            $p(".mineto").value = prefs.mineTo;
            $p(".tracks").onchange = (e) => site.onTrack(e.target.value);
            if ($p(".trs")) $p(".trs").onchange = (e) => site.onTranslation(e.target.value);
            $p(".trmode").onchange = (e) => savePrefs({ translation: e.target.value });
            if ($p(".furi")) $p(".furi").onchange = (e) => savePrefs({ furigana: e.target.value });
            // sliders: live while dragging, saved when let go
            for (const key of ["size", "position", "bg"]) {
                $p(`.${key}`).oninput = (e) => { prefs[key] = Number(e.target.value); resize(); };
                $p(`.${key}`).onchange = (e) => savePrefs({ [key]: Number(e.target.value) });
            }
            $p(".font").onchange = (e) => savePrefs({ font: e.target.value });
            $p(".mineto").onchange = (e) => savePrefs({ mineTo: e.target.value });
            $p(".hover").onchange = (e) => savePrefs({ hoverPause: e.target.checked });
            $p(".autopause").onchange = (e) => savePrefs({ autoPause: e.target.checked });
            $p(".hideja").onchange = (e) => savePrefs({ hideJa: e.target.checked });
            chrome.storage.local.get(["akkoUrl", "synced"]).then(({ akkoUrl, synced }) => {
                if (akkoUrl) $p(".akko-link").href = akkoUrl; else $p(".akko-link").remove();
                const min = Math.round((Date.now() - synced) / 60e3);
                $p(".synced").textContent = synced ? `in step with akko ${min < 1 ? "just now" : `${min} min ago`} ·` : "";
            }).catch(() => {});
            $p(".prev").onclick = () => go(-1);
            $p(".next").onclick = () => go(1);
            $p(".again").onclick = () => go(0);
            $p(".slow").onclick = () => go(0, true);
            $p(".transcript").onclick = () => { ui.panel.hidden = true; showTranscript(true); };
            $p(".earlier").onclick = () => moveSubs(-0.25);
            $p(".later").onclick = () => moveSubs(0.25);
            $p(".iplus1").onchange = (e) => savePrefs({ iPlusOne: e.target.checked });
            $p(".keepmedia").onchange = (e) => savePrefs({ keepMedia: e.target.checked });
            $p(".off").onclick = () => savePrefs({ on: { ...prefs.on, [site.name]: false } }).then(() => api0.destroy());
        }
        ui.open.addEventListener("click", () => {
            ui.panel.hidden = !ui.panel.hidden;
            if (!ui.panel.hidden) renderPanel();
        });

        function go(step, slow = false) {
            const v = site.video();
            if (!v || !cues.length) return;
            const t = timeNow(v);
            let i = lineAt(cues, t);
            if (i < 0) i = cues.findIndex((c) => c.start > t) - (step > 0 ? 1 : 0);
            jumpTo(cues[Math.max(0, Math.min(cues.length - 1, step === 0 ? Math.max(i, 0) : i + step))], slow);
        }
        // play from a line's start; slow: at 70% speed until the line ends
        function jumpTo(target, slow = false) {
            const v = site.video();
            if (!v || !target) return;
            autoPausedAt = -1;
            const at = target.start + delay + 0.01;
            // Netflix breaks if its video's time is set directly: the site jumps through its own player
            if (site.seek) site.seek(at); else v.currentTime = at;
            if (slow) { v.playbackRate = 0.7; slowUntil = target.end; } else if (slowUntil >= 0) { v.playbackRate = 1; slowUntil = -1; }
            v.play().catch(() => {});
        }
        function moveSubs(by) {
            delay = Math.round((delay + by) * 100) / 100;
            render(true);
            toast(`subtitles ${delay === 0 ? "on time" : `${Math.abs(delay).toFixed(2)} s ${delay > 0 ? "later" : "earlier"}`}`);
            const d = ui.panel.querySelector(".delay");
            if (d) d.textContent = `${delay > 0 ? "+" : ""}${delay.toFixed(2)} s`;
        }

        // ----- keys: only ours, and only when not typing -----
        const STATUS_KEYS = { 1: "new", 2: "learning", 3: "known", 4: "ignored" };
        const onKey = (e) => {
            if (typing(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
            const word = popupWord ? popupWord.lemma : hovered ? hovered.dataset.b : null;
            let done = true;
            if (STATUS_KEYS[e.key] && word) markWord(word, STATUS_KEYS[e.key]);
            else if (e.key === "Escape" && !ui.popup.hidden) closePopup();
            else if (e.key === "Escape" && !ui.side.hidden) showTranscript(false);
            else if (e.key === "[") go(-1);
            else if (e.key === "]") go(1);
            else if (e.key === "p") go(0);
            else if (e.key === "P") go(0, true);                        // Shift+P: slowly
            else if (e.key === "T") showTranscript(ui.side.hidden);     // Shift+T (t alone is YouTube's)
            else if (e.key === "a" || e.key === "A") toggle("autoPause", "pause at the end of every line");
            else if (e.key === "l" || e.key === "L") toggle("hideJa", "listening practice");
            else if (e.key === "r" || e.key === "R") {
                const modes = ["paused", "always", "blur", "off"];
                const next = modes[(modes.indexOf(prefs.translation) + 1) % modes.length];
                savePrefs({ translation: next });
                toast(`translation: ${{ paused: "when paused", always: "always", blur: "blurred until the mouse is on it", off: "never" }[next]}`);
            }
            else done = false;
            if (done) { e.preventDefault(); e.stopImmediatePropagation(); }
        };
        window.addEventListener("keydown", onKey, true);
        function toggle(key, label) {
            savePrefs({ [key]: !prefs[key] });
            toast(`${label}: ${prefs[key] ? "off" : "on"}`);
        }

        // ----- time with the language: counts in akko for today and the streak -----
        // every 15 s of playing (the video's own time moving, at any speed) is added up here, and
        // goes to akko once a minute
        const TICK = 15;
        let counted = 0, lastTime = null;
        const countTimer = setInterval(() => {
            const v = site.video();
            const t = v ? v.currentTime : null;
            if (v && cues.length && !v.paused && lastTime !== null && Math.abs(t - lastTime) > 1) counted += TICK;
            lastTime = t;
            if (counted >= 60) flushTime();
        }, TICK * 1000);
        function flushTime() {
            if (!counted) return;
            const url = site.url(0).replace(/[?&]t=\d+s?$/, "");
            toAkko([{ kind: "time", day: today(), seconds: counted, site: site.name, key: url, title: site.title(), url, lang }]).catch(() => {});
            counted = 0;
        }
        // akko's word list and Anki settings: now, then every minute while watching
        sync();
        const syncTimer = setInterval(() => sync(55e3), 60e3);
        addEventListener("pagehide", flushTime);       // leaving the page: the last seconds too

        const api0 = {
            // [{start, end, text}] in seconds
            async setCues(list, label = "") {
                cues = list;
                shown = -1;
                note = label;
                render(true);
                try {
                    await tokenize(cues.map((c) => c.text));
                    redraw();
                } catch (err) {
                    note = err.message;
                    toast(err.message, true);
                }
            },
            setTranslation(list) { cues2 = list; shownTr = null; render(true); },
            // the subtitles' language ("ja" | "en"), when it's only known later
            setLang(l) {
                lang = l === "en" ? "en" : "ja";
                ui.line.lang = lang;
                ui.root.classList.toggle("en", lang === "en");
                closePopup();
                if (!ui.panel.hidden) renderPanel();
            },
            setTracks(list, cur) { tracks = list; current = cur; if (!ui.panel.hidden) renderPanel(); },
            setTranslations(list, cur) { translations = list; currentTr = cur; if (!ui.panel.hidden) renderPanel(); },
            toast,
            destroy() {
                flushTime();
                const v = site.video();
                if (v && slowUntil >= 0) v.playbackRate = 1;
                clearInterval(countTimer);
                clearInterval(syncTimer);
                removeEventListener("pagehide", flushTime);
                clearInterval(renderTimer);
                ro.disconnect();
                changed.delete(redraw);
                window.removeEventListener("keydown", onKey, true);
                host.remove();
            },
            get host() { return host; },
        };
        return api0;
    }

    window.akkoCompanion = { ready, overlay, ask, api, prefs: () => prefs, savePrefs, esc, wait, learning, langOfText, LANG_NAMES };
})();
