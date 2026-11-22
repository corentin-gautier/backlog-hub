---
id: doc-4
title: "Backlog.md fork"
type: guide
---

Backlog.md is a compiled binary, so what Backlogs changes in the boards lives in a fork: https://github.com/corentin-gautier/Backlog.md, branch `backlogs` (its default), on top of upstream's `main` (https://github.com/MrLesk/Backlog.md). Local clone: `~/Projects/Backlog.md`, remotes `origin` (upstream) and `fork`. Its build is the `backlog` command (`/opt/homebrew/bin/backlog` links to `dist/backlog`); Homebrew's `backlog-md` stays installed, unlinked and pinned.

## What the fork changes

- Theme: follows macOS, live. The toggle still picks the other theme; picking the system's one again goes back to following it. Saved as `backlog-theme-choice` (the old `backlog-theme` was saved on every load, so it is dropped).
- Docs are edited where they are shown (`DocEditor.tsx`, Milkdown Crepe): formatting toolbar on selection, `/` or the + handle to insert a block, Markdown shortcuts, editable tables. Saved 0.8 s after the last keystroke (Saved / Saving… beside the buttons); the title is edited in place too.
- The Markdown button opens the former editor: source, title and path, with Save and Cancel.
- The Markdown written back keeps the file's style: `-` lists, `---` under table headers, unpadded tables, bare links. The server itself drops the blank line after the front matter (as before).
- A file changed elsewhere (Claude, git) while open reloads in the editor, unless an edit is waiting to be saved.

## Build and update

- `scripts/backlog-fork.sh`: builds the fork and links it as `backlog`.
- `scripts/backlog-fork.sh --update`: rebases the fork on upstream's `main` and pushes it first, then builds.
- Without the clone, the script makes it from the fork.
- Then restart the boards: close their tabs, or restart Backlogs.
- Needs Bun (`brew install oven-sh/bun/bun`).
