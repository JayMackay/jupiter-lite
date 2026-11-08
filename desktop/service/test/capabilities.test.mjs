import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Capabilities, MAX_TAGS, addCodexBlock, addEnvVars, agentSupport, cardTags, inspectCheckout, removeCodexBlock } from '../capabilities.mjs';

const SHA = 'a'.repeat(40);
const exists = async file => { try { await stat(file); return true; } catch { return false; } };
const write = async (file, text) => { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, typeof text === 'string' ? text : JSON.stringify(text)); };

const CATALOG = {
  categories: [{ id: 'harness', label: 'Harness', blurb: '' }, { id: 'tools', label: 'Tools', blurb: '' }],
  items: [
    { id: 'helper', cat: 'harness', name: 'helper', repo: 'someone/helper', status: 'take', stars: 10, why: '', what: '', agents: ['Claude Code', 'Codex'], tags: [],
      setup: { kind: 'plugin', marketplace: 'helper-market', plugins: ['helper'], codexSkills: { from: 'skills', names: ['plan'] } } },
    { id: 'terse', cat: 'harness', name: 'terse', repo: 'someone/terse', status: 'take', stars: 1, why: '', what: '', agents: [], tags: [],
      setup: { kind: 'skills', from: 'skills', names: ['terse'], agents: ['claude', 'codex'] } },
    { id: 'browser', cat: 'tools', name: 'browser', repo: 'someone/browser', status: 'take', stars: 1, why: '', what: '', agents: [], tags: [],
      setup: { kind: 'mcp', server: 'browser', package: '@someone/browser-mcp', agents: ['claude', 'codex'], env: ['BROWSER_KEY'] } },
    { id: 'later', cat: 'tools', name: 'later', status: 'take', stars: null, why: '', what: '', agents: [], tags: [], setup: { kind: 'manual', note: 'Sign in first.' } },
    { id: 'nope', cat: 'tools', name: 'nope', status: 'skip', stars: null, why: '', what: '', agents: [], tags: [] },
  ],
};

// A stand-in for git, npm, claude and codex: records every call and fakes their effects.
async function setup({ failOn } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'jupiter-cap-'));
  const repo = path.join(root, 'repo'), home = path.join(root, 'home'), project = path.join(root, 'game');
  await write(path.join(repo, 'knowledge/capabilities.json'), CATALOG);
  await mkdir(project, { recursive: true });
  await write(path.join(home, '.codex/config.toml'), '# my settings\nmodel = "gpt"\n');
  const calls = [];
  const run = async (file, args, { cwd } = {}) => {
    const name = path.basename(file).replace(/\.exe$/, '');
    calls.push({ name, args, cwd });
    if (failOn && args.join(' ').includes(failOn)) throw new Error(`failed: ${failOn}`);
    if (name === 'git' && args[0] === 'ls-remote') return { stdout: `${SHA}\tHEAD\n` };
    if (name === 'git' && args.includes('rev-parse')) return { stdout: `${SHA}\n` };
    if (name === 'git' && args.includes('checkout')) {
      await write(path.join(cwd, '.claude-plugin/marketplace.json'), { name: 'helper-market', plugins: [{ name: 'helper', source: './' }, { name: 'remote-one', source: { source: 'github', repo: 'else/where' } }] });
      await write(path.join(cwd, 'hooks/hooks.json'), { hooks: { SessionStart: [{ matcher: 'startup', hooks: [{ type: 'command', command: 'node hooks/start.js' }] }] } });
      await write(path.join(cwd, 'skills/plan/SKILL.md'), '# plan');
      await write(path.join(cwd, 'skills/terse/SKILL.md'), '# terse');
      await write(path.join(cwd, 'package.json'), { scripts: { postinstall: 'node setup.js' } });
      return { stdout: '' };
    }
    if (name === 'npm' && args[0] === 'view') return { stdout: '1.2.3\n' };
    if (name === 'codex' && args[1] === 'add') {
      const file = path.join(home, '.codex/config.toml');
      await writeFile(file, `${await readFile(file, 'utf8')}\n[mcp_servers.${args[2]}]\ncommand = "x"\n`);
    }
    return { stdout: '' };
  };
  const projects = async () => [{ path: project, name: 'game' }];
  const manager = new Capabilities({ repo, stateDir: path.join(repo, '.jupiter'), home, env: {}, run, which: name => ['claude', 'codex'].includes(name) ? `C:/bin/${name}.exe` : null, projects });
  return { root, repo, home, project, calls, manager };
}

