'use strict';
// Telegram botu: projeleri ve Claude Code oturumlarını listeler, seçileni VS Code'da açar,
// açık proje pencerelerini kapatır/yeniden başlatır, git durumunu gösterir.
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const config = require('./config');
const { log } = require('./log');
const { Telegram } = require('./telegram');
const { getProjects, searchProjects, bestMatch } = require('./sessions');
const launcher = require('./launcher');
const windows = require('./windows');
const { gitStatus } = require('./git');

const cfg = config.load();
if (!cfg.telegramToken) {
  log('config.json içinde "telegramToken" boş. README.md dosyasına bak.');
  process.exit(2); // 2 = ayar hatası, gözetleyici yeniden başlatmaz
}

const tg = new Telegram(cfg.telegramToken);
const startedAt = Date.now();
const PAIR_FILE = path.join(config.ROOT, 'pairing-code.txt');
let pairCode = null;
let busy = false;
let lastAction = null;
const filters = new Map(); // chatId -> son proje arama metni

// ---------- yardımcılar ----------
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const cut = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function when(ms) {
  const d = new Date(ms);
  const now = new Date();
  const hm = d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86400000);
  if (diff === 0) return `bugün ${hm}`;
  if (diff === 1) return `dün ${hm}`;
  if (diff < 7) return `${diff} gün önce`;
  return d.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit' });
}

const projects = () => getProjects(cfg.projectRoots);
const findProject = (hash) => projects().find((p) => p.hash === hash);

function isAllowed(userId) {
  return cfg.allowedUserIds.map(Number).includes(Number(userId));
}

function setupPairing() {
  if (cfg.allowedUserIds.length) {
    fs.rmSync(PAIR_FILE, { force: true });
    return;
  }
  pairCode = String(crypto.randomInt(100000, 1000000));
  fs.writeFileSync(PAIR_FILE, pairCode + '\n', 'utf8');
  log(`Eşleştirme kodu: ${pairCode}  ->  Telegram'da bota "/start ${pairCode}" yaz.`);
}

// ---------- favoriler ----------
const favKey = (cwd) => cwd.toLowerCase();
const isFav = (p) => (cfg.favorites || []).map(favKey).includes(favKey(p.cwd));

function toggleFav(p) {
  const fresh = config.load();
  const list = (fresh.favorites || []).filter((c) => favKey(c) !== favKey(p.cwd));
  if (!isFav(p)) list.push(p.cwd);
  cfg.favorites = list;
  config.save({ ...fresh, favorites: list });
  return isFav(p);
}

/** Favoriler en üstte, sonra en son kullanılanlar. */
function sortedProjects(list) {
  return list.filter(isFav).concat(list.filter((p) => !isFav(p)));
}

// ---------- menü ve yardım ----------
const MENU = [
  ['📂 Projects', '⭐ Favorites'],
  ['🖥️ Open windows', '📸 Screen'],
  ['ℹ️ Status', '❓ Help'],
];
// Menü butonlarının ve serbest yazılan kelimelerin karşılık geldiği komutlar.
// Eski Türkçe menü butonları telefonda kalmış olabilir, onlar da çalışsın.
const WORDS = {
  '📂 projects': 'projects', '⭐ favorites': 'favorites', '🖥️ open windows': 'windows',
  '📸 screen': 'screen', 'ℹ️ status': 'status', '❓ help': 'help',
  '📂 projeler': 'projects', '⭐ favoriler': 'favorites', '🖥️ açık projeler': 'windows',
  '📸 ekran': 'screen', 'ℹ️ durum': 'status', '❓ yardım': 'help',
  help: 'help', commands: 'help', yardım: 'help', yardim: 'help', komut: 'help', komutlar: 'help',
  menü: 'help', menu: 'help', '?': 'help', projects: 'projects', favorites: 'favorites',
  status: 'status', screen: 'screen', projeler: 'projects', favoriler: 'favorites',
  durum: 'status', ekran: 'screen',
};
// Eski Türkçe komutlar ve kısaltmalar -> İngilizce komut.
const ALIASES = {
  start: 'help', yardim: 'help', yardım: 'help', komutlar: 'help',
  projeler: 'projects', p: 'projects', favoriler: 'favorites', fav: 'favorites',
  acik: 'windows', açık: 'windows', son: 'last', yeni: 'new', kapat: 'close',
  yeniden: 'restart', ekran: 'screen', screenshot: 'screen', durum: 'status',
};

