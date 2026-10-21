// Everything in step: this page's copy of what akko saves, kept in step with akko's server
// (server/sync.js), which shares it with akko's other windows, other browsers and phones. The word
// list has its own (scripts/core/words-sync.js). Runs on every page (scripts/site.js): soon after
// something is saved, every 8 seconds while the page is in front (every minute behind), and when
// it comes back to the front.
//
// What's shared, as collections of records:
//   - maps in localStorage, one record per entry: positions in videos / books / podcasts, 復習's
//     cards, grammar and the course, the listening drills, saved podcasts, idioms met…
//   - single values: Anki's settings, 復習's count of new words today, and the settings worth
//     sharing (your language, the interface's, how words are shown; not the theme or the
//     language you're learning, which can differ per device)
//   - IndexedDB: mined words (and their recordings), the library's texts (sent once: they don't
//     change; where you are in them is a map above)
//   - time: each device keeps its own days ("akko-days"), shared as a record of its own; the
//     others' come back into "akko-days-others", and scripts/core/today.js adds them up
// Nothing here has to change for it: what changed is found by comparing each record with a short
// fingerprint of how it was at the last sync. The last change wins, per record; deleting reaches
// the others. The first time, the server's records win over this page's (this page's new ones are
// added); after a backup is restored, the backup's win.
// Where it got to: "akko-sync" {id, since: {collection: v}, shadow: {collection: {key: [fingerprint, updated]}}}.

import { store } from "./utils.js";
import { idbAll, idbKeys, idbGet, idbPutMany, idbDelete } from "./idb.js";
import { keepMedia, mediaOf } from "./media.js";

const STATE = "akko-sync";
const DEVICE = "akko-device";
export const OTHERS = { ja: "akko-days-others", en: "akko-days-others-en" };
const FRONT = 8e3, BEHIND = 60e3;
const LAZY_PER_ROUND = 3;          // books sent in one round

// where the sync got to: written without "akko-saved" (that event starts a sync)
function saveState(value) {
    try { localStorage.setItem(STATE, JSON.stringify(value)); } catch { /* storage full: next time */ }
}

export function device() {
    let d = store.get(DEVICE, "");
    if (!d) { d = `d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`; store.set(DEVICE, d); }
    return d;
}

// a short fingerprint of a value (FNV-1a over its JSON, and its length)
function print(v) {
    const s = JSON.stringify(v ?? null);
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return `${(h >>> 0).toString(36)}.${s.length.toString(36)}`;
}

// ---------- what each collection is on this page ----------
// read() -> {key: value}; write(changes) applies [{k, value, deleted}]; lazy: read() gives
// placeholders (never changing) and load(k) the real value, for big records sent once (a few a
// round); owns(k): the records this page has itself (the others' only come in).

const isMap = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const mapOf = (name, key) => ({
    name,
    read: async () => { const v = store.get(key, {}); return isMap(v) ? v : {}; },
    write: async (list) => {
        const m = store.get(key, {});
        const map = isMap(m) ? m : {};
        for (const c of list) { if (c.deleted) delete map[c.k]; else map[c.k] = c.value; }
        store.set(key, map);
    },
});
const wholeOf = (name, key, pick = (v) => v, merge = (local, v) => v) => ({
    name,
    read: async () => { const v = store.get(key, null); return v === null ? {} : { value: pick(v) }; },
    write: async (list) => {
        for (const c of list) {
            if (c.deleted) store.remove(key);
            else store.set(key, merge(store.get(key, null), c.value));
        }
    },
});

// the settings worth having on every device (the theme and the language learnt stay per device)
const SHARED_SETTINGS = ["native", "lang", "furigana", "colors", "grammar", "expressions"];
const pickSettings = (s) => Object.fromEntries(SHARED_SETTINGS.filter((k) => s && k in s).map((k) => [k, s[k]]));

