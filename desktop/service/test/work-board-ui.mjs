// Work board: columns, features, bugs and spikes, child tasks, drag between columns, Markdown details
// (toolbar only while editing, highlighted code blocks), expandable tasks, priority, UK dates, tags,
// ages, type and tag filters, the week and month calendar, the board menu, deleting boards with undo
// and the empty state when no board is left.
// Opens the dashboard's To do panel, so it needs WorkBoard wired into the dashboard and a fresh
// `npx vite build`. JUPITER_WORK_HARNESS=<folder> serves a page from that folder that mounts
// WorkBoard directly instead (used while the dashboard wiring is in progress).
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createService } from '../server.mjs';

const root = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const harness = process.env.JUPITER_WORK_HARNESS;
const temp = await mkdtemp(path.join(os.tmpdir(), 'jupiter-work-ui-'));
const repo = path.join(temp, 'repo'), stateDir = path.join(repo, '.state'), shots = path.join(root, '.cache', path.basename(temp));
for (const folder of [repo, stateDir, shots, path.join(repo, 'knowledge')]) await mkdir(folder, { recursive: true });
for (const file of ['workspace/workspace.json', 'workspace/_shared']) await cp(path.join(root, file), path.join(repo, file), { recursive: true });
await writeFile(path.join(repo, 'knowledge/todo.md'), '# To do\n\n- [ ] Old list item\n- [x] Finished thing\n');
// On screen copy only: user data (project titles, typed values, tags) is left out.
const copy = locator => locator.evaluate(element => { const clone = element.cloneNode(true); clone.querySelectorAll('select, input, textarea, .jh-wb-chip, .jh-wb-tag, .jh-wb-tagchip').forEach(node => node.remove()); document.body.append(clone); const text = clone.innerText; clone.remove(); return text; });
const saved = async slug => JSON.parse(await readFile(path.join(repo, 'knowledge/work', `${slug}.json`), 'utf8'));
const savedItem = async title => (await saved('my-board')).items.find(item => item.title === title);
const until = async (check, message, timeout = 5000) => {
  const end = Date.now() + timeout;
  for (;;) {
    try { if (await check()) return; } catch { /* not written yet */ }
    if (Date.now() > end) assert.fail(message);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
};
const localDate = offset => { const date = new Date(); date.setDate(date.getDate() + offset); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; };
const ukLocal = offset => localDate(offset).split('-').reverse().join('/');
const UK = String.raw`\d{2}/\d{2}/\d{4}`;
const trash = async () => { try { return (await readdir(path.join(repo, 'knowledge/work/.deleted'))).sort(); } catch { return []; } };

const service = await createService({ repo, stateDir, uiDir: harness || path.join(root, 'dist'), mcpOptions: { home: temp, env: {} } });
const browser = await chromium.launch({ channel: 'msedge' });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  page.on('pageerror', error => errors.push(error.message));
  // The test service has no fonts folder, mobile app or voice keys, so those requests answer 400 whatever the board does.
  page.on('console', message => { if (message.type() === 'error' && !/Failed to load resource/.test(message.text())) errors.push(message.text()); });
  await page.goto(`${service.urls.workspace}#/`);
  if (!harness) {
    await page.waitForSelector('.jupiter-home');
    await page.locator('.jh-panel h2', { hasText: 'To do' }).click();
  }
  const board = page.locator('.jh-wb.jh-wb-board');
  await board.waitFor();
  const frame = harness ? board : page.locator('.jh-focus');

  // Three fixed columns (Backlog, In progress, Done), seeded from the old todo.md on first run (as features).
  const column = name => board.getByRole('region', { name, exact: true });
  const counts = () => board.locator('.jh-wb-count').allTextContents();
  // Clicking a card previews it in the side panel; the full editor opens from the panel's Open full editor button.
  const panel = board.locator('.jh-wb-panel');
  const openEditor = async title => { await board.locator('[data-card]', { hasText: title }).first().getByRole('button', { name: `Preview ${title}`, exact: true }).click(); await panel.getByRole('button', { name: 'Open full editor' }).click(); };
  assert.deepEqual(await board.locator('.jh-wb-col-head h3').allTextContents(), ['Backlog', 'In progress', 'Done']);
  await column('Backlog').locator('[data-card]').first().waitFor();
  assert.deepEqual(await counts(), ['1', '0/3', '1'], 'In progress shows its default limit of 3');
  assert.equal(await board.locator('[data-card] .jh-wb-type.is-feature').count(), 2, 'old list items are features');
  const picker = board.getByRole('button', { name: 'Switch board' });
  assert.equal(await picker.innerText(), 'My board', 'the board picker shows the board title');
  assert.equal(await picker.getAttribute('aria-haspopup'), 'menu');
  assert.doesNotMatch(await copy(board), /[-–—]/, 'no hyphens or dashes on screen');

  // Focus is a subtle border and glow, not an outline.
  await board.getByRole('textbox', { name: 'Board title' }).focus();
  const focusStyle = await board.getByRole('textbox', { name: 'Board title' }).evaluate(element => { const style = getComputedStyle(element); return { outline: style.outlineStyle, shadow: style.boxShadow, border: style.borderTopColor }; });
  assert.equal(focusStyle.outline, 'none');
  assert.match(focusStyle.shadow, /rgba\(127, 227, 255, 0\.12\)/);
  assert.match(focusStyle.border, /rgba\(127, 227, 255, 0\.55\)/);

  // Add a feature (the default type), then a bug and a spike. There is no top level Task type.
  const addItem = async (name, type, title) => {
    await column(name).getByRole('button', { name: 'Add item' }).click();
    const group = column(name).getByRole('group', { name: 'Item type' });
    assert.deepEqual(await group.getByRole('button').allTextContents(), ['Feature', 'Bug', 'Spike']);
    await group.getByRole('button', { name: type }).click(); // each column remembers its last type
    assert.equal(await group.getByRole('button', { name: type, pressed: true }).count(), 1);
    await column(name).getByRole('textbox', { name: 'New item title' }).fill(title);
    await column(name).getByRole('textbox', { name: 'New item title' }).press('Enter');
    await column(name).getByRole('textbox', { name: 'New item title' }).press('Escape');
    return column(name).locator('[data-card]', { hasText: title });
  };
  const feature = await addItem('Backlog', 'Feature', 'Launch menus');
  await feature.waitFor();
  assert.equal(await column('Backlog').locator('[data-card]').first().textContent().then(text => text.includes('Launch menus')), true, 'new items go to the top');
  assert.equal(await feature.locator('.jh-wb-type.is-feature').count(), 1);
  const bug = await addItem('Backlog', 'Bug', 'Crash on load');
  assert.equal(await bug.locator('.jh-wb-type.is-bug').count(), 1);
  const spike = await addItem('In progress', 'Spike', 'Pathing research');
  assert.equal(await spike.locator('.jh-wb-type.is-spike').count(), 1);
  await until(async () => (await savedItem('Crash on load'))?.type === 'bug' && (await savedItem('Pathing research'))?.type === 'spike' && (await savedItem('Launch menus'))?.type === 'feature', 'the feature, bug and spike are saved');

  // A task under the feature, then check it: 0/1 becomes 1/1 and the task is Done.
  await feature.getByRole('button', { name: 'Show tasks' }).click();
  await feature.getByRole('button', { name: 'Add task' }).click();
  await feature.getByRole('textbox', { name: 'New task title' }).fill('Main menu');
  await feature.getByRole('textbox', { name: 'New task title' }).press('Enter');
  await feature.getByRole('textbox', { name: 'New task title' }).press('Escape');
  assert.equal(await feature.locator('.jh-wb-progress').textContent(), '0/1');
  await feature.locator('.jh-wb-check').first().click();
  assert.equal(await feature.locator('.jh-wb-progress').textContent(), '1/1');
  await until(async () => { const task = (await savedItem('Launch menus')).tasks[0]; return task?.done === true && task.state === 'done' && task.completed; }, 'the checked task is saved as Done');
  await feature.locator('.jh-wb-check').first().click();
  await until(async () => { const task = (await savedItem('Launch menus')).tasks[0]; return task.done === false && task.state === 'todo' && task.completed === null; }, 'unchecking puts the task back in To do');

  // Drag the card from To do to In progress with the mouse; the card follows the pointer.
  const from = await feature.locator('.jh-wb-card-head').boundingBox();
  const target = await column('In progress').boundingBox();
  await page.mouse.move(from.x + from.width - 30, from.y + 8);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width, from.y + 20, { steps: 4 });
  await page.mouse.move(target.x + target.width / 2, target.y + 120, { steps: 12 });
  await page.locator('.jh-wb-lift').waitFor();
  assert.ok(await column('In progress').evaluate(element => element.classList.contains('is-target')), 'the target column glows');
  const lifted = await page.locator('.jh-wb-lift').boundingBox();
  assert.ok(Math.abs(lifted.x + lifted.width / 2 - (target.x + target.width / 2)) < from.width, 'the lifted card is under the pointer');
  await page.screenshot({ path: path.join(shots, 'dragging.png') });
  await page.mouse.up();
  const moved = column('In progress').locator('[data-card]', { hasText: 'Launch menus' });
  await moved.waitFor();
  assert.equal(await column('Backlog').locator('[data-card]', { hasText: 'Launch menus' }).count(), 0);
  await until(async () => (await savedItem('Launch menus')).state === 'doing', 'the new state is saved');
  await until(async () => { const cycles = (await savedItem('Launch menus')).cycles; return cycles.length === 1 && cycles[0].end === null; }, 'entering In progress starts a work cycle');
  assert.equal((await savedItem('Crash on load')).cycles.length, 0, 'a Backlog item has no work cycle');

  // Refinement: new items need it; Refined in the sheet marks one Ready; the Backlog filter splits them.
  assert.equal(await bug.locator('.jh-wb-refine').textContent(), 'Needs refinement');
  assert.equal(await moved.locator('.jh-wb-refine').count(), 0, 'the badge is for Backlog only');
  await openEditor('Crash on load');
  const refineSheet = board.getByRole('dialog', { name: 'Details for Crash on load' });
  await refineSheet.getByRole('checkbox', { name: 'Refined' }).check();
  await until(async () => (await savedItem('Crash on load')).refined === true, 'Refined is saved as the item\'s own property');
  assert.ok(!(await savedItem('Crash on load')).tags.some(tag => /refine/i.test(tag)), 'not as a tag');
  await refineSheet.getByRole('button', { name: 'Close details' }).click();
  assert.equal(await bug.locator('.jh-wb-refine').textContent(), 'Ready');
  const refineFilter = column('Backlog').getByRole('group', { name: 'Show in Backlog' });
  assert.deepEqual(await refineFilter.getByRole('button').allTextContents(), ['All', 'Needs refinement', 'Ready']);
  await refineFilter.getByRole('button', { name: 'Ready' }).click();
  assert.deepEqual(await column('Backlog').locator('[data-card] .jh-wb-card-title').allTextContents(), ['Crash on load']);
  await refineFilter.getByRole('button', { name: 'Needs refinement' }).click();
  assert.equal(await column('Backlog').locator('[data-card]', { hasText: 'Crash on load' }).count(), 0);
  await refineFilter.getByRole('button', { name: 'All' }).click();

  // Back to Backlog pauses the cycle; back into In progress asks whether to continue or start again.
  await openEditor('Launch menus');
  const moveSheet = board.getByRole('dialog', { name: 'Details for Launch menus' });
  await moveSheet.getByRole('combobox', { name: 'State' }).selectOption('todo');
  await until(async () => { const item = await savedItem('Launch menus'); return item.state === 'todo' && item.cycles[0].end !== null; }, 'Backlog ends the cycle');
  await moveSheet.getByRole('combobox', { name: 'State' }).selectOption('doing');
  const resumeAsk = board.getByRole('alertdialog', { name: 'Resume work on this ticket?' });
  await resumeAsk.waitFor();
  assert.match(await resumeAsk.innerText(), /This ticket was previously in progress for \d+ hours?\. How would you like to track it\?/);
  await resumeAsk.getByRole('button', { name: 'Cancel' }).click();
  await resumeAsk.waitFor({ state: 'detached' });
  assert.equal(await moveSheet.getByRole('combobox', { name: 'State' }).inputValue(), 'todo', 'Cancel leaves it where it was');
  assert.equal((await savedItem('Launch menus')).cycles.length, 1, 'and starts no cycle');
  await moveSheet.getByRole('combobox', { name: 'State' }).selectOption('doing');
  await resumeAsk.getByRole('button', { name: /Continue previous tracking/ }).click();
  await until(async () => { const item = await savedItem('Launch menus'); return item.state === 'doing' && item.cycles.length === 2 && !item.cycles[1].fresh; }, 'Continue adds a cycle to the same count');
  await moveSheet.getByRole('combobox', { name: 'State' }).selectOption('todo');
  await until(async () => (await savedItem('Launch menus')).state === 'todo', 'back in Backlog');
  await moveSheet.getByRole('combobox', { name: 'State' }).selectOption('doing');
  await resumeAsk.getByRole('button', { name: /Start a new work cycle/ }).click();
  await until(async () => { const item = await savedItem('Launch menus'); return item.cycles.length === 3 && item.cycles[2].fresh === true; }, 'a new work cycle starts a new count and keeps the old cycles');
  assert.deepEqual((await savedItem('Launch menus')).history.map(move => move.to), ['doing', 'todo', 'doing', 'todo', 'doing'], 'every move is kept');
  await moveSheet.getByRole('button', { name: 'Close details' }).click();
  await moveSheet.waitFor({ state: 'detached' });

  // Details sheet: bigger, with Markdown fields.
  await openEditor('Launch menus');
  const sheet = board.getByRole('dialog');
  await sheet.waitFor();
  await page.waitForTimeout(350); // let the sheet finish rising
  const boardBox = await board.boundingBox(), sheetBox = await sheet.boundingBox();
  assert.ok(Math.abs(sheetBox.width - Math.min(1100, boardBox.width * 0.92)) < 3, `the sheet is wide (${sheetBox.width} of ${boardBox.width})`);
  assert.equal(await sheet.getByRole('combobox', { name: 'State' }).inputValue(), 'doing');
  assert.deepEqual(await sheet.getByRole('combobox', { name: 'Type' }).locator('option').allTextContents(), ['Feature', 'Bug', 'Spike']);
  assert.equal(await sheet.getByRole('combobox', { name: 'Item project' }).count(), 0, 'items have tags, not a project');

  // Acceptance criteria: click the empty preview to edit.
  // The formatting toolbar only appears while a field is being edited.
  const acceptance = sheet.getByRole('group', { name: 'Acceptance criteria', exact: true });
  assert.equal(await sheet.getByRole('toolbar').count(), 0, 'no formatting toolbar until a field is edited');
  await acceptance.locator('.jh-wb-md-view').click();
  await acceptance.getByRole('toolbar', { name: 'Acceptance criteria formatting' }).waitFor();
  assert.equal(await sheet.getByRole('toolbar').count(), 1, 'only the field being edited shows its toolbar');
  await acceptance.getByRole('textbox', { name: 'Acceptance criteria' }).fill('Opens in under a second');
  await sheet.locator('.jh-wb-status', { hasText: 'Saved' }).waitFor();
  await until(async () => (await savedItem('Launch menus')).acceptance === 'Opens in under a second', 'acceptance criteria are saved');
  assert.match(await readFile(path.join(repo, 'knowledge/work/my-board.md'), 'utf8'), /Acceptance criteria\*\*\n\nOpens in under a second/);

  // Details: toolbar Bold wraps the selection, Bullets starts a list line; Preview renders them.
  const details = sheet.getByRole('group', { name: 'Details', exact: true });
  assert.equal(await details.getByRole('toolbar').count(), 0);
  await details.locator('.jh-wb-md-view').click();
  assert.deepEqual(await details.getByRole('toolbar').getByRole('button').evaluateAll(buttons => buttons.filter(button => button.classList.contains('jh-wb-md-tool')).map(button => button.getAttribute('aria-label'))),
    ['Bold', 'Italic', 'Strikethrough', 'Heading', 'Bullets', 'Numbers', 'Checklist', 'Code', 'Code block', 'Link', 'Quote']);
  assert.equal(await acceptance.getByRole('toolbar').count(), 0, 'leaving a field hides its toolbar');
  assert.equal(await acceptance.getByRole('textbox').count(), 0, 'and shows its preview');
  const detailsBox = details.getByRole('textbox', { name: 'Details' });
  await detailsBox.fill('Ship menus');
  await detailsBox.selectText();
  await details.getByRole('button', { name: 'Bold' }).click();
  assert.equal(await detailsBox.inputValue(), '**Ship menus**');
  await detailsBox.press('End');
  await detailsBox.press('Enter');
  await details.getByRole('button', { name: 'Bullets' }).click();
  await page.keyboard.type('First point');
  assert.equal(await detailsBox.inputValue(), '**Ship menus**\n- First point');
  // Enter carries the list on; Enter on the empty item ends it.
  await page.keyboard.press('Enter');
  assert.equal(await detailsBox.inputValue(), '**Ship menus**\n- First point\n- ', 'Enter adds the next bullet');
  await page.keyboard.press('Enter');
  assert.equal(await detailsBox.inputValue(), '**Ship menus**\n- First point\n', 'Enter on an empty bullet ends the list');
  // Strikethrough on a selected line, a numbered list, a code block and a link.
  await page.keyboard.press('Enter');
  await page.keyboard.type('Old plan');
  await page.keyboard.press('Shift+Home');
  await details.getByRole('button', { name: 'Strikethrough' }).click();
  await page.keyboard.press('End'); await page.keyboard.press('Enter'); await page.keyboard.press('Enter');
  await details.getByRole('button', { name: 'Numbers' }).click();
  await page.keyboard.type('Step one');
  await page.keyboard.press('Enter'); await page.keyboard.press('Enter'); await page.keyboard.press('Enter');
  await details.getByRole('button', { name: 'Code block' }).click();
  await page.keyboard.type('npm run build');
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('End');
  await page.keyboard.press('Enter'); await page.keyboard.press('Enter');
  await details.getByRole('button', { name: 'Link' }).click();
  await page.keyboard.type('https://example.com');
  // A fenced JSON block is highlighted by language.
  const json = '{"name": "Jupiter", "count": 2, "ok": true}';
  await page.keyboard.press('End'); await page.keyboard.press('Enter'); await page.keyboard.press('Enter');
  await page.keyboard.type('```json'); await page.keyboard.press('Enter');
  await page.keyboard.type(json); await page.keyboard.press('Enter');
  await page.keyboard.type('```');
  const markdown = `**Ship menus**\n- First point\n\n~~Old plan~~\n\n1. Step one\n\n\`\`\`\nnpm run build\n\`\`\`\n\n[link text](https://example.com)\n\n\`\`\`json\n${json}\n\`\`\``;
  assert.equal(await detailsBox.inputValue(), markdown);
  await details.getByRole('button', { name: 'Preview', exact: true }).click();
  assert.equal(await details.getByRole('toolbar').count(), 0, 'Preview hides the toolbar');
  const view = details.locator('.jh-wb-md-view');
  assert.equal(await view.locator('strong').textContent(), 'Ship menus');
  assert.equal(await view.locator('ul > li').textContent(), 'First point');
  assert.equal(await view.locator('del').textContent(), 'Old plan');
  assert.equal(await view.locator('ol > li').textContent(), 'Step one');
  const blocks = view.locator('.jh-wb-code');
  assert.equal(await blocks.count(), 2);
  assert.equal(await blocks.nth(0).locator('pre > code').textContent(), 'npm run build');
  assert.equal(await blocks.nth(0).locator('.jh-wb-code-lang').count(), 0, 'a block without a language has no label');
  const jsonBlock = blocks.nth(1);
  assert.equal(await jsonBlock.locator('.jh-wb-code-lang').textContent(), 'json');
  assert.equal(await jsonBlock.locator('pre > code').getAttribute('class'), 'hljs language-json');
  assert.equal(await jsonBlock.locator('pre > code').textContent(), json);
  assert.deepEqual(await jsonBlock.locator('.hljs-attr').allTextContents(), ['"name"', '"count"', '"ok"']);
  assert.deepEqual([await jsonBlock.locator('.hljs-string').textContent(), await jsonBlock.locator('.hljs-number').textContent(), await jsonBlock.locator('.hljs-literal').textContent()], ['"Jupiter"', '2', 'true']);
  const tokenColours = await jsonBlock.evaluate(element => ['attr', 'string', 'number', 'literal'].map(name => getComputedStyle(element.querySelector(`.hljs-${name}`)).color));
  assert.deepEqual(tokenColours, ['rgb(127, 227, 255)', 'rgb(111, 240, 176)', 'rgb(255, 191, 94)', 'rgb(255, 191, 94)'], 'tokens use the app colours');
  const labelBox = await jsonBlock.locator('.jh-wb-code-head').boundingBox(), blockBox = await jsonBlock.boundingBox();
  assert.ok(labelBox.x + labelBox.width > blockBox.x + blockBox.width - 16 && labelBox.y < blockBox.y + 12, 'the label and Copy sit in the top right');
  // Copy copies the raw code (the clipboard is stubbed) and does not open the editor.
  await page.evaluate(() => { window.copied = null; Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.copied = text; } } }); });
  await jsonBlock.getByRole('button', { name: 'Copy code' }).click();
  await jsonBlock.getByRole('button', { name: 'Copied' }).waitFor();
  assert.equal(await page.evaluate(() => window.copied), json);
  assert.equal(await details.getByRole('textbox').count(), 0, 'Copy leaves the preview showing');
  assert.equal(await details.getByRole('toolbar').count(), 0);
  await jsonBlock.scrollIntoViewIfNeeded();
  await jsonBlock.screenshot({ path: path.join(shots, 'code-block.png') });
  const link = view.locator('a');
  assert.deepEqual([await link.textContent(), await link.getAttribute('href'), await link.getAttribute('target'), await link.getAttribute('rel')], ['link text', 'https://example.com', '_blank', 'noreferrer']);
  await until(async () => (await savedItem('Launch menus')).details === markdown, 'Markdown details are saved');

  // Priority and due date (tomorrow, so the card shows it in amber).
  await sheet.getByRole('combobox', { name: 'Priority' }).selectOption('high');
  // Due dates are typed and shown as DD/MM/YYYY; something that is not a date is put back.
  const dueBox = sheet.getByRole('textbox', { name: 'Due date' });
  assert.equal(await dueBox.getAttribute('placeholder'), 'DD/MM/YYYY');
  await dueBox.fill(ukLocal(1));
  await dueBox.press('Enter');
  await until(async () => { const item = await savedItem('Launch menus'); return item.priority === 'high' && item.due === localDate(1); }, 'priority and due date are saved');
  assert.equal(await dueBox.inputValue(), ukLocal(1));
  await dueBox.fill('31/02/2026');
  await dueBox.press('Enter');
  assert.equal(await dueBox.inputValue(), ukLocal(1), 'an impossible date is put back');
  assert.equal((await savedItem('Launch menus')).due, localDate(1));

  // Tags: type and Enter creates; × removes; typing suggests existing board tags.
  const tagInput = sheet.getByRole('textbox', { name: 'Add tag' });
  for (const name of ['UI', 'Launch', 'Art']) { await tagInput.fill(name); await tagInput.press('Enter'); }
  await sheet.getByRole('button', { name: 'Remove tag Art' }).click();
  await until(async () => JSON.stringify((await savedItem('Launch menus')).tags) === '["UI","Launch"]', 'a removed tag is saved');
  await tagInput.fill('ar');
  await sheet.getByRole('listbox', { name: 'Tag suggestions' }).getByRole('option', { name: 'Art' }).click();
  await tagInput.fill('Menus'); await tagInput.press('Enter');
  await until(async () => JSON.stringify((await savedItem('Launch menus')).tags) === '["UI","Launch","Art","Menus"]', 'tags are saved in order');
  const boardTags = (await saved('my-board')).tags;
  assert.deepEqual(boardTags.map(tag => tag.name), ['UI', 'Launch', 'Art', 'Menus']);
  assert.equal(new Set(boardTags.map(tag => tag.color)).size, 4, 'each new tag gets its own colour');
  assert.match(await readFile(path.join(repo, 'knowledge/work/my-board.md'), 'utf8'), /tags UI, Launch, Art, Menus/);

  // Expand a task in the sheet and edit its own state and details.
  await sheet.getByRole('button', { name: 'Main menu', exact: true }).click();
  const task = sheet.locator('[data-task]', { hasText: 'Main menu' });
  // A task that has not started shows when it was created, never an in flight time (the parent has been In progress for a while).
  assert.equal(await task.locator('.jh-wb-age-line').textContent(), `Created ${ukLocal(0)} · not started yet`, 'an unstarted task is not in flight');
  assert.deepEqual((await savedItem('Launch menus')).tasks[0].cycles, [], 'and has no work cycle');
  await task.getByRole('combobox', { name: 'Task state' }).selectOption('doing');
  const taskDetails = task.getByRole('group', { name: 'Task details' });
  await taskDetails.locator('.jh-wb-md-view').click();
  await taskDetails.getByRole('textbox', { name: 'Task details' }).fill('Check the focus order');
  await taskDetails.getByRole('button', { name: 'Preview', exact: true }).click();
  await until(async () => { const saved = (await savedItem('Launch menus')).tasks[0]; return saved.state === 'doing' && saved.done === false && saved.details === 'Check the focus order'; }, 'the task state and details are saved');
  assert.equal(await task.locator('.jh-wb-task-state').textContent(), 'In progress');
  assert.equal(await task.locator('.jh-wb-age-line').textContent(), `Created ${ukLocal(0)} · in progress for 1 hour · 1 hour active · 1 hour since it first started`, 'starting a task times it from its actual start');
  await until(async () => { const [cycle] = (await savedItem('Launch menus')).tasks[0].cycles; return cycle?.end === null && cycle.fresh === true && Math.abs(Date.parse(cycle.start) - Date.now()) < 60000; }, 'the task cycle starts when the task enters In progress');
  assert.match(await sheet.locator('.jh-wb-sheet-foot .jh-wb-age-line').textContent(), new RegExp(`^Created ${ukLocal(0)} · in progress for 1 hour \\(this cycle 1 hour\\) · 1 hour active over 3 cycles · 1 hour since it first started$`), 'the sheet shows the current cycle, active time and elapsed time');
  assert.doesNotMatch(await copy(sheet), /[-–—]/, 'no hyphens or dashes in the sheet');
  await page.screenshot({ path: path.join(shots, 'details.png') });
  await sheet.locator('.jh-wb-sheet-head .jh-wb-status').click();
  await page.keyboard.press('Escape');
  await sheet.waitFor({ state: 'detached' });
  assert.equal(await board.count(), 1, 'Escape closes the details only');

  // The card: high priority flag, amber due date, three tags then +1, and its age.
  assert.equal(await moved.locator('.jh-wb-flag.is-high').count(), 1);
  assert.equal(await moved.locator('.jh-wb-due').textContent(), `Due ${ukLocal(1)}`);
  assert.ok(await moved.locator('.jh-wb-due').evaluate(element => element.classList.contains('is-soon')), 'a due date within 2 days is amber');
  assert.deepEqual(await moved.locator('.jh-wb-card-tags .jh-wb-tag').allTextContents(), ['UI', 'Launch', 'Art', '+1']);
  assert.match(await moved.locator('.jh-wb-age').textContent(), /^\d+h$/);

  // Clicking a task title on the card previews its ticket with that task marked; Open full editor then opens the sheet with the task expanded.
  await moved.getByRole('button', { name: 'Preview task Main menu' }).click();
  assert.equal(await panel.getByRole('heading', { name: 'Launch menus', level: 3 }).count(), 1, 'the ticket is previewed, not opened');
  assert.equal(await board.getByRole('dialog').count(), 0, 'the full editor stays closed');
  assert.equal(await panel.locator('.jh-wb-task.is-focus').textContent(), 'Main menuIn progress', 'the clicked task is marked');
  await panel.getByRole('button', { name: 'Open full editor' }).click();
  await sheet.waitFor();
  assert.equal(await sheet.getByRole('button', { name: 'Main menu', exact: true, expanded: true }).count(), 1);
  assert.equal(await sheet.getByRole('group', { name: 'Task details' }).locator('strong, .jh-wb-md-view').first().isVisible(), true);
  await sheet.getByRole('button', { name: 'Close details' }).click();
  await sheet.waitFor({ state: 'detached' });

  // Start a chat on this: the ticket goes to the chosen agent as context. The agent reads it, says so and
  // waits; opening the chat changes nothing on the ticket. The request is caught here, so no agent starts.
  const startedChats = [];
  await page.route('**/api/sessions', async route => { const body = route.request().postDataJSON(); startedChats.push(body); await route.fulfill({ json: { id: '00000000-0000-4000-8000-000000000001', name: body.name, agent: body.agent, cwd: repo, open: true, updatedAt: new Date().toISOString() } }); });
  const chatOn = async (title, agent) => {
    await openEditor(title);
    await sheet.waitFor();
    const was = await sheet.getByRole('combobox', { name: 'State' }).inputValue(), ticket = await savedItem(title), count = startedChats.length;
    await sheet.getByRole('combobox', { name: 'Agent for the chat' }).selectOption(agent);
    await sheet.getByRole('button', { name: 'Start a chat on this' }).click();
    for (let wait = 0; startedChats.length === count && wait < 50; wait++) await page.waitForTimeout(100);
    assert.equal(startedChats.length, count + 1, `${title}: one chat starts`);
    await page.waitForTimeout(800); // any automatic change to the ticket would be saved by now
    if (title === 'Crash on load' && agent === 'codex') await page.screenshot({ path: path.join(shots, 'start-chat-keeps-backlog.png') });
    assert.deepEqual(await savedItem(title), ticket, `${title}: opening the chat leaves state, work cycles, tasks, checkboxes and dates as they were`);
    assert.equal(await sheet.getByRole('combobox', { name: 'State' }).inputValue(), was, `${title}: it stays in ${was}`);
    await sheet.getByRole('button', { name: 'Close details' }).click();
    await sheet.waitFor({ state: 'detached' });
    return { prompt: startedChats.at(-1), ticket };
  };
  // A feature, a bug and a spike, each with both agents; the bug is the one still in Backlog.
  for (const [title, agent] of [['Launch menus', 'claude'], ['Crash on load', 'codex'], ['Pathing research', 'claude'], ['Crash on load', 'claude'], ['Launch menus', 'codex'], ['Pathing research', 'codex']]) {
    const { prompt, ticket } = await chatOn(title, agent);
    assert.equal(prompt.agent, agent);
    assert.equal(prompt.name, title);
    assert.match(prompt.initialPrompt, new RegExp(`# ${title}`));
    assert.match(prompt.initialPrompt, new RegExp(`from my Jupiter work board "My board" \\(file: knowledge/work/my-board\\.json, item id ${ticket.id}\\)`), 'board and ticket context');
    assert.match(prompt.initialPrompt, /not a request to do anything yet/);
    assert.match(prompt.initialPrompt, /read the ticket above, reply with a short acknowledgement/);
    assert.match(prompt.initialPrompt, /then wait for me to tell you what to do next/);
    assert.match(prompt.initialPrompt, /Do not start work, investigate, research, fix or implement anything/);
    assert.match(prompt.initialPrompt, /Unchecked acceptance criteria and tasks are context, not instructions/);
    assert.doesNotMatch(prompt.initialPrompt, /Please work on this|investigate and fix|Please research|Please shape|which criteria are met/, `${title}: the opening prompt asks for no work`);
    assert.doesNotMatch(prompt.initialPrompt, /project/i, 'a board without a project leaves it out');
    if (title === 'Launch menus') {
      assert.match(prompt.initialPrompt, /## Acceptance criteria\n\nOpens in under a second/);
      assert.match(prompt.initialPrompt, /## Tasks\n\n- \[[ x]\] Main menu \(In progress\)/);
    }
  }
  assert.equal(await column('Backlog').locator('[data-card]', { hasText: 'Crash on load' }).count(), 1, 'a Backlog ticket stays in Backlog after its chat opens');
  assert.equal((await savedItem('Crash on load')).cycles.length, 0, 'and has no work tracking');
  await page.unroute('**/api/sessions');

  // Done records when it finished; moving back clears it.
  await openEditor('Crash on load');
  await sheet.getByRole('combobox', { name: 'State' }).selectOption('done');
  await until(async () => (await savedItem('Crash on load')).completed, 'reaching Done records a completed time');
  assert.equal(await sheet.locator('.jh-wb-sheet-foot .jh-wb-age-line').textContent(), `Created ${ukLocal(0)} · Done ${ukLocal(0)} with no time in progress`, 'straight from Backlog to Done: no work cycle is made up');
  await sheet.getByRole('combobox', { name: 'State' }).selectOption('todo');
  await until(async () => (await savedItem('Crash on load')).completed === null, 'leaving Done clears the completed time');
  await sheet.getByRole('button', { name: 'Close details' }).click();

  // The top bar has type and tag filters only: no text filter and no project select.
  const bar = board.locator('.jh-wb-bar');
  assert.equal(await bar.getByRole('textbox', { name: 'Filter items' }).count(), 0);
  assert.equal(await bar.locator('input:not([aria-label="Board title"])').count(), 0, 'the only input in the top bar is the board title');
  assert.equal(await bar.getByRole('combobox').count(), 0, 'the board picker is a menu, not a select');
  assert.doesNotMatch(await bar.innerText(), /Project/);

  // Filter by type and by tag; counts follow the filter.
  assert.deepEqual(await counts(), ['2', '2/3', '1']);
  const types = board.getByRole('group', { name: 'Filter by type' });
  await types.getByRole('button', { name: 'Bug' }).click();
  assert.deepEqual(await counts(), ['1', '2/3', '0'], 'limited columns count the whole column');
  assert.deepEqual(await board.locator('[data-card] .jh-wb-card-title').allTextContents(), ['Crash on load']);
  await types.getByRole('button', { name: 'Spike' }).click();
  assert.deepEqual(await counts(), ['1', '2/3', '0']);
  await page.screenshot({ path: path.join(shots, 'filtered.png') });
  await types.getByRole('button', { name: 'Bug' }).click();
  await types.getByRole('button', { name: 'Spike' }).click();
  const tagFilter = board.getByRole('group', { name: 'Filter by tag' });
  await tagFilter.getByRole('button', { name: 'UI' }).click();
  assert.deepEqual(await counts(), ['0', '2/3', '0']);
  await tagFilter.getByRole('button', { name: 'UI' }).click();
  assert.deepEqual(await counts(), ['2', '2/3', '1']);

  // Work in progress limit: set In progress to 1 with two cards in it; the count reads 2/1 and the
  // column turns amber with a quiet note. Drops are never blocked.
  await addItem('In progress', 'Feature', 'Tune audio');
  const doing = column('In progress');
  assert.equal(await doing.locator('.jh-wb-count').textContent(), '3/3');
  assert.equal(await doing.evaluate(element => element.classList.contains('is-over')), false);
  await doing.locator('.jh-wb-limit').click();
  const limitInput = doing.getByRole('spinbutton', { name: 'In progress limit' });
  await limitInput.fill('1');
  await limitInput.press('Enter');
  assert.equal(await doing.locator('.jh-wb-count').textContent(), '3/1');
  assert.ok(await doing.evaluate(element => element.classList.contains('is-over')), 'over the limit the column is marked');
  assert.equal(await doing.locator('.jh-wb-over').textContent(), 'Over the limit');
  const amber = await doing.evaluate(element => ({ edge: getComputedStyle(element, '::after').backgroundColor, count: getComputedStyle(element.querySelector('.jh-wb-count')).color }));
  assert.deepEqual(amber, { edge: 'rgb(255, 191, 94)', count: 'rgb(255, 191, 94)' }, 'the count and top edge are amber');
  await until(async () => (await saved('my-board')).limits?.doing === 1, 'the limit is saved');
  assert.match(await readFile(path.join(repo, 'knowledge/work/my-board.md'), 'utf8'), /Limits: In progress 1\n[\s\S]*## In progress \(3\/1, over the limit\)/);
  await page.screenshot({ path: path.join(shots, 'limit.png') });
  // Escape cancels (and leaves the window open). There is no Testing column any more.
  await doing.locator('.jh-wb-limit').click();
  await limitInput.fill('9');
  await limitInput.press('Escape');
  assert.equal(await doing.locator('.jh-wb-count').textContent(), '3/1');
  assert.equal(await board.count(), 1, 'Escape only cancels the limit');
  assert.equal(await column('Testing').count(), 0);
  await until(async () => JSON.stringify((await saved('my-board')).limits) === '{"doing":1}', 'only In progress has a limit');

  // Calendar: it shows work, not tickets. Give Launch menus one work cycle that began 14 days ago and
  // Crash on load (still in Backlog) an older created date, then reload the board.
  await until(async () => await board.locator('.jh-wb-bar .jh-wb-status').textContent() !== 'Saving', 'pending saves finish');
  await page.waitForTimeout(600);
  const noonDaysAgo = days => { const date = new Date(); date.setHours(12, 0, 0, 0); date.setDate(date.getDate() - days); return date.toISOString(); };
  const onDisk = await saved('my-board');
  for (const item of onDisk.items) {
    if (item.title === 'Launch menus') {
      item.created = noonDaysAgo(20); item.cycles = [{ start: noonDaysAgo(14), end: null, fresh: true }];
      // An older task saved before tasks had cycles: created long ago, never started.
      item.tasks.push({ id: 'told', title: 'Old idea', done: false, state: 'todo', details: '', created: noonDaysAgo(20), completed: null });
    }
    if (item.title === 'Crash on load') item.created = noonDaysAgo(3);
  }
  await writeFile(path.join(repo, 'knowledge/work/my-board.json'), JSON.stringify(onDisk));
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('jupiter-work-reload', { detail: { slug: 'my-board' } })));
  await until(async () => await moved.locator('.jh-wb-age').textContent() === '2w', 'the reloaded board counts in flight time from when work started');
  // The older, never started task shows only its creation date, not 20 days in flight.
  await openEditor('Launch menus');
  await sheet.waitFor();
  await sheet.getByRole('button', { name: 'Old idea', exact: true }).click();
  assert.equal(await sheet.locator('[data-task]', { hasText: 'Old idea' }).locator('.jh-wb-age-line').textContent(), `Created ${ukLocal(-20)} · not started yet`, 'an older task that never started has no in flight time');
  await sheet.locator('[data-task]', { hasText: 'Old idea' }).locator('.jh-wb-age-line').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(shots, 'task-not-started.png') });
  await sheet.getByRole('button', { name: 'Close details' }).click();
  await sheet.waitFor({ state: 'detached' });

  // Finish the spike, then open This week: a Monday to Sunday calendar.
  await openEditor('Pathing research');
  await sheet.getByRole('combobox', { name: 'State' }).selectOption('done');
  await sheet.getByRole('button', { name: 'Close details' }).click();
  await sheet.waitFor({ state: 'detached' });
  await board.getByRole('button', { name: 'This week' }).click();
  const week = board.getByRole('dialog', { name: 'Weekly summary' });
  await week.locator('.jh-wb-week-total strong').waitFor();
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const addDays = (date, days) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
  const mondayOf = date => addDays(date, -((date.getDay() + 6) % 7));
  const ukOf = date => `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;
  const monday = mondayOf(today), todayIndex = (today.getDay() + 6) % 7;
  const range = () => week.locator('.jh-wb-cal-range').textContent();
  assert.equal(await range(), `${ukOf(monday)} to ${ukOf(addDays(monday, 6))}`, 'the week runs Monday to Sunday, in UK dates');
  assert.equal(await week.getByRole('button', { name: 'Week', pressed: true }).count(), 1);
  assert.deepEqual(await week.getByRole('columnheader').allTextContents(), ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
  const cal = week.getByRole('grid');
  assert.equal(await cal.locator('.jh-wb-cal-week').count(), 1);
  const cell = date => cal.getByRole('gridcell', { name: ukOf(date), exact: true });
  assert.ok(await cell(today).evaluate(element => element.classList.contains('is-today')), 'today is highlighted');
  assert.equal(await cal.locator('.jh-wb-cal-day.is-today').count(), 1);
  const barOf = title => cal.getByRole('button', { name: new RegExp(`^\\w+: ${title},`) });
  const near = (a, b) => Math.abs(a - b) <= 6;
  // Crash on load is still in Backlog, so it is not on the calendar, whatever its dates.
  assert.equal(await barOf('Crash on load').count(), 0, 'Backlog items are not on the activity calendar');
  const todayBox = await cell(today).boundingBox();
  // Launch menus began 14 days ago, so it carries on from last week into today.
  const launch = barOf('Launch menus');
  assert.ok(await launch.evaluate(element => element.classList.contains('is-cont-left') && element.classList.contains('is-feature')), 'it carries on from the week before');
  assert.equal(await launch.evaluate(element => getComputedStyle(element).getPropertyValue('--bar').trim()), '#b9a3ff', 'bars take the type colour (features are violet)');
  const launchBox = await launch.boundingBox(), mondayBox = await cell(monday).boundingBox();
  assert.ok(near(launchBox.x, mondayBox.x) && near(launchBox.x + launchBox.width, todayBox.x + todayBox.width), 'it spans Monday to today');
  // Done today: a one day bar, marked done. Bars never overlap.
  const pathing = barOf('Pathing research');
  assert.ok(await pathing.evaluate(element => element.classList.contains('is-done') && element.classList.contains('is-spike')));
  const pathingBox = await pathing.boundingBox();
  assert.ok(near(pathingBox.x, todayBox.x) && near(pathingBox.x + pathingBox.width, todayBox.x + todayBox.width), 'a one day item spans one day');
  const boxes = await cal.locator('.jh-wb-cal-bar').evaluateAll(bars => bars.map(element => element.getBoundingClientRect()).map(({ left, right, top, bottom }) => ({ left, right, top, bottom })));
  const working = (await saved('my-board')).items.filter(item => item.state !== 'todo' && item.cycles.length).length;
  assert.equal(boxes.length, working, 'every item worked on this week has a bar, and nothing else');
  for (const [n, a] of boxes.entries()) for (const b of boxes.slice(n + 1)) assert.ok(a.right <= b.left + 1 || b.right <= a.left + 1 || a.bottom <= b.top + 1 || b.bottom <= a.top + 1, 'bars are stacked in lanes, not on top of each other');

  // The summary for this week, under the calendar: Done count, type chips and still in flight.
  assert.equal(await week.locator('.jh-wb-week-total strong').textContent(), '2', 'the seeded done item and the spike');
  assert.deepEqual(await week.locator('.jh-wb-week-stats .jh-wb-typechip').allTextContents(), ['1 Feature', '0 Bugs', '1 Spike']);
  assert.match(await week.locator('.jh-wb-week-average').first().textContent(), /^Average \d+ hours? of active work$/);
  assert.match(await week.locator('.jh-wb-week-average').nth(1).textContent(), /^\d+ in progress now$/);
  assert.equal(await week.getByText(`Week of ${ukOf(monday)} to ${ukOf(addDays(monday, 6))}`).count(), 1);
  assert.deepEqual(await week.getByRole('list', { name: 'Still in flight' }).locator('.jh-wb-week-title').allTextContents(), ['Launch menus']);
  assert.doesNotMatch(await copy(week), /[-–—]/, 'no hyphens or dashes in the calendar');
  await page.waitForTimeout(350); // let the sheet finish rising
  await page.screenshot({ path: path.join(shots, 'week.png') });

  // Clicking a bar opens that item over the calendar; Escape closes the item only.
  await barOf('Launch menus').click();
  await board.getByRole('dialog', { name: 'Details for Launch menus' }).waitFor();
  await page.keyboard.press('Escape');
  await board.getByRole('dialog', { name: 'Details for Launch menus' }).waitFor({ state: 'detached' });
  assert.equal(await week.count(), 1, 'the calendar stays open');

  // Previous week: Launch menus fills all seven days and carries on both ways; nothing was done then.
  await week.getByRole('button', { name: 'Previous week' }).click();
  assert.equal(await range(), `${ukOf(addDays(monday, -7))} to ${ukOf(addDays(monday, -1))}`);
  await week.locator('.jh-wb-week-total strong', { hasText: '0' }).waitFor();
  assert.equal(await cal.locator('.jh-wb-cal-bar').count(), 1, 'only work touching that week is drawn');
  const lastWeekBox = await launch.boundingBox(), weekBox = await cal.locator('.jh-wb-cal-week').boundingBox();
  assert.ok(near(lastWeekBox.x, weekBox.x) && near(lastWeekBox.x + lastWeekBox.width, weekBox.x + weekBox.width), 'the bar spans the whole week');
  assert.ok(await launch.evaluate(element => element.classList.contains('is-cont-left') && element.classList.contains('is-cont-right')));
  assert.equal(await cal.locator('.jh-wb-cal-day.is-today').count(), 0);
  await week.getByRole('button', { name: 'Next week' }).click();
  await week.getByRole('button', { name: 'Next week' }).click();
  assert.equal(await range(), `${ukOf(addDays(monday, 7))} to ${ukOf(addDays(monday, 13))}`);
  assert.equal(await cal.locator('.jh-wb-cal-bar').count(), 0, 'nothing is drawn after today');
  await week.getByRole('button', { name: 'Today' }).click();
  assert.equal(await range(), `${ukOf(monday)} to ${ukOf(addDays(monday, 6))}`);
  assert.ok(await week.getByRole('button', { name: 'Today' }).isDisabled(), 'Today is greyed out on this week');
  await week.locator('.jh-wb-week-total strong', { hasText: '2' }).waitFor();

  // Month view: six week rows, faint days from other months, bars wrapping across week rows.
  await week.getByRole('button', { name: 'Month' }).click();
  const first = new Date(today.getFullYear(), today.getMonth(), 1);
  const lastDay = new Date(first.getFullYear(), first.getMonth() + 1, 0);
  const monthName = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' });
  assert.equal(await range(), `${monthName.format(first)} · ${ukOf(first)} to ${ukOf(lastDay)}`);
  assert.equal(await cal.locator('.jh-wb-cal-week').count(), 6, 'a month shows six weeks');
  assert.equal(await cal.getByRole('gridcell').count(), 42);
  const gridStart = mondayOf(first);
  const outside = Array.from({ length: 42 }, (_, n) => addDays(gridStart, n)).filter(date => date.getMonth() !== first.getMonth()).length;
  assert.equal(await cal.locator('.jh-wb-cal-day.is-out').count(), outside, 'days outside the month are faint');
  const start = addDays(today, -14);
  const rows = Array.from({ length: 6 }, (_, n) => addDays(gridStart, n * 7)).filter(row => addDays(row, 6) >= start && row <= today).length;
  assert.equal(await cal.locator('.jh-wb-cal-bar', { hasText: 'Launch menus' }).count(), rows, 'a long item wraps onto each week row it touches');
  assert.ok(rows >= 1);
  if (rows > 1) assert.ok(await cal.locator('.jh-wb-cal-bar', { hasText: 'Launch menus' }).first().evaluate(element => element.classList.contains('is-cont-right')), 'and carries on into the next row');
  assert.match(await cell(today).locator('.jh-wb-cal-more').textContent(), /^\+\d+ more$/, 'a busy day shows how many more there are');
  assert.equal(await cal.locator('.jh-wb-cal-week.is-focus').count(), 1, 'the summary week is marked');
  await page.screenshot({ path: path.join(shots, 'month.png') });
  const head = await week.locator('.jh-wb-cal-head').boundingBox(), closeBox = await week.getByRole('button', { name: 'Close summary' }).boundingBox();
  assert.ok(closeBox.y < head.y + head.height / 2, 'the month header stays on one line');
  await week.getByRole('button', { name: 'Next month' }).click();
  const nextFirst = new Date(first.getFullYear(), first.getMonth() + 1, 1);
  assert.equal(await range(), `${monthName.format(nextFirst)} · ${ukOf(nextFirst)} to ${ukOf(new Date(nextFirst.getFullYear(), nextFirst.getMonth() + 1, 0))}`);
  await week.getByRole('button', { name: 'Previous month' }).click();
  await week.getByRole('button', { name: 'Previous month' }).click();
  assert.match(await range(), new RegExp(`^${monthName.format(new Date(first.getFullYear(), first.getMonth() - 1, 1))} · `));
  await week.getByRole('button', { name: 'Today' }).click();
  assert.equal(await range(), `${monthName.format(first)} · ${ukOf(first)} to ${ukOf(lastDay)}`);
  await week.getByRole('button', { name: 'Week' }).click();
  assert.equal(await range(), `${ukOf(monday)} to ${ukOf(addDays(monday, 6))}`);
  await week.locator('.jh-wb-week-total strong', { hasText: '2' }).waitFor();

  // Copy as Markdown (the clipboard is stubbed so the test never touches the real one).
  await page.evaluate(() => { window.copied = null; Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.copied = text; } } }); });
  await week.getByRole('button', { name: 'Copy as Markdown' }).click();
  await week.locator('.jh-wb-week-note', { hasText: 'Copied' }).waitFor();
  const copied = await page.evaluate(() => window.copied);
  assert.match(copied, new RegExp(`^# My board: ${ukOf(monday)} to ${ukOf(addDays(monday, 6))}\\n\\n2 done \\(1 Feature, 1 Spike\\), average .+ of active work\\.\\n\\n## Done\\n\\n- Spike: Pathing research, done after \\d+ hours?\\n- Feature: Finished thing, done after \\d+ hours?\\n\\n## Still in flight\\n\\n- Feature: Launch menus \\[UI, Launch, Art, Menus\\], In progress for 2 weeks\\n$`));
  // Save to knowledge writes the same summary to knowledge/work/my-board-week-<Monday>.md.
  await week.getByRole('button', { name: 'Save to knowledge' }).click();
  await week.locator('.jh-wb-week-note', { hasText: 'Saved to knowledge' }).waitFor();
  const weekly = (await readdir(path.join(repo, 'knowledge/work'))).filter(name => /^my-board-week-\d{4}-\d{2}-\d{2}\.md$/.test(name));
  assert.deepEqual(weekly, [`my-board-week-${ukOf(monday).split('/').reverse().join('-')}.md`], 'one weekly file, named after the Monday');
  assert.equal(await readFile(path.join(repo, 'knowledge/work', weekly[0]), 'utf8'), copied, 'the file matches what was copied');
  // The visible week is what gets copied: last week has nothing done.
  await week.getByRole('button', { name: 'Previous week' }).click();
  await week.locator('.jh-wb-week-total strong', { hasText: '0' }).waitFor();
  await week.getByRole('button', { name: 'Copy as Markdown' }).click();
  await until(async () => /^# My board: .+\n\n0 done\./.test(await page.evaluate(() => window.copied)), 'last week is copied');
  assert.ok((await page.evaluate(() => window.copied)).startsWith(`# My board: ${ukOf(addDays(monday, -7))} to ${ukOf(addDays(monday, -1))}`));
  await page.keyboard.press('Escape');
  await week.waitFor({ state: 'detached' });
  assert.equal(await board.count(), 1, 'Escape closes the summary only');

  // The board menu: a dark glass panel listing boards (current one highlighted, item counts), New
  // board, Save and Delete this board. Escape and clicks outside close it.
  const menu = board.getByRole('menu', { name: 'Boards' });
  await picker.click();
  await menu.waitFor();
  assert.deepEqual(await menu.locator('.jh-wb-menu-name').allTextContents(), ['My board', 'Delete this board']);
  assert.deepEqual(await menu.getByRole('menuitem').evaluateAll(items => items.map(item => item.textContent)), ['My board6 items', 'New board', 'Save', 'Delete this board']);
  const saveItem = menu.locator('.jh-wb-menu-save');
  assert.equal(await saveItem.locator('svg').count(), 1, 'Save has an icon');
  assert.ok(await saveItem.isDisabled(), 'Save is disabled with nothing unsaved');
  assert.equal(await menu.getByRole('menuitem', { name: /^My board/ }).getAttribute('aria-current'), 'true');
  assert.ok(await menu.getByRole('menuitem', { name: /^My board/ }).evaluate(element => element === document.activeElement), 'opening focuses the current board');
  const menuStyle = await menu.evaluate(element => { const style = getComputedStyle(element); return { radius: style.borderRadius, background: style.backgroundColor }; });
  assert.deepEqual(menuStyle, { radius: '16px', background: 'rgba(9, 18, 31, 0.96)' });
  assert.equal(await menu.locator('.jh-wb-menu-new').evaluate(element => getComputedStyle(element).color), 'rgb(127, 227, 255)', 'New board is cyan');
  assert.equal(await menu.locator('.jh-wb-menu-delete').evaluate(element => getComputedStyle(element).color), 'rgb(255, 138, 138)', 'Delete is red');
  assert.doesNotMatch(await copy(board), /[-–—]/, 'no hyphens or dashes in the menu');
  await page.waitForTimeout(300); // let the menu finish fading in
  await page.screenshot({ path: path.join(shots, 'board-menu.png') });
  await page.keyboard.press('Escape');
  await menu.waitFor({ state: 'detached' });
  assert.equal(await board.count(), 1, 'Escape closes the menu only');
  assert.ok(await picker.evaluate(element => element === document.activeElement), 'focus goes back to the picker');
  await picker.click();
  await menu.waitFor();
  await board.locator('.jh-wb-col-head h3').last().click();
  await menu.waitFor({ state: 'detached' });

  // Save writes a change waiting for the autosave at once and shows Saved for a moment. The 400 ms
  // autosave timer is held back here, so only Save can write the change.
  await page.evaluate(() => { const real = window.setTimeout; window.realSetTimeout = real; window.setTimeout = (fn, ms, ...rest) => real(fn, ms === 400 ? 600000 : ms, ...rest); });
  await board.getByRole('textbox', { name: 'Board title' }).fill('Saved by hand');
  await picker.click();
  await menu.waitFor();
  assert.equal((await saved('my-board')).title, 'My board', 'the change waits for the autosave');
  assert.ok(await saveItem.isEnabled(), 'Save is enabled with an unsaved change');
  await saveItem.click();
  await menu.locator('.jh-wb-menu-save', { hasText: 'Saved' }).waitFor();
  await until(async () => (await saved('my-board')).title === 'Saved by hand', 'Save writes the change at once');
  assert.ok(await saveItem.isDisabled(), 'nothing left to save');
  assert.equal(await menu.count(), 1, 'the menu stays open to show Saved');
  await page.screenshot({ path: path.join(shots, 'board-menu-saved.png') });
  await until(async () => await saveItem.textContent() === 'Save', 'Saved shows briefly', 4000);
  assert.ok(await menu.evaluate(element => element.contains(document.activeElement)), 'focus stays in the menu after Save');
  await page.keyboard.press('Escape');
  await menu.waitFor({ state: 'detached' });
  assert.equal(await board.count(), 1, 'Escape after Save closes the menu only');
  await page.evaluate(() => { window.setTimeout = window.realSetTimeout; });
  await board.getByRole('textbox', { name: 'Board title' }).fill('My board');
  await until(async () => (await saved('my-board')).title === 'My board', 'the autosave still works');

  // New board from the keyboard: ArrowDown opens the menu, ArrowDown again, Enter. Nothing in the top bar overflows the window.
  await picker.focus();
  await page.keyboard.press('ArrowDown');
  await menu.waitFor();
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.evaluate(() => document.activeElement.textContent), 'New board');
  await page.keyboard.press('Enter');
  const frameBox = await frame.boundingBox();
  for (const locator of [board.getByRole('textbox', { name: 'New board title' }), board.getByRole('button', { name: 'Cancel' })]) {
    const box = await locator.boundingBox();
    assert.ok(box.x >= frameBox.x + 4 && box.x + box.width <= frameBox.x + frameBox.width - 4, 'top bar controls stay inside the window');
  }
  await page.screenshot({ path: path.join(shots, 'new-board.png') });
  await board.getByRole('textbox', { name: 'New board title' }).fill('Second board');
  await board.getByRole('textbox', { name: 'New board title' }).press('Enter');
  await until(async () => await board.getByRole('textbox', { name: 'Board title' }).inputValue() === 'Second board', 'the new board opens');
  assert.equal(await picker.innerText(), 'Second board');
  assert.equal(await board.locator('[data-card]').count(), 0);
  assert.equal((await saved('second-board')).project, null, 'new boards have no project');
  const pick = async name => { await picker.click(); await menu.getByRole('menuitem', { name: new RegExp(`^${name}`) }).click(); await menu.waitFor({ state: 'detached' }); };
  await pick('My board');
  await column('In progress').locator('[data-card]', { hasText: 'Launch menus' }).waitFor();
  await pick('Second board');
  await until(async () => await board.getByRole('textbox', { name: 'Board title' }).inputValue() === 'Second board', 'switching back opens the second board');

  // Delete this board arms on the first click and deletes on the second. Escape disarms it.
  await picker.click();
  assert.deepEqual(await menu.getByRole('menuitem').evaluateAll(items => items.map(item => item.textContent)), ['Second board0 items', 'My board6 items', 'New board', 'Save', 'Delete this board']);
  const remove = menu.locator('.jh-wb-menu-delete');
  await remove.click();
  assert.equal(await remove.textContent(), 'Confirm: delete Second board');
  assert.ok(await remove.evaluate(element => element.classList.contains('is-armed')));
  assert.deepEqual(await trash(), [], 'the first click deletes nothing');
  await page.screenshot({ path: path.join(shots, 'delete-board.png') });
  await page.keyboard.press('Escape');
  await menu.waitFor({ state: 'detached' });
  await picker.click();
  assert.equal(await remove.textContent(), 'Delete this board', 'closing the menu disarms it');
  await remove.click();
  await remove.click();
  await menu.waitFor({ state: 'detached' });
  await until(async () => await board.getByRole('textbox', { name: 'Board title' }).inputValue() === 'My board', 'the next board opens after deleting');
  const toast = board.getByRole('status').filter({ hasText: 'Board deleted' });
  await toast.waitFor();
  assert.equal(await toast.getByRole('button', { name: 'Undo' }).count(), 1);
  await column('In progress').locator('[data-card]', { hasText: 'Launch menus' }).waitFor();
  const deleted = await trash();
  assert.equal(deleted.length, 2);
  assert.match(deleted[0], /^second-board-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.json$/);
  assert.equal(deleted[1], deleted[0].replace(/\.json$/, '.md'));
  assert.equal(JSON.parse(await readFile(path.join(repo, 'knowledge/work/.deleted', deleted[0]), 'utf8')).title, 'Second board', 'the moved file can be recovered by hand');
  assert.equal((await readdir(path.join(repo, 'knowledge/work'))).some(name => name.startsWith('second-board.')), false, 'the board files are gone from knowledge/work');
  assert.doesNotMatch(await copy(board), /[-–—]/, 'no hyphens or dashes on screen');
  await page.screenshot({ path: path.join(shots, 'board-deleted.png') });

  // Undo puts it back and opens it.
  await toast.getByRole('button', { name: 'Undo' }).click();
  await until(async () => await board.getByRole('textbox', { name: 'Board title' }).inputValue() === 'Second board', 'Undo opens the restored board');
  await toast.waitFor({ state: 'detached' });
  assert.equal((await saved('second-board')).title, 'Second board');
  assert.deepEqual(await trash(), [], 'the restored files leave .deleted');
  // Deleted again, the toast goes away by itself after about 8 seconds.
  await picker.click(); await remove.click(); await remove.click();
  await toast.waitFor();
  await until(async () => await board.textContent().then(text => text.includes('Board deleted')) === false, 'the toast closes itself', 12000);
  assert.equal(await board.getByRole('textbox', { name: 'Board title' }).inputValue(), 'My board');

  // Deleting the last board leaves no boards: the empty state, not a fresh My board.
  await picker.click(); await remove.click(); await remove.click();
  const empty = board.getByText('No boards yet');
  await empty.waitFor();
  assert.equal(await board.getByRole('button', { name: 'Create a board' }).count(), 1);
  assert.equal(await board.locator('.jh-wb-col').count(), 0);
  assert.equal(await picker.innerText(), 'No boards');
  assert.ok((await trash()).some(name => name.startsWith('my-board-')), 'the last board is moved to .deleted');
  assert.equal((await readdir(path.join(repo, 'knowledge/work'))).filter(name => name.endsWith('.json')).length, 0, 'no board is made in its place');
  assert.equal((await readdir(path.join(repo, 'knowledge/work'))).filter(name => /^my-board-week-/.test(name)).length, 1, 'weekly files are left alone');
  assert.doesNotMatch(await copy(board), /[-–—]/, 'no hyphens or dashes in the empty state');
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(shots, 'no-boards.png') });
  // Undo works for the last board too.
  await board.getByRole('status').filter({ hasText: 'Board deleted' }).getByRole('button', { name: 'Undo' }).click();
  await column('In progress').locator('[data-card]', { hasText: 'Launch menus' }).waitFor();
  assert.equal(await board.getByRole('textbox', { name: 'Board title' }).inputValue(), 'My board');
  await picker.click(); await remove.click(); await remove.click();
  await empty.waitFor();

  // Still none after reopening (the service does not seed a board again); Create a board starts one.
  await page.goto(`${service.urls.workspace}#/`);
  if (!harness) {
    await page.waitForSelector('.jupiter-home');
    await page.locator('.jh-wb-summary', { hasText: 'No boards yet' }).waitFor();
    await page.locator('.jh-panel h2', { hasText: 'To do' }).click();
  }
  await empty.waitFor();
  await board.getByRole('button', { name: 'Create a board' }).click();
  await board.getByRole('textbox', { name: 'New board title' }).fill('Fresh start');
  await board.getByRole('textbox', { name: 'New board title' }).press('Enter');
  await until(async () => await board.getByRole('textbox', { name: 'Board title' }).inputValue() === 'Fresh start', 'Create a board opens the new board');
  assert.equal(await board.locator('.jh-wb-col').count(), 3, 'Backlog, In progress and Done');
  assert.equal(await board.locator('[data-card]').count(), 0);

  assert.deepEqual(errors, []);
  console.log(`Work board passed: columns, feature, bug and spike, tasks with state and details, drag, Markdown toolbar while editing, highlighted code blocks, priority, UK dates, tags, ages, filters, limits, week and month calendar with spanning bars, weekly summary, board menu, switching, deleting with undo and the empty state. Screenshots: ${shots}`);
} finally {
  await browser.close(); await service.close();
}
