// Plugins and MCP pages: installed items only, check for updates, update in place, links,
// the MCP tab and a New chat that offers Codex and Claude Code only.
// Agent CLIs, git and npm are replaced by a stand-in, so nothing is installed for real.
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createService } from '../server.mjs';

const root = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const temp = await mkdtemp(path.join(os.tmpdir(), 'jupiter-cap-ui-'));
const repo = path.join(temp, 'repo'), home = path.join(temp, 'home'), stateDir = path.join(repo, '.state'), shots = path.join(root, '.cache', path.basename(temp));
for (const folder of [repo, home, stateDir, shots]) await mkdir(folder, { recursive: true });
for (const file of ['workspace/workspace.json', 'workspace/_shared']) await cp(path.join(root, file), path.join(repo, file), { recursive: true });
await cp(path.join(root, 'knowledge/capabilities.json'), path.join(repo, 'knowledge/capabilities.json'));
await cp(path.join(root, 'public/assets'), path.join(temp, 'ui-assets'), { recursive: true });

const OLD = 'a'.repeat(40), NEW = 'b'.repeat(40);
const hook = '"${CLAUDE_PLUGIN_ROOT}/hooks/run-hook.cmd" session-start';
const entry = (extra) => ({ installedAt: '2026-11-02T10:00:00.000Z', updatedAt: '2026-11-02T10:00:00.000Z', reviewedAt: '2026-11-02T10:00:00.000Z', hooks: 0, targets: ['everywhere'], actions: [], ...extra });
await writeFile(path.join(repo, 'knowledge/capabilities.lock.json'), JSON.stringify({ version: 1, installed: {
  superpowers: entry({ name: 'superpowers', repo: 'obra/superpowers', commit: OLD, version: null, kind: 'plugin', hooks: 1, hookList: [`SessionStart startup ${hook}`] }),
  caveman: entry({ name: 'caveman', repo: 'JuliusBrussee/caveman', commit: OLD, version: null, kind: 'skills' }),
  'playwright-mcp': entry({ name: 'playwright-mcp', repo: 'microsoft/playwright-mcp', commit: null, version: '0.0.84', kind: 'mcp' }),
  'github-mcp-server': entry({ name: 'github-mcp-server', repo: 'github/github-mcp-server', commit: null, version: null, kind: 'mcp' }),
  pixelbolt: entry({ name: 'pixelbolt', repo: 'skulitom/Pixelbolt', commit: OLD, version: null, kind: 'plugin' }),
} }));

const calls = [];
const write = async (file, value) => { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, typeof value === 'string' ? value : JSON.stringify(value)); };
const run = async (file, args, { cwd } = {}) => {
  calls.push({ name: path.basename(file).replace(/\.exe$/, ''), args, cwd });
  if (args[0] === 'ls-remote') return { stdout: `${args[1].includes('superpowers') ? NEW : OLD}\tHEAD` };
  if (args.includes('rev-parse')) return { stdout: path.basename(cwd) };
  if (args.includes('checkout')) {
    await write(path.join(cwd, '.claude-plugin/marketplace.json'), { name: 'superpowers-dev', plugins: [{ name: 'superpowers', source: './' }] });
    await write(path.join(cwd, 'hooks/hooks.json'), { hooks: { SessionStart: [{ matcher: 'startup', hooks: [{ type: 'command', command: hook }] }] } });
    await write(path.join(cwd, 'skills/brainstorming/SKILL.md'), '# brainstorming');
  }
  if (args[0] === 'view') return { stdout: '0.0.84' };
  return { stdout: '' };
};
const which = name => ['claude', 'codex'].includes(name) ? `C:/fake/${name}.exe` : null;