const HELP = [
  '🖥️ <b>ClaudeLauncher</b> — projelerini telefondan yönet',
  '',
  '<b>Açma</b>',
  '/projects — tüm projeler (⭐ favoriler en üstte)',
  '/favorites — sadece favori projeler',
  '/last — en son oturumu tekrar aç',
  '/new <i>proje</i> — projede yeni oturum aç',
  'Ya da proje adının bir kısmını yaz, örn. <code>memo</code>',
  '',
  '<b>Yönetme</b>',
  '/windows — VS Code\'da açık projeler (kapat / yeniden başlat)',
  '/close <i>proje</i> — projenin VS Code penceresini kapat',
  '/restart <i>proje</i> — kapatıp son oturumla tekrar aç',
  '/git <i>proje</i> — branch, değişiklikler, son commitler',
  '',
  '<b>Bilgisayar</b>',
  '/screen — ekran görüntüsü',
  '/status — servis durumu',
  '',
  'Komutları unutursan <code>help</code> yaz ya da alttaki menü butonlarını kullan.',
].join('\n');

// ---------- görünümler ----------
function projectListView(chatId, page = 0, onlyFavs = false) {
  const filter = onlyFavs ? '' : filters.get(chatId) || '';
  let all = sortedProjects(searchProjects(projects(), filter));
  if (onlyFavs) all = all.filter(isFav);
  const per = cfg.projectsPerPage;
  const pages = Math.max(1, Math.ceil(all.length / per));
  page = Math.min(Math.max(0, page), pages - 1);
  const slice = all.slice(page * per, page * per + per);

  const kb = [];
  for (let i = 0; i < slice.length; i += 2) {
    kb.push(slice.slice(i, i + 2).map((p) => ({
      text: `${isFav(p) ? '⭐' : '📁'} ${cut(p.name, 28)}`, callback_data: `p:${p.hash}:0`,
    })));
  }
  const nav = [];
  if (page > 0) nav.push({ text: '◀️ Önceki', callback_data: `P:${page - 1}` });
  if (page < pages - 1) nav.push({ text: 'Sonraki ▶️', callback_data: `P:${page + 1}` });
  if (nav.length) kb.push(nav);
  if (filter) kb.push([{ text: '✖️ Aramayı temizle', callback_data: 'C' }]);
  if (onlyFavs) kb.push([{ text: '📂 Tüm projeler', callback_data: 'C' }]);

  let text = onlyFavs ? `⭐ <b>Favoriler</b> (${all.length})` : `📂 <b>Projeler</b> (${all.length})`;
  if (filter) text += ` — arama: <i>${esc(filter)}</i>`;
  if (pages > 1) text += `  ·  sayfa ${page + 1}/${pages}`;
  if (!all.length) {
    text += onlyFavs
      ? '\n\nHenüz favori yok. Bir projeyi açıp “⭐ Favorilere ekle” butonuna bas.'
      : '\n\nEşleşen proje yok.';
  }
  return { text, kb };
}

