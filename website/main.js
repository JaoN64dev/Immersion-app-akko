// 1. The page in the visitor's language: Portuguese, Spanish or Japanese (i18n/<lang>.json, picked
//    from the browser's languages, or from the menu at the top), else English. Someone who wants to
//    learn English may not read it yet. Any other language gets a link to Google Translate's copy of
//    the page (a link only: no script of Google's on this site).
//    A translation file maps each block of the English page (its HTML) to its translation, so a
//    block changed in index.html simply stays in English until it's translated again.
// 2. The download buttons point at the newest release's files: GitHub says which they are, so this
//    page never needs editing for a new version. Without an answer (offline, GitHub's rate limit),
//    the buttons keep their link to the releases page.

const REPO = "JaoN64dev/Immersion-app-akko";
const LANGS = { en: "English", pt: "Português", es: "Español", ja: "日本語" };
const SAVED = "akko-site-lang";
const BLOCKS = "h1, h2, h3, p, li, summary, figcaption, .topbar-links a, .btn, .hero-version, th, td, label";
// what this script writes itself
const EN = {
    "@download": "⬇ Download akko {v}", "@hero-version": "for Windows · {size} · free · open source",
    "@installer": "Installer {v}", "@portable": "Portable {v}", "@windows": "Windows 10 / 11, 64-bit",
    "@released": "akko {v}, released {date} ({notes})", "@notes": "what's new",
};
let lang = "en";
let dict = {};
const t = (key, vars = {}) => (dict[key] || EN[key] || key).replace(/\{(\w+)\}/g, (all, k) => vars[k] ?? all);

const size = (bytes) => `${Math.round(bytes / 1e6)} MB`;
const day = (iso) => new Date(iso).toLocaleDateString(lang, { year: "numeric", month: "long", day: "numeric" });

const browserLangs = () => (navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || "en"]).map((l) => l.toLowerCase());
function pickLang() {
    let saved = null;
    try { saved = localStorage.getItem(SAVED); } catch { /* storage off */ }
    if (saved && LANGS[saved]) return saved;
    for (const l of browserLangs()) {
        const code = l.split("-")[0];
        if (LANGS[code]) return code;
    }
    return "en";
}

// Google Translate's copy of this page in another language (only for a page on the web)
function translatedCopy(to) {
    if (!/^https?:$/.test(location.protocol)) return null;
    const host = location.hostname.replace(/-/g, "--").replace(/\./g, "-");
    return `https://${host}.translate.goog${location.pathname}?_x_tr_sl=en&_x_tr_tl=${encodeURIComponent(to)}&_x_tr_hl=${encodeURIComponent(to)}`;
}
const nameOf = (code) => { try { return new Intl.DisplayNames([code], { type: "language" }).of(code); } catch { return code; } };

async function translatePage() {
    lang = pickLang();
    document.documentElement.lang = lang;
    // the menu at the top
    const menu = document.getElementById("site-lang");
    if (menu) {
        const other = browserLangs().map((l) => l.split("-")[0]).find((c) => !LANGS[c] && c !== "en");
        menu.innerHTML = Object.entries(LANGS).map(([code, name]) => `<option value="${code}"${code === lang ? " selected" : ""}>${name}</option>`).join("")
            + (translatedCopy("x") ? `<option value="other">🌐 ${other ? nameOf(other) : "…"} (Google Translate)</option>` : "");
        menu.addEventListener("change", () => {
            if (menu.value === "other") { location.href = translatedCopy(other || "auto"); return; }
            try { localStorage.setItem(SAVED, menu.value); } catch { /* storage off */ }
            location.reload();
        });
        // a language the page doesn't have: offer Google's copy, in that language's own name
        const dismissed = (() => { try { return sessionStorage.getItem("akko-site-lang-hint"); } catch { return null; } })();
        if (lang === "en" && other && translatedCopy(other) && !dismissed) {
            const bar = document.createElement("p");
            bar.className = "lang-hint";
            bar.innerHTML = `🌐 <a href="${translatedCopy(other)}">${nameOf(other)}</a> <button type="button" aria-label="close">✕</button>`;
            bar.querySelector("button").addEventListener("click", () => { bar.remove(); try { sessionStorage.setItem("akko-site-lang-hint", "1"); } catch { /* storage off */ } });
            document.querySelector(".topbar")?.after(bar);
        }
    }
    if (lang === "en") return;
    try { dict = await (await fetch(`i18n/${lang}.json`)).json(); } catch { return; }      // (opened as a file: stays English)
    const norm = (h) => h.replace(/\s+/g, " ").trim();
    for (const el of document.querySelectorAll(BLOCKS)) {
        if (el.parentElement.closest(BLOCKS) || el.closest("pre, marquee, [translate=no]")) continue;
        const done = dict[norm(el.innerHTML)];
        if (done) el.innerHTML = done;
    }
    if (dict["@title"]) document.title = dict["@title"];
    if (dict["@description"]) document.querySelector('meta[name="description"]')?.setAttribute("content", dict["@description"]);
}

async function newestRelease() {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: "application/vnd.github+json" } });
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
    return res.json();
}

function point(id, asset, label) {
    const a = document.getElementById(id);
    if (!a || !asset) return;
    a.href = asset.browser_download_url;
    a.textContent = `⬇ ${label}`;
    const note = document.getElementById(`${id}-size`);
    if (note) note.textContent = `${asset.name} · ${size(asset.size)} · ${t("@windows")}`;
}

translatePage().catch(() => {}).then(newestRelease).then((r) => {
    const version = String(r.tag_name || "").replace(/^v/i, "");
    const setup = r.assets.find((a) => /setup.*\.exe$/i.test(a.name));
    const portable = r.assets.find((a) => /portable.*\.exe$/i.test(a.name));
    point("dl-setup", setup, t("@installer", { v: version }));
    point("dl-portable", portable, t("@portable", { v: version }));
    // macOS and Linux (built by .github/workflows/build.yml): shown when this release has them
    const other = [["dl-mac-arm64", /mac-arm64\.dmg$/i], ["dl-mac-x64", /mac-x64\.dmg$/i], ["dl-linux", /\.AppImage$/i]];
    for (const [id, re] of other) {
        const asset = r.assets.find((a) => re.test(a.name));
        if (!asset) continue;
        const a = document.getElementById(id);
        a.href = asset.browser_download_url;
        a.title = `${asset.name} · ${size(asset.size)}`;
        a.hidden = false;
        document.getElementById("dl-other").hidden = false;
    }
    const extension = r.assets.find((a) => /^akko-companion.*\.zip$/i.test(a.name));
    if (extension) {
        document.getElementById("dl-extension").href = extension.browser_download_url;
        document.getElementById("dl-extension").textContent = `⬇ ${extension.name}`;
    }
    if (setup) {
        document.getElementById("hero-download").href = setup.browser_download_url;
        document.getElementById("hero-download").textContent = t("@download", { v: version });
        document.getElementById("hero-version").textContent = t("@hero-version", { size: size(setup.size) });
    }
    const line = document.getElementById("release-line");
    line.textContent = "";
    const notes = document.createElement("a");
    notes.href = r.html_url;
    notes.textContent = t("@notes");
    // the sentence around the link, in this language
    const [before, after] = t("@released", { v: version, date: day(r.published_at) }).split("{notes}");
    line.append(before, notes, after || "");
}).catch(() => { /* the links to the releases page stay */ });
