// akko's online service: akko accounts (your word list and mined words, with their recordings, in
// step between computers anywhere) and problem reports. A Cloudflare Worker with D1 (SQLite: the
// accounts and records) and R2 (the recordings). Only akko's local server talks to it
// (server/cloud.js, server/diagnostics.js), never the pages. See cloud/README.md.
//
// Accounts, without e-mails being sent: an e-mail and a password (PBKDF2-SHA256), and a recovery
// code shown once at sign-up, which resets the password. Signing in gives a device a token
// (only its SHA-256 is kept); the devices can be listed and signed out.
//
//   POST   /signup   {email, password, device}             -> {token, recovery}
//   POST   /signin   {email, password, device}             -> {token}
//   POST   /recover  {email, recovery, password, device}   -> {token, recovery}   (every device signed out)
//   POST   /signout                                         (this device)
//   GET    /devices                                         -> {devices: [{id, name, created, seen, current}]}
//   DELETE /devices/<id>
//   POST   /sync     {collections: {name: {since, changes: [{k, value, updated, deleted}]}}, media?}
//                    -> {collections: {name: {v, changes, more?}}, media?: [ids]}
//                    collections: words-ja, words-en (a word's status), mined (a mined word)
//   PUT    /media/<mined id>/<audio | picture>   GET the same   (2 GB per account)
//   GET    /export                                          -> everything, as JSON
//   DELETE /account  {password}                             -> everything gone, recordings too
//   POST   /report   {app, version, what, expected, steps, error, from, contact, diagnostics, picture}
//                    -> {issue}: a GitHub issue (labelled from-app), without the contact address
//   GET    /reports/<key>.<png|jpg|webp>                    a report's picture (linked from its issue)
// The last change wins, per record, like akko's own server (server/sync.js). A change with
// updated 0 is only added where there's nothing yet (what a computer had before signing in).

const COLLECTIONS = new Set(["words-ja", "words-en", "mined"]);
const KINDS = new Set(["audio", "picture"]);
const TYPES = /^(audio\/(webm|ogg|mpeg|wav|mp4)|image\/(jpeg|png|webp))$/;
const MEDIA_LIMIT = 2 * 1024 ** 3;          // bytes of recordings per account
const RECORD_LIMIT = 300000;                // records per account
const PAGE = 2000;                          // changes sent back at once
const ITERATIONS = 100000;                  // PBKDF2 (the most Workers allow)

// ---------- small helpers ----------
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
const fail = (error, status = 400) => json({ error }, status);
const enc = new TextEncoder();
const b64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const b64url = (bytes) => b64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const random = (n) => crypto.getRandomValues(new Uint8Array(n));
const sha256 = async (text) => b64(await crypto.subtle.digest("SHA-256", enc.encode(text)));
const text = (v, max) => String(v ?? "").trim().slice(0, max);
const validEmail = (e) => /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(e);

async function hashPassword(password, saltB64 = b64(random(16))) {
    const salt = Uint8Array.from(atob(saltB64), (c) => c.charCodeAt(0));
    const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: ITERATIONS }, key, 256);
    return `pbkdf2$${ITERATIONS}$${saltB64}$${b64(bits)}`;
}
async function checkPassword(password, stored) {
    const [, , salt] = String(stored).split("$");
    if (!salt) return false;
    const again = await hashPassword(password, salt);
    // same length strings: compare all of it
    let diff = again.length ^ stored.length;
    for (let i = 0; i < Math.min(again.length, stored.length); i++) diff |= again.charCodeAt(i) ^ stored.charCodeAt(i);
    return diff === 0;
}

// a recovery code: 16 letters and digits that can't be mixed up, in groups of 4
function recoveryCode() {
    const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const r = random(16);
    return [...r].map((x) => abc[x % abc.length]).join("").replace(/(.{4})(?=.)/g, "$1-");
}
const normalRecovery = (c) => text(c, 40).toUpperCase().replace(/[^A-Z0-9]/g, "");

