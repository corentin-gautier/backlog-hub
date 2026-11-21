# Backlogs

A home page for every [Backlog.md](https://github.com/MrLesk/Backlog.md) board on this Mac: a card per project with its task counts, a tab per open project, and a button to add a folder (a board is created in it if it has none).

Needs Node and the `backlog` CLI.

## Install

```sh
./install.sh            # starts the server at every login, opens http://localhost:6400
./install.sh --uninstall
```

Then install the page as an app: in Safari, File › Add to Dock; in Chrome, the install icon at the right of the address bar.

## How it works

- `server.js` serves `public/` on port 6400 and starts each board (`backlog browser --port P --no-open`) the first time its tab opens. A board already running on its port (a VS Code task, say) is reused.
- The project list is `~/Library/Application Support/Backlogs/projects.json`. On first run it holds every board found in `~/Projects` and `~/Documents` (git worktrees skipped).
- Each project keeps its config's `default_port`; a port already taken gets the next free one from 6430.
- Removing a project only takes it off the list.
- Log: `~/Library/Logs/Backlogs.log`. Run by hand: `node server.js`.
- Icons: `rsvg-convert -w 512 public/icon.svg -o public/icon-512.png` (and 192).
