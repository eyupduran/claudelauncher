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
const i18n = require('./i18n');

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
let L = i18n.strings(cfg.language); // aktif dilin metinleri

// ---------- yardımcılar ----------
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const cut = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const titleOf = (s) => s.title || L.untitled;

function when(ms) {
  const d = new Date(ms);
  const now = new Date();
  const hm = d.toLocaleTimeString(L.locale, { hour: '2-digit', minute: '2-digit' });
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86400000);
  if (diff === 0) return L.today(hm);
  if (diff === 1) return L.yesterday(hm);
  if (diff < 7) return L.daysAgo(diff);
  return d.toLocaleDateString(L.locale, { day: '2-digit', month: '2-digit' });
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
  log(`Pairing code: ${pairCode}  ->  send "/start ${pairCode}" to the bot on Telegram.`);
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

// ---------- menü, komutlar, dil ----------
// Menü butonları ve serbest yazılan kelimeler -> komut. Tüm dillerin menüsü tanınır
// (dil değişince telefonda eski menü bir süre kalabilir).
const MENU_CMDS = [['projects', 'favorites'], ['windows', 'screen'], ['status', 'help']];
const WORDS = {
  help: 'help', commands: 'help', yardım: 'help', yardim: 'help', komut: 'help', komutlar: 'help',
  menü: 'help', menu: 'help', '?': 'help', projects: 'projects', favorites: 'favorites',
  status: 'status', screen: 'screen', projeler: 'projects', favoriler: 'favorites',
  durum: 'status', ekran: 'screen', language: 'language', dil: 'language',
};
for (const lang of i18n.LANGS) {
  i18n.STRINGS[lang].menu.forEach((row, r) => row.forEach((label, c) => {
    WORDS[label.toLocaleLowerCase('tr')] = MENU_CMDS[r][c];
  }));
}
// Eski Türkçe komutlar ve kısaltmalar -> İngilizce komut.
const ALIASES = {
  start: 'help', yardim: 'help', yardım: 'help', komutlar: 'help',
  projeler: 'projects', p: 'projects', favoriler: 'favorites', fav: 'favorites',
  acik: 'windows', açık: 'windows', son: 'last', yeni: 'new', kapat: 'close',
  yeniden: 'restart', ekran: 'screen', screenshot: 'screen', durum: 'status',
  dil: 'language', lang: 'language',
};
const COMMAND_ORDER = ['projects', 'favorites', 'windows', 'last', 'new', 'close', 'restart', 'git', 'screen', 'status', 'language', 'help'];

function publishCommands() {
  return tg.call('setMyCommands', {
    commands: COMMAND_ORDER.map((c) => ({ command: c, description: L.commands[c] })),
  }).catch((e) => log('setMyCommands:', e.message));
}

const sendHelp = (chatId, prefix = '') => tg.sendWithMenu(chatId, prefix + L.help, L.menu);

function languageView() {
  const kb = [i18n.LANGS.map((lang) => ({
    text: `${lang === (cfg.language || i18n.DEFAULT_LANG) ? '✅ ' : ''}${i18n.STRINGS[lang].langName}`,
    callback_data: `l:${lang}`,
  }))];
  return { text: L.chooseLanguage, kb };
}

function setLanguage(lang) {
  cfg.language = lang;
  config.save({ ...config.load(), language: lang });
  L = i18n.strings(lang);
  log(`Dil: ${lang}`);
  return publishCommands();
}

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
  if (page > 0) nav.push({ text: L.prev, callback_data: `P:${page - 1}` });
  if (page < pages - 1) nav.push({ text: L.next, callback_data: `P:${page + 1}` });
  if (nav.length) kb.push(nav);
  if (filter) kb.push([{ text: L.clearSearch, callback_data: 'C' }]);
  if (onlyFavs) kb.push([{ text: L.allProjects, callback_data: 'C' }]);

  let text = onlyFavs ? L.favoritesTitle(all.length) : L.projectsTitle(all.length);
  if (filter) text += L.searchSuffix(esc(filter));
  if (pages > 1) text += L.pageSuffix(page + 1, pages);
  if (!all.length) text += onlyFavs ? L.noFavorites : L.noMatch;
  return { text, kb };
}

