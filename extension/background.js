// akko companion: the background worker. Pages can't talk to akko (it's on http://127.0.0.1, they're
// on https, and akko only lets this extension in), so every request goes through here:
//   {type: "akko", path, method?, body?}  -> akko's API (the dictionary, word splitting, Anki relay…)
//   {type: "status"}                      -> {ok, url, version} : is akko running, and where
//   {type: "text", url}                   -> a subtitle file from Netflix's servers, as text
//   {type: "log", entries}                -> for akko: word statuses, mined words, time watched
//   {type: "sync"}                        -> send those to akko, and copy akko's word lists (words:
//                                            Japanese, wordsEn: English), Anki settings, your language
//                                            (native), what akko is learning (akkoTarget) and akko's
//                                            interface language (akkoUi) here
//   {type: "tabAudioStart"} / {type: "tabAudioStop"} -> {data, ext}: the tab's sound (offscreen.js),
//   {type: "tabShot"} -> {data}: a picture of the tab; for Netflix, whose video can't be recorded directly
// Keeping in step with akko goes through akko's server (server/companion.js), so it works with
// akko's desktop app too. What's waiting to go: "outbox" in chrome.storage.local (it survives
// akko being closed, and goes when akko is back).
// akko is found by asking "/api/hello" at the address that worked last, then the usual ones
// (the desktop app's 3417, `npm start`'s 3000); Options can set it by hand.

const PLACES = ["http://127.0.0.1:3417", "http://127.0.0.1:3000", "http://localhost:3417", "http://localhost:3000"];
let found = null;           // {url, version}, once akko answered

async function hello(url) {
    try {
        const r = await fetch(`${url}/api/hello`, { signal: AbortSignal.timeout(1500) });
        const j = await r.json();
        return j.app === "akko" ? { url, version: j.version } : null;
    } catch { return null; }
}

async function findAkko(fresh = false) {
    if (found && !fresh) return found;
    const { akkoUrl } = await chrome.storage.local.get("akkoUrl");
    for (const url of [akkoUrl, ...PLACES].filter(Boolean)) {
        const h = await hello(url.replace(/\/+$/, ""));
        if (h) {
            found = h;
            if (h.url !== akkoUrl) chrome.storage.local.set({ akkoUrl: h.url });
            return h;
        }
    }
    found = null;
    return null;
}

