---
id: doc-3
title: "The page"
type: guide
---

Plain HTML, CSS and JS in `public/` (`index.html`, `style.css`, `app.js`). Interface text is in French.

## Layout

- Top bar: a Home tab, then one tab per open project.
- Home: today's date (in the browser's language) with the theme switch at its right, "My projects" with the top row's toggles at its right, a row with Coming up, In progress and the general Claude chat (below), then a section per category with its cards, then "Uncategorized" (projects without one; shown only when it has some, or while a card is dragged).
- The + button at the bottom right of the home opens a menu: Add a project, New category. Esc or a click elsewhere closes it.

## Theme

- Light, the system's (default) or dark, picked with the switch beside the date; kept per browser (`theme` in localStorage) and applied before the first paint (inline script in `index.html`, `data-theme` on `<html>`).
- The boards follow it: a board asks for the theme on load and gets every change (postMessage `{ backlogHub: 'theme' }`); its own toggle changes the hub's theme ([Backlog.md fork](/documentation/4/backlog-fork)).

## Categories and order

- Drag a card to reorder it or move it to another section (its category changes); drag a section's heading to reorder the categories; drag a tab to reorder the tabs.
- The chevron before a category's name folds it down to its heading, and back; folded categories are kept per browser (`foldedCats` in localStorage).
- Hovering a heading shows Rename (edit in place, Enter or click away to save, Escape to cancel) and Delete (its projects go to "Uncategorized").
- Categories and the cards' order are saved in `projects.json` (PUT `/api/layout`), so every browser shows the same; the tabs' order is per browser.

## Top row

- Coming up, In progress and Claude side by side in equal columns (stacked under 980px wide).
- Toggle chips beside "My projects" show or hide each part; the shown ones share the row. Hidden parts are kept per browser (`off` in localStorage). A list with no task is hidden, and so is its chip.
- The general chat's header reads "General conversation" (the part's heading already says Claude).
- The lists stretch to the row's height; the chat fills its box, 300px high at least, 460px when it is alone.

## Coming up

- Every open task with a `due_date`, from every project, soonest first; hidden when there are none.
- A row: date block, title, a badge for a recurring task (monthly / quarterly / yearly), the project's dot, name and task id, then how far off it is.
- Orange at 7 days or less, red once past.
- The first 5 rows, then "Show N more" / "Show less".
- Clicking a row opens the project's tab on the task (`/tasks/<id>` in the board).

## In progress

- Every task with the In Progress status, from every project, in the projects' order.
- A row: title, the project's dot, name and task id; same "Show N more" and click as Coming up.

## Cards

- Initial on a coloured avatar: colour from a hash of the name over eight colours, so it stays the same.
- Name and folder (`~`-relative).
- Progress bar: done, then in progress.
- Counts: done, in progress, to do.
- × removes the project from the list after a confirmation (folder and tasks stay).

## Tabs

- Opening a project (its card) adds its tab; × on the tab closes it and drops its iframe. Closing the shown tab shows the next one, or Home.
- Each open board loads in its own iframe, kept while its tab is open, so it stays where it was left.
- The open tabs, their order and the shown one are remembered (`localStorage`) and reopened at launch.
- Back to Home refreshes the list and counts.

## Claude Code

- ✻ Claude in the top bar (shown on a project tab), or Ctrl+`, shows or hides a chat beside the board with Claude Code in the project folder (`public/claude.js`): Markdown replies, tool calls (diffs for edits, output on click, the images Claude reads shown under their row and opened on click), permission and question cards, todo list.
- Hiding the panel (×) or switching tabs leaves Claude running; closing the project's tab stops it. The clock lists earlier conversations, + starts a new one, ↗ opens the current one in Terminal.app.
- Images dropped on the panel or pasted in the input show as thumbnails above it (× removes one) and go with the next message; larger than 1568px, they are scaled down first. The sent images show in the message.
- ↵ sends, ⇧↵ adds a line, Esc (or ■) stops Claude. The chip under the input cycles the permission mode (ask, accept edits, plan, auto).
- Typing `/` opens the project's slash commands and skills, filtered as you type: ↑↓ to move, Tab completes, ↵ completes or sends one without arguments, Esc closes. `/clear` (new conversation) and `/resume` (the history) are handled by the page; the rest go to Claude Code, and the output of `/context`, `/usage`… shows as a reply.
- Drag the panel's left edge to resize it; the width and which panels are open are remembered (`localStorage`).

## Installing as an app

- Safari: File › Add to Dock. Chrome: install icon at the right of the address bar.
- `manifest.webmanifest` and a do-nothing service worker (`sw.js`) make it installable; every request goes to the local server.
- Icons: `public/icon.svg`; PNGs with `rsvg-convert -w 512 public/icon.svg -o public/icon-512.png` (and 192).
