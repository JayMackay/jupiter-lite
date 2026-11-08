import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Sessions } from '../sessions.mjs';
import { createService } from '../server.mjs';
import { groupLabel } from '../titles.mjs';
import { chatBuckets, fitButtons, groupedChats, groupNames, orderedChats } from '../../../src/desktop/chatOrder.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
async function fixture() {
  await mkdir(path.join(root, '.cache'), { recursive: true });
  const repo = await mkdtemp(path.join(root, '.cache', 'chat-groups-'));
  const sessions = await new Sessions(repo, path.join(repo, '.jupiter')).init();
  // tabOrder follows insertion: a0 b1 c2 d3 e4 f5. e is closed; f is pinned.
  for (const [id, group, pinned, open] of [['a', null, false, true], ['b', 'Dungeon', false, true], ['c', null, false, true], ['d', 'Dungeon', false, true], ['e', 'Dungeon', false, false], ['f', 'Dungeon', true, true]]) {
    sessions.items.set(id, sessions.make({ id, name: id, agent: 'codex', group, pinned, open, status: 'stopped', createdAt: '2026-10-14', updatedAt: `2026-10-14T00:0${sessions.items.size}:00Z`, cols: 80, rows: 25 }));
  }
  return { repo, sessions };
}
const ids = sessions => sessions.active().map(item => item.id);

test('grouped tabs sit together, assignment joins the group and the frontend agrees', async () => {
  const { sessions } = await fixture();
  try {
    assert.deepEqual(ids(sessions), ['f', 'a', 'b', 'd', 'c']);
    assert.deepEqual(orderedChats([...sessions.items.values()]).map(item => item.id), ids(sessions));
    assert.deepEqual(groupedChats([...sessions.items.values()]).map(group => [group.name, group.pinned, group.items.map(item => item.id)]), [['Dungeon', true, ['f']], [null, false, ['a']], ['Dungeon', false, ['b', 'd']], [null, false, ['c']]]);
    assert.deepEqual(groupNames([...sessions.items.values()]), ['Dungeon']);

    await sessions.assign('c', 'Dungeon');
    assert.deepEqual(ids(sessions), ['f', 'a', 'b', 'd', 'c']);
    assert.equal(sessions.get('c').group, 'Dungeon');
    await sessions.assign('a', ' Dungeon ');
    assert.deepEqual(ids(sessions), ['f', 'b', 'd', 'c', 'a'], 'joining moves the tab after the last member');
    await sessions.assign('a', null);
    assert.deepEqual(ids(sessions), ['f', 'b', 'd', 'c', 'a'], 'leaving keeps the position');
    assert.equal(sessions.get('a').group, null);
    const unchanged = sessions.list();
    await sessions.assign('b', 'Dungeon');
    assert.deepEqual(sessions.list(), unchanged, 'assigning the same group changes nothing');
    await sessions.assign('b', '');
    assert.equal(sessions.get('b').group, null);

    await assert.rejects(sessions.assign('c', 'Группа'), /English group name/);
    await assert.rejects(sessions.assign('c', 'x'.repeat(61)), /under 60/);
    assert.equal(groupLabel('  Two   words '), 'Two words');
    assert.equal(groupLabel(undefined), null);
    assert.equal(sessions.get('c').group, 'Dungeon', 'rejected values leave the group alone');
  } finally { await sessions.close(); }
});