test('inspection lists hooks, skills, install scripts and code from outside the pin', async () => {
  const { manager, calls } = await setup();
  const review = await manager.review('helper');
  assert.equal(review.commit, SHA);
  assert.deepEqual(review.found.hooks.map(hook => [hook.event, hook.command]), [['SessionStart', 'node hooks/start.js']]);
  assert.deepEqual(review.found.skills.map(skill => skill.name).sort(), ['plan', 'terse']);
  assert.match(review.found.installScripts[0], /postinstall: node setup.js/);
  assert.match(review.found.outside[0], /remote-one: else\/where/);
  assert.ok(calls.some(call => call.args.includes('fetch') && call.args.includes(SHA)), 'fetches exactly the pinned commit');
  assert.ok(calls.some(call => call.args.includes('core.hooksPath=NUL')), 'git hooks never run during the fetch');
  // A second review of the same commit reuses the checkout instead of downloading again.
  const fetches = calls.filter(call => call.args.includes('fetch')).length;
  await manager.review('helper');
  assert.equal(calls.filter(call => call.args.includes('fetch')).length, fetches);
});

test('a plugin with hooks needs the review token and an explicit hook acknowledgement, and removes cleanly', async () => {
  const { manager, calls, repo, home } = await setup();
  await assert.rejects(manager.install('helper', {}), /Review this capability/);
  const review = await manager.review('helper');
  await assert.rejects(manager.install('helper', { token: 'wrong' }), /Review this capability again/);
  await assert.rejects(manager.install('helper', { token: review.token }), /hooks/);
  const listed = await manager.install('helper', { token: review.token, acceptHooks: true });
  const commands = calls.filter(call => call.name === 'claude').map(call => call.args.join(' '));
  assert.ok(commands[0].startsWith('plugin marketplace add ') && commands[0].includes(SHA), 'marketplace comes from the pinned checkout');
  assert.equal(commands[1], 'plugin install helper@helper-market --scope user');
  assert.ok(await exists(path.join(home, '.agents/skills/plan/SKILL.md')), 'Codex gets the skill');
  const lock = JSON.parse(await readFile(path.join(repo, 'knowledge/capabilities.lock.json'), 'utf8'));
  assert.equal(lock.installed.helper.commit, SHA);
  assert.equal(lock.installed.helper.hooks, 1);
  assert.equal(listed.items.find(item => item.id === 'helper').state, 'installed');
  await assert.rejects(manager.install('helper', { token: review.token, acceptHooks: true }), /Review this capability again/, 'a review token works once');

  await manager.remove('helper');
  const undo = calls.filter(call => call.name === 'claude').slice(2).map(call => call.args.join(' '));
  assert.deepEqual(undo, ['plugin uninstall helper@helper-market', 'plugin marketplace remove helper-market']);
  assert.equal(await exists(path.join(home, '.agents/skills/plan')), false);
  assert.deepEqual(JSON.parse(await readFile(path.join(repo, 'knowledge/capabilities.lock.json'), 'utf8')).installed, {});
});

test('an existing marketplace of the same name is never silently replaced', async () => {
  const { manager, home } = await setup();
  await write(path.join(home, '.claude/plugins/known_marketplaces.json'), { 'helper-market': { source: { source: 'github', repo: 'someone/helper' } } });
  await assert.rejects(manager.review('helper'), /already has a marketplace called helper-market/);
});

