// IndexedDB for things too big for localStorage (~5 MB per site): the reading library and
// mined words. Stores: "texts", "mined" and "media" (all keyPath "id"). "media" holds a mined
// word's line audio and picture as Blobs ({id: <the mined word's id>, audio, picture}); it's left
// out of backups (a backup is text; these are recordings).
// Every write fires "akko-saved" (like store.set) and warns if it fails.

import { warnSaveFailed } from "./utils.js";

const DB = "akko";
const VERSION = 3;               // 2 added "mined", 3 "media"
const STORES = ["texts", "mined", "media"];
let opening = null;

function open() {
    if (!opening) {
        opening = new Promise((resolve, reject) => {
            const req = indexedDB.open(DB, VERSION);
            req.onupgradeneeded = () => {
                for (const s of STORES) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s, { keyPath: "id" });
            };
            req.onsuccess = () => {
                // a newer akko (another tab) needs to change the stores: let go, and reopen next time
                req.result.onversionchange = () => { req.result.close(); opening = null; };
                resolve(req.result);
            };
            req.onerror = () => reject(req.error);
            req.onblocked = () => reject(new Error("close the site's other tabs, then reload"));
        });
    }
    return opening;
}

async function run(store, mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(store, mode);
        const req = fn(tx.objectStore(store));
        tx.oncomplete = () => resolve(req && req.result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error("write aborted"));
    });
}

async function write(store, fn) {
    try {
        const result = await run(store, "readwrite", fn);
        window.dispatchEvent(new Event("akko-saved"));
        return result;
    } catch (err) {
        warnSaveFailed(err);
        throw err;
    }
}

export const idbGet = (store, id) => run(store, "readonly", (s) => s.get(id));
export const idbAll = (store) => run(store, "readonly", (s) => s.getAll());
export const idbCount = (store) => run(store, "readonly", (s) => s.count());
export const idbPut = (store, value) => write(store, (s) => s.put(value));
export const idbPutMany = (store, values) => write(store, (s) => { values.forEach((v) => s.put(v)); });
export const idbDelete = (store, id) => write(store, (s) => s.delete(id));

// Replace a whole store (backup restore, "clear all")
export const idbReplace = (store, values) => write(store, (s) => {
    s.clear();
    values.forEach((v) => s.put(v));
});

export const IDB_STORES = ["texts", "mined"];       // the ones backups carry