// at most n of something in a window (sign-in attempts, reports), per key
async function limited(env, key, n, windowMs) {
    const now = Date.now();
    await env.DB.prepare("DELETE FROM hits WHERE at < ?").bind(now - 864e5).run();
    const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM hits WHERE key = ? AND at > ?").bind(key, now - windowMs).first();
    if (row && row.n >= n) return true;
    await env.DB.prepare("INSERT INTO hits (key, at) VALUES (?, ?)").bind(key, now).run();
    return false;
}
const ipOf = (req) => req.headers.get("CF-Connecting-IP") || "local";

// ---------- accounts and devices ----------
async function newDevice(env, account, name) {
    const token = b64url(random(32));
    const id = b64url(random(9));
    const now = Date.now();
    await env.DB.prepare("INSERT INTO devices (id, account, token, name, created, seen) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(id, account, await sha256(token), text(name, 80) || "a computer", now, now).run();
    return token;
}

// the account and device a request's token belongs to, or null
async function who(env, req) {
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) return null;
    const row = await env.DB.prepare("SELECT d.id AS device, d.seen, a.id AS account, a.email FROM devices d JOIN accounts a ON a.id = d.account WHERE d.token = ?")
        .bind(await sha256(token)).first();
    if (!row) return null;
    if (Date.now() - row.seen > 3600e3) await env.DB.prepare("UPDATE devices SET seen = ? WHERE id = ?").bind(Date.now(), row.device).run();
    return row;
}

async function signup(env, req, b) {
    const email = text(b.email, 254).toLowerCase();
    const password = String(b.password || "");
    if (!validEmail(email)) return fail("that doesn't look like an e-mail address");
    if (password.length < 8) return fail("the password needs at least 8 characters");
    if (await limited(env, `signup:${ipOf(req)}`, 5, 3600e3)) return fail("too many accounts from here: try again later", 429);
    if (await env.DB.prepare("SELECT 1 FROM accounts WHERE email = ?").bind(email).first()) return fail("there's already an account with that e-mail: sign in instead", 409);
    const id = b64url(random(12));
    const recovery = recoveryCode();
    await env.DB.prepare("INSERT INTO accounts (id, email, pass, recovery, v, media_bytes, created) VALUES (?, ?, ?, ?, 0, 0, ?)")
        .bind(id, email, await hashPassword(password), await sha256(normalRecovery(recovery)), Date.now()).run();
    return json({ token: await newDevice(env, id, b.device), recovery });
}

async function signin(env, req, b) {
    const email = text(b.email, 254).toLowerCase();
    if (await limited(env, `signin:${email}`, 10, 900e3) || await limited(env, `signin-ip:${ipOf(req)}`, 30, 900e3)) return fail("too many tries: wait a few minutes", 429);
    const a = await env.DB.prepare("SELECT id, pass FROM accounts WHERE email = ?").bind(email).first();
    // (the same work without an account: how long it takes doesn't tell which e-mails have one)
    const ok = await checkPassword(String(b.password || ""), a ? a.pass : `pbkdf2$${ITERATIONS}$${b64(random(16))}$x`);
    if (!a || !ok) return fail("wrong e-mail or password", 401);
    return json({ token: await newDevice(env, a.id, b.device) });
}

async function recover(env, req, b) {
    const email = text(b.email, 254).toLowerCase();
    if (await limited(env, `recover:${email}`, 5, 3600e3)) return fail("too many tries: wait an hour", 429);
    const a = await env.DB.prepare("SELECT id, recovery FROM accounts WHERE email = ?").bind(email).first();
    if (!a || a.recovery !== await sha256(normalRecovery(b.recovery))) return fail("wrong e-mail or recovery code", 401);
    if (String(b.password || "").length < 8) return fail("the new password needs at least 8 characters");
    const recovery = recoveryCode();
    await env.DB.batch([
        env.DB.prepare("UPDATE accounts SET pass = ?, recovery = ? WHERE id = ?").bind(await hashPassword(String(b.password)), await sha256(normalRecovery(recovery)), a.id),
        env.DB.prepare("DELETE FROM devices WHERE account = ?").bind(a.id),
    ]);
    return json({ token: await newDevice(env, a.id, b.device), recovery });
}

