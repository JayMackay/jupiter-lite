import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Sessions, chatProjects, createChatProject } from '../sessions.mjs';
import { createService } from '../server.mjs';
import { terminalCommand } from '../agents.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const exists = file => access(file).then(() => true, () => false);
async function tempRepo(name) {
  await mkdir(path.join(root, '.cache'), { recursive: true });
  return mkdtemp(path.join(root, '.cache', `${name}-`));
}
const chat = (sessions, id, extra = {}) => sessions.make({ id, name: id, agent: 'codex', nativeId: `019a0000-1111-4222-8333-44445555666${id.length}`, open: false, pinned: false, status: 'stopped', createdAt: '2026-11-01', updatedAt: '2026-11-01T00:00:00Z', cols: 80, rows: 25, ...extra });

test('deleting a chat removes Jupiter\'s record and closes a running chat, never the native transcript', async () => {
  const repo = await tempRepo('chat-delete');
  const stateDir = path.join(repo, '.jupiter');
  const sessions = await new Sessions(repo, stateDir).init();
  try {
    const transcript = path.join(repo, 'native-transcript.jsonl');
    await writeFile(transcript, '{"type":"message"}\n');
    sessions.items.set('kept', chat(sessions, 'kept'));
    sessions.items.set('old', chat(sessions, 'old'));
    // A running chat: its fake process exits when it is stopped.
    let killed = false;
    const running = chat(sessions, 'running', { open: true, status: 'running' });
    const listeners = [];
    running.process = { write() {}, kill() { killed = true; running.process = null; for (const listener of listeners) listener({ exitCode: 0 }); }, onExit(listener) { listeners.push(listener); return { dispose() {} }; } };
    sessions.items.set('running', running);
    for (const id of ['old', 'running']) {
      await sessions.hydrate(sessions.get(id));
      await writeFile(path.join(stateDir, `screen-${id}.json`), JSON.stringify({ data: 'screen' }));
      await writeFile(path.join(stateDir, `opencode-${id}.json`), '{}');
    }
    await sessions.persist();
    const removed = [];
    sessions.on('removed', event => removed.push(event.id));

    assert.deepEqual(await sessions.forget('old'), { deleted: true, id: 'old' });
    assert.deepEqual(await sessions.forget('running'), { deleted: true, id: 'running' });
    assert.ok(killed, 'the running chat was stopped');
    assert.deepEqual(removed, ['old', 'running']);
    assert.deepEqual(sessions.list().map(item => item.id), ['kept']);
    assert.throws(() => sessions.get('old'), /no longer exists/);
    const saved = JSON.parse(await readFile(path.join(stateDir, 'sessions.json'), 'utf8'));
    assert.deepEqual(saved.map(item => item.id), ['kept']);
    for (const id of ['old', 'running']) {
      assert.equal(await exists(path.join(stateDir, `screen-${id}.json`)), false);
      assert.equal(await exists(path.join(stateDir, `opencode-${id}.json`)), false);
    }
    assert.equal(await exists(transcript), true, 'the native CLI transcript stays on disk');
  } finally { await sessions.close(); }
});

