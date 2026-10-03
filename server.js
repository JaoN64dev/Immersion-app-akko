// akko immersion player: local server
//   - serves the site
//   - /api/subs/*   Japanese subtitles (kitsunekko.net + GitHub mirror)   server/subtitles.js
//   - /api/dict, /api/tokenize   offline dictionary + word splitting     server/dictionary.js
//   - /api/anki     AnkiConnect passthrough                               server/anki.js
//   - /api/audio    word pronunciation audio                              server/audio.js
//   - /api/ocr      manga OCR with mokuro (runs locally)                  server/ocr.js
//   - Discord Rich Presence while the server runs                        server/discord.js
//   - /api/podcasts podcast feeds + transcripts                           server/podcasts.js
//   - /api/grammar  grammar lessons from ./grammar/*.md                   server/grammar.js
//   - /api/course   the learning path from ./course/*.md                  server/course.js
//   - /api/opensubs English subtitles from OpenSubtitles (your API key)   server/opensubtitles.js

const path = require('path');
const express = require('express');
const subtitles = require('./server/subtitles');
const dictionary = require('./server/dictionary');
const anki = require('./server/anki');
const audio = require('./server/audio');
const ocr = require('./server/ocr');
const podcasts = require('./server/podcasts');
const discord = require('./server/discord');
const grammar = require('./server/grammar');
const course = require('./server/course');
const opensubs = require('./server/opensubtitles');

const hostname = '127.0.0.1';
const port = 3000;

const app = express();

// ---------- API ----------
app.use('/api/subs', subtitles.router);
app.use('/api', dictionary.router);
app.use('/api/anki', anki.router);
app.use('/api/audio', audio.router);
app.use('/api/ocr', ocr.router);
app.use('/api/podcasts', podcasts.router);
app.use('/api/presence', discord.router);
app.use('/api/grammar', grammar.router);
app.use('/api/course', course.router);
app.use('/api/opensubs', opensubs.router);

// ---------- static site (only the files the pages need) ----------
const file = (name) => (req, res) => res.sendFile(path.join(__dirname, name));
app.get(['/', '/index.html'], file('index.html'));
app.get('/reading.html', file('reading.html'));
app.get('/podcasts.html', file('podcasts.html'));
app.get('/settings.html', file('settings.html'));
app.get('/review.html', file('review.html'));
app.get('/stats.html', (req, res) => res.redirect('/settings.html#stats-section'));    // stats moved to settings
app.get('/grammar.html', file('grammar.html'));
app.get('/course.html', file('course.html'));
app.get('/about.html', file('about.html'));
app.get('/style.css', file('style.css'));
for (const dir of ['scripts', 'images', 'fonts', 'node_modules/@ffmpeg']) {
  app.use('/' + dir, express.static(path.join(__dirname, dir)));
}

// Run Server
app.listen(port, hostname, () => {
  const url = 'http://' + hostname + ':' + port;
  console.log('Server running at ' + url + '\n');
  // start-akko.bat sets AKKO_OPEN=1 so the page opens as soon as the server is up
  if (process.env.AKKO_OPEN && process.platform === 'win32') {
    require('child_process').exec(`start "" "${url}"`);
  }
  dictionary.init();
  discord.init();
});