// ---------- sync ----------
async function sync(env, me, b) {
    const out = {};
    for (const [name, c] of Object.entries(b.collections || {})) {
        if (!COLLECTIONS.has(name) || !c || typeof c !== "object") continue;
        const changes = (Array.isArray(c.changes) ? c.changes : []).slice(0, 1000)
            .filter((x) => x && typeof x.k === "string" && x.k && x.k.length <= 300 && Number.isFinite(x.updated))
            .map((x) => ({ k: x.k, value: x.deleted ? null : JSON.stringify(x.value ?? null), updated: Math.round(x.updated), deleted: x.deleted ? 1 : 0 }))
            .filter((x) => x.value === null || x.value.length <= 20000);
        if (changes.length) {
            const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM records WHERE account = ?").bind(me.account).first();
            if (count.n + changes.length > RECORD_LIMIT) return fail("this account is full", 413);
            // a range of versions for these changes, then all of them in one statement: a change
            // stays only if it's newer than what's there (the same time: the larger value);
            // updated 0 means "add it if it isn't there" (a computer's first sync)
            const top = await env.DB.prepare("UPDATE accounts SET v = v + ? WHERE id = ? RETURNING v").bind(changes.length, me.account).first();
            await env.DB.prepare(`INSERT INTO records (account, coll, k, value, updated, deleted, v)
                SELECT ?1, ?2, j.value ->> 'k', j.value ->> 'value', j.value ->> 'updated', j.value ->> 'deleted', ?3 + j.key FROM json_each(?4) AS j WHERE true
                ON CONFLICT (account, coll, k) DO UPDATE SET value = excluded.value, updated = excluded.updated, deleted = excluded.deleted, v = excluded.v
                WHERE excluded.updated > 0 AND (excluded.updated > records.updated OR (excluded.updated = records.updated AND COALESCE(excluded.value, '') > COALESCE(records.value, '')))`)
                .bind(me.account, name, top.v - changes.length + 1, JSON.stringify(changes)).run();
            // a mined word deleted: its recordings go too
            const gone = changes.filter((x) => x.deleted).map((x) => x.k);
            if (name === "mined" && gone.length) await dropMedia(env, me.account, gone);
        }
        const since = Number(c.since) || 0;
        const rows = (await env.DB.prepare("SELECT k, value, updated, deleted, v FROM records WHERE account = ? AND coll = ? AND v > ? ORDER BY v LIMIT ?")
            .bind(me.account, name, since, PAGE + 1).all()).results;
        const more = rows.length > PAGE;
        const page = rows.slice(0, PAGE);
        const top = await env.DB.prepare("SELECT v FROM accounts WHERE id = ?").bind(me.account).first();
        out[name] = {
            v: more ? page[page.length - 1].v : top.v,
            changes: page.map((r) => ({ k: r.k, value: r.deleted ? null : JSON.parse(r.value), updated: r.updated, deleted: r.deleted ? true : undefined })),
            more: more || undefined,
        };
    }
    const reply = { collections: out };
    if (b.media) reply.media = (await env.DB.prepare("SELECT DISTINCT id FROM media WHERE account = ?").bind(me.account).all()).results.map((r) => r.id);
    return json(reply);
}

async function dropMedia(env, account, ids) {
    const rows = (await env.DB.prepare("SELECT id, kind, size FROM media WHERE account = ? AND id IN (SELECT value FROM json_each(?))").bind(account, JSON.stringify(ids)).all()).results;
    if (!rows.length) return;
    await env.MEDIA.delete(rows.map((r) => `${account}/${r.id}.${r.kind}`));
    await env.DB.batch([
        env.DB.prepare("DELETE FROM media WHERE account = ? AND id IN (SELECT value FROM json_each(?))").bind(account, JSON.stringify(ids)),
        env.DB.prepare("UPDATE accounts SET media_bytes = MAX(0, media_bytes - ?) WHERE id = ?").bind(rows.reduce((n, r) => n + r.size, 0), account),
    ]);
}

