// akko's online service (cloud/src/worker.js) on this computer, without Cloudflare: D1 is a
// SQLite file and R2 a folder, both in the folder given (default: cloud-local/ here, which git
// ignores). For trying akko accounts and reports while working on them:
//   node tools/cloud-local.mjs [folder] [port]        then start akko with AKKO_CLOUD=http://127.0.0.1:8787
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { DatabaseSync } from "node:sqlite";
import worker from "../cloud/src/worker.js";

const dir = path.resolve(process.argv[2] || "cloud-local");
const port = Number(process.argv[3]) || 8787;
fs.mkdirSync(path.join(dir, "r2"), { recursive: true });

const db = new DatabaseSync(path.join(dir, "d1.sqlite"));
db.exec(fs.readFileSync(new URL("../cloud/schema.sql", import.meta.url), "utf8"));
const statement = (sql, params = []) => ({
    bind: (...p) => statement(sql, p),
    first: async () => db.prepare(sql).get(...params) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...params) }),
    run: async () => ({ meta: { changes: db.prepare(sql).run(...params).changes } }),
    now: () => db.prepare(sql).run(...params),
});
const file = (key) => path.join(dir, "r2", encodeURIComponent(key));
const env = {
    GITHUB_REPO: process.env.GITHUB_REPO || "",
    GITHUB_TOKEN: process.env.GITHUB_TOKEN || "",
    DB: {
        prepare: (sql) => statement(sql),
        batch: async (list) => { db.exec("BEGIN"); try { list.forEach((s) => s.now()); db.exec("COMMIT"); } catch (e) { db.exec("ROLLBACK"); throw e; } return []; },
    },
    MEDIA: {
        put: async (key, body, o = {}) => {
            fs.writeFileSync(file(key), Buffer.from(body instanceof ArrayBuffer ? body : body.buffer || body));
            fs.writeFileSync(`${file(key)}.type`, (o.httpMetadata && o.httpMetadata.contentType) || "");
        },
        get: async (key) => (fs.existsSync(file(key)) ? { body: fs.readFileSync(file(key)), httpMetadata: { contentType: fs.readFileSync(`${file(key)}.type`, "utf8") } } : null),
        delete: async (keys) => { for (const k of [].concat(keys)) { fs.rmSync(file(k), { force: true }); fs.rmSync(`${file(k)}.type`, { force: true }); } },
        list: async ({ prefix = "", limit = 1000 } = {}) => {
            const keys = fs.readdirSync(path.join(dir, "r2")).filter((f) => !f.endsWith(".type")).map(decodeURIComponent).filter((k) => k.startsWith(prefix));
            return { objects: keys.slice(0, limit).map((key) => ({ key })), truncated: keys.length > limit };
        },
    },
};

http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const r = await worker.fetch(new Request(`http://127.0.0.1:${port}${req.url}`, {
        method: req.method, headers: req.headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks),
    }), env);
    res.writeHead(r.status, Object.fromEntries(r.headers));
    res.end(Buffer.from(await r.arrayBuffer()));
}).listen(port, "127.0.0.1", () => console.log(`akko's online service, locally: http://127.0.0.1:${port} (data in ${dir})`));
