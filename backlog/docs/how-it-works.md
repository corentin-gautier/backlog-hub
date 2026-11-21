---
id: doc-2
title: "How it works"
type: specification
---

`server.js`, plus `claude.js` for the Claude Code terminal (dependencies: `node-pty`, `ws`, `@xterm/xterm`, `@xterm/addon-fit`; `npm install` runs a `postinstall` that makes node-pty's `spawn-helper` executable). Serves `public/` on `127.0.0.1:6400` (`BACKLOGS_PORT` to override).

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
| `POST /api/projects/<port>/terminal` | Opens Terminal.app in the folder, running `claude` |
| `DELETE /api/projects/<port>/claude` | Stops the project's Claude Code |
| `DELETE /api/projects/<port>` | Removes from the list (and stops its Claude Code) |
| `WS /claude/<port>?cols=&rows=` | The project's Claude Code terminal (below) |

- Anything but a GET, and the WebSocket, must come from the app's own origin (`http://localhost:6400`): another site open in the browser can't change the list or reach a shell.
- Other paths serve files from `public/`, and `/vendor/*` the xterm files from `node_modules` (no-cache, nothing else).

## Claude Code

- One terminal per project, started on the first connection: the user's login shell (`$SHELL -ilc 'claude; exec $SHELL -il'`) in the project folder, so PATH and the rest come from the profile; the shell stays if `claude` exits.
- Messages from the page: `{ type: 'input', data }`, `{ type: 'resize', cols, rows }`; the server sends raw output.
- The last 256 KB of output are kept and replayed when the page reconnects (reload, app relaunch). Stopped by closing the project's tab, ↻, or the server stopping.
