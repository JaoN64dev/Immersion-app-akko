// Tells the local server what's on screen, so it can show it on Discord (server/discord.js).
// No-ops quietly if the server has no Discord client ID configured.

import { postJson } from "./utils.js";

const MIN_INTERVAL = 15000;    // Discord doesn't want SET_ACTIVITY more often than this
let lastSent = 0;

function send(payload) {
    lastSent = Date.now();
    postJson("/api/presence", payload).catch(() => {});
}

// An explicit change (opened something new, hit play/pause, skipped a track): send right away.
export function setPresence(payload) {
    send(payload);
}

// A periodic refresh, e.g. keeping the elapsed time fresh while playing: throttled.
export function tickPresence(payload) {
    if (Date.now() - lastSent < MIN_INTERVAL) return;
    send(payload);
}

// Nothing is open anymore: back to the plain default presence.
export function clearPresence() {
    send({});
}