test('the history route deletes one chat over HTTP', async () => {
  const repo = await tempRepo('chat-delete-route');
  const seed = await new Sessions(repo, path.join(repo, '.jupiter')).init();
  seed.items.set('a', chat(seed, 'a')); seed.items.set('b', chat(seed, 'b'));
  await seed.close();
  const service = await createService({ repo, uiDir: path.join(root, 'desktop', 'splash'), mcpOptions: { home: repo, env: {} } });
  try {
    const request = (route, data, method) => fetch(service.origin + '/api' + route, { method, headers: { Authorization: `Bearer ${service.token}`, 'Content-Type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data) });
    const deleted = await request('/sessions/a/history', {}, 'DELETE');
    assert.equal(deleted.status, 200);
    assert.deepEqual(await deleted.json(), { deleted: true, id: 'a' });
    assert.deepEqual(service.sessions.list().map(item => item.id), ['b']);
    assert.equal((await request('/sessions/a/history', {}, 'DELETE')).status, 404);
  } finally { await service.close(); }
});

test('new chats pick from <repo>/projects and can create a validated project folder', async () => {
  const repo = await tempRepo('chat-projects');
  const empty = await chatProjects(repo);
  assert.deepEqual(empty, { root: path.join(repo, 'projects'), projects: [] }, 'the projects folder is created when missing');
  await mkdir(path.join(repo, 'projects', 'beta'));
  await mkdir(path.join(repo, 'projects', '.hidden'));
  await writeFile(path.join(repo, 'projects', 'notes.md'), '');
  assert.deepEqual(await createChatProject(repo, ' Alpha game 2.0_v '), { name: 'Alpha game 2.0_v', path: path.join(repo, 'projects', 'Alpha game 2.0_v') });
  assert.deepEqual((await chatProjects(repo)).projects.map(item => item.name), ['Alpha game 2.0_v', 'beta']);
  for (const name of ['', '   ', '../escape', 'a/b', 'a\\b', '..', 'trailing.', 'CON', 'semi;colon', 'dash-name', 'x'.repeat(81), 7]) {
    await assert.rejects(createChatProject(repo, name), /letters, numbers, spaces, dots or underscores/, String(name));
  }
  await assert.rejects(createChatProject(repo, 'beta'), /already exists/);

  const service = await createService({ repo, uiDir: path.join(root, 'desktop', 'splash'), mcpOptions: { home: repo, env: {} } });
  try {
    const request = (route, data) => fetch(service.origin + '/api' + route, { method: data === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${service.token}`, 'Content-Type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data) });
    const created = await request('/chat-projects', { name: 'Gamma' });
    assert.equal(created.status, 201);
    assert.deepEqual((await (await request('/chat-projects')).json()).projects.map(item => item.name), ['Alpha game 2.0_v', 'beta', 'Gamma']);
    const refused = await request('/chat-projects', { name: '../../outside' });
    assert.equal(refused.status, 400);
  } finally { await service.close(); }
});

test('Claude chats add every readable folder after one --add-dir, after the first message', async () => {
  const bin = await mkdtemp(path.join(os.tmpdir(), 'jupiter-add-dir-'));
  for (const name of ['claude', 'codex']) await writeFile(path.join(bin, process.platform === 'win32' ? `${name}.exe` : name), '', { mode: 0o755 });
  const previous = process.env.PATH;
  process.env.PATH = bin;
  try {
    const knowledge = path.join(bin, 'knowledge'), handoffs = path.join(bin, 'handoffs');
    const first = terminalCommand('claude', { nativeId: '019a0000-1111-4222-8333-444455556666', initialPrompt: 'Start here.', readDir: handoffs, addDirs: [knowledge] });
    assert.equal(first.args[0], 'Start here.');
    assert.deepEqual(first.args.slice(-3), ['--add-dir', handoffs, knowledge]);
    const resumed = terminalCommand('claude', { resumeId: '019a0000-1111-4222-8333-444455556666', addDirs: [knowledge, knowledge] });
    assert.deepEqual(resumed.args.slice(-2), ['--add-dir', knowledge], 'a resumed chat keeps the knowledge folder, once');
    assert.ok(!terminalCommand('codex', { addDirs: [knowledge] }).args.includes('--add-dir'), 'Codex already reads outside its folder');
    const codex = terminalCommand('codex', {}).args;
    assert.equal(codex[codex.indexOf('tui.status_line=[]') - 1], '-c', 'Codex hides its model and folder status line');
    assert.throws(() => terminalCommand('claude', { addDirs: ['relative'] }), /absolute folder/);
    assert.throws(() => terminalCommand('claude', { addDirs: knowledge }), /absolute folder/);
  } finally { process.env.PATH = previous; }
});

