// 読む Read page (reading.html): texts/books + manga

import { $ } from "../core/dom.js";
import * as popup from "../popup.js";
import { initKeys } from "../keys.js";
import { remindBackup } from "../core/reminder.js";
import { t } from "../i18n.js";
import { learningEnglish, ofTarget, keyFor, target } from "../core/target.js";
import { store, escapeHtml } from "../core/utils.js";
import { idbAll } from "../core/idb.js";
import { readTextFile, splitParagraphs } from "../reader/import.js";
import { parseSubtitle } from "../subtitles/parse.js";
import { addText, getText, removeText, renderLibrary, readingOf, saveReading } from "../reader/library.js";
import { tokenize } from "../words/render.js";
import { planWeek, planPriming } from "../core/planner.js";
import { KEY as PROGRESS_KEY } from "../progress.js";
import { langOf } from "../core/script.js";
import * as reader from "../reader/text.js";
import * as manga from "../reader/manga.js";

const ui = {
    textMode: $("#text-mode"), mangaMode: $("#manga-mode"),
    library: $("#library"), librarySection: $("#library-section"), status: $("#library-status"),
    pasteOpen: $("#paste-open"), pasteForm: $("#paste-form"), pasteTitle: $("#paste-title"),
    pasteText: $("#paste-text"), pasteCancel: $("#paste-cancel"), textFile: $("#text-file"),
    mangaFiles: $("#manga-files"), mangaFolder: $("#manga-folder"), audioFile: $("#audio-file"),
};

// ---------- text / manga switch (remembered in the address: #manga) ----------

function setMode(mode) {
    const isManga = mode === "manga";
    ui.textMode.hidden = isManga;
    ui.mangaMode.hidden = !isManga;
    document.querySelectorAll(".mode-switch [data-mode]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.mode === mode)));
    history.replaceState(null, "", isManga ? "#manga" : location.pathname);
}
document.querySelectorAll("[data-mode]").forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode)));
document.querySelectorAll("[data-mode-link]").forEach((a) => a.addEventListener("click", () => setMode(a.dataset.modeLink)));
setMode(location.hash === "#manga" && !learningEnglish() ? "manga" : "text");     // manga OCR is Japanese only
if (learningEnglish()) ui.pasteText.placeholder = "Paste some English text here…";

// ---------- library ----------

function showLibrary() {
    ui.librarySection.hidden = false;
    renderLibrary(ui.library, {
        onOpen: async (id) => open(await getText(id)),
        onDelete: async (id, title) => {
            if (!confirm(t(`delete “${title}” from the library?`))) return;
            await removeText(id);
            showLibrary();
        },
    });
}

function open(text) {
    ui.librarySection.hidden = true;
    reader.openText(text);
    document.getElementById("reader-section").scrollIntoView({ behavior: "smooth" });
}

// ---------- speech recognition (server/asr.js) ----------
//
// An audio file becomes a text: the tool on this machine writes an SRT, the SRT goes through the same
// parser the subtitle pages use, and the transcript lands in the library like anything else — so it
// gets coverage, priming, mining and a place in the plan. Nothing is uploaded, and nothing is
// downloaded: with no tool installed the server says what to install and this shows that sentence.

ui.audioFile.addEventListener("change", async () => {
    const file = ui.audioFile.files[0];
    if (!file) return;
    ui.status.textContent = `listening to ${file.name}… this runs on this computer and takes as long as it takes`;
    try {
        const res = await fetch(`/api/asr/transcribe?lang=${encodeURIComponent(target())}&name=${encodeURIComponent(file.name)}`, { method: "POST", body: file });
        const body = await res.json().catch(() => ({ error: "the server didn't answer" }));
        if (!res.ok) throw new Error(body.error || res.statusText);
        const paragraphs = parseSubtitle(body.srt, "srt").map((c) => c.text.replace(/\n/g, " ").trim()).filter(Boolean);
        if (!paragraphs.length) throw new Error("no speech in that file");
        const text = await addText(file.name.replace(/\.[^.]+$/, ""), paragraphs);
        ui.status.textContent = `made subtitles: ${paragraphs.length} lines from ${file.name}`;
        open(text);
    } catch (err) {
        // nothing installed is not an error message, it is a missing step: say it, and point at the
        // how-to in Settings (the same sentence Settings uses, so it reads in your language)
        if (/^no speech recognition found/.test(err.message)) {
            ui.status.innerHTML = escapeHtml(t("no speech recognition found. Install whisper.cpp (whisper-cli), OpenAI whisper, or faster-whisper: akko runs it here, and nothing is uploaded."))
                + ` — <a href="/settings.html#asr-section">how to install it</a>`;
        } else {
            ui.status.textContent = "couldn't transcribe it: " + err.message;
        }
    } finally {
        ui.audioFile.value = "";
    }
});

