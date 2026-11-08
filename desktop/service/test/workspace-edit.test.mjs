import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createService } from '../server.mjs';
import { localDay } from '../workspace.mjs';
import { saveJson } from '../util.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

test('card edits are authenticated, scoped, persistent and preserve reports and concurrent metadata', async () => {
  await mkdir(path.join(root, '.cache'), { recursive: true });
  const repo = await mkdtemp(path.join(root, '.cache', 'workspace-edit-test-'));
  await mkdir(path.join(repo, 'workspace', 'sample'), { recursive: true });
  await mkdir(path.join(repo, 'ui'));
  await writeFile(path.join(repo, 'ui', 'index.html'), '<html>Fixture</html>');
  const file = path.join(repo, 'workspace', 'workspace.json');
  const report = path.join(repo, 'workspace', 'sample', 'report.html');
  await writeFile(report, '<h1>Keep this report</h1>');
  const first = { id: 'sample', title: 'A sample', category: 'research', status: 'active', type: 'group', folder: 'sample', created: '2026-01-01', steps: [{ name: 'Report', path: 'report.html' }], defaultStep: 0, custom: { keep: true } };
  const second = { ...first, id: 'other', title: 'Another card', status: 'done' };
  await writeFile(file, JSON.stringify({ entities: [first, second], unknownRoot: 'keep' }));
  const service = await createService({ repo, uiDir: path.join(repo, 'ui') });
  const headers = { Authorization: `Bearer ${service.token}`, 'Content-Type': 'application/json', Origin: service.origin };
  const edit = (patch, id = 'sample', extra = {}) => fetch(`${service.origin}/api/workspace/entities/${id}`, { method: 'PATCH', headers: { ...headers, ...extra }, body: JSON.stringify(patch) });
  try {
    assert.equal((await edit({ status: 'archived' }, 'sample', { Authorization: '' })).status, 401);
    assert.equal((await edit({ status: 'archived' }, 'sample', { Origin: service.files.origin })).status, 403);
    assert.equal((await edit({ status: 'archived' }, 'sample', { Origin: 'https://untrusted.example' })).status, 403);
    for (const patch of [{}, [], null, { status: 'deleted' }, { pinned: 'yes' }, { category: '../other' }, { category: '' }, { category: 'x'.repeat(65) }, { folder: 'elsewhere' }, { status: 'done', steps: [] }, { category: 7 }]) {
      assert.equal((await edit(patch)).status, 400, JSON.stringify(patch));
    }
    assert.equal((await edit({ status: 'done' }, 'missing')).status, 404);
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')).entities[0], first);
    // Independent actions may arrive together, but must patch the latest record.
    const responses = await Promise.all([edit({ status: 'done' }), edit({ category: '3d' }), edit({ pinned: true })]);
    assert.ok(responses.every(response => response.status === 200));
    let state = JSON.parse(await readFile(file, 'utf8'));
    assert.deepEqual(state.entities[0], { ...first, status: 'done', category: '3d', pinned: true, updated: localDay() });
    assert.deepEqual(state.entities[1], second); assert.equal(state.unknownRoot, 'keep');
    assert.equal((await (await edit({ status: 'archived' })).json()).status, 'archived');
    assert.equal((await (await edit({ status: 'active', category: 'dev', pinned: false })).json()).category, 'dev');
    state = JSON.parse(await readFile(file, 'utf8'));
    assert.equal(state.entities[0].status, 'active'); assert.equal(state.entities[0].pinned, false);
    assert.deepEqual(state.entities[0].steps, first.steps);
    assert.equal(await readFile(report, 'utf8'), '<h1>Keep this report</h1>');
    const response = await fetch(`${service.origin}/api/workspace`, { headers });
    assert.deepEqual(await response.json(), state);
    assert.ok((await readdir(path.dirname(file))).every(name => !name.endsWith('.tmp')));
  } finally { await service.close(); }
});

