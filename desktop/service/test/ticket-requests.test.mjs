// Ticket requests: "create a feature ticket to …, have Codex write the details".
// Everything here uses stand-ins: no real Codex, OpenAI or microphone is ever started.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import { createService } from '../server.mjs';
import { checkDraft, draftBrief, parseTicketRequest, resolveBoard } from '../ticket-requests.mjs';

const root = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const REPORTED = 'create a feature ticket to increase the rotation speed of the brain animation, have Codex write the details';
const TITLE = 'Increase the rotation speed of the brain animation';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const until = async (check, message, timeout = 5000) => { const end = Date.now() + timeout; while (Date.now() < end) { if (await check()) return; await sleep(25); } assert.fail(`timed out: ${message}`); };

test('a ticket request is recognised, with its type, title, drafting agent and board', () => {
  assert.deepEqual(parseTicketRequest(REPORTED), { type: 'feature', title: TITLE, description: 'increase the rotation speed of the brain animation', request: REPORTED, board: null, draft: 'codex', explicit: true });
  const plain = parseTicketRequest('Create a feature ticket to increase the rotation speed of the brain animation');
  assert.equal(plain.title, TITLE); assert.equal(plain.draft, 'codex', 'Codex drafts by default'); assert.equal(plain.explicit, false);
  assert.equal(parseTicketRequest('Jupiter, could you please add a bug ticket for the login page crashing on Safari.').type, 'bug');
  assert.equal(parseTicketRequest('Jupiter, could you please add a bug ticket for the login page crashing on Safari.').title, 'The login page crashing on Safari');
  assert.deepEqual((({ type, title, draft, explicit }) => ({ type, title, draft, explicit }))(parseTicketRequest('raise a spike ticket about caching options, and ask Claude to draft the details')), { type: 'spike', title: 'Caching options', draft: 'claude', explicit: true });
  assert.deepEqual((({ title, draft, explicit }) => ({ title, draft, explicit }))(parseTicketRequest("make a ticket: dark mode for the dashboard, don't use Codex")), { title: 'Dark mode for the dashboard', draft: 'none', explicit: true });
  assert.equal(parseTicketRequest('create a ticket for a faster save, without Codex').draft, 'none');
  assert.equal(parseTicketRequest('create a ticket for a faster save, just the title').draft, 'none');
  assert.equal(parseTicketRequest('create a feature ticket to speed up saving using Codex to write the details').title, 'Speed up saving');
  assert.equal(parseTicketRequest('create a feature ticket to speed up saving, then have Codex write the details').title, 'Speed up saving');
  assert.equal(parseTicketRequest('open a ticket to speed up saving and add controls').title, 'Speed up saving and add controls', 'an "and" inside the request stays in the title');
  assert.equal(parseTicketRequest('Add a ticket on the Project Jupiter board to speed up the brain, Codex can write the details').board, 'Project Jupiter');
  assert.equal(parseTicketRequest('Add a ticket on the Project Jupiter board to speed up the brain, Codex can write the details').title, 'Speed up the brain');
  assert.equal(parseTicketRequest('create a ticket to my to do list for faster saving').board, null, 'the generic list is the default board');
  assert.equal(parseTicketRequest('create a ticket').title, '', 'a request without a subject is still recognised');
  const long = parseTicketRequest(`create a feature ticket to ${'make the brain animation rotate faster and look smoother '.repeat(5)}`);
  assert.ok(long.title.length <= 100 && !long.title.endsWith(' '), long.title);
  // Spoken requests have no commas.
  const spoken = parseTicketRequest('create a feature ticket to increase the rotation speed of the brain animation and have codex write the details');
  assert.deepEqual([spoken.title, spoken.draft, spoken.explicit], [TITLE, 'codex', true]);
  const placed = parseTicketRequest('add a ticket to fix the layout on the Project Jupiter board, Codex to draft the details');
  assert.deepEqual([placed.title, placed.board], ['Fix the layout', 'Project Jupiter']);
  assert.equal(parseTicketRequest('create a ticket to fix the layout on the kanban board').title, 'Fix the layout on the kanban board', 'a generic board word stays in the title');
  assert.equal(parseTicketRequest('create a feature ticket to make Codex faster at startup').title, 'Make Codex faster at startup', 'Codex in the subject is not a drafting instruction');
  assert.ok(long.description.length > 200, 'the full request is kept for the details');
});