test('group buttons show each group once, with mixed pins in one bucket, and Ungrouped last', async () => {
  const { sessions } = await fixture();
  try {
    const all = () => [...sessions.items.values()];
    // The saved order has Dungeon pinned (f), then a, then Dungeon again (b, d), then c; the header shows Dungeon once.
    assert.deepEqual(chatBuckets(all()).map(bucket => [bucket.name, bucket.items.map(item => item.id)]), [['Dungeon', ['f', 'b', 'd']], [null, ['a', 'c']]]);
    const [dungeon, loose] = chatBuckets(all());
    assert.deepEqual([dungeon.key, dungeon.pinned, dungeon.items.map(item => item.pinned), loose.key], ['group:Dungeon', true, [true, false, false], 'ungrouped'], 'pins stay per chat; the closed chat e has no button entry');
    assert.equal(loose.name, null, 'Ungrouped is a presentation bucket: its chats keep group null');
    assert.deepEqual(all().filter(item => !item.group).map(item => item.group), [null, null]);
    // Counts and activity are per bucket.
    sessions.get('d').status = 'running'; sessions.get('d').activity = 'working'; sessions.get('a').unread = true;
    assert.deepEqual(chatBuckets(all()).map(bucket => [bucket.items.length, bucket.working, bucket.unread]), [[3, 1, 0], [2, 0, 1]]);
    // Only Ungrouped appears when no chat has a group; nothing appears without open chats.
    assert.deepEqual(chatBuckets(all().map(item => ({ ...item, group: null }))).map(bucket => bucket.name), [null]);
    assert.deepEqual(chatBuckets([]), []);
    // Colors: a saved one wins, otherwise the stable automatic one.
    assert.equal(chatBuckets(all(), { Dungeon: '#91b6da' })[0].color, '#91b6da');
    // A second group appears in the order of its earliest chat, and the saved order is untouched.
    await sessions.assign('c', 'Town');
    assert.deepEqual(chatBuckets(all()).map(bucket => bucket.name), ['Dungeon', 'Town', null]);
    assert.deepEqual(ids(sessions), orderedChats(all()).map(item => item.id));
  } finally { await sessions.close(); }
});

test('the header keeps as many group buttons as fit, always the active one, and reserves room for More groups', () => {
  const widths = [100, 100, 100, 100], gap = 4, more = 80;
  assert.deepEqual(fitButtons(widths, 1000, more, gap, 0), [0, 1, 2, 3], 'everything fits: no More groups');
  assert.deepEqual(fitButtons(widths, 412, more, gap, 0), [0, 1, 2, 3], 'exactly full still fits without reserving More');
  assert.deepEqual(fitButtons(widths, 411, more, gap, 0), [0, 1, 2], 'one button overflows, so the More button takes its room');
  assert.deepEqual(fitButtons(widths, 300, more, gap, 1), [0, 1], 'the active button stays inside the prefix');
  assert.deepEqual(fitButtons(widths, 300, more, gap, 3), [0, 3], 'an active button beyond the prefix replaces trailing ones');
  assert.deepEqual(fitButtons(widths, 150, more, gap, 3), [3], 'a very narrow row keeps only the active button');
  assert.deepEqual(fitButtons(widths, 150, more, gap, -1), [], 'no active chat and no room: only More groups');
  assert.deepEqual(fitButtons([], 100, more, gap, -1), []);
});

test('dragging beside another group joins it and dragging beside an ungrouped tab leaves it', async () => {
  const { sessions } = await fixture();
  try {
    await sessions.reorder('a', 'd', 'after');
    assert.deepEqual(ids(sessions), ['f', 'b', 'd', 'a', 'c']);
    assert.equal(sessions.get('a').group, 'Dungeon');
    await sessions.reorder('b', 'c', 'before');
    assert.deepEqual(ids(sessions), ['f', 'd', 'a', 'b', 'c']);
    assert.equal(sessions.get('b').group, null);
    await assert.rejects(sessions.reorder('a', 'f', 'after'), /Pinned tabs stay together/);
    assert.equal(sessions.get('a').group, 'Dungeon', 'a refused drop does not change the group');
    assert.deepEqual(groupedChats([...sessions.items.values()]).map(group => group.items.map(item => item.id)), [['f'], ['d', 'a'], ['b'], ['c']]);
  } finally { await sessions.close(); }
});