function projectView(p, page = 0) {
  const per = cfg.sessionsPerPage;
  const pages = Math.max(1, Math.ceil(p.sessions.length / per));
  page = Math.min(Math.max(0, page), pages - 1);
  const slice = p.sessions.slice(page * per, page * per + per);

  const kb = [[{ text: L.newSession, callback_data: `n:${p.hash}` }]];
  for (const s of slice) {
    kb.push([{ text: `🕘 ${cut(titleOf(s), 40)} · ${when(s.mtimeMs)}`, callback_data: `s:${p.hash}:${s.id}` }]);
  }
  const nav = [];
  if (page > 0) nav.push({ text: L.newer, callback_data: `p:${p.hash}:${page - 1}` });
  if (page < pages - 1) nav.push({ text: L.older, callback_data: `p:${p.hash}:${page + 1}` });
  if (nav.length) kb.push(nav);
  kb.push([
    { text: isFav(p) ? L.unfav : L.addFav, callback_data: `f:${p.hash}` },
    { text: L.gitButton, callback_data: `g:${p.hash}` },
  ]);
  kb.push([
    { text: L.close, callback_data: `k:${p.hash}` },
    { text: L.restart, callback_data: `r:${p.hash}` },
  ]);
  kb.push([{ text: L.backToProjects, callback_data: 'P:0' }]);

  const text = `${isFav(p) ? '⭐' : '📁'} <b>${esc(p.name)}</b>\n<code>${esc(p.cwd)}</code>\n\n` +
    (p.sessions.length ? L.sessionsIntro(p.sessions.length) : L.noSessions);
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
      { text: L.close, callback_data: `k:${p.hash}` },
      { text: '🔄', callback_data: `r:${p.hash}` },
    ]);
  }
  kb.push([{ text: L.refresh, callback_data: 'O' }, { text: L.projectsButton, callback_data: 'P:0' }]);
  let text = wins.length ? L.openWindowsTitle(byProject.size) : L.noOpenWindows;
  if (unknown.length) text += `\n\n${L.unmatchedWindows}\n${unknown.map((t) => '• ' + esc(cut(t, 60))).join('\n')}`;
  return { text, kb };
}

async function gitText(p) {
  const g = await gitStatus(p.cwd);
  if (!g) return `📊 <b>${esc(p.name)}</b>\n${L.notGitRepo}`;
  const lines = [`📊 <b>${esc(p.name)}</b> — git`, `Branch: <code>${esc(g.branch)}</code>`];
  lines.push(g.ahead !== null ? L.aheadBehind(g.ahead, g.behind) : L.noUpstream);
  lines.push(g.changed || g.untracked ? L.uncommitted(g.changed, g.untracked) : L.clean);
  if (g.commits.length) {
    lines.push('', `<b>${L.recentCommits}</b>`);
    for (const c of g.commits) lines.push(`<code>${c.hash}</code> ${when(c.time)} — ${esc(cut(c.subject, 70))}`);
  }
  return lines.join('\n');
}

// ---------- eylemler ----------
/** Aynı anda tek pencere işlemi (aç/kapat) yapılsın diye. */
async function exclusive(chatId, fn) {
  if (busy) {
    await tg.send(chatId, L.busy);
    return;
  }
  busy = true;
  try { await fn(); } finally { busy = false; }
}

async function doOpen(chatId, project, session, statusMsg) {
  const label = session ? `🕘 ${esc(cut(titleOf(session), 80))}` : L.newSession;
  const name = esc(project.name);
  const status = statusMsg || await tg.send(chatId, L.opening(name, label));
  if (statusMsg) await tg.edit(chatId, status.message_id, L.opening(name, label));
  try {
    log(`Açılıyor: ${project.cwd} oturum=${session ? session.id : 'yeni'}`);
    const r = await launcher.openProject({
      cwd: project.cwd,
      sessionId: session && session.id,
      codePath: cfg.codePath,
      warmDelayMs: cfg.warmDelayMs,
      coldDelayMs: cfg.coldDelayMs,
    });
    lastAction = { at: Date.now(), name: project.name, what: 'opened' };
    await tg.edit(chatId, status.message_id, L.opened(name, !r.wasRunning, label),
      [[{ text: L.showScreen, callback_data: 'x' }, { text: L.close, callback_data: `k:${project.hash}` }]]);
  } catch (e) {
    log('Açma hatası:', e);
    await tg.edit(chatId, status.message_id, L.openFailed(esc(e.message)));
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
  const name = esc(project.name);
  const status = await tg.send(chatId, L.closing(name));
  try {
    const r = await closeProject(project);
    let text;
    if (!r.found) text = L.notOpen(name);
    else if (r.closed === r.found) text = L.closed(name);
    else text = L.notClosed(name);
    if (r.found) lastAction = { at: Date.now(), name: project.name, what: 'closed' };
    await tg.edit(chatId, status.message_id, text,
      [[{ text: L.reopen, callback_data: `r:${project.hash}` }, { text: L.screenButton, callback_data: 'x' }]]);
  } catch (e) {
    log('Kapatma hatası:', e);
    await tg.edit(chatId, status.message_id, L.closeFailed(esc(e.message)));
  }
});

const restartFlow = (chatId, project) => exclusive(chatId, async () => {
  const name = esc(project.name);
  const status = await tg.send(chatId, L.restarting(name));
  try {
    const r = await closeProject(project);
    if (r.closed < r.found) {
      await tg.edit(chatId, status.message_id, L.notClosedNoReopen(name),
        [[{ text: L.screenButton, callback_data: 'x' }]]);
      return;
    }
    if (r.found) await sleep(2000); // son pencereyse VS Code'un tamamen kapanması için
    const fresh = findProject(project.hash) || project;
    await doOpen(chatId, fresh, fresh.sessions[0] || null, status);
  } catch (e) {
    log('Yeniden başlatma hatası:', e);
    await tg.edit(chatId, status.message_id, L.restartFailed(esc(e.message)));
  }
});