test('skills are copied to both agents with a marker, and a skill Jupiter did not install is left alone', async () => {
  const { manager, home } = await setup();
  await write(path.join(home, '.claude/skills/terse/SKILL.md'), '# mine');
  const review = await manager.review('terse');
  await assert.rejects(manager.install('terse', { token: review.token }), /did not install/);
  assert.equal(await readFile(path.join(home, '.claude/skills/terse/SKILL.md'), 'utf8'), '# mine');
  assert.equal(await exists(path.join(home, '.agents/skills/terse')), false, 'nothing is left half-installed');
  await writeFile(path.join(home, '.claude/skills/terse/SKILL.md'), '# mine');
  const { rm } = await import('node:fs/promises'); await rm(path.join(home, '.claude/skills/terse'), { recursive: true });
  const again = await manager.review('terse');
  await manager.install('terse', { token: again.token });
  const marker = JSON.parse(await readFile(path.join(home, '.claude/skills/terse/.jupiter-capability.json'), 'utf8'));
  assert.deepEqual(marker, { id: 'terse', repo: 'someone/terse', commit: SHA });
  assert.ok(await exists(path.join(home, '.agents/skills/terse/SKILL.md')));
});

test('an MCP tool is pinned to a package version, keeps keys out of files and is switched on per project', async () => {
  const { manager, calls, home, project, repo } = await setup();
  const review = await manager.review('browser', ['everywhere', project]);
  assert.equal(review.version, '1.2.3');
  assert.deepEqual(review.env, ['BROWSER_KEY']);
  await manager.install('browser', { token: review.token });
  const claude = calls.filter(call => call.name === 'claude');
  const launch = process.platform === 'win32' ? 'cmd /c npx -y @someone/browser-mcp@1.2.3' : 'npx -y @someone/browser-mcp@1.2.3';
  assert.equal(claude[0].args.join(' '), `mcp add --scope user browser -- ${launch}`);
  assert.equal(claude[1].args.join(' '), `mcp add --scope project browser -- ${launch}`);
  assert.equal(claude[1].cwd, project);
  assert.ok(!calls.some(call => call.args.join(' ').includes('BROWSER_KEY=')), 'no key value is ever passed');
  const codexUser = await readFile(path.join(home, '.codex/config.toml'), 'utf8');
  assert.match(codexUser, /^# my settings/);
  assert.match(codexUser, /\[mcp_servers\.browser\]\nenv_vars = \["BROWSER_KEY"\]/);
  const codexProject = await readFile(path.join(project, '.codex/config.toml'), 'utf8');
  assert.match(codexProject, /# Added by Jupiter \(capability browser\)/);
  assert.match(codexProject, /args = \[.*"@someone\/browser-mcp@1\.2\.3"\]/);

  await manager.remove('browser', { target: project });
  assert.doesNotMatch(await readFile(path.join(project, '.codex/config.toml'), 'utf8'), /browser/);
  let lock = JSON.parse(await readFile(path.join(repo, 'knowledge/capabilities.lock.json'), 'utf8'));
  assert.deepEqual(lock.installed.browser.targets, ['everywhere']);
  assert.ok(calls.some(call => call.name === 'claude' && call.args.join(' ') === 'mcp remove --scope project browser' && call.cwd === project));

  // Adding it back to a project reuses the reviewed version without another review.
  await manager.install('browser', { targets: [project] });
  lock = JSON.parse(await readFile(path.join(repo, 'knowledge/capabilities.lock.json'), 'utf8'));
  assert.deepEqual(lock.installed.browser.targets, ['everywhere', project]);
  assert.equal(lock.installed.browser.version, '1.2.3');
});

test('a failed step rolls back what already ran', async () => {
  const { manager, calls, repo } = await setup({ failOn: 'plugin install' });
  const review = await manager.review('helper');
  await assert.rejects(manager.install('helper', { token: review.token, acceptHooks: true }), /rolled back/);
  assert.ok(calls.some(call => call.args.join(' ') === 'plugin marketplace remove helper-market'));
  assert.equal(await exists(path.join(repo, 'knowledge/capabilities.lock.json')), false);
});

test('manual and skipped picks cannot be installed, and the list reports state', async () => {
  const { manager } = await setup();
  await assert.rejects(manager.review('later'), /Sign in first/);
  await assert.rejects(manager.review('nope'), /set up by hand/);
  await assert.rejects(manager.review('missing'), /not in the catalogue/);
  const list = await manager.list();
  assert.deepEqual(Object.fromEntries(list.items.map(item => [item.id, item.state])), { helper: 'available', terse: 'available', browser: 'available', later: 'manual', nope: 'skip' });
  assert.equal(list.projects[0].name, 'game');
});

test('Codex settings edits keep the rest of the file intact', () => {
  const text = '# keep me\n[mcp_servers.a]\ncommand = "x"\n\n[other]\nk = 1\n';
  assert.equal(addEnvVars(text, 'a', ['K']), '# keep me\n[mcp_servers.a]\nenv_vars = ["K"]\ncommand = "x"\n\n[other]\nk = 1\n');
  assert.equal(addEnvVars(addEnvVars(text, 'a', ['K']), 'a', ['K']), addEnvVars(text, 'a', ['K']), 'idempotent');
  const added = addCodexBlock(text, 'cap', 'b', 'npx', ['-y', 'b@1'], []);
  assert.throws(() => addCodexBlock(added, 'cap', 'b', 'npx', [], []), /already have a server/);
  assert.equal(removeCodexBlock(added, 'cap', 'b').trimEnd(), text.trimEnd());
  assert.equal(removeCodexBlock(text, 'cap', 'a'), text, 'never removes a block Jupiter did not add');
});

test('inspectCheckout reads plugin.json hooks and .mcp.json servers', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'jupiter-inspect-'));
  await write(path.join(root, 'plugins/x/.claude-plugin/plugin.json'), { name: 'x', hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'rtk rewrite' }] }] } });
  await write(path.join(root, '.mcp.json'), { mcpServers: { mem: { command: 'npx', args: ['-y', 'mem'] } } });
  await write(path.join(root, 'commands/go.md'), '#');
  const found = await inspectCheckout(root);
  assert.deepEqual(found.hooks.map(hook => [hook.event, hook.matcher, hook.command]), [['PreToolUse', 'Bash', 'rtk rewrite']]);
  assert.deepEqual(found.mcpServers, [{ name: 'mem', command: 'npx -y mem' }]);
  assert.equal(found.commands, 1);
});

