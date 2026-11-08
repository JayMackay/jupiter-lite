---
name: workspace-authoring
description: Create or maintain Workspace cards, report tabs and Markdown deliverables with consistent styling, working media previews and clear project organization.
---

# Workspace authoring

Read `AGENTS.md` and [the workflow](../../../processes/workspace-authoring.md).
Keep authored content in English unless the user explicitly requests another
language. Put related iterations in an existing card rather than creating
several cards for one task. Do not reorganize unrelated projects.

For a gallery or research page that the owner wants to edit directly, use the
versioned `.card.json` format in [editable cards](../../../docs/editable-cards.md).
Register its step with `viewer: "card"`. Keep stable entry IDs, relative local
images and Markdown notes; validate with `desktop/service/card-schema.mjs` before
saving. Reread the source before each edit and update the registry date. The app
provides the view, so do not create a second editable HTML copy of the same data.
Preserve existing custom HTML unless conversion was requested. Browser and phone
previews can read these cards; the desktop Workspace provides editing controls.

Use `workspace/_shared/report.css` and `report.js` in every HTML report, with
`data-jupiter-report="document"` on the root element. Use the shared tokens and
layout instead of inventing another visual theme. Basic cards and media grids
can use the sample CSS in `workspace/_shared/examples.css`.
Standard reports follow the reader's Dark, Light or System preference. Check
both dark and light when adding custom styles. An intentionally independent
design, such as a game demo, can keep its palette with `data-jupiter-theme="custom"`
on the root element. Do not invert or recolor media to implement a theme.

Every image must be clickable, preview at full size and offer a download.
Use local output paths, meaningful alt text and lazy loading. Keep motion
studies playable with native video controls. Wide tables must scroll within
the report. Never cover the document close button with the Files rail.

Update `workspace/workspace.json` with a stable ID, category, folder, readable
title, creation date, last updated date and steps. `sample: true` is reserved for
starter examples; ordinary work uses normal archiving behavior.

Show finished work inside Jupiter, not in a browser. After registering a card, confirm its
ID is in `workspace/workspace.json`, then give the result as a Jupiter card link in your reply:
`[Title](#/<entity id>)` or `[Title](#/<entity id>/<page number>)`. Clicking it selects the card
and page in the running app and leaves the chat open. Never present a development server address
(`npm run dev`, a port such as 5187) as the result or leave one running for the owner. For your own
checks use an isolated preview with browser auto-open off, as `scripts/check-preview-ui.mjs` does
(an in-process Vite server with `open: false`); `npm run dev` does not open a browser unless it is
given `--open`, which is the owner's choice. Offer Open in browser only when asked. Say a card was
shown in the app only when Jupiter confirms it (`show_workspace` returns `shown: true`); otherwise
say that it is registered and give the card link.

Open every changed tab at wide and narrow sizes. Check media and links, Markdown
rendering and image close/download controls. Preserve the selected surface during
loading. Report actual verification and any remaining limitations. Prepare
desktop changes without restarting active sessions until the user permits it.

Mobile reports use the same HTML or Markdown as desktop. Include the viewport
meta tag and shared styles; keep the reading order useful in a single column.
Test at 390 px and 768 px as well as desktop width. Verify readable text without
zooming, wrapping tab labels, reachable close/download buttons, and working
image previews with touch. Confine horizontal scrolling to tables and code.
Use relative assets inside the report folder or `workspace/_shared/`.
Reports opened through Mobile Access run in an isolated, read-only preview:
do not depend on the desktop control API, parent-window DOM, local storage or
absolute localhost URLs. Keep a short result summary before lengthy details.
