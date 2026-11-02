// A small .zip writer and reader, for the backup with its recordings (scripts/core/backup-file.js).
// No library: a zip is a header, the data, a list of what's inside, and a footer.
//
// Writing: entries are stored as they are, or deflated when that makes them smaller ("deflate-raw",
// which browsers and Node have as CompressionStream). Reading: stored and deflated entries, which
// is what other zips use too.

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_END = 0x06054b50;

// ---------- CRC-32 (the zip's checksum of each entry) ----------

const TABLE = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        t[i] = c >>> 0;
    }
    return t;
})();

function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

// ---------- the date, as a zip keeps it (2-second steps, from 1980) ----------

function dosDate(d) {
    return {
        time: ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((d.getSeconds() / 2) & 31),
        date: (((d.getFullYear() - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31),
    };
}

// ---------- deflate / inflate (the browser's, when it has them) ----------

async function deflate(bytes) {
    if (typeof CompressionStream === "undefined") return null;
    try {
        const stream = new CompressionStream("deflate-raw");
        const writer = stream.writable.getWriter();
        writer.write(bytes);
        writer.close();
        return new Uint8Array(await new Response(stream.readable).arrayBuffer());
    } catch {
        return null;                       // stored, then
    }
}

async function inflate(bytes) {
    const stream = new DecompressionStream("deflate-raw");
    const writer = stream.writable.getWriter();
    writer.write(bytes);
    writer.close();
    return new Uint8Array(await new Response(stream.readable).arrayBuffer());
}

// ---------- writing ----------

const asBytes = async (data) => {
    if (data instanceof Uint8Array) return data;
    if (typeof data === "string") return new TextEncoder().encode(data);
    return new Uint8Array(await data.arrayBuffer());          // Blob
};

// files: [{name, data: string | Blob | Uint8Array, compress?: true}]
// Resolves to a Blob (application/zip).
export async function makeZip(files, when = new Date()) {
    const encoder = new TextEncoder();
    const { time, date } = dosDate(when);
    const parts = [];                    // the file's bytes, in order
    const central = [];                  // one record per file, at the end
    let offset = 0;

    for (const file of files) {
        const name = encoder.encode(file.name);
        const original = await asBytes(file.data);
        const size = original.length;
        const crc = crc32(original);
        let bytes = original;
        let method = 0;
        if (file.compress) {
            const smaller = await deflate(original);
            if (smaller && smaller.length < size) { bytes = smaller; method = 8; }
        }

        const local = new Uint8Array(30 + name.length);
        const lv = new DataView(local.buffer);
        lv.setUint32(0, SIG_LOCAL, true);
        lv.setUint16(4, 20, true);           // needed to unpack: 2.0
        lv.setUint16(6, 0x0800, true);       // names are UTF-8
        lv.setUint16(8, method, true);
        lv.setUint16(10, time, true);
        lv.setUint16(12, date, true);
        lv.setUint32(14, crc, true);
        lv.setUint32(18, bytes.length, true);
        lv.setUint32(22, size, true);
        lv.setUint16(26, name.length, true);
        lv.setUint16(28, 0, true);           // extra field
        local.set(name, 30);
        parts.push(local, bytes);

        const record = new Uint8Array(46 + name.length);
        const cv = new DataView(record.buffer);
        cv.setUint32(0, SIG_CENTRAL, true);
        cv.setUint16(4, 20, true);           // made by: 2.0
        cv.setUint16(6, 20, true);
        cv.setUint16(8, 0x0800, true);
        cv.setUint16(10, method, true);
        cv.setUint16(12, time, true);
        cv.setUint16(14, date, true);
        cv.setUint32(16, crc, true);
        cv.setUint32(20, bytes.length, true);
        cv.setUint32(24, size, true);
        cv.setUint16(28, name.length, true);
        cv.setUint32(42, offset, true);      // where its local header is
        record.set(name, 46);
        central.push(record);

        offset += local.length + bytes.length;
    }

    const centralSize = central.reduce((n, c) => n + c.length, 0);
    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    ev.setUint32(0, SIG_END, true);
    ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true);
    ev.setUint32(12, centralSize, true);
    ev.setUint32(16, offset, true);
    return new Blob([...parts, ...central, end], { type: "application/zip" });
}

// ---------- reading ----------

// is this a zip? (PK\x03\x04: a local header, PK\x05\x06: an empty one)
export const isZip = (bytes) => bytes && bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b
    && ((bytes[2] === 3 && bytes[3] === 4) || (bytes[2] === 5 && bytes[3] === 6));

// Finds the end record (it's at the end, unless the zip has a comment after it)
function findEnd(view) {
    for (let i = view.byteLength - 22; i >= 0 && i >= view.byteLength - 22 - 0xffff; i--) {
        if (view.getUint32(i, true) === SIG_END) return i;
    }
    return -1;
}

// bytes: Uint8Array | ArrayBuffer | Blob
// Resolves to [{name, size, type: "", blob, bytes, text}] in the zip's order
export async function readZip(data) {
    const all = await asBytes(data);
    const view = new DataView(all.buffer, all.byteOffset, all.byteLength);
    const end = findEnd(view);
    if (end < 0) throw new Error("that isn't a zip file");
    const count = view.getUint16(end + 10, true);
    let at = view.getUint32(end + 16, true);
    const out = [];
    for (let i = 0; i < count; i++) {
        if (view.getUint32(at, true) !== SIG_CENTRAL) throw new Error("this zip is damaged");
        const method = view.getUint16(at + 10, true);
        const compSize = view.getUint32(at + 20, true);
        const nameLength = view.getUint16(at + 28, true);
        const extraLength = view.getUint16(at + 30, true);
        const commentLength = view.getUint16(at + 32, true);
        const localAt = view.getUint32(at + 42, true);
        const name = new TextDecoder().decode(all.subarray(at + 46, at + 46 + nameLength));
        at += 46 + nameLength + extraLength + commentLength;

        // the local header says how long its own name and extra field are: the data follows them
        const localName = view.getUint16(localAt + 26, true);
        const localExtra = view.getUint16(localAt + 28, true);
        const start = localAt + 30 + localName + localExtra;
        const raw = all.subarray(start, start + compSize);
        let bytes;
        if (method === 0) bytes = raw;
        else if (method === 8) bytes = await inflate(raw);
        else throw new Error(`this zip uses a compression akko doesn't know (${method})`);
        out.push({
            name,
            size: bytes.length,
            type: "",
            bytes: () => bytes,
            blob: (type = "") => new Blob([bytes], { type }),
            text: () => new TextDecoder().decode(bytes),
        });
    }
    return out;
}
