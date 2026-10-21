// The toolbar button's popup: is akko running (and in step with it), is Anki set up, on/off per site,
// and "Use akko on this page" for any other site with a video (content/generic.js).

const $ = (id) => document.getElementById(id);
const ask = (msg) => new Promise((resolve) => chrome.runtime.sendMessage(msg, (r) => resolve(r || {})));
const { t } = akkoLang;          // the interface's language (lang.js); text set later is translated by itself
akkoLang.watch(document.body);

// ---------- any other site: akko on this page's video ----------
function setUpHere(tab) {
    const msg = (text, good = false) => { $("here-msg").hidden = false; $("here-msg").textContent = text; $("here-msg").className = `status ${good ? "good" : "bad"}`; };
    const inject = () => chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ["lang.js", "content/common.js", "content/generic.js"] });
    async function run() {
        let results;
        try { results = await inject(); } catch {
            return msg("akko can't run on this page (Chrome's own pages and the Web Store are off-limits).");
        }
        const found = results.map((r) => r.result).filter(Boolean);
        if (found.some((r) => r.video)) {
            msg("✓ akko is on: drop a subtitle file in the language you learn on the video (another language for the translation).", true);
            setTimeout(() => window.close(), 2500);
            return;
        }
        // the player is in a frame from another address: akko needs to be allowed there
        const frames = [...new Set(found.flatMap((r) => r.frames || []))];
        if (frames.length) {
            const hosts = frames.map((o) => new URL(o).host).join(", ");
            msg(`The video is inside a frame from ${hosts}. akko needs your permission to work there.`);
            const allow = $("allow-frame");
            allow.hidden = false;
            allow.textContent = `Allow akko on ${hosts}`;
            allow.onclick = async () => {
                const ok = await chrome.permissions.request({ origins: frames.map((o) => `${o}/*`) }).catch(() => false);
                if (!ok) return msg("Not allowed: akko can't reach that video.");
                allow.hidden = true;
                run();
            };
            return;
        }
        msg("No video found on this page. Start the video, then try again.");
    }
    $("use-here").addEventListener("click", run);
}

(async () => {
    await ask({ type: "sync" });           // fresh from akko, if it's running
    const s = await chrome.storage.local.get(["prefs", "anki", "words", "wordsEn", "outbox", "akkoUrl", "akkoTarget"]);
    const prefs = s.prefs || {};
    // Japanese, English, both, or what akko is learning now
    const learn = $("learn");
    learn.options[0].textContent = `what akko is learning (${s.akkoTarget === "en" ? "English" : "Japanese"})`;
    learn.value = prefs.learn || "auto";
    learn.addEventListener("change", async () => {
        const now = (await chrome.storage.local.get("prefs")).prefs || {};
        await chrome.storage.local.set({ prefs: { ...now, learn: learn.value } });
    });
    const on = { youtube: true, netflix: true, ...(prefs.on || {}) };
    for (const site of ["youtube", "netflix"]) {
        $(`on-${site}`).checked = on[site];
        $(`on-${site}`).addEventListener("change", async (e) => {
            const now = (await chrome.storage.local.get("prefs")).prefs || {};
            await chrome.storage.local.set({ prefs: { ...now, on: { ...on, ...(now.on || {}), [site]: e.target.checked } } });
        });
    }
    const count = (list) => { const v = Object.values(list || {}); return { all: v.length, known: v.filter((w) => w === "known").length, learning: v.filter((w) => w === "learning").length }; };
    const ja = count(s.words), en = count(s.wordsEn);
    // (each part translated on its own: put together, they'd match no row)
    const lists = [ja.all ? t(`Japanese: ${ja.known} known · ${ja.learning} learning`) : "", en.all ? t(`English: ${en.known} known · ${en.learning} learning`) : ""].filter(Boolean).join(" | ");
    const waiting = (s.outbox || []).length;
    $("words").textContent = !lists ? "no word list yet: open akko on this computer"
        : waiting ? t(`{lists} (from akko) · ${waiting === 1 ? "1 change" : `${waiting} changes`} waiting for akko`).replace("{lists}", lists)
        : t("{lists} (from akko)").replace("{lists}", lists);
    $("anki").textContent = s.anki && s.anki.deck && s.anki.model ? `Anki: ${s.anki.deck} · ${s.anki.model}` : "Anki: not set up yet (see options)";

    // opening this popup on a Netflix tab is what lets the extension record that tab (Chrome's rule)
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => []);
    if (tab && (tab.url || "").startsWith("https://www.netflix.com/watch")) $("netflix").hidden = false;
    const host = (() => { try { return new URL(tab.url).hostname; } catch { return ""; } })();
    if (["www.youtube.com", "youtube.com", "www.netflix.com"].includes(host)) $("here").hidden = true;      // they have their own
    if (tab) setUpHere(tab);

    const r = await ask({ type: "status" });
    const st = r.data || {};
    $("akko").textContent = st.ok ? `✓ akko ${st.version} at ${st.url.replace(/^https?:\/\//, "")}` : "✗ akko isn't running: open akko on this computer";
    $("akko").classList.add(st.ok ? "good" : "bad");
    if (st.ok) {
        $("open-akko").href = st.url;
        $("open-akko").hidden = false;
        // akko's Report a problem form, saying it's about the extension, which version, on which site
        const q = new URLSearchParams({ report: "extension", ext: chrome.runtime.getManifest().version, site: host || "" });
        $("report").href = `${st.url}/settings.html?${q}#help-section`;
        $("report-wrap").hidden = false;
    }
})();
