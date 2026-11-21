---
id: doc-2
title: "How it works"
type: specification
---

One Node file, `server.js`, no dependencies. Serves `public/` on `127.0.0.1:6400` (`BACKLOGS_PORT` to override).

## Running

| How | Command |
| --- | --- |
| At every login | `./install.sh`: launchd agent `local.backlogs` (`~/Library/LaunchAgents/local.backlogs.plist`, `RunAtLoad`, `KeepAlive`), then opens http://localhost:6400 |
| Remove the agent | `./install.sh --uninstall` |
| By hand | `node server.js` |

- The agent's `PATH` holds the `backlog` CLI's folder; Node from fnm's default alias when present.
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
| `GET /api/projects` | List with name, place (`~`-relative), counts |
| `POST /api/projects` | Folder dialog, add; returns `{ port, projects }` |
| `POST /api/projects/<port>/start` | Starts the board; returns `{ url }` |
| `DELETE /api/projects/<port>` | Removes from the list |

Other paths serve files from `public/` (no-cache, nothing outside the folder).
