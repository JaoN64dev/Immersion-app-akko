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
//   - /api/dictionaries  Yomitan dictionaries you added (Settings)        server/dictionaries.js
//   - /api/listening 聴解 listening exercises from ./listening/*.md        server/listening.js
//   - /api/speech   Japanese speech, VOICEVOX or Windows' voices          server/speech.js
//   - /api/speech/voicevox  starts / installs VOICEVOX's engine            server/voicevox.js
//   - /api/backups  automatic backups of what the pages saved               server/backups.js
//   - /api/lan      using akko from a phone on the same Wi-Fi (off by default) server/lan.js
//   - /api/diagnostics, /api/report   what akko runs on; reporting a problem  server/diagnostics.js

// first: it keeps the warnings and errors every other part prints, for the diagnostics
const diagnostics = require('./server/diagnostics');
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
const { guard } = require('./server/guard');
const dictionaries = require('./server/dictionaries');
const listening = require('./server/listening');
const speech = require('./server/speech');
const voicevox = require('./server/voicevox');
const backups = require('./server/backups');
const lan = require('./server/lan');
const companion = require('./server/companion');
const words = require('./server/words');

const hostname = '127.0.0.1';

const app = express();

// only akko's own pages may use the server (other websites can reach 127.0.0.1 too)
app.use(guard);

// ---------- API ----------
app.use('/api/subs', subtitles.router);
app.use('/api/dictionaries', dictionaries.router);
app.use('/api', dictionary.router);
app.use('/api/anki', anki.router);
app.use('/api/audio', audio.router);
app.use('/api/ocr', ocr.router);
app.use('/api/podcasts', podcasts.router);
app.use('/api/presence', discord.router);
app.use('/api/grammar', grammar.router);
app.use('/api/course', course.router);
app.use('/api/opensubs', opensubs.router);
app.use('/api/listening', listening.router);
// "is this akko?": how the browser extension finds akko among the programs on this computer
app.get('/api/hello', (req, res) => res.json({ app: 'akko', version: require('./package.json').version }));
app.use('/api', diagnostics.router);
app.use('/api/backups', backups.router);
app.use('/api/lan', lan.router);
app.use('/api/companion', companion.router);
app.use('/api/words', words.router);
app.use('/api/speech/voicevox', voicevox.router);
app.use('/api/speech', speech.router);

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
app.get('/listening.html', file('listening.html'));
app.get('/about.html', file('about.html'));
app.get('/lan-login', lan.loginPage);
app.get('/style.css', file('style.css'));
app.get('/favicon.ico', file('electron/icon.png'));     // the browser tab's icon: the app icon
for (const dir of ['scripts', 'images', 'fonts', 'samples', 'node_modules/@ffmpeg']) {
  app.use('/' + dir, express.static(path.join(__dirname, dir)));
}

// ---------- start ----------
// npm start / start-akko.bat run this file directly; the desktop app (electron/main.js) calls start().
// AKKO_PORT changes the port (the desktop app uses its own, so both can run at once).
function start(port = Number(process.env.AKKO_PORT) || 3000) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, hostname, () => {
      const url = 'http://' + hostname + ':' + port;
      console.log('Server running at ' + url + '\n');
      dictionary.init();
      discord.init();
      voicevox.start();          // natural voices for the listening drills, if VOICEVOX is here
      lan.start(app, port);      // the phone / tablet address, if that's turned on
      resolve(url);
    });
    server.on('error', reject);
  });
}

if (require.main === module) {
  start().then((url) => {
    // start-akko.bat sets AKKO_OPEN=1 so the page opens as soon as the server is up
    if (process.env.AKKO_OPEN && process.platform === 'win32') {
      require('child_process').exec(`start "" "${url}"`);
    }
  }, (err) => {
    console.error(err.code === 'EADDRINUSE' ? `Port ${err.port} is already in use: is akko already running?` : err);
    process.exit(1);
  });
}

module.exports = { start };