// time: this device's days as a record of its own; the others' kept apart and added up
const daysOf = (lang) => {
    const own = lang === "en" ? "akko-days-en" : "akko-days";
    return {
        name: lang === "en" ? "days-en" : "days",
        owns: (k) => k === device(),
        read: async () => ({ [device()]: store.get(own, {}) }),
        write: async (list) => {
            const others = store.get(OTHERS[lang], {});
            for (const c of list) {
                if (c.k === device()) continue;            // this device's own: it has it
                if (c.deleted) delete others[c.k]; else others[c.k] = c.value;
            }
            store.set(OTHERS[lang], others);
        },
    };
};

const mined = {
    name: "mined",
    read: async () => Object.fromEntries((await idbAll("mined").catch(() => [])).map((m) => [m.id, m])),
    write: async (list) => {
        const put = list.filter((c) => !c.deleted).map((c) => c.value);
        if (put.length) await idbPutMany("mined", put);
        for (const c of list.filter((x) => x.deleted)) { await idbDelete("mined", c.k).catch(() => {}); await idbDelete("media", c.k).catch(() => {}); }
        if ("BroadcastChannel" in window) new BroadcastChannel("akko-mined").postMessage("changed");
    },
};

const texts = {
    name: "texts",
    lazy: true,
    read: async () => Object.fromEntries((await idbKeys("texts").catch(() => [])).map((k) => [k, 1])),
    load: (k) => idbGet("texts", k),
    write: async (list) => {
        const put = list.filter((c) => !c.deleted && c.value).map((c) => c.value);
        if (put.length) await idbPutMany("texts", put);
        for (const c of list.filter((x) => x.deleted)) await idbDelete("texts", c.k).catch(() => {});
    },
};

const ADAPTERS = [
    ...[["progress", "akko-progress"], ["progress-en", "akko-progress-en"], ["reading", "akko-reading"],
        ["review", "akko-review"], ["review-en", "akko-review-en"],
        ["grammar", "akko-grammar"], ["grammar-en", "akko-grammar-en"], ["course", "akko-course"], ["course-en", "akko-course-en"],
        ["listening", "akko-listening"], ["listening-mistakes", "akko-listening-mistakes"],
        ["podcasts", "akko-podcasts"], ["podcasts-en", "akko-podcasts-en"],
        ["podcast-progress", "akko-podcast-progress"], ["podcast-progress-en", "akko-podcast-progress-en"],
        ["expressions", "akko-expressions"], ["expressions-en", "akko-expressions-en"],
        ["manga", "akko-manga"], ["companion-watched", "akko-companion-watched"]].map(([n, k]) => mapOf(n, k)),
    wholeOf("anki", "akko-anki"),
    wholeOf("review-new", "akko-review-new"),
    wholeOf("review-new-en", "akko-review-new-en"),
    wholeOf("settings", "akko-settings", pickSettings, (local, v) => ({ ...(local || {}), ...pickSettings(v) })),
    daysOf("ja"), daysOf("en"),
    mined, texts,
];

// ---------- one round ----------

