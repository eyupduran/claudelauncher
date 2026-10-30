'use strict';
// Gözetleyici: botu ayrı süreçte çalıştırır, çökerse 5 sn sonra yeniden başlatır.
// Aynı anda tek kopya çalışması için kilit dosyası kullanır.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { log } = require('./log');

const LOCK = path.join(__dirname, '..', 'claudelauncher.lock');

function alreadyRunning() {
  try {
    const pid = Number(fs.readFileSync(LOCK, 'utf8'));
    if (pid && pid !== process.pid) { process.kill(pid, 0); return pid; }
  } catch { /* kilit yok ya da süreç ölü */ }
  return 0;
}

const other = alreadyRunning();
if (other) {
  log(`ClaudeLauncher zaten çalışıyor (pid ${other}). Çıkılıyor.`);
  process.exit(0);
}
fs.writeFileSync(LOCK, String(process.pid));
const cleanup = () => { try { if (Number(fs.readFileSync(LOCK, 'utf8')) === process.pid) fs.rmSync(LOCK); } catch { /* yoksay */ } };
process.on('exit', cleanup);
for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK']) process.on(sig, () => process.exit(0));

let child = null;
let firstStart = true;
function start() {
  // Açılış bildirimi sadece ilk başlatmada gitsin; çökme sonrası yeniden başlatmalarda değil.
  const env = { ...process.env, CL_FIRST_START: firstStart ? '1' : '0' };
  firstStart = false;
  child = spawn(process.execPath, [path.join(__dirname, 'bot.js')], { stdio: 'inherit', windowsHide: true, env });
  child.on('exit', (code) => {
    child = null;
    if (code === 2) { log('Ayar hatası nedeniyle bot durdu; config.json düzeltilince servisi yeniden başlat.'); process.exit(2); }
    log(`Bot kapandı (kod ${code}), 5 sn sonra yeniden başlatılıyor.`);
    setTimeout(start, 5000);
  });
}
process.on('exit', () => { if (child) child.kill(); });

log('ClaudeLauncher başlatılıyor…');
start();
