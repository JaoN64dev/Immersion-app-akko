// Small helpers used all over the place.

import { toast } from "./toast.js";

// A save that fails (storage full, private window…) must never go unnoticed.
// Warns at most once a minute so a burst of failures isn't a burst of messages.
let lastWarning = 0;
export function warnSaveFailed(err) {
    console.error("save failed", err);
    if (Date.now() - lastWarning < 60e3) return;
    lastWarning = Date.now();
    toast("couldn't save your changes: this browser's storage for the site is full or blocked. download a backup (Settings → Backup) so nothing is lost.", true);
}

// localStorage as JSON. Every write fires "akko-saved" (the backup summary listens for it).
// Returns false (and warns) if the write failed.
export const store = {
    get(key, fallback) {
        try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
    },
    set(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
        } catch (err) {
            warnSaveFailed(err);
            return false;
        }
        window.dispatchEvent(new Event("akko-saved"));
        return true;
    },
    remove(key) {
        try { localStorage.removeItem(key); } catch { /* storage off */ }
    },
};

export const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export const timeFormatter = (t) => {
    if (!isFinite(t)) return "00:00";
    const m = Math.floor(t / 60), s = Math.floor(t % 60);
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
};

export async function getJson(url, opts) {
    const res = await fetch(url, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `request failed (${res.status})`);
    return data;
}

export const postJson = (url, body) => getJson(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
});

// Hand the browser a file to save
export function download(filename, content, type) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([content], { type }));
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
}

export function loadScript(src) {
    return new Promise((resolve, reject) => {
        if (document.querySelector(`script[src="${src}"]`)) return resolve();
        const s = document.createElement("script");
        s.src = src;
        s.onload = resolve;
        s.onerror = () => reject(new Error("couldn't load " + src));
        document.head.appendChild(s);
    });
}

// Pull an episode number out of a file name ("[Group] Show - 03 [1080p].mkv" -> 3)
export function episodeOf(name) {
    const clean = name
        .replace(/\[[^\]]*\]|\([^)]*\)/g, " ")        // [group] (1080p)
        .replace(/\b(19|20)\d{2}\b/g, " ")             // years
        .replace(/\b\d{3,4}p\b|\bx26[45]\b|\bs\d+\b/gi, " ")
        .replace(/\.[a-z0-9]+$/i, "");
    // an explicit marker wins ("E02", "Episode 5", "第12話"); otherwise the episode
    // is usually the last number in the name ("3-gatsu no Lion - 18")
    const marked = clean.match(/(?:^|[^a-z])e0*(\d{1,3})(?!\d)|(?:\bep\.?|episode|第|#)\s*0*(\d{1,3})(?!\d)/i);
    if (marked) return Number(marked[1] || marked[2]);
    const all = [...clean.matchAll(/(?:-|_|\s)\s*0*(\d{1,3})(?:v\d)?(?!\d)/g)];
    const m = all.pop() || clean.match(/0*(\d{1,3})(?!\d)/);
    return m ? Number(m[1]) : null;
}
