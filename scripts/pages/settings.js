// 設定 Settings page (settings.html): the language you're learning, the interface language,
// display options, stats (scripts/pages/stats.js draws them) and backup / restore.

import { $ } from "../core/dom.js";
import { getJson, postJson } from "../core/utils.js";
import { target, setTarget, nativeLang, setNative, NATIVE_LANGUAGES } from "../core/target.js";
import { lang, setLang } from "../i18n.js";
import { bindWordDisplay } from "../words/display.js";
import * as backup from "../backup.js";
import "./stats.js";

// learning: switching reloads, since every page keeps that language's data
for (const b of document.querySelectorAll("[data-target]")) {
    b.setAttribute("aria-checked", String(b.dataset.target === target()));
    b.addEventListener("click", () => {
        if (b.dataset.target === target()) return;
        setTarget(b.dataset.target);
        location.reload();
    });
}

// your language: translations in the English word popup
const native = $("#native-lang");
native.innerHTML = `<option value="">(none, English definitions only)</option>`
    + Object.entries(NATIVE_LANGUAGES).map(([code, name]) => `<option value="${code}">${name}</option>`).join("");
native.value = nativeLang();
native.addEventListener("input", () => setNative(native.value));

// interface language: applied in place
for (const b of document.querySelectorAll("[data-lang]")) {
    b.setAttribute("aria-checked", String(b.dataset.lang === lang()));
    b.addEventListener("click", () => setLang(b.dataset.lang));
}

// OpenSubtitles (English subtitles search on the Watch page): saved by the server, not here
const os = { form: $("#os-settings"), key: $("#os-key"), user: $("#os-user"), pass: $("#os-pass"), msg: $("#os-msg") };
const osSay = (s) => {
    os.msg.textContent = !s.configured ? "not set up" : s.user ? `ready · logged in as ${s.user}` : "ready · not logged in (about 5 downloads a day)";
};
async function saveOpenSubs(apiKey, clear = false) {
    os.msg.textContent = "checking…";
    try {
        const s = await postJson("/api/opensubs/settings", { apiKey, username: os.user.value.trim(), password: os.pass.value, clear });
        os.pass.value = "";
        osSay(s);
    } catch (err) {
        os.msg.textContent = "couldn't save: " + err.message;
    }
}
os.form.addEventListener("submit", (e) => { e.preventDefault(); saveOpenSubs(os.key.value.trim()); });
$("#os-clear").addEventListener("click", () => {
    os.key.value = os.user.value = os.pass.value = "";
    os.key.placeholder = "";
    saveOpenSubs("", true);
});
getJson("/api/opensubs/status").then((s) => {
    osSay(s);
    if (s.configured) os.key.placeholder = "(saved)";
    if (s.user) os.user.value = s.user;
}).catch(() => { os.msg.textContent = "restart the server to use this"; });

bindWordDisplay($("#furigana-mode"), $("#color-words"));
backup.init();
