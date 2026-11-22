---
id: doc-2
title: How it works
type: specification
created_date: ''
updated_date: '2026-11-22T10:02:48Z'
---
`server.js`, plus `claude.js` for the Claude chat (dependencies: `@anthropic-ai/claude-agent-sdk`, `ws`, and `marked` + `dompurify` served to the page). Serves `public/` on `127.0.0.1:6400` (`BACKLOGS_PORT` to override).

## Running

| How | Command |
| --- | --- |
| At every login | `./install.sh`: launchd agent `local.backlogs` (`~/Library/LaunchAgents/local.backlogs.plist`, `RunAtLoad`, `KeepAlive`), then opens http://localhost:6400 |
| Desktop app on the checkout | `npm run app` |
| Installers | `scripts/release.sh` |
| Remove the agent | `./install.sh --uninstall` |
| By hand | `npm install && node server.js` |

- `install.sh` runs `npm install` with the agent's Node. The agent's `PATH` holds the `backlog` CLI's folder; Node from fnm's default alias when present.
- Log: `~/Library/Logs/Backlogs.log`.

## Desktop app

Electron, macOS and Windows: `electron/main.js` runs `server.js` in the app's Node and shows the page; when a server already answers on the port (a checkout run by `install.sh`), it shows that one. `platform.js` holds what differs per OS (data folder, open, VS Code, Chrome, terminal, folder picker; the app plugs in its own `shell` and `dialog`).
- Shipped tools (`resources/bin`): the `backlog` CLI of each platform (npm `backlog.md-<os>-<arch>`, used only when none is on the PATH) and, on macOS, the vault binary. The Agent SDK's own Claude Code binary (~350 MB) is left out: the app uses the user's `claude`. A Mac app gets the login shell's PATH.
- No title bar: the tab bar is the window's (`-webkit-app-region`). macOS: window buttons on its left (`trafficLightPosition`), Windows: drawn over its right (`titleBarOverlay`, coloured from the page's `theme-color`). `electron/preload.js` adds `app-darwin` / `app-win32` to `<html>` for `style.css`.
- Closing the window hides it (Dock icon, or the tray on Windows, brings it back). Opens at login from the first run in Applications (menu: Open at Login). Size and place remembered (`settings.json` in the app's data folder).
- Links outside localhost open in the default browser.
- Encrypted docs: macOS only (`vault.js` reports them unavailable elsewhere).
- Build: `scripts/release.sh` (header lists the modes): icons, tools, `electron-builder` (config in `package.json`), notarization with the `backlog-hub` notarytool keychain profile, `--publish` for a GitHub release. Output in `dist/`.

## Project list

- `~/Library/Application Support/Backlogs/projects.json`: `{ categories: [name…], projects: [{ dir, port, category? }…] }`, projects in display order. An older file holding the bare projects array still loads.
- First run: every folder of `~/Projects` and `~/Documents` with a `backlog/config.yml`. Git worktrees (`.git` is a file) skipped.
- Name: `project_name` from the config, else the folder name.
- A project whose config is gone is hidden from the list.
- Removing a project only takes it off the list; folder and tasks stay.

## Ports

- Each project keeps its config's `default_port`.
- A port already taken in the list gets the next free one from 6430.

## Boards

- A board starts the first time its tab opens: `backlog browser --port P --no-open` in the project folder.
- A board already listening on its port (a VS Code task, say) is reused.
- The server waits up to 5 s for the port, then returns its URL.
- Boards started by the server stop when the project is removed or the server gets SIGINT / SIGTERM.

## Adding a folder

- macOS folder dialog via `osascript` (`choose folder`).
- No board there: `backlog init <folder name> --defaults --integration-mode none` (`--no-git` without `.git`).
- Already listed: just opens it.

## Task counts

Read from `backlog/tasks/*.md` `status:` lines: `Done`, `In Progress`, anything else counts as to do.

## Alerts and recurring tasks

- Alerts: every task in `backlog/tasks/` whose status isn't `Done` and that has a `due_date`, across projects, sorted by date (`alerts` in `GET /api/projects`).
- Recurring task: a label `monthly`, `quarterly` or `yearly` (or the French `mensuel`, `trimestriel`, `annuel`) and a due date. On each `GET /api/projects`, a Done one gets its next occurrence through the CLI (`backlog task create`: same title, description, labels and priority, due 1, 3 or 12 months later), then loses its recurrence label (`backlog task edit --remove-label`), so it happens once.
- Day of the month: the latest one among the tasks with the same title (in `tasks/`, `completed/` and `archive/tasks/`), cut to the month's length, so 31 Jan → 28 Feb → 31 Mar and 28 → 28.

## API

| Request | Does |
| --- | --- |
| `GET /api/projects` | Creates due recurring tasks, then `{ categories, projects, alerts }`: projects with name, place (`~`-relative), counts; alerts `[{ port, project, id, title, due, every }]` |
| `POST /api/projects` | Folder dialog, add; returns `{ port, categories, projects }` |
| `PUT /api/layout` | `{ categories, order: [{ port, category }] }`: saves categories and order |
| `POST /api/projects/<port>/start` | Starts the board; returns `{ url }` |
| `POST /api/projects/<port>/terminal` | Opens Terminal.app in the folder, running `claude --resume <current conversation>` |
| `GET /api/projects/<port>/sessions` | The project's earlier conversations, newest first: `[{ id, title, at }]` |
| `DELETE /api/projects/<port>/claude` | Stops the project's Claude Code |
| `DELETE /api/projects/<port>` | Removes from the list (and stops its Claude Code) |
| `WS /claude/<port>` | The project's Claude conversation (below) |

- Anything but a GET, and the WebSocket, must come from the app's own origin (`http://localhost:6400`): another site open in the browser can't change the list or talk to Claude.
- Other paths serve files from `public/`, and `/vendor/*` the `marked` and `dompurify` files from `node_modules` (no-cache, nothing else).

## Claude Code

- One conversation per project, run with the Agent SDK (`query`, Claude Code preset, the user's settings) in the project folder; the SDK process starts on the first message.
- The project's current conversation id is kept in `~/Library/Application Support/Backlogs/claude.json`; its transcript is loaded (`getSessionMessages`) on connection and resumed (`resume`) on the next message, so it survives restarts.
- Page → server: `send { text }`, `stop`, `answer { id, choice: allow|always|deny, answers }`, `mode { mode }`, `open { sessionId? }` (new or earlier conversation).
- Server → page: `reset` (all events + state, on connection), then `user`, `text`, `delta` (streamed text), `tool`, `result`, `ask` / `answered` (permission prompts and AskUserQuestion, through `canUseTool`), `busy`, `info { model, mode }`, `commands { list }`, `error`.
- Slash commands: `supportedCommands()` of the running conversation (again on `commands_changed`), else of a short-lived query started on connection that sends nothing (~0.3 s); cached per folder, sent in `reset` and as `commands`. A command in a transcript (`<command-name>`) shows as the user's `/name args`.
- Keeps running while the page is closed; stopped by closing the project's tab or the server stopping (the conversation is kept).

## Site

The promo page lives in `site/` (static, no build). `scripts/publish-site.sh` publishes it to the root of the `gh-pages` branch, served by GitHub Pages at https://corentin-gautier.github.io/backlog-hub/ (redirects to https://corentingautier.dev/backlog-hub/, the account's custom domain).