test('a group moves as one block and renaming relabels it everywhere', async () => {
  const { sessions } = await fixture();
  try {
    await sessions.assign('c', 'Town');
    await sessions.moveGroup('Dungeon', false, 'a', 'before');
    assert.deepEqual(ids(sessions), ['f', 'b', 'd', 'a', 'c']);
    assert.deepEqual(sessions.list().filter(item => !item.pinned).map(item => item.id), ['b', 'd', 'e', 'a', 'c'], 'the closed member travels with its group');
    await sessions.moveGroup('Dungeon', false, 'c', 'after');
    assert.deepEqual(ids(sessions), ['f', 'a', 'c', 'b', 'd'], 'a target inside a group means beside the whole group');
    await sessions.moveGroup('Town', false, 'd', 'after');
    assert.deepEqual(ids(sessions), ['f', 'a', 'b', 'd', 'c']);
    assert.deepEqual(orderedChats([...sessions.items.values()]).map(item => item.id), ids(sessions));
    await assert.rejects(sessions.moveGroup('Dungeon', false, 'f', 'before'), /Pinned tabs stay together/);
    await assert.rejects(sessions.moveGroup('Nowhere', false, 'a', 'before'), /no open tabs/);
    await assert.rejects(sessions.moveGroup('Dungeon', false, 'a', 'inside'), /valid tab position/);
    const unchanged = sessions.list();
    await sessions.moveGroup('Dungeon', true, 'f', 'before');
    assert.deepEqual(sessions.list(), unchanged, 'dropping a group beside itself changes nothing');

    await sessions.renameGroup('Dungeon', ' Crypt ');
    assert.deepEqual(['b', 'd', 'e', 'f'].map(id => sessions.get(id).group), ['Crypt', 'Crypt', 'Crypt', 'Crypt'], 'closed and pinned members are renamed too');
    assert.deepEqual(ids(sessions), ['f', 'a', 'b', 'd', 'c']);
    await sessions.renameGroup('Town', 'Crypt');
    assert.deepEqual(groupedChats([...sessions.items.values()]).map(group => [group.name, group.items.map(item => item.id)]), [['Crypt', ['f']], [null, ['a']], ['Crypt', ['b', 'd', 'c']]], 'a taken name merges the groups');
    await assert.rejects(sessions.renameGroup('Town', 'Keep'), /no longer exists/);
    await assert.rejects(sessions.renameGroup('Crypt', '  '), /Name the group/);
    await assert.rejects(sessions.renameGroup('Crypt', 'Склеп'), /English group name/);
    assert.equal(sessions.get('b').group, 'Crypt', 'a refused rename changes nothing');

    // Deleting a group ungroups every member, the closed one included, and keeps the tab order.
    assert.deepEqual(await sessions.deleteGroup(' Crypt '), { removed: 5, history: 1 });
    assert.deepEqual(['b', 'c', 'd', 'e', 'f'].map(id => sessions.get(id).group), [null, null, null, null, null]);
    assert.deepEqual(ids(sessions), ['f', 'a', 'b', 'd', 'c'], 'leaving the group keeps every tab where it was');
    assert.deepEqual(await sessions.deleteGroup('Crypt'), { removed: 0, history: 0 }, 'deleting again is harmless');
    await assert.rejects(sessions.deleteGroup('Склеп'), /English group name/);
    await assert.rejects(sessions.deleteGroup('  '), /Name the group/);
  } finally { await sessions.close(); }
});

