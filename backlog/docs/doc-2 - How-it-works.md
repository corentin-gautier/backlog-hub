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
| At every login | `./install.sh`: launchd agent `local.backlogs` (`~/Library/LaunchAgents/local.backlogs.plist`, `RunAtLoad`, `KeepAlive`), then builds and opens the Mac app |
| Rebuild the Mac app | `scripts/build-app.sh` |
| Remove the agent | `./install.sh --uninstall` |
| By hand | `npm install && node server.js` |

- `install.sh` runs `npm install` with the agent's Node. The agent's `PATH` holds the `backlog` CLI's folder; Node from fnm's default alias when present.
- Log: `~/Library/Logs/Backlogs.log`.

## Mac app

`mac/BacklogHub.swift`, built by `scripts/build-app.sh` (swiftc, icon from `public/icon.svg` via rsvg-convert and iconutil, ad hoc signed) into `/Applications/Backlog Hub.app`. A window with a WebKit view on http://localhost:6400; the server stays the launchd agent's.
- No title bar: the system's one, even transparent, catches drags at the top of the window and broke reordering tabs. It is hidden and the window buttons are the app's own (`WindowButtons`), centred on the tabs. The page gets the `mac-app` class (room for them in `style.css`); a click on an empty spot of the tab bar moves the window, a double click zooms it.
- Closing the window hides it (conversations stay loaded); the Dock icon brings it back. Size and place remembered.
- Links outside localhost open in the default browser. `alert`, `confirm`, `prompt` and file pickers are native sheets.
- Menus: Edit (copy, paste…), View (Home Cmd+Shift+H, Reload Cmd+R, zoom Cmd+0/+/-), Window. Web Inspector: right click › Inspect Element.
- Theme and palette are stored by the app's web view, apart from any browser.

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
