// npm run desktop: starts the desktop app from the folder.
// Terminals inside VS Code set ELECTRON_RUN_AS_NODE, which makes Electron act as plain Node
// (no window), so it's removed here first.

const { spawn } = require('child_process');
const path = require('path');
const electron = require('electron');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

spawn(electron, [path.join(__dirname, '..'), ...process.argv.slice(2)], { stdio: 'inherit', env })
  .on('exit', (code) => process.exit(code ?? 0));