function projectView(p, page = 0) {
  const per = cfg.sessionsPerPage;
  const pages = Math.max(1, Math.ceil(p.sessions.length / per));
  page = Math.min(Math.max(0, page), pages - 1);
  const slice = p.sessions.slice(page * per, page * per + per);

  const kb = [[{ text: '➕ Yeni oturum', callback_data: `n:${p.hash}` }]];
  for (const s of slice) {
    kb.push([{ text: `🕘 ${cut(s.title, 40)} · ${when(s.mtimeMs)}`, callback_data: `s:${p.hash}:${s.id}` }]);
  }
  const nav = [];
  if (page > 0) nav.push({ text: '◀️ Daha yeni', callback_data: `p:${p.hash}:${page - 1}` });
  if (page < pages - 1) nav.push({ text: 'Daha eski ▶️', callback_data: `p:${p.hash}:${page + 1}` });
  if (nav.length) kb.push(nav);
  kb.push([
    { text: isFav(p) ? '☆ Favoriden çıkar' : '⭐ Favorilere ekle', callback_data: `f:${p.hash}` },
    { text: '📊 Git durumu', callback_data: `g:${p.hash}` },
  ]);
  kb.push([
    { text: '✖️ Kapat', callback_data: `k:${p.hash}` },
    { text: '🔄 Yeniden başlat', callback_data: `r:${p.hash}` },
  ]);
  kb.push([{ text: '⬅️ Projeler', callback_data: 'P:0' }]);

  const text = `${isFav(p) ? '⭐' : '📁'} <b>${esc(p.name)}</b>\n<code>${esc(p.cwd)}</code>\n\n` + (p.sessions.length
    ? `${p.sessions.length} geçmiş oturum. Devam etmek istediğini seç ya da yeni oturum aç:`
    : 'Bu projede kayıtlı geçmiş oturum yok. Yeni oturum açabilirsin:');
  return { text, kb };
}

async function openWindowsView() {
  const all = projects();
  const wins = await windows.listWindows();
  const byProject = new Map();
  const unknown = [];
  for (const w of wins) {
    const p = windows.projectOfWindow(w, all);
    if (p) byProject.set(p.hash, p);
    else unknown.push(w.title);
  }
  const kb = [];
  for (const p of byProject.values()) {
    kb.push([
      { text: `${isFav(p) ? '⭐' : '📁'} ${cut(p.name, 22)}`, callback_data: `p:${p.hash}:0` },
      { text: '✖️ Kapat', callback_data: `k:${p.hash}` },
      { text: '🔄', callback_data: `r:${p.hash}` },
    ]);
  }
  kb.push([{ text: '🔃 Yenile', callback_data: 'O' }, { text: '📂 Projeler', callback_data: 'P:0' }]);
  let text = wins.length
    ? `🖥️ <b>VS Code'da açık projeler</b> (${byProject.size})\n✖️ kapatır, 🔄 kapatıp son oturumla tekrar açar.`
    : '🖥️ VS Code\'da açık proje yok.';
  if (unknown.length) text += `\n\nEşleşmeyen pencereler:\n${unknown.map((t) => '• ' + esc(cut(t, 60))).join('\n')}`;
  return { text, kb };
}

async function gitText(p) {
  const g = await gitStatus(p.cwd);
  if (!g) return `📊 <b>${esc(p.name)}</b>\nBu klasör bir git deposu değil.`;
  const lines = [`📊 <b>${esc(p.name)}</b> — git`, `Branch: <code>${esc(g.branch)}</code>`];
  if (g.ahead !== null) {
    lines.push(`Uzak sunucuya göre: ${g.ahead} gönderilmemiş, ${g.behind} çekilmemiş commit <i>(son fetch'e göre)</i>`);
  } else {
    lines.push('Uzak branch bağlı değil.');
  }
  lines.push(g.changed || g.untracked
    ? `Kaydedilmemiş değişiklik: ${g.changed} değişmiş, ${g.untracked} yeni dosya`
    : 'Çalışma alanı temiz ✅');
  if (g.commits.length) {
    lines.push('', '<b>Son commitler</b>');
    for (const c of g.commits) lines.push(`<code>${c.hash}</code> ${when(c.time)} — ${esc(cut(c.subject, 70))}`);
  }
  return lines.join('\n');
}

