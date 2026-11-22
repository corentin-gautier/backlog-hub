---
id: doc-5
title: Encrypted docs
type: guide
created_date: '2026-11-22T10:27:51Z'
---

A doc marked as encrypted keeps its body encrypted on disk; Touch ID unlocks it. Needs the Backlog.md fork: the controls live on the board's doc page.

## On the doc page (fork)

- Header button: Encrypt (not marked), Encrypted (marked and locked; a click unlocks), Locks in N min (unlocked; menu: Lock now, Stop encrypting this doc).
- A locked doc shows a card with Unlock with Touch ID in place of its body; editing, the title, Markdown and Archive are off, so the encrypted file is never written over. A waiting edit is dropped if the doc gets locked meanwhile.
- Sidebar: a padlock beside every marked doc (open while unlocked).
- Outside Backlog Hub the buttons are hidden; a locked doc says to open the board in Backlog Hub.
- Code: `src/web/lib/hub-vault.ts` (messages, state), `src/web/components/VaultControls.tsx`.

## Between the board and Backlog Hub

- The board posts `{ backlogHub: 'vault', seq, do, id }` to its parent (`do`: status, mark, unmark, unlock, lock; `id`: the doc id), on load and every 30 s for the status.
- `public/vault.js` takes a message only from a board's own iframe, calls `GET`/`POST /api/projects/<port>/vault` for that project, and answers the frame with `{ backlogHub: 'vault', seq, state }`: `{ docs: [{ id, title, marked, locked }], until }`, or `{ error }`.

## Server (`vault.js`, `vault/vault.swift`)

- Marked files: `~/Library/Application Support/Backlogs/vault.json`; the Secure Enclave key: `…/Backlogs/vault/`. Never rename that folder: the docs could not be decrypted.
- On disk: front matter, a notice, then `<!-- backlogs-vault v1 BASE64 -->`.
- Unlock decrypts every marked doc of the project (one Touch ID); they lock again after 5 minutes, when the project's tab closes, and when the server starts or stops.
- Marking a doc while the project is unlocked leaves it readable until the common relock; otherwise it is encrypted at once.
- `swiftc` builds `vault/backlogs-vault` on first start; delete it to rebuild after a change to `vault.swift`.
