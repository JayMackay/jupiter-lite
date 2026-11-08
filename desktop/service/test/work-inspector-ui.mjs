// Work board side panel: the Project Overview (health, Next up, refinement queue, Due soon) and the contextual
// ticket inspector, with its quick actions, collapse and expand, project switching, keyboard use and a narrow window.
// Opens the dashboard's To do panel, so it needs a fresh `npm run build` (use the dist lock wrapper when other agents build).
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createService } from '../server.mjs';

const root = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const temp = await mkdtemp(path.join(os.tmpdir(), 'jupiter-work-panel-'));
const repo = path.join(temp, 'repo'), stateDir = path.join(repo, '.state');
const shots = process.env.WORK_SHOTS || path.join(root, '.cache', path.basename(temp));
for (const folder of [repo, stateDir, shots, path.join(repo, 'knowledge/work')]) await mkdir(folder, { recursive: true });
for (const file of ['workspace/workspace.json', 'workspace/_shared']) await cp(path.join(root, file), path.join(repo, file), { recursive: true });

const day = offset => { const date = new Date(); date.setDate(date.getDate() + offset); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; };
const uk = offset => day(offset).split('-').reverse().join('/');
const when = hours => new Date(Date.now() - hours * 3600000).toISOString();
const ticket = (id, title, fields) => ({ id, type: 'feature', title, details: '', acceptance: '', state: 'todo', tags: [], priority: 'none', due: null, refined: false, tasks: [], created: when(30), updated: when(30), ...fields });
const write = (slug, title, updated, items) => writeFile(path.join(repo, 'knowledge/work', `${slug}.json`), JSON.stringify({ id: `b${slug}`, title, project: null, created: when(40), updated, items: items.map((item, order) => ({ order, ...item })) }));
// Alpha: 9 tickets. Backlog 6 (4 Ready, 2 need refinement), In progress 2, Done 1.
await write('alpha', 'Alpha', when(1), [
  ticket('wlogin', 'Ship login', { refined: true, priority: 'high', due: day(10), tags: ['Auth'], details: 'Sign in with **email** and a code.', acceptance: '- [ ] Works offline\n- [ ] Locks after five tries',
    tasks: [{ id: 'tform', title: 'Build form', state: 'todo' }, { id: 'tapi', title: 'Wire API', state: 'done', done: true, completed: when(5) }] }),
  ticket('wcrash', 'Crash on start', { type: 'bug', refined: true, priority: 'high', due: day(3), details: 'It crashes on a cold start.' }),
  ticket('wdb', 'Pick a database', { type: 'spike', refined: true, priority: 'medium' }),
  ticket('wdark', 'Dark mode', { refined: true, priority: 'low' }),
  ticket('wdocs', 'Write docs', { priority: 'medium' }),
  ticket('wname', 'Rename app'),
  ticket('wtypo', 'Fix typo', { type: 'bug', state: 'doing', due: day(-2), cycles: [{ start: when(20), end: null, fresh: true }] }),
  ticket('wnotes', 'Release notes', { state: 'doing', due: day(1), cycles: [{ start: when(10), end: null, fresh: true }] }),
  ticket('wdone', 'Finished thing', { state: 'done', due: day(-5), completed: when(3), cycles: [{ start: when(28), end: when(3), fresh: true }] }),
]);
await write('beta', 'Beta', when(2), [ticket('wbeta', 'Beta ticket', { refined: true, priority: 'high' })]);
await write('empty', 'Empty', when(3), []);
const onDisk = async (slug, id) => { const board = JSON.parse(await readFile(path.join(repo, 'knowledge/work', `${slug}.json`), 'utf8')); return id ? board.items.find(item => item.id === id) : board; };
const until = async (check, message, timeout = 5000) => {
  const end = Date.now() + timeout;
  for (;;) {
    try { if (await check()) return; } catch { /* not written yet */ }
    if (Date.now() > end) assert.fail(message);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
};
const copy = locator => locator.evaluate(element => { const clone = element.cloneNode(true); clone.querySelectorAll('select, input, textarea, .jh-wb-tag').forEach(node => node.remove()); document.body.append(clone); const text = clone.innerText; clone.remove(); return text; });

const service = await createService({ repo, stateDir, uiDir: path.join(root, 'dist'), mcpOptions: { home: temp, env: {} } });
const browser = await chromium.launch({ channel: 'msedge' });
const problems = [], failed = [];
try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  page.on('pageerror', error => problems.push(error.message));
  // A failed request is logged by the browser as a console error without its address, so requests are checked on their own below.
  page.on('response', response => { if (response.status() >= 400) failed.push(`${response.status()} ${response.request().method()} ${new URL(response.url()).pathname}`); });
  page.on('console', message => { if (message.type() === 'error' && !/Chat no longer exists|Failed to load resource/.test(message.text())) problems.push(message.text()); });
  await page.goto(`${service.urls.workspace}#/`);
  await page.waitForSelector('.jupiter-home');
  await page.locator('.jh-panel h2', { hasText: 'To do' }).click();
  const board = page.locator('.jh-wb.jh-wb-board');
  await board.waitFor();
  const panel = board.locator('.jh-wb-panel');
  const column = name => board.getByRole('region', { name, exact: true });
  const card = title => board.locator('[data-card]', { hasText: title }).first();
  const preview = title => card(title).getByRole('button', { name: `Preview ${title}`, exact: true });
  const section = name => panel.getByRole('region', { name, exact: true });
  const rows = name => section(name).locator('.jh-wb-ov-row .jh-wb-ov-title').allTextContents();
  const sheet = board.getByRole('dialog');
  const health = async () => ({ line: await section('Project health').locator('.jh-wb-health-line span').textContent(), percent: await section('Project health').locator('.jh-wb-health-line b').textContent(), stats: await section('Project health').locator('.jh-wb-health-stats > div').allTextContents() });
  const boardTitle = () => board.getByRole('textbox', { name: 'Board title' }).inputValue();
  await column('Backlog').locator('[data-card]').first().waitFor();
  const boxOf = locator => locator.boundingBox();
  // The window opens with a short animation, so measure once the board has stopped moving.
  const still = async () => { let last = ''; await until(async () => { const now = JSON.stringify(await boxOf(panel)); const same = now === last; last = now; return same; }, 'the board settles', 8000); };
  await page.waitForTimeout(300); await still();

  // Three columns and the panel beside them, not over them.
  assert.deepEqual(await board.locator('.jh-wb-col-head h3').allTextContents(), ['Backlog', 'In progress', 'Done'], 'exactly three workflow columns, no Testing');
  assert.equal(await board.getByRole('region', { name: 'Testing' }).count(), 0);
  const last = await boxOf(column('Done')), side = await boxOf(panel), first = await boxOf(column('Backlog'));
  assert.ok(side.x >= last.x + last.width, `the panel sits right of the columns (${side.x} after ${last.x + last.width})`);
  assert.ok(first.width > 180 && last.width > 180, 'the columns keep a usable width');
  assert.ok(Math.abs(side.width - first.width) <= 2 && Math.abs(last.width - first.width) <= 2, `the panel and the three columns share one width (${first.width}, ${last.width}, ${side.width})`);
  assert.equal(await panel.getAttribute('aria-label'), 'Project overview');

  // Overview: health, Next up, refinement queue, Due soon.
  await panel.getByRole('heading', { name: 'Project overview', level: 3 }).waitFor();
  assert.deepEqual(await health(), { line: '1 of 9 tickets done', percent: '11%', stats: ['In progress2', 'Backlog6', 'Needs refinement2'] });
  assert.equal(await section('Project health').getByRole('progressbar', { name: 'Tickets done' }).getAttribute('aria-valuenow'), '11');
  assert.deepEqual(await rows('Next up'), ['Crash on start', 'Ship login', 'Pick a database', 'Dark mode'], 'Ready Backlog tickets only, by priority then due date');
  assert.equal(await section('Next up').locator('.jh-wb-ov-count').textContent(), '4');
  assert.deepEqual(await rows('Refinement queue'), ['Write docs', 'Rename app'], 'the refinement queue is on the overview');
  assert.deepEqual(await rows('Due soon'), ['Fix typo', 'Release notes', 'Crash on start', 'Ship login'], 'by deadline; the finished ticket is left out');
  const dueText = await section('Due soon').locator('.jh-wb-due').allTextContents();
  assert.deepEqual(dueText, [`Overdue ${uk(-2)}`, `Due ${uk(1)}`, `Due ${uk(3)}`, `Due ${uk(10)}`]);
  assert.deepEqual(await section('Due soon').locator('.jh-wb-due').evaluateAll(chips => chips.map(chip => chip.classList.contains('is-late') ? 'late' : chip.classList.contains('is-soon') ? 'soon' : 'later')), ['late', 'soon', 'later', 'later'], 'overdue is flagged');
  assert.doesNotMatch(await copy(panel), /[-–—]/, 'no hyphens or dashes on screen');
  await page.screenshot({ path: path.join(shots, 'work-panel-overview.png') });

  // Selecting a ticket replaces the overview with its preview while the board stays visible.
  await section('Next up').getByRole('button', { name: 'Preview Crash on start' }).click();
  await panel.getByRole('heading', { name: 'Crash on start', level: 3 }).waitFor();
  assert.equal(await panel.getAttribute('aria-label'), 'Ticket inspector');
  assert.equal(await panel.getByRole('heading', { name: 'Project overview' }).count(), 0, 'the overview is replaced');
  assert.equal(await board.getByRole('dialog').count(), 0, 'no big editor');
  assert.ok(await card('Crash on start').evaluate(element => element.classList.contains('is-selected')), 'the selected card is marked');
  assert.equal(await preview('Crash on start').getAttribute('aria-pressed'), 'true');
  assert.equal(await column('Backlog').isVisible() && await column('In progress').isVisible() && await column('Done').isVisible(), true, 'the board stays visible');
  const insp = panel.locator('.jh-wb-insp');
  assert.equal(await insp.locator('.jh-wb-state').textContent(), 'Backlog');
  assert.equal(await insp.locator('.jh-wb-refine').textContent(), 'Ready', 'refinement status');
  assert.match(await insp.locator('.jh-wb-age-line').textContent(), /^Created \d\d\/\d\d\/\d{4} · not started yet$/);
  assert.equal(await insp.getByRole('region', { name: 'Details' }).locator('.jh-wb-insp-md').textContent(), 'It crashes on a cold start.');
  assert.equal(await insp.getByRole('region', { name: 'Acceptance criteria' }).locator('.jh-wb-muted').textContent(), 'No acceptance criteria yet.');
  assert.deepEqual(await insp.getByRole('group', { name: 'Quick actions' }).getByRole('button').allTextContents(), ['Start work', 'Open full editor']);

  // Selecting another ticket updates the same panel: details, acceptance criteria, tasks, tags.
  await preview('Ship login').click();
  await panel.getByRole('heading', { name: 'Ship login', level: 3 }).waitFor();
  assert.equal(await panel.getByRole('heading', { name: 'Crash on start' }).count(), 0, 'one inspector, updated in place');
  assert.equal(await board.locator('.jh-wb-card.is-selected').count(), 1);
  assert.equal(await insp.getByRole('region', { name: 'Details' }).locator('strong').textContent(), 'email', 'details render as Markdown');
  assert.deepEqual((await insp.getByRole('region', { name: 'Acceptance criteria' }).locator('li').allTextContents()).map(text => text.trim()), ['Works offline', 'Locks after five tries']);
  assert.deepEqual(await insp.getByRole('list', { name: 'Tags' }).locator('li').allTextContents(), ['Auth']);
  const tasks = insp.getByRole('region', { name: 'Tasks' });
  assert.deepEqual(await tasks.locator('.jh-wb-task-title').allTextContents(), ['Build form', 'Wire API']);
  assert.equal(await tasks.locator('.jh-wb-progress').textContent(), '1/2');
  assert.equal(await tasks.getByRole('checkbox', { name: 'Done: Wire API' }).isChecked(), true);
  assert.doesNotMatch(await copy(panel), /[-–—]/, 'no hyphens or dashes in the inspector either');
  await page.screenshot({ path: path.join(shots, 'work-panel-inspector.png') });

  // Quick actions use the board's own workflow. A task checkbox follows the task rules (no time until it starts).
  await tasks.getByRole('checkbox', { name: 'Done: Build form' }).check();
  await until(async () => { const task = (await onDisk('alpha', 'wlogin')).tasks[0]; return task.state === 'done' && task.done && task.completed && task.cycles.length === 0; }, 'checking a task is saved, with no work cycle');
  assert.equal(await tasks.locator('.jh-wb-progress').textContent(), '2/2');
  await insp.getByRole('button', { name: 'Start work' }).click();
  await until(async () => { const item = await onDisk('alpha', 'wlogin'); return item.state === 'doing' && item.cycles.length === 1 && item.cycles[0].end === null; }, 'Start work moves it to In progress and starts a work cycle');
  await column('In progress').locator('[data-card]', { hasText: 'Ship login' }).waitFor();
  assert.deepEqual(await insp.getByRole('group', { name: 'Quick actions' }).getByRole('button').allTextContents(), ['Mark done', 'Back to Backlog', 'Open full editor']);
  assert.equal(await insp.locator('.jh-wb-state').textContent(), 'In progress');
  assert.equal(await insp.locator('.jh-wb-refine').count(), 0, 'the refinement badge is for Backlog only');
  assert.match(await insp.locator('.jh-wb-age-line').textContent(), /^Created \d\d\/\d\d\/\d{4} · in progress for 1 hour/);
  await insp.getByRole('button', { name: 'Back to Backlog' }).click();
  await until(async () => { const item = await onDisk('alpha', 'wlogin'); return item.state === 'todo' && item.cycles[0].end !== null; }, 'Back to Backlog pauses it');
  await insp.getByRole('button', { name: 'Start work' }).click();
  const ask = board.getByRole('alertdialog', { name: 'Resume work on this ticket?' });
  await ask.waitFor();
  await ask.getByRole('button', { name: /Continue previous tracking/ }).click();
  await until(async () => { const item = await onDisk('alpha', 'wlogin'); return item.state === 'doing' && item.cycles.length === 2 && !item.cycles[1].fresh; }, 'restarting asks the usual resume question');
  await insp.getByRole('button', { name: 'Mark done' }).click();
  await until(async () => (await onDisk('alpha', 'wlogin')).state === 'done', 'Mark done');
  assert.deepEqual(await insp.getByRole('group', { name: 'Quick actions' }).getByRole('button').allTextContents(), ['Reopen', 'Open full editor']);

  // Back to overview clears the selection; the figures follow the changes (done 2 of 9, one more ticket gone from Next up).
  await panel.getByRole('button', { name: 'Back to overview' }).click();
  await panel.getByRole('heading', { name: 'Project overview', level: 3 }).waitFor();
  assert.equal(await board.locator('.jh-wb-card.is-selected').count(), 0, 'no ticket stays selected');
  assert.equal(await preview('Ship login').getAttribute('aria-pressed'), 'false');
  await until(async () => await page.evaluate(() => document.activeElement?.getAttribute('aria-label')) === 'Preview Ship login', 'keyboard focus returns to the card');
  assert.deepEqual(await health(), { line: '2 of 9 tickets done', percent: '22%', stats: ['In progress2', 'Backlog5', 'Needs refinement2'] });
  assert.deepEqual(await rows('Next up'), ['Crash on start', 'Pick a database', 'Dark mode']);

  // Next up starts work straight from its list (then Dark mode goes back to Backlog so the figures below stay as they were).
  await section('Next up').getByRole('button', { name: 'Start work on Dark mode' }).click();
  await until(async () => { const item = await onDisk('alpha', 'wdark'); return item.state === 'doing' && item.cycles.length === 1 && item.cycles[0].end === null; }, 'Start in Next up moves the ticket to In progress and starts a work cycle');
  assert.deepEqual(await rows('Next up'), ['Crash on start', 'Pick a database'], 'a started ticket leaves Next up');
  assert.deepEqual((await health()).stats, ['In progress3', 'Backlog4', 'Needs refinement2']);
  await preview('Dark mode').click();
  await insp.getByRole('button', { name: 'Back to Backlog' }).click();
  await until(async () => (await onDisk('alpha', 'wdark')).state === 'todo', 'Dark mode is back in Backlog');
  await panel.getByRole('button', { name: 'Back to overview' }).click();
  assert.deepEqual(await rows('Next up'), ['Crash on start', 'Pick a database', 'Dark mode']);

  // An unrefined ticket offers Mark as refined, not Start work; refining it moves it into Next up.
  await section('Refinement queue').getByRole('button', { name: 'Preview Write docs' }).click();
  assert.equal(await insp.locator('.jh-wb-refine').textContent(), 'Needs refinement');
  assert.deepEqual(await insp.getByRole('group', { name: 'Quick actions' }).getByRole('button').allTextContents(), ['Mark as refined', 'Open full editor']);
  await insp.getByRole('button', { name: 'Mark as refined' }).click();
  await until(async () => (await onDisk('alpha', 'wdocs')).refined === true, 'Mark as refined is saved as the ticket own property');
  assert.equal(await insp.locator('.jh-wb-refine').textContent(), 'Ready');
  assert.equal(await insp.getByRole('button', { name: 'Start work' }).count(), 1);

  // Open full editor: the big editor opens over the board; edits show in the preview; Escape closes only the editor.
  await insp.getByRole('button', { name: 'Open full editor' }).click();
  await sheet.waitFor();
  assert.equal(await sheet.getByRole('textbox', { name: 'Item title' }).inputValue(), 'Write docs');
  await sheet.getByRole('combobox', { name: 'Priority' }).selectOption('high');
  await sheet.getByRole('textbox', { name: 'Item title' }).fill('Write the docs');
  await until(async () => (await onDisk('alpha', 'wdocs')).title === 'Write the docs', 'the edit is saved');
  await sheet.locator('.jh-wb-sheet-head .jh-wb-status').click();
  await page.keyboard.press('Escape');
  await sheet.waitFor({ state: 'detached' });
  assert.equal(await board.count(), 1, 'Escape closed the editor only');
  await panel.getByRole('heading', { name: 'Write the docs', level: 3 }).waitFor();
  assert.equal(await panel.getByRole('img', { name: 'High priority' }).count(), 1, 'the preview reflects the edit');
  // Escape inside the panel goes back to the overview and leaves the board open.
  await insp.getByRole('button', { name: 'Open full editor' }).focus();
  await page.keyboard.press('Escape');
  await panel.getByRole('heading', { name: 'Project overview', level: 3 }).waitFor();
  assert.equal(await board.count(), 1);

  // A new ticket appears in the figures at once.
  await column('Backlog').getByRole('button', { name: 'Add item' }).click();
  await column('Backlog').getByRole('textbox', { name: 'New item title' }).fill('Brand new');
  await column('Backlog').getByRole('textbox', { name: 'New item title' }).press('Enter');
  await column('Backlog').getByRole('textbox', { name: 'New item title' }).press('Escape');
  assert.deepEqual(await health(), { line: '2 of 10 tickets done', percent: '20%', stats: ['In progress2', 'Backlog6', 'Needs refinement2'] });
  assert.ok((await rows('Refinement queue')).includes('Brand new'));

  // Collapse and expand: the board gains the room, focus stays on the control, and it works from the keyboard.
  const before = await boxOf(column('Backlog'));
  const toggle = panel.getByRole('button', { name: 'Collapse panel' });
  assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
  await toggle.click();
  const rail = panel.getByRole('button', { name: 'Expand panel' });
  assert.equal(await rail.getAttribute('aria-expanded'), 'false');
  await until(async () => (await boxOf(panel)).width < 60, 'the panel collapses to a slim rail');
  assert.ok((await boxOf(column('Backlog'))).width > before.width, 'the columns grow into the space');
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Expand panel', 'focus stays on the toggle');
  assert.equal(await panel.locator('.jh-wb-panel-body').count(), 0, 'nothing of the panel is left to tab through');
  await page.screenshot({ path: path.join(shots, 'work-panel-collapsed.png') });
  await page.keyboard.press('Enter');
  await panel.getByRole('button', { name: 'Collapse panel' }).waitFor();
  await until(async () => (await boxOf(panel)).width > 250, 'Enter expands it again');
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Collapse panel');
  await page.keyboard.press('Space');
  await panel.getByRole('button', { name: 'Expand panel' }).waitFor();
  // Selecting a ticket while it is collapsed opens the panel on that ticket.
  await preview('Dark mode').click();
  await panel.getByRole('heading', { name: 'Dark mode', level: 3 }).waitFor();
  await until(async () => (await boxOf(panel)).width > 250, 'selecting expands the collapsed panel');
  // The choice is remembered on this device.
  await panel.getByRole('button', { name: 'Collapse panel' }).click();
  assert.equal(await page.evaluate(() => localStorage.getItem('jupiter.work.panel')), 'closed');
  await panel.getByRole('button', { name: 'Expand panel' }).click();
  await panel.getByRole('button', { name: 'Back to overview' }).click();

  // Switching project never keeps another project's selection; an empty project has a sensible overview.
  await preview('Pick a database').click();
  await panel.getByRole('heading', { name: 'Pick a database', level: 3 }).waitFor();
  const picker = board.getByRole('button', { name: 'Switch board' });
  const menu = board.getByRole('menu', { name: 'Boards' });
  const pick = async name => { await picker.click(); await menu.getByRole('menuitem', { name: new RegExp(`^${name}`) }).click(); await menu.waitFor({ state: 'detached' }); };
  await pick('Beta');
  await until(async () => await boardTitle() === 'Beta', 'Beta opens');
  await panel.getByRole('heading', { name: 'Project overview', level: 3 }).waitFor();
  assert.equal(await board.locator('.jh-wb-card.is-selected').count(), 0);
  assert.deepEqual(await health(), { line: '0 of 1 ticket done', percent: '0%', stats: ['In progress0', 'Backlog1', 'Needs refinement0'] });
  assert.deepEqual(await rows('Next up'), ['Beta ticket']);
  assert.equal(await section('Refinement queue').locator('.jh-wb-muted').textContent(), 'Every Backlog ticket is ready.');
  await preview('Beta ticket').click();
  await panel.getByRole('heading', { name: 'Beta ticket', level: 3 }).waitFor();
  await pick('Empty');
  await until(async () => await boardTitle() === 'Empty', 'Empty opens');
  await panel.getByRole('heading', { name: 'Project overview', level: 3 }).waitFor();
  assert.equal(await section('Project health').locator('.jh-wb-muted').textContent(), 'No tickets yet. Add a feature, bug or spike to the Backlog and its progress shows here.');
  assert.equal(await section('Next up').locator('.jh-wb-muted').textContent(), 'The Backlog is empty.');
  assert.equal(await section('Refinement queue').locator('.jh-wb-muted').textContent(), 'Nothing is waiting to be refined.');
  assert.equal(await section('Due soon').locator('.jh-wb-muted').textContent(), 'No upcoming deadlines. Give a ticket a due date and it shows here.');
  assert.equal(await section('Project health').getByRole('progressbar').count(), 0);
  await page.screenshot({ path: path.join(shots, 'work-panel-empty.png') });
  await pick('Alpha');
  await until(async () => await boardTitle() === 'Alpha', 'Alpha opens');
  assert.equal(await board.locator('.jh-wb-card.is-selected').count(), 0, 'coming back to a project starts at the overview');
  await panel.getByRole('heading', { name: 'Project overview', level: 3 }).waitFor();

  // A narrow window (the board is about 580px wide with the chats open): the panel moves under the columns and nothing overflows the window sideways.
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.waitForTimeout(400);
  const narrowBoard = await boxOf(board), narrowPanel = await boxOf(panel), narrowColumns = await boxOf(board.locator('.jh-wb-columns'));
  assert.ok(narrowPanel.y >= narrowColumns.y + narrowColumns.height - 1, `the panel is under the columns (${narrowPanel.y} below ${narrowColumns.y + narrowColumns.height})`);
  assert.ok(narrowPanel.x >= narrowBoard.x - 1 && narrowPanel.x + narrowPanel.width <= narrowBoard.x + narrowBoard.width + 1, 'the panel fits the board width');
  assert.ok(narrowColumns.height >= 200, `the columns keep room (${narrowColumns.height}px)`);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no sideways scrolling of the page');
  await page.screenshot({ path: path.join(shots, 'work-panel-narrow-overview.png') });
  await preview('Pick a database').click();
  await panel.getByRole('heading', { name: 'Pick a database', level: 3 }).waitFor();
  await page.screenshot({ path: path.join(shots, 'work-panel-narrow-inspector.png') });
  await panel.getByRole('button', { name: 'Collapse panel' }).click();
  await until(async () => (await boxOf(panel)).height < 70, 'collapsed, the panel is a slim bar under the columns');
  const bar = await boxOf(panel);
  assert.ok((await boxOf(board.locator('.jh-wb-columns'))).height > narrowColumns.height, 'the columns take the room back');
  assert.ok(bar.width >= narrowBoard.width - 40, 'a full width bar');
  await page.screenshot({ path: path.join(shots, 'work-panel-narrow-collapsed.png') });

  assert.deepEqual(problems, [], 'no console errors');
  // This test service has no fonts folder, mobile app, logo file or voice keys, so those requests answer 400 on the dashboard alone;
  // nothing from the work board (the /api/work routes) may fail.
  assert.deepEqual([...new Set(failed)].filter(entry => !/ (\/fonts\/fonts\.css|\/mobile\/api\/bootstrap|\/assets\/jupiter\.png|\/api\/voice\/(say|greet))$/.test(entry)), [], 'no failed requests besides the test service\'s known gaps');
  console.log(`Work board side panel passed: overview figures and ordering, inspector, quick actions, collapse, keyboard, project switching, narrow window. Screenshots: ${shots}`);
} finally {
  await browser.close();
  await service.close();
}