let rounds = 0;
async function round() {
    const state = store.get(STATE, null) || {};
    state.since = state.since || {};
    state.shadow = state.shadow || {};
    const body = { id: state.id || "", collections: {} };
    const read = {};
    const now = Date.now();
    for (const a of ADAPTERS) {
        const current = await a.read();
        read[a.name] = current;
        const shadow = state.shadow[a.name] || {};
        const first = !(a.name in state.since);
        const changes = [];
        let lazy = 0;
        for (const [k, v] of Object.entries(current)) {
            const p = a.lazy ? "x" : print(v);
            if (shadow[k] && shadow[k][0] === p) continue;
            if (a.lazy && lazy++ >= LAZY_PER_ROUND) continue;              // the rest next round
            // the first time, this page's records lose to the server's (unless a backup was restored)
            const own = isMap(v) && Number.isFinite(v.updated) ? v.updated : 1;
            const updated = state.restored ? now : first ? own : Math.max(now, (shadow[k] && shadow[k][1] + 1) || 0);
            changes.push({ k, value: a.lazy ? await a.load(k) : v, updated });
        }
        for (const k of Object.keys(shadow)) if (!(k in current)) changes.push({ k, deleted: true, updated: Math.max(now, shadow[k][1] + 1) });
        body.collections[a.name] = { since: state.since[a.name] || 0, changes };
    }
    // the recordings: now and then, and when mined words changed
    const askMedia = rounds++ % 6 === 0 || body.collections.mined.changes.length > 0;
    if (askMedia) body.media = true;

    const res = await fetch("/api/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) return;
    const r = await res.json();
    // another server (a new data folder): start again from nothing, next round
    if (state.id && r.id !== state.id) { saveState({ restored: state.restored }); return; }

    const next = { id: r.id, since: { ...state.since }, shadow: { ...state.shadow } };
    for (const a of ADAPTERS) {
        const got = r.collections[a.name];
        if (!got) continue;
        const shadow = { ...(state.shadow[a.name] || {}) };
        // what was sent is how it is now
        for (const c of body.collections[a.name].changes) {
            if (c.deleted) delete shadow[c.k]; else shadow[c.k] = [a.lazy ? "x" : print(c.value), c.updated];
        }
        // what changed elsewhere (or won over this page's): unless it changed here meanwhile
        const apply = [];
        const meanwhile = got.changes.length ? await a.read() : {};
        for (const c of got.changes) {
            if (a.owns && !a.owns(c.k)) { apply.push(c); continue; }          // another device's: only kept
            const before = read[a.name][c.k], nowHere = meanwhile[c.k];
            if (!a.lazy && print(before) !== print(nowHere)) continue;           // changed during the round: next time
            const p = c.deleted ? null : a.lazy ? "x" : print(c.value);
            const local = a.lazy ? (c.k in meanwhile ? "x" : null) : (c.k in meanwhile ? print(nowHere) : null);
            if (p !== local) apply.push(c);
            if (c.deleted) delete shadow[c.k]; else shadow[c.k] = [p, c.updated];
        }
        if (apply.length) await a.write(apply);
        next.shadow[a.name] = shadow;
        next.since[a.name] = got.v;
    }
    saveState(next);
    // (the mined words as they are now: some may have just come in)
    if (r.media) await recordings(new Set(r.media), await mined.read()).catch(() => {});
}

// the mined words' line audio and picture: up to 10 each way per round
async function recordings(there, minedHere) {
    const here = new Set(await idbKeys("media").catch(() => []));
    let n = 0;
    for (const id of here) {
        if (there.has(id) || !minedHere[id] || n >= 10) continue;
        const m = await mediaOf(id);
        for (const kind of ["audio", "picture"]) {
            if (m && m[kind]) await fetch(`/api/sync/media/${encodeURIComponent(id)}/${kind}`, { method: "PUT", headers: { "Content-Type": m[kind].type || "application/octet-stream" }, body: m[kind] });
        }
        n++;
    }
    n = 0;
    for (const id of there) {
        if (here.has(id) || !minedHere[id] || n >= 10) continue;
        const got = {};
        for (const kind of ["audio", "picture"]) {
            const r = await fetch(`/api/sync/media/${encodeURIComponent(id)}/${kind}`).catch(() => null);
            if (r && r.ok) got[kind] = await r.blob();
        }
        await keepMedia(id, got);
        n++;
    }
}

let running = null;
export function sync() {
    if (running) return running;
    running = (async () => {
        try {
            // one tab of this browser at a time
            if (navigator.locks) await navigator.locks.request("akko-sync", round); else await round();
        } catch { /* the server is restarting: next time */ }
        finally { running = null; }
    })();
    return running;
}

// After a backup is restored: its records win on the next sync
export function restored() { saveState({ restored: true }); }

export function start() {
    if (typeof document === "undefined") return;
    device();
    setTimeout(sync, 1500);
    let soon = null;
    window.addEventListener("akko-saved", () => { clearTimeout(soon); soon = setTimeout(sync, 3000); });
    const tick = () => { setTimeout(async () => { await sync(); tick(); }, document.visibilityState === "visible" ? FRONT : BEHIND); };
    tick();
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") sync(); });
}
