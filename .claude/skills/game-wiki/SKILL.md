---
name: game-wiki
description: Build or update a game wiki (world bible, lore and design wiki) from brainstorm boards, notes or a game idea, using Jupiter's standard wiki template. Use when the user asks for a game wiki, a world or lore wiki, a design reference, or to turn a brainstorm into a wiki.
---

# Game wiki

Every game wiki uses one template, so the layout is never redesigned. Your job is
the content: collect the ideas, place them on the right pages and validate. Read
`AGENTS.md` and follow [workspace authoring](../workspace-authoring/SKILL.md) for
card registration, previews and the final card link.

## 1. Collect the sources

Read only what the user points to, plus the brainstorm material:

- Brainstorm boards: `knowledge/boards/<slug>.md` (readable summaries; the `.json`
  beside each is drawing data, do not parse it for content).
- Dashboard ideas: `knowledge/notes/brainstorm.md`.
- The user's message and any documents or folders they name.

If several boards could match and the request does not say which, ask. Do not
invent lore, numbers or features. Anything not decided in the sources is a
**proposal**: put it on the Ideas page or mark it "Proposal" or "Not decided".

## 2. Scaffold the card

From the repository root:

```sh
node .agents/skills/game-wiki/scripts/new-wiki.mjs --title "Game title" --tagline "One-line hook"
```

It creates `workspace/<date>_<id>/wiki.html` and `media/`, registers the card in
`workspace/workspace.json` and prints the card ID and link. To update an existing
wiki, skip this step and edit its `wiki.html` in place.

## 3. Fill the pages

Every element marked `data-placeholder` must be replaced with real content (remove
the attribute) or deleted. Keep the class names, page IDs and structure.

| Page | Put here |
| --- | --- |
| `overview` | Lead pitch, four facts (genre, view, players, engine), what is current |
| `vision` | Pitch, design pillars, in and out of scope, audience |
| `characters` | Player character, companions and key NPCs, creatures and enemies |
| `locations` | World summary, regions (layer cards), notable places (`details.region`) |
| `factions` | Groups, what they want, attitude to the player |
| `lore` | History, story outline, how the story is told |
| `mechanics` | Core loop (`.flow`), systems with status, controls |
| `progression` | Growth stages, unlocks, economy and rewards |
| `interface` | Screens and HUD |
| `art` | Style rules, palette, references and images |
| `audio` | Music and sound direction |
| `roadmap` | Milestones with a "done when" for each |
| `assets` | One `<tr data-category="…">` per asset; categories must match the select options |
| `ideas` | Every undecided brainstorm idea with its status and origin |
| `decisions` | Decisions with reasons, open questions, risks |
| `sources` | Authority order; snapshots live in `wiki-data` |

A page with nothing in the sources keeps one short line such as "Not decided yet"
plus the relevant open question. Do not pad. To drop or add a page, change the
nav link, the `<article>`, the neighbouring footers and any `concepts` key together.
The first page must stay `overview`. Copy component markup from the snippet
comment at the top of `<main>`.

## 4. Sources, concepts and images

- **Sources:** add one entry per brainstorm board or note to `wiki-data.sources`:
  `{"id": "combat-board", "title": "Combat brainstorm", "kind": "Brainstorm board",
  "path": "knowledge/boards/combat.md", "date": "8 November 2026", "text": "<full text>"}`.
  Write `<\/` instead of `</` inside JSON strings. Cite sources at the bottom of a
  page with `<p class="source-line">Sources: <a href="#sources/combat-board">Combat brainstorm</a></p>`.
- **Concepts rail:** `wiki-data.concepts.<page id>` holds `[title, status, route]`
  links, for example `["Grappling hook", "Proposal", "ideas"]`.
- **Images:** copy files into the card's `media/` folder and use the figure snippet
  with relative `src` and real alt text. Never embed base64 images. The shared
  viewer adds full-size preview and download automatically.

## 5. Validate and deliver

```sh
node .agents/skills/game-wiki/scripts/check-wiki.mjs workspace/<folder>/wiki.html
```

Fix every problem it reports. Then preview the card at wide and narrow widths as
workspace authoring describes: navigation, search, the contents rail and images.
When updating, change `updated` in `workspace/workspace.json` and the sidebar
"Updated" date. Reply with the card link printed by the scaffold, for example
`[Game title · Game Wiki](#/<id>)`, and list what came from the sources versus
what is marked as a proposal.
