// The assistant's tools for the app: work items, brainstorm boards and handing work to Claude.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, readdir, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import { createService } from '../server.mjs';

const root = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));

test('Jupiter can add a feature, build a brainstorm board and hand the feature to Claude', async () => {
  // Windows may report the temp folder in 8.3 short form; the service resolves the long form.
  const temp = await realpath(await mkdtemp(path.join(os.tmpdir(), 'jupiter-tools-')));
  const repo = path.join(temp, 'repo');
  await mkdir(path.join(repo, 'workspace'), { recursive: true });
  await cp(path.join(root, 'workspace/_shared'), path.join(repo, 'workspace/_shared'), { recursive: true });
  const { writeFile } = await import('node:fs/promises');
  await writeFile(path.join(repo, 'workspace/workspace.json'), '{"entities":[]}');
  const wake = Object.assign(new EventEmitter(), { state: { status: 'off' }, start: async () => ({}), stop: () => ({}), mute() {}, listen() {} });
  const service = await createService({ repo, stateDir: path.join(repo, '.state'), uiDir: path.join(root, 'dist'), mcpOptions: { home: temp, env: {} }, voiceOptions: { wake, voiceOut: { folder: temp, configured: async () => false, usage: async () => null, phrase: async () => ({ audio: Buffer.from('') }), speak: async () => ({ audio: Buffer.from('') }), prepare: async () => ({}) } } });
  const created = [];
  service.sessions.create = async options => { created.push(options); return { id: 'chat-1', name: options.name, agent: options.agent }; };
  const realGet = service.sessions.get.bind(service.sessions);
  service.sessions.get = id => id === 'chat-1' ? { id } : realGet(id);
  try {
    const run = (name, args) => service.coordinator.execute(name, args, 'op', '');
    const added = await run('add_work_item', { title: 'Character creation', type: 'feature', acceptance: '- Pick a class\n- Name the hero', tasks: ['Class picker'], tags: ['Solo Levelling'] });
    assert.deepEqual({ added: added.added, type: added.type, board: added.board, tasks: added.tasks }, { added: 'Character creation', type: 'feature', board: 'My board', tasks: 1 });
    assert.equal(added.saved, true); assert.equal(added.report, 'Saved the Feature "Character creation" on the My board.'); assert.equal(created.length, 0, 'details were supplied, so no drafting chat is opened');
    const board = JSON.parse(await readFile(path.join(repo, 'knowledge/work/my-board.json'), 'utf8'));
    const item = board.items.find(entry => entry.title === 'Character creation');
    assert.equal(item.state, 'todo'); assert.deepEqual(item.tags, ['Solo Levelling']); assert.equal(item.tasks[0].title, 'Class picker');

    const opened = await run('open_board', { title: 'Solo Levelling Design' });
    assert.equal(opened.opened, 'Solo Levelling Design');
    const linked = await run('add_to_board', { notes: ['Character creation'], links: [{ from: 'Character creation', to: 'Movement' }] });
    assert.deepEqual(linked.cards, ['Character creation', 'Movement']);
    assert.equal(linked.connections, 1);

    const boardFile = path.join(repo, 'knowledge/work/my-board.json');
    const briefOf = async options => { const [, name] = /inbox\/briefs\/(.+\.md)/.exec(options.initialPrompt); return readFile(path.join(repo, 'inbox/briefs', name), 'utf8'); };
    const stateOf = async title => JSON.parse(await readFile(boardFile, 'utf8')).items.find(entry => entry.title === title).state;
    const WORKING = /Please work on this|Please shape this|investigate and fix|Please research/;

    // No goal: the chat reads the ticket, says so briefly and waits. Nothing else changes, for every type and both agents.
    await run('add_work_item', { title: 'Crash on load', type: 'bug', details: 'It crashes.' });
    await run('add_work_item', { title: 'Pathing research', type: 'spike', details: 'Which library?' });
    const before = await readFile(boardFile, 'utf8');
    for (const [title, agent] of [['character creation', undefined], ['crash on load', 'codex'], ['pathing research', 'claude'], ['character creation', 'codex']]) {
      const chat = await run('start_work_chat', { title, ...(agent ? { agent } : {}) });
      const options = created.at(-1);
      assert.equal(chat.agent, agent || 'claude', 'Claude Code by default');
      assert.match(options.initialPrompt, /^Read the brief in inbox\/briefs\/.+\.md and do what it asks\.$/, 'the brief goes in a file, so the first message is one line');
      const brief = await briefOf(options);
      assert.match(brief, /read the ticket/i); assert.match(brief, /wait for me/i); assert.match(brief, /Do not start work/);
      assert.doesNotMatch(brief, WORKING, 'opening the chat is not a request to work');
    }
    assert.equal(await readFile(boardFile, 'utf8'), before, 'opening a chat leaves the board file, its state, tasks and checkboxes untouched');
    const [first] = created.filter(options => /^Character creation$/.test(options.name));
    const brief = await briefOf(first);
    assert.match(brief, /# Character creation/);
    assert.match(brief, /## Acceptance criteria\n\n- Pick a class/);
    assert.match(brief, /- \[ \] Class picker/);
    assert.equal(await stateOf('Character creation'), 'todo');

    // The deliberate goals still do what they say: shape fills in the ticket and leaves it in Backlog, build works on it and moves it to In progress.
    await run('start_work_chat', { title: 'character creation', goal: 'shape' });
    assert.match(await briefOf(created.at(-1)), /Please shape this item: write clear details/);
    assert.equal(await stateOf('Character creation'), 'todo', 'shaping is not starting work');
    const build = await run('start_work_chat', { title: 'character creation', goal: 'build', agent: 'codex' });
    assert.equal(build.agent, 'codex');
    assert.match(await briefOf(created.at(-1)), /Please work on this feature\. Check your plan against the acceptance criteria/);
    assert.equal(await stateOf('Character creation'), 'doing', 'work started moves it to In progress');
    await assert.rejects(run('start_work_chat', { title: 'no such thing' }), /No work item/);

    // "Jupiter, map my test project": a Claude chat in projects/test that can read the knowledge folder.
    await mkdir(path.join(repo, 'projects', 'test'), { recursive: true });
    const mapped = await run('map_project', { name: 'test' });
    assert.equal(mapped.folder, path.join(repo, 'projects', 'test'));
    const mapChat = created.at(-1);
    assert.equal(mapChat.agent, 'claude'); assert.equal(mapChat.cwd, path.join(repo, 'projects', 'test')); assert.equal(mapChat.readDir, path.join(repo, 'knowledge'));
    assert.match(mapChat.initialPrompt, /^Read the brief in inbox\/briefs\/.+\.md and do what it asks\.$/);
    await assert.rejects(run('map_project', { name: 'missing' }), /no folder called missing/);
  } finally { await service.close(); }
});
