// akko accounts end to end: two computers (two akko servers with their own data folders) and
// akko's online service (cloud/src/worker.js with stand-ins for D1 and R2, on a local port). Words,
// mined words and recordings go from one to the other and back; deletions too; quiet rounds send
// nothing; signing out, exporting and deleting the account.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";
import worker from "../cloud/src/worker.js";

const require = createRequire(import.meta.url);
const express = require("express");

function fakeEnv() {
    const db = new DatabaseSync(":memory:");
    db.exec(fs.readFileSync(new URL("../cloud/schema.sql", import.meta.url), "utf8"));
    const statement = (sql, params = []) => ({
        bind: (...p) => statement(sql, p),
        first: async () => db.prepare(sql).get(...params) ?? null,
        all: async () => ({ results: db.prepare(sql).all(...params) }),
        run: async () => ({ meta: { changes: db.prepare(sql).run(...params).changes } }),
        now: () => db.prepare(sql).run(...params),
    });
    const objects = new Map();
    return {
        db,
        DB: { prepare: (sql) => statement(sql), batch: async (list) => { db.exec("BEGIN"); try { list.forEach((s) => s.now()); db.exec("COMMIT"); } catch (e) { db.exec("ROLLBACK"); throw e; } return []; } },
        MEDIA: {
            objects,
            put: async (k, body, o = {}) => { objects.set(k, { body: new Uint8Array(body), httpMetadata: o.httpMetadata || {} }); },
            get: async (k) => objects.get(k) || null,
            delete: async (keys) => { for (const k of [].concat(keys)) objects.delete(k); },
            list: async ({ prefix = "" } = {}) => ({ objects: [...objects.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })), truncated: false }),
        },
    };
}

// a computer: akko's server parts, loaded fresh with their own data folder
const PARTS = ["paths", "words", "sync", "diagnostics", "cloud"].map((m) => require.resolve(`../server/${m}`));
async function computer(name) {
    process.env.AKKO_DATA = fs.mkdtempSync(path.join(os.tmpdir(), `akko-${name}-`));
    for (const p of PARTS) delete require.cache[p];
    const parts = { words: require("../server/words"), sync: require("../server/sync"), cloud: require("../server/cloud") };
    for (const p of PARTS) delete require.cache[p];
    const app = express();
    app.use("/api/cloud", parts.cloud.router);
    const server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
    parts.server = server;
    parts.api = (method, p, body) => fetch(`http://127.0.0.1:${server.address().port}/api/cloud${p}`, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body && JSON.stringify(body) })
        .then(async (r) => ({ status: r.status, ...(await r.json()) }));
    return parts;
}

test("two computers, one akko account", async () => {
    const env = fakeEnv();
    const service = http.createServer(async (req, res) => {
        const chunks = [];
        for await (const c of req) chunks.push(c);
        const body = chunks.length ? Buffer.concat(chunks) : undefined;
        const r = await worker.fetch(new Request(`http://127.0.0.1${req.url}`, { method: req.method, headers: req.headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : body }), env);
        res.writeHead(r.status, Object.fromEntries(r.headers));
        res.end(Buffer.from(await r.arrayBuffer()));
    });
    await new Promise((r) => service.listen(0, "127.0.0.1", r));
    process.env.AKKO_CLOUD = `http://127.0.0.1:${service.address().port}`;
    const A = await computer("a");
    const B = await computer("b");
    const T = Date.now();
    const v = () => env.db.prepare("SELECT v FROM accounts").get()?.v;
    try {
        // A has words, a mined word and its recording
        A.words.apply("ja", { 猫: "known", 犬: "learning" });
        A.words.apply("en", { cat: "known" });
        A.sync.put("mined", "m1", { value: { id: "m1", word: "猫", sentence: "猫がいる" }, updated: T });
        A.sync.writeMedia("m1", "audio", "audio/webm", Buffer.from("the line"));
        // a round while signed out (as when akko starts) mustn't stop the later ones
        await A.cloud.round();
        assert.equal(A.cloud.status().syncing, false);

        assert.equal((await A.api("POST", "/signup", { email: "me@example.com", password: "correct horse" })).status, 400, "the privacy notice must be accepted");
        const up = await A.api("POST", "/signup", { email: "me@example.com", password: "correct horse", agree: true });
        assert.match(up.recovery, /^[A-Z2-9-]{19}$/);
        await A.cloud.round();
        const st = await A.api("GET", "/");
        assert.equal(st.signedIn, true);
        assert.equal(st.error, "");
        assert.ok(st.last > 0);

        // B signs in, with a word of its own; the account's status wins for 猫
        B.words.apply("ja", { 猫: "learning", 鳥: "known" });
        assert.equal((await B.api("POST", "/signin", { email: "me@example.com", password: "wrong" })).status, 401);
        assert.equal((await B.api("POST", "/signin", { email: "Me@example.com", password: "correct horse" })).status, 200);
        await B.cloud.round();
        await B.cloud.round();        // the recordings come after their mined word
        assert.deepEqual(B.words.words("ja"), { 猫: "known", 犬: "learning", 鳥: "known" });
        assert.deepEqual(B.words.words("en"), { cat: "known" });
        const minedB = B.sync.since("mined", 0).changes.find((c) => c.k === "m1");
        assert.equal(minedB.value.word, "猫");
        assert.equal(B.sync.readMedia("m1", "audio").bytes.toString(), "the line");

        // and A gets B's 鳥
        await A.cloud.round();
        assert.equal(A.words.words("ja")["鳥"], "known");

        // quiet rounds send nothing new
        await A.cloud.round(); await B.cloud.round();
        const quiet = v();
        await A.cloud.round(); await B.cloud.round();
        assert.equal(v(), quiet, "nothing goes back and forth");

        // B changes a word and deletes the mined word: A follows, the recording goes
        B.words.apply("ja", { 犬: "known", 猫: "new" });
        B.sync.put("mined", "m1", { deleted: true, updated: Date.now() + 1 });
        await B.cloud.round();
        await A.cloud.round();
        assert.deepEqual(A.words.words("ja"), { 犬: "known", 鳥: "known" });
        assert.equal(A.sync.since("mined", 0).changes.find((c) => c.k === "m1").deleted, true);
        assert.equal(A.sync.readMedia("m1", "audio"), null);
        assert.equal([...env.MEDIA.objects.keys()].length, 0);

        // devices, export
        const devices = await B.api("GET", "/devices");
        assert.equal(devices.devices.length, 2);
        const exp = await fetch(`http://127.0.0.1:${B.server.address().port}/api/cloud/export`);
        assert.match(exp.headers.get("content-disposition"), /attachment; filename="akko-account-/);
        assert.equal((await exp.json()).collections["words-ja"]["鳥"].value, "known");

        // A signs out; B deletes the account
        await A.api("POST", "/signout");
        assert.equal((await A.api("GET", "/")).signedIn, false);
        assert.equal((await B.api("POST", "/delete", { password: "nope" })).status, 401);
        assert.equal((await B.api("GET", "/")).signedIn, true, "a wrong password doesn't sign out");
        assert.equal((await B.api("POST", "/delete", { password: "correct horse" })).status, 200);
        assert.equal((await B.api("GET", "/")).signedIn, false);
        assert.equal(env.db.prepare("SELECT COUNT(*) AS n FROM records").get().n, 0);
        // the words stay on the computers
        assert.equal(B.words.words("ja")["鳥"], "known");
    } finally {
        delete process.env.AKKO_CLOUD;
        A.server.close(); B.server.close(); service.close();
        A.words.reset(); B.words.reset(); A.sync.reset(); B.sync.reset();
    }
});
