// 設定 Settings page (settings.html): the language you're learning, the interface language,
// display options, the Japanese dictionary, stats (scripts/pages/stats.js draws them) and backup / restore.

import { $ } from "../core/dom.js";
import { getJson, postJson } from "../core/utils.js";
import { target, setTarget, nativeLang, setNative, NATIVE_LANGUAGES } from "../core/target.js";
import { lang, setLang, t } from "../i18n.js";
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

// your language: translations in the English word popup, and the course in your language (both courses)
const native = $("#native-lang");
const showLanguages = (codes) => {
    native.innerHTML = `<option value="">${target() === "en" ? "(none, English definitions only)" : "(none: the course in English)"}</option>`
        + codes.map((code) => `<option value="${code}">${NATIVE_LANGUAGES[code] || code}</option>`).join("");
    native.value = nativeLang();
};
if (target() === "en") showLanguages(Object.keys(NATIVE_LANGUAGES));
else {
    // learning Japanese, it's only for the course: list the languages it's translated into
    // (and the one already picked in English mode, so it isn't lost)
    showLanguages([]);
    getJson("/api/course/languages?lang=ja")
        .then(({ languages }) => showLanguages([...new Set([...languages, nativeLang()].filter(Boolean))]))
        .catch(() => showLanguages(Object.keys(NATIVE_LANGUAGES)));
}
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

// Dictionaries: the built-in JMdict (Japanese: what's installed, replace it, or download the newest),
// and the Yomitan dictionaries you added (both languages: on/off, order, remove)
const dict = { info: $("#dict-info"), msg: $("#dict-msg"), upload: $("#dict-upload"), update: $("#dict-update"), list: $("#dict-list") };
const num = (n) => n.toLocaleString("en-US");

let working = false;           // this page is installing one right now
let checkAgain = null;
let jmdictLoading = false;

// "download the newest" also waits while JMdict is still loading; adding a Yomitan one doesn't
function setButtons(enabled) {
    dict.upload.disabled = !enabled;
    dict.update.disabled = !enabled || jmdictLoading;
}

// While the server is still loading the dictionary (first start), or installing one for another
// tab, the buttons wait, and the page asks again every few seconds
function showDictionary(d) {
    clearTimeout(checkAgain);
    jmdictLoading = !!d.loading;
    if (!working) setButtons(!d.installing);
    if (d.loading || d.installing) checkAgain = setTimeout(refreshDictionary, 3000);
    if (d.installing && !working) dict.msg.textContent = "a dictionary is being installed…";
    if (!d.words) {
        dict.info.textContent = d.error && !d.loading ? "the dictionary couldn't load: " + d.error : "the dictionary is still loading…";
        return;
    }
    dict.info.textContent = `JMdict ${d.words.version || "?"} · ${num(d.words.count)} words · ${num(d.kanji ? d.kanji.count : 0)} kanji`;
}

const refreshDictionary = () => getJson("/api/dictionary").then(showDictionary)
    .catch(() => { dict.info.textContent = "restart the server to use this"; setButtons(false); });

// ---------- the dictionaries you added ----------

let added = [];          // this language's, in order

function showList(all) {
    added = all.filter((d) => d.lang === target());
    dict.list.replaceChildren(...added.map((d, i) => {
        const li = document.createElement("li");
        li.className = d.enabled ? "" : "off";
        li.innerHTML = `<input type="checkbox" title="show it in the popup"${d.enabled ? " checked" : ""}>
            <span class="dict-name"><b translate="no"></b> <small></small></span>
            <button class="up" title="move up"${i ? "" : " disabled"}>↑</button>
            <button class="down" title="move down"${i < added.length - 1 ? "" : " disabled"}>↓</button>
            <button class="remove" title="remove">✕</button>`;
        li.querySelector("b").textContent = d.title;
        li.querySelector("small").textContent = `${d.revision ? d.revision + " · " : ""}${num(d.count)} entries`;
        li.querySelector("input").addEventListener("change", (e) => changeList(postJson(`/api/dictionaries/${encodeURIComponent(d.id)}`, { enabled: e.target.checked })));
        li.querySelector(".up").addEventListener("click", () => move(i, -1));
        li.querySelector(".down").addEventListener("click", () => move(i, 1));
        li.querySelector(".remove").addEventListener("click", () => {
            if (!confirm(t("Remove the dictionary {title}?").replace("{title}", d.title))) return;
            changeList(getJson(`/api/dictionaries/${encodeURIComponent(d.id)}`, { method: "DELETE" }));
        });
        return li;
    }));
}

// order: this language's list, with the other language's after it (they never show together)
function move(i, by) {
    const ids = added.map((d) => d.id);
    [ids[i], ids[i + by]] = [ids[i + by], ids[i]];
    changeList(postJson("/api/dictionaries/order", { ids }));
}

const changeList = (request) => request.then((r) => showList(r.dictionaries))
    .catch((err) => { dict.msg.textContent = "couldn't change it: " + err.message; refreshList(); });
const refreshList = () => getJson("/api/dictionaries").then((r) => showList(r.dictionaries)).catch(() => {});

// ---------- adding / replacing ----------

// one span per dictionary, so each message is translated on its own
function showInstalled(list) {
    dict.msg.replaceChildren(...list.flatMap((x, i) => {
        const span = document.createElement("span");
        span.textContent = x.kind === "dictionary" ? `${x.title}: ${num(x.count)} entries ${x.replaced ? "updated" : "added"} ✓`
            : x.kind === "kanji" ? `kanji: ${num(x.count)} installed ✓`
            : x.previous && x.previous === x.version ? `words: JMdict ${x.version} installed ✓ (the same version as before)`
            : `words: JMdict ${x.version || "?"} installed ✓`;
        const parts = i ? [" · ", span] : [span];
        // e.g. jmdict-eng-common: fine if that's what you wanted, surprising if not
        if (x.kind === "words" && x.previousCount && x.count < x.previousCount / 2) {
            const warn = document.createElement("span");
            warn.textContent = `note: it has far fewer words than the one before (${num(x.previousCount)}). "download the newest" brings the full one back.`;
            parts.push(" · ", warn);
        }
        return parts;
    }));
}

async function installDictionary(send, busyText) {
    working = true;
    setButtons(false);
    dict.msg.textContent = busyText;
    try {
        const res = await send();
        const body = await res.json().catch(() => ({ error: "the server didn't answer" }));
        if (!res.ok) throw new Error(body.error || res.statusText);
        showInstalled(body.installed);
    } catch (err) {
        dict.msg.textContent = "couldn't install it: " + err.message;
    } finally {
        working = false;
        dict.upload.value = "";
        refreshDictionary();
        refreshList();
    }
}

dict.upload.addEventListener("change", () => {
    const file = dict.upload.files[0];
    if (!file) return;
    // lang: for a Yomitan dictionary that doesn't say which language it's for
    installDictionary(() => fetch(`/api/dictionary/upload?lang=${target()}`, { method: "POST", body: file }),
        `installing ${file.name}… (this can take a minute)`);
});
dict.update.addEventListener("click", () => {
    installDictionary(() => fetch("/api/dictionary/update", { method: "POST" }),
        "downloading the newest dictionary… (about 13 MB, this can take a minute)");
});
setButtons(false);
refreshDictionary();
refreshList();

bindWordDisplay($("#furigana-mode"), $("#color-words"));
backup.init();
