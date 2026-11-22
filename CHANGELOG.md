# Changelog

## 0.2.1 — 2026-11-22

### Fixes

- **vault:** a doc quoting the marker is not taken for encrypted ([6983ed5](https://github.com/corentin-gautier/backlog-hub/commit/6983ed5))
- **scripts:** stop the running boards after building the fork ([6344e93](https://github.com/corentin-gautier/backlog-hub/commit/6344e93))
- open the boards' external links in the browser ([9538dd5](https://github.com/corentin-gautier/backlog-hub/commit/9538dd5))

## 0.2.0 — 2026-11-22

### Features

- VS Code button only for projects that use VS Code ([dbc3972](https://github.com/corentin-gautier/backlog-hub/commit/dbc3972))

## 0.1.0 — 2026-11-22

First release, as a desktop app for macOS and Windows.

### Desktop app
- Download a `.dmg` (Apple silicon or Intel, signed and notarized) or a Windows installer: everything ships inside, its own Node and the `backlog` CLI. A `backlog` on your PATH (such as the fork) wins.
- The tab bar is the window's title bar; closing the window keeps the app and its Claude conversations running. Opens at login (menu: Open at Login).

### Home
- A card per Backlog.md board, in categories you name, order by drag and drop and fold.
- Coming up: open tasks with a due date across every project, soonest first; tasks labelled `monthly`, `quarterly` or `yearly` come back once done.
- In progress: every task in progress, across projects.
- Light or dark, following your system or picked on the home; the boards follow the theme.
- A tab per open project, reordered by dragging, closed with a middle click.

### Claude Code
- A chat with Claude Code beside each board (Ctrl+`) and a general one on the home page, on the Agent SDK with your own `claude` sign-in.
- Mode and model menus, slash commands, images dropped or pasted, the images Claude reads shown in the chat.
- Subagents shown as blocks with their tools, state and report.
- Links open in the browser, file paths in VS Code at their line, HTML pages in Chrome.

### Encrypted docs (macOS)
- A doc's Encrypt button keeps its body encrypted on disk, unlocked with Touch ID (with the Backlog.md fork).
