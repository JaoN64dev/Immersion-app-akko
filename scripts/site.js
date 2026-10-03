// Loaded by every page, before the page's own script:
//   - the interface language (scripts/i18n.js)
//   - the language you're learning (scripts/core/target.js): body.target-ja / body.target-en
//     hides what only works for the other language (.ja-only / .en-only), and content areas
//     marked lang="ja" in the page switch to lang="en" when learning English
//   - on the very first visit, asks which language you want to learn (the menus stay in English
//     either way; 日本語 menus are an option in Settings)

import "./i18n.js";
import { chosen, target, setTarget } from "./core/target.js";

const t = target();
document.body.classList.add(`target-${t}`);
if (t === "en") {
    document.querySelectorAll("main [lang=ja]").forEach((el) => { el.lang = "en"; });
    document.title = "akko";       // the page titles are "読む Japanese akko" and such
}

function askTarget() {
    const box = document.createElement("div");
    box.className = "target-chooser";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true");
    box.innerHTML = `
        <div class="target-card">
            <h2>What do you want to learn?</h2>
            <div class="target-options">
                <button data-target="ja">
                    <b lang="ja">日本語</b>
                    <span>Japanese</span>
                    <small>anime, dramas, manga, books and podcasts in Japanese</small>
                </button>
                <button data-target="en">
                    <b>English</b>
                    <span>American English</span>
                    <small>shows, films, books and podcasts in English</small>
                </button>
            </div>
            <p class="target-later">You can switch any time in 設定 Settings, and each language keeps its own progress. The menus can be shown in 日本語 there too.</p>
        </div>`;
    box.addEventListener("click", (e) => {
        const b = e.target.closest("[data-target]");
        if (!b) return;
        setTarget(b.dataset.target);
        location.reload();
    });
    document.body.appendChild(box);
    box.querySelector("button").focus();
}

if (!chosen()) askTarget();
