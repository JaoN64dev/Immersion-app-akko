-- akko's online service (cloud/src/worker.js): D1 tables. Applied by the deploy workflow
-- (.github/workflows/cloud.yml) with `wrangler d1 execute akko --remote --file schema.sql`;
-- every statement can run again safely.

CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    pass TEXT NOT NULL,                 -- pbkdf2$iterations$salt$hash
    recovery TEXT NOT NULL,             -- SHA-256 of the recovery code
    v INTEGER NOT NULL DEFAULT 0,       -- the account's last version (records' v)
    media_bytes INTEGER NOT NULL DEFAULT 0,
    created INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY,
    account TEXT NOT NULL,
    token TEXT UNIQUE NOT NULL,         -- SHA-256 of the device's token
    name TEXT,
    created INTEGER NOT NULL,
    seen INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS devices_account ON devices (account);

-- words-ja / words-en: a word's status; mined: a mined word. The last change wins.
CREATE TABLE IF NOT EXISTS records (
    account TEXT NOT NULL,
    coll TEXT NOT NULL,
    k TEXT NOT NULL,
    value TEXT,                         -- JSON, NULL when deleted
    updated INTEGER NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0,
    v INTEGER NOT NULL,
    PRIMARY KEY (account, coll, k)
);
CREATE INDEX IF NOT EXISTS records_since ON records (account, coll, v);

-- a mined word's recordings, kept in R2 as <account>/<mined id>.<kind>
CREATE TABLE IF NOT EXISTS media (
    account TEXT NOT NULL,
    id TEXT NOT NULL,
    kind TEXT NOT NULL,
    type TEXT NOT NULL,
    size INTEGER NOT NULL,
    PRIMARY KEY (account, id, kind)
);

-- problem reports (their contact address stays here, out of the GitHub issue)
CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at INTEGER NOT NULL,
    version TEXT,
    contact TEXT,
    body TEXT,
    issue TEXT
);

-- rate limits: sign-in attempts, sign-ups, reports
CREATE TABLE IF NOT EXISTS hits (key TEXT NOT NULL, at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS hits_key ON hits (key, at);