test('a "*" skill list takes every skill folder, and Python and npm tools are pinned to exact versions', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'jupiter-cap-'));
  const repo = path.join(root, 'repo'), home = path.join(root, 'home');
  await write(path.join(repo, 'knowledge/capabilities.json'), { categories: [], items: [
    { id: 'all', name: 'all', repo: 'a/all', status: 'take', setup: { kind: 'skills', from: 'skills', names: ['*'], agents: ['codex'] } },
    { id: 'py', name: 'py', status: 'take', setup: { kind: 'uv-tool', package: 'graphifyy', bin: 'graphify' } },
    { id: 'cli', name: 'cli', status: 'take', setup: { kind: 'npm-cli', package: '@x/cli', bin: 'x' } },
  ] });
  const calls = [];
  const run = async (file, args, { cwd } = {}) => {
    calls.push([path.basename(file), ...args].join(' '));
    if (args[0] === 'ls-remote') return { stdout: `${SHA}\tHEAD` };
    if (args.includes('rev-parse')) return { stdout: SHA };
    if (args.includes('checkout')) { for (const name of ['one', 'two']) await write(path.join(cwd, 'skills', name, 'SKILL.md'), '#'); await write(path.join(cwd, 'skills/not-a-skill/readme.md'), '#'); await write(path.join(cwd, 'hooks/hooks.json'), { hooks: { Stop: [{ hooks: [{ command: 'x' }] }] } }); }
    if (args[0] === 'view' && args.includes('scripts')) return { stdout: '{"postinstall":"node fetch.js","test":"x"}' };
    if (args[0] === 'view') return { stdout: '2.0.0' };
    return { stdout: '' };
  };
  const manager = new Capabilities({ repo, stateDir: path.join(root, 'state'), home, env: {}, run, which: name => name === 'uv' ? 'C:/bin/uv.exe' : null, fetchJson: async url => { assert.equal(url, 'https://pypi.org/pypi/graphifyy/json'); return { info: { version: '0.9.100' } }; } });
  const skills = await manager.review('all');
  assert.deepEqual(skills.skills, ['one', 'two']);
  assert.equal(skills.found.hooks.length, 0, 'a skills-only install reviews only the copied folders, not the rest of the repo');
  await manager.install('all', { token: skills.token });
  assert.ok(await exists(path.join(home, '.agents/skills/two/SKILL.md')));
  const py = await manager.review('py');
  assert.equal(py.version, '0.9.100');
  await manager.install('py', { token: py.token });
  assert.ok(calls.includes('uv.exe tool install graphifyy==0.9.100'));
  const cli = await manager.review('cli');
  assert.match(cli.found.installScripts[0], /postinstall: node fetch.js \(not run: installed with --ignore-scripts\)/);
  await manager.install('cli', { token: cli.token });
  assert.ok(calls.includes('npm install --global --ignore-scripts @x/cli@2.0.0'));
  await manager.remove('py');
  assert.ok(calls.includes('uv.exe tool uninstall graphifyy'));
});