// ---------- eylemler ----------
/** Aynı anda tek pencere işlemi (aç/kapat) yapılsın diye. */
async function exclusive(chatId, fn) {
  if (busy) {
    await tg.send(chatId, '⏳ Bir önceki işlem hâlâ sürüyor, birkaç saniye bekle.');
    return;
  }
  busy = true;
  try { await fn(); } finally { busy = false; }
}

async function doOpen(chatId, project, session, statusMsg) {
  const label = session ? `🕘 ${esc(cut(session.title, 80))}` : '➕ Yeni oturum';
  const status = statusMsg || await tg.send(chatId, `⏳ <b>${esc(project.name)}</b> açılıyor…\n${label}`);
  if (statusMsg) await tg.edit(chatId, status.message_id, `⏳ <b>${esc(project.name)}</b> açılıyor…\n${label}`);
  try {
    log(`Açılıyor: ${project.cwd} oturum=${session ? session.id : 'yeni'}`);
    const r = await launcher.openProject({
      cwd: project.cwd,
      sessionId: session && session.id,
      codePath: cfg.codePath,
      warmDelayMs: cfg.warmDelayMs,
      coldDelayMs: cfg.coldDelayMs,
    });
    lastAction = { at: Date.now(), name: project.name, what: 'açıldı' };
    await tg.edit(chatId, status.message_id,
      `✅ <b>${esc(project.name)}</b> VS Code'da açıldı${r.wasRunning ? '' : ' (VS Code yeni başlatıldı)'}.\n${label}\n\n` +
      'Birkaç saniye içinde Claude uygulamasında Remote Control oturumu olarak görünecek. ' +
      'Büyük oturumlar 10–20 sn sürebilir.',
      [[{ text: '📸 Ekranı göster', callback_data: 'x' }, { text: '✖️ Kapat', callback_data: `k:${project.hash}` }]]);
  } catch (e) {
    log('Açma hatası:', e);
    await tg.edit(chatId, status.message_id, `❌ Açılamadı: ${esc(e.message)}`);
  }
}

/** Projenin tüm VS Code pencerelerini kapatır. Sonuç: { found, closed } */
async function closeProject(project) {
  const wins = await windows.windowsOf(project, projects());
  let closed = 0;
  for (const w of wins) if (await windows.closeWindow(w.hwnd)) closed++;
  log(`Kapat: ${project.cwd} bulunan=${wins.length} kapanan=${closed}`);
  return { found: wins.length, closed };
}

const openFlow = (chatId, project, session) => exclusive(chatId, () => doOpen(chatId, project, session));

const closeFlow = (chatId, project) => exclusive(chatId, async () => {
  const status = await tg.send(chatId, `⏳ <b>${esc(project.name)}</b> kapatılıyor…`);
  try {
    const r = await closeProject(project);
    let text;
    if (!r.found) text = `ℹ️ <b>${esc(project.name)}</b> zaten açık değil.`;
    else if (r.closed === r.found) text = `✅ <b>${esc(project.name)}</b> kapatıldı. Bu projedeki Claude oturumu da sonlandı.`;
    else text = `⚠️ <b>${esc(project.name)}</b> kapanmadı. Büyük ihtimalle kaydedilmemiş dosya var ve VS Code “kaydet?” diye soruyor. /screen ile bakabilirsin.`;
    if (r.found) lastAction = { at: Date.now(), name: project.name, what: 'kapatıldı' };
    await tg.edit(chatId, status.message_id, text,
      [[{ text: '🔄 Tekrar aç', callback_data: `r:${project.hash}` }, { text: '📸 Ekran', callback_data: 'x' }]]);
  } catch (e) {
    log('Kapatma hatası:', e);
    await tg.edit(chatId, status.message_id, `❌ Kapatılamadı: ${esc(e.message)}`);
  }
});

