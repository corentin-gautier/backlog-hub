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
- A board already listening on its port (a VS Code task, say) is reused.
- The server waits up to 5 s for the port, then returns its URL.
- Boards started by the server stop when the project is removed or the server gets SIGINT / SIGTERM.

## Adding a folder

- macOS folder dialog via `osascript` (`choose folder`).
- No board there: `backlog init <folder name> --defaults --integration-mode none` (`--no-git` without `.git`).
- Already listed: just opens it.

## Task counts

Read from `backlog/tasks/*.md` `status:` lines: `Done`, `In Progress`, anything else counts as to do.

## API

| Request | Does |
| --- | --- |
| `GET /api/projects` | `{ categories, projects }`, projects with name, place (`~`-relative), counts |
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
- Server → page: `reset` (all events + state, on connection), then `user`, `text`, `delta` (streamed text), `tool`, `result`, `ask` / `answered` (permission prompts and AskUserQuestion, through `canUseTool`), `busy`, `info { model, mode }`, `error`.
- Keeps running while the page is closed; stopped by closing the project's tab or the server stopping (the conversation is kept).
