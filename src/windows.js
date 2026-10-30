'use strict';
// Açık VS Code pencerelerini bulur, projelerle eşleştirir ve tek tek kapatır.
const path = require('path');
const { execFile } = require('child_process');

const SCRIPT = path.join(__dirname, 'vscode-windows.ps1');

function runScript(args) {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, ...args],
      { windowsHide: true, timeout: 30000, encoding: 'utf8' }, (err, stdout, stderr) => {
        if (err) return reject(new Error((stderr || err.message).trim().split('\n')[0]));
        resolve(stdout.trim());
      });
  });
}

/** Açık VS Code pencereleri: [{ hwnd, title }] */
async function listWindows() {
  const out = await runScript(['-Action', 'list']);
  const arr = out ? JSON.parse(out) : [];
  return arr.filter((w) => /Visual Studio Code/.test(w.title));
}

// VS Code başlığı: "[● ]dosya - klasör - Visual Studio Code" ya da "klasör - Visual Studio Code".
function titleParts(title) {
  const parts = title.replace(/^●\s*/, '').split(' - ').map((s) => s.trim());
  return parts.slice(0, -1); // uygulama adını at
}

/** Pencerenin hangi projeye ait olduğunu bulur (klasör adı başlıkta en sağdaki eşleşme). */
function projectOfWindow(win, projects) {
  const parts = titleParts(win.title);
  let best = null;
  let bestIdx = -1;
  for (const p of projects) {
    const idx = parts.lastIndexOf(p.name);
    if (idx > bestIdx) { best = p; bestIdx = idx; }
  }
  return best;
}

/** Bu projeye ait açık pencereler. */
async function windowsOf(project, projects) {
  const wins = await listWindows();
  return wins.filter((w) => {
    const p = projectOfWindow(w, projects);
    return p && p.hash === project.hash;
  });
}

/** Pencereyi kapatmayı dener; kaydedilmemiş dosya varsa VS Code sorar ve pencere açık kalır. */
async function closeWindow(hwnd) {
  const r = await runScript(['-Action', 'close', '-Handle', String(hwnd)]);
  return r === 'closed';
}

module.exports = { listWindows, projectOfWindow, windowsOf, closeWindow };