const restartFlow = (chatId, project) => exclusive(chatId, async () => {
  const status = await tg.send(chatId, `⏳ <b>${esc(project.name)}</b> yeniden başlatılıyor…`);
  try {
    const r = await closeProject(project);
    if (r.closed < r.found) {
      await tg.edit(chatId, status.message_id,
        `⚠️ <b>${esc(project.name)}</b> kapanmadı (kaydedilmemiş dosya olabilir), yeniden açmadım. /screen ile bakabilirsin.`,
        [[{ text: '📸 Ekran', callback_data: 'x' }]]);
      return;
    }
    if (r.found) await sleep(2000); // son pencereyse VS Code'un tamamen kapanması için
    const fresh = findProject(project.hash) || project;
    await doOpen(chatId, fresh, fresh.sessions[0] || null, status);
  } catch (e) {
    log('Yeniden başlatma hatası:', e);
    await tg.edit(chatId, status.message_id, `❌ Yeniden başlatılamadı: ${esc(e.message)}`);
  }
});

async function sendScreenshot(chatId) {
  try {
    const png = await launcher.screenshot();
    await tg.sendPhoto(chatId, png, `🖥️ ${new Date().toLocaleTimeString('tr-TR')}`);
  } catch (e) {
    log('Ekran görüntüsü hatası:', e);
    await tg.send(chatId, `❌ Ekran görüntüsü alınamadı (ekran kilitli olabilir).\n<code>${esc(e.message)}</code>`);
  }
}

async function statusText() {
  const up = (min) => (min < 60 ? `${min} dk` : `${Math.floor(min / 60)} sa ${min % 60} dk`);
  const code = await launcher.isCodeRunning();
  return [
    '🟢 <b>ClaudeLauncher çalışıyor</b>',
    `Bilgisayar: <code>${esc(os.hostname())}</code> — ${up(Math.round(os.uptime() / 60))} önce açıldı`,
    `Servis çalışma süresi: ${up(Math.round((Date.now() - startedAt) / 60000))}`,
    `VS Code: ${code ? 'açık' : 'kapalı'}`,
    `Proje: ${projects().length}, favori: ${(cfg.favorites || []).length}`,
    lastAction ? `Son işlem: ${esc(lastAction.name)} ${lastAction.what} — ${when(lastAction.at)}` : 'Son işlem: yok',
  ].join('\n');
}

/** Komut + proje adı: tek eşleşme varsa fn çalışır, yoksa seçim butonları gönderilir. */
async function withProject(chatId, arg, usage, cbKind, fn) {
  if (!arg) return tg.send(chatId, `Kullanım: <code>${usage}</code>`);
  const found = sortedProjects(searchProjects(projects(), arg));
  const one = bestMatch(found, arg);
  if (one) return fn(one);
  if (!found.length) return tg.send(chatId, `“${esc(arg)}” ile eşleşen proje yok. /projects ile listeye bak.`);
  return tg.send(chatId, 'Birden fazla proje eşleşti, hangisi?',
    found.slice(0, 10).map((p) => [{ text: `${isFav(p) ? '⭐' : '📁'} ${cut(p.name, 40)}`, callback_data: `${cbKind}:${p.hash}` }]));
}

