---
id: doc-3
title: "The page"
type: guide
---

Plain HTML, CSS and JS in `public/` (`index.html`, `style.css`, `app.js`). Interface text is in French.

## Layout

- Top bar: a Home tab ("Accueil"), one tab per open project, and a + button to add a project.
- Home: today's date (French format), "Mes projets", a card per project, then an "Ajouter un projet" card.

## Cards

- Initial on a coloured avatar: colour from a hash of the name over eight colours, so it stays the same.
- Name and folder (`~`-relative).
- Progress bar: done, then in progress.
- Counts: done, in progress, to do.
- × removes the project from the list after a confirmation (folder and tasks stay).

## Tabs

- Opening a project (its card) adds its tab; × on the tab closes it and drops its iframe. Closing the shown tab shows the next one, or Home.
- Each open board loads in its own iframe, kept while its tab is open, so it stays where it was left.
- The open tabs and the shown one are remembered (`localStorage`) and reopened at launch.
- Back to Home refreshes the list and counts.

## Installing as an app

- Safari: File › Add to Dock. Chrome: install icon at the right of the address bar.
- `manifest.webmanifest` and a do-nothing service worker (`sw.js`) make it installable; every request goes to the local server.
- Icons: `public/icon.svg`; PNGs with `rsvg-convert -w 512 public/icon.svg -o public/icon-512.png` (and 192).
