// Audio as a 16 kHz mono 16-bit WAV: what speech recognition wants, and what OpenAI whisper can read
// without ffmpeg (server/whisper-wav.py). The browser decodes the file itself (mp3, m4a, ogg, opus,
// flac, wav…), so nothing needs installing; only used when the server asks for it, since a long
// recording decoded whole takes a lot of memory.

export const RATE = 16000;

// samples (-1…1) -> the bytes of a mono 16-bit PCM WAV file
export function encodeWav(samples, rate = RATE) {
    const out = new DataView(new ArrayBuffer(44 + samples.length * 2));
    const text = (at, s) => { for (let i = 0; i < s.length; i++) out.setUint8(at + i, s.charCodeAt(i)); };
    text(0, "RIFF");
    out.setUint32(4, 36 + samples.length * 2, true);
    text(8, "WAVE");
    text(12, "fmt ");
    out.setUint32(16, 16, true);            // fmt chunk size
    out.setUint16(20, 1, true);             // PCM
    out.setUint16(22, 1, true);             // mono
    out.setUint32(24, rate, true);
    out.setUint32(28, rate * 2, true);      // bytes per second
    out.setUint16(32, 2, true);             // bytes per frame
    out.setUint16(34, 16, true);            // bits per sample
    text(36, "data");
    out.setUint32(40, samples.length * 2, true);
    for (let i = 0; i < samples.length; i++) {
        const v = Math.max(-1, Math.min(1, samples[i]));
        out.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true);
    }
    return out.buffer;
}

// An audio file -> WAV bytes, decoded and resampled to 16 kHz by the browser, channels mixed to one
export async function audioFileToWav(file) {
    const ctx = new OfflineAudioContext(1, 1, RATE);
    const audio = await ctx.decodeAudioData(await file.arrayBuffer());
    const mono = new Float32Array(audio.length);
    for (let c = 0; c < audio.numberOfChannels; c++) {
        const data = audio.getChannelData(c);
        for (let i = 0; i < data.length; i++) mono[i] += data[i] / audio.numberOfChannels;
    }
    return encodeWav(mono, audio.sampleRate);
}