// ---------- gelen mesajlar ----------
async function onMessage(msg) {
  const chatId = msg.chat.id;
  const userId = msg.from && msg.from.id;
  const text = (msg.text || '').trim();

  if (!isAllowed(userId)) {
    if (pairCode && text === `/start ${pairCode}`) {
      cfg.allowedUserIds.push(userId);
      config.save({ ...config.load(), allowedUserIds: cfg.allowedUserIds });
      pairCode = null;
      fs.rmSync(PAIR_FILE, { force: true });
      log(`Eşleştirildi: kullanıcı ${userId} (@${msg.from.username || '-'})`);
      await tg.sendWithMenu(chatId, '🔐 Eşleştirme tamam. Bu bot artık sadece sana cevap verecek.\n\n' + HELP, MENU);
    } else {
      log(`Yetkisiz mesaj yok sayıldı: kullanıcı ${userId} (@${(msg.from && msg.from.username) || '-'})`);
    }
    return;
  }
  if (msg.chat.type !== 'private' || !text) return;

  const m = text.match(/^\/([a-zA-Z_ğüşıöçĞÜŞİÖÇ]+)(?:@\S+)?(?:\s+([\s\S]*))?$/);
  let cmd = m ? m[1].toLocaleLowerCase('tr') : null;
  if (cmd && ALIASES[cmd]) cmd = ALIASES[cmd];
  let arg = m ? (m[2] || '').trim() : text;
  if (!cmd && WORDS[text.toLocaleLowerCase('tr')]) { cmd = WORDS[text.toLocaleLowerCase('tr')]; arg = ''; }

  switch (cmd) {
    case 'help':
      return tg.sendWithMenu(chatId, HELP, MENU);
    case 'projects': {
      filters.set(chatId, arg);
      const v = projectListView(chatId, 0);
      return tg.send(chatId, v.text, v.kb);
    }
    case 'favorites': {
      const v = projectListView(chatId, 0, true);
      return tg.send(chatId, v.text, v.kb);
    }
    case 'windows': {
      const v = await openWindowsView();
      return tg.send(chatId, v.text, v.kb);
    }
    case 'last': {
      const p = projects().find((x) => x.sessions.length);
      if (!p) return tg.send(chatId, 'Hiç oturum bulunamadı.');
      return openFlow(chatId, p, p.sessions[0]);
    }
    case 'new':
      return withProject(chatId, arg, '/new proje-adı', 'n', (p) => openFlow(chatId, p, null));
    case 'close':
      return withProject(chatId, arg, '/close proje-adı', 'k', (p) => closeFlow(chatId, p));
    case 'restart':
      return withProject(chatId, arg, '/restart proje-adı', 'r', (p) => restartFlow(chatId, p));
    case 'git':
      return withProject(chatId, arg, '/git proje-adı', 'g', async (p) => tg.send(chatId, await gitText(p)));
    case 'screen':
      return sendScreenshot(chatId);
    case 'status':
      return tg.send(chatId, await statusText());
    case null: {
      // Komut değilse proje araması olarak kullan.
      filters.set(chatId, arg);
      const found = searchProjects(projects(), arg);
      if (found.length === 1) {
        const v = projectView(found[0], 0);
        return tg.send(chatId, v.text, v.kb);
      }
      const v = projectListView(chatId, 0);
      if (!found.length) v.text += '\n\nKomut arıyorsan <code>help</code> yaz.';
      return tg.send(chatId, v.text, v.kb);
    }
    default:
      return tg.sendWithMenu(chatId, 'Bu komutu tanımıyorum. İşte kullanabileceklerin:\n\n' + HELP, MENU);
  }
}

async function onCallback(q) {
  const chatId = q.message && q.message.chat.id;
  const messageId = q.message && q.message.message_id;
  if (!isAllowed(q.from.id) || !chatId) return tg.answer(q.id);
  const [kind, a, b] = q.data.split(':');

  if (kind === 'P' || kind === 'C') {
    if (kind === 'C') filters.delete(chatId);
    const v = projectListView(chatId, Number(a) || 0);
    await tg.answer(q.id);
    return tg.edit(chatId, messageId, v.text, v.kb);
  }
  if (kind === 'O') {
    await tg.answer(q.id);
    const v = await openWindowsView();
    return tg.edit(chatId, messageId, v.text, v.kb);
  }
  if (kind === 'x') {
    await tg.answer(q.id, 'Ekran alınıyor…');
    return sendScreenshot(chatId);
  }

  const p = findProject(a);
  if (!p) return tg.answer(q.id, 'Proje bulunamadı');

  switch (kind) {
    case 'p': {
      const v = projectView(p, Number(b) || 0);
      await tg.answer(q.id);
      return tg.edit(chatId, messageId, v.text, v.kb);
    }
    case 'n':
    case 's': {
      const s = kind === 's' ? p.sessions.find((x) => x.id === b) : null;
      if (kind === 's' && !s) return tg.answer(q.id, 'Oturum bulunamadı');
      await tg.answer(q.id, 'Açılıyor…');
      return openFlow(chatId, p, s);
    }
    case 'f': {
      const now = toggleFav(p);
      await tg.answer(q.id, now ? '⭐ Favorilere eklendi' : 'Favorilerden çıkarıldı');
      const v = projectView(p, 0);
      return tg.edit(chatId, messageId, v.text, v.kb);
    }
    case 'g':
      await tg.answer(q.id);
      return tg.send(chatId, await gitText(p));
    case 'k':
      await tg.answer(q.id, 'Kapatılıyor…');
      return closeFlow(chatId, p);
    case 'r':
      await tg.answer(q.id, 'Yeniden başlatılıyor…');
      return restartFlow(chatId, p);
    default:
      return tg.answer(q.id);
  }
}

