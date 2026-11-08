import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { addQuickItem, boardMarkdown, cleanBoard, cleanLimits, createWorkItems, DEFAULT_LIMITS, LIMITS, slugify, TAG_COLORS, ukDay, weekBounds, weeklySummary, settleCycles, tracking, cleanItem } from '../work-items.mjs';

const tempRepo = async (todo) => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'jupiter-work-'));
  await mkdir(path.join(repo, 'knowledge'), { recursive: true });
  await mkdir(path.join(repo, 'workspace'), { recursive: true });
  await writeFile(path.join(repo, 'workspace/workspace.json'), JSON.stringify({ entities: [{ id: 'game-one', title: 'Game One' }] }));
  if (todo !== undefined) await writeFile(path.join(repo, 'knowledge/todo.md'), todo);
  return repo;
};

test('the first run makes My board from todo.md and keeps todo.md', async () => {
  const repo = await tempRepo('# To do\r\n\r\n- [ ] Tune pathing\r\n* [X] Pick a voice\r\nnot a task\r\n- [ ] Fix hitboxes\r\n');
  const work = createWorkItems(repo);
  const [list, again] = await Promise.all([work.list(), work.list()]);
  assert.deepEqual(list.map(({ slug, title, project, counts }) => ({ slug, title, project, counts })), [{ slug: 'my-board', title: 'My board', project: null, counts: { todo: 2, doing: 0, done: 1 } }]);
  assert.equal(again.length, 1, 'concurrent first reads migrate once');
  const board = await work.read('my-board');
  assert.deepEqual(board.columns, ['todo', 'doing', 'done'], 'Backlog (todo), In progress and Done');
  assert.deepEqual(board.items.map(item => [item.title, item.state, item.type, item.order, item.tasks.length]), [['Tune pathing', 'todo', 'feature', 0, 0], ['Fix hitboxes', 'todo', 'feature', 1, 0], ['Pick a voice', 'done', 'feature', 0, 0]]);
  assert.match(await readFile(path.join(repo, 'knowledge/todo.md'), 'utf8'), /Tune pathing/);
  assert.deepEqual((await readdir(path.join(repo, 'knowledge/work'))).sort(), ['.seeded', 'my-board.json', 'my-board.md'], 'a marker records the first run');
});

test('with no todo.md the first board is empty', async () => {
  const repo = await tempRepo();
  const board = await createWorkItems(repo).read('my-board');
  assert.equal(board.title, 'My board');
  assert.deepEqual(board.items, []);
});

test('boards are created, saved and renamed without changing the slug', async () => {
  const repo = await tempRepo('');
  const work = createWorkItems(repo);
  const created = await work.create({ title: 'Game launch!', project: 'game-one' });
  assert.equal(created.slug, 'game-launch');
  assert.equal(created.project, 'game-one');
  assert.equal((await work.create({ title: 'Game launch' })).slug, 'game-launch-2');
  await assert.rejects(work.create({ title: '   ' }), /title/);

  const saved = await work.save('game-launch', { ...created, title: 'Renamed launch', slug: 'hacked', items: [
    { id: 'a1', type: 'feature', title: 'Menus', state: 'doing', order: 5, tasks: [{ id: 't1', title: 'Main menu', done: true }, { title: 'Pause menu' }], acceptance: 'Opens fast' },
    { id: 'a2', type: 'bug', title: 'Crash', state: 'doing', order: 1 },
  ] });
  assert.equal(saved.slug, 'game-launch');
  assert.equal(saved.title, 'Renamed launch');
  assert.equal(saved.id, created.id);
  assert.deepEqual(saved.items.map(item => [item.id, item.order]), [['a2', 0], ['a1', 1]]);
  assert.equal(saved.items[1].tasks.length, 2);
  assert.ok(saved.items[1].tasks[1].id, 'tasks without ids get one');
  const reread = await work.read('game-launch');
  assert.deepEqual(reread, saved);
  assert.equal((await work.list())[0].slug, 'game-launch', 'the most recently saved board comes first');
  await assert.rejects(work.read('missing'), error => error.status === 404);
  await assert.rejects(work.read('../../etc'), error => error.status === 404);
  await assert.rejects(work.save('missing', { title: 'x' }), error => error.status === 404);
});

