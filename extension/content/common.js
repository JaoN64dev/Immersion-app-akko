// akko companion: what YouTube and Netflix share. A site script (content/youtube.js,
// content/netflix.js) finds the video and its subtitles, then calls akkoCompanion.overlay(),
// which draws the subtitles over the video with every word clickable:
//   - words are split and looked up by akko (through background.js), coloured by your word list
//     (new: red, learning: yellow), with furigana on the ones you don't know yet
//   - click a word: akko's dictionary entry, its status (1-4), "+ mine" to Anki with the sentence,
//     the line's audio, a screenshot and the word's pronunciation, using akko's Anki settings
//   - hovering the subtitles pauses the video; [ and ] go to the previous / next line, P replays,
//     A pauses at the end of every line, R changes how the translation shows
//   - a translation line shows when the video is paused (or always, or blurred until the mouse is on it)
//   - akko gets it all (through background.js and akko's server): word statuses, mined words (in
//     akko's mined list and 復習) and the time watched (it counts for today and the streak)
// Everything lives in a shadow root inside the player, so the site's styles don't touch it and
// it stays visible in full screen.
//
// Saved in chrome.storage.local: words {lemma: status} (akko's list, copied by background.js),
// outbox (what's waiting to go to akko), anki (akko's Anki settings), prefs.

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
        hideJa: false,            // the Japanese line blurred while playing: listen first
        position: 11,             // the subtitles' distance from the bottom, % of the player
        bg: 65,                   // the subtitles' background, % opacity
        font: "sans",             // sans | serif | round
        mineTo: "anki",           // anki: Anki and akko | akko: only akko's mined list
    };
    const ANKI = { deck: "", model: "", maps: {}, tags: "akko immersion", audio: true, wordAudio: true, shot: true };
    let words = {};
    let prefs = { ...PREFS };
    let anki = { ...ANKI };
    const changed = new Set();          // callbacks when words/prefs change

    const ready = chrome.storage.local.get(["words", "prefs", "anki"]).then((s) => {
        words = s.words || {};
        prefs = { ...PREFS, ...(s.prefs || {}), on: { ...PREFS.on, ...((s.prefs || {}).on || {}) } };
        anki = { ...ANKI, ...(s.anki || {}) };
    });
    chrome.storage.onChanged.addListener((c) => {
        if (c.words) words = c.words.newValue || {};
        if (c.prefs) { const p = c.prefs.newValue || {}; prefs = { ...PREFS, ...p, on: { ...PREFS.on, ...(p.on || {}) } }; }
        if (c.anki) anki = { ...ANKI, ...(c.anki.newValue || {}) };
        changed.forEach((fn) => fn());
    });

    const statusOf = (lemma) => words[lemma] || "new";
    const isUnknown = (lemma) => ["new", "learning"].includes(statusOf(lemma));

    // to akko: through background.js's outbox, so nothing is lost while akko is closed
    const toAkko = (entries) => ask({ type: "log", entries });
    const sync = (ifOlderThan = 0) => ask({ type: "sync", ifOlderThan }).catch(() => {});

    async function setStatus(lemma, status) {
        if (!(chrome.runtime && chrome.runtime.id)) throw new Error("the extension was updated: reload this page");
        if (status === "new") delete words[lemma]; else words[lemma] = status;
        await chrome.storage.local.set({ words });
        await toAkko([{ kind: "status", lemma, status }]);
    }
    const today = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60e3).toISOString().slice(0, 10); };
    // takes effect here at once (two quick changes mustn't undo each other), then saved for every tab
    const savePrefs = (patch) => {
        prefs = { ...prefs, ...patch };
        changed.forEach((fn) => fn());
        return chrome.storage.local.set({ prefs });
    };

    // ---------- splitting lines into words (akko's tokenizer), cached ----------

    const tokenCache = new Map();
    async function tokenize(lines) {
        const todo = [...new Set(lines.filter((l) => !tokenCache.has(l)))];
        for (let i = 0; i < todo.length; i += 300) {
            const part = todo.slice(i, i + 300);
            const { tokens } = await api("/api/tokenize", { method: "POST", body: { lines: part, lang: "ja" } });
            part.forEach((l, k) => tokenCache.set(l, tokens[k]));
        }
        return lines.map((l) => tokenCache.get(l));
    }

    // ---------- small helpers ----------

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
            case "furigana": return item.reading && item.reading !== item.word ? `${esc(item.word)}[${esc(item.reading)}]` : esc(item.word);
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
.toast {position: absolute; left: 50%; top: 14px; transform: translateX(-50%); background: #000000d9; color: #fff; padding: 6px 14px; border-radius: 10px; font: 600 14px/1.4 system-ui, sans-serif; pointer-events: none; opacity: 0; transition: opacity .2s;}
.toast.show {opacity: 1;}
.toast.bad {background: #b00020e6;}
`;

    // site = {name, video(), recordable: bool, screenshot: bool, onTrack(id), onTranslation(id), title(), url(t)}
    function overlay(container, site) {
        const host = document.createElement("div");
        host.setAttribute("data-akko", "");
        host.style.cssText = "position:absolute;inset:0;pointer-events:none;z-index:60;";
        const shadow = host.attachShadow({ mode: "open" });
        shadow.innerHTML = `<style>${CSS}</style>
            <div class="root">
                <div class="lines"><div class="line" lang="ja"></div><div class="tr"></div></div>
                <div class="pill"><span class="mode"></span><span class="pct"></span><button class="open" title="akko companion">akko ▾</button></div>
                <div class="panel" hidden></div>
                <div class="popup" hidden></div>
                <div class="toast"></div>
            </div>`;
        container.append(host);
        const $ = (sel) => shadow.querySelector(sel);
        const ui = { root: $(".root"), lines: $(".lines"), line: $(".line"), tr: $(".tr"), pct: $(".pct"), mode: $(".mode"), open: $(".open"), panel: $(".panel"), popup: $(".popup"), toast: $(".toast") };

        let cues = [], cues2 = [];
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
            ui.mode.textContent = [prefs.autoPause ? "⏸ each line" : "", prefs.hideJa ? "👂 listening" : ""].filter(Boolean).join(" · ");
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
            if (!t.b || !/[぀-ヿ㐀-鿿]/.test(t.s)) return esc(t.s);
            const status = statusOf(t.b);
            const cls = t.c && (status === "new" || status === "learning") ? ` ${status}` : "";
            const ruby = t.f && (prefs.furigana === "always" || (prefs.furigana === "unknown" && isUnknown(t.b)))
                ? t.f.map((p) => (p.r ? `<ruby>${esc(p.t)}<rt>${esc(p.r)}</rt></ruby>` : esc(p.t))).join("") : esc(t.s);
            return `<span class="w${cls}" data-b="${esc(t.b)}">${ruby}</span>`;
        }
        function render(force = false) {
            const v = site.video();
            if (!v) return;
            const i = lineAt(cues, v.currentTime);
            if (i !== shown || force) {
                shown = i;
                const c = cues[i];
                if (!c) ui.line.textContent = "";
                else {
                    const tokens = tokenCache.get(c.text);
                    ui.line.innerHTML = tokens ? tokens.map(wordHtml).join("") : esc(c.text);
                }
            }
            // auto-pause: stop at the end of each line (not while recording one for Anki)
            const c = cues[shown];
            if (prefs.autoPause && c && !v.paused && !recording && autoPausedAt !== shown && v.currentTime >= c.end - 0.08) {
                autoPausedAt = shown;
                v.pause();
            }
            // listening mode: the Japanese stays blurred while it plays
            ui.line.classList.toggle("blurred", prefs.hideJa && !v.paused && !pausedByHover);
            // the translation: when paused (or always, or blurred), the line(s) at this moment
            const showTr = prefs.translation === "always" || prefs.translation === "blur" || (prefs.translation === "paused" && (v.paused || pausedByHover));
            const tr = showTr ? cues2.filter((x) => v.currentTime >= x.start - 0.3 && v.currentTime < x.end + 0.3).map((x) => x.text).join(" ") : "";
            if (tr !== shownTr) { shownTr = tr; ui.tr.textContent = tr; }
            ui.tr.classList.toggle("blurred", prefs.translation === "blur");
        }
        let raf = 0;
        const loop = () => { render(); raf = requestAnimationFrame(loop); };
        raf = requestAnimationFrame(loop);
        const redraw = () => { resize(); render(true); renderPct(); };
        changed.add(redraw);

        function renderPct() {
            let total = 0, known = 0;
            for (const c of cues) for (const t of tokenCache.get(c.text) || []) {
                if (!t.c || statusOf(t.b) === "ignored") continue;
                total++;
                if (!isUnknown(t.b)) known++;
            }
            ui.pct.textContent = total ? `${Math.round((known / total) * 100)}% 理解` : "";
        }

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
        for (const el of [ui.lines, ui.popup, ui.panel, ui.open]) {
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
            const plain = [...w.childNodes].map((n) => (n.nodeName === "RUBY" ? [...n.childNodes].filter((x) => x.nodeName !== "RT").map((x) => x.textContent).join("") : n.textContent)).join("");
            popupWord = { lemma, el: w, surface: plain };
            const v = site.video();
            if (v && !v.paused) { v.pause(); pausedByHover = true; }
            ui.popup.innerHTML = `<div class="head"><b>${esc(plain)}</b><button class="x" title="close (Esc)">✕</button></div><p class="msg">辞書を引いています…</p>`;
            place(w);
            ui.popup.querySelector(".x").onclick = closePopup;
            try {
                const qs = new URLSearchParams();
                [...new Set([lemma, plain].filter(Boolean))].forEach((q) => qs.append("q", q));
                qs.set("form", plain);
                qs.set("lang", "ja");
                const r = await api(`/api/dict?${qs}`);
                if (!popupWord || popupWord.el !== w) return;
                renderEntries(r, lemma, plain);
                place(w);
            } catch (err) {
                ui.popup.querySelector(".msg").textContent = "couldn't look it up: " + err.message;
            }
        }

        function statusButtons(lemma) {
            const now = statusOf(lemma);
            return `<div class="st">${[["new", "1 new"], ["learning", "2 learning"], ["known", "3 known ✓"], ["ignored", "4 ignore"]]
                .map(([s, label]) => `<button data-st="${s}" class="${now === s ? "on" : ""}">${label}</button>`).join("")}</div>`;
        }

        function renderEntries(r, lemma, plain) {
            const entries = r.entries || [];
            ui.popup.innerHTML = `<div class="head"><b>${esc(plain)}</b>${lemma && lemma !== plain ? `<span>→ ${esc(lemma)}</span>` : ""}<button class="x" title="close (Esc)">✕</button></div>
                ${lemma ? statusButtons(lemma) : ""}
                ${entries.length ? entries.slice(0, 4).map((e, i) => `<div class="entry">
                    <button class="mine" data-i="${i}">+ mine</button>
                    <span class="hw">${esc(e.word)}</span><span class="rd">${e.reading && e.reading !== e.word ? esc(e.reading) : ""}</span>${e.common ? `<span class="tag">common</span>` : ""}
                    <ol>${e.senses.slice(0, 4).map((s) => `<li>${esc(s.gloss.join("; "))} <small>${esc(s.pos.join(", "))}</small></li>`).join("")}</ol>
                </div>`).join("") : `<p class="msg">no dictionary entry for this</p>`}`;
            ui.popup.querySelector(".x").onclick = closePopup;
            ui.popup.querySelectorAll("[data-st]").forEach((b) => { b.onclick = () => markWord(lemma, b.dataset.st); });
            ui.popup.querySelectorAll(".mine").forEach((b) => { b.onclick = () => mine(entries[Number(b.dataset.i)], b); });
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
            toast(`${lemma}: ${status}`);
        }

        // ----- mining -----
        async function recordLine(c) {
            const v = site.video();
            if (!site.recordable || !v || !v.captureStream) throw new Error("no audio here");
            const stream = v.captureStream();
            const tracksA = stream.getAudioTracks();
            if (!tracksA.length) throw new Error("no audio track");
            const mime = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/webm"].find((m) => MediaRecorder.isTypeSupported(m));
            const back = v.currentTime, wasPaused = v.paused;
            recording = true;
            try {
                v.currentTime = Math.max(0, c.start - 0.1);
                await new Promise((r) => v.addEventListener("seeked", r, { once: true }));
                const rec = new MediaRecorder(new MediaStream(tracksA), { mimeType: mime });
                const parts = [];
                rec.ondataavailable = (e) => { if (e.data.size) parts.push(e.data); };
                const done = new Promise((r) => { rec.onstop = r; });
                rec.start();
                await v.play();
                while (v.currentTime < c.end + 0.15 && !v.paused) await wait(40);
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

        function screenshot() {
            const v = site.video();
            if (!site.screenshot || !v || !v.videoWidth) throw new Error("no screenshot here");
            const w = Math.min(640, v.videoWidth), h = Math.round((v.videoHeight / v.videoWidth) * w);
            const canvas = Object.assign(document.createElement("canvas"), { width: w, height: h });
            canvas.getContext("2d").drawImage(v, 0, 0, w, h);
            return canvas.toDataURL("image/jpeg", 0.85).split(",")[1];
        }

        async function mine(entry, btn) {
            if (!entry) return;
            const c = cues[shown] || cues[lineAt(cues, site.video()?.currentTime || 0)];
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
                    forms: entry.forms || [],
                    word: entry.word,
                    reading: entry.reading || "",
                    pitch: ((entry.pitch || []).find((p) => p.reading === entry.reading) || {}).accents || [],
                    meaning: entry.senses.slice(0, 3).map((s) => s.gloss.join("; ")).join(" / "),
                    surface: popupWord ? popupWord.surface : "",
                    sentence: c ? c.text.replace(/\n/g, " ") : "",
                    translation: c ? cues2.filter((x) => x.end > c.start && x.start < c.end).map((x) => x.text).join(" ") : "",
                    source: `${site.title()} ${clock(t)}`.trim(),
                    url: site.url(t),
                };
                // akko's mined list (and 復習, which shows the sentence) gets every card
                const added = Date.now();
                const forAkko = {
                    ...item, id: `${added}-${Math.random().toString(36).slice(2, 8)}`, added,
                    source: site.title(), time: clock(t), videoName: site.title(),
                    cueStart: c ? c.start : null, cueEnd: c ? c.end : null,
                };
                if (!toAnki) {
                    await toAkko([{ kind: "mined", item: forAkko }]);
                    btn.textContent = "saved ✓";
                    if (statusOf(entry.word) === "new") await setStatus(entry.word, "learning");
                    toast(`saved ${entry.word} in akko ✓`);
                    return;
                }
                const fields = Object.fromEntries(Object.entries(map).map(([f, src]) => [f, fieldValue(src, item)]));
                const stamp = `akko_${Date.now()}`;
                const audio = [], picture = [];
                const fieldsFor = (src) => Object.keys(map).filter((f) => map[f] === src);
                if (anki.shot && wants("screenshot")) {
                    try { picture.push({ data: screenshot(), filename: `${stamp}.jpg`, fields: fieldsFor("screenshot") }); } catch (err) { problems.push("screenshot: " + err.message); }
                }
                if (anki.wordAudio && wants("wordAudio")) {
                    try {
                        const a = await api(`/api/audio?${new URLSearchParams({ word: item.word, reading: item.reading, lang: "ja" })}`);
                        audio.push({ data: a.data, filename: `${stamp}_word.${a.ext}`, fields: fieldsFor("wordAudio") });
                    } catch (err) { problems.push("word audio: " + err.message); }
                }
                if (anki.audio && wants("audio") && c) {
                    btn.textContent = "recording…";
                    try {
                        const a = await recordLine(c);
                        audio.push({ data: a.data, filename: `${stamp}.${a.ext}`, fields: fieldsFor("audio") });
                    } catch (err) { problems.push("line audio: " + err.message); }
                }
                const noteId = await ankiCall("addNote", { note: {
                    deckName: anki.deck, modelName: anki.model, fields,
                    tags: String(anki.tags || "").split(/\s+/).filter(Boolean),
                    options: { allowDuplicate: false, duplicateScope: "deck" },
                    audio, picture,
                } });
                await toAkko([{ kind: "mined", item: { ...forAkko, ankiNoteId: noteId } }]).catch(() => problems.push("not saved in akko"));
                btn.textContent = "added ✓";
                if (statusOf(entry.word) === "new") await setStatus(entry.word, "learning");
                toast(`added ${entry.word} to ${anki.deck} ✓${problems.length ? ` (${problems.join(", ")})` : ""}`);
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
                <label>Japanese subtitles<select class="tracks">${tracks.length ? opt(tracks, current) : `<option>none found on this video</option>`}</select></label>
                ${translations.length ? `<label>translation<select class="trs">${opt(translations, currentTr, "none")}</select></label>` : ""}
                <label>show the translation <small>(R)</small><select class="trmode">
                    <option value="paused">when paused</option><option value="always">always</option>
                    <option value="blur">always, blurred until the mouse is on it</option><option value="off">never</option></select></label>
                <label>furigana<select class="furi"><option value="unknown">on words I don't know</option><option value="always">always</option><option value="off">off</option></select></label>
                <h3>Watching</h3>
                ${check("hover", prefs.hoverPause, "pause when the mouse is on the subtitles")}
                ${check("autopause", prefs.autoPause, "pause at the end of every line <small>(A)</small>")}
                ${check("hideja", prefs.hideJa, "listening practice: blur the Japanese until paused <small>(L)</small>")}
                <div class="row"><button class="prev" title="previous line ([)">⏮ line</button><button class="again" title="replay the line (P)">↻</button><button class="next" title="next line (])">line ⏭</button></div>
                <h3>Look</h3>
                <label>size <input class="size" type="range" min="60" max="180" step="10" value="${prefs.size}"></label>
                <label>height <input class="position" type="range" min="2" max="45" step="1" value="${prefs.position}"></label>
                <label>background <input class="bg" type="range" min="0" max="100" step="5" value="${prefs.bg}"></label>
                <label>font<select class="font"><option value="sans">gothic (plain)</option><option value="serif">mincho (book style)</option><option value="round">rounded</option></select></label>
                <h3>Mining</h3>
                <label>“+ mine” sends the card to<select class="mineto"><option value="anki">Anki, and akko's mined list</option><option value="akko">only akko's mined list</option></select></label>
                <p class="muted">${esc(note)}</p>
                <p class="muted"><span class="synced"></span> <a class="akko-link" href="#" target="_blank" rel="noopener">open akko ↗</a></p>
                <div class="row"><button class="off" title="turn akko off on ${esc(site.name)}">turn off here</button></div>`;
            const $p = (s) => ui.panel.querySelector(s);
            $p(".trmode").value = prefs.translation;
            $p(".furi").value = prefs.furigana;
            $p(".font").value = prefs.font;
            $p(".mineto").value = prefs.mineTo;
            $p(".tracks").onchange = (e) => site.onTrack(e.target.value);
            if ($p(".trs")) $p(".trs").onchange = (e) => site.onTranslation(e.target.value);
            $p(".trmode").onchange = (e) => savePrefs({ translation: e.target.value });
            $p(".furi").onchange = (e) => savePrefs({ furigana: e.target.value });
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
            $p(".off").onclick = () => savePrefs({ on: { ...prefs.on, [site.name]: false } }).then(() => api0.destroy());
        }
        ui.open.addEventListener("click", () => {
            ui.panel.hidden = !ui.panel.hidden;
            if (!ui.panel.hidden) renderPanel();
        });

        function go(step) {
            const v = site.video();
            if (!v || !cues.length) return;
            const t = v.currentTime;
            let i = lineAt(cues, t);
            if (i < 0) i = cues.findIndex((c) => c.start > t) - (step > 0 ? 1 : 0);
            const target = cues[Math.max(0, Math.min(cues.length - 1, step === 0 ? Math.max(i, 0) : i + step))];
            if (!target) return;
            autoPausedAt = -1;
            // Netflix breaks if its video's time is set directly: the site jumps through its own player
            if (site.seek) site.seek(target.start + 0.01); else v.currentTime = target.start + 0.01;
            v.play().catch(() => {});
        }

        // ----- keys: only ours, and only when not typing -----
        const STATUS_KEYS = { 1: "new", 2: "learning", 3: "known", 4: "ignored" };
        const onKey = (e) => {
            if (typing(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
            const word = popupWord ? popupWord.lemma : hovered ? hovered.dataset.b : null;
            let done = true;
            if (STATUS_KEYS[e.key] && word) markWord(word, STATUS_KEYS[e.key]);
            else if (e.key === "Escape" && !ui.popup.hidden) closePopup();
            else if (e.key === "[") go(-1);
            else if (e.key === "]") go(1);
            else if (e.key === "p" || e.key === "P") go(0);
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

        // ----- time with Japanese: counts in akko for today and the streak -----
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
            toAkko([{ kind: "time", day: today(), seconds: counted, site: site.name, key: url, title: site.title(), url }]).catch(() => {});
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
            setTracks(list, cur) { tracks = list; current = cur; if (!ui.panel.hidden) renderPanel(); },
            setTranslations(list, cur) { translations = list; currentTr = cur; if (!ui.panel.hidden) renderPanel(); },
            toast,
            destroy() {
                flushTime();
                clearInterval(countTimer);
                clearInterval(syncTimer);
                removeEventListener("pagehide", flushTime);
                cancelAnimationFrame(raf);
                ro.disconnect();
                changed.delete(redraw);
                window.removeEventListener("keydown", onKey, true);
                host.remove();
            },
            get host() { return host; },
        };
        return api0;
    }

    window.akkoCompanion = { ready, overlay, ask, api, prefs: () => prefs, savePrefs, esc, wait };
})();
