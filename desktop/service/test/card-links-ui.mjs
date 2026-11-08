// A Workspace card link clicked in a chat or terminal opens the card inside Jupiter. Other links keep
// their behaviour. Synthetic card, chat, transcript and terminal in a temp folder; no agent or account.
// Screenshots go to .cache/overnight/navigation. Run through the dist lock: node desktop/service/test/card-links-ui.mjs
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { cp, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createService } from '../server.mjs';
import { launchBrowser, desktopAuth } from './browser.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const shots = path.join(root, '.cache', 'overnight', 'navigation');
await mkdir(shots, { recursive: true });
const repo = await mkdtemp(path.join(os.tmpdir(), 'jupiter-card-links-'));
const card = (id, title) => ({ id, folder: id, title, description: `${title} notes.`, category: 'dev', created: '2026-11-04', updated: '2026-11-04', status: 'active', steps: [{ name: 'Overview', path: 'overview.md' }, { name: 'Notes', path: 'notes.md' }] });
for (const [id, title] of [['ashengard-8b5961c4', 'Ashengard'], ['other-card', 'Other card']]) {
  await mkdir(path.join(repo, 'workspace', id), { recursive: true });
  await writeFile(path.join(repo, 'workspace', id, 'overview.md'), `# ${title} overview\n\nThe project page.\n`);
  await writeFile(path.join(repo, 'workspace', id, 'notes.md'), `# ${title} notes\n\nSecond page.\n`);
}
await writeFile(path.join(repo, 'workspace/workspace.json'), JSON.stringify({ entities: [card('ashengard-8b5961c4', 'Ashengard'), card('other-card', 'Other card')] }));
// The built interface plus its public assets, as the desktop app serves it; a silent stand-in for the voice.
const uiDir = path.join(repo, 'ui');
await cp(path.join(root, 'dist'), uiDir, { recursive: true });
for (const folder of ['assets', 'fonts']) await cp(path.join(root, 'public', folder), path.join(uiDir, folder), { recursive: true });
const silence = Buffer.alloc(1644);
silence.write('RIFF'); silence.writeUInt32LE(1636, 4); silence.write('WAVEfmt ', 8);
silence.writeUInt32LE(16, 16); silence.writeUInt16LE(1, 20); silence.writeUInt16LE(1, 22);
silence.writeUInt32LE(8000, 24); silence.writeUInt32LE(16000, 28); silence.writeUInt16LE(2, 32); silence.writeUInt16LE(16, 34);
silence.write('data', 36); silence.writeUInt32LE(1600, 40);
const wake = Object.assign(new EventEmitter(), { state: { status: 'off' }, start: async () => ({}), stop() {}, mute() {}, cancel() {}, listen() {} });
const voiceOut = { folder: repo, configured: async () => false, usage: async () => null, prepare: async () => ({ made: 0 }), phrase: async () => ({ audio: silence, text: '' }), speak: async text => ({ audio: silence, text }) };
const service = await createService({ repo, uiDir, mcpOptions: { home: path.join(repo, 'fake-home'), env: {} }, voiceOptions: { wake, voiceOut } });
const session = service.sessions.make({ id: 'links', name: 'Workspace Setup', agent: 'codex', cwd: repo, status: 'running', open: true, cols: 80, rows: 30 });
service.sessions.items.set(session.id, session); await service.sessions.hydrate(session);
session.process = { write() {}, resize() {}, kill() {} };
const DEAD = 'http://127.0.0.1:5187/#/ashengard-8b5961c4'; // a stopped preview server, as in the report
service.mobile.transcripts.read = async () => ({ supported: true, activity: [], messages: [
  { id: 'u1', role: 'user', text: 'Create the Ashengard workspace', at: '2026-11-04T08:00:00Z' },
  { id: 'a1', role: 'assistant', at: '2026-11-04T08:00:10Z', text: [
    `[Open Ashengard](${DEAD})`, `[Open Ashengard overview](${DEAD}/0)`, '[Open the other card](#/other-card)', '[Open a removed card](http://127.0.0.1:3009/#/removed-card-1234)',
    '[Another local tool](http://127.0.0.1:3000/#/settings)', '[External site](https://browser-check.example/page)',
  ].join('\n\n') },
] });
const errors = [], known = [], popups = [];
let browser;
try {
  browser = await launchBrowser();
  const context = await browser.newContext({ viewport: { width: 1100, height: 760 } });
  await desktopAuth(context, service.urls.workspace);
  await context.route('http://127.0.0.1:3000/**', route => route.fulfill({ contentType: 'text/html', body: '<h1>Another local tool</h1>' }));
  await context.route('https://browser-check.example/**', route => route.fulfill({ contentType: 'text/html', body: '<h1>External destination</h1>' }));
  const watch = page => {
    page.setDefaultTimeout(10000);
    page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
    page.on('response', response => { if (response.status() >= 400) (response.url().endsWith('/mobile/api/bootstrap') ? known : errors).push(`http ${response.status()}: ${new URL(response.url()).pathname}`); });
    page.on('console', message => { if (message.type() === 'error' && !/status of 400 \(Bad Request\)/.test(message.text())) errors.push(`console: ${message.text()}`); });
  };
  const workspace = await context.newPage(); watch(workspace);
  await workspace.goto(service.urls.workspace + '#/');
  await workspace.locator('.jupiter-home').waitFor();
  const chats = await context.newPage(); watch(chats);
  await chats.goto(service.urls.chats);
  await chats.locator('.xterm-screen').waitFor();
  context.on('page', page => popups.push(page));
  const hash = () => new URL(workspace.url()).hash;
  const popup = async (click, expected) => {
    const next = context.waitForEvent('page');
    await click();
    const opened = await next;
    await opened.waitForLoadState('domcontentloaded');
    assert.equal(opened.url(), expected);
    await opened.close();
  };
  const noPopup = async (click, label) => { const before = popups.length; await click(); await chats.waitForTimeout(400); assert.equal(popups.length, before, `${label} must not open a browser window`); };

  // Conversation: the card opens in the Workspace window, the chat stays where it is.
  await chats.getByRole('button', { name: 'Conversation', exact: true }).click();
  await chats.getByRole('link', { name: 'Open Ashengard', exact: true }).waitFor();
  await noPopup(() => chats.getByRole('link', { name: 'Open Ashengard', exact: true }).click(), 'a card link');
  await workspace.waitForFunction(() => location.hash === '#/ashengard-8b5961c4');
  await workspace.getByRole('heading', { name: 'Ashengard notes' }).waitFor(); // a card opens on its default (last) page
  await noPopup(() => chats.getByRole('link', { name: 'Open Ashengard overview', exact: true }).click(), 'a card page link');
  await workspace.waitForFunction(() => location.hash === '#/ashengard-8b5961c4/0');
  await workspace.getByRole('heading', { name: 'Ashengard overview' }).waitFor();
  assert.equal(await workspace.getByRole('tab', { name: 'Overview', exact: true }).getAttribute('aria-selected'), 'true', 'the requested page is selected');
  await workspace.screenshot({ path: path.join(shots, 'card-link-workspace-page.png') });
  await noPopup(() => chats.getByRole('link', { name: 'Open the other card', exact: true }).click(), 'a relative card link');
  await workspace.waitForFunction(() => location.hash === '#/other-card');
  assert.ok(chats.url().includes('surface=chats') || chats.url().includes('chats'), 'the chat window is still the chat window');
  assert.equal(await chats.getByRole('button', { name: 'Conversation', exact: true }).getAttribute('aria-pressed'), 'true', 'the chat is still open on its conversation');

  // A removed card says so and goes nowhere.
  const where = hash();
  await noPopup(() => chats.getByRole('link', { name: 'Open a removed card', exact: true }).click(), 'a removed card link');
  await chats.locator('.desktop-error').filter({ hasText: 'removed-card-1234' }).waitFor();
  assert.match(await chats.locator('.desktop-error').textContent(), /not in Jupiter/);
  assert.equal(hash(), where, 'the Workspace stays where it was');
  await chats.screenshot({ path: path.join(shots, 'card-link-removed-feedback.png') });
  await chats.getByRole('button', { name: 'Dismiss error' }).click();

  // Other links behave as before.
  await popup(() => chats.getByRole('link', { name: 'Another local tool', exact: true }).click(), 'http://127.0.0.1:3000/#/settings');
  await popup(() => chats.getByRole('link', { name: 'External site', exact: true }).click(), 'https://browser-check.example/page');
  assert.equal(await chats.locator('.desktop-error').count(), 0);

  // Terminal: the same rules.
  await chats.getByRole('button', { name: 'Terminal', exact: true }).click();
  await chats.locator('.xterm-screen').waitFor();
  await chats.waitForTimeout(1000); // the terminal restores its screen from the service when it is shown again
  async function terminalLink(output, label) {
    // A fresh terminal for each link, so no hover state from the previous one is left over.
    await chats.goto(service.urls.chats);
    await chats.locator('.xterm-screen').waitFor();
    await chats.getByRole('button', { name: 'Terminal', exact: true }).click();
    await chats.waitForTimeout(800);
    const data = '\x1b[2J\x1b[H\x1b[?1000h\x1b[?1006h' + output + '\r\n';
    await new Promise(resolve => session.terminal.write(data, resolve));
    session.pendingOutput += data; service.sessions.flushOutput(session);
    const row = chats.locator('.xterm-rows > div').filter({ hasText: label }).first();
    try { await row.waitFor({ timeout: 6000 }); } catch (error) { await chats.screenshot({ path: path.join(shots, 'card-link-terminal-failed.png') }); console.error('terminal rows:', JSON.stringify(await chats.locator('.xterm-rows').innerText().catch(() => 'none')), 'view buttons:', JSON.stringify(await chats.locator('button[aria-pressed]').evaluateAll(nodes => nodes.map(node => [node.textContent, node.getAttribute('aria-pressed')])))); throw error; }
    const box = await row.boundingBox();
    // Come from an empty row so the terminal looks for a link under the pointer afresh.
    await chats.mouse.move(box.x + 25, box.y + box.height * 8);
    await chats.mouse.move(box.x + 25, box.y + box.height / 2, { steps: 4 });
    await chats.locator('.xterm-cursor-pointer').waitFor();
    return { click: () => chats.mouse.click(box.x + 25, box.y + box.height / 2) };
  }
  await workspace.evaluate(() => { location.hash = '#/'; });
  const cardLink = await terminalLink('http://127.0.0.1:5187/#/ashengard-8b5961c4/1', 'http://127.0.0.1:5187/#/ashengard-8b5961c4');
  await noPopup(cardLink.click, 'a terminal card link');
  await workspace.waitForFunction(() => location.hash === '#/ashengard-8b5961c4/1');
  const removed = await terminalLink('http://127.0.0.1:3009/#/removed-card-1234', 'http://127.0.0.1:3009/#/removed-card-1234');
  await noPopup(removed.click, 'a removed card terminal link');
  await chats.locator('.desktop-error').filter({ hasText: 'removed-card-1234' }).waitFor();
  await chats.getByRole('button', { name: 'Dismiss error' }).click();
  const tool = await terminalLink('http://127.0.0.1:3000/#/settings', 'http://127.0.0.1:3000/#/settings');
  await popup(tool.click, 'http://127.0.0.1:3000/#/settings');
  const site = await terminalLink('https://browser-check.example/page?one=1', 'https://browser-check.example/page');
  await popup(site.click, 'https://browser-check.example/page?one=1');
  assert.ok(chats.url().includes('chats'), 'opening a link leaves the terminal in place');
  assert.deepEqual(errors, [], errors.join(' | '));
  console.log(`Card links UI passed: card, page, relative and terminal links open in Jupiter; removed cards give feedback; other links open as before. Known unrelated: ${[...new Set(known)].join(', ') || 'none'}`);
} finally {
  await browser?.close(); session.process = null; await service.close();
}