// ---------- the plan (scripts/core/planner.js) ----------
//
// Every text is tokenized once, its coverage recorded (so the library and the stats know it without
// asking again), and the week laid out: the 85–94% band first, the ones you started before the ones
// you haven't, and the rest kept for another week.

const plan = { button: $("#plan-week"), box: $("#library-plan") };

async function makePlan() {
    const texts = (await idbAll("texts"))
        .filter(ofTarget)
        .filter((t) => (t.chars || 0) >= 40)                                  // not a stray "AAA OI OI"
        .slice(0, 20);                                                        // a week doesn't need all of them
    if (!texts.length) {
        ui.status.textContent = "nothing to plan yet: paste a text or open a book first.";
        return;
    }
    plan.button.disabled = true;
    ui.status.textContent = `looking at ${texts.length} text${texts.length === 1 ? "" : "s"}… (this can take a minute)`;
    try {
        const items = [];
        for (const t of texts) {
            const { position, pct } = readingOf(t);
            const lang = langOf(t.paragraphs.join("\n"), t.lang || target());
            items.push({ id: t.id, kind: "text", title: t.title, lines: await tokenize(t.paragraphs, lang), position, pct });
        }
        // what you watch and listen to counts too, and needs no tokenizing: those pages recorded the %
        // (scripts/player/render.js, scripts/podcasts/player.js)
        for (const [id, r] of Object.entries(store.get(PROGRESS_KEY, {}))) {
            if (!r || typeof r.pct !== "number") continue;
            const title = (r.anime && r.anime.title && (r.anime.title.romaji || r.anime.title.native)) || r.videoName || "a video";
            items.push({ id, kind: "video", title, pct: r.pct, position: r.time || 0, minutes: r.duration ? Math.max(5, Math.round(r.duration / 60)) : 15 });
        }
        // manga is Japanese only (its OCR and the mode switch): never in a Korean or German week
        for (const [id, r] of Object.entries(target() === "ja" ? store.get("akko-manga", {}) : {})) {
            if (!r || typeof r.pct !== "number") continue;
            items.push({ id, kind: "manga", title: r.title || "a volume", pct: r.pct, position: r.page || 0, minutes: 20 });
        }
        for (const [id, r] of Object.entries(store.get(keyFor("akko-podcast-progress"), {}))) {
            if (!r || typeof r.pct !== "number") continue;
            items.push({ id, kind: "podcast", title: r.title || "an episode", pct: r.pct, position: r.time || 0, minutes: r.duration ? Math.max(5, Math.round(r.duration / 60)) : 20 });
        }
        const week = planWeek(items, { days: 7, minutes: 25 });
        // what each text is worth now, saved so the library and Settings → Stats can show it
        for (const item of week.items) if (item.kind === "text" && item.total) saveReading(item.id, { pct: item.pct, lang: target() });
        showPlan(week);
        ui.status.textContent = "";
    } catch (err) {
        ui.status.textContent = "couldn't plan it: " + err.message;
    } finally {
        plan.button.disabled = false;
    }
}

