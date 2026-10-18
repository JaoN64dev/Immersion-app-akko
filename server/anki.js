// AnkiConnect passthrough: POST /api/anki
// Going through the server means no CORS setup in Anki, since AnkiConnect only
// checks the Origin header, which server-side fetch doesn't send.

const express = require('express');

const ANKI_CONNECT = process.env.AKKO_ANKI || 'http://127.0.0.1:8765';      // AKKO_ANKI: AnkiConnect somewhere else
const router = express.Router();

router.post('/', express.json({ limit: '50mb' }), async (req, res) => {
  try {
    const r = await fetch(ANKI_CONNECT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
    });
    res.json(await r.json());
  } catch {
    res.status(502).json({ error: "can't reach Anki. is it open with the AnkiConnect add-on (2055492159) installed?" });
  }
});

module.exports = { router };