async function akko({ path, method = "GET", body }) {
    let a = await findAkko();
    if (!a) throw new Error("akko isn't running: open akko on this computer, then try again");
    const go = () => fetch(a.url + path, {
        method,
        headers: body !== undefined ? { "Content-Type": "application/json" } : {},
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    let r;
    try { r = await go(); } catch {
        // it moved or was restarted: look again once
        a = await findAkko(true);
        if (!a) throw new Error("akko isn't running: open akko on this computer, then try again");
        r = await go();
    }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `akko answered ${r.status}`);
    return data;
}

// ---------- keeping in step with akko ----------

// one at a time: two tabs syncing at once mustn't send the same entries twice
let chain = Promise.resolve();
const serial = (fn) => { const run = chain.then(fn, fn); chain = run.catch(() => {}); return run; };

const LANGS = { cmn: "zh-Hans" };          // akko's language codes -> YouTube's

function addToOutbox(entries) {
    return serial(async () => {
        const { outbox = [] } = await chrome.storage.local.get("outbox");
        // time is added up per video and day, so a long film is one entry, not hundreds
        for (const e of entries) {
            const same = e.kind === "time" && outbox.find((o) => o.kind === "time" && o.key === e.key && o.day === e.day && o.seconds + e.seconds <= 3600);
            if (same) Object.assign(same, { seconds: same.seconds + e.seconds, title: e.title || same.title });
            else outbox.push(e);
        }
        await chrome.storage.local.set({ outbox: outbox.slice(-2000) });
    });
}

let lastSync = 0;
function sync() {
    return serial(async () => {
        const { outbox = [] } = await chrome.storage.local.get("outbox");
        if (outbox.length) {
            await akko({ path: "/api/companion/log", method: "POST", body: { entries: outbox } });
            // only what was sent: more may have been added meanwhile (not while this runs, but to be safe)
            const now = (await chrome.storage.local.get("outbox")).outbox || [];
            await chrome.storage.local.set({ outbox: now.slice(outbox.length) });
        }
        const app = await akko({ path: "/api/companion?from=extension" });
        const store = await chrome.storage.local.get(["anki", "prefs", "outbox"]);
        const lists = { ja: { ...(app.words || {}) }, en: { ...(app.wordsEn || {}) } };
        // what's still waiting to go to akko wins
        for (const e of store.outbox || []) {
            if (e.kind !== "status") continue;
            const words = lists[e.lang === "en" ? "en" : "ja"];
            if (e.status === "new") delete words[e.lemma]; else words[e.lemma] = e.status;
        }
        // (no list until an akko page has been open once: keep what's here)
        const out = app.at ? { words: lists.ja, wordsEn: lists.en, synced: Date.now() } : { synced: Date.now() };
        out.akkoTarget = app.target === "en" ? "en" : "ja";
        out.akkoUi = app.ui || "";
        out.native = app.native || "";
        const a = app.anki;
        if (a && a.deck && a.model) {
            out.anki = { ...(store.anki || {}), deck: a.deck, model: a.model, maps: { ...((store.anki || {}).maps || {}), ...(a.maps || {}) },
                tags: a.tags ?? "akko immersion", audio: a.audio !== false, wordAudio: a.wordAudio !== false, shot: a.shot !== false };
        }
        const prefs = store.prefs || {};
        if (app.native && !prefs.translateToSet) out.prefs = { ...prefs, translateTo: LANGS[app.native] || app.native };
        await chrome.storage.local.set(out);
        lastSync = Date.now();
        return { words: Object.keys(lists.ja).length + Object.keys(lists.en).length };
    });
}

// ---------- recording the tab (Netflix) ----------

async function offscreen(msg) {
    if (!(await chrome.offscreen.hasDocument())) {
        await chrome.offscreen.createDocument({ url: "offscreen.html", reasons: ["USER_MEDIA"], justification: "record the line's audio for Anki cards on Netflix" });
    }
    const r = await chrome.runtime.sendMessage({ target: "offscreen", ...msg });
    if (!r) throw new Error("the recorder didn't answer");
    if (r.error) throw new Error(r.error);
    return r.data;
}

const handlers = {
    akko,
    async tabAudioStart(msg, sender) {
        const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: sender.tab.id });
        return offscreen({ type: "rec-start", streamId });
    },
    tabAudioStop: () => offscreen({ type: "rec-stop" }),
    async tabShot(msg, sender) {
        return { data: await chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: "jpeg", quality: 92 }) };
    },
    async status() {
        const a = await findAkko(true);
        return a ? { ok: true, url: a.url, version: a.version } : { ok: false };
    },
    async log({ entries }) {
        await addToOutbox(Array.isArray(entries) ? entries : []);
        // statuses and mined words go soon; time can wait for the next sync
        if (entries.some((e) => e.kind !== "time")) sync().catch(() => {});
        return { ok: true };
    },
    async sync({ ifOlderThan = 0 } = {}) {
        if (Date.now() - lastSync < ifOlderThan) return { skipped: true };
        return sync();
    },
    async text({ url }) {
        if (!/^https?:\/\/[^/]*\.nflxvideo\.net\//.test(url)) throw new Error("not a subtitle file");
        const r = await fetch(url);
        if (!r.ok) throw new Error(`the subtitle file answered ${r.status}`);
        return { text: await r.text() };
    },
};

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
    const h = handlers[msg && msg.type];
    if (!h || msg.target === "offscreen") return false;
    h(msg, sender).then((data) => reply({ data }), (err) => reply({ error: err.message || String(err) }));
    return true;        // the reply comes later
});
