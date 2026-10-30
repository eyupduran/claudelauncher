# ClaudeLauncher

**Open any project and Claude Code session on your Windows PC from your phone, via Telegram.**

[Türkçe](README.tr.md)

## The problem

[Claude Code Remote Control](https://docs.claude.com/en/docs/claude-code) lets you continue a Claude Code session from the Claude mobile app — but only if that session is already open on your computer. When you're away from your desk and need to work on a project that isn't open in VS Code, you're stuck: someone has to sit at the PC, open the project, and pick the right session from the history.

## The solution

ClaudeLauncher is a small Telegram bot that runs in the background on your PC:

1. You message the bot from your phone and pick a project.
2. You pick a previous Claude Code session (or start a new one).
3. On your PC, VS Code opens that project and Claude Code opens that session.
4. Since Remote Control is on, the session immediately shows up in the Claude app on your phone. Carry on from there.

It can also list the VS Code windows that are open, close or restart a single project's window, show a git summary, and send you a screenshot of the screen.

## Requirements

- Windows 10/11
- [Node.js](https://nodejs.org) 18 or newer (no npm packages needed — zero dependencies)
- [VS Code](https://code.visualstudio.com) with the [Claude Code extension](https://marketplace.visualstudio.com/items?itemName=anthropic.claude-code)
- Claude Code Remote Control enabled for every session: set `"remoteControlAtStartup": true` in `~/.claude.json`
- A Telegram account

## Setup

1. **Create a bot.** In Telegram, open **@BotFather**, send `/newbot`, and copy the token.
2. **Configure.** Copy `config.example.json` to `config.json` and paste the token into `telegramToken`.
   Set `projectRoots` to the folder(s) that contain your projects.
3. **Install the background service** (starts hidden when you sign in to Windows, restarts itself if it crashes):
   ```
   npm run install-startup
   ```
4. **Pair your Telegram account.** Open `pairing-code.txt` (or the log) for a 6-digit code and send `/start <code>` to your bot. From then on the bot only answers you.
5. **Optional — open sessions in the sidebar.** By default Claude Code opens the session in an editor tab. To open it in the Claude sidebar instead, install the small helper extension:
   ```
   npm run install-vscode-helper
   ```

When the service starts, the bot sends you a "🟢 ready" message.

## Bot commands

The bot speaks **English** and **Turkish**. Switch any time with `/language` (or set `"language"` in `config.json`). A persistent menu at the bottom of the chat covers the common actions; type `?` or `/help` for help.

| Command | What it does |
|---|---|
| `/projects` | List projects (favorites first, then most recently used) |
| `/favorites` | Favorite projects only |
| any text, e.g. `shop` | Search projects by name |
| `/last` | Reopen the most recent session |
| `/new <project>` | Start a new session in a project |
| `/windows` | VS Code windows currently open, each with close / restart buttons |
| `/close <project>` | Close only that project's VS Code window |
| `/restart <project>` | Close it and reopen with its latest session |
| `/git <project>` | Branch, uncommitted changes, last commits |
| `/screen` | Screenshot of the PC screen |
| `/status` | Service status |
| `/language` | Switch between English and Turkish |

## How it works

- **Projects and sessions** come from Claude Code's history in `~/.claude/projects/<project>/<session>.jsonl`, plus every folder under `projectRoots` (so projects without history show up too). Session files can be hundreds of MB, so only the head and tail of each file are read.
- **Opening** runs `Code.exe <project>`, waits for the window to get focus, then sends the Claude Code link `vscode://anthropic.claude-code/open?session=<id>` (or the helper extension's link to open it in the sidebar). If the project is already open, the session opens in a new tab instead, so the session already running in the sidebar is left alone.
- **Closing a single project** finds its window via Win32 `EnumWindows` and sends `WM_CLOSE`. If there are unsaved files, VS Code asks and the window stays open; the bot tells you.
- **The service** is a Windows Task Scheduler task that runs `node src/main.js` hidden at sign-in. A small supervisor restarts the bot if it crashes.

```
src/main.js         supervisor: single-instance lock, restarts the bot on crash
src/bot.js          Telegram long polling, commands, inline buttons
src/sessions.js     project / session discovery and search
src/launcher.js     opens VS Code + Claude Code, takes screenshots
src/windows.js      lists / closes VS Code windows (Win32)
src/git.js          read-only git summary
src/i18n.js         bot texts (English, Turkish) — add a language here
vscode-helper/      optional VS Code extension: open sessions in the Claude sidebar
scripts/            install / uninstall / restart the service
```

## Security

- The bot answers **only** the Telegram user IDs in `allowedUserIds`. If the list is empty, a one-time pairing code is generated on start.
- It can only open folders from its own project list. There is **no** way to run arbitrary shell commands through the bot, and none should be added.
- `config.json` holds your bot token and is git-ignored. If the token ever leaks, revoke it in @BotFather (`/revoke`), update `config.json`, and run `npm run restart`.
- `/screen` sends a screenshot of your screen to your Telegram chat — keep that in mind.

## Maintenance

- Log: `logs/claudelauncher.log` (rotates at 2 MB)
- After changing `config.json`: `npm run restart`
- Uninstall the service: `npm run uninstall-startup`
- After moving or renaming the folder: `npm run install-startup` again
- The PC must be on, signed in, and not asleep. A locked screen is fine (screenshots may be black).
- If a session sometimes opens in the wrong VS Code window, increase `warmDelayMs` in `config.json` (e.g. `6000`).

## Notes

- The sidebar helper adds itself to VS Code's `extensions.confirmedUriHandlerExtensionIds` setting, so VS Code doesn't ask "Allow 'ClaudeLauncher Helper' to open this URI?" every time (nobody is at the PC to click it).
- The sidebar helper uses an internal Claude Code extension command. If a Claude Code update changes it, the helper falls back to opening the session in an editor tab.
- Large sessions can take 10–20 seconds to load in VS Code.

## License

[MIT](LICENSE)
