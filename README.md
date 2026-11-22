# Backlog Hub

A home page for every [Backlog.md](https://github.com/MrLesk/Backlog.md) board on your Mac: a card per project with its task counts, a tab per open project, and a button to add a folder (a board is created in it if it has none).

- **Projects**: cards grouped in categories you name and order by drag and drop.
- **Coming up**: open tasks with a due date, across every project, soonest first. A task labelled `monthly`, `quarterly` or `yearly` comes back once done.
- **Claude Code** beside each board (✻ Claude, or Ctrl+`), and a general chat on the home page. A conversation keeps running while the page is closed.
- **Encrypted docs**: the padlock keeps chosen docs encrypted on disk, unlocked with Touch ID.

macOS only.

## Requirements

- [Node](https://nodejs.org) 20 or later.
- The `backlog` CLI: `brew install backlog-md` or `npm i -g backlog.md`.
- For the Claude Code panel: the [`claude` CLI](https://docs.claude.com/en/docs/claude-code), signed in.
- For encrypted docs: the Xcode Command Line Tools (`xcode-select --install`), for `swiftc`.

## Install

```sh
git clone https://github.com/corentin-gautier/backlog-hub.git && cd backlog-hub
./install.sh            # starts the server at every login, opens http://localhost:6400
./install.sh --uninstall
```

Then install the page as an app: in Safari, File › Add to Dock; in Chrome, the install icon at the right of the address bar.

## Optional: the Backlog.md fork

Boards work with the standard `backlog`. A [fork](https://github.com/corentin-gautier/Backlog.md) adds a visual doc editor (docs edited where they are shown) and a theme that follows macOS. To build it and make it the `backlog` command (needs [Bun](https://bun.sh) and Homebrew on Apple Silicon):

```sh
scripts/backlog-fork.sh            # build and link
scripts/backlog-fork.sh --update   # rebase on upstream first
```

Homebrew's `backlog-md` is kept, unlinked: `brew link backlog-md` brings it back.

## How it works

- `server.js` serves `public/` on port 6400 and starts each board (`backlog browser --port P --no-open`) the first time its tab opens. A board already running on its port (a VS Code task, say) is reused.
- The project list is `~/Library/Application Support/Backlogs/projects.json`. On first run it holds every board found in `~/Projects` and `~/Documents` (git worktrees skipped).
- Each project keeps its config's `default_port`; a port already taken gets the next free one from 6430.
- Removing a project only takes it off the list.
- Claude Code panel: a chat with Claude Code in the project folder (the home folder for the general chat), run by `claude.js` with the Agent SDK and streamed to the page over a WebSocket. It stops when the project's tab is closed and picks up the same conversation next time.
- Log: `~/Library/Logs/Backlogs.log`. Run by hand: `npm install && node server.js`.
- Icons: `rsvg-convert -w 512 public/icon.svg -o public/icon-512.png` (and 192).

## License

[MIT](LICENSE)
