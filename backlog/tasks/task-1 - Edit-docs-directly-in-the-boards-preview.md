---
id: TASK-1
title: Edit docs directly in the board's preview
status: To decide
assignee: []
created_date: '2026-11-22T09:15:00Z'
labels: []
dependencies: []
ordinal: 1000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Backlog.md only edits a doc as raw Markdown (Edit button). Inject, through proxy.js and board/board.js, a WYSIWYG editor (e.g. Milkdown or Tiptap with a Markdown serializer) in place of the preview, saving with PUT /api/docs/<id>. Caveat: the serializer normalizes the file's Markdown on first save (table spacing, list markers). Mockup first.
<!-- SECTION:DESCRIPTION:END -->
