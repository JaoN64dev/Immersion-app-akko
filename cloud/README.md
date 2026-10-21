# akko's online service

The only part of akko that runs on the internet: **akko accounts** (your word list and mined words, with their recordings, the same on every computer) and **problem reports** (Settings → Report a problem, which become GitHub issues). There's no website here and no web app: people keep downloading akko, and akko's local server (`server/cloud.js`, `server/diagnostics.js`) talks to this service in the background. Without an account, nothing leaves the computer.

It's a [Cloudflare Worker](https://developers.cloudflare.com/workers/) (`src/worker.js`) with [D1](https://developers.cloudflare.com/d1/) (SQLite: accounts, devices, records, reports; `schema.sql`) and [R2](https://developers.cloudflare.com/r2/) (the recordings, and pictures sent with reports). The free plans go a long way: about 100,000 requests a day (akko syncs once a minute while it's open), 5 GB of database and 10 GB of recordings (a mined word's line and picture are ~150 KB).

## What it keeps (the privacy notice akko shows next to sign-up)

- **What**: the e-mail; the password as a PBKDF2 hash (never the password); the word list (each word's status); mined words (the word, its reading and meaning, the sentence and its translation, where and when it's from) and their recordings (the line's audio and a picture); the names of the computers signed in, and when each was last used. Reports: what the person wrote, akko's diagnostics (nothing personal: no words, no file names; the home folder, user name and e-mails are taken out), a picture if they added one, and a contact address if they left one, which stays in the database and never goes into the public issue.
- **Why**: only to keep a person's computers in step, and to fix akko. No ads, no analytics, nothing sold or shared.
- **Yours**: Settings → akko account → **download my data** gives everything; **delete the account** removes everything, recordings too. Recovery codes replace "forgot my password" e-mails, so no e-mail is ever sent.

## Setting it up (once)

1. Make a free [Cloudflare account](https://dash.cloudflare.com/sign-up).
2. Create the database and the bucket (with Node.js installed, from this folder):
   ```
   npx wrangler@4 login
   npx wrangler@4 d1 create akko
   npx wrangler@4 r2 bucket create akko-recordings
   ```
   `d1 create` prints the database's id.
3. A GitHub token that can open issues on the repository (fine-grained: *Issues: read and write*), for reports:
   `npx wrangler@4 secret put GITHUB_TOKEN`
4. In the GitHub repository, **Settings → Secrets and variables → Actions**, add:
   - `CLOUDFLARE_API_TOKEN`: a Cloudflare API token from the *Edit Cloudflare Workers* template, with *D1: Edit* added
   - `CLOUDFLARE_ACCOUNT_ID`: on the Cloudflare dashboard's right side
   - `CLOUDFLARE_D1_ID`: the database's id from step 2
5. Push a change to `cloud/` (or run the **cloud** workflow by hand): `.github/workflows/cloud.yml` applies `schema.sql` and deploys. The service's address is printed at the end, like `https://akko-cloud.<you>.workers.dev`.
6. Put that address in akko's `package.json`:
   ```json
   "akko": { "cloud": "https://akko-cloud.<you>.workers.dev" }
   ```
   From the next build, Settings shows **akko account**, and reports go straight to GitHub issues. (`AKKO_CLOUD=<address>` does the same without a build.)

## Working on it

- `node tools/cloud-local.mjs` runs this service on this computer (D1 is a SQLite file, R2 a folder, in `cloud-local/`), then `AKKO_CLOUD=http://127.0.0.1:8787 npm start`.
- `tests/cloud.test.mjs` (the service) and `tests/cloud-sync.test.mjs` (two computers, one account) run with `npm test`.
- `npx wrangler@4 dev` runs it with Cloudflare's own local runtime (needs `database_id` in `wrangler.toml`).

## API

See the top of `src/worker.js`. Sign-up, sign-in and recovery give a device token (only its SHA-256 is stored); every other call sends it as `Authorization: Bearer <token>`. Sync is per record (`words-ja`, `words-en`, `mined`): the last change wins, deletions are kept as tombstones, a change with `updated: 0` is only added where there's nothing yet.
