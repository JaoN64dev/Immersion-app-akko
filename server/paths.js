// Where the server keeps its files (dictionaries, caches, your OpenSubtitles login).
// Running from the folder (npm start, start-akko.bat): ./data next to server.js.
// The desktop app sets AKKO_DATA to a folder in your user profile, because the installed
// program's own folder can't be written to.

const path = require('path');

const DATA = process.env.AKKO_DATA || path.join(__dirname, '..', 'data');

module.exports = { DATA };