test('groups persist across restart and the HTTP routes validate group input', async () => {
  const { sessions, repo } = await fixture();
  let reopened;
  try {
    await sessions.assign('c', 'Dungeon');
    await sessions.close();
    const saved = JSON.parse(await readFile(path.join(repo, '.jupiter/sessions.json'), 'utf8'));
    assert.deepEqual(saved.map(item => [item.id, item.group]), [['f', 'Dungeon'], ['a', null], ['b', 'Dungeon'], ['d', 'Dungeon'], ['c', 'Dungeon'], ['e', 'Dungeon']], 'an ungrouped tab ahead of the group keeps its place; the closed member stays with its group');
    reopened = await new Sessions(repo, path.join(repo, '.jupiter')).init();
    assert.deepEqual(ids(reopened), ['f', 'a', 'b', 'd', 'c']);
    assert.equal(reopened.get('e').group, 'Dungeon', 'closed chats keep their group for History');
  } finally { await reopened?.close(); }

  const service = await createService({ repo, uiDir: path.join(root, 'desktop', 'splash'), mcpOptions: { home: repo, env: {} } });
  try {
    const request = (route, data, method) => fetch(service.origin + '/api' + route, { method, headers: { Authorization: `Bearer ${service.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    const assigned = await request('/sessions/a', { group: 'Team' }, 'PATCH');
    assert.equal(assigned.status, 200);
    assert.equal((await assigned.json()).group, 'Team');
    const refused = await request('/sessions/a', { group: 'Команда' }, 'PATCH');
    assert.equal(refused.ok, false);
    assert.match((await refused.json()).error, /English group name/);
    assert.equal(service.sessions.get('a').group, 'Team');
    const cleared = await request('/sessions/a', { group: null }, 'PATCH');
    assert.equal((await cleared.json()).group, null);
    const settings = await (await request('/settings', { collapsedGroups: ['Dungeon', 7, 'x'.repeat(61), 'Dungeon'] }, 'POST')).json();
    assert.deepEqual(settings.collapsedGroups, ['Dungeon']);
    const colors = await (await request('/settings', { groupColors: { Dungeon: '#91B6DA', Bad: 'red', ['x'.repeat(61)]: '#000000', Odd: 7 } }, 'POST')).json();
    assert.deepEqual(colors.groupColors, { Dungeon: '#91b6da' });
    assert.deepEqual((await (await request('/settings', { groupColors: {} }, 'POST')).json()).groupColors, {});

    // Renaming carries the group's color and collapsed state; a merge keeps the target's.
    await request('/settings', { groupColors: { Dungeon: '#91b6da', Team: '#dba3bb' }, collapsedGroups: ['Dungeon'] }, 'POST');
    const renamed = await request('/groups/rename', { from: 'Dungeon', to: 'Keep' }, 'POST');
    assert.equal(renamed.status, 200);
    assert.deepEqual((await renamed.json()).map(item => item.group), ['Keep', null, 'Keep', 'Keep', 'Keep']);
    let saved = await (await fetch(service.origin + '/api/bootstrap', { headers: { Authorization: `Bearer ${service.token}` } })).json();
    assert.deepEqual([saved.settings.groupColors, saved.settings.collapsedGroups], [{ Team: '#dba3bb', Keep: '#91b6da' }, ['Keep']]);
    await request('/sessions/a', { group: 'Team' }, 'PATCH');
    await request('/groups/rename', { from: 'Keep', to: 'Team' }, 'POST');
    saved = await (await fetch(service.origin + '/api/bootstrap', { headers: { Authorization: `Bearer ${service.token}` } })).json();
    assert.deepEqual([saved.settings.groupColors, saved.settings.collapsedGroups], [{ Team: '#dba3bb' }, []]);
    assert.equal(service.sessions.get('e').group, 'Team');
    const missing = await request('/groups/rename', { from: 'Keep', to: 'Other' }, 'POST');
    assert.equal(missing.status, 404);
    await request('/sessions/c', { group: 'Solo' }, 'PATCH');
    const moved = await request('/groups/move', { group: 'Solo', pinned: false, targetId: 'a', position: 'before' }, 'POST');
    assert.equal(moved.status, 200);
    assert.deepEqual((await moved.json()).map(item => item.id), ['f', 'c', 'a', 'b', 'd']);
    const across = await request('/groups/move', { group: 'Solo', pinned: false, targetId: 'f', position: 'after' }, 'POST');
    assert.match((await across.json()).error, /Pinned tabs stay together/);

    // Deleting a group over HTTP also forgets its color and collapsed state; other groups keep theirs.
    await request('/settings', { groupColors: { Team: '#dba3bb', Solo: '#91b6da' }, collapsedGroups: ['Team', 'Solo'] }, 'POST');
    const deleted = await request('/groups/delete', { name: 'Team' }, 'POST');
    assert.equal(deleted.status, 200);
    assert.deepEqual(await deleted.json(), { removed: 5, history: 1 });
    assert.deepEqual(['a', 'b', 'd', 'e', 'f'].map(id => service.sessions.get(id).group), [null, null, null, null, null]);
    assert.equal(service.sessions.get('c').group, 'Solo');
    saved = await (await fetch(service.origin + '/api/bootstrap', { headers: { Authorization: `Bearer ${service.token}` } })).json();
    assert.deepEqual([saved.settings.groupColors, saved.settings.collapsedGroups], [{ Solo: '#91b6da' }, ['Solo']]);
    assert.deepEqual(await (await request('/groups/delete', { name: 'Nowhere' }, 'POST')).json(), { removed: 0, history: 0 });
    const badDelete = await request('/groups/delete', { name: 'Команда' }, 'POST');
    assert.equal(badDelete.ok, false);
    assert.match((await badDelete.json()).error, /English group name/);
  } finally { await service.close(); }
});
