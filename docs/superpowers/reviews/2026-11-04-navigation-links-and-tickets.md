# Card links and ticket requests: verification, 4 November 2026

Two tickets from the Project Jupiter board. Both are done in the source tree and verified in isolated runs. Nothing was restarted, no
real Codex, OpenAI or ElevenLabs call was made, and the live app still runs its old bundled interface and service until it is rebuilt.

## Ticket 1: open created pages inside Jupiter

Cause, confirmed in code: `vite.config.ts` had `server.open: true`, so any dev server an agent started opened the owner's browser.
`Conversation.tsx` treated every http link as external (a new window) and `TerminalPane.tsx` called `window.open` for every web link, so the
native layer (`external_links.rs`) sent a card address to the OS browser. Nothing recognised a registered card.

Reproduced first. A card link in a chat opened a browser window (`card-links-ui.mjs` against the unchanged interface: "a card link must not
open a browser window", 1 !== 0).

Changes:
- `vite.config.ts`: `server.open: false` and `preview.open: false`. `Setup.ps1` and `setup.sh` Preview mode pass `--open`, so the owner's own preview still opens.
- `desktop/service/workspace-links.mjs` (+ `.d.mts`): what a link means. A registered card ID opens as a card on the app address, a usual preview port
  (3009, 4173) or any local address, with `/<page>` honoured (an out of range page falls back to the default page). An unknown ID is reported on the app address
  and the usual preview ports only, so another local tool with its own `#/route` still opens in the browser. Websites, other paths and other schemes are untouched.
- `POST /api/workspace/link` in `server.mjs` navigates the Workspace window through the same `show_workspace` path the assistant uses. `show_workspace` now
  returns `delivered` and `shown: delivered > 0`, so success is claimed only when a Workspace window received the route; the unknown ID error names the ID.
- `src/desktop/cardLinks.ts`, `Conversation.tsx`, `TerminalPane.tsx`: only links shaped like a card link ask the service; everything else takes the old path.
  A bare `#/card-id` link in a chat message is now clickable. If the service cannot be asked, the browser opens the link as before.
- `.agents/skills/workspace-authoring/SKILL.md` and `processes/workspace-authoring.md` (then `npm run skills:sync`): link the card as `#/<id>`, never present a dev
  server address, verify with an isolated preview with auto-open off, offer Open in browser only when asked, say "shown in the app" only when Jupiter confirms it.
- `external_links.rs`: not changed (see open questions), so no Rust build or `cargo check` was needed.

Verification:

| Command | Result |
| --- | --- |
| `node --test desktop/service/test/workspace-links.test.mjs` | 5 passed (link rules, the stopped 5187 address, unknown IDs, WebSocket delivery, native window shown, chat selection untouched) |
| `node --test desktop/service/test/vite-config.test.mjs` | 2 passed (neither server opens a browser; `open: true` can still be asked for) |
| `node desktop/service/test/card-links-ui.mjs` (via the dist lock, Edge) | passed: Conversation card, page, relative and removed card links; terminal card and removed card links; a local tool and an external site still open as popups; chat stays on its Conversation; no console errors apart from the known `/mobile/api/bootstrap` 400 |
| `node desktop/service/test/links-ui.mjs` | stops at `.xterm-cursor-pointer` in the terminal part, in the same place with the original Conversation and TerminalPane (built from the backup into a scratch folder). JUPITER.md already records this |
| `node desktop/service/test/conversation-ui.mjs`, `dashboard-ui.mjs`, `navigation-ui.mjs` | passed |

Screenshots: `.cache/overnight/navigation/card-link-workspace-page.png` (the requested page selected in the Workspace while the chat stays open),
`.cache/overnight/navigation/card-link-removed-feedback.png` (feedback for a removed card).

## Ticket 2: recognise ticket requests and use Codex to draft details

Reproduced before changing code (`scratchpad/repro/repro-ticket.mjs`, stand-in dependencies only):
1. The Ask bar had no ticket rule. "create a feature ticket to increase the rotation speed of the brain animation, have Codex write the details" started an
   agent chat named "Create A Feature Ticket To" with the raw sentence and saved nothing (`tickets-ui.mjs` against the unchanged interface; screenshot
   `.cache/overnight/navigation/ticket-ask-before-fix.png`). "add …" would have saved the whole sentence as the title, with no details.
2. The service left every other phrasing to the language model: `quick.ask` returned null.
3. `add_work_item` was not idempotent (two calls made two tickets) and silently created a new board when the name did not match exactly.
4. Nothing asked Codex by default. `start_work_chat` defaults to Claude, finds the ticket by a title substring and its brief does not forbid invented values or extra tickets.
5. Nothing checked that drafted details were ever saved before success was reported.

Changes:
- `desktop/service/ticket-requests.mjs` (+ `.d.mts`, shared by the interface and the service): recognises "create/add/raise/log/open a (feature|bug|spike) ticket", takes the type,
  title, board ("on the X board") and drafting choice (Codex by default; "have Claude" or "without Codex / just the title" honoured). Also builds the brief and checks a finished draft.
- `desktop/service/tickets.mjs`: `add_work_item` now makes one ticket (a repeat finds the existing open one), resolves the board by title, slug or one close match (unknown is an error,
  never a new board), saves, then starts a visible Codex chat with the user's words verbatim, the ticket ID, an "edit only that item" rule and a "do not invent values, list them as
  open questions" rule. The reply says the details are not saved yet. When that chat finishes, Jupiter says the details are saved only if the board really holds them, and says plainly
  when they are not, when the ticket vanished, or when there are duplicates.
- `quick-actions.mjs` handles the request before the compound sentence check; `server.mjs` stops weather, news and "open …" voice rules taking a ticket request; `Dashboard.tsx` sends
  it to `/api/coordinator` and shows the real reply; `coordinator.mjs` tool text and instructions say the same to the language model.

Verification:

| Command | Result |
| --- | --- |
| `node --test desktop/service/test/ticket-requests.test.mjs` | 15 passed: recognition table, reported request on the latest board as a Feature, Codex by default and when explicit, none when declined, no duplicates (ticket or chat), named and unknown boards, save and chat start failures reported plainly, completion check, tool idempotence through a stand-in model, news and voice guards |
| `node desktop/service/test/tickets-ui.mjs` (via the dist lock, Edge) | passed after rebuild: the Ask bar reply names the title and board and says the details are not saved yet; one Feature on the board; one stand-in Codex chat; no console errors apart from the known `/mobile/api/bootstrap` 400 |
| `node --test desktop/service/test/*.test.mjs` | 318 tests, 311 passed, 1 failed, 6 skipped. The one failure is the known `quick-actions.test.mjs` encoding test. Baseline was 282 / 275 / 1 / 6 |
| `npm run lint`, `npx tsc -b`, `npm run build` | clean |

Screenshot: `.cache/overnight/navigation/ticket-ask-saved.png` (the board shows the ticket in Backlog).

## Not run or not clean, and why
- `npm run test:template` fails in `scripts/check-template.mjs` on the category list of the owner's real `workspace/workspace.json`, unrelated to these changes. `sync-skills --check` is clean.
- Pending for the live app: rebuild and restart. The app bundles its own copy of the interface and service, so both tickets need `npm run desktop:build -- --no-bundle` and a restart
  at the owner's convenience. No Rust change is pending.

## Assumptions and open questions
- Recognition needs the word ticket or work item ("create a feature ticket …"). "Add a feature to …" is not treated as a ticket.
- A named board that does not exist is an error. Before, the assistant silently created it. Say if you want "create the board" back for voice.
- An existing open ticket with the same title is reused. If it already has details, an explicit "have Codex write the details" leaves them alone.
- The Ask bar reply is hidden behind the To do window when the board opens; the ticket on the board and the Codex chat tab are the visible confirmation.
- Agents have no control token (by design), so an agent cannot select a card itself. They link the card (`#/<id>`) and the owner's click opens it in the app; the assistant's `show_workspace` also reports `shown`. Auto selecting a new card when the registry changes was not added.
- `external_links.rs` still sends other new window web links (for example a link inside a report iframe) to the OS browser. A follow up would pass the app handle so a card link there
  navigates the Workspace window instead.
