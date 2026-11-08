// Workspace card links: a registered card opens inside Jupiter, everything else keeps its behaviour.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { createService } from '../server.mjs';
import { cardLink, mayBeCardLink, unknownCardMessage } from '../workspace-links.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const APP = 'http://127.0.0.1:41234';
const entities = [{ id: 'ashengard-8b5961c4', title: 'Ashengard', steps: [{ name: 'Overview', path: 'overview.md' }, { name: 'Notes', path: 'notes.md' }] }, { id: 'solo', title: 'Solo', steps: [] }];
const link = href => cardLink(href, { appOrigin: APP, entities });

test('a registered card link opens as a card on the app address, a preview address or any local address', () => {
  assert.deepEqual(link('http://127.0.0.1:5187/#/ashengard-8b5961c4'), { kind: 'card', id: 'ashengard-8b5961c4', step: -1, title: 'Ashengard' }, 'the stopped dev server from the report');
  assert.deepEqual(link(`${APP}/#/ashengard-8b5961c4/1`), { kind: 'card', id: 'ashengard-8b5961c4', step: 1, title: 'Ashengard' });
  assert.deepEqual(link('http://localhost:3009/#/solo'), { kind: 'card', id: 'solo', step: -1, title: 'Solo' });
  assert.deepEqual(link('#/ashengard-8b5961c4/0'), { kind: 'card', id: 'ashengard-8b5961c4', step: 0, title: 'Ashengard' }, 'a bare card route belongs to the app it is shown in');
  assert.equal(link('http://127.0.0.1:5187/#/ashengard-8b5961c4/7').step, -1, 'a page that does not exist falls back to the default page');
  assert.match(link('http://127.0.0.1:5187/#/ashengard-8b5961c4/7').note, /Page 8 does not exist/);
  assert.deepEqual(link(`${APP}/`), { kind: 'home' });
  assert.deepEqual(link('http://127.0.0.1:4173/#/'), { kind: 'home' });
});

test('an unknown or removed card is reported on Jupiter addresses and left alone elsewhere', () => {
  assert.deepEqual(link(`${APP}/#/removed-card`), { kind: 'unknown', id: 'removed-card' });
  assert.deepEqual(link('http://127.0.0.1:3009/#/removed-card'), { kind: 'unknown', id: 'removed-card' });
  assert.deepEqual(link('http://localhost:3000/#/settings'), { kind: 'other' }, 'another local tool with its own route');
  assert.match(unknownCardMessage('removed-card'), /removed-card.*not in Jupiter.*removed or renamed/);
  assert.doesNotMatch(unknownCardMessage('removed-card').replace('removed-card', ''), /[-\u2013\u2014]/, 'no hyphens or dashes in the copy');
});

test('ordinary links keep their behaviour: websites, other local tools, other paths and other schemes', () => {
  for (const href of ['https://example.com/#/ashengard-8b5961c4', 'https://github.com/org/repo', 'http://localhost:3000/', 'http://127.0.0.1:5187/', 'http://127.0.0.1:5187/docs/#/ashengard-8b5961c4', `${APP}/api/sessions`, 'mailto:a@b.c', 'file:///C:/x.md', 'javascript:alert(1)', 'http://user:pw@127.0.0.1:5187/#/solo', '', 'not a url', 'http://127.0.0.1:5187/#section', 'http://127.0.0.1:5187/#/solo/extra/path']) {
    assert.equal(mayBeCardLink(href, APP), false, href);
    assert.deepEqual(cardLink(href, { appOrigin: APP, entities }), { kind: 'other' }, href);
  }
});

async function fixture() {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'jupiter-links-'));
  await mkdir(path.join(repo, 'workspace'));
  await writeFile(path.join(repo, 'workspace/workspace.json'), JSON.stringify({ entities }));
  const events = [];
  const service = await createService({ repo, uiDir: path.join(root, 'dist'), native: event => events.push(event), mcpOptions: { home: repo, env: {} } });
  const post = async (route, data) => (await fetch(service.origin + '/api' + route, { method: 'POST', headers: { Authorization: `Bearer ${service.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(data) })).json();
  // A stand-in Workspace window: it signs in over the same socket the real one uses.
  const connect = surface => new Promise((resolve, reject) => {
    const socket = new WebSocket(service.origin.replace('http', 'ws') + '/events', { origin: service.origin }), received = [];
    socket.on('open', () => socket.send(JSON.stringify({ type: 'auth', token: service.token, clientId: `${surface}-1`, surface })));
    socket.on('message', data => { const event = JSON.parse(String(data)); received.push(event); if (event.type === 'connected') resolve({ socket, received }); });
    socket.on('error', reject);
  });
  return { service, events, post, connect };
}

test('the service opens a registered card in the Workspace window and says whether anyone received it', async () => {
  const { service, events, post, connect } = await fixture();
  try {
    const before = await post('/workspace/link', { href: 'http://127.0.0.1:5187/#/ashengard-8b5961c4/1' });
    assert.deepEqual([before.handled, before.shown, before.route, before.title], [true, false, '#/ashengard-8b5961c4/1', 'Ashengard'], 'no Workspace window is connected yet, so it is not claimed as shown');
    const workspace = await connect('workspace'), chats = await connect('chats');
    const result = await post('/workspace/link', { href: 'http://127.0.0.1:5187/#/ashengard-8b5961c4/1' });
    assert.deepEqual([result.handled, result.shown, result.route], [true, true, '#/ashengard-8b5961c4/1']);
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.deepEqual(workspace.received.filter(event => event.type === 'navigate').map(event => [event.window, event.route]), [['workspace', '#/ashengard-8b5961c4/1']]);
    assert.ok(events.some(event => event.type === 'window' && event.action === 'show' && event.window === 'workspace'), 'the native Workspace window is brought forward');
    assert.equal(chats.received.some(event => event.type === 'selection'), false, 'the chat is not changed');
    workspace.socket.close(); chats.socket.close();
  } finally { await service.close(); }
});

test('unknown cards give feedback, and other links are not handled', async () => {
  const { service, post } = await fixture();
  try {
    const unknown = await post('/workspace/link', { href: 'http://127.0.0.1:3009/#/removed-card' });
    assert.deepEqual([unknown.handled, unknown.shown], [true, false]); assert.match(unknown.error, /removed-card.*not in Jupiter/);
    for (const href of ['https://example.com/', 'http://localhost:3000/#/settings', 'http://127.0.0.1:5187/', '', 5]) assert.deepEqual(await post('/workspace/link', { href }), { handled: false }, String(href));
    await assert.rejects(service.coordinator.execute('show_workspace', { entityId: 'removed-card' }, 'op', ''), /No Workspace card has the ID "removed-card"/);
  } finally { await service.close(); }
});
