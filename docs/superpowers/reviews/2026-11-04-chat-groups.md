# Chat navigation: group buttons with dropdown pickers (4 November 2026)

The Chats header now shows one button per group (name, open chat count, chevron, activity marks) plus Ungrouped and, when the row is full, More groups. Each opens an anchored picker of that group's open chats. No chat tabs are drawn in the header and nothing wraps.

Not built or restarted: the desktop app bundles the UI, so these changes need `npm run desktop:build` and a restart to appear in the live app. The service was not changed.

## Commands run and results

| Command | Result |
| --- | --- |
| `npx tsc -b` | clean |
| `npm run lint` | clean |
| `npm test` | 311 pass, 1 fail, 6 skipped. The failure is the known `quick-actions.test.mjs` Windows encoding case. |
| `node --test desktop/service/test/chat-groups.test.mjs tab-groups.test.mjs tab-appearance.test.mjs` | 12 pass, including new tests for `chatBuckets` (one bucket per group, mixed pins, Ungrouped last, counts) and `fitButtons` (overflow maths) |
| `node desktop/service/test/chat-picker-ui.mjs` (new) | passed; the last six runs in a row passed after a test race with the terminal taking focus was fixed |
| `node desktop/service/test/groups-ui.mjs` (rewritten for pickers) | passed |
| `node desktop/service/test/history-ui.mjs` | passed (wait raised to 20 s for the resumed terminal) |
| `node desktop/service/test/conversation-ui.mjs`, `scroll-ui.mjs` | passed (they now choose chats through the pickers) |
| `ui.mjs`, `theme-ui.mjs`, `mobile-ui.mjs`, `jupiter-ui.mjs` | stop earlier than my edits, at points unrelated to chat tabs (`skills` file shortcut, `Chat appearance` button, `Retry` button, rail `aria-pressed`). Their chat tab lines were updated to the pickers but could not be exercised. |
| `npm run test:template` | fails on a card category list (`dev`, `image-gen`, `research`); not related to this work |

Builds and browser runs went through the dist lock. Browser tests start their own service in a temp folder with Edge; the live app was not touched.

## What `chat-picker-ui.mjs` checks

35 open chats in 8 named groups plus Ungrouped (9 buttons), fake terminals, Edge via Playwright.

- Header: groups only, each named group once (a group with pinned and unpinned chats is one button), Ungrouped last, closed chats not counted, no `role=tab`, no chat rows while closed.
- Opening: anchored under its button, pinned chats first, header height, conversation position and current chat unchanged, working and unread shown as words and shapes, long titles readable by tooltip and two line wrap.
- Selecting: the existing chat becomes current, picker closes, current group highlighted, toolbar shows the chat name and group, Ungrouped selection saves no group.
- One picker at a time, outside click, Escape (focus returns to the group button), Escape while the chat options menu is open closes one layer.
- Keyboard only: Enter or Space opens, ArrowDown on a button opens, arrows, Home, End, left and right inside a row, Enter and Space select, Tab leaves without a trap, arrows walk between group buttons, F2 renames.
- Menus from the row and group heading open with focus inside and Escape returns focus to their button.
- Alt+4, Ctrl+Tab and Find a chat still choose chats and the header follows.
- Long list (24 chats) scrolls inside the picker and stays inside the window.
- Panel widths 1150, 520, 420 and 330 (the Chats panel is docked and its width decides overflow): header row height never changes, the current group always stays in the row, More groups lists the rest with their chats, New chat, Find and History stay visible and uncovered, a chat chosen from More groups brings its group into the row, resizing the window closes an open picker.
- Session continuity: no launch, no kill, same process objects, same saved groups and open state after all of the above.
- Light and dark themes; no page errors or console errors (the desktop test service's known `/mobile/api/bootstrap` 400 is filtered).

## Screenshots

`D:\Projects\Jupiter\.cache\overnight\chat-groups\`

- `wide-dark-picker.png`, `wide-light-picker.png`: 1150 wide panel, picker open
- `wide-dark-focus.png`: keyboard focus ring on a group button
- `default-420-dark-picker.png`, `default-420-dark-more.png`, `default-light-more.png`: default panel width
- `520-dark-more.png`: More groups at 520
- `narrow-330-dark-picker.png`, `narrow-light-more.png`: narrowest panel

## Design notes

- Restrained: same tab menu surface, hairlines, accent colours and focus ring as the rest of the app. Group colours are kept; the active group has a stronger tint and the old underline.
- Activity on a group: a pulsing dot (working) and a ring (unread), plus counts in the accessible name and tooltip. Rows say Working, Unread, Needs attention or Stopped in words.
- Overflow is measured from a hidden copy of every button, so the row never wraps or jumps. The label reads More groups when there is room and More when the row is tight.
- Ordering stays available: drag a chat inside its picker, drag a group button, or use Move up and Move down (chats) and Move group earlier and later (groups) from the menus.
- UI/UX guidance used (ui-ux-pro-max): keyboard navigation with visible focus, no keyboard traps, drag alternatives, 24 px minimum targets, state shown by more than colour.

## Bugs found while testing, fixed

- The Escape listener re-subscribed on every render. When another Escape handler re-rendered the header mid dispatch (for example closing the chat options menu), that key press skipped the picker. It is now added once and reads the latest state.
- A click on Ungrouped or More groups after dragging a group button was ignored, because the drag's click suppression was only reset by named group buttons.

## Assumptions and open questions

1. Ungrouped sits after the named groups, not at the position of its first chat, and is labelled Ungrouped even when no group exists. It is a presentation bucket only.
2. Inline collapse is retired. The saved `collapsedGroups` setting is left untouched and ignored, and the Collapse and Expand menu items are gone.
3. A single click on a chat row selects it and closes the picker, so double click rename is gone. F2 and Rename chat in the menu remain.
4. The service keeps pinned and unpinned runs of a group apart. A mixed group is one button placed by its pinned run; moving it moves that run, and a group cannot be moved across a pin boundary (same rule as before).
5. Touch drag in the picker is off so the list can scroll; Move up and Move down cover that.
6. The Chats panel is 420 wide by default (330 minimum), so More groups is common. At 330 the current group name is shortened with an ellipsis; the tooltip and the toolbar show the full name.
7. Copy still says "tab" in Close tab, Tab color and Pin in History. Rename to "chat" if you prefer.
8. `JUPITER.md` was not edited.
