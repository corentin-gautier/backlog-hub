---
id: doc-4
title: "Backlog.md fork"
type: guide
---

Backlog.md is a compiled binary, so what Backlog Hub changes in the boards lives in a fork: https://github.com/corentin-gautier/Backlog.md, branch `backlogs` (its default), on top of upstream's `main` (https://github.com/MrLesk/Backlog.md). Local clone: `~/Projects/Backlog.md`, remotes `origin` (upstream) and `fork`. Its build is the `backlog` command (`/opt/homebrew/bin/backlog` links to `dist/backlog`); Homebrew's `backlog-md` stays installed, unlinked and pinned.

## What the fork changes

- Theme: follows macOS, live. The toggle still picks the other theme; picking the system's one again goes back to following it. Saved as `backlog-theme-choice` (the old `backlog-theme` was saved on every load, so it is dropped). Inside Backlog Hub, the hub's theme wins and the toggle changes it (`ThemeContext.tsx`).
- Docs are edited where they are shown (`DocEditor.tsx`, Milkdown Crepe): formatting toolbar on selection (with the block's level: text, heading 1 to 3), `/` to insert a block (no block handle: its + and drag are hidden), Markdown shortcuts, editable tables. Saved 0.8 s after the last keystroke (Saved / Saving… beside the buttons); the title is edited in place too.
- The Markdown button opens the former editor: source, title and path, with Save and Cancel.
- The Markdown written back keeps the file's style: `-` lists, `---` under table headers, unpadded tables, bare links. The server itself drops the blank line after the front matter (as before).
- A file changed elsewhere (Claude, git) while open reloads in the editor, unless an edit is waiting to be saved.
- Doc and decision headers (`RecordHeader.tsx`): title and quiet buttons on one line (Archive red on hover only), the id, the path (without the id starting the file name) and the date on a small line below, aligned with the content's edges.
- Inside Backlog Hub: a link to another site (task, doc, anywhere on the board) opens in a new tab, the default browser in the desktop app, instead of replacing the board (`lib/hub-links.ts`).
- Inside Backlog Hub: encryption controls on the doc page and padlocks in the sidebar ([Encrypted docs](/documentation/5/encrypted-docs)).

## Build and update

- `scripts/backlog-fork.sh`: builds the fork and links it as `backlog`.
- `scripts/backlog-fork.sh --update`: rebases the fork on upstream's `main` and pushes it first, then builds.
- Without the clone, the script makes it from the fork.
- The script then stops the running boards (closing a tab does not); reload Backlog Hub (Cmd+R) to start them with the new build.
- Needs Bun (`brew install oven-sh/bun/bun`).