const service = await createService({ repo, stateDir, uiDir: path.join(root, 'dist'), capabilityOptions: { home, env: {}, run, which }, mcpOptions: { home, env: {} } });
const browser = await chromium.launch({ channel: 'msedge' });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${service.urls.workspace}#/`);
  await page.waitForSelector('.jupiter-home');

  // The rail opens the Plugins page: installed items only, grouped by section.
  // The rail starts hidden; the arrow at the left edge slides it out.
  const showRail = async () => { const arrow = page.getByRole('button', { name: 'Show sidebar' }); if (await arrow.count()) { await page.mouse.move(10, 300); await arrow.click(); } await page.locator('.files-rail').waitFor({ state: 'visible' }); };
  await showRail();
  await page.getByRole('button', { name: 'Open plugins' }).click();
  await page.locator('.jh-cap-card').first().waitFor();
  const tabs = await page.$$eval('.jh-cap [role=tab]', tabs => tabs.map(tab => tab.textContent));
  assert.deepEqual(tabs.map(tab => tab.replace(/\d+$/, '')), ['Harness', 'Skills', 'Memory', 'Tools', 'Token Bill', 'Connections']);
  assert.deepEqual(tabs.slice(0, 3).concat(tabs[4]), ['Harness1', 'Skills0', 'Memory0', 'Token Bill1'], 'only installed items are counted');
  assert.deepEqual(await page.$$eval('.jh-cap-card h3', titles => titles.map(title => title.textContent)), ['Superpowers'], 'Karpathy is not installed here, so it is not listed');
  assert.equal(await page.locator('.jh-cap-intro h3').textContent(), 'Harness');
  assert.doesNotMatch(await page.locator('.jh-cap').innerText(), /[A-Za-z]-[A-Za-z]|install|take|★/i, 'no dashes, install buttons, tags or stars');
  const superpowers = page.locator('[data-capability=superpowers]');
  assert.equal(await superpowers.getByRole('link', { name: 'View on GitHub' }).getAttribute('href'), 'https://github.com/obra/superpowers');
  assert.match(await superpowers.locator('.jh-pill').textContent(), /Not checked/);

  // Check for updates: orange where a newer commit exists.
  await page.getByRole('button', { name: 'Check for updates' }).click();
  await superpowers.getByRole('button', { name: 'Update available' }).waitFor();
  assert.match(await page.locator('.jh-cap-check small').textContent(), /1 update available/);
  await page.screenshot({ path: path.join(shots, 'update-available.png') });

  // Clicking orange updates it in place; its hook is unchanged, so no confirmation is needed.
  await superpowers.getByRole('button', { name: 'Update available' }).click();
  await superpowers.locator('.jh-pill.ok').waitFor({ timeout: 20000 });
  assert.equal(await superpowers.locator('.jh-cap-ver').textContent(), 'bbbbbbb');
  assert.ok(calls.some(call => call.name === 'claude' && call.args.slice(0, 3).join(' ') === 'plugin marketplace add' && call.args[3].includes(NEW)), 'the new commit is pinned');
  const lock = JSON.parse(await readFile(path.join(repo, 'knowledge/capabilities.lock.json'), 'utf8'));
  assert.equal(lock.installed.superpowers.commit, NEW);
  assert.match(await page.locator('.jh-cap-check small').textContent(), /Everything is up to date/);

  // Tools: green for a current npm version and for GitHub's hosted server.
  await page.getByRole('tab', { name: /^Tools/ }).click();
  const playwright = page.locator('[data-capability=playwright-mcp]');
  assert.match(await playwright.locator('.jh-pill').textContent(), /Up to date/);
  assert.equal(await playwright.locator('.jh-cap-ver').textContent(), '0.0.84');
  assert.match(await page.locator('[data-capability=github-mcp-server] .jh-cap-ver').textContent(), /hosted by GitHub/);
  // Tags come from the catalogue: type, then what it does, at most five; no agent tag when both agents work.
  const chips = id => page.locator(`[data-capability=${id}] .jh-cap-chips span`).allTextContents();
  assert.deepEqual(await chips('playwright-mcp'), ['MCP', 'Browser', 'Automation', 'Testing']);
  assert.deepEqual(await chips('github-mcp-server'), ['MCP', 'Git', 'Repositories']);
  assert.deepEqual(await chips('pixelbolt'), ['MCP', 'Skill', 'Editor', 'Pixel Art', 'Animation'], 'the most useful five');
  for (const card of await page.locator('.jh-cap-card').all()) assert.ok((await card.locator('.jh-cap-chips span').count()) <= 5);
  assert.equal(await page.locator('[data-capability=pixelbolt]').getByRole('button', { name: 'Open Editor' }).count(), 1, 'Pixelbolt brings its studio');
  assert.equal(await playwright.getByRole('button', { name: 'Open Editor' }).count(), 0)
  await page.screenshot({ path: path.join(shots, 'tools.png') });

  // The rail's MCP button opens the Connections tab; GitHub's missing key is shown by name only.
  await showRail();
  await page.getByRole('button', { name: 'Open MCP servers' }).click();
  await page.locator('[data-connection=github-mcp-server]').waitFor();
  assert.match(await page.locator('[data-connection=github-mcp-server] .jh-pill').textContent(), /Needs its key/);
  assert.match(await page.locator('[data-connection=github-mcp-server] .jh-pill').getAttribute('title'), /GITHUB_PAT_TOKEN/);
  assert.equal(await page.getByRole('button', { name: 'Check connections' }).count(), 1);
  await page.screenshot({ path: path.join(shots, 'connections.png') });

  // Ask Jupiter opens the same page.
  await page.getByRole('button', { name: 'Close panel' }).click();
  await page.fill('.jh-ask input', 'show my plugins'); await page.press('.jh-ask input', 'Enter');
  await page.locator('.jh-cap-card').first().waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
  await page.setViewportSize({ width: 820, height: 900 });
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'no sideways scroll when narrow');
  await page.screenshot({ path: path.join(shots, 'narrow.png') });

  // New chat offers Codex and Claude Code only.
  const chats = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  chats.on('pageerror', error => errors.push(error.message));
  await chats.goto(service.urls.chats);
  await chats.locator('.empty-agent-names').waitFor();
  assert.deepEqual(await chats.$$eval('.empty-agent-names span', names => names.map(name => name.textContent)), ['Claude', 'Codex']);
  await chats.getByRole('button', { name: 'Open your first chat' }).click();
  await chats.locator('.agent-choice').first().waitFor();
  assert.deepEqual(await chats.$$eval('.agent-choice', choices => choices.map(choice => choice.querySelector('span:nth-child(2)')?.firstChild?.textContent?.trim())), ['Codex', 'Claude Code']);
  await chats.screenshot({ path: path.join(shots, 'new-chat.png') });

  assert.deepEqual(errors, []);
  console.log(`Plugins and MCP pages passed: installed only, check for updates, orange to green update with a pinned commit, links, MCP tab with key names only, Ask routing, narrow layout, Codex and Claude Code only. Screenshots: ${shots}`);
} finally {
  await browser.close(); await service.close();
}
