// The toolbar button's popup: is akko running (and in step with it), is Anki set up, on/off per site.

const $ = (id) => document.getElementById(id);
const ask = (msg) => new Promise((resolve) => chrome.runtime.sendMessage(msg, (r) => resolve(r || {})));

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

    const r = await ask({ type: "status" });
    const st = r.data || {};
    $("akko").textContent = st.ok ? `✓ akko ${st.version} at ${st.url.replace(/^https?:\/\//, "")}` : "✗ akko isn't running: open akko on this computer";
    $("akko").classList.add(st.ok ? "good" : "bad");
    if (st.ok) { $("open-akko").href = st.url; $("open-akko").hidden = false; }
})();
