// akko companion on any other site (Crunchyroll, Disney+, a course site…): started from the
// toolbar popup ("Use akko on this page"), which injects content/common.js and this file. It finds
// the page's video and asks for a subtitle file (dropped on the video, or picked): a Japanese one
// becomes akko's clickable subtitles, another language the translation. The line's audio and the
// picture for cards come from the tab (the popup click allows that), so copy-protected video works.
// Answers the popup with what it found: {video: true} or {video: false, frames: [origins of big iframes]}
// (the player may be inside one: the popup then asks to be allowed there too).

(() => {
    const A = window.akkoCompanion;
    if (!A) return { video: false, frames: [] };
    if (/(^|\.)youtube\.com$|(^|\.)netflix\.com$/.test(location.hostname)) return { video: false, frames: [], own: true };

    // the biggest video on the page that's showing
    const bestVideo = () => [...document.querySelectorAll("video")]
        .map((v) => ({ v, area: v.getBoundingClientRect().width * v.getBoundingClientRect().height }))
        .filter((x) => x.area > 120 * 80)
        .sort((a, b) => b.area - a.area)[0]?.v || null;

    const found = bestVideo();
    if (!found) {
        const frames = [...document.querySelectorAll("iframe")]
            .filter((f) => { const r = f.getBoundingClientRect(); return r.width * r.height > 200 * 120 && f.src; })
            .map((f) => { try { return new URL(f.src, location.href).origin; } catch { return null; } })
            .filter((o) => o && o !== location.origin && /^https?:/.test(o));
        return { video: false, frames: [...new Set(frames)] };
    }
    if (window.akkoGeneric) { window.akkoGeneric.show(); return { video: true }; }

    // ---------- subtitle files ----------
    const seconds = (t) => t.replace(",", ".").split(":").reverse().reduce((sum, part, i) => sum + parseFloat(part) * 60 ** i, 0);
    const clean = (s) => s.replace(/<[^>]+>/g, "").replace(/\{[^}]*\}/g, "").replace(/\\N/gi, "\n").replace(/&lrm;|&rlm;|‎|‏/g, "")
        .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").trim();

    function parseSrtVtt(text) {
        const cues = [];
        for (const block of text.replace(/\r/g, "").split(/\n\n+/)) {
            const lines = block.split("\n");
            const at = lines.findIndex((l) => l.includes("-->"));
            if (at < 0) continue;
            const [a, b] = lines[at].split("-->").map((s) => s.trim().split(/\s+/)[0]);
            const line = clean(lines.slice(at + 1).join("\n"));
            if (line) cues.push({ start: seconds(a), end: seconds(b), text: line });
        }
        return cues;
    }

    // .ass / .ssa: the [Events] Dialogue lines (signs and karaoke effects are left as text)
    function parseAss(text) {
        const cues = [];
        let format = null;
        for (const raw of text.replace(/\r/g, "").split("\n")) {
            if (/^Format:/i.test(raw) && !format) { format = raw.slice(7).split(",").map((s) => s.trim().toLowerCase()); continue; }
            if (!/^Dialogue:/i.test(raw)) continue;
            const f = format || ["layer", "start", "end", "style", "name", "marginl", "marginr", "marginv", "effect", "text"];
            const parts = raw.slice(9).split(",");
            const row = {};
            f.forEach((k, i) => { row[k] = i === f.length - 1 ? parts.slice(i).join(",") : parts[i]; });
            const line = clean(row.text || "");
            if (line) cues.push({ start: seconds(row.start.trim()), end: seconds(row.end.trim()), text: line });
        }
        return cues;
    }

    const parse = (name, text) => (/\.(ass|ssa)$/i.test(name) || /^\[Script Info\]/m.test(text) ? parseAss(text) : parseSrtVtt(text))
        .sort((x, y) => x.start - y.start);
    const japanese = (cues) => {
        const sample = cues.slice(0, 80).map((c) => c.text).join("");
        return (sample.match(/[぀-ヿ一-鿿]/g) || []).length > sample.length * 0.3;
    };

    // ---------- the overlay ----------
    let video = found;
    const container = video.parentElement;
    if (getComputedStyle(container).position === "static") container.style.position = "relative";
    const files = [];                 // [{id, label, cues, ja}]
    let mainId = "", trId = "";

    const site = {
        name: location.hostname.replace(/^www\./, ""),
        video: () => (video && video.isConnected ? video : (video = bestVideo())),
        recordable: "tab",            // the tab's sound and picture: works with copy-protected video too
        screenshot: "tab",
        title: () => document.title.trim() || location.hostname,
        url: () => location.href,
        onTrack: (id) => useMain(id),
        onTranslation: (id) => useTranslation(id),
    };
    const ov = A.overlay(container, site);

    // where to drop or pick a file, until one is loaded
    const box = document.createElement("div");
    box.setAttribute("data-akko-drop", "");
    box.style.cssText = "position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);z-index:61;background:#1f2027ee;color:#eee;"
        + "padding:14px 18px;border-radius:12px;font:14px/1.5 system-ui,sans-serif;text-align:center;max-width:80%;box-shadow:0 4px 18px #0008;";
    box.innerHTML = `<b>akko</b>: drop a subtitle file on the video (.srt, .vtt, .ass)<br>
        Japanese for akko's subtitles; another language for the translation<br>
        <label style="display:inline-block;margin-top:8px;padding:4px 12px;border:1px solid #ffffff55;border-radius:8px;cursor:pointer">choose a file…
        <input type="file" accept=".srt,.vtt,.ass,.ssa,.txt" multiple style="display:none"></label>
        <button type="button" style="margin-left:6px;font:inherit;background:none;border:0;color:#aaa;cursor:pointer">✕</button>`;
    container.append(box);
    for (const type of ["click", "mousedown", "pointerdown", "dblclick"]) box.addEventListener(type, (e) => e.stopPropagation());
    box.querySelector("input").addEventListener("change", (e) => addFiles(e.target.files));
    box.querySelector("button").addEventListener("click", () => { box.hidden = true; });

    async function addFiles(list) {
        for (const f of list) {
            const cues = parse(f.name, await f.text());
            if (!cues.length) { ov.toast(`${f.name}: no subtitles in it`, true); continue; }
            const ja = japanese(cues);
            const id = `${files.length}`;
            files.push({ id, label: f.name, cues, ja });
            if (ja && !mainId) await useMain(id);
            else if (!ja && !trId) useTranslation(id);
            else listTracks();
        }
        box.hidden = !!mainId;
    }

    function listTracks() {
        ov.setTracks(files.filter((f) => f.ja).map((f) => ({ id: f.id, label: f.label })), mainId);
        ov.setTranslations(files.filter((f) => !f.ja).map((f) => ({ id: f.id, label: f.label })), trId);
    }
    async function useMain(id) {
        const f = files.find((x) => x.id === id);
        if (!f) return;
        mainId = id;
        listTracks();
        await ov.setCues(f.cues, `${f.label}: ${f.cues.length} lines`);
    }
    function useTranslation(id) {
        trId = id;
        listTracks();
        const f = files.find((x) => x.id === id);
        ov.setTranslation(f ? f.cues : []);
    }

    // files dropped anywhere on the video (players often stop drag events: listen first)
    const over = (e) => {
        const r = container.getBoundingClientRect();
        return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    };
    window.addEventListener("dragover", (e) => { if (over(e) && e.dataTransfer?.types.includes("Files")) { e.preventDefault(); e.stopPropagation(); } }, true);
    window.addEventListener("drop", (e) => {
        if (!over(e) || !e.dataTransfer?.files.length) return;
        e.preventDefault();
        e.stopPropagation();
        addFiles(e.dataTransfer.files);
    }, true);

    window.akkoGeneric = { show: () => { if (!mainId) box.hidden = false; } };
    return { video: true };
})();
