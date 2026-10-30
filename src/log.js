'use strict';
const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'claudelauncher.log');
fs.mkdirSync(LOG_DIR, { recursive: true });

// Log 2 MB'ı geçince eskisini .old olarak saklar.
function rotate() {
  try {
    if (fs.statSync(LOG_FILE).size > 2 * 1024 * 1024) fs.renameSync(LOG_FILE, LOG_FILE + '.old');
  } catch { /* dosya yok */ }
}

function log(...args) {
  const line = `[${new Date().toLocaleString('tr-TR')}] ${args.map((a) => (a instanceof Error ? a.stack || a.message : String(a))).join(' ')}`;
  console.log(line);
  try { rotate(); fs.appendFileSync(LOG_FILE, line + '\n', 'utf8'); } catch { /* yoksay */ }
}

module.exports = { log, LOG_FILE };
