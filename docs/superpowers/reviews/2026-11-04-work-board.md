# Work board verification, 4 November 2026

Three tickets from `knowledge/work/project-jupiter.md`, done in this order. Nothing was restarted, rebuilt for desktop, or signed in. The board file `knowledge/work/*` was not touched.

| Ticket | Result |
| --- | --- |
| Task timing: unstarted Backlog tasks show in-flight time | Done and verified |
| Start a chat on this: read the ticket and wait for instructions | Done and verified (UI and voice tool) |
| Project Overview and Contextual Ticket Inspector | Done and verified |

## 1. Task timing

- **Reproduced first.** Against the untouched bundle, an unstarted task in an In progress feature showed `Created 04/11/2026 · in flight for 1 hour`.
- **Root cause.** Tasks had no work cycles. The task sheet's `Age` helper measured created to now for any open task, and older tasks borrow the parent's created date (`cleanTask`).
- **Fix.** Tasks now have `cycles`, with the same rules as tickets: entering In progress opens a cycle, leaving closes it, and a task that never started has none. The label reuses the ticket wording (`not started yet`, `in progress for`, `paused after`, `Done ... after ... of active work`). `Age` and `ageInfo` are gone.
- **Older data.** A task already In progress with no recorded cycles gets one legacy cycle from its created date, the same rule tickets use. Older open and Done tasks get none, so nothing is made up.
- **Tests.** `work-items.test.mjs` (new test: never started, straight to Done, running, paused, finished, older running, older open, agent edits, re-save changes nothing). `work-board-ui.mjs` checks the unstarted label, the saved cycle, the started label and an older task created 20 days ago.
- **Screenshots.** `.cache/overnight/work-board/ticket1-task-not-started.png`, `ticket1-task-in-progress.png`.

## 2. Start a chat on this

- **UI prompt.** `chatPrompt` is neutral for features, bugs and spikes: the board, project and file and item id context, the ticket text, then "read the ticket, reply with a short acknowledgement, then wait". It forbids starting work, investigating, researching, fixing and editing the ticket, tasks, checkboxes or files until asked, and says unchecked criteria and tasks are context.
- **State.** `StartChat` no longer moves a Backlog ticket to In progress (`onStarted` removed).
- **Voice tool.** `start_work_chat` with no `goal` is now the same neutral chat and changes nothing. `goal: shape` and `goal: build` have the same text and behaviour as before (build still moves Backlog to In progress). The tool description says when to use each.
- **Tests.** `assistant-tools.test.mjs`: neutral brief for a feature, bug and spike with both agents, board file byte for byte unchanged, shape leaves Backlog, build moves to In progress. `work-board-ui.mjs`: each type with both agents, prompt wording, no work verbs, and the saved ticket (state, cycles, tasks, dates) deep equal before and after, with the Backlog bug staying in Backlog.
- **Screenshot.** `.cache/overnight/work-board/ticket2-start-chat-keeps-backlog.png`.
- **Not exercised.** The request to `/api/sessions` is caught in the browser test, so no real agent started. Opening and focusing the chat reuses the unchanged `selectChat` and `jupiter-show-chats` calls.

## 3. Project Overview and Ticket Inspector

- **Layout.** The empty fourth grid track is now a panel right of exactly three columns. It collapses to a slim rail (remembered on this device), expands again, and opens by itself when a ticket is selected. On a board under 860px wide it sits under the columns.
- **Selecting.** Clicking a card title (or a task on a card) previews the ticket in the panel. The big editor opens only from **Open full editor**. Back to overview, or Escape inside the panel, clears the selection and returns focus to the card.
- **Overview.** Health (done of total, percent, bar, In progress, Backlog, Needs refinement; an empty project has its own message), Next up (Ready Backlog by priority then due date, each with a Start action), refinement queue, Due soon (unfinished tickets by deadline, overdue flagged). Ordering lives in `src/lib/work-overview.ts`.
- **Inspector.** Details and acceptance criteria as Markdown, tasks with working checkboxes, tags, refinement status (Backlog only, as on the card), time line, and quick actions that use the board's own workflow: Start work (Ready), Mark as refined (not Ready), Mark done, Back to Backlog, Reopen, Open full editor. Moving into In progress asks the usual resume question.
- **Also fixed.** Markdown checklists in the board (preview and panel) drew 26px boxes because of the app's input padding; the board's CSS now resets it.
- **Tests.** `work-overview.test.mjs` (5 unit tests) and the new `work-inspector-ui.mjs` (added to `desktop:test:ui`).

## Commands and results

| Command | Result |
| --- | --- |
| `npm run lint` | clean |
| `npx tsc -b` | clean |
| `node --test desktop/service/test/*.test.mjs` | 317 tests, 310 pass, 1 fail, 6 skipped. The failure is the known `reasoning is medium or above, research uses xhigh, and max needs an explicit request` test. |
| `node --test` work-items, work-overview, assistant-tools | 28 of 28 pass |
| `npm run build` (through the dist lock) | built |
| `node desktop/service/test/work-board-ui.mjs` | passed, no page exceptions or console errors |
| `node desktop/service/test/work-inspector-ui.mjs` | passed at 1500 by 950 and 1000 by 800, no console errors |
| `node desktop/service/test/dashboard-ui.mjs` | passed |
| `node scripts/check-template.mjs` | fails on the sample card categories in `workspace/workspace.json` (`dev, dev, image-gen`), not touched by this work |

The browser tests use their own service in a temp folder and Edge through Playwright. The only failed requests are 400s for fonts, the mobile bootstrap, the logo and the voice routes in that keyless test service; they appear on the dashboard alone, and `work-inspector-ui.mjs` asserts that nothing under `/api/work` fails.

Screenshots in `.cache/overnight/work-board/`: `work-panel-overview.png`, `work-panel-inspector.png`, `work-panel-collapsed.png`, `work-panel-empty.png`, `work-panel-narrow-overview.png`, `work-panel-narrow-inspector.png`, `work-panel-narrow-collapsed.png`.

## Needs a restart or rebuild

The live app bundles its own UI and service, so all three changes need a desktop rebuild and restart to show up (`npm run desktop:build -- --no-bundle`, then relaunch). The service changes (cleanTask cycles, `start_work_chat`) need the restart; neither was done.

## Assumptions and open questions

1. **Voice default.** `start_work_chat` with no goal used to start work and move the ticket to In progress. It is now neutral. If you want the old default for voice, change `build = args.goal === 'build'` back in `server.mjs`.
2. **Card click.** Clicking a card now previews instead of opening the editor, which changes habit and the old `Open <title>` button name (now `Preview <title>`). The ticket does not say how selection should happen; this is the conservative reading of "explicit Open full editor".
3. **Eligible work** is taken as Ready Backlog tickets. An unrefined ticket offers Mark as refined instead; dragging or the State menu can still start it.
4. **Older Done tasks** now show "Done on ... with no time in progress" because their real start is unknown, rather than the old created to completed span.
5. **Due soon** shows the five earliest unfinished deadlines with no time horizon, with a "more" count under each list.
6. **Narrow window.** At a 760px viewport the dashboard's own window runs below the viewport, so the narrow check uses 1000 by 800. That is dashboard layout, not the board.
