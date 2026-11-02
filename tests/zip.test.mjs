// The backup's .zip (scripts/core/zip.js, scripts/core/backup-file.js): a small zip of akko's own
// making, read back by akko — the recordings are Blobs, so the backup can carry them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeZip, readZip, isZip } from "../scripts/core/zip.js";

const bytesOf = async (blob) => new Uint8Array(await blob.arrayBuffer());

test("a zip of text and binary comes back as it went in", async () => {
    const text = JSON.stringify({ app: "akko-immersion", words: "首を長くする" }).repeat(20);
    const binary = new Uint8Array(4096).map((_, i) => (i * 7) % 256);
    const zip = await makeZip([
        { name: "akko-backup.json", data: text, compress: true },
        { name: "media/1-audio", data: binary },
    ]);
    const bytes = await bytesOf(zip);
    assert.ok(isZip(bytes), "starts like a zip");
    assert.equal(isZip(new Uint8Array([1, 2, 3, 4])), false);
    assert.equal(isZip(new TextEncoder().encode('{"app":"akko-immersion"}')), false, "JSON isn't a zip");

    const entries = await readZip(bytes);
    assert.deepEqual(entries.map((e) => e.name), ["akko-backup.json", "media/1-audio"]);
    assert.equal(entries[0].text(), text, "the text survives");
    assert.deepEqual([...entries[1].bytes()], [...binary], "the bytes survive");
    // the JSON is deflated, not stored as it is (the binary is stored: it's already compressed)
    assert.equal(new DataView(bytes.buffer, bytes.byteOffset).getUint16(8, true), 8, "the first entry is deflated");
    assert.ok(bytes.length < text.length + binary.length, "smaller than the two files together");
});

test("a Blob (a recording) goes in and comes back as bytes", async () => {
    const audio = new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 1, 2, 3])], { type: "audio/webm" });
    const zip = await makeZip([{ name: "media/mine.audio", data: audio }, { name: "media.json", data: "[]", compress: true }]);
    const entries = await readZip(zip);
    const back = entries.find((e) => e.name === "media/mine.audio");
    assert.deepEqual([...back.bytes()], [0x1a, 0x45, 0xdf, 0xa3, 0, 1, 2, 3]);
    assert.equal(back.blob("audio/webm").type, "audio/webm");
    assert.equal(entries.find((e) => e.name === "media.json").text(), "[]");
});

test("something that isn't a zip is refused", async () => {
    await assert.rejects(() => readZip(new TextEncoder().encode("not a zip at all, just text")), /zip/);
});
