---
id: doc-2
title: "How it works"
type: specification
---

`server.js`, plus `claude.js` for the Claude chat (dependencies: `@anthropic-ai/claude-agent-sdk`, `ws`, and `marked` + `dompurify` served to the page). Serves `public/` on `127.0.0.1:6400` (`BACKLOGS_PORT` to override).

## Running

| How | Command |
| --- | --- |
| At every login | `./install.sh`: launchd agent `local.backlogs` (`~/Library/LaunchAgents/local.backlogs.plist`, `RunAtLoad`, `KeepAlive`), then opens http://localhost:6400 |
| Remove the agent | `./install.sh --uninstall` |
| By hand | `npm install && node server.js` |

- `install.sh` runs `npm install` with the agent's Node. The agent's `PATH` holds the `backlog` CLI's folder; Node from fnm's default alias when present.
- Log: `~/Library/Logs/Backlogs.log`.

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
- The tab shows it through a proxy on P + 1000 (`proxy.js`): Backlog.md is a compiled binary, so the proxy adds `board/board.css` and `board/board.js` to its HTML (served under `/__backlogs/`); WebSockets pass through. They make the theme follow macOS: the saved `backlog-theme` is dropped before the page loads, the board's toggle is hidden and clicked when macOS switches.
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
- Recurring task: a label `mensuel`, `trimestriel` or `annuel` and a due date. On each `GET /api/projects`, a Done one gets its next occurrence through the CLI (`backlog task create`: same title, description, labels and priority, due 1, 3 or 12 months later), then loses its recurrence label (`backlog task edit --remove-label`), so it happens once.
- Day of the month: the latest one among the tasks with the same title (in `tasks/`, `completed/` and `archive/tasks/`), cut to the month's length, so 31 Jan → 28 Feb → 31 Mar and 28 → 28.

## API

| Request | Does |
| --- | --- |
| `GET /api/projects` | Creates due recurring tasks, then `{ categories, projects, alerts }`: projects with name, place (`~`-relative), counts; alerts `[{ port, project, id, title, due, every }]` |
| `POST /api/projects` | Folder dialog, add; returns `{ port, categories, projects }` |
| `PUT /api/layout` | `{ categories, order: [{ port, category }] }`: saves categories and order |
| `POST /api/projects/<port>/start` | Starts the board and its proxy; returns `{ url }` (the proxy's) |
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
