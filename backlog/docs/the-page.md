---
id: doc-3
title: "The page"
type: guide
---

Plain HTML, CSS and JS in `public/` (`index.html`, `style.css`, `app.js`). Interface text is in French.

## Layout

- Top bar: a Home tab ("Accueil"), one tab per open project, and a + button to add a project.
- Home: today's date (French format), "Mes projets", then a section per category with its cards, then "Sans catégorie" (projects without one, and the "Ajouter un projet" card), then a "+ Nouvelle catégorie" button.

## Categories and order

- Drag a card to reorder it or move it to another section (its category changes); drag a section's heading to reorder the categories; drag a tab to reorder the tabs.
- Hovering a heading shows Renommer (edit in place, Enter or click away to save, Escape to cancel) and Supprimer (its projects go to "Sans catégorie").
- Categories and the cards' order are saved in `projects.json` (PUT `/api/layout`), so every browser shows the same; the tabs' order is per browser.

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

- ✻ Claude in the top bar (shown on a project tab), or Ctrl+`, shows or hides a panel beside the board running `claude` in the project folder (xterm.js, `public/claude.js`). Always dark.
- Hiding the panel (×) or switching tabs leaves Claude running; closing the project's tab stops it. ↻ restarts it, ↗ Terminal opens the same in Terminal.app.
- Drag the panel's left edge to resize it; the width and which panels are open are remembered (`localStorage`).

## Installing as an app

- Safari: File › Add to Dock. Chrome: install icon at the right of the address bar.
- `manifest.webmanifest` and a do-nothing service worker (`sw.js`) make it installable; every request goes to the local server.
- Icons: `public/icon.svg`; PNGs with `rsvg-convert -w 512 public/icon.svg -o public/icon-512.png` (and 192).