test('card titles and descriptions are trimmed, validated and saved without touching other fields', async () => {
  await mkdir(path.join(root, '.cache'), { recursive: true });
  const repo = await mkdtemp(path.join(root, '.cache', 'workspace-title-test-'));
  await mkdir(path.join(repo, 'workspace', 'sample'), { recursive: true });
  await mkdir(path.join(repo, 'ui'));
  await writeFile(path.join(repo, 'ui', 'index.html'), '<html>Fixture</html>');
  const file = path.join(repo, 'workspace', 'workspace.json');
  const card = { id: 'sample', title: 'Project Jupiter · Design Review', description: 'Old', category: 'research', status: 'active', type: 'group', folder: 'sample', created: '2026-01-01', steps: [{ name: 'Design review', path: 'review.html' }] };
  await writeFile(file, JSON.stringify({ entities: [card] }));
  const service = await createService({ repo, uiDir: path.join(repo, 'ui') });
  const headers = { Authorization: `Bearer ${service.token}`, 'Content-Type': 'application/json', Origin: service.origin };
  const edit = patch => fetch(`${service.origin}/api/workspace/entities/sample`, { method: 'PATCH', headers, body: JSON.stringify(patch) });
  try {
    for (const patch of [{ title: '' }, { title: '   ' }, { title: 'x'.repeat(201) }, { title: 7 }, { title: 'Bad\nline' }, { description: 5 }, { description: 'x'.repeat(2001) }, { title: 'Fine', folder: 'x' }]) {
      assert.equal((await edit(patch)).status, 400, JSON.stringify(patch));
    }
    assert.equal(JSON.parse(await readFile(file, 'utf8')).entities[0].title, card.title);
    const saved = await edit({ title: '  Project Jupiter · Final Review  ', description: '  A new summary.  ' });
    assert.equal(saved.status, 200);
    assert.equal((await saved.json()).title, 'Project Jupiter · Final Review');
    assert.equal((await edit({ title: 'x'.repeat(200) })).status, 200);
    const stored = JSON.parse(await readFile(file, 'utf8')).entities[0];
    assert.deepEqual(stored, { ...card, title: 'x'.repeat(200), description: 'A new summary.', updated: localDay() });
  } finally { await service.close(); }
});

