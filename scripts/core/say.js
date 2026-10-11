// Hearing Japanese anywhere: a sentence or a word, said by the best voice there is (VOICEVOX,
// the browser's natural voices, Windows': scripts/listening/speech.js, with the voice picked on
// the 聴解 page). Words try a real recording first (/api/audio: JapanesePod101, Lingua Libre).

import { store, getJson } from "./utils.js";
import * as speech from "../listening/speech.js";

let ready = null;
const voices = () => {
    if (!ready) ready = speech.init(store.get("akko-listening-view", {}).voice || "auto").catch(() => null);
    return ready;
};

export async function saySentence(text) {
    await voices();
    if (!speech.available()) throw new Error("no Japanese voice on this computer (the 聴解 page says how to get one)");
    await speech.sequence([{ text: text.slice(0, 400), voice: "woman" }]);
}

// the word: its recorded pronunciation if there is one, else the voice
export async function sayWord(word, reading = "") {
    speech.stop();
    try {
        const a = await getJson(`/api/audio?${new URLSearchParams({ word, reading, lang: "ja" })}`);
        if (a.data) {
            await new Audio(`data:audio/${a.ext === "mp3" ? "mpeg" : a.ext};base64,${a.data}`).play();
            return;
        }
    } catch { /* no recording: the voice says it */ }
    await saySentence(reading || word);
}

export const stopSaying = () => speech.stop();