test('requests that are not ticket creation are left alone', () => {
  for (const text of ['add buy milk', 'show my tickets', 'what tickets are open?', 'close the ticket', 'move the brain ticket to done', 'I have a ticket for the concert', 'create a new card called Foo', 'create a chat to fix the ticket', 'open the ticket board', 'what is a ticket', 'start a chat on this', 'create a feature to rotate the brain faster', '', null]) assert.equal(parseTicketRequest(text), null, String(text));
});

test('boards are matched by title, slug or one close name, never guessed', () => {
  const boards = [{ slug: 'project-jupiter', title: 'Project Jupiter' }, { slug: 'solo-levelling', title: 'Solo Levelling' }, { slug: 'jupiter-ideas', title: 'Jupiter Ideas' }];
  assert.equal(resolveBoard(boards, 'project jupiter').slug, 'project-jupiter');
  assert.equal(resolveBoard(boards, 'solo').slug, 'solo-levelling');
  assert.equal(resolveBoard(boards, 'Jupiter'), null, 'two boards contain Jupiter');
  assert.equal(resolveBoard(boards, 'missing'), null);
});

test('the brief for the drafting agent keeps the request and forbids made up values and extra tickets', () => {
  const brief = draftBrief({ board: { title: 'Project Jupiter', slug: 'project-jupiter' }, item: { id: 'w1', title: TITLE, type: 'feature' }, request: REPORTED, agent: 'codex' });
  assert.ok(brief.includes(REPORTED), 'the request is passed on word for word');
  assert.match(brief, /knowledge\/work\/project-jupiter\.json/); assert.match(brief, /id "w1"/);
  assert.match(brief, /Edit only that item\. Do not add another item/); assert.match(brief, /do not choose one/i); assert.match(brief, /Open questions/);
  assert.match(brief, /not the work/i, 'drafting does not implement the feature');
  assert.doesNotMatch(brief, /[–—]/, 'no dashes in the copy');
});

test('a drafted ticket is only counted as saved when its details really changed', () => {
  const seed = '## Request\n\nFaster brain\n';
  const board = (...items) => ({ items });
  const item = extra => ({ id: 'w1', title: 'Faster brain', details: seed, acceptance: '', ...extra });
  assert.equal(checkDraft({ board: board(item({ details: '## Request\n\nFaster brain\n\n## Details\n\nSpin faster.' })), id: 'w1', seed }).ok, true);
  assert.equal(checkDraft({ board: board(item()), id: 'w1', seed }).ok, false);
  assert.match(checkDraft({ board: board(item()), id: 'w1', seed }).text, /were not saved/);
  assert.match(checkDraft({ board: board(), id: 'w1', seed, title: 'Faster brain' }).text, /no longer on the board/);
  const two = checkDraft({ board: board(item({ details: 'Done.' }), item({ id: 'w2' })), id: 'w1', seed, title: 'Faster brain' });
  assert.equal(two.ok, false); assert.match(two.text, /2 tickets/);
});

// --- the service, with stand-ins -------------------------------------------------------------------
async function fixture({ boards = ['Older board', 'Project Jupiter'], model = false } = {}) {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'jupiter-tickets-'));
  const repo = path.join(temp, 'repo');
  await mkdir(path.join(repo, 'workspace'), { recursive: true });
  await cp(path.join(root, 'workspace/_shared'), path.join(repo, 'workspace/_shared'), { recursive: true });
  await writeFile(path.join(repo, 'workspace/workspace.json'), '{"entities":[]}');
  const wake = Object.assign(new EventEmitter(), { state: { status: 'off' }, start: async () => ({}), stop: () => ({}), mute() {}, listen() {} });
  const spoken = [];
  const voiceOut = { folder: temp, configured: async () => true, usage: async () => null, phrase: async () => ({ audio: Buffer.from('ID3'), text: '' }), speak: async text => { spoken.push(text); return { audio: Buffer.from('ID3'), text }; }, prepare: async () => ({}) };
  const events = [];
  const service = await createService({ repo, stateDir: path.join(repo, '.state'), uiDir: path.join(root, 'dist'), native: event => events.push(event), mcpOptions: { home: temp, env: {} }, voiceOptions: { wake, voiceOut }, newsOptions: { fetcher: async () => { throw new Error('The news must not be read for a ticket.'); } } });
  const created = [];
  let startError = null;
  service.sessions.create = async options => { if (startError) throw startError; created.push(options); return { id: `chat-${created.length}`, name: options.name, agent: options.agent }; };
  const realGet = service.sessions.get.bind(service.sessions);
  service.sessions.get = id => String(id).startsWith('chat-') ? { id } : realGet(id);
  if (!model) service.coordinator.ask = async () => { throw new Error('A ticket request must not need the language model.'); };
  for (const title of boards) { await service.workItems.create({ title }); await sleep(15); }
  const board = async slug => JSON.parse(await readFile(path.join(repo, 'knowledge/work', `${slug}.json`), 'utf8'));
  const ticket = (id, text, extra = {}) => service.quick.ask({ id, text, ...extra });
  const brief = async () => { const folder = path.join(repo, 'inbox/briefs'); const names = (await readdir(folder)).sort(); return readFile(path.join(folder, names.at(-1)), 'utf8'); };
  return { repo, service, created, spoken, events, wake, board, ticket, brief, fail: error => { startError = error; }, sleep };
}