async function sendScreenshot(chatId) {
  try {
    const png = await launcher.screenshot();
    await tg.sendPhoto(chatId, png, `🖥️ ${new Date().toLocaleTimeString(L.locale)}`);
  } catch (e) {
    log('Ekran görüntüsü hatası:', e);
    await tg.send(chatId, L.screenFailed(esc(e.message)));
  }
}

async function statusText() {
  const code = await launcher.isCodeRunning();
  return L.statusLines({
    host: esc(os.hostname()),
    up: L.duration(Math.round(os.uptime() / 60)),
    service: L.duration(Math.round((Date.now() - startedAt) / 60000)),
    code,
    projects: projects().length,
    favorites: (cfg.favorites || []).length,
    last: lastAction && {
      name: esc(lastAction.name),
      what: lastAction.what === 'opened' ? L.whatOpened : L.whatClosed,
      when: when(lastAction.at),
    },
  }).join('\n');
}

/** Komut + proje adı: tek eşleşme varsa fn çalışır, yoksa seçim butonları gönderilir. */
async function withProject(chatId, arg, cmd, cbKind, fn) {
  if (!arg) return tg.send(chatId, L.usage(`/${cmd} ${L.projectArg}`));
  const found = sortedProjects(searchProjects(projects(), arg));
  const one = bestMatch(found, arg);
  if (one) return fn(one);
  if (!found.length) return tg.send(chatId, L.noProjectMatch(esc(arg)));
  return tg.send(chatId, L.whichProject,
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
      await sendHelp(chatId, L.paired);
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
      return sendHelp(chatId);
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
      if (!p) return tg.send(chatId, L.noSessionsAtAll);
      return openFlow(chatId, p, p.sessions[0]);
    }
    case 'new':
      return withProject(chatId, arg, 'new', 'n', (p) => openFlow(chatId, p, null));
    case 'close':
      return withProject(chatId, arg, 'close', 'k', (p) => closeFlow(chatId, p));
    case 'restart':
      return withProject(chatId, arg, 'restart', 'r', (p) => restartFlow(chatId, p));
    case 'git':
      return withProject(chatId, arg, 'git', 'g', async (p) => tg.send(chatId, await gitText(p)));
    case 'screen':
      return sendScreenshot(chatId);
    case 'status':
      return tg.send(chatId, await statusText());
    case 'language': {
      const want = arg.toLowerCase();
      if (i18n.LANGS.includes(want)) {
        await setLanguage(want);
        return sendHelp(chatId, L.languageSet + '\n\n');
      }
      const v = languageView();
      return tg.send(chatId, v.text, v.kb);
    }
    case null: {
      // Komut değilse proje araması olarak kullan.
      filters.set(chatId, arg);
      const found = searchProjects(projects(), arg);
      if (found.length === 1) {
        const v = projectView(found[0], 0);
        return tg.send(chatId, v.text, v.kb);
      }
      const v = projectListView(chatId, 0);
      if (!found.length) v.text += L.searchHint;
      return tg.send(chatId, v.text, v.kb);
    }
    default:
      return sendHelp(chatId, L.unknownCommand);
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
    await tg.answer(q.id, L.takingScreenshot);
    return sendScreenshot(chatId);
  }
  if (kind === 'l') {
    if (!i18n.LANGS.includes(a)) return tg.answer(q.id);
    await setLanguage(a);
    await tg.answer(q.id);
    const v = languageView();
    await tg.edit(chatId, messageId, v.text, v.kb);
    return sendHelp(chatId, L.languageSet + '\n\n');
  }

  const p = findProject(a);
  if (!p) return tg.answer(q.id, L.projectNotFound);

  switch (kind) {
    case 'p': {
      const v = projectView(p, Number(b) || 0);
      await tg.answer(q.id);
      return tg.edit(chatId, messageId, v.text, v.kb);
    }
    case 'n':
    case 's': {
      const s = kind === 's' ? p.sessions.find((x) => x.id === b) : null;
      if (kind === 's' && !s) return tg.answer(q.id, L.sessionNotFound);
      await tg.answer(q.id, L.openingToast);
      return openFlow(chatId, p, s);
    }
    case 'f': {
      const now = toggleFav(p);
      await tg.answer(q.id, now ? L.favAdded : L.favRemoved);
      const v = projectView(p, 0);
      return tg.edit(chatId, messageId, v.text, v.kb);
    }
    case 'g':
      await tg.answer(q.id);
      return tg.send(chatId, await gitText(p));
    case 'k':
      await tg.answer(q.id, L.closingToast);
      return closeFlow(chatId, p);
    case 'r':
      await tg.answer(q.id, L.restartingToast);
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
    L.ready(esc(os.hostname())),
    upMin < 15 ? L.bootedRecently(when(bootedAt), upMin) : L.serviceRestarted(when(bootedAt)),
    '',
    L.readyHint,
  ].join('\n');
  for (const id of cfg.allowedUserIds) {
    await tg.sendWithMenu(id, text, L.menu).catch((e) => log('Açılış bildirimi gönderilemedi:', e.message));
  }
}

async function main() {
  const me = await connect();
  log(`Bot bağlandı: @${me.username}`);
  setupPairing();
  await notifyStartup();
  await publishCommands();

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
