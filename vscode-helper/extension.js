'use strict';
// vscode://claudelauncher.helper/open?session=<uuid>
// Claude Code oturumunu ortadaki sekme yerine sağ paneldeki Claude'da açar.
//
// Claude eklentisinin kendi linki (vscode://anthropic.claude-code/open) her zaman
// ortadaki sekmede açıyor. Kenar panelde açmak için eklentinin dahili
// `claude-vscode.editor.open` komutunu "programmatic" modla, preferredLocation
// "sidebar" iken çağırıyoruz. Bu dahili bir API; Claude güncellemesinde bozulursa
// eski davranışa (ortadaki sekme) düşüyoruz.
const vscode = require('vscode');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function openInSidebar(sessionId) {
  const cfg = vscode.workspace.getConfiguration('claudeCode');
  const before = cfg.inspect('preferredLocation').globalValue;
  await cfg.update('preferredLocation', 'sidebar', vscode.ConfigurationTarget.Global);
  try {
    await vscode.commands.executeCommand(
      'claude-vscode.editor.open',
      sessionId, undefined, undefined, undefined, undefined,
      { programmatic: 'honor-preferred-location' },
    );
  } finally {
    // Kullanıcının kendi ayarını geri koy (komut ayarı sadece çağrı anında okuyor).
    await cfg.update('preferredLocation', before, vscode.ConfigurationTarget.Global);
  }
}

async function handle(uri) {
  if (uri.path !== '/open') return;
  const session = new URLSearchParams(uri.query).get('session') || undefined;
  if (session !== undefined && !UUID.test(session)) return;
  try {
    await openInSidebar(session);
  } catch (e) {
    console.error('[claudelauncher-helper] sağ panelde açılamadı, sekmede açılıyor:', e);
    await vscode.commands.executeCommand('claude-vscode.primaryEditor.open', session);
  }
}

// VS Code bir eklentiye link açtırmadan önce "Allow ... to open this URI?" diye sorar.
// Bot bilgisayarda kimse yokken link gönderdiği için bu soru akışı durdurur; eklenti
// kendini güvenilen listeye ekler (kullanıcı eklentiyi bilerek kurdu).
async function trustSelf(context) {
  const id = context.extension.id;
  const cfg = vscode.workspace.getConfiguration('extensions');
  const list = cfg.inspect('confirmedUriHandlerExtensionIds')?.globalValue || [];
  if (list.some((x) => x.toLowerCase() === id.toLowerCase())) return;
  await cfg.update('confirmedUriHandlerExtensionIds', [...list, id], vscode.ConfigurationTarget.Global);
}

function activate(context) {
  context.subscriptions.push(vscode.window.registerUriHandler({ handleUri: handle }));
  trustSelf(context).catch((e) => console.error('[claudelauncher-helper] trustSelf:', e));
}

module.exports = { activate, deactivate() {} };