function showPlan(week) {
    if (!week.days.length) {
        plan.box.hidden = true;
        ui.status.textContent = "nothing to read yet: paste a text or open a book first.";
        return;
    }
    const words = planPriming(week, { limit: 12 });
    const minutes = week.days.reduce((n, d) => n + d.minutes, 0);
    plan.box.hidden = false;
    // every sentence here is one text node, in the English the language tables key on (scripts/i18n.js)
    plan.box.innerHTML = `
        <p class="hint"><b>your week</b></p>
        <p class="hint">about ${minutes} minutes, easiest first</p>
        ${week.left.length ? `<p class="hint">kept for later: ${week.left.length}</p>` : ""}
        <ol class="plan-days">
            ${week.days.map((d) => `<li>
                <b>day ${d.day}</b>
                ${d.items.map((i) => (i.kind && i.kind !== "text"
                    ? `<a class="plan-item" href="${i.kind === "video" ? "/" : i.kind === "manga" ? "/reading.html#manga" : "/podcasts.html"}">${escapeHtml(i.title)} <small>${i.pct}%</small></a>`
                    : `<button class="plan-item" data-id="${escapeHtml(i.id)}" title="${escapeHtml(i.band === "stretch" ? "the stretch: one unknown word every line or two" : i.band === "comfortable" ? "comfortable: read it for the story" : "too hard for now")}">${escapeHtml(i.title)} <small>${i.pct}%</small></button>`)).join(" ")}
                <small class="plan-time">${d.minutes} min</small>
            </li>`).join("")}
        </ol>
        ${words.length ? `<p class="hint"><b>learn these first</b> ${words.map((w) => `<span class="prime-word" title="${w.count} time${w.count > 1 ? "s" : ""} across the week">${escapeHtml(w.sample)}</span>`).join(" ")}</p>` : ""}`;
    plan.box.querySelectorAll("button.plan-item").forEach((b) => b.addEventListener("click", async () => {
        const text = await getText(b.dataset.id);
        if (text) open(text);
    }));
}

if (plan.button) plan.button.addEventListener("click", makePlan);

ui.pasteOpen.addEventListener("click", () => {
    ui.pasteForm.hidden = !ui.pasteForm.hidden;
    if (!ui.pasteForm.hidden) ui.pasteText.focus();
});
ui.pasteCancel.addEventListener("click", () => { ui.pasteForm.hidden = true; });
ui.pasteForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const paragraphs = splitParagraphs(ui.pasteText.value);
    if (!paragraphs.length) return;
    const title = ui.pasteTitle.value.trim() || paragraphs[0].slice(0, 20);
    const text = await addText(title, paragraphs);
    ui.pasteForm.hidden = true;
    ui.pasteText.value = ui.pasteTitle.value = "";
    open(text);
});

ui.textFile.addEventListener("change", async () => {
    const file = ui.textFile.files[0];
    ui.textFile.value = "";
    if (!file) return;
    ui.status.textContent = `reading ${file.name}…`;
    try {
        const { title, paragraphs } = await readTextFile(file);
        ui.status.textContent = "";
        open(await addText(title, paragraphs));
    } catch (err) {
        ui.status.textContent = `couldn't read ${file.name}: ${err.message}`;
    }
});

// ---------- manga ----------

for (const input of [ui.mangaFiles, ui.mangaFolder]) {
    input.addEventListener("change", () => {
        if (input.files.length) manga.openFiles(input.files, { picker: input === ui.mangaFolder ? "folder" : "files" });
        input.value = "";
    });
}

// ---------- shared ----------

popup.init();
reader.init({ onBack: showLibrary });
// The first time, while the library is empty: the first chapter of a public-domain novel to read
// straight away (samples/README.md), 吾輩は猫である or Alice in Wonderland. Once per language:
// deleting it is respected.
const SAMPLES = {
    ja: { file: "/samples/wagahai-1.txt", title: "吾輩は猫である（一）夏目漱石" },
    en: { file: "/samples/alice-1.txt", title: "Alice's Adventures in Wonderland (I) · Lewis Carroll" },
};
async function addSample() {
    const flag = keyFor("akko-sample-text");
    if (store.get(flag, false)) return;
    store.set(flag, true);
    if ((await idbAll("texts").catch(() => [])).some(ofTarget)) return;
    const sample = SAMPLES[learningEnglish() ? "en" : "ja"];
    const res = await fetch(sample.file);
    if (res.ok) await addText(sample.title, splitParagraphs(await res.text()));
}

manga.init();
addSample().catch(() => {}).finally(showLibrary);

const inManga = () => !ui.mangaMode.hidden;
initKeys({
    arrowleft: () => inManga() && manga.nextPage(),      // manga reads right-to-left
    arrowright: () => inManga() && manga.prevPage(),
    t: () => inManga() && manga.toggleText(),
    "+": () => inManga() && manga.zoomIn(),
    "=": () => inManga() && manga.zoomIn(),
    "-": () => inManga() && manga.zoomOut(),
    "0": () => inManga() && manga.resetZoom(),
});

remindBackup();
