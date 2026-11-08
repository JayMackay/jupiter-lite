// Ask Jupiter: "create a feature ticket to …, have Codex write the details" saves one Feature on the board,
// starts one visible drafting chat (a stand-in here, never a real agent) and reports what really happened.
// Run it through the dist lock: node desktop/service/test/tickets-ui.mjs
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createService } from '../server.mjs';

const root = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const temp = await mkdtemp(path.join(os.tmpdir(), 'jupiter-tickets-ui-'));
const repo = path.join(temp, 'repo'), home = path.join(temp, 'home'), uiDir = path.join(temp, 'ui');
const shots = path.join(root, '.cache', 'overnight', 'navigation');
for (const folder of [repo, home, shots, path.join(repo, 'workspace')]) await mkdir(folder, { recursive: true });
await cp(path.join(root, 'workspace/_shared'), path.join(repo, 'workspace/_shared'), { recursive: true });
await cp(path.join(root, 'dist'), uiDir, { recursive: true });
for (const folder of ['assets', 'fonts']) await cp(path.join(root, 'public', folder), path.join(uiDir, folder), { recursive: true });
await mkdir(path.join(repo, 'knowledge'), { recursive: true });
await cp(path.join(root, 'knowledge/capabilities.json'), path.join(repo, 'knowledge/capabilities.json'));
await writeFile(path.join(repo, 'knowledge/capabilities.lock.json'), JSON.stringify({ version: 1, installed: {} }));
await writeFile(path.join(repo, 'workspace/workspace.json'), JSON.stringify({ entities: [] }));
const wake = Object.assign(new EventEmitter(), { state: { status: 'off' }, start: async () => ({}), stop() {}, mute() {}, cancel() {}, listen() {} });
// A valid silent WAV keeps the greeting local and avoids malformed media noise in the console.
const silence = Buffer.alloc(1644);
silence.write('RIFF'); silence.writeUInt32LE(1636, 4); silence.write('WAVEfmt ', 8);
silence.writeUInt32LE(16, 16); silence.writeUInt16LE(1, 20); silence.writeUInt16LE(1, 22);
silence.writeUInt32LE(8000, 24); silence.writeUInt32LE(16000, 28); silence.writeUInt16LE(2, 32); silence.writeUInt16LE(16, 34);
silence.write('data', 36); silence.writeUInt32LE(1600, 40);
const voiceOut = { folder: temp, configured: async () => false, usage: async () => null, prepare: async () => ({ made: 0 }), phrase: async () => ({ audio: silence, text: '' }), speak: async text => ({ audio: silence, text }) };
const service = await createService({ repo, stateDir: path.join(repo, '.state'), uiDir, mcpOptions: { home, env: {} }, capabilityOptions: { home, env: {}, which: () => null, run: async () => ({ stdout: '' }), nativeWindows: false }, voiceOptions: { wake, voiceOut }, newsOptions: { fetcher: async () => { throw new Error('offline'); } } });
const created = [];
service.sessions.create = async options => { created.push(options); return { id: `chat-${created.length}`, name: options.name, agent: options.agent }; };
service.coordinator.ask = async () => { throw new Error('A ticket request must not need the language model.'); };
await service.workItems.create({ title: 'Project Jupiter' });
const errors = [], known = []; // known: the mobile gateway answers 400 to an unconfigured bootstrap, on every page (see navigation-ui.mjs)
const browser = await chromium.launch({ channel: 'msedge' });
try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
  page.on('response', response => { if (response.status() >= 400) (response.url().endsWith('/mobile/api/bootstrap') ? known : errors).push(`http ${response.status()}: ${response.request().method()} ${new URL(response.url()).pathname}`); });
  page.on('console', message => { if (message.type() === 'error' && !/status of 400 \(Bad Request\)/.test(message.text())) errors.push(`console: ${message.text()}`); });
  await page.goto(`${service.urls.workspace}#/`);
  await page.locator('.jh-ask input').waitFor();
  const REQUEST = 'create a feature ticket to increase the rotation speed of the brain animation, have Codex write the details';
  await page.locator('.jh-ask input').fill(REQUEST);
  await page.locator('.jh-ask input').press('Enter');
  const failure = async message => { await page.screenshot({ path: path.join(shots, 'ticket-ask-failed.png') }); assert.fail(message); };
  // The ticket is saved quietly: no message line under the Ask bar.
  const saved = async () => JSON.parse(await readFile(path.join(repo, 'knowledge/work/project-jupiter.json'), 'utf8').catch(() => '{"items":[]}'));
  const deadline = Date.now() + 8000;
  while ((await saved()).items?.length !== 1 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 150));
  if ((await saved()).items?.length !== 1) await failure(`No ticket saved; chats started: ${JSON.stringify(created.map(item => [item.agent, item.name, String(item.initialPrompt).slice(0, 80)]))}`);
  assert.equal(await page.locator('.jh-reply').count(), 0, 'no reply line under the Ask bar');
  const board = await saved();
  assert.equal(board.items.length, 1); assert.deepEqual([board.items[0].type, board.items[0].state], ['feature', 'todo']);
  assert.equal(created.length, 1, 'one drafting chat and no chat for the raw sentence'); assert.equal(created[0].agent, 'codex');
  await page.waitForSelector('.work-board, .wb, [aria-label="To do"]', { timeout: 5000 }).catch(() => {});
  await page.screenshot({ path: path.join(shots, 'ticket-ask-saved.png') });
  assert.deepEqual(errors, [], `console errors: ${errors.join(' | ')}`);
  console.log(`tickets-ui: ok (known unrelated: ${known.join(', ') || 'none'})`);
} finally { await browser.close(); await service.close(); }