test('everything is validated and clamped', async () => {
  const items = Array.from({ length: LIMITS.items + 20 }, (_, index) => ({ title: `Item ${index}`, state: 'nowhere', type: 'epic', id: index === 1 ? '../bad id' : 'same', project: 'bad project!', tasks: Array.from({ length: 120 }, (__, n) => ({ title: `Task ${n}`, done: 'yes' })) }));
  items.unshift({ title: 'x'.repeat(900), details: 'd'.repeat(6000), acceptance: 'a'.repeat(6000), order: 'NaN', tasks: [{ title: '' }, { title: 'line\nbreak', done: true }] });
  items.push({ title: '   ' });
  const board = cleanBoard({ title: 'T'.repeat(800), project: 'game-one', items }, { slug: 'b' });
  assert.equal(board.title.length, LIMITS.title);
  assert.equal(board.items.length, LIMITS.items);
  const first = board.items.find(item => item.title.startsWith('xxx'));
  assert.equal(first.title.length, LIMITS.title);
  assert.equal(first.details.length, LIMITS.text);
  assert.equal(first.acceptance.length, LIMITS.text);
  assert.deepEqual(first.tasks.map(task => [task.title, task.done]), [['line break', true]]);
  const other = board.items.find(item => item.title === 'Item 5');
  assert.equal(other.state, 'todo');
  assert.equal(other.type, 'feature', 'unknown types become features');
  assert.deepEqual(other.tags, [], 'an unknown project becomes no tag');
  assert.equal('project' in other, false, 'items no longer have a project');
  assert.equal(other.tasks.length, LIMITS.tasks);
  assert.equal(other.tasks[0].done, false);
  assert.equal(new Set(board.items.map(item => item.id)).size, board.items.length, 'ids are unique');
  assert.ok(board.items.every(item => /^[A-Za-z0-9_-]{1,64}$/.test(item.id)));
  assert.equal(slugify('  Ünïcode / Board  '), 'unicode-board');
  assert.equal(slugify('!!!'), 'board');
});