test('Edit page starts a visible Claude Code chat scoped to one page of the card', async () => {
  await mkdir(path.join(root, '.cache'), { recursive: true });
  const repo = await mkdtemp(path.join(root, '.cache', 'workspace-page-test-'));
  for (const folder of ['sample', 'other']) await mkdir(path.join(repo, 'workspace', folder), { recursive: true });
  await mkdir(path.join(repo, 'ui'));
  await writeFile(path.join(repo, 'ui', 'index.html'), '<html>Fixture</html>');
  await writeFile(path.join(repo, 'workspace', 'sample', 'review.html'), '<h1>Design review</h1>');
  await writeFile(path.join(repo, 'workspace', 'sample', 'data.json'), '{}');
  await writeFile(path.join(repo, 'workspace', 'other', 'secret.html'), '<h1>Another card</h1>');
  const card = { id: 'sample', title: 'Project Jupiter · Design Review', description: '', category: 'research', status: 'active', type: 'group', folder: 'sample', created: '2026-01-01', steps: [{ name: 'Design review', path: 'review.html' }] };
  await writeFile(path.join(repo, 'workspace', 'workspace.json'), JSON.stringify({ entities: [card, { ...card, id: 'other', folder: 'other' }] }));
  const service = await createService({ repo, uiDir: path.join(repo, 'ui') });
  const created = [];
  service.sessions.create = async options => { created.push(options); return { id: 'chat-1', name: options.name, agent: options.agent }; };
  const realGet = service.sessions.get.bind(service.sessions);
  service.sessions.get = id => id === 'chat-1' ? { id } : realGet(id);
  const headers = { Authorization: `Bearer ${service.token}`, 'Content-Type': 'application/json', Origin: service.origin };
  const ask = (body, id = 'sample', extra = {}) => fetch(`${service.origin}/api/workspace/entities/${id}/edit-page`, { method: 'POST', headers: { ...headers, ...extra }, body: JSON.stringify(body) });
  try {
    assert.equal((await ask({ path: 'review.html', request: 'Add a section on voice' }, 'sample', { Authorization: '' })).status, 401);
    for (const body of [{ path: 'review.html', request: '' }, { path: 'review.html', request: '   ' }, { path: 'review.html', request: 'x'.repeat(4001) }, { path: 'review.html' }, { request: 'Add a section' },
      { path: '../other/secret.html', request: 'Add a section' }, { path: 'workspace/other/secret.html', request: 'Add a section' }, { path: path.join(repo, 'workspace', 'other', 'secret.html'), request: 'Add a section' },
      { path: 'data.json', request: 'Add a section' }, { path: '..\\other\\secret.html', request: 'Add a section' }]) {
      const response = await ask(body);
      // Paths are always resolved inside this card's folder, so another card's page is outside (403) or simply absent (404).
      assert.ok([400, 403, 404].includes(response.status), `${JSON.stringify(body)} gave ${response.status}`);
    }
    assert.equal((await ask({ path: 'missing.html', request: 'Add a section' })).status, 404);
    assert.equal((await ask({ path: 'review.html', request: 'Add a section' }, 'missing')).status, 404);
    assert.equal(created.length, 0, 'Rejected requests must never start a chat');

    const response = await ask({ path: 'workspace/sample/review.html', request: '  Add a section on voice  ' });
    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), { sessionId: 'chat-1', chat: 'Edit Design review', path: 'workspace/sample/review.html' });
    assert.equal(created.length, 1);
    const [options] = created;
    assert.equal(options.agent, 'claude'); assert.equal(options.cwd, repo); assert.equal(options.name, 'Edit Design review');
    // The first message is one plain line pointing at the brief.
    const match = /^Read the brief in (inbox\/briefs\/[^\s]+\.md) and do what it asks\.$/.exec(options.initialPrompt);
    assert.ok(match, options.initialPrompt);
    const brief = await readFile(path.join(repo, match[1]), 'utf8');
    assert.match(brief, /File: workspace\/sample\/review\.html/);
    assert.match(brief, /Add a section on voice/);
    assert.match(brief, /Edit this file only/);
    assert.match(brief, /existing style/);
    assert.doesNotMatch(brief, /secret\.html/);
    assert.equal(await readFile(path.join(repo, 'workspace', 'sample', 'review.html'), 'utf8'), '<h1>Design review</h1>');
    const plain = await ask({ path: 'review.html', request: 'Fix the typo' });
    assert.equal(plain.status, 201);

    // A saved page is announced so an open viewer reloads it.
    const changed = new Promise(resolve => { void service.workspace.editPage('sample', { path: 'review.html', request: 'Watch' }, resolve); });
    await new Promise(resolve => setTimeout(resolve, 100));
    await writeFile(path.join(repo, 'workspace', 'sample', 'review.html'), '<h1>Design review</h1><h2>Voice</h2>');
    assert.equal(await Promise.race([changed, new Promise(resolve => setTimeout(() => resolve('timeout'), 4000))]), 'workspace/sample/review.html');
  } finally { await service.close(); }
});

test('failed atomic JSON replacement removes only its temporary file', async () => {
  await mkdir(path.join(root, '.cache'), { recursive: true });
  const directory = await mkdtemp(path.join(root, '.cache', 'workspace-save-test-'));
  const target = path.join(directory, 'keep-directory');
  await mkdir(target); await writeFile(path.join(target, 'keep.txt'), 'unchanged');
  await assert.rejects(saveJson(target, { value: 'new' }));
  assert.deepEqual(await readdir(directory), ['keep-directory']);
  assert.equal(await readFile(path.join(target, 'keep.txt'), 'utf8'), 'unchanged');
});
