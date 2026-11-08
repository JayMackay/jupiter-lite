// The Chats header shows group buttons only; each opens an anchored picker of that group's open chats.
// Exercises open, select, keyboard, Escape, outside click, One picker at a time, Ungrouped, More groups overflow,
// long titles, long lists, themes, widths and session continuity. Terminals are fakes; no user chats or logins are used.
import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createService } from '../server.mjs';
import { chooseChat, launchBrowser, desktopAuth, openChatIds } from './browser.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const shots = process.env.JUPITER_PICKER_SHOTS || path.join(root, '.cache/overnight/chat-groups');
await mkdir(path.join(root, '.cache'), { recursive: true });
await mkdir(shots, { recursive: true });
const repo = await mkdtemp(path.join(root, '.cache/chat-picker-ui-'));
const priorHome = process.env.CODEX_HOME;
process.env.CODEX_HOME = path.join(repo, 'codex');
const longGroup = 'Studio pipeline review board with an extremely long group name';
const longChat = 'Navigation: dismiss ribbon and conflicting surfaces when a card link opens a second window';
// [id, name, group, open, pinned, unread]
const specs = [
  ['pj-0', 'Planning', 'Project Jupiter', true, true, false],
  ['pj-1', longChat, 'Project Jupiter', true, false, true],
  ['pj-2', 'General', 'Project Jupiter', true, false, false],
  ['as-0', 'Workspace Setup', 'Ashengard', true, false, false],
  ['as-1', 'Old Ashengard chat', 'Ashengard', false, false, false],
  ['sp-0', 'Pipeline', longGroup, true, false, false],
  ['re-0', 'Reading', 'Research', true, false, false],
  ['de-0', 'Layouts', 'Design', true, false, false],
  ['op-0', 'Deploys', 'Ops', true, false, false],
  ['ga-0', 'Combat', 'Game', true, false, false],
  ...Array.from({ length: 24 }, (_, index) => [`bk-${index}`, `Bulk chat ${String(index + 1).padStart(2, '0')}`, 'Bulk', true, false, false]),
  ['un-0', 'Scratch', null, true, false, false],
  ['un-1', 'Quick question about something with a rather long title that wraps', null, true, false, false],
];
const chats = specs.map(([id, name, group, open, pinned, unread], tabOrder) => ({
  id, name, group, tabOrder, open, pinned, unread, agent: tabOrder % 2 ? 'claude' : 'codex', cwd: repo, nativeId: null, hasConversation: false, status: 'stopped', createdAt: '2026-10-14T08:00:00Z', updatedAt: `2026-10-14T08:${String(tabOrder).padStart(2, '0')}:00Z`, cols: 80, rows: 24,
}));
await mkdir(path.join(repo, 'workspace'));
await writeFile(path.join(repo, 'workspace/workspace.json'), '{"entities":[]}');
await mkdir(path.join(repo, '.jupiter'));
await writeFile(path.join(repo, '.jupiter/sessions.json'), JSON.stringify(chats));
let service, browser;
const launches = [], kills = [];
try {
  service = await createService({ repo, uiDir: path.join(root, 'dist'), mcpOptions: { home: repo, env: {} } });
  service.sessions.launch = session => {
    launches.push(session.id);
    session.status = 'running'; session.restoreError = null;
    let onExit;
    session.process = { resize() {}, write() {}, onExit(callback) { onExit = callback; return { dispose() {} }; }, kill() { kills.push(session.id); session.process = null; session.status = 'stopped'; onExit?.(); } };
    service.sessions.changed(session);
  };
  await service.sessions.restore();
  browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1900, height: 900 } });
  await desktopAuth(page.context(), service.urls.workspace);
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && !/mobile\/api\/bootstrap|status of 400/.test(message.text())) errors.push(message.text()); });
  const chip = group => page.locator(`.chat-group-chip[data-chat-group="${group}"]`);
  const ungrouped = page.locator('button.chat-group-chip:not([data-chat-group]):not(.chat-more)');
  const more = page.locator('button.chat-more');
  const picker = page.locator('.chat-picker');
  const rows = () => picker.locator('.chat-picker-row .chat-picker-name').allTextContents();
  const current = () => page.locator('.chat-current b').textContent();
  const box = async selector => page.locator(selector).first().boundingBox();
  const layout = async () => ({ row: await box('.chat-tabs-row'), context: await box('.chat-context'), terminalTop: (await box('.terminal-area')).y });
  const rowItem = name => picker.locator('.chat-picker-item').filter({ hasText: name }).first();
  const visibleChips = () => page.locator('.chat-groups > button.chat-group-chip:not(.chat-more)').evaluateAll(chips => chips.map(item => item.querySelector('.chip-name').textContent));
  const inside = async locator => { const rect = await locator.boundingBox(); const view = page.viewportSize(); return rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= view.width + 0.5 && rect.y + rect.height <= view.height + 0.5; };
  const sessionsNow = () => Object.fromEntries(chats.map(chat => [chat.id, service.sessions.get(chat.id).process]));
  // The Chats panel is docked and resizable (330 up to the window less 674); its width, not the window's, decides what fits.
  const setPanelWidth = async width => {
    const handle = await box('.jupiter-splitter'), view = page.viewportSize();
    await page.mouse.move(handle.x + handle.width / 2, handle.y + 200);
    await page.mouse.down();
    await page.mouse.move(view.width - width, handle.y + 200, { steps: 8 });
    await page.mouse.up();
    await expect.poll(async () => Math.round((await box('.jupiter-chats-panel')).width)).toBe(width);
  };
  // A newly chosen chat's terminal takes focus when it appears; wait for that before the next keyboard step.
  const terminalFocused = () => expect.poll(() => page.evaluate(() => !!document.activeElement?.closest('.terminal-area'))).toBe(true);
  const shot = async name => { await page.waitForTimeout(350); return page.locator('.jupiter-chats-panel').screenshot({ path: path.join(shots, `${name}.png`) }); };
  const setTheme = async theme => { await fetch(service.origin + '/api/settings', { method: 'POST', headers: { Authorization: `Bearer ${service.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ chatTheme: theme }) }); await expect(page.locator('html')).toHaveAttribute('data-workspace-theme', theme); };

  await page.goto(service.urls.chats);
  await chip('Project Jupiter').waitFor();
  await page.locator('.terminal-host .xterm').waitFor();
  await setPanelWidth(1150);
  const baseline = launches.length;
  const processes = sessionsNow();
  
  // The header shows groups only: each named group once, mixed pins in one button, Ungrouped last, no chat tabs.
  assert.deepEqual(await visibleChips(), ['Project Jupiter', 'Ashengard', longGroup, 'Research', 'Design', 'Ops', 'Game', 'Bulk', 'Ungrouped']);
  assert.equal(await page.locator('.chat-tabs [role=tab], .chat-tabs .chat-tab').count(), 0, 'no chat tabs in the header');
  assert.equal(await page.locator('.chat-tabs .chat-picker-row').count(), 0, 'no chat rows while every picker is closed');
  assert.equal(await chip('Project Jupiter').count(), 1);
  assert.equal(await chip('Project Jupiter').locator('small').textContent(), '3', 'the count covers pinned and unpinned open chats');
  assert.equal(await chip('Ashengard').locator('small').textContent(), '1', 'a closed chat is not counted; it stays in History');
  assert.equal(await ungrouped.locator('small').textContent(), '2');
  assert.equal(await chip('Project Jupiter').locator('.chip-unread').count(), 1, 'an unread result shows on the group');
  assert.equal(await current(), 'Planning', 'the first chat is current; the toolbar names it');
  assert.equal(await chip('Project Jupiter').getAttribute('aria-current'), 'true');
  assert.equal(await page.locator('.chat-group-chip.active').count(), 1);
  const wide = await layout();

  // The shared test helpers read and choose chats through the pickers.
  assert.deepEqual((await openChatIds(page)).sort(), chats.filter(chat => chat.open).map(chat => chat.id).sort(), 'every open chat is in exactly one picker');
  assert.equal(await picker.count(), 0);
  await chooseChat(page, 'as-0');
  await expect(page.locator('.chat-current b')).toHaveText('Workspace Setup');
  await chooseChat(page, 'pj-0');
  await expect(page.locator('.chat-current b')).toHaveText('Planning');

  // Working shows on its group without relying on colour: an animated dot, plus words in the label and tooltip.
  service.sessions.get('pj-2').activity = 'working'; service.sessions.changed(service.sessions.get('pj-2'));
  await expect(chip('Project Jupiter').locator('.chip-working')).toHaveCount(1);
  assert.match(await chip('Project Jupiter').getAttribute('aria-label'), /1 working · 1 unread/);
  assert.match(await chip('Project Jupiter').getAttribute('title'), /1 working/);

  // Opening a picker lists that group's open chats, pinned first, and changes neither the chat nor the layout.
  await chip('Project Jupiter').click();
  await picker.waitFor();
  assert.deepEqual(await rows(), ['Planning', longChat, 'General']);
  assert.equal(await chip('Project Jupiter').getAttribute('aria-expanded'), 'true');
  assert.equal(await current(), 'Planning');
  assert.deepEqual(await layout(), wide, 'opening the picker does not resize the header or move the conversation');
  assert.equal(await picker.locator('.chat-picker-row.selected').count(), 1);
  assert.equal(await picker.locator('.chat-picker-item[aria-current=true]').textContent().then(text => text.includes('Planning')), true, 'the current chat is marked');
  assert.equal(await picker.locator('.tab-pinned').count(), 1, 'the pin is per chat');
  assert.match(await rowItem('Navigation').getAttribute('title'), new RegExp(longChat.slice(0, 40)), 'a long title can be read in full');
  assert.match(await picker.locator('.chat-picker-row').nth(2).textContent(), /Working/, 'working shows as words in the list');
  assert.match(await picker.locator('.chat-picker-row').nth(1).textContent(), /Unread/);
  assert.equal(await inside(picker), true);
  assert.equal(await page.locator('.chat-picker').count(), 1);
  await shot('wide-dark-picker');

  // Selecting activates the existing chat, closes the picker and names the chat and group.
  await rowItem('General').click();
  await picker.waitFor({ state: 'detached' });
  assert.equal(await current(), 'General');
  await expect(chip('Project Jupiter')).toHaveAttribute('aria-current', 'true');
  assert.equal(await page.locator('.chat-group-chip.active').count(), 1);
  assert.match(await page.locator('.chat-current').getAttribute('title'), /General · Project Jupiter/);
  assert.deepEqual(await layout(), wide);

  // Another group: the previous one is no longer current; Ungrouped is a picker of its own.
  await ungrouped.click();
  assert.deepEqual(await rows(), ['Scratch', 'Quick question about something with a rather long title that wraps']);
  assert.equal(await picker.locator('.chat-picker-group-options').count(), 0, 'Ungrouped is a view, not a group to manage');
  await rowItem('Scratch').click();
  assert.equal(await current(), 'Scratch');
  await expect(ungrouped).toHaveAttribute('aria-current', 'true');
  assert.equal(service.sessions.get('un-0').group, null, 'choosing from Ungrouped saves no group');

  // Only one picker at a time: opening another closes the first. Clicking the open group again closes it.
  await chip('Research').click();
  await chip('Design').click();
  assert.equal(await picker.count(), 1);
  assert.deepEqual(await rows(), ['Layouts']);
  assert.equal(await chip('Research').getAttribute('aria-expanded'), 'false');
  await chip('Design').click();
  await picker.waitFor({ state: 'detached' });

  // Outside click closes without changing the chat; so does Escape, which hands focus back to the group button.
  await chip('Research').click();
  await picker.waitFor();
  await page.locator('.chat-context').click({ position: { x: 40, y: 5 } });
  await picker.waitFor({ state: 'detached' });
  assert.equal(await current(), 'Scratch');
  await chip('Research').click();
  await picker.waitFor();
  await page.keyboard.press('Escape');
  await picker.waitFor({ state: 'detached' });
  await expect(chip('Research')).toBeFocused();
  assert.equal(await current(), 'Scratch');

  // Keyboard only: Enter opens and focuses the current (or first) chat; arrows, Home and End move; Enter selects; Escape closes.
  await chip('Project Jupiter').focus();
  await page.keyboard.press('Enter');
  await picker.waitFor();
  await expect(rowItem('Planning')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(rowItem('Navigation')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(rowItem('General')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(rowItem('Planning')).toBeFocused();
  await page.keyboard.press('End');
  await expect(rowItem('General')).toBeFocused();
  await page.keyboard.press('Home');
  await expect(rowItem('Planning')).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(picker.locator('.chat-picker-more').first()).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(rowItem('Planning')).toBeFocused();
  assert.equal(await current(), 'Scratch', 'moving through the list does not switch chats');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await picker.waitFor({ state: 'detached' });
  assert.equal(await current(), longChat);
  assert.notEqual(await page.evaluate(() => document.activeElement?.tagName), 'BODY', 'focus is not lost after choosing');
  await terminalFocused();
  // Space also selects, ArrowDown on a group button opens its picker, and arrows walk between group buttons.
  await chip('Ashengard').focus();
  await page.keyboard.press('ArrowDown');
  await picker.waitFor();
  await expect(rowItem('Workspace Setup')).toBeFocused();
  await page.keyboard.press('Space');
  await picker.waitFor({ state: 'detached' });
  assert.equal(await current(), 'Workspace Setup');
  await terminalFocused();
  await chip('Research').focus();
  await page.keyboard.press('ArrowRight');
  await expect(chip('Design')).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(chip('Research')).toBeFocused();
  // No focus trap: Tab leaves the picker and closes it.
  await page.keyboard.press('Enter');
  await picker.waitFor();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await picker.waitFor({ state: 'detached' });
  assert.equal(await page.evaluate(() => !!document.activeElement?.closest('.chat-picker')), false);

  // Management stays reachable: the row's options button opens the chat menu; the group heading opens the group menu; both close with Escape back to their button.
  await chip('Project Jupiter').click();
  await picker.locator('.chat-picker-more').first().click();
  await page.locator('.tab-menu').waitFor();
  let items = await page.locator('.tab-menu [role=menuitem]').allTextContents();
  assert.deepEqual([items[0], items[1], items.at(-1)], ['Rename chat', 'Unpin from History', 'Close tab · keep in History'], 'rename, pin, close to History and the colour and group controls stay in the menu');
  assert.equal(items.includes('Move up in the list') || items.includes('Move down in the list'), false, 'the only pinned chat has nothing to move past');
  await expect(page.locator('.tab-menu [role=menuitem]').first()).toBeFocused();
  assert.equal(await picker.count(), 1, 'the picker stays open behind its menu');
  await page.keyboard.press('Escape');
  await page.locator('.tab-menu').waitFor({ state: 'detached' });
  await expect(picker.locator('.chat-picker-more').first()).toBeFocused();
  await picker.locator('.chat-picker-more').nth(1).click();
  items = await page.locator('.tab-menu [role=menuitem]').allTextContents();
  assert.equal(items.includes('Move down in the list') && !items.includes('Move up in the list'), true, 'ordering is offered within the same pin state');
  await page.keyboard.press('Escape');
  assert.equal(await picker.count(), 1, 'the first Escape closes only the menu');
  await picker.locator('.chat-picker-group-options').click();
  await page.locator('.tab-menu').getByRole('menuitem', { name: 'Rename group' }).waitFor();
  assert.match(await page.locator('.tab-menu').textContent(), /Ungroup 3 chats/);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await picker.waitFor({ state: 'detached' });
  await expect(chip('Project Jupiter')).toBeFocused();

  // The switcher shortcuts and Find a chat still choose chats, and the header follows the choice.
  await chip('Project Jupiter').focus();
  await page.keyboard.press('Alt+Digit4');
  await expect(page.locator('.chat-current b')).toHaveText('Workspace Setup');
  await expect(chip('Ashengard')).toHaveAttribute('aria-current', 'true');
  await page.keyboard.press('Control+Tab');
  await expect(page.locator('.chat-current b')).toHaveText('Pipeline');
  await expect(chip(longGroup)).toHaveAttribute('aria-current', 'true');
  assert.equal(await page.locator('.chat-group-chip.active').count(), 1);
  await page.getByRole('button', { name: 'Find a chat', exact: true }).click();
  await page.getByPlaceholder('Find any chat…').fill('Deploys');
  await page.locator('.switcher-list button', { hasText: 'Deploys' }).click();
  await expect(page.locator('.chat-current b')).toHaveText('Deploys');
  await expect(chip('Ops')).toHaveAttribute('aria-current', 'true');
  assert.equal(await page.locator('.chat-switcher').count(), 0);

  // Escape closes the picker even while the chat options menu is open, on the first press, and one layer at a time.
  await page.getByRole('button', { name: 'Chat options' }).click();
  await page.locator('.chat-options').waitFor();
  await chip('Research').click();
  await picker.waitFor();
  await page.keyboard.press('Escape');
  await picker.waitFor({ state: 'detached' });
  assert.equal(await page.locator('.chat-options').count(), 1, 'one Escape closes one layer');
  await page.keyboard.press('Escape');
  await page.locator('.chat-options').waitFor({ state: 'detached' });

  // A long list scrolls inside the viewport and does not move the header.
  await chip('Bulk').click();
  assert.equal((await rows()).length, 24);
  assert.equal(await inside(picker), true);
  assert.equal(await picker.evaluate(node => node.scrollHeight > node.clientHeight), true, 'a long list scrolls within the picker');
  assert.deepEqual(await layout(), wide);
  await picker.locator('.chat-picker-item').last().focus();
  assert.equal(await inside(picker.locator('.chat-picker-item').last()), true, 'focusing the last chat scrolls it into view');
  await page.keyboard.press('Escape');

  // Opening and choosing never touched an agent session: nothing launched, killed or replaced.
  assert.equal(launches.length, baseline, 'no session was launched again');
  assert.deepEqual(kills, [], 'no session was closed');
  const now = sessionsNow();
  assert.equal(Object.keys(processes).every(id => now[id] === processes[id]), true, 'every session keeps its own process');
  assert.equal(chats.filter(chat => chat.open).every(chat => service.sessions.get(chat.id).status === 'running'), true);
  assert.equal(chats.every(chat => service.sessions.get(chat.id).open === chat.open && service.sessions.get(chat.id).group === chat.group), true, 'saved groups and open state are unchanged');

  // A narrower panel: the row stays one line, the active group stays visible and the rest move into More groups.
  await setPanelWidth(520);
  await more.waitFor();
  const narrow = await layout();
  assert.equal(narrow.row.height, wide.row.height, 'the header row keeps its height when groups overflow');
  const hiddenNames = async () => { await more.click(); const names = await picker.locator('.chat-picker-title').allTextContents(); await page.keyboard.press('Escape'); return names; };
  const shown = await visibleChips();
  const hidden = await hiddenNames();
  assert.equal(shown.includes('Ops'), true, 'the current group stays in the row');
  assert.equal(shown.length + hidden.length, 9, 'every group is either in the row or in More groups');
  assert.equal(new Set([...shown, ...hidden]).size, 9, 'no group is listed twice');
  const actions = await box('.chat-tab-actions'), last = await page.locator('.chat-groups > button.chat-group-chip').last().boundingBox();
  assert.equal(last.x + last.width <= actions.x + 0.5, true, 'group buttons never cover New chat, Find and History');
  for (const name of ['New chat', 'Find a chat']) assert.equal(await page.getByRole('button', { name, exact: true }).isVisible(), true);
  assert.equal(await page.locator('.history-button').isVisible(), true);
  await more.click();
  assert.equal(await inside(picker), true);
  assert.equal(await more.getAttribute('aria-expanded'), 'true');
  assert.match(await more.getAttribute('aria-label'), /^More groups · \d+ more groups?/);
  assert.equal(await picker.locator('.chat-picker-section').count(), hidden.length);
  await shot('520-dark-more');
  // A chat chosen from More groups becomes current, and its group takes a place in the row.
  const hiddenChat = await picker.locator('.chat-picker-section').last().locator('.chat-picker-name').first().textContent();
  const hiddenGroup = hidden.at(-1);
  await picker.locator('.chat-picker-item').filter({ hasText: hiddenChat }).first().click();
  await picker.waitFor({ state: 'detached' });
  assert.equal(await current(), hiddenChat);
  assert.equal((await visibleChips()).includes(hiddenGroup), true, 'the chosen chat\'s group is now visible and current');
  assert.equal(await page.locator('.chat-group-chip.active').count(), 1);
  assert.equal((await layout()).row.height, wide.row.height);

  // The default panel width.
  await setPanelWidth(420);
  await more.click();
  assert.equal(await inside(picker), true);
  await shot('default-420-dark-more');
  await page.keyboard.press('Escape');
  await page.locator('button.chat-group-chip:not(.chat-more)').first().click();
  await shot('default-420-dark-picker');
  await page.keyboard.press('Escape');

  // The narrowest panel, in a short window: still one row, a bounded picker, the actions reachable.
  await page.setViewportSize({ width: 1000, height: 600 });
  await expect.poll(async () => Math.round((await box('.jupiter-chats-panel')).width)).toBe(330);
  await more.waitFor();
  assert.equal((await box('.chat-tabs-row')).height, wide.row.height);
  await page.locator('button.chat-group-chip:not(.chat-more)', { hasText: hiddenGroup }).click();
  assert.equal(await inside(picker), true, 'the picker stays inside a narrow window');
  await shot('narrow-330-dark-picker');
  await page.keyboard.press('Escape');
  await more.click();
  assert.equal(await inside(picker), true);
  assert.equal(await picker.evaluate(node => node.getBoundingClientRect().bottom <= window.innerHeight), true);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.history-button').isVisible(), true);

  // Resizing the window while a picker is open closes it; a wide panel puts every button back in the row.
  await more.click();
  await page.setViewportSize({ width: 1900, height: 900 });
  await picker.waitFor({ state: 'detached' });
  await setPanelWidth(1150);
  await more.waitFor({ state: 'detached' });
  assert.equal((await visibleChips()).length, 9);

  // Chats opened later stay reachable, in a new group too, and the open count follows.
  const created = await (await fetch(service.origin + '/api/sessions', { method: 'POST', headers: { Authorization: `Bearer ${service.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ agent: 'codex', name: 'Fresh chat', cwd: repo, group: 'Brand new' }) })).json();
  assert.equal(created.group, 'Brand new');
  await chip('Brand new').waitFor();
  assert.equal(await chip('Brand new').locator('small').textContent(), '1');
  await chip('Brand new').click();
  assert.deepEqual(await rows(), ['Fresh chat']);
  await page.keyboard.press('Escape');

  // Light theme, wide and narrow.
  await setTheme('light');
  await chip('Project Jupiter').click();
  await shot('wide-light-picker');
  await page.keyboard.press('Escape');
  await setPanelWidth(420);
  await more.click();
  await shot('default-light-more');
  await page.keyboard.press('Escape');
  await setPanelWidth(330);
  await more.click();
  await shot('narrow-light-more');
  await page.keyboard.press('Escape');
  await setPanelWidth(1150);
  await setTheme('dark');

  // Hover and focus states are visible, and nothing logged an error.
  await chip('Ops').focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  assert.equal(await chip('Ops').evaluate(node => getComputedStyle(node).outlineStyle !== 'none'), true, 'keyboard focus shows a ring');
  await shot('wide-dark-focus');
  assert.equal(await page.locator('.desktop-error').count(), 0);
  assert.deepEqual(errors, []);
  console.log(`Chat picker UI passed: groups only in the header, anchored picker without layout change, select, Escape, outside click, one picker at a time, keyboard, Ungrouped, More groups overflow at 520 and 330 wide, long lists and titles, menus, light and dark, session continuity. Screenshots: ${shots}`);
} finally {
  await browser?.close(); await service?.close();
  if (priorHome === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = priorHome;
}
