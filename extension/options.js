// Options: akko's address, the word list (or importing it from a backup), Anki, the translation.

const $ = (id) => document.getElementById(id);
const ask = (msg) => new Promise((resolve, reject) => chrome.runtime.sendMessage(msg, (r) => {
    if (!r) return reject(new Error("no answer"));
    if (r.error) reject(new Error(r.error)); else resolve(r.data);
}));
const anki = (action, params = {}) => ask({ type: "akko", path: "/api/anki", method: "POST", body: { action, version: 6, params } })
    .then((r) => { if (r.error) throw new Error(r.error); return r.result; });
const SOURCES = { "": "(leave empty)", word: "word", reading: "reading", furigana: "word[reading]", meaning: "meaning", pitch: "pitch accent (drawn)",
    pitchNotes: "pitch accent (text)", sentence: "sentence", sentenceBold: "sentence, word in bold", translation: "sentence translation",
    audio: "line audio", wordAudio: "word audio", screenshot: "screenshot", source: "video and time (link)" };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const get = () => chrome.storage.local.get(["akkoUrl", "words", "anki", "prefs"]);
// the interface's language (lang.js): text set later is translated by itself
akkoLang.watch(document.body);
akkoLang.ready.then(() => { document.title = akkoLang.t(document.title); });
const say = (text, bad = false) => { $("msg").textContent = text; $("msg").className = `status ${bad ? "bad" : "good"}`; };

async function showAkko() {
    try {
        const s = await ask({ type: "status" });
        $("akko-status").textContent = s.ok ? `✓ akko ${s.version} at ${s.url}` : "✗ akko isn't running: open akko on this computer";
        $("akko-status").className = `status ${s.ok ? "good" : "bad"}`;
        if (s.ok) $("akko-url").value = s.url;
    } catch (err) { $("akko-status").textContent = err.message; }
}

async function showWords() {
    const { words = {} } = await get();
    const v = Object.values(words);
    $("words-status").textContent = v.length
        ? `${v.filter((w) => w === "known").length} known · ${v.filter((w) => w === "learning").length} learning · ${v.filter((w) => w === "ignored").length} ignored`
        : "no word list yet";
}

async function showAnki() {
    const { anki: a } = await get();
    $("anki-status").textContent = a && a.deck && a.model ? `deck ${a.deck} · note type ${a.model}` : "not set up yet";
}

async function loadAnki() {
    try {
        const [decks, models] = await Promise.all([anki("deckNames"), anki("modelNames")]);
        const { anki: a = {} } = await get();
        $("deck").innerHTML = decks.map((d) => `<option${d === a.deck ? " selected" : ""}>${esc(d)}</option>`).join("");
        $("model").innerHTML = models.map((m) => `<option${m === a.model ? " selected" : ""}>${esc(m)}</option>`).join("");
        $("tags").value = a.tags ?? "akko immersion";
        $("audio").checked = a.audio !== false;
        $("wordaudio").checked = a.wordAudio !== false;
        $("shot").checked = a.shot !== false;
        $("anki-form").hidden = false;
        await saveAnki();
        await showFields();
    } catch (err) { say("couldn't reach Anki through akko: " + err.message, true); }
}

async function showFields() {
    const { anki: a = {} } = await get();
    const model = $("model").value;
    const names = await anki("modelFieldNames", { modelName: model });
    const map = (a.maps || {})[model] || {};
    $("fields").innerHTML = `<tr><th>Anki field</th><th>what goes in it</th></tr>` + names.map((f) => `<tr><td>${esc(f)}</td><td><select data-field="${esc(f)}">${
        Object.entries(SOURCES).map(([k, label]) => `<option value="${k}"${(map[f] ?? "") === k ? " selected" : ""}>${label}</option>`).join("")}</select></td></tr>`).join("");
}

async function saveAnki() {
    const { anki: a = {} } = await get();
    const model = $("model").value;
    const map = { ...((a.maps || {})[model] || {}) };
    document.querySelectorAll("#fields select").forEach((s) => { map[s.dataset.field] = s.value; });
    await chrome.storage.local.set({ anki: { ...a, deck: $("deck").value, model, tags: $("tags").value,
        audio: $("audio").checked, wordAudio: $("wordaudio").checked, shot: $("shot").checked, maps: { ...(a.maps || {}), [model]: map } } });
    showAnki();
}

$("akko-find").addEventListener("click", async () => {
    const url = $("akko-url").value.trim().replace(/\/+$/, "");
    await chrome.storage.local.set({ akkoUrl: url });
    showAkko();
});
$("anki-load").addEventListener("click", loadAnki);
$("model").addEventListener("change", async () => { await saveAnki(); await showFields(); });
for (const id of ["deck", "tags", "audio", "wordaudio", "shot"]) $(id).addEventListener("change", saveAnki);
$("fields").addEventListener("change", saveAnki);

$("backup").addEventListener("change", async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
        const file = JSON.parse(await f.text());
        if (file.app !== "akko-immersion" || !file.data) throw new Error("that isn't an akko backup file");
        const words = JSON.parse(file.data["akko-words"] || "{}");
        const wordsEn = JSON.parse(file.data["akko-words-en"] || "{}");
        await chrome.storage.local.set({ words, wordsEn });
        say(`imported ${Object.keys(words).length + Object.keys(wordsEn).length} words ✓`);
        showWords();
    } catch (err) { say(err.message, true); }
});

(async () => {
    const { prefs = {} } = await get();
    $("translate").value = prefs.translateTo || "en";
    $("translate").addEventListener("change", async (e) => {
        const now = (await get()).prefs || {};
        await chrome.storage.local.set({ prefs: { ...now, translateTo: e.target.value, translateToSet: true } });
        say("saved ✓");
    });
    showAkko();
    showWords();
    showAnki();
})();