test('a readable Markdown summary is written alongside each save', async () => {
  const repo = await tempRepo('');
  const work = createWorkItems(repo);
  const board = await work.create({ title: 'Launch', project: 'game-one' });
  await work.save('launch', { ...board, items: [
    { type: 'feature', title: 'Menus', state: 'testing', details: 'All menus', acceptance: 'Opens in under a second', tags: ['ui', 'Launch'], priority: 'high', due: '2026-11-04', created: '2026-11-01T10:00:00.000Z', tasks: [{ title: 'Main', done: true }, { title: 'Pause', state: 'doing', details: 'Esc opens it' }] },
    { type: 'spike', title: 'Ship it', state: 'done', created: '2026-10-30T10:00:00.000Z', completed: '2026-11-01T10:00:00.000Z' },
  ] });
  const markdown = await readFile(path.join(repo, 'knowledge/work/launch.md'), 'utf8');
  assert.match(markdown, /^# Launch\n\nProject: Game One \(game-one\)\n/);
  assert.match(markdown, /## Backlog \(0\)\n\nNothing here\./);
  assert.match(markdown, /\nTags: ui, Launch\n/);
  assert.match(markdown, /## In progress \(1\/3\)\n\n### Menus\n\n_Feature · high priority · due 2026-11-04 · tags ui, Launch · 1\/2 tasks · created 2026-11-01_\n\nAll menus\n\n- \[x\] Main\n- \[ \] Pause \(In progress\)\n  Esc opens it\n\n\*\*Acceptance criteria\*\*\n\nOpens in under a second/);
  assert.match(markdown, /## Done \(1\)\n\n### Ship it\n\n_Spike · created 2026-10-30 · done 2026-11-01_/);
  assert.equal(boardMarkdown(cleanBoard({ title: 'Solo' }, { slug: 's' })).split('\n')[2], 'Project: none');
});

test('quick add puts a feature at the top of To do on the latest board', async () => {
  const repo = await tempRepo('- [ ] Old thing\n');
  const work = createWorkItems(repo);
  await work.list();
  const second = await work.create({ title: 'Second' });
  await new Promise(resolve => setTimeout(resolve, 5));
  await work.save('second', { ...second, items: [{ title: 'Existing', state: 'todo' }] });
  const result = await addQuickItem(repo, 'Buy milk\nnow');
  assert.equal(result.slug, 'second');
  assert.deepEqual(result.items.filter(item => item.state === 'todo').map(item => [item.title, item.type, item.order]), [['Buy milk now', 'feature', 0], ['Existing', 'feature', 1]]);
  await assert.rejects(addQuickItem(repo, '  '), error => error.status === 400);
  const together = await Promise.all(['A', 'B', 'C'].map(title => addQuickItem(repo, title)));
  assert.equal(together.length, 3);
  assert.equal((await work.read('second')).items.length, 5, 'concurrent quick adds are all kept');
});

test('top level types are feature, bug and spike; older top level tasks become features', () => {
  const board = cleanBoard({ items: [
    { id: 'a', type: 'task', title: 'Old task', state: 'doing', details: 'Keep me' },
    { id: 'b', type: 'bug', title: 'Crash' },
    { id: 'c', type: 'spike', title: 'Research' },
    { id: 'd', type: 'feature', title: 'Menus' },
  ] }, { slug: 'b' });
  const byId = Object.fromEntries(board.items.map(item => [item.id, item]));
  assert.deepEqual([byId.a.type, byId.a.title, byId.a.state, byId.a.details], ['feature', 'Old task', 'doing', 'Keep me']);
  assert.deepEqual([byId.b.type, byId.c.type, byId.d.type], ['bug', 'spike', 'feature']);
});

test('tasks have state, details and dates; done follows state', () => {
  const [item] = cleanBoard({ items: [{ title: 'Parent', created: '2026-10-01T00:00:00.000Z', updated: '2026-10-05T00:00:00.000Z', tasks: [
    { id: 't1', title: 'Old done', done: true },
    { id: 't2', title: 'Old open' },
    { id: 't3', title: 'Testing', state: 'testing', done: true, details: 'Line one\r\nLine two', created: '2026-10-02T00:00:00.000Z' },
    { id: 't4', title: 'Finished', state: 'done', completed: '2026-10-03T00:00:00.000Z' },
    { id: 't5', title: 'Bad', state: 'nowhere', details: 'x'.repeat(6000) },
  ] }] }, { slug: 'b' }).items;
  assert.deepEqual(item.tasks.map(task => [task.id, task.state, task.done]), [['t1', 'done', true], ['t2', 'todo', false], ['t3', 'doing', false], ['t4', 'done', true], ['t5', 'todo', false]]);
  assert.equal(item.tasks[2].details, 'Line one\nLine two');
  assert.equal(item.tasks[4].details.length, LIMITS.text);
  assert.equal(item.tasks[0].created, item.created, 'older tasks borrow the parent created date');
  assert.equal(item.tasks[0].completed, item.updated, 'older done tasks borrow the parent updated date');
  assert.equal(item.tasks[2].created, '2026-10-02T00:00:00.000Z');
  assert.equal(item.tasks[2].completed, null, 'only Done tasks have a completed date');
  assert.equal(item.tasks[3].completed, '2026-10-03T00:00:00.000Z');
});

test('task time starts when the task enters In progress, never from creation or its parent', () => {
  const DAY = 86400000, t = days => new Date(Date.UTC(2026, 10, 1) + days * DAY).toISOString();
  // The parent has been In progress since day 0; its tasks must not inherit that.
  const [item] = cleanBoard({ items: [{ title: 'Parent', state: 'doing', created: t(0), updated: t(8), cycles: [{ start: t(0), end: null, fresh: true }], tasks: [
    { id: 't1', title: 'Never started', created: t(0) },
    { id: 't2', title: 'Straight to Done', state: 'done', created: t(0), completed: t(2) },
    { id: 't3', title: 'Running', state: 'doing', created: t(0), cycles: [{ start: t(5), end: null, fresh: true }] },
    { id: 't4', title: 'Paused', state: 'todo', created: t(0), cycles: [{ start: t(1), end: t(3), fresh: true }] },
    { id: 't5', title: 'Finished', state: 'done', created: t(0), completed: t(7), cycles: [{ start: t(4), end: t(7), fresh: true }] },
    { id: 't6', title: 'Older running', state: 'doing', created: t(2) },
    { id: 't7', title: 'Old and open' },
  ] }] }, { slug: 'b', now: t(9) }).items;
  const task = id => item.tasks.find(entry => entry.id === id);
  assert.deepEqual(task('t1').cycles, [], 'a task that never started has no cycle, whatever its parent is doing');
  assert.deepEqual(task('t7').cycles, [], 'an older task that never started has none either');
  assert.deepEqual(task('t2').cycles, [], 'straight from Backlog to Done: no cycle is made up');
  assert.deepEqual(task('t3').cycles, [{ start: t(5), end: null, fresh: true }], 'a running task keeps its own start');
  assert.deepEqual(task('t4').cycles, [{ start: t(1), end: t(3), fresh: true }], 'back in Backlog keeps the finished cycle');
  assert.deepEqual(task('t5').cycles, [{ start: t(4), end: t(7), fresh: true }]);
  assert.deepEqual(task('t6').cycles, [{ start: t(2), end: null, fresh: true, legacy: true }], 'an older task already In progress gets one legacy cycle from its created date');
  assert.equal(tracking(task('t1'), Date.parse(t(20))).inFlightMs, 0, 'no in flight time');
  assert.equal(tracking(task('t7'), Date.parse(t(20))).started, null);
  assert.equal(tracking(task('t3'), Date.parse(t(9))).inFlightMs, 4 * DAY, 'counted from its actual start');
  assert.equal(tracking(task('t5')).activeMs, 3 * DAY, 'a finished task counts its work, not its age');
  // Creation dates stay accurate and apart from timing; saving again changes nothing.
  assert.equal(task('t1').created, t(0));
  const again = cleanBoard({ items: [item] }, { slug: 'b', now: t(30) }).items[0];
  assert.deepEqual(again.tasks.map(entry => [entry.created, entry.cycles]), item.tasks.map(entry => [entry.created, entry.cycles]));
  // Moved by an agent editing the file: In progress always has one open cycle, other states have none open.
  const [moved] = cleanBoard({ items: [{ title: 'Edited', created: t(0), updated: t(6), tasks: [
    { title: 'Started by hand', state: 'doing', cycles: [] },
    { title: 'Left running', state: 'done', completed: t(6), cycles: [{ start: t(4), end: null, fresh: true }] },
  ] }] }, { slug: 'b' }).items;
  assert.deepEqual(moved.tasks[0].cycles, [{ start: t(6), end: null, fresh: true }]);
  assert.deepEqual(moved.tasks[1].cycles, [{ start: t(4), end: t(6), fresh: true }]);
});

test('priority and due date are validated', () => {
  const items = cleanBoard({ items: [
    { title: 'A', priority: 'high', due: '2026-11-04' },
    { title: 'B', priority: 'urgent', due: '2026-02-30' },
    { title: 'C', priority: 'low', due: '4 Nov' },
    { title: 'D', due: 20261104 },
  ] }, { slug: 'b' }).items;
  assert.deepEqual(items.map(item => [item.title, item.priority, item.due]), [['A', 'high', '2026-11-04'], ['B', 'none', null], ['C', 'low', null], ['D', 'none', null]]);
});

test('completed is kept while Done and cleared otherwise', () => {
  const items = cleanBoard({ items: [
    { title: 'Done with date', state: 'done', updated: '2026-10-05T00:00:00.000Z', completed: '2026-10-04T00:00:00.000Z' },
    { title: 'Done without', state: 'done', updated: '2026-10-05T00:00:00.000Z' },
    { title: 'Moved back', state: 'doing', completed: '2026-10-04T00:00:00.000Z' },
  ] }, { slug: 'b' }).items;
  const by = Object.fromEntries(items.map(item => [item.title, item.completed]));
  assert.deepEqual(by, { 'Done with date': '2026-10-04T00:00:00.000Z', 'Done without': '2026-10-05T00:00:00.000Z', 'Moved back': null });
});

test('tags are validated, coloured and shared per board', () => {
  const tooMany = Array.from({ length: 30 }, (_, n) => `tag ${n}`);
  const board = cleanBoard({
    tags: [{ name: 'UI', color: 'pink' }, { name: 'ui', color: 'green' }, { name: '  ', color: 'ice' }, { name: 'Odd', color: 'plaid' }],
    items: [
      { title: 'A', tags: ['ui', 'New one', 'New ONE', 'x'.repeat(60), 7, ''] },
      { title: 'B', tags: tooMany },
    ],
  }, { slug: 'b' });
  assert.deepEqual(board.tags.slice(0, 4), [{ name: 'UI', color: 'pink' }, { name: 'Odd', color: TAG_COLORS[1] }, { name: 'New one', color: TAG_COLORS[2] }, { name: 'x'.repeat(LIMITS.tag), color: TAG_COLORS[3] }]);
  assert.ok(board.tags.every(tag => TAG_COLORS.includes(tag.color)));
  const [a, b] = board.items;
  assert.deepEqual(a.tags, ['UI', 'New one', 'x'.repeat(LIMITS.tag)], 'names match board tags ignoring case and are clamped');
  assert.equal(b.tags.length, LIMITS.tags);
  const many = cleanBoard({ items: Array.from({ length: 10 }, (_, n) => ({ title: `I${n}`, tags: Array.from({ length: 20 }, (__, m) => `t${n}x${m}`) })) }, { slug: 'b' });
  assert.equal(many.tags.length, LIMITS.boardTags, 'a board keeps at most 100 tags');
  assert.ok(many.items.every(item => item.tags.every(name => many.tags.some(tag => tag.name === name))), 'items only use board tags');
});

test('an older item project becomes a tag named after the Workspace card', async () => {
  const repo = await tempRepo('');
  const work = createWorkItems(repo);
  await work.list();
  await writeFile(path.join(repo, 'knowledge/work/old.json'), JSON.stringify({ title: 'Old', project: 'game-one', items: [
    { id: 'a', type: 'task', title: 'Linked', project: 'game-one' },
    { id: 'b', type: 'feature', title: 'Gone', project: 'missing-card' },
    { id: 'c', type: 'feature', title: 'Both', project: 'game-one', tags: ['game one', 'Art'] },
  ] }));
  const board = await work.read('old');
  assert.equal(board.project, 'game-one', 'the board project link stays');
  assert.deepEqual(board.items.map(item => [item.id, item.type, item.tags]), [['a', 'feature', ['Game One']], ['b', 'feature', []], ['c', 'feature', ['Game One', 'Art']]], 'tag names match ignoring case');
  assert.deepEqual(board.tags.map(tag => tag.name), ['Game One', 'Art']);
  const saved = await work.save('old', board);
  assert.deepEqual(saved.items.map(item => item.tags), [['Game One'], [], ['Game One', 'Art']]);
  assert.equal(JSON.parse(await readFile(path.join(repo, 'knowledge/work/old.json'), 'utf8')).items.some(item => 'project' in item), false);
});

test('work in progress limits are validated, default on read and appear in the summary', async () => {
  assert.deepEqual(DEFAULT_LIMITS, { doing: 3 });
  assert.deepEqual(cleanLimits(undefined), { doing: 3 });
  assert.deepEqual(cleanLimits({ doing: 1, testing: 50 }), { doing: 1 }, 'the retired Testing limit is dropped');
  assert.deepEqual(cleanLimits({ doing: null }), { doing: null }, 'null clears a limit');
  for (const bad of [0, 51, 2.5, '4', -1, NaN, {}]) assert.deepEqual(cleanLimits({ doing: bad, testing: bad }), DEFAULT_LIMITS, `${String(bad)} is rejected`);
  assert.deepEqual(cleanBoard({ title: 'X' }, { slug: 'x' }).limits, DEFAULT_LIMITS);

  const repo = await tempRepo('');
  const work = createWorkItems(repo);
  await work.list();
  await writeFile(path.join(repo, 'knowledge/work/old.json'), JSON.stringify({ title: 'Old', items: [{ title: 'A', state: 'doing' }] }));
  assert.deepEqual((await work.read('old')).limits, DEFAULT_LIMITS, 'an older board without limits gets the defaults');
  const board = await work.create({ title: 'Busy' });
  const saved = await work.save('busy', { ...board, limits: { doing: 1, testing: 2 }, items: [{ title: 'One', state: 'doing' }, { title: 'Two', state: 'doing' }, { title: 'Three', state: 'testing' }] });
  assert.deepEqual(saved.limits, { doing: 1 });
  assert.deepEqual((await work.read('busy')).limits, { doing: 1 });
  const markdown = await readFile(path.join(repo, 'knowledge/work/busy.md'), 'utf8');
  assert.match(markdown, /\nLimits: In progress 1\n/);
  assert.match(markdown, /## In progress \(3\/1, over the limit\)/, 'the Testing item joined In progress');
  assert.doesNotMatch(markdown, /Testing/);
  await work.save('busy', { ...saved, limits: { doing: null } });
  assert.match(await readFile(path.join(repo, 'knowledge/work/busy.md'), 'utf8'), /\nLimits: In progress none\n[\s\S]*## In progress \(3\)/);
});

// Local times, so the UK calendar week (Monday to Sunday) is the same in any time zone.
const at = (month, day, hour = 12) => new Date(2026, month - 1, day, hour).toISOString();
const weeklyBoard = () => cleanBoard({ title: 'Launch', items: [
  { id: 'a', type: 'feature', title: 'Menus', state: 'done', tags: ['UI'], created: at(10, 28), completed: at(10, 31) },
  { id: 'b', type: 'bug', title: 'Crash', state: 'done', created: at(10, 30), completed: at(11, 1) },
  { id: 'c', type: 'feature', title: 'Older', state: 'done', created: at(10, 20), completed: at(10, 24) },
  { id: 'd', type: 'spike', title: 'Pathing', state: 'testing', tags: ['AI'], created: at(10, 10) },
  { id: 'e', type: 'feature', title: 'Fresh', state: 'doing', created: at(10, 31) },
  { id: 'f', type: 'bug', title: 'Waiting', state: 'todo', created: at(9, 1) },
] }, { slug: 'launch' });
// Sunday 01/11/2026 at 18:00, the last day of the week that starts on Monday 26/10/2026.
const NOW = new Date(2026, 10, 1, 18);

test('weeks are UK calendar weeks, Monday to Sunday', () => {
  for (const day of [26, 27, 28, 29, 30, 31]) assert.equal(weekBounds(new Date(2026, 9, day, 9)).start.getTime(), new Date(2026, 9, 26).getTime());
  assert.equal(weekBounds(new Date(2026, 10, 1, 23, 59)).start.getTime(), new Date(2026, 9, 26).getTime(), 'Sunday belongs to the week before it');
  assert.equal(weekBounds(new Date(2026, 10, 2, 0, 1)).start.getTime(), new Date(2026, 10, 2).getTime(), 'Monday starts a new week');
  assert.equal(weekBounds(NOW).end.getTime(), new Date(2026, 10, 2).getTime());
  assert.equal(weekBounds(NOW, 1).start.getTime(), new Date(2026, 9, 19).getTime());
  assert.equal(weekBounds(NOW, -1).start.getTime(), new Date(2026, 10, 2).getTime(), 'a negative offset is a later week');
});

test('the weekly summary counts Done items, types, average time and long running work', () => {
  const week = weeklySummary(weeklyBoard(), { now: NOW });
  assert.equal(week.total, 2);
  assert.deepEqual(week.byType, { feature: 1, bug: 1, spike: 0 });
  assert.deepEqual(week.done.map(item => [item.title, item.after]), [['Crash', '2 days'], ['Menus', '3 days']]);
  assert.equal(week.average, '3 days', 'average of 3 and 2 days, rounded');
  assert.deepEqual(week.inFlight.map(item => [item.title, item.state, item.for]), [['Pathing', 'doing', '3 weeks']], 'only In progress for over 7 days (Pathing was in Testing)');
  assert.equal(week.date, '2026-10-26');
  assert.equal(week.range, '26/10/2026 to 01/11/2026', 'the range is Monday to Sunday in UK format (DD/MM/YYYY)');
  assert.equal(ukDay(new Date(2026, 10, 2)), '02/11/2026');
  assert.match(week.markdown, /^# Launch: 26\/10\/2026 to 01\/11\/2026\n\n2 done \(1 Feature, 1 Bug\), average 3 days of active work\.\n\n## Done\n\n- Bug: Crash, done after 2 days\n- Feature: Menus \[UI\], done after 3 days\n\n## Still in flight\n\n- Spike: Pathing \[AI\], In progress for 3 weeks\n$/);

  const last = weeklySummary(weeklyBoard(), { now: NOW, offsetWeeks: 1 });
  assert.equal(last.range, '19/10/2026 to 25/10/2026');
  assert.deepEqual(last.done.map(item => item.title), ['Older']);
  assert.equal(last.average, '4 days');
  assert.deepEqual(last.inFlight.map(item => [item.title, item.for]), [['Pathing', '2 weeks']], 'in flight is measured to the end of that week');

  const next = weeklySummary(weeklyBoard(), { now: NOW, offsetWeeks: -1 });
  assert.equal(next.range, '02/11/2026 to 08/11/2026');
  assert.equal(next.total, 0);
  assert.deepEqual(next.inFlight.map(item => [item.title, item.for]), [['Pathing', '3 weeks']], 'a week still to come is measured to now');

  const empty = weeklySummary(cleanBoard({ title: 'Empty' }, { slug: 'empty' }), { now: NOW });
  assert.equal(empty.total, 0);
  assert.equal(empty.average, null);
  assert.match(empty.markdown, /0 done\.\n\n## Done\n\nNothing reached Done\.\n\n## Still in flight\n\nNothing has been in flight for over 7 days\.\n$/);
  for (const bad of [1.5, 9999, NaN]) assert.equal(weeklySummary(weeklyBoard(), { now: NOW, offsetWeeks: bad }).offsetWeeks, 0, 'a bad offset means this week');
});

test('saving the weekly summary writes a dated Markdown file matching the summary', async () => {
  const repo = await tempRepo('');
  const work = createWorkItems(repo);
  await work.list();
  await work.create({ title: 'Launch' });
  await work.save('launch', weeklyBoard());
  const sheet = await work.weekly('launch', 0, NOW);
  const { path: file, summary } = await work.saveWeekly('launch', 0, NOW);
  assert.equal(file, `knowledge/work/launch-week-${sheet.date}.md`);
  assert.equal(sheet.date, '2026-10-26', 'the file is named after the Monday');
  assert.equal(await readFile(path.join(repo, file), 'utf8'), sheet.markdown);
  assert.equal(summary.markdown, sheet.markdown);
  assert.deepEqual((await work.list()).map(row => row.slug).sort(), ['launch', 'my-board'], 'the weekly file is not a board');
  const lastWeek = await work.saveWeekly('launch', 1, NOW);
  assert.match(await readFile(path.join(repo, lastWeek.path), 'utf8'), /Feature: Older, done after 4 days/);
  await assert.rejects(work.saveWeekly('missing', 0, NOW), error => error.status === 404);
});

test('deleting a board moves its files to .deleted and leaves weekly files', async () => {
  const repo = await tempRepo('- [ ] Old thing\n');
  const work = createWorkItems(repo);
  await work.list();
  await work.create({ title: 'Launch' });
  await work.save('launch', weeklyBoard());
  await work.saveWeekly('launch', 0, NOW);
  const folder = path.join(repo, 'knowledge/work');
  const weekly = (await readdir(folder)).filter(name => name.startsWith('launch-week-'));
  assert.equal(weekly.length, 1);

  const result = await work.remove('launch', new Date('2026-11-02T09:30:15.250Z'));
  assert.equal(result.deleted, 'launch');
  assert.equal(result.name, 'launch-2026-11-02T09-30-15-250Z');
  assert.deepEqual(result.moved, ['knowledge/work/.deleted/launch-2026-11-02T09-30-15-250Z.json', 'knowledge/work/.deleted/launch-2026-11-02T09-30-15-250Z.md']);
  assert.deepEqual(result.boards.map(row => row.slug), ['my-board']);
  assert.equal(result.next, 'my-board');
  assert.deepEqual((await readdir(path.join(folder, '.deleted'))).sort(), ['launch-2026-11-02T09-30-15-250Z.json', 'launch-2026-11-02T09-30-15-250Z.md']);
  const kept = JSON.parse(await readFile(path.join(folder, '.deleted/launch-2026-11-02T09-30-15-250Z.json'), 'utf8'));
  assert.deepEqual(kept.items.map(item => item.title).sort(), ['Crash', 'Fresh', 'Menus', 'Older', 'Pathing', 'Waiting'], 'the moved file is the whole board');
  await assert.rejects(access(path.join(folder, 'launch.json')));
  await assert.rejects(access(path.join(folder, 'launch.md')));
  assert.deepEqual((await readdir(folder)).filter(name => name.startsWith('launch-week-')), weekly, 'weekly files are left alone');
  await assert.rejects(work.read('launch'), error => error.status === 404);
  await assert.rejects(work.remove('launch'), error => error.status === 404);
  await assert.rejects(work.remove('../etc'), error => error.status === 404);

  // The same board deleted twice in the same millisecond keeps both copies.
  await work.create({ title: 'Launch' });
  const again = await work.remove('launch', new Date('2026-11-02T09:30:15.250Z'));
  assert.match(again.moved[0], /launch-2026-11-02T09-30-15-250Z-2\.json$/);

  // Deleting the last board leaves none: nothing is made in its place, now or on later reads.
  const last = await work.remove('my-board');
  assert.deepEqual(last.boards, []);
  assert.equal(last.next, null);
  assert.deepEqual(await work.list(), []);
  assert.deepEqual(await createWorkItems(repo).list(), [], 'a fresh service does not seed again either');
  await assert.rejects(work.read('my-board'), error => error.status === 404);
  assert.equal((await readdir(path.join(folder, '.deleted'))).filter(name => name.startsWith('my-board-')).length, 2, 'its json and md');
});

test('a deleted board can be restored from .deleted, and names are checked strictly', async () => {
  const repo = await tempRepo('- [ ] Old thing\n');
  const work = createWorkItems(repo);
  await work.list();
  const board = await work.create({ title: 'Launch' });
  await work.save('launch', { ...weeklyBoard(), id: board.id });
  const removed = await work.remove('launch', new Date('2026-11-02T09:30:15.250Z'));
  const restored = await work.restore('launch', removed.name);
  assert.equal(restored.slug, 'launch');
  assert.equal(restored.id, board.id);
  assert.equal(restored.items.length, 6, 'every item comes back');
  assert.equal((await work.list())[0].slug, 'launch', 'the restored board is the latest');
  const folder = path.join(repo, 'knowledge/work');
  assert.deepEqual(await readdir(path.join(folder, '.deleted')), [], 'the moved files are gone from .deleted');
  assert.match(await readFile(path.join(folder, 'launch.md'), 'utf8'), /^# Launch/);
  await assert.rejects(work.restore('launch', removed.name), error => error.status === 404, 'it can only be restored once');

  // The slug was taken meanwhile: the restored board gets the next free one. A .json suffix is fine.
  const again = await work.remove('launch', new Date('2026-11-02T10:00:00.000Z'));
  await work.create({ title: 'Launch' });
  assert.equal((await work.restore('launch', `${again.name}.json`)).slug, 'launch-2');

  // Restoring the only board after deleting it.
  await work.remove('launch'); await work.remove('launch-2');
  const only = await work.remove('my-board', new Date('2026-11-02T11:00:00.000Z'));
  assert.deepEqual(only.boards, []);
  assert.equal((await work.restore('my-board', only.name)).slug, 'my-board');
  assert.deepEqual((await work.list()).map(row => row.slug), ['my-board']);

  for (const [slug, name] of [['launch', '../launch-2026-11-02T09-30-15-250Z'], ['launch', 'launch-2026-11-02T09-30-15-250Z/../../x'], ['launch', 'my-board-2026-11-02T11-00-00-000Z'],
    ['../x', 'x-2026-11-02T11-00-00-000Z'], ['launch', 'launch'], ['launch', ''], ['launch', null], ['launch', 'launch-2026-11-02T09-30-15-250Z.md'], ['launch', 'LAUNCH-2026-11-02T09-30-15-250Z']]) {
    await assert.rejects(work.restore(slug, name), error => error.status === 404, `${slug} ${name} is refused`);
  }
});

test('quick add makes My board when there are no boards', async () => {
  const repo = await tempRepo('');
  const work = createWorkItems(repo);
  await work.remove((await work.list())[0].slug);
  assert.deepEqual(await work.list(), []);
  const result = await addQuickItem(repo, 'First thing');
  assert.equal(result.title, 'My board');
  assert.deepEqual(result.items.map(item => item.title), ['First thing']);
});

test('older boards migrate safely: To do is Backlog, Testing joins In progress, history and dates are kept', () => {
  const board = cleanBoard({ title: 'Old', items: [
    { id: 'a', title: 'Queued', state: 'todo', created: '2026-10-01T09:00:00.000Z', tags: ['The Pale'] },
    { id: 'b', title: 'Checking', state: 'testing', created: '2026-10-02T09:00:00.000Z', updated: '2026-10-20T09:00:00.000Z', tasks: [{ title: 'QA', state: 'testing' }] },
    { id: 'c', title: 'Building', state: 'doing', created: '2026-10-03T09:00:00.000Z' },
    { id: 'd', title: 'Shipped', state: 'done', created: '2026-10-04T09:00:00.000Z', completed: '2026-10-09T09:00:00.000Z' },
  ] }, { slug: 'old', now: '2026-11-04T09:00:00.000Z' });
  const [queued, checking, building, shipped] = ['a', 'b', 'c', 'd'].map(id => board.items.find(item => item.id === id));
  assert.equal(queued.state, 'todo'); assert.deepEqual(queued.cycles, [], 'a Backlog item has no work cycles'); assert.equal(queued.refined, false, 'and needs refinement');
  assert.deepEqual(queued.tags, ['The Pale'], 'refinement is not a tag');
  assert.equal(checking.state, 'doing'); assert.equal(checking.tasks[0].state, 'doing');
  assert.deepEqual(checking.history, [{ at: '2026-10-20T09:00:00.000Z', from: 'testing', to: 'doing' }], 'the move out of Testing is kept as history');
  assert.deepEqual(building.cycles, [{ start: '2026-10-03T09:00:00.000Z', end: null, fresh: true, legacy: true }], 'its start is the date the calendar already used');
  assert.deepEqual(shipped.cycles, [{ start: '2026-10-04T09:00:00.000Z', end: '2026-10-09T09:00:00.000Z', fresh: true, legacy: true }]);
  assert.equal(shipped.completed, '2026-10-09T09:00:00.000Z');
  // Running the migration again changes nothing and adds nothing.
  const again = cleanBoard(board, { slug: 'old', now: '2026-11-05T09:00:00.000Z' });
  assert.deepEqual(again.items.map(item => [item.state, item.cycles, item.history]), board.items.map(item => [item.state, item.cycles, item.history]));
  assert.equal(cleanItem({ title: 'Ready one', refined: true }).refined, true);
});

test('work cycles follow the state however an item moves, and time is counted the documented way', () => {
  const DAY = 86400000, t = days => new Date(Date.UTC(2026, 10, 1) + days * DAY).toISOString();
  // Entering In progress opens a cycle; leaving closes it; a stray open cycle ends where the next begins.
  assert.deepEqual(settleCycles([], 'doing', t(0)), [{ start: t(0), end: null, fresh: true }]);
  assert.deepEqual(settleCycles([{ start: t(0), end: null, fresh: true }], 'todo', t(3)), [{ start: t(0), end: t(3), fresh: true }]);
  assert.deepEqual(settleCycles([{ start: t(0), end: null, fresh: true }, { start: t(8), end: null }], 'doing', t(9)), [{ start: t(0), end: t(8), fresh: true }, { start: t(8), end: null }]);
  // 3 days In progress, 5 in Backlog, then 2 more: Continue counts 5 in flight; a new cycle counts 2.
  const continued = { state: 'doing', cycles: [{ start: t(0), end: t(3), fresh: true }, { start: t(8), end: null }] };
  assert.deepEqual(tracking(continued, Date.parse(t(10))), { cycles: 2, currentMs: 2 * DAY, inFlightMs: 5 * DAY, activeMs: 5 * DAY, elapsedMs: 10 * DAY, started: t(0) });
  const restarted = { state: 'doing', cycles: [{ start: t(0), end: t(3), fresh: true }, { start: t(8), end: null, fresh: true }] };
  assert.equal(tracking(restarted, Date.parse(t(10))).inFlightMs, 2 * DAY, 'a new work cycle resets only the current count');
  assert.equal(tracking(restarted, Date.parse(t(10))).activeMs, 5 * DAY, 'history keeps the total');
  const paused = { state: 'todo', cycles: [{ start: t(0), end: t(3), fresh: true }] };
  assert.equal(tracking(paused, Date.parse(t(10))).activeMs, 3 * DAY, 'Backlog time is never active');
  assert.equal(tracking(paused, Date.parse(t(10))).elapsedMs, 10 * DAY, 'elapsed includes the pause');
  const finished = { state: 'done', cycles: [{ start: t(0), end: t(4), fresh: true }] };
  assert.equal(tracking(finished, Date.parse(t(20))).elapsedMs, 4 * DAY, 'elapsed stops at Done');
  assert.deepEqual(tracking({ state: 'todo', cycles: [] }), { cycles: 0, currentMs: 0, inFlightMs: 0, activeMs: 0, elapsedMs: 0, started: null });
  // A saved board keeps the cycles and fixes any that disagree with the state.
  const item = cleanItem({ title: 'Moved by an agent', state: 'doing', updated: t(5), cycles: [{ start: t(0), end: t(2) }], history: [{ at: t(5), from: 'todo', to: 'doing' }, { at: 'bad', from: 'x', to: 'y' }] });
  assert.deepEqual(item.cycles, [{ start: t(0), end: t(2), fresh: true }, { start: t(5), end: null }], 'In progress always has one open cycle');
  assert.deepEqual(item.history, [{ at: t(5), from: 'todo', to: 'doing' }]);
});