// Loaded by every page, before the page's own script:
//   - the interface language (scripts/i18n.js)
//   - the language you're learning (scripts/core/target.js): body.target-ja / body.target-en
//     hides what only works for the other language (.ja-only / .en-only), and content areas
//     marked lang="ja" in the page switch to lang="en" when learning English
//   - the welcome screen, each time akko is opened: which language to learn (the menus stay in
//     English either way; 日本語 menus are an option in Settings)

import "./i18n.js";
import { chosen, target, setTarget, welcomeOn, setWelcome } from "./core/target.js";
import { store } from "./core/utils.js";
import * as today from "./core/today.js";

today.start();          // count today's minutes (watching, listening, reading)

const t = target();
document.body.classList.add(`target-${t}`);
if (t === "en") {
    document.querySelectorAll("main [lang=ja]").forEach((el) => { el.lang = "en"; });
    document.title = "akko";       // the page titles are "読む akko" and such
}

// ---------- the welcome screen ----------
// Shows once each time akko is opened (not again while you move between pages, or in a window a
// link opened): welcome, and which language to learn today. The first time you must pick one;
// after that, picking the same one (or Esc) just carries on. "Show this when akko opens" can be
// turned off here and back on in Settings → Display.

const SHOWN = "akko-welcomed";            // sessionStorage: already shown since akko was opened

function shownThisTime() {
    try { return sessionStorage.getItem(SHOWN) === "1"; } catch { return false; }
}
function markShown() {
    try { sessionStorage.setItem(SHOWN, "1"); } catch { /* private mode: it just shows again */ }
}
// came here from another akko page (a link that opened a new window, or the app moving on)
const fromAkko = () => { try { return !!document.referrer && new URL(document.referrer).origin === location.origin; } catch { return false; } };

const knownWords = (key) => Object.values(store.get(key, {})).filter((s) => s === "known").length;

// "Today: 25 min · 4 days in a row 🔥", for the language you learn now
function todayLine(lang) {
    const minutes = Math.floor(today.secondsOn(lang) / 60);
    const days = today.streak(lang);
    if (!minutes && !days) return "Nothing yet today. Even 10 minutes counts.";
    const parts = [minutes ? `Today: ${minutes} min` : "Nothing yet today"];
    if (days > 1) parts.push(`${days} days in a row 🔥`);
    return parts.join(" · ");
}

// Tab and Shift+Tab stay inside the welcome screen
function keepFocusIn(box, e) {
    const items = [...box.querySelectorAll("button, input")].filter((x) => !x.disabled);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    else if (!box.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
}

function welcome() {
    const first = !chosen();
    const current = first ? null : target();
    const known = { ja: knownWords("akko-words"), en: knownWords("akko-words-en") };
    const box = document.createElement("div");
    box.className = "target-chooser";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true");
    box.setAttribute("aria-labelledby", "welcome-title");
    const option = (lang, word, name, what) => `
                <button data-target="${lang}"${lang === current ? ` class="current" aria-current="true"` : ""}>
                    <b${lang === "ja" ? ' lang="ja"' : ""}>${word}</b>
                    <span>${name}</span>
                    <small>${what}</small>
                    ${known[lang] ? `<em>${known[lang].toLocaleString("en-US")} words known</em>` : ""}
                </button>`;
    box.innerHTML = `
        <div class="target-card">
            <h2 id="welcome-title">${first ? "Welcome to akko!" : "Welcome back!"}</h2>
            <p class="welcome-text">${first
                ? "Learn a language by watching, reading and listening to things you enjoy, clicking every word you don't know."
                : "A little every day is what makes it work. What are you learning today?"}</p>
            ${first ? "" : `<p class="welcome-today">${todayLine(current)}</p>`}
            ${first ? `<p class="welcome-ask">What do you want to learn?</p>` : ""}
            <div class="target-options">
                ${option("ja", "日本語", "Japanese", "anime, dramas, manga, books and podcasts in Japanese")}
                ${option("en", "English", "American English", "shows, films, books and podcasts in English")}
            </div>
            <p class="target-later">You can switch any time in 設定 Settings, and each language keeps its own progress. The menus can be shown in 日本語 there too.</p>
            ${first ? "" : `<label class="welcome-again"><input type="checkbox" checked> show this when akko opens</label>`}
        </div>`;

    const close = () => {
        box.remove();
        document.removeEventListener("keydown", onKey);
    };
    const onKey = (e) => {
        if (e.key === "Escape" && !first) close();
        if (e.key === "Tab") keepFocusIn(box, e);
    };
    document.addEventListener("keydown", onKey);
    box.addEventListener("click", (e) => {
        const b = e.target.closest("[data-target]");
        if (!b) return;
        if (b.dataset.target === current) return close();
        setTarget(b.dataset.target);
        location.reload();
    });
    const again = box.querySelector(".welcome-again input");
    if (again) again.addEventListener("change", () => setWelcome(again.checked));
    document.body.appendChild(box);
    box.querySelector(current ? "button.current" : "button").focus();
}

if (!chosen() || (welcomeOn() && !shownThisTime() && !fromAkko())) welcome();
markShown();