async function putMedia(env, me, req, id, kind) {
    const type = (req.headers.get("Content-Type") || "").split(";")[0].trim();
    if (!/^[\w-]{1,80}$/.test(id) || !KINDS.has(kind) || !TYPES.test(type)) return fail("not a recording");
    const body = await req.arrayBuffer();
    if (!body.byteLength || body.byteLength > 15e6) return fail("not a recording");
    const a = await env.DB.prepare("SELECT media_bytes FROM accounts WHERE id = ?").bind(me.account).first();
    const old = await env.DB.prepare("SELECT size FROM media WHERE account = ? AND id = ? AND kind = ?").bind(me.account, id, kind).first();
    const grows = body.byteLength - (old ? old.size : 0);
    if (a.media_bytes + grows > MEDIA_LIMIT) return fail("this account's recordings are full (2 GB)", 413);
    await env.MEDIA.put(`${me.account}/${id}.${kind}`, body, { httpMetadata: { contentType: type } });
    await env.DB.batch([
        env.DB.prepare("INSERT INTO media (account, id, kind, type, size) VALUES (?, ?, ?, ?, ?) ON CONFLICT (account, id, kind) DO UPDATE SET type = excluded.type, size = excluded.size")
            .bind(me.account, id, kind, type, body.byteLength),
        env.DB.prepare("UPDATE accounts SET media_bytes = media_bytes + ? WHERE id = ?").bind(grows, me.account),
    ]);
    return json({ ok: true });
}

async function getMedia(env, me, id, kind) {
    const row = await env.DB.prepare("SELECT type FROM media WHERE account = ? AND id = ? AND kind = ?").bind(me.account, id, kind).first();
    const obj = row && await env.MEDIA.get(`${me.account}/${id}.${kind}`);
    if (!obj) return fail("no such recording", 404);
    return new Response(obj.body, { headers: { "Content-Type": row.type } });
}

// ---------- your data ----------
async function exportAll(env, me) {
    const a = await env.DB.prepare("SELECT email, created FROM accounts WHERE id = ?").bind(me.account).first();
    const records = (await env.DB.prepare("SELECT coll, k, value, updated, deleted FROM records WHERE account = ? AND deleted = 0").bind(me.account).all()).results;
    const collections = {};
    for (const r of records) (collections[r.coll] ||= {})[r.k] = { value: JSON.parse(r.value), updated: r.updated };
    const media = (await env.DB.prepare("SELECT id, kind, type, size FROM media WHERE account = ?").bind(me.account).all()).results;
    const devices = (await env.DB.prepare("SELECT name, created, seen FROM devices WHERE account = ?").bind(me.account).all()).results;
    return json({ service: "akko", exported: new Date().toISOString(), account: { email: a.email, created: new Date(a.created).toISOString() }, devices, collections, recordings: media });
}

async function deleteAccount(env, me, b) {
    const a = await env.DB.prepare("SELECT pass FROM accounts WHERE id = ?").bind(me.account).first();
    if (!(await checkPassword(String(b.password || ""), a.pass))) return fail("wrong password", 401);
    // the recordings (R2 lists and deletes up to 1000 at a time)
    for (;;) {
        const list = await env.MEDIA.list({ prefix: `${me.account}/`, limit: 1000 });
        if (!list.objects.length) break;
        await env.MEDIA.delete(list.objects.map((o) => o.key));
        if (!list.truncated) break;
    }
    await env.DB.batch([
        env.DB.prepare("DELETE FROM records WHERE account = ?").bind(me.account),
        env.DB.prepare("DELETE FROM media WHERE account = ?").bind(me.account),
        env.DB.prepare("DELETE FROM devices WHERE account = ?").bind(me.account),
        env.DB.prepare("DELETE FROM accounts WHERE id = ?").bind(me.account),
    ]);
    return json({ ok: true });
}

