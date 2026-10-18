// The toolbar button's popup: is akko running (and in step with it), is Anki set up, on/off per site,
// and "Use akko on this page" for any other site with a video (content/generic.js).

const $ = (id) => document.getElementById(id);
const ask = (msg) => new Promise((resolve) => chrome.runtime.sendMessage(msg, (r) => resolve(r || {})));

// ---------- any other site: akko on this page's video ----------
function setUpHere(tab) {
    const msg = (text, good = false) => { $("here-msg").hidden = false; $("here-msg").textContent = text; $("here-msg").className = `status ${good ? "good" : "bad"}`; };
    const inject = () => chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ["content/common.js", "content/generic.js"] });
    async function run() {
        let results;
        try { results = await inject(); } catch {
            return msg("akko can't run on this page (Chrome's own pages and the Web Store are off-limits).");
        }
        const found = results.map((r) => r.result).filter(Boolean);
        if (found.some((r) => r.video)) {
            msg("✓ akko is on: drop a Japanese subtitle file on the video (another language for the translation).", true);
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
    const s = await chrome.storage.local.get(["prefs", "anki", "words", "outbox", "akkoUrl"]);
    const prefs = s.prefs || {};
    const on = { youtube: true, netflix: true, ...(prefs.on || {}) };
    for (const site of ["youtube", "netflix"]) {
        $(`on-${site}`).checked = on[site];
        $(`on-${site}`).addEventListener("change", async (e) => {
            const now = (await chrome.storage.local.get("prefs")).prefs || {};
            await chrome.storage.local.set({ prefs: { ...now, on: { ...on, ...(now.on || {}), [site]: e.target.checked } } });
        });
    }
    const words = Object.values(s.words || {});
    $("words").textContent = words.length
        ? `${words.filter((w) => w === "known").length} known · ${words.filter((w) => w === "learning").length} learning words (from akko)`
        : "no word list yet: open akko on this computer";
    const waiting = (s.outbox || []).length;
    if (waiting) $("words").textContent += ` · ${waiting} change${waiting > 1 ? "s" : ""} waiting for akko`;
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
    if (st.ok) { $("open-akko").href = st.url; $("open-akko").hidden = false; }
})();
