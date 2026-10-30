'use strict';
// Bilgisayarda VS Code'u açar, Claude Code eklentisine oturumu açtırır ve ekran görüntüsü alır.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFile } = require('child_process');

function findCodeExe(configured) {
  const candidates = [
    configured,
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Microsoft VS Code', 'Code.exe'),
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Microsoft VS Code', 'Code.exe'),
  ].filter(Boolean);
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) throw new Error('Code.exe bulunamadı. config.json içinde "codePath" ayarla.');
  return found;
}

// Servis bir VS Code terminalinden başlatılmışsa bu değişkenler VS Code'u
// yanlış modda (ör. Node olarak) çalıştırabilir; temizliyoruz.
function cleanEnv() {
  const env = { ...process.env };
  for (const k of Object.keys(env)) {
    if (/^(ELECTRON_|VSCODE_|CLAUDE_CODE_|CLAUDECODE)/i.test(k)) delete env[k];
  }
  return env;
}

function runDetached(exe, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { detached: true, stdio: 'ignore', env: cleanEnv(), windowsHide: false });
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolve(); });
  });
}

function isCodeRunning() {
  return new Promise((resolve) => {
    execFile('tasklist', ['/FI', 'IMAGENAME eq Code.exe', '/NH'], { windowsHide: true }, (err, out) => {
      resolve(!err && /Code\.exe/i.test(out));
    });
  });
}

// vscode-helper/ (npm run install-vscode-helper) VS Code'a kurulu mu?
function hasHelper() {
  const dir = path.join(os.homedir(), '.vscode', 'extensions');
  try {
    return fs.readdirSync(dir).some((n) => n.toLowerCase().startsWith('claudelauncher.helper-'));
  } catch {
    return false;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Projeyi VS Code'da açar, ardından Claude Code panelini
 * (sessionId verilirse o oturumla, verilmezse yeni oturumla) açar.
 */
async function openProject({ cwd, sessionId, codePath, warmDelayMs, coldDelayMs }) {
  const codeExe = findCodeExe(codePath);
  const wasRunning = await isCodeRunning();

  await runDetached(codeExe, [cwd]);

  // Link, en son odaklanan VS Code penceresine gider. Yeni pencerenin
  // açılıp odak almasını bekliyoruz; yoksa link eski pencereye düşebilir.
  await sleep(wasRunning ? warmDelayMs : coldDelayMs);

  // Yardımcı eklenti kuruluysa oturum sağ panelde, değilse ortadaki sekmede açılır.
  let uri = hasHelper() ? 'vscode://claudelauncher.helper/open' : 'vscode://anthropic.claude-code/open';
  if (sessionId) uri += `?session=${encodeURIComponent(sessionId)}`;
  await runDetached(codeExe, ['--open-url', uri]);
  return { wasRunning };
}

const SCREENSHOT_PS = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Add-Type -Name Dpi -Namespace W -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();'
[W.Dpi]::SetProcessDPIAware() | Out-Null
$b = [System.Windows.Forms.SystemInformation]::VirtualScreen
$bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($b.Left, $b.Top, 0, 0, $bmp.Size)
$bmp.Save($args[0], [System.Drawing.Imaging.ImageFormat]::Png)
`;

/** Tüm ekranların görüntüsünü PNG olarak döndürür. */
function screenshot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudelauncher-'));
  const script = path.join(dir, 'shot.ps1');
  const out = path.join(dir, 'screen.png');
  fs.writeFileSync(script, SCREENSHOT_PS, 'utf8');
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, out],
      { windowsHide: true, timeout: 30000 }, (err, _stdout, stderr) => {
        try {
          if (err) throw new Error((stderr || err.message).trim().split('\n')[0]);
          resolve(fs.readFileSync(out));
        } catch (e) {
          reject(e);
        } finally {
          fs.rm(dir, { recursive: true, force: true }, () => {});
        }
      });
  });
}

module.exports = { openProject, screenshot, isCodeRunning };
