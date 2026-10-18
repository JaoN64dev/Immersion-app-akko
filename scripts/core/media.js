// A mined word's line audio and picture, kept in akko (IndexedDB "media", keyed by the mined
// word's id), so 復習 can play the line and show the scene even without Anki. Saved when a word is
// mined on the Watch page (scripts/anki/client.js) or comes from the browser extension
// (scripts/core/companion.js). Not in backups: they're recordings, a backup is text.

import { idbGet, idbPut, idbDelete } from "./idb.js";

const AUDIO_TYPES = { webm: "audio/webm", ogg: "audio/ogg", mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4" };

function blobOf(base64, type) {
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type });
}

// audio: {data (base64), ext} or a Blob; picture: base64 JPEG or a Blob
export async function keepMedia(id, { audio = null, picture = null } = {}) {
    if (!id || (!audio && !picture)) return;
    const rec = { id };
    if (audio) rec.audio = audio instanceof Blob ? audio : blobOf(audio.data, AUDIO_TYPES[audio.ext] || "audio/webm");
    if (picture) rec.picture = picture instanceof Blob ? picture : blobOf(picture, "image/jpeg");
    await idbPut("media", rec).catch(() => {});
}

// {audio: Blob?, picture: Blob?} or null
export const mediaOf = (id) => idbGet("media", id).catch(() => null);

export const dropMedia = (id) => idbDelete("media", id).catch(() => {});
