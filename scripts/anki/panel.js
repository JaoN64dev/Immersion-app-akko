// The Anki settings panel (Watch page): deck, note type, which field gets what, import

import { $ } from "../core/dom.js";
import { escapeHtml } from "../core/utils.js";
import * as client from "./client.js";

const ui = {
    status: $("#anki-status"), connect: $("#anki-connect"),
    deck: $("#anki-deck"), model: $("#anki-model"), fields: $("#anki-fields"),
    tags: $("#anki-tags"), auto: $("#anki-auto"), audio: $("#anki-audio"), wordAudio: $("#anki-word-audio"), shot: $("#anki-shot"), spoken: $("#anki-spoken"), keep: $("#anki-keep"),
    importBtn: $("#anki-import"), msg: $("#anki-msg"),
};

const options = (list, selected) => list.map((v) =>
    `<option${v === selected ? " selected" : ""}>${escapeHtml(v)}</option>`).join("");

function setStatus(ok) {
    ui.status.textContent = ok ? "connected" : "not connected";
    ui.status.classList.toggle("ok", ok);
}

function renderFields({ fieldNames, map }) {
    ui.fields.innerHTML = fieldNames.map((f) => `
        <label class="row">${escapeHtml(f)}
            <select data-field="${escapeHtml(f)}">
                ${Object.entries(client.SOURCES).map(([k, label]) =>
                    `<option value="${k}"${(map[f] || "") === k ? " selected" : ""}>${label}</option>`).join("")}
            </select>
        </label>`).join("");
}

async function connect(quiet = false) {
    try {
        const { decks, models } = await client.connect();
        const c = client.cfg();
        ui.deck.innerHTML = options(decks, c.deck);
        ui.model.innerHTML = options(models, c.model);
        renderFields(await client.loadFields());
        setStatus(true);
        if (!quiet) say("connected to Anki ✓");
    } catch (err) {
        setStatus(false);
        if (!quiet) say(err.message, true);
    }
}

function say(text, bad = false) {
    ui.msg.textContent = text;
    ui.msg.classList.toggle("bad", bad);
}

export function init() {
    const c = client.cfg();
    ui.tags.value = c.tags;
    ui.auto.checked = c.auto;
    ui.audio.checked = c.audio;
    ui.wordAudio.checked = c.wordAudio;
    ui.shot.checked = c.shot;
    if (ui.spoken) ui.spoken.checked = c.spokenSentence;
    if (ui.keep) ui.keep.checked = c.keep !== false;
    client.onMessage(say);

    ui.connect.addEventListener("click", () => connect());
    ui.deck.addEventListener("change", () => client.saveCfg({ deck: ui.deck.value }));
    ui.model.addEventListener("change", async () => {
        client.saveCfg({ model: ui.model.value });
        renderFields(await client.loadFields());
    });
    ui.fields.addEventListener("change", (e) => {
        if (e.target.dataset.field) client.setFieldSource(e.target.dataset.field, e.target.value);
    });
    [ui.tags, ui.auto, ui.audio, ui.wordAudio, ui.shot, ui.spoken, ui.keep].filter(Boolean).forEach((i) => i.addEventListener("change", () => {
        client.saveCfg({ tags: ui.tags.value, auto: ui.auto.checked, audio: ui.audio.checked, wordAudio: ui.wordAudio.checked, shot: ui.shot.checked,
            ...(ui.spoken ? { spokenSentence: ui.spoken.checked } : {}), ...(ui.keep ? { keep: ui.keep.checked } : {}) });
        if (ui.auto.checked && !client.isConnected()) connect();
    }));
    ui.importBtn.addEventListener("click", async () => {
        ui.importBtn.disabled = true;
        await client.importKnown();
        ui.importBtn.disabled = false;
    });

    // reconnect quietly if it was set up before
    if (c.deck) connect(true);
}
