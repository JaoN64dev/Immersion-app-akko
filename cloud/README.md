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
   `d1 create` prints the database's id (that's `CLOUDFLARE_D1_ID`, step 3).
   **If it says `The bucket you tried to create already exists, and you own it. [code: 10004]`**, the
   bucket is there — that's the one you wanted, nothing to do.
   **If the bucket step fails with `Please enable R2 through the Cloudflare Dashboard. [code: 10042]`**,
   enable R2 first: dashboard → **R2 Object Storage** → *Enable R2* (it asks for a billing card;
   akko's recordings stay inside the free tier — 10 GB stored, 1 M writes and 10 M reads a month),
   then run the bucket command again. `wrangler deploy` fails without the bucket, because
   `wrangler.toml` binds it as `MEDIA`.
   Leave the `binding` snippet `d1 create` prints alone: `wrangler.toml` here already binds the
   database as `DB`, and the deploy workflow fills the id in from the secret.
3. In the GitHub repository, **Settings → Secrets and variables → Actions**, add:
   - `CLOUDFLARE_API_TOKEN`: a Cloudflare API token from the *Edit Cloudflare Workers* template, with *D1: Edit* added
   - `CLOUDFLARE_ACCOUNT_ID`: on the Cloudflare dashboard's right side
   - `CLOUDFLARE_D1_ID`: the database's id from step 2
4. Push a change to `cloud/` (or run the **cloud** workflow by hand): `.github/workflows/cloud.yml` applies `schema.sql` and deploys. The service's address is printed at the end, like `https://akko-cloud.<you>.workers.dev`.
5. **Only now**, the token that lets problem reports open issues — a fine-grained GitHub token
   with *Issues: read and write* on the repository, stored on the Worker (not in GitHub):
   ```
   cd cloud
   npx wrangler@4 secret put GITHUB_TOKEN
   ```
   Run it **from `cloud/`** (or add `--config cloud/wrangler.toml`): from the repository's root
   wrangler finds no `wrangler.toml` and says *Required Worker name missing*. It also needs the
   Worker to exist, so it goes after the first deploy — set before that, wrangler asks *"There
   doesn't seem to be a Worker called "akko-cloud". Do you want to create a new Worker with that
   name?"*: say **no**, deploy (step 4) and run it again. (Saying yes only makes an empty
   placeholder Worker; the next deploy replaces its code and keeps the secret, so it isn't fatal.)
   Accounts work without this token; only reports need it.
6. Put the address from step 4 in akko's `package.json`:
   ```json
   "akko": { "cloud": "https://akko-cloud.<you>.workers.dev" }
   ```
   From the next build, Settings shows **akko account**, and reports go straight to GitHub issues. (`AKKO_CLOUD=<address>` does the same without a build.)

## When the deploy fails

The workflow checks the three secrets, applies `schema.sql` and then, before deploying, looks for the
R2 bucket — so a run that dies at *Deploy* usually means one of these:

- **`The bucket` step fails**: there's no `akko-recordings` bucket. Enable R2 in the dashboard
  (*R2 Object Storage → Enable R2*), then `npx wrangler@4 r2 bucket create akko-recordings` from
  `cloud/` (step 2). The Worker binds it as `MEDIA`; `wrangler deploy` won't go without it.
- **`The bucket` step only warns**: the API token can't list buckets. Add *Account → Workers R2
  Storage → Read* to the token (or ignore it, if the bucket is really there).
- ***Deploy* fails after that** (or says *You need a workers.dev subdomain*): a new Cloudflare
  account has no `workers.dev` name yet. Workers & Pages → *Your subdomain* → pick one, then run the
  workflow again. `wrangler deploy` from your own computer asks for it interactively, which is the
  quickest way to get it set.
- ***Tables* fails**: the token has no *D1: Edit* (create a new token, step 3), or
  `CLOUDFLARE_D1_ID` isn't the id `d1 create` printed.
- ***The database's id* fails**: `CLOUDFLARE_D1_ID` isn't a UUID — `npx wrangler@4 d1 list` prints the
  real one (the account id, for instance, is the wrong 32-character thing to paste).
- ***Deploy* fails with `Authentication error`**: the token is missing *Account → Workers Scripts →
  Edit*, which the *Edit Cloudflare Workers* template gives — recreate the token rather than editing
  a secret that is write-only.

Running the same commands locally (`cd cloud`, then `npx wrangler@4 deploy`) shows the same error
with the whole message in front of you, which is faster than reading it out of a CI log — and it's
also the quickest way to get the service up: put your database id in `cloud/wrangler.toml`
(`database_id = "<the id>"`, in an editor, not with PowerShell's `-replace`, which can turn the file
into UTF-16) and deploy. Afterwards put the placeholder back, from inside `cloud/`:
`git checkout wrangler.toml` (not `git checkout cloud/wrangler.toml` — there's no `cloud/cloud`).

## Working on it

- `node tools/cloud-local.mjs` runs this service on this computer (D1 is a SQLite file, R2 a folder, in `cloud-local/`), then `AKKO_CLOUD=http://127.0.0.1:8787 npm start`.
- `tests/cloud.test.mjs` (the service) and `tests/cloud-sync.test.mjs` (two computers, one account) run with `npm test`.
- `npx wrangler@4 dev` runs it with Cloudflare's own local runtime (needs `database_id` in `wrangler.toml`).

## API

See the top of `src/worker.js`. Sign-up, sign-in and recovery give a device token (only its SHA-256 is stored); every other call sends it as `Authorization: Bearer <token>`. Sync is per record (`words-ja`, `words-en`, `mined`): the last change wins, deletions are kept as tombstones, a change with `updated: 0` is only added where there's nothing yet.