test('the reported request saves one Feature on the latest board and has Codex draft the details', async () => {
  const { service, ticket, board, created, brief } = await fixture();
  try {
    const operation = await ticket('reported', REPORTED);
    assert.equal(operation.route, 'direct', 'recognised without the language model'); assert.equal(operation.status, 'completed');
    const saved = (await board('project-jupiter')).items;
    assert.equal(saved.length, 1); assert.equal((await board('older-board')).items.length, 0);
    assert.deepEqual([saved[0].type, saved[0].state, saved[0].title], ['feature', 'todo', TITLE]);
    assert.match(saved[0].details, /## Request\n\nincrease the rotation speed of the brain animation/);
    assert.equal(created.length, 1); assert.equal(created[0].agent, 'codex', 'Codex was asked');
    assert.match(created[0].initialPrompt, /^Read the brief in inbox\/briefs\/.+\.md and do what it asks\.$/);
    const text = await brief();
    assert.ok(text.includes(REPORTED)); assert.ok(text.includes(`id "${saved[0].id}"`)); assert.match(text, /rotation speed/);
    assert.match(operation.result, new RegExp(`^Saved the Feature "${TITLE}" on the Project Jupiter board\\.`));
    assert.match(operation.result, /Codex is drafting the details/); assert.match(operation.result, /not saved yet/);
    assert.doesNotMatch(operation.result, /[–—]|\s-\s/, 'no dashes in the copy');
  } finally { await service.close(); }
});

test('Codex drafts by default, an explicit choice is honoured, and no drafting means no chat', async () => {
  const { service, ticket, board, created } = await fixture();
  try {
    await ticket('default', 'create a feature ticket to add a rotation speed slider');
    assert.equal(created.at(-1).agent, 'codex', 'no instruction needed');
    await ticket('russian', 'create a feature ticket to add a Приветствие screen');
    assert.equal(created.at(-1).name, 'Ticket details', 'a chat name must be English, so a title in another language does not stop the drafting chat');
    await ticket('claude', 'create a ticket for better thumbnails and have Claude write the details');
    assert.equal(created.at(-1).agent, 'claude');
    const before = created.length;
    const none = await ticket('none', "create a ticket for a calmer colour theme, don't use Codex");
    assert.equal(created.length, before, 'no chat was opened');
    assert.match(none.result, /^Saved the Feature "A calmer colour theme" on the Project Jupiter board\./); assert.match(none.result, /no details yet|only your request/i);
    assert.equal((await board('project-jupiter')).items.length, 4);
  } finally { await service.close(); }
});

test('asking twice never creates a second ticket or a second drafting chat', async () => {
  const { service, ticket, board, created } = await fixture();
  try {
    await ticket('first', REPORTED);
    const again = await ticket('second', REPORTED);
    const items = (await board('project-jupiter')).items;
    assert.equal(items.length, 1, 'one ticket'); assert.equal(created.length, 1, 'one drafting chat');
    assert.match(again.result, /already on the Project Jupiter board/); assert.match(again.result, /Codex is already drafting/);
    // Once Codex has written the details, a repeat changes nothing.
    await service.workItems.save('project-jupiter', { ...(await board('project-jupiter')), items: [{ ...items[0], details: `${items[0].details}\n## Details\n\nSpin faster.` }] });
    service.sessions.emit('session', { id: 'chat-1', status: 'running', activity: 'working', completionVersion: 0 });
    service.sessions.emit('session', { id: 'chat-1', status: 'running', activity: 'idle', completionVersion: 1 });
    await sleep(50);
    const third = await ticket('third', 'Create a feature ticket to increase the rotation speed of the brain animation.');
    assert.equal((await board('project-jupiter')).items.length, 1); assert.equal(created.length, 1);
    assert.match(third.result, /already has details/);
    // A finished ticket does not block a new one with the same name.
    const finished = (await board('project-jupiter')).items[0];
    await service.workItems.save('project-jupiter', { ...(await board('project-jupiter')), items: [{ ...finished, state: 'done' }] });
    await ticket('fourth', REPORTED);
    assert.equal((await board('project-jupiter')).items.length, 2);
  } finally { await service.close(); }
});

test('the board is the one named, or the latest, and an unknown board is reported instead of invented', async () => {
  const { service, ticket, board, repo } = await fixture();
  const boardFiles = async () => (await readdir(path.join(repo, 'knowledge/work'))).filter(name => name.endsWith('.json')).sort();
  try {
    const before = await boardFiles();
    await ticket('named', 'create a ticket on the older board for faster saving, without Codex');
    assert.equal((await board('older-board')).items.length, 1); assert.equal((await board('project-jupiter')).items.length, 0);
    const missing = await ticket('missing', 'create a ticket on the Nowhere board for faster saving');
    assert.equal(missing.status, 'failed'); assert.match(missing.result, /no board called "Nowhere"/i); assert.match(missing.result, /Older board, Project Jupiter/);
    assert.deepEqual(await boardFiles(), before, 'no board was made up');
    const empty = await ticket('empty', 'create a ticket');
    assert.equal(empty.status, 'failed'); assert.match(empty.result, /What should the ticket say/);
  } finally { await service.close(); }
});

test('failures are reported plainly and success is never claimed', async () => {
  const { service, ticket, board, created, fail } = await fixture();
  try {
    const realSave = service.workItems.save;
    service.workItems.save = async () => { throw new Error('disk full'); };
    const notSaved = await ticket('save-fails', REPORTED);
    service.workItems.save = realSave;
    assert.equal(notSaved.status, 'failed'); assert.match(notSaved.result, /Could not save the ticket: disk full/); assert.doesNotMatch(notSaved.result, /^Saved/);
    assert.equal(created.length, 0, 'nothing is drafted for a ticket that was not saved'); assert.equal((await board('project-jupiter')).items.length, 0);
    fail(new Error('Close a tab before opening another.'));
    const noDraft = await ticket('draft-fails', REPORTED);
    assert.equal(noDraft.status, 'completed');
    assert.match(noDraft.result, /^Saved the Feature/); assert.match(noDraft.result, /could not start Codex to draft the details: Close a tab before opening another\./i); assert.doesNotMatch(noDraft.result, /is drafting/);
    assert.equal((await board('project-jupiter')).items.length, 1, 'the ticket itself is kept');
  } finally { await service.close(); }
});

test('Jupiter says the details are saved only after the drafting chat finishes and the board shows them', async () => {
  const { service, ticket, board, spoken } = await fixture();
  const finish = async (id, { changed } = {}) => {
    service.sessions.emit('session', { id, status: 'running', activity: 'working', completionVersion: 0 });
    if (changed) { const current = await board('project-jupiter'); await service.workItems.save('project-jupiter', { ...current, items: current.items.map(item => ({ ...item, details: changed })) }); }
    service.sessions.emit('session', { id, status: 'running', activity: 'idle', completionVersion: 1 });
  };
  try {
    await ticket('one', REPORTED);
    await sleep(100);
    assert.ok(!spoken.some(line => /details/.test(line) && /saved the details/i.test(line)), 'nothing is confirmed while Codex is still working');
    await finish('chat-1', { changed: '## Request\n\nincrease the rotation speed\n\n## Details\n\nSpin the brain faster. Speed not specified.' });
    await until(() => spoken.some(line => line === `Codex saved the details for "${TITLE}" on the Project Jupiter board.`), `confirmation in ${JSON.stringify(spoken)}`);
    // A chat that ends without writing anything is reported as a failure.
    await ticket('two', 'create a feature ticket for a quieter startup sound');
    await finish('chat-2');
    await until(() => spoken.some(line => /details for "A quieter startup sound" were not saved/.test(line)), `failure in ${JSON.stringify(spoken)}`);
    assert.ok(!spoken.some(line => /Codex saved the details for "A quieter startup sound"/.test(line)));
  } finally { await service.close(); }
});

test('the assistant tool is idempotent, keeps the request word for word and defaults to Codex', async () => {
  const { service, board, created, brief } = await fixture();
  try {
    const run = (name, args, request = REPORTED) => service.coordinator.execute(name, args, 'op', request);
    const first = await run('add_work_item', { title: 'Faster brain rotation', type: 'feature' });
    const retry = await run('add_work_item', { title: 'faster brain rotation!', type: 'feature' });
    assert.equal((await board('project-jupiter')).items.length, 1, 'a retry does not duplicate');
    assert.equal(first.saved, true); assert.equal(first.duplicate, false); assert.equal(retry.duplicate, true);
    assert.equal(created.length, 1); assert.equal(created[0].agent, 'codex');
    assert.ok((await brief()).includes(REPORTED), 'the user\'s own words reach Codex, not only the model\'s title');
    assert.match(first.report, /Codex is drafting the details/);
    await assert.rejects(run('add_work_item', { title: 'Other', board: 'Nowhere' }), /no board called "Nowhere"/i);
    const given = await run('add_work_item', { title: 'Hand written', acceptance: '- Works', draft: 'none' });
    assert.equal(created.length, 1); assert.equal(given.drafting, null);
    const supplied = await run('add_work_item', { title: 'With details', details: 'Already written.' });
    assert.equal(created.length, 1, 'details the user dictated are not overwritten by a draft'); assert.equal(supplied.drafting, null);
  } finally { await service.close(); }
});

test('a ticket request is not taken for weather, news or a project scan', async () => {
  const { service, board, spoken } = await fixture();
  try {
    const response = await fetch(service.origin + '/api/voice/ask', { method: 'POST', headers: { Authorization: `Bearer ${service.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'create a ticket to improve the news headlines panel, without Codex' }) });
    assert.equal(response.status, 200);
    await until(async () => (await board('project-jupiter')).items.length === 1, 'the ticket was saved');
    await until(() => spoken.some(line => /^Saved the Feature "Improve the news headlines panel"/.test(line)), `reply in ${JSON.stringify(spoken)}`);
    assert.ok(!spoken.some(line => /reach the news/i.test(line)));
  } finally { await service.close(); }
});

test('when the language model handles a request, a retried tool call still makes one ticket and Codex drafts it once', async () => {
  const { service, board, created, brief } = await fixture({ model: true });
  const results = [];
  const text = 'Could you jot down a ticket? The brain spins too slowly';
  service.coordinator.start = async () => { service.coordinator.threadId = 'fixture'; };
  service.coordinator.send = value => { if (value.result) results.push(JSON.parse(value.result.contentItems[0].text)); };
  service.coordinator.rpc = async method => {
    assert.equal(method, 'turn/start');
    const call = callId => service.coordinator.message({ id: callId, method: 'item/tool/call', params: { tool: 'add_work_item', arguments: { title: 'Brain spins too slowly', type: 'feature' }, callId } });
    await call('c1'); await call('c2');
    service.coordinator.active.resolve(results[0].report);
    return { turn: { id: 'turn' } };
  };
  try {
    const operation = await service.coordinator.ask({ id: 'model-request', text });
    assert.equal(operation.status, 'completed');
    assert.equal((await board('project-jupiter')).items.length, 1);
    assert.equal(created.length, 1); assert.equal(created[0].agent, 'codex');
    assert.ok((await brief()).includes(text), 'Codex gets the words the user used');
    assert.deepEqual(results.map(result => result.duplicate), [false, true]);
    assert.match(operation.result, /^Saved the Feature "Brain spins too slowly" on the Project Jupiter board\. Codex is drafting/);
  } finally { await service.close(); }
});

test('a spoken "open a ticket" is a ticket, not a request to open a window', async () => {
  const { service, board, spoken, wake } = await fixture();
  try {
    wake.emit('command', 'Open a ticket to speed up saving without Codex');
    await until(async () => (await board('project-jupiter')).items.length === 1, 'the ticket was saved');
    await until(() => spoken.some(line => /^Saved the Feature "Speed up saving"/.test(line)), `reply in ${JSON.stringify(spoken)}`);
  } finally { await service.close(); }
});
