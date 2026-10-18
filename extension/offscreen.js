// Records the tab's sound, for cards from Netflix (its video is copy-protected, so it can't be
// recorded directly like YouTube's). background.js gets a capture id for the tab and sends it here;
// a hidden page is needed because only pages can record. While recording, the sound is played
// back, so you keep hearing the video.
//   {target: "offscreen", type: "rec-start", streamId}
//   {target: "offscreen", type: "rec-stop"}  -> {data (base64), ext}

let rec = null, stream = null, ctx = null, parts = [];

async function start(streamId) {
    if (rec) await stop().catch(() => {});
    stream = await navigator.mediaDevices.getUserMedia({ audio: { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId } }, video: false });
    ctx = new AudioContext();
    ctx.createMediaStreamSource(stream).connect(ctx.destination);
    const mimeType = ["audio/webm;codecs=opus", "audio/webm"].find((m) => MediaRecorder.isTypeSupported(m));
    parts = [];
    rec = new MediaRecorder(stream, { mimeType });
    rec.ondataavailable = (e) => { if (e.data.size) parts.push(e.data); };
    rec.start();
}

async function stop() {
    if (!rec) throw new Error("nothing is being recorded");
    const r = rec;
    rec = null;
    const done = new Promise((resolve) => { r.onstop = resolve; });
    r.stop();
    await done;
    stream.getTracks().forEach((t) => t.stop());
    await ctx.close().catch(() => {});
    const bytes = new Uint8Array(await new Blob(parts, { type: r.mimeType }).arrayBuffer());
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { data: btoa(bin), ext: "webm" };
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
    if (!msg || msg.target !== "offscreen") return false;
    const job = msg.type === "rec-start" ? start(msg.streamId).then(() => ({ ok: true })) : msg.type === "rec-stop" ? stop() : null;
    if (!job) return false;
    job.then((data) => reply({ data }), (err) => reply({ error: err.message || String(err) }));
    return true;
});
