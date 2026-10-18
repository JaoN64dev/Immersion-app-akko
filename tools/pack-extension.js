// Packs the browser extension (extension/) into dist/akko-companion-<version>.zip, for the GitHub
// release (the website's download button links to it). `npm run dist` runs this first.
// The installed app carries the folder itself (package.json build.extraResources).

const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

const root = path.join(__dirname, '..');
const dir = path.join(root, 'extension');
const { version } = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
const out = path.join(root, 'dist', `akko-companion-${version}.zip`);

const zip = new AdmZip();
// the files at the top of the zip: Windows' "Extract All" already makes a folder named after it,
// and that folder is the one to pick in Chrome's "Load unpacked"
zip.addLocalFolder(dir);
fs.mkdirSync(path.dirname(out), { recursive: true });
zip.writeZip(out);
console.log(`extension ${version} -> ${path.relative(root, out)} (${zip.getEntries().length} files)`);
