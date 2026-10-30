'use strict';
// Claude Code'un ~/.claude/projects altındaki oturum geçmişini okur ve
// projelere (cwd) göre gruplar.
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');

// Dosya yolu -> { mtimeMs, size, info } ; değişmeyen dosyalar tekrar okunmaz.
const cache = new Map();

function hashOf(cwd) {
  return crypto.createHash('sha1').update(cwd.toLowerCase()).digest('hex').slice(0, 10);
}

function textOfUserMessage(o) {
  if (o.isMeta || o.isSidechain) return null;
  const c = o.message && o.message.content;
  const parts = typeof c === 'string' ? [c] : Array.isArray(c)
    ? c.filter((x) => x && x.type === 'text').map((x) => x.text)
    : [];
  for (const t of parts) {
    const s = (t || '').trim();
    if (s && !s.startsWith('<') && !s.startsWith('Caveat:')) return s;
  }
  return null;
}

const HEAD_BYTES = 512 * 1024;
const TAIL_BYTES = 2 * 1024 * 1024;

// Oturum dosyaları yüzlerce MB olabilir. Yol ve ilk mesaj dosyanın başında,
// güncel başlık ise sonunda olduğu için sadece baş ve son kısımları okuyoruz.
function readHeadTail(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const read = (start, len) => {
      const buf = Buffer.alloc(len);
      const n = fs.readSync(fd, buf, 0, len, start);
      return buf.subarray(0, n).toString('utf8');
    };
    if (size <= HEAD_BYTES + TAIL_BYTES) return read(0, size);
    return read(0, HEAD_BYTES) + '\n' + read(size - TAIL_BYTES, TAIL_BYTES);
  } finally {
    fs.closeSync(fd);
  }
}

function parseSessionFile(file) {
  const text = readHeadTail(file);
  let cwd = null;
  let customTitle = null;
  let aiTitle = null;
  let summary = null;
  let lastPrompt = null;
  let firstPrompt = null;

  for (const line of text.split('\n')) {
    if (!line) continue;
    if (line.startsWith('{"type":"custom-title"') || line.startsWith('{"type":"ai-title"') ||
        line.startsWith('{"type":"summary"') || line.startsWith('{"type":"last-prompt"')) {
      let o;
      try { o = JSON.parse(line); } catch { continue; }
      if (o.type === 'custom-title' && o.customTitle) customTitle = o.customTitle;
      else if (o.type === 'ai-title' && o.aiTitle) aiTitle = o.aiTitle;
      else if (o.type === 'summary' && o.summary) summary = o.summary;
      else if (o.type === 'last-prompt' && o.lastPrompt) lastPrompt = o.lastPrompt;
      continue;
    }
    const needCwd = !cwd && line.includes('"cwd":"');
    const needPrompt = !firstPrompt && line.includes('"type":"user"');
    if (!needCwd && !needPrompt) continue;
    let o;
    try { o = JSON.parse(line); } catch { o = null; }
    if (needCwd) {
      if (o && typeof o.cwd === 'string') cwd = o.cwd;
      else {
        // Satır kesik olsa bile (çok uzun satırlar) cwd alanını yakala.
        const m = line.match(/"cwd":("(?:[^"\\]|\\.)*")/);
        if (m) try { cwd = JSON.parse(m[1]); } catch { /* yoksay */ }
      }
    }
    if (needPrompt && o && o.type === 'user') firstPrompt = textOfUserMessage(o);
  }

  const title = customTitle || aiTitle || summary || lastPrompt || firstPrompt;
  return { cwd, title: title ? title.replace(/\s+/g, ' ').trim() : null, hasContent: Boolean(firstPrompt || title) };
}

function sessionInfo(file) {
  let st;
  try { st = fs.statSync(file); } catch { return null; }
  const hit = cache.get(file);
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.info;
  let info;
  try { info = parseSessionFile(file); } catch { info = null; }
  if (info) info.mtimeMs = st.mtimeMs;
  cache.set(file, { mtimeMs: st.mtimeMs, size: st.size, info });
  return info;
}

/**
 * Tüm projeleri, en son kullanılan en üstte olacak şekilde döndürür.
 * extraRoots: alt klasörleri de proje sayılacak kök klasörler.
 */
function getProjects(extraRoots = []) {
  let dirs = [];
  try { dirs = fs.readdirSync(PROJECTS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory()); } catch { return []; }

  const byCwd = new Map();
  for (const d of dirs) {
    const dir = path.join(PROJECTS_DIR, d.name);
    let files = [];
    try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')); } catch { continue; }
    for (const f of files) {
      const info = sessionInfo(path.join(dir, f));
      if (!info || !info.cwd || !info.hasContent) continue;
      const key = info.cwd.toLowerCase();
      if (!byCwd.has(key)) byCwd.set(key, { cwd: info.cwd, sessions: [] });
      byCwd.get(key).sessions.push({
        id: f.slice(0, -'.jsonl'.length),
        title: info.title || '(başlıksız)',
        mtimeMs: info.mtimeMs,
      });
    }
  }

  // Claude geçmişi olmayan (ya da eski oturumları silinmiş) klasörler de
  // listelensin diye proje köklerindeki (ör. Masaüstü) alt klasörleri ekle.
  for (const root of extraRoots) {
    let entries = [];
    try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (!e.isDirectory() || /^[.$]/.test(e.name)) continue;
      const cwd = path.join(root, e.name);
      const key = cwd.toLowerCase();
      if (!byCwd.has(key)) byCwd.set(key, { cwd, sessions: [] });
    }
  }

  const projects = [];
  for (const p of byCwd.values()) {
    let st;
    try { st = fs.statSync(p.cwd); } catch { continue; }
    if (!st.isDirectory()) continue;
    p.sessions.sort((a, b) => b.mtimeMs - a.mtimeMs);
    projects.push({
      name: path.basename(p.cwd) || p.cwd,
      cwd: p.cwd,
      hash: hashOf(p.cwd),
      lastUsed: p.sessions.length ? p.sessions[0].mtimeMs : st.mtimeMs,
      sessions: p.sessions,
    });
  }
  projects.sort((a, b) => b.lastUsed - a.lastUsed);
  return projects;
}

function norm(s) {
  return String(s).toLocaleLowerCase('tr').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i');
}

/** İsme göre proje arar; adı tam eşleşenler en üstte. */
function searchProjects(projects, query) {
  const q = norm(query.trim());
  if (!q) return projects;
  const hits = projects.filter((p) => norm(p.name).includes(q));
  return hits.filter((p) => norm(p.name) === q).concat(hits.filter((p) => norm(p.name) !== q));
}

/** Arama tek bir projeyi işaret ediyorsa onu döndürür (tek sonuç ya da tek tam eşleşme). */
function bestMatch(found, query) {
  if (found.length === 1) return found[0];
  const exact = found.filter((p) => norm(p.name) === norm(query.trim()));
  return exact.length === 1 ? exact[0] : null;
}

module.exports = { getProjects, searchProjects, bestMatch, PROJECTS_DIR };
