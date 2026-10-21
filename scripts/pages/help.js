// Settings → Help (server/diagnostics.js): report a problem, and copy the diagnostics.
// The form shows exactly what will be sent (the same JSON goes to the server, which passes it on);
// it's prefilled from a page error that asked to be reported (scripts/core/oops.js:
// sessionStorage "akko-report-draft") or from the browser extension's link (?report=extension).

import { $ } from "../core/dom.js";
import { getJson, postJson, escapeHtml } from "../core/utils.js";
import { target } from "../core/target.js";
import { lang, t } from "../i18n.js";

export const DRAFT = "akko-report-draft";
const form = $("#report-form");

let diagnostics = null;
let picture = null;            // {name, data (data: URL)}

// what akko runs on, with the page's side: interface, language learnt, browser, window size
async function loadDiagnostics() {
    try {
        diagnostics = await getJson("/api/diagnostics");
        diagnostics.page = { interface: lang(), learning: target(), window: `${innerWidth}x${innerHeight}`, browser: navigator.userAgent };
    } catch {
        diagnostics = null;      // a phone: only the computer akko runs on can see them
        $("#report-diag").checked = false;
        $("#report-diag").disabled = true;
    }
    preview();
}

function body() {
    const extra = new URLSearchParams(location.search);
    return {
        what: $("#report-what").value.trim(),
        expected: $("#report-expected").value.trim(),
        steps: $("#report-steps").value.trim(),
        error: form.dataset.error || "",
        contact: $("#report-contact").value.trim(),
        from: extra.get("report") === "extension" ? `the extension ${extra.get("ext") || ""} on ${extra.get("site") || "a video site"}`.trim() : "",
        diagnostics: $("#report-diag").checked ? diagnostics : null,
        picture: picture ? picture.data : null,
    };
}

function preview() {
    const b = body();
    const shown = { ...b, picture: picture ? `${picture.name} (${Math.round(picture.data.length * 0.75 / 1024)} KB)` : null };
    for (const k of Object.keys(shown)) if (shown[k] === "" || shown[k] === null) delete shown[k];
    $("#report-preview").textContent = JSON.stringify(shown, null, 2);
}

function say(html, bad = false) {
    $("#report-msg").innerHTML = html;
    $("#report-msg").classList.toggle("bad", bad);
}

export function init() {
    if (!form) return;
    // a page error, or the extension's link
    try {
        const draft = JSON.parse(sessionStorage.getItem(DRAFT) || "null");
        if (draft) {
            form.dataset.error = draft.error || "";
            $("#report-what").value = draft.what || "";
            sessionStorage.removeItem(DRAFT);
        }
    } catch { /* no draft */ }
    form.addEventListener("input", preview);
    $("#report-picture").addEventListener("change", (e) => {
        const f = e.target.files[0];
        picture = null;
        if (!f) return preview();
        if (f.size > 2e6) { say(t("that picture is too big (2 MB at most)"), true); e.target.value = ""; return preview(); }
        const r = new FileReader();
        r.onload = () => { picture = { name: f.name, data: String(r.result) }; preview(); };
        r.readAsDataURL(f);
    });
    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const b = body();
        if (!b.what) { $("#report-what").focus(); return; }
        const button = form.querySelector("button[type=submit]");
        button.disabled = true;
        say(t("sending…"));
        try {
            const r = await postJson("/api/report", b);
            if (r.sent) {
                say(`✓ ${t("sent, thank you!")}${r.issue ? ` <a href="${escapeHtml(r.issue)}" target="_blank" rel="noopener">${t("follow it on GitHub")}</a>` : ""}`);
                form.reset();
                picture = null;
                delete form.dataset.error;
            } else {
                say(`${t("couldn't send it from here.")} <a href="${escapeHtml(r.issueUrl)}" target="_blank" rel="noopener">${t("send it on GitHub instead")}</a> ${t("(already filled in; a GitHub account is needed, and the picture has to be added there)")}`, true);
            }
        } catch (err) {
            say(escapeHtml(err.message), true);
        } finally {
            button.disabled = false;
            preview();
        }
    });
    $("#diag-copy").addEventListener("click", async () => {
        if (!diagnostics) await loadDiagnostics();
        const msg = $("#diag-msg");
        try {
            await navigator.clipboard.writeText(JSON.stringify(diagnostics, null, 2));
            msg.textContent = t("copied ✓");
        } catch { msg.textContent = t("couldn't copy them"); }
    });
    loadDiagnostics();
    // from the extension's "report a problem" link, or a page error: straight to the form
    if (location.hash === "#help-section") setTimeout(() => $("#report-what").focus(), 300);
}
