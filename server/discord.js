// Discord Rich Presence: shows "akko" on your Discord profile while the server runs.
// Talks to the Discord desktop app over its local IPC socket, so there is nothing to install
// and no network access involved. If Discord isn't running it stays quiet and keeps retrying.
//
// Setup (once):
//   1. https://discord.com/developers/applications -> New Application, name it what you want
//      shown after "Playing" (e.g. "akko").
//   2. Copy the Application ID and paste it into CLIENT_ID below (or set DISCORD_CLIENT_ID).
//   3. Optional: Rich Presence -> Art Assets -> upload an image named "akko" for the big icon.
//
// Discord also has to have "Settings -> Activity Privacy -> Share your detected activities"
// (a.k.a. "Display current activity as a status message") turned on.

const net = require('net');
const express = require('express');

const CLIENT_ID = process.env.DISCORD_CLIENT_ID || '1553844734705926194';

// What the presence says. Edit freely.
const ACTIVITY = {
  type: 0,                       // 0 Playing, 2 Listening, 3 Watching, 5 Competing
  details: 'Immersing in Japanese',
  state: 'Local immersion player',
  assets: { large_image: 'akko', large_text: 'akko immersion player' },
};

// IPC opcodes
const OP_HANDSHAKE = 0;
const OP_FRAME = 1;
const OP_CLOSE = 2;
const OP_PING = 3;
const OP_PONG = 4;

const RETRY_MS = 15000;

let socket = null;          // connected pipe, once the handshake succeeds
let activity = null;        // current presence (null = nothing to show)
let startedAt = 0;          // "elapsed" timer shown by Discord
let retryTimer = null;
let nonce = 0;
let warned = false;

// Discord listens on discord-ipc-0..9; several may exist when more than one client is open.
function pipePaths() {
  const paths = [];
  for (let i = 0; i < 10; i++) {
    if (process.platform === 'win32') {
      paths.push(`\\\\?\\pipe\\discord-ipc-${i}`);
    } else {
      const base = process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || process.env.TMP || '/tmp';
      // flatpak/snap installs nest the socket one directory deeper
      for (const dir of ['', '/app/com.discordapp.Discord', '/snap.discord']) {
        paths.push(`${base}${dir}/discord-ipc-${i}`);
      }
    }
  }
  return paths;
}

function encode(op, payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  const head = Buffer.alloc(8);
  head.writeInt32LE(op, 0);
  head.writeInt32LE(body.length, 4);
  return Buffer.concat([head, body]);
}

// Frames can arrive split or batched, so keep a buffer and pull off whole packets.
function reader(onPacket) {
  let buf = Buffer.alloc(0);
  return (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 8) {
      const len = buf.readInt32LE(4);
      if (buf.length < 8 + len) return;
      const op = buf.readInt32LE(0);
      const body = buf.subarray(8, 8 + len);
      buf = buf.subarray(8 + len);
      let data = null;
      try { data = JSON.parse(body.toString('utf8')); } catch { /* ignore junk */ }
      onPacket(op, data);
    }
  };
}

function send(op, payload) {
  if (!socket || socket.destroyed) return;
  try { socket.write(encode(op, payload)); } catch { /* the close handler reconnects */ }
}

function push() {
  send(OP_FRAME, {
    cmd: 'SET_ACTIVITY',
    nonce: `${process.pid}-${++nonce}`,
    args: {
      pid: process.pid,
      activity: activity && { ...activity, timestamps: { start: startedAt } },
    },
  });
}

function scheduleRetry() {
  if (retryTimer || !activity) return;
  retryTimer = setTimeout(() => { retryTimer = null; connect(); }, RETRY_MS);
  retryTimer.unref();
}

// Tries each pipe in turn; resolves once one of them completes the handshake.
function connect(paths = pipePaths()) {
  if (socket || !activity || !CLIENT_ID) return;
  const path = paths.shift();
  if (!path) return scheduleRetry();         // no Discord right now, try again later

  const sock = net.createConnection({ path });
  sock.setNoDelay(true);
  let ready = false;

  const fail = () => {
    sock.destroy();
    if (ready) {                             // we were connected and lost it
      if (socket === sock) socket = null;
      scheduleRetry();
    } else {
      connect(paths);                        // this pipe was not Discord, try the next
    }
  };

  sock.on('error', fail);
  sock.on('close', fail);
  sock.on('connect', () => sock.write(encode(OP_HANDSHAKE, { v: 1, client_id: CLIENT_ID })));
  sock.on('data', reader((op, data) => {
    if (op === OP_PING) return sock.write(encode(OP_PONG, data));
    if (op === OP_CLOSE) return fail();
    if (op !== OP_FRAME) return;
    if (data?.evt === 'READY' && !ready) {
      ready = true;
      socket = sock;
      push();
    } else if (data?.evt === 'ERROR') {
      // usually a bad client_id; retrying would just loop, so say it once and stop
      if (!warned) {
        warned = true;
        console.log('Discord presence rejected: ' + (data.data?.message || 'unknown error'));
      }
      activity = null;
      sock.destroy();
    }
  }));
}

// Change what the presence says while the server is up, e.g.
// update({type: 3, details: 'Show Title', state: 'ep 3 — 04:12 / 23:00'}).
// details/state fully replace the previous ones (rather than merging) so switching from,
// say, a podcast to a video doesn't leave the episode title stuck behind the show name.
function update({ type = 0, details, state } = {}) {
  if (!activity) return;
  activity = { ...activity, type, details, state };
  push();
}

// Back to the plain "Immersing in Japanese" presence, e.g. when nothing is open.
function reset() {
  if (!activity) return;
  activity = ACTIVITY;
  push();
}

function init() {
  if (!CLIENT_ID) return;                    // not configured: no presence, no noise
  activity = ACTIVITY;
  startedAt = Date.now();
  connect();
  // Discord drops the presence by itself when the pipe closes, so exiting is enough
  for (const sig of ['SIGINT', 'SIGTERM']) process.once(sig, () => process.exit(0));
}

// POST {type, details, state} to show it on the profile, or {} to go back to the default.
const router = express.Router();
router.post('/', express.json(), (req, res) => {
  const { type, details, state } = req.body || {};
  if (details || state) update({ type, details, state });
  else reset();
  res.json({ ok: true });
});

module.exports = { init, update, reset, router };
