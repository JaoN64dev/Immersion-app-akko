// Settings → akko account (server/cloud.js): create one, sign in, the recovery code, this
// account's devices, download everything, sign out, delete it. Hidden when this akko has no
// online service to use. The computer akko runs on only (a phone shows nothing here).

import { $ } from "../core/dom.js";
import { getJson, postJson, escapeHtml } from "../core/utils.js";
import { t } from "../i18n.js";

const section = $("#account-section");

const ago = (ms) => {
    const m = Math.round((Date.now() - ms) / 60e3);
    return m < 1 ? t("just now") : m < 60 ? t(`${m}m ago`) : m < 48 * 60 ? t(`${Math.round(m / 60)}h ago`) : t(`${Math.round(m / 1440)}d ago`);
};

function say(text, bad = false) {
    const el = $("#account-msg");
    el.textContent = text;
    el.classList.toggle("bad", bad);
}

async function refresh() {
    let s;
    try { s = await getJson("/api/cloud"); } catch { section.hidden = true; return; }
    section.hidden = !s.available;
    $("#account-nav")?.toggleAttribute("hidden", !s.available);
    if (!s.available) return;
    $("#account-out").hidden = s.signedIn;
    $("#account-in").hidden = !s.signedIn;
    $("#account-email").textContent = s.email;
    const status = $("#account-status");
    if (s.signedIn) {
        status.textContent = s.error ? `⚠ ${s.error}`
            : s.last ? t(`✓ in sync ${ago(s.last)} · ${s.words} words · ${s.mined} mined`) : t("getting in step…");
        status.classList.toggle("bad", !!s.error);
    } else {
        status.textContent = s.error || "";
        status.classList.toggle("bad", !!s.error);
    }
}

// the recovery code, shown once
function showRecovery(code) {
    $("#account-code").textContent = code;
    $("#account-recovery").hidden = false;
    $("#account-recovery").scrollIntoView({ block: "center" });
}

async function devices() {
    const list = $("#account-devices");
    try {
        const r = await getJson("/api/cloud/devices");
        list.innerHTML = r.devices.map((d) => `<li><b translate="no">${escapeHtml(d.name)}</b> <span class="muted">${d.current ? t("this computer") : t(`last used ${new Date(d.seen).toLocaleDateString()}`)}</span>
            ${d.current ? "" : `<button type="button" data-device="${escapeHtml(d.id)}">${t("sign it out")}</button>`}</li>`).join("");
    } catch (err) { list.innerHTML = `<li class="bad">${escapeHtml(err.message)}</li>`; }
}

function form(id, url, done) {
    $(id).addEventListener("submit", async (e) => {
        e.preventDefault();
        const f = e.target;
        const button = f.querySelector("button[type=submit]");
        button.disabled = true;
        say(t("one moment…"));
        try {
            const body = Object.fromEntries(new FormData(f));
            if ("agree" in body) body.agree = true;
            const r = await postJson(url, body);
            f.reset();
            say("");
            await done(r);
        } catch (err) {
            say(err.message, true);
        } finally {
            button.disabled = false;
            refresh();
        }
    });
}

export function init() {
    if (!section) return;
    // the three ways in
    for (const b of section.querySelectorAll("[data-pane]")) {
        b.addEventListener("click", () => {
            for (const x of section.querySelectorAll("[data-pane]")) x.setAttribute("aria-checked", String(x === b));
            for (const p of ["signup", "signin", "recover"]) $(`#account-${p}`).hidden = p !== b.dataset.pane;
            say("");
        });
    }
    form("#account-signup", "/api/cloud/signup", (r) => showRecovery(r.recovery));
    form("#account-signin", "/api/cloud/signin", () => {});
    form("#account-recover", "/api/cloud/recover", (r) => showRecovery(r.recovery));
    $("#account-code-copy").addEventListener("click", () => navigator.clipboard.writeText($("#account-code").textContent).then(() => say(t("copied ✓"))).catch(() => {}));
    $("#account-code-done").addEventListener("click", () => { $("#account-recovery").hidden = true; $("#account-code").textContent = ""; });

    $("#account-sync").addEventListener("click", async () => {
        say(t("one moment…"));
        try { await postJson("/api/cloud/sync", {}); say(""); } catch (err) { say(err.message, true); }
        refresh();
    });
    $("#account-export").addEventListener("click", () => { location.href = "/api/cloud/export"; });
    $("#account-signout").addEventListener("click", async () => {
        await postJson("/api/cloud/signout", {}).catch(() => {});
        refresh();
    });
    $("#account-devices-box").addEventListener("toggle", (e) => { if (e.target.open) devices(); });
    $("#account-devices").addEventListener("click", async (e) => {
        const b = e.target.closest("[data-device]");
        if (!b) return;
        b.disabled = true;
        await fetch(`/api/cloud/devices/${encodeURIComponent(b.dataset.device)}`, { method: "DELETE" }).catch(() => {});
        devices();
    });
    $("#account-delete").addEventListener("submit", async (e) => {
        e.preventDefault();
        if (!confirm(t("Delete your akko account and everything in it (words, mined words, recordings) from the online service? What's on your computers stays."))) return;
        try {
            await postJson("/api/cloud/delete", { password: e.target.password.value });
            e.target.reset();
            say(t("the account is deleted"));
        } catch (err) { say(err.message, true); }
        refresh();
    });
    refresh();
    setInterval(() => { if (document.visibilityState === "visible") refresh(); }, 15e3);
}