// ---------- reports ----------
async function report(env, req, b) {
    if (await limited(env, `report:${ipOf(req)}`, 5, 3600e3)) return fail("too many reports from here: try again in an hour", 429);
    const r = {
        version: text(b.version, 20), what: text(b.what, 4000), expected: text(b.expected, 2000), steps: text(b.steps, 3000),
        error: text(b.error, 4000), from: text(b.from, 200), contact: text(b.contact, 200),
        diagnostics: b.diagnostics && typeof b.diagnostics === "object" ? JSON.stringify(b.diagnostics, null, 1).slice(0, 30000) : "",
    };
    if (!r.what) return fail("say what happened first");
    // the picture, at an address only its issue knows
    let picture = "";
    const m = typeof b.picture === "string" && b.picture.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/);
    if (m && m[2].length < 3e6) {
        const ext = m[1] === "jpeg" ? "jpg" : m[1];
        const key = `${b64url(random(18))}.${ext}`;
        await env.MEDIA.put(`reports/${key}`, Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0)), { httpMetadata: { contentType: `image/${m[1]}` } });
        picture = `${new URL(req.url).origin}/reports/${key}`;
    }
    const body = [
        `**What happened**\n${r.what}`,
        r.expected && `**What I expected**\n${r.expected}`,
        r.steps && `**Steps**\n${r.steps}`,
        r.error && `**Error**\n\`\`\`\n${r.error}\n\`\`\``,
        r.from && `**From**\n${r.from}`,
        picture && `**Picture**\n![the problem](${picture})`,
        r.diagnostics && `<details><summary>Diagnostics</summary>\n\n\`\`\`json\n${r.diagnostics}\n\`\`\`\n</details>`,
        `_Sent from akko ${r.version || ""}${r.contact ? " (the person left a contact address for a reply)" : ""}._`,
    ].filter(Boolean).join("\n\n");
    const title = r.what.split("\n")[0].slice(0, 80);
    let issue = "";
    if (env.GITHUB_TOKEN && env.GITHUB_REPO) {
        const gh = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/issues`, {
            method: "POST",
            headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: "application/vnd.github+json", "User-Agent": "akko-cloud", "Content-Type": "application/json" },
            body: JSON.stringify({ title, body, labels: ["from-app"] }),
        });
        if (gh.ok) issue = (await gh.json()).html_url || "";
    }
    await env.DB.prepare("INSERT INTO reports (at, version, contact, body, issue) VALUES (?, ?, ?, ?, ?)").bind(Date.now(), r.version, r.contact, body, issue).run();
    return json({ issue: issue || null });
}

// ---------- routes ----------
export default {
    async fetch(req, env) {
        const url = new URL(req.url);
        const p = url.pathname.replace(/\/+$/, "") || "/";
        const body = async () => { try { return await req.json(); } catch { return {}; } };
        try {
            if (req.method === "GET" && p === "/") return json({ service: "akko", ok: true });
            if (req.method === "POST" && p === "/signup") return await signup(env, req, await body());
            if (req.method === "POST" && p === "/signin") return await signin(env, req, await body());
            if (req.method === "POST" && p === "/recover") return await recover(env, req, await body());
            if (req.method === "POST" && p === "/report") return await report(env, req, await body());
            const pic = p.match(/^\/reports\/([\w-]+\.(png|jpg|webp))$/);
            if (req.method === "GET" && pic) {
                const obj = await env.MEDIA.get(`reports/${pic[1]}`);
                return obj ? new Response(obj.body, { headers: { "Content-Type": obj.httpMetadata?.contentType || "image/png" } }) : fail("no such picture", 404);
            }

            const me = await who(env, req);
            if (!me) return fail("sign in again", 401);
            if (req.method === "POST" && p === "/signout") { await env.DB.prepare("DELETE FROM devices WHERE id = ?").bind(me.device).run(); return json({ ok: true }); }
            if (req.method === "GET" && p === "/devices") {
                const rows = (await env.DB.prepare("SELECT id, name, created, seen FROM devices WHERE account = ? ORDER BY seen DESC").bind(me.account).all()).results;
                return json({ email: me.email, devices: rows.map((d) => ({ ...d, current: d.id === me.device })) });
            }
            const dev = p.match(/^\/devices\/([\w-]+)$/);
            if (req.method === "DELETE" && dev) { await env.DB.prepare("DELETE FROM devices WHERE id = ? AND account = ?").bind(dev[1], me.account).run(); return json({ ok: true }); }
            if (req.method === "POST" && p === "/sync") return await sync(env, me, await body());
            const media = p.match(/^\/media\/([\w-]+)\/(audio|picture)$/);
            if (media && req.method === "PUT") return await putMedia(env, me, req, media[1], media[2]);
            if (media && req.method === "GET") return await getMedia(env, me, media[1], media[2]);
            if (req.method === "GET" && p === "/export") return await exportAll(env, me);
            if (req.method === "DELETE" && p === "/account") return await deleteAccount(env, me, await body());
            return fail("not found", 404);
        } catch (err) {
            console.error(err);
            return fail("something went wrong on akko's side", 500);
        }
    },
};