test('check for updates compares commits and versions, and an update with changed hooks waits for confirmation', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'jupiter-cap-'));
  const repo = path.join(root, 'repo'), home = path.join(root, 'home');
  await write(path.join(repo, 'knowledge/capabilities.json'), { categories: [], items: [
    { id: 'plug', name: 'plug', repo: 'a/plug', status: 'take', setup: { kind: 'plugin', marketplace: 'm', plugins: ['plug'] } },
    { id: 'tool', name: 'tool', repo: 'a/tool', status: 'take', setup: { kind: 'mcp', server: 'tool', package: 'tool-mcp', agents: ['claude'] } },
    { id: 'gh', name: 'gh', status: 'take', setup: { kind: 'mcp', server: 'gh', url: 'https://x/readonly', headerEnv: 'T', agents: ['claude'] } },
  ] });
  let head = SHA, version = '1.0.0', hookCommand = 'node a.js', failInstall = false;
  const calls = [];
  const run = async (file, args, { cwd } = {}) => {
    calls.push(args.join(' '));
    if (args[0] === 'ls-remote') return { stdout: `${head}\tHEAD` };
    if (args.includes('rev-parse')) return { stdout: path.basename(cwd) };
    if (args.includes('checkout')) { await write(path.join(cwd, '.claude-plugin/marketplace.json'), { name: 'm', plugins: [{ name: 'plug', source: './' }] }); await write(path.join(cwd, 'hooks/hooks.json'), { hooks: { SessionStart: [{ hooks: [{ command: hookCommand }] }] } }); }
    if (args[0] === 'view') return { stdout: version };
    if (failInstall && args[0] === 'plugin' && args[1] === 'install') { failInstall = false; throw new Error('network down'); }
    return { stdout: '' };
  };
  const manager = new Capabilities({ repo, stateDir: path.join(root, 'state'), home, env: {}, run, which: name => `C:/bin/${name}.exe` });
  for (const id of ['plug', 'tool', 'gh']) { const review = await manager.review(id); await manager.install(id, { token: review.token, acceptHooks: true }); }
  let check = await manager.checkUpdates();
  assert.deepEqual(Object.fromEntries(Object.entries(check.results).map(([id, result]) => [id, result.status])), { plug: 'current', tool: 'current', gh: 'current' });
  assert.equal(check.results.gh.hosted, true);

  head = 'c'.repeat(40); version = '1.1.0';
  check = await manager.checkUpdates();
  assert.equal(check.results.plug.status, 'update'); assert.equal(check.results.plug.latest, head);
  assert.equal(check.results.tool.status, 'update'); assert.equal(check.results.tool.latest, '1.1.0');
  assert.equal((await manager.list()).updates.results.tool.status, 'update', 'the last check is shown with the list');

  // Same hooks: updates straight away and keeps its projects.
  let result = await manager.update('tool');
  assert.equal(result.updated, true);
  let lock = JSON.parse(await readFile(path.join(repo, 'knowledge/capabilities.lock.json'), 'utf8'));
  assert.equal(lock.installed.tool.version, '1.1.0');
  assert.ok(calls.includes(`mcp add --scope user tool -- ${process.platform === 'win32' ? 'cmd /c ' : ''}npx -y tool-mcp@1.1.0`));
  assert.equal(result.list.updates.results.tool.status, 'current');

  // Changed hooks: nothing happens until confirmed.
  hookCommand = 'node b.js';
  result = await manager.update('plug');
  assert.equal(result.updated, false);
  assert.equal(result.confirm.hooks[0].command, 'node b.js');
  assert.equal(JSON.parse(await readFile(path.join(repo, 'knowledge/capabilities.lock.json'), 'utf8')).installed.plug.commit, SHA);

  // A failed update puts the previous version back.
  failInstall = true;
  const before = calls.length;
  await assert.rejects(manager.update('plug', { acceptHooks: true }), /previous version is back in place/);
  lock = JSON.parse(await readFile(path.join(repo, 'knowledge/capabilities.lock.json'), 'utf8'));
  assert.equal(lock.installed.plug.commit, SHA);
  assert.ok(calls.slice(before).some(call => call.startsWith('plugin marketplace add') && call.includes(SHA)), 'the old pinned copy is added back');
  failInstall = false;
  result = await manager.update('plug', { acceptHooks: true });
  assert.equal(result.updated, true);
  assert.equal(JSON.parse(await readFile(path.join(repo, 'knowledge/capabilities.lock.json'), 'utf8')).installed.plug.commit, head);
});