// ---------- ana döngü ----------
// Bilgisayar yeni açıldığında ağ hazır olmayabilir; bağlanana kadar dene.
async function connect() {
  for (let wait = 5000; ; wait = Math.min(wait * 2, 60000)) {
    try {
      return await tg.call('getMe');
    } catch (e) {
      if (e.code === 401) { log('Bot token geçersiz (401).'); process.exit(2); }
      log(`Telegram'a bağlanılamadı (${e.message}), ${wait / 1000} sn sonra tekrar.`);
      await sleep(wait);
    }
  }
}

async function notifyStartup() {
  if (process.env.CL_FIRST_START !== '1' || !cfg.allowedUserIds.length) return;
  const upMin = Math.round(os.uptime() / 60);
  const bootedAt = Date.now() - os.uptime() * 1000;
  const text = [
    `🟢 <b>${esc(os.hostname())}</b> hazır`,
    upMin < 15
      ? `Bilgisayar ${when(bootedAt)} açıldı (${upMin} dk önce).`
      : `Servis yeniden başlatıldı. Bilgisayar ${when(bootedAt)} saatinden beri açık.`,
    '',
    'Alttaki menüyü ya da /projects komutunu kullanabilirsin.',
  ].join('\n');
  for (const id of cfg.allowedUserIds) {
    await tg.sendWithMenu(id, text, MENU).catch((e) => log('Açılış bildirimi gönderilemedi:', e.message));
  }
}

async function main() {
  const me = await connect();
  log(`Bot bağlandı: @${me.username}`);
  setupPairing();
  await notifyStartup();
  await tg.call('setMyCommands', {
    commands: [
      { command: 'projects', description: 'Tüm projeler' },
      { command: 'favorites', description: 'Favori projeler' },
      { command: 'windows', description: 'VS Code\'da açık projeler (kapat / yeniden başlat)' },
      { command: 'last', description: 'En son oturumu aç' },
      { command: 'new', description: 'Yeni oturum: /new proje' },
      { command: 'close', description: 'Projeyi kapat: /close proje' },
      { command: 'restart', description: 'Kapatıp tekrar aç: /restart proje' },
      { command: 'git', description: 'Git durumu: /git proje' },
      { command: 'screen', description: 'Ekran görüntüsü' },
      { command: 'status', description: 'Servis durumu' },
      { command: 'help', description: 'Tüm komutlar' },
    ],
  }).catch((e) => log('setMyCommands:', e.message));

  let offset = 0;
  for (;;) {
    let updates;
    try {
      updates = await tg.getUpdates(offset);
    } catch (e) {
      if (e.code === 409) log('Başka bir ClaudeLauncher kopyası çalışıyor olabilir (409).');
      else if (e.code === 401) { log('Bot token geçersiz (401).'); process.exit(2); }
      else log('getUpdates hatası:', e.message);
      await sleep(5000);
      continue;
    }
    for (const u of updates) {
      offset = u.update_id + 1;
      try {
        if (u.message) await onMessage(u.message);
        else if (u.callback_query) await onCallback(u.callback_query);
      } catch (e) {
        log('İşleme hatası:', e);
      }
    }
  }
}

main().catch((e) => {
  log('Başlatma hatası:', e);
  process.exit(1);
});
