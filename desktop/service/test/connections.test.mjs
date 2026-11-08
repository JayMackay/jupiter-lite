import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ConnectionsOverview, connectionState } from '../connections.mjs';

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'jupiter-connections-'));
  const home = path.join(root, 'home'), repo = path.join(root, 'workspace'), game = path.join(root, 'game'), art = path.join(root, 'art'), gone = path.join(root, 'deleted');
  for (const dir of [home, path.join(home, '.codex'), repo, game, art]) await mkdir(dir, { recursive: true });
  await writeFile(path.join(home, '.claude.json'), JSON.stringify({
    mcpServers: { docs: { url: 'https://docs.example/mcp', headers: { Authorization: 'Bearer secret-user-token' } } },
    projects: { [art]: { mcpServers: { blender: { command: 'definitely-not-installed-blender-mcp' } } } },
  }));
  await writeFile(path.join(home, '.codex/config.toml'), '[mcp_servers.browser]\nurl = "https://browser.example/mcp"\n');
  await writeFile(path.join(game, '.mcp.json'), JSON.stringify({ mcpServers: { unity: { url: 'https://unity.example/mcp' }, keyed: { url: 'https://keyed.example/mcp', headers: { Authorization: '${MISSING_UNITY_KEY}' } } } }));
  await writeFile(path.join(home, '.claude-settings-placeholder'), '');
  const projects = async () => [
    { path: game, name: 'game', pinned: true }, { path: art, name: 'art', pinned: false },
    { path: gone, name: 'deleted', pinned: false }, { path: repo, name: 'workspace', pinned: false },
  ];
  const probes = [];
  const probe = async entry => { probes.push(entry.data.name); return { status: 'available', toolCount: 4 }; };
  const overview = new ConnectionsOverview({ repo, projects, mcpOptions: { home, env: { MISSING_UNITY_KEY: '' }, probe } });
  return { overview, repo, game, art, gone, probes };
}

test('servers available everywhere are listed once; project servers are grouped by project', async () => {
  const { overview, repo, game, art } = await fixture();
  const result = await overview.overview();
  assert.equal(result.scanned, 3, 'workspace, game and art; the deleted folder is skipped');
  assert.deepEqual(result.everywhere.map(server => `${server.client}:${server.name}`).sort(), ['claude:docs', 'codex:browser']);
  const names = Object.fromEntries(result.projects.map(project => [project.path, project.servers.map(server => server.name).sort()]));
  assert.deepEqual(names[game], ['keyed', 'unity']);
  assert.deepEqual(names[art], ['blender']);
  assert.equal(names[repo], undefined, 'a project with no servers of its own is not shown');
  const state = Object.fromEntries(result.projects.flatMap(project => project.servers).map(server => [server.name, server.state]));
  assert.equal(state.keyed, 'setup', 'a missing environment variable needs setup');
  assert.equal(state.blender, 'setup', 'a missing local command needs setup');
  assert.equal(result.summary.total, 5);
  assert.doesNotMatch(JSON.stringify(result), /secret-user-token/, 'credential values never reach the dashboard');
});

test('a check runs only for a listed project and then shows as online with its tool count', async () => {
  const { overview, game, gone, probes } = await fixture();
  const before = await overview.overview();
  const docs = before.everywhere.find(server => server.name === 'docs');
  await assert.rejects(overview.check(gone, docs.id), /not in your project list/);
  await assert.rejects(overview.check(game, 42), /Choose a connection/);
  const result = await overview.check(docs.project, docs.id);
  assert.equal(result.status, 'available');
  assert.deepEqual(probes, ['docs']);
  const after = await overview.overview();
  const checked = after.everywhere.find(server => server.name === 'docs');
  assert.equal(checked.state, 'online');
  assert.equal(after.summary.tools, 4);
});

test('state labels cover every readiness', () => {
  assert.equal(connectionState({ enabled: false, readiness: 'disabled' }), 'off');
  assert.equal(connectionState({ enabled: true, readiness: 'approval' }), 'setup');
  assert.equal(connectionState({ enabled: true, readiness: 'managed' }), 'managed');
  assert.equal(connectionState({ enabled: true, readiness: 'configured' }), 'ready');
  assert.equal(connectionState({ enabled: true, readiness: 'configured', connection: { status: 'timeout', stale: false } }), 'problem');
  assert.equal(connectionState({ enabled: true, readiness: 'configured', connection: { status: 'available', stale: true } }), 'ready');
});
