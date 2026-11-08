// Exercise chat groups in the real Chats window: one header button per group, each opening a picker of its chats,
// saved collapse state ignored, the chat right-click menu, the group menu, dropping a chat on a group button, ordering
// by drag and by menu, the New chat group picker, group rename, group drag, delete, and History. Terminals are fakes;
// no user chats or logins are used.
import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createService } from '../server.mjs';
import { launchBrowser, desktopAuth } from './browser.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
await mkdir(path.join(root, '.cache'), { recursive: true });
const repo = await mkdtemp(path.join(root, '.cache/groups-ui-'));
// g-4 is a closed chat: it keeps its group in History and has no tab.
const chats = [['g-0', 'Director', 'ThugLife', true], ['g-1', 'Network', 'ThugLife', true], ['g-2', 'Animator', null, true], ['g-3', 'Combat', 'Dungeon', true], ['g-4', 'Scout', 'Dungeon', false]].map(([id, name, group, open], tabOrder) => ({
  id, name, group, tabOrder, agent: 'codex', cwd: repo, nativeId: null, hasConversation: false, open, pinned: false, status: 'stopped', createdAt: '2026-10-14T08:00:00Z', updatedAt: `2026-10-14T08:0${tabOrder}:00Z`, cols: 80, rows: 24,
}));
await mkdir(path.join(repo, 'workspace'));
await writeFile(path.join(repo, 'workspace/workspace.json'), '{"entities":[]}');
await mkdir(path.join(repo, '.jupiter'));
await writeFile(path.join(repo, '.jupiter/sessions.json'), JSON.stringify(chats));
let service, browser;
try {
  service = await createService({ repo, uiDir: path.join(root, 'dist'), mcpOptions: { home: repo, env: {} } });
  service.sessions.launch = session => {
    session.status = 'running'; session.restoreError = null;
    let onExit;
    session.process = { resize() {}, write() {}, onExit(callback) { onExit = callback; return { dispose() {} }; }, kill() { session.process = null; session.status = 'stopped'; onExit?.(); } };
    service.sessions.changed(session);
  };
  browser = await launchBrowser();
  // The docked Chats panel is as wide as the window leaves it, up to 700 here; a narrow one moves groups into More groups.
  const page = await browser.newPage({ viewport: { width: 1500, height: 800 } });
  await page.addInitScript(() => localStorage.setItem('jupiter.chatWidth', '700'));
  await desktopAuth(page.context(), service.urls.workspace);
  page.setDefaultTimeout(8000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const post = (route, data) => fetch(service.origin + '/api' + route, { method: 'POST', headers: { Authorization: `Bearer ${service.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then(response => response.json());
  const chip = group => page.locator(`button.chat-group-chip[data-chat-group="${group}"]`);
  const ungrouped = page.locator('button.chat-group-chip:not([data-chat-group]):not(.chat-more)');
  const picker = page.locator('.chat-picker');
  const chips = () => page.locator('.chat-groups > button.chat-group-chip .chip-name').allTextContents();
  const counts = () => page.locator('.chat-groups > button.chat-group-chip small').allTextContents();
  const names = () => picker.locator('.chat-picker-row .chat-picker-name').allTextContents();
  const show = async trigger => { if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click(); await picker.waitFor(); };
  const row = name => picker.locator('.chat-picker-row').filter({ hasText: name }).first();
  const item = name => row(name).locator('.chat-picker-item');
  const menuItem = text => page.locator('.tab-menu [role=menuitem]', { hasText: text });
  const accent = group => chip(group).evaluate(node => node.style.getPropertyValue('--tab-accent'));

  await page.goto(service.urls.chats);
  await chip('Dungeon').waitFor();
  assert.deepEqual(await chips(), ['ThugLife', 'Dungeon', 'Ungrouped'], 'one button per group, Ungrouped last, no chat tabs');
  assert.deepEqual(await counts(), ['2', '1', '1'], 'counts are open chats; the closed Scout stays in History');
  assert.equal(await page.locator('.chat-tab, [role=tab]').count(), 0);
  await show(chip('ThugLife'));
  assert.deepEqual(await names(), ['Director', 'Network']);
  await show(chip('Dungeon'));
  assert.deepEqual(await names(), ['Combat']);
  await show(ungrouped);
  assert.deepEqual(await names(), ['Animator']);
  await page.keyboard.press('Escape');

  // Collapse no longer applies: a saved collapsed group is kept as it was saved, and still lists its chats.
  await post('/settings', { collapsedGroups: ['ThugLife'] });
  await page.reload();
  await chip('ThugLife').waitFor();
  assert.deepEqual(await chips(), ['ThugLife', 'Dungeon', 'Ungrouped']);
  await show(chip('ThugLife'));
  assert.deepEqual(await names(), ['Director', 'Network']);
  await page.keyboard.press('Escape');
  assert.deepEqual((await (await fetch(service.origin + '/api/bootstrap', { headers: { Authorization: `Bearer ${service.token}` } })).json()).settings.collapsedGroups, ['ThugLife'], 'saved collapse state is untouched');
  await post('/settings', { collapsedGroups: [] });

  // Right-click: move an ungrouped chat into an existing group, then into a new one, then ungroup from the group button.
  await show(ungrouped);
  await item('Animator').click({ button: 'right' });
  await page.locator('.tab-menu').waitFor();
  assert.deepEqual(await page.locator('.tab-menu [role=menuitem]').allTextContents(), ['Rename chat', 'Pin in History', 'Dungeon', 'ThugLife', 'Show working folder', 'Clear terminal scrollback', 'Close tab · keep in History'], 'the chat menu keeps the chat settings and offers groups most recently active first');
  await page.locator('.tab-menu [aria-label="Rose tab color"]').click();
  await picker.locator('.chat-picker-row.has-color').filter({ hasText: 'Animator' }).waitFor();
  assert.equal(service.sessions.get('g-2').tabColor, '#dba3bb');
  await item('Animator').click({ button: 'right' });
  await menuItem('Pin in History').click();
  await row('Animator').locator('.tab-pinned').waitFor();
  assert.equal(service.sessions.get('g-2').pinned, true, 'pinning from the menu keeps the chat pinned in its group');
  await item('Animator').click({ button: 'right' });
  await menuItem('Unpin from History').click();
  await row('Animator').locator('.tab-pinned').waitFor({ state: 'detached' });
  assert.equal(service.sessions.get('g-2').pinned, false);
  await item('Animator').click({ button: 'right' });
  await menuItem('Rename chat').click();
  await page.locator('.tab-menu-rename input').fill('Animator Lead');
  await page.locator('.tab-menu-rename input').press('Enter');
  await row('Animator Lead').waitFor();
  await item('Animator Lead').click({ button: 'right' });
  await menuItem('Rename chat').click();
  await page.locator('.tab-menu-rename input').fill('Animator');
  await page.locator('.tab-menu-rename input').press('Enter');
  await row('Animator').waitFor();
  await item('Animator').press('F2');
  await page.getByRole('textbox', { name: 'English chat name' }).fill('Animation Review');
  await page.getByRole('textbox', { name: 'English chat name' }).press('Enter');
  await item('Animation Review').press('F2');
  await page.getByRole('textbox', { name: 'English chat name' }).fill('Animator');
  await page.getByRole('textbox', { name: 'English chat name' }).press('Enter');
  await row('Animator').waitFor();
  await item('Animator').click({ button: 'right' });
  await menuItem('Dungeon').click();
  await picker.waitFor({ state: 'detached' });
  assert.deepEqual(await chips(), ['ThugLife', 'Dungeon'], 'Ungrouped is gone once every chat has a group');
  assert.deepEqual(await counts(), ['2', '2']);
  assert.equal(service.sessions.get('g-2').group, 'Dungeon');
  await show(chip('Dungeon'));
  assert.deepEqual(await names(), ['Combat', 'Animator'], 'joining places the chat after the last member');
  await item('Animator').click({ button: 'right' });
  await page.locator('.tab-menu input').fill('Research');
  await page.locator('.tab-menu input').press('Enter');
  await chip('Research').waitFor();
  assert.deepEqual(await names(), ['Combat'], 'the open picker follows its group');
  assert.deepEqual(await chips(), ['ThugLife', 'Dungeon', 'Research']);
  await page.keyboard.press('Escape');
  await chip('Research').click({ button: 'right' });
  await page.locator('.tab-menu [aria-label="Sky group color"]').click();
  await expect.poll(() => accent('Research')).toBe('#91b6da');
  assert.deepEqual((await (await fetch(service.origin + '/api/bootstrap', { headers: { Authorization: `Bearer ${service.token}` } })).json()).settings.groupColors, { Research: '#91b6da' });
  await chip('Research').click({ button: 'right' });
  assert.equal(await page.locator('.tab-menu [aria-label="Sky group color"]').getAttribute('aria-pressed'), 'true');
  await page.locator('.tab-menu [aria-label="No group color"]').click();
  await expect.poll(() => accent('Research')).not.toBe('#91b6da');
  await chip('Research').click({ button: 'right' });
  await menuItem('Ungroup 1 chat').click();
  await chip('Research').waitFor({ state: 'detached' });
  assert.equal(service.sessions.get('g-2').group, null);
  assert.deepEqual(await chips(), ['ThugLife', 'Dungeon', 'Ungrouped']);

  // Drag a chat from its picker onto a group button.
  await show(ungrouped);
  const from = await item('Animator').boundingBox();
  const to = await chip('ThugLife').boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  for (let step = 1; step <= 12; step++) await page.mouse.move(from.x + (to.x + to.width / 2 - from.x) * step / 12, from.y + (to.y + to.height / 2 - from.y) * step / 12);
  await page.locator('button.chat-group-chip.drop-into').waitFor();
  await page.mouse.up();
  await expect.poll(async () => (await counts())[0]).toBe('3');
  await show(chip('ThugLife'));
  assert.deepEqual(await names(), ['Director', 'Network', 'Animator']);

  // Order inside a group: drag within the picker, or use Move up and Move down from the menu.
  const drag = await item('Animator').boundingBox(), above = await item('Director').boundingBox();
  await page.mouse.move(drag.x + drag.width / 2, drag.y + drag.height / 2);
  await page.mouse.down();
  for (let step = 1; step <= 12; step++) await page.mouse.move(drag.x + drag.width / 2, drag.y + (above.y + 4 - drag.y) * step / 12);
  await picker.locator('.chat-picker-row.drop-before').waitFor();
  await page.mouse.up();
  await expect.poll(names).toEqual(['Animator', 'Director', 'Network']);
  assert.equal(await picker.count(), 1, 'a drag does not close or reopen the picker');
  await row('Animator').locator('.chat-picker-more').click();
  assert.equal(await menuItem('Move up in the list').count(), 0, 'the first chat cannot move up');
  await menuItem('Move down in the list').click();
  await expect.poll(names).toEqual(['Director', 'Animator', 'Network']);
  await row('Network').locator('.chat-picker-more').click();
  await menuItem('Move up in the list').click();
  await expect.poll(names).toEqual(['Director', 'Network', 'Animator']);
  assert.deepEqual(service.sessions.active().filter(entry => entry.group === 'ThugLife').map(entry => entry.name), ['Director', 'Network', 'Animator'], 'the saved order matches the picker');
  await page.keyboard.press('Escape');

  // New chat offers the known groups and files the new chat under the chosen one.
  await page.getByRole('button', { name: 'New chat', exact: true }).click();
  const choices = page.locator('.desk-dialog select[aria-label="Group"]');
  assert.deepEqual(await choices.locator('option').allTextContents(), ['No group', 'Dungeon', 'ThugLife', 'New group…']);
  await page.locator('.desk-dialog input[placeholder*="Dream Game"]').fill('Producer');
  await choices.selectOption('ThugLife');
  await page.getByRole('button', { name: 'Open chat', exact: true }).click();
  await expect.poll(async () => (await counts())[0]).toBe('4');
  const created = service.sessions.list().find(entry => entry.name === 'Producer');
  assert.equal(created.group, 'ThugLife');
  await expect(page.locator('.chat-current b')).toHaveText('Producer');
  await expect(chip('ThugLife')).toHaveAttribute('aria-current', 'true');
  await show(chip('ThugLife'));
  assert.deepEqual(await names(), ['Director', 'Network', 'Animator', 'Producer']);
  await page.keyboard.press('Escape');

  // The chat options menu carries the same picker and can clear the group.
  await page.getByRole('button', { name: 'Chat options' }).click();
  await page.locator('.chat-options select[aria-label="Group"]').selectOption('');
  await expect.poll(async () => (await counts())[0]).toBe('3');
  assert.equal(service.sessions.get(created.id).group, null);
  assert.deepEqual(await chips(), ['ThugLife', 'Dungeon', 'Ungrouped']);

  // Right-click a group button to rename the group; a taken name is offered as a merge.
  await chip('ThugLife').click({ button: 'right' });
  await menuItem('Rename group').click();
  await page.locator('.tab-menu-rename input').fill('Dungeon');
  assert.equal(await page.locator('.tab-menu-rename button').textContent(), 'Merge');
  await page.locator('.tab-menu-rename input').fill('Studio');
  assert.equal(await page.locator('.tab-menu-rename button').textContent(), 'Save');
  await page.locator('.tab-menu-rename input').press('Enter');
  await chip('Studio').waitFor();
  await show(chip('Studio'));
  await expect.poll(names).toEqual(['Director', 'Network', 'Animator']);
  assert.equal(service.sessions.get('g-0').group, 'Studio');
  await page.keyboard.press('Escape');

  // Dragging a group button moves the whole group, and the drag neither opens its picker nor changes the chats.
  const grab = await chip('Dungeon').boundingBox();
  const studio = await chip('Studio').boundingBox();
  await page.mouse.move(grab.x + grab.width / 2, grab.y + grab.height / 2);
  await page.mouse.down();
  for (let step = 1; step <= 12; step++) await page.mouse.move(grab.x + grab.width / 2 + (studio.x + 8 - grab.x - grab.width / 2) * step / 12, grab.y + grab.height / 2);
  await page.locator('button.chat-group-chip.drop-before[data-chat-group="Studio"]').waitFor();
  assert.equal(await page.locator('.group-ghost').count(), 1);
  await page.mouse.up();
  await expect.poll(chips).toEqual(['Dungeon', 'Studio', 'Ungrouped']);
  assert.equal(await picker.count(), 0, 'dragging a group button does not open it ' + await picker.locator('.chat-picker-title').allTextContents());
  // The menu offers the same ordering without a pointer drag.
  await chip('Dungeon').click({ button: 'right' });
  assert.equal(await menuItem('Move group earlier').count(), 0);
  await menuItem('Move group later').click();
  await expect.poll(chips).toEqual(['Studio', 'Dungeon', 'Ungrouped']);
  await chip('Dungeon').click({ button: 'right' });
  await menuItem('Move group earlier').click();
  await expect.poll(chips).toEqual(['Dungeon', 'Studio', 'Ungrouped']);

  // Delete the group from its menu: the open chat and the History chat lose it, both chats stay.
  await chip('Dungeon').click({ button: 'right' });
  await menuItem('Delete group…').click();
  assert.match(await page.locator('.tab-menu-confirm p').textContent(), /1 open chat and 1 chat in History/);
  await page.locator('.tab-menu-confirm button.danger').click();
  await chip('Dungeon').waitFor({ state: 'detached' });
  assert.equal(service.sessions.get('g-3').group, null);
  assert.equal(service.sessions.get('g-4').group, null);
  await show(ungrouped);
  assert.ok((await names()).includes('Combat'), 'the chat stays open, now ungrouped');
  await page.keyboard.press('Escape');

  // History lists every group as a filter, including one that only a closed chat still carries, and deletes it from there.
  await service.sessions.assign('g-4', 'Archive');
  await page.locator('.history-button').click();
  await page.locator('.history-filters button', { hasText: 'Archive' }).click();
  assert.match(await page.locator('.history-group-bar').textContent(), /Archive · 0 open · 1 in History/);
  assert.deepEqual(await page.locator('.history-item strong').allTextContents(), ['Scout']);
  await page.locator('.history-group-bar button', { hasText: 'Delete group…' }).click();
  await page.locator('.history-group-bar button.danger').click();
  await page.locator('.history-filters button', { hasText: 'Archive' }).waitFor({ state: 'detached' });
  assert.equal(service.sessions.get('g-4').group, null);
  assert.equal(await page.locator('.history-filters button.selected').textContent(), 'All');
  await page.locator('.history-button').click();

  assert.equal(await page.locator('.desktop-error').count(), 0);
  assert.deepEqual(errors, []);
  await page.screenshot({ path: path.join(repo, 'groups.png') });
  console.log(`Groups UI passed: group buttons and pickers, saved collapse ignored, chat menu with rename, pin, tab color, groups and ordering, group color from the group menu, new group, ungroup, drop on a group button, ordering by drag and menu, New chat picker, options picker, group rename, group drag and menu, delete from the group menu and from History. Screenshot: ${path.join(repo, 'groups.png')}`);
} finally {
  await browser?.close(); await service?.close();
}