test('card tags: type, then what it does, at most five, and an agent tag only when one agent is supported', () => {
  const both = agentSupport({ agentSupport: ['claude'] }, ['Codex · everywhere']);
  assert.deepEqual(both, ['claude', 'codex'], 'verified support and what is configured are combined');
  assert.deepEqual(cardTags({ labels: { type: ['MCP'], does: ['Browser', 'Automation', 'Testing'] } }, both), ['MCP', 'Browser', 'Automation', 'Testing'], 'no agent tag when both work');
  assert.deepEqual(agentSupport({}, ['higgsfield command']), ['claude', 'codex'], 'a command on PATH works from either agent');
  const claudeOnly = agentSupport({}, ['Claude Code plugin claude-hud']);
  assert.deepEqual(cardTags({ labels: { type: ['Skill'], does: ['Pixel Art', 'Sprites'] } }, claudeOnly), ['Skill', 'Pixel Art', 'Sprites', 'Claude Code']);
  assert.deepEqual(cardTags({ labels: { type: ['Skill'] } }, ['codex']), ['Skill', 'Codex']);
  const many = cardTags({ labels: { type: ['MCP', 'Skill', 'Editor'], does: ['Pixel Art', 'Animation', 'Sprites', 'Export'] } }, ['claude']);
  assert.equal(many.length, MAX_TAGS);
  assert.deepEqual(many, ['MCP', 'Skill', 'Editor', 'Pixel Art', 'Claude Code'], 'the agent tag keeps its place; the least useful capabilities drop off');
  assert.deepEqual(cardTags({ labels: { type: ['CLI'], does: ['cli', 'Image Gen', 'Image Gen'] } }, []), ['CLI', 'Image Gen'], 'no repeats');
  assert.deepEqual(cardTags({ setup: { kind: 'npm-cli' } }, []), ['CLI'], 'without labels the install type is used');
  assert.deepEqual(cardTags({ detect: { mcp: ['unity'] } }, ['codex']), ['MCP', 'Codex']);
});
test('a whole checkout skill, a Codex MCP server beside a Claude plugin, and a shared tool link', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'jupiter-cap-home-'));
  const repo = await mkdtemp(path.join(os.tmpdir(), 'jupiter-cap-repo-'));
  const caps = new Capabilities({ repo, stateDir: path.join(repo, '.jupiter'), home, env: {}, run: async () => ({ stdout: '' }), which: () => null });
  // Plan: the plugin for Claude Code, its skill and MCP server for Codex at the reviewed version, and the link.
  const bolt = { id: 'pixelbolt', setup: { kind: 'plugin', marketplace: 'pixelbolt', plugins: ['pixelbolt'], codexSkills: { from: 'skills', names: ['pixel-art'] }, codexMcp: { server: 'pixelbolt', script: 'bin/pixelbolt.js', args: ['mcp'] }, shared: true } };
  const steps = caps.plan(bolt, { commit: 'a'.repeat(40), version: '0.11.0', folder: path.join(repo, 'pin'), skills: ['pixel-art'] }, ['everywhere']);
  const codex = steps.find(step => step.file === 'codex');
  assert.deepEqual(codex.args, ['mcp', 'add', 'pixelbolt', '--', 'node', path.join(repo, '.jupiter/tools/pixelbolt/bin/pixelbolt.js'), 'mcp'], 'Codex runs the reviewed checkout');
  assert.equal(steps[0].link?.name, 'pixelbolt', 'the link is made before anything points at it');
  assert.ok(steps.some(step => step.copy?.agents.includes('codex')) && steps.some(step => step.link?.name === 'pixelbolt'));
  assert.ok(!caps.plan({ ...bolt, setup: { ...bolt.setup, shared: false, codexMcp: undefined } }, { folder: 'x', skills: ['pixel-art'] }, ['everywhere']).some(step => step.link || step.file === 'codex'));

  // A whole checkout copied as one skill, without its .git, docs or tests.
  const pin = path.join(repo, 'pin');
  for (const dir of ['bin', 'docs', 'test', '.git']) await mkdir(path.join(pin, dir), { recursive: true });
  await writeFile(path.join(pin, 'SKILL.md'), '---\nname: pxl-pixel-art\n---\n'); await writeFile(path.join(pin, 'bin/pxl.js'), '');
  await writeFile(path.join(pin, 'docs/big.gif'), ''); await writeFile(path.join(pin, 'test/a.test.ts'), ''); await writeFile(path.join(pin, '.git/HEAD'), '');
  const actions = await caps.copySkills({ id: 'claude-pxl', repo: 'crsolver/claude-pxl' }, { folder: pin, commit: 'b'.repeat(40) }, { agents: ['claude', 'codex'], names: ['pxl-pixel-art'], root: true, exclude: ['docs', 'test'] });
  assert.equal(actions.length, 2);
  const skill = path.join(home, '.claude/skills/pxl-pixel-art');
  assert.ok((await stat(path.join(skill, 'SKILL.md'))).isFile() && (await stat(path.join(skill, 'bin/pxl.js'))).isFile());
  for (const gone of ['docs', 'test', '.git']) await assert.rejects(stat(path.join(skill, gone)), `${gone} is left out`);
  assert.ok((await stat(path.join(home, '.agents/skills/pxl-pixel-art/SKILL.md'))).isFile(), 'Codex gets the same skill');

  // The shared link points at the pin; replacing or removing it leaves the checkout alone.
  const link = await caps.linkTool('pixelbolt', pin);
  assert.ok((await stat(path.join(link.path, 'SKILL.md'))).isFile(), 'the tool runs from .jupiter/tools/<id>');
  await caps.linkTool('pixelbolt', pin);
  await caps.undo(link);
  await assert.rejects(stat(link.path));
  assert.ok((await stat(path.join(pin, 'bin/pxl.js'))).isFile(), 'the pinned checkout is untouched');
  await mkdir(path.join(repo, '.jupiter/tools/other'), { recursive: true });
  await assert.rejects(caps.linkTool('other', pin), /not a link Jupiter made/);
});