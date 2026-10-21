// akko's online service (cloud/src/worker.js), run here with stand-ins for Cloudflare's D1
// (Node's SQLite, with cloud/schema.sql) and R2 (in memory): accounts and recovery, devices, sync
// with the last change winning, recordings, export, reports and deleting an account.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import worker from "../cloud/src/worker.js";

function fakeD1() {
    const db = new DatabaseSync(":memory:");
    db.exec(fs.readFileSync(new URL("../cloud/schema.sql", import.meta.url), "utf8"));
    const statement = (sql, params = []) => ({
        bind: (...p) => statement(sql, p),
        first: async () => db.prepare(sql).get(...params) ?? null,
        all: async () => ({ results: db.prepare(sql).all(...params) }),
        run: async () => ({ meta: { changes: db.prepare(sql).run(...params).changes } }),
        now: () => db.prepare(sql).run(...params),
    });
    return {
        db,
        prepare: (sql) => statement(sql),
        batch: async (list) => {
            db.exec("BEGIN");
            try { list.forEach((s) => s.now()); db.exec("COMMIT"); } catch (err) { db.exec("ROLLBACK"); throw err; }
            return [];
        },
    };
}
function fakeR2() {
    const objects = new Map();
    return {
        objects,
        put: async (key, body, opts = {}) => { objects.set(key, { body: new Uint8Array(body instanceof ArrayBuffer ? body : body.buffer || body), httpMetadata: opts.httpMetadata || {} }); },
        get: async (key) => objects.get(key) || null,
        delete: async (keys) => { for (const k of [].concat(keys)) objects.delete(k); },
        list: async ({ prefix = "", limit = 1000 } = {}) => {
            const all = [...objects.keys()].filter((k) => k.startsWith(prefix));
            return { objects: all.slice(0, limit).map((key) => ({ key })), truncated: all.length > limit };
        },
    };
}

test("akko accounts: sign up, devices, sync, recordings, recovery, export, delete", async () => {
    const env = { DB: fakeD1(), MEDIA: fakeR2() };
    const call = async (method, path, { body, token, raw, type } = {}) => {
        const headers = {};
        if (token) headers.Authorization = `Bearer ${token}`;
        if (body !== undefined) headers["Content-Type"] = "application/json";
        if (type) headers["Content-Type"] = type;
        const r = await worker.fetch(new Request(`https://cloud.test${path}`, { method, headers, body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined) }), env);
        const ct = r.headers.get("Content-Type") || "";
        return { status: r.status, ...(ct.includes("json") ? await r.json() : { bytes: new Uint8Array(await r.arrayBuffer()), type: ct }) };
    };

    // ---------- signing up ----------
    assert.equal((await call("POST", "/signup", { body: { email: "nope", password: "12345678" } })).status, 400);
    assert.equal((await call("POST", "/signup", { body: { email: "a@b.co", password: "short" } })).status, 400);
    const up = await call("POST", "/signup", { body: { email: "Me@Example.com", password: "correct horse", device: "desktop" } });
    assert.equal(up.status, 200);
    assert.match(up.recovery, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    assert.equal((await call("POST", "/signup", { body: { email: "me@example.com", password: "another one" } })).status, 409);
    const stored = env.DB.db.prepare("SELECT pass, recovery FROM accounts").get();
    assert.ok(stored.pass.startsWith("pbkdf2$100000$") && !stored.pass.includes("correct horse"), "only a hash of the password");
    assert.notEqual(stored.recovery, up.recovery.replace(/-/g, ""));

    // ---------- signing in: a second computer ----------
    assert.equal((await call("POST", "/signin", { body: { email: "me@example.com", password: "wrong one" } })).status, 401);
    const laptop = (await call("POST", "/signin", { body: { email: "me@example.com", password: "correct horse", device: "laptop" } })).token;
    const desk = up.token;
    const devices = await call("GET", "/devices", { token: laptop });
    assert.deepEqual(devices.devices.map((d) => [d.name, d.current]).sort(), [["desktop", false], ["laptop", true]]);
    assert.equal((await call("POST", "/sync", { token: "made-up", body: {} })).status, 401);

    // ---------- sync ----------
    const T = Date.now();
    let a = await call("POST", "/sync", { token: desk, body: { collections: {
        "words-ja": { since: 0, changes: [{ k: "猫", value: "known", updated: T }, { k: "犬", value: "learning", updated: T }] },
        mined: { since: 0, changes: [{ k: "m1", value: { id: "m1", word: "猫", sentence: "猫がいる" }, updated: T }] },
    } } });
    assert.equal(a.collections["words-ja"].changes.length, 2);
    // the laptop: an older 猫 loses, its own 鳥 is added, it gets everything
    let b = await call("POST", "/sync", { token: laptop, body: { collections: {
        "words-ja": { since: 0, changes: [{ k: "猫", value: "learning", updated: T - 1000 }, { k: "鳥", value: "known", updated: T }] },
        mined: { since: 0, changes: [] },
        nonsense: { since: 0, changes: [{ k: "x", value: 1, updated: T }] },
    } } });
    const words = Object.fromEntries(b.collections["words-ja"].changes.map((c) => [c.k, c.value]));
    assert.deepEqual(words, { 猫: "known", 犬: "learning", 鳥: "known" });
    assert.deepEqual(b.collections.mined.changes[0].value, { id: "m1", word: "猫", sentence: "猫がいる" });
    assert.equal(b.collections.nonsense, undefined);
    // the desktop catches up: only 鳥
    a = await call("POST", "/sync", { token: desk, body: { collections: { "words-ja": { since: a.collections["words-ja"].v, changes: [] } } } });
    assert.deepEqual(a.collections["words-ja"].changes.map((c) => c.k), ["鳥"]);

    // a lot of changes come back a page at a time
    const many = Array.from({ length: 1000 }, (_, i) => ({ k: `w${i}`, value: "known", updated: T }));
    for (let i = 0; i < 3; i++) await call("POST", "/sync", { token: desk, body: { collections: { "words-en": { since: 0, changes: many.map((c) => ({ ...c, k: `${c.k}-${i}` })) } } } });
    const first = await call("POST", "/sync", { token: laptop, body: { collections: { "words-en": { since: 0, changes: [] } } } });
    assert.equal(first.collections["words-en"].changes.length, 2000);
    assert.equal(first.collections["words-en"].more, true);
    const rest = await call("POST", "/sync", { token: laptop, body: { collections: { "words-en": { since: first.collections["words-en"].v, changes: [] } } } });
    assert.equal(rest.collections["words-en"].changes.length, 1000);
    assert.equal(rest.collections["words-en"].more, undefined);

    // ---------- recordings ----------
    assert.equal((await call("PUT", "/media/m1/audio", { token: desk, raw: new Uint8Array([1, 2, 3]), type: "audio/webm" })).status, 200);
    assert.equal((await call("PUT", "/media/m1/audio", { token: desk, raw: "<b>", type: "text/html" })).status, 400);
    const got = await call("GET", "/media/m1/audio", { token: laptop });
    assert.equal(got.type, "audio/webm");
    assert.deepEqual([...got.bytes], [1, 2, 3]);
    assert.deepEqual((await call("POST", "/sync", { token: laptop, body: { collections: {}, media: true } })).media, ["m1"]);
    assert.equal(env.DB.db.prepare("SELECT media_bytes FROM accounts").get().media_bytes, 3);
    // the mined word deleted on the laptop: its recording goes
    await call("POST", "/sync", { token: laptop, body: { collections: { mined: { since: 0, changes: [{ k: "m1", deleted: true, updated: T + 5000 }] } } } });
    assert.equal((await call("GET", "/media/m1/audio", { token: desk })).status, 404);
    assert.equal(env.MEDIA.objects.size, 0);
    assert.equal(env.DB.db.prepare("SELECT media_bytes FROM accounts").get().media_bytes, 0);

    // ---------- your data ----------
    const exp = await call("GET", "/export", { token: desk });
    assert.equal(exp.account.email, "me@example.com");
    assert.equal(exp.collections["words-ja"]["猫"].value, "known");
    assert.equal(exp.collections.mined, undefined, "deleted ones aren't data any more");
    assert.equal(exp.devices.length, 2);

    // ---------- the password forgotten: the recovery code ----------
    assert.equal((await call("POST", "/recover", { body: { email: "me@example.com", recovery: "AAAA-BBBB-CCCC-DDDD", password: "new password" } })).status, 401);
    const rec = await call("POST", "/recover", { body: { email: "me@example.com", recovery: up.recovery.toLowerCase(), password: "new password", device: "desktop" } });
    assert.equal(rec.status, 200);
    assert.notEqual(rec.recovery, up.recovery, "a new code each time");
    assert.equal((await call("GET", "/devices", { token: laptop })).status, 401, "every device signed out");
    assert.equal((await call("POST", "/signin", { body: { email: "me@example.com", password: "correct horse" } })).status, 401);
    const now = rec.token;

    // ---------- reports ----------
    const r = await call("POST", "/report", { body: { version: "2.0.0", what: "the popup is empty", contact: "me@example.com", diagnostics: { version: "2.0.0" }, picture: "data:image/png;base64,iVBORw0KGgo=" } });
    assert.equal(r.status, 200);
    assert.equal(r.issue, null, "no GitHub token here");
    const saved = env.DB.db.prepare("SELECT contact, body FROM reports").get();
    assert.equal(saved.contact, "me@example.com");
    assert.ok(!saved.body.includes("me@example.com"), "the issue never has the contact address");
    const picture = saved.body.match(/\/reports\/([\w-]+\.png)/)[1];
    assert.equal((await call("GET", `/reports/${picture}`)).type, "image/png");

    // ---------- signing out, deleting the account ----------
    assert.equal((await call("DELETE", "/account", { token: now, body: { password: "correct horse" } })).status, 401);
    await call("PUT", "/media/m2/picture", { token: now, raw: new Uint8Array([9]), type: "image/jpeg" });
    assert.equal((await call("DELETE", "/account", { token: now, body: { password: "new password" } })).status, 200);
    for (const table of ["accounts", "devices", "records", "media"]) assert.equal(env.DB.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n, 0, table);
    assert.deepEqual([...env.MEDIA.objects.keys()].filter((k) => !k.startsWith("reports/")), []);
    assert.equal((await call("GET", "/devices", { token: now })).status, 401);
});

test("too many sign-in tries wait", async () => {
    const env = { DB: fakeD1(), MEDIA: fakeR2() };
    const signin = () => worker.fetch(new Request("https://cloud.test/signin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "x@y.zz", password: "whatever1" }) }), env);
    const codes = [];
    for (let i = 0; i < 11; i++) codes.push((await signin()).status);
    assert.deepEqual(codes, [...Array(10).fill(401), 429]);
});
