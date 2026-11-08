// Real navigation regression: synthetic local files, no agents or paid services.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { cp, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createService } from '../server.mjs';

const root = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const temp = await mkdtemp(path.join(os.tmpdir(), 'jupiter-nav-ui-'));
const repo = path.join(temp, 'repo'), home = path.join(temp, 'home');
const uiDir = path.join(temp, 'ui');
const shots = path.join(root, '.cache', 'navigation-review');
for (const folder of [repo, home, shots, path.join(repo, 'workspace/alpha')]) await mkdir(folder, { recursive: true });
await cp(path.join(root, 'workspace/_shared'), path.join(repo, 'workspace/_shared'), { recursive: true });
await cp(path.join(root, 'dist'), uiDir, { recursive: true });
for (const folder of ['assets', 'fonts']) await cp(path.join(root, 'public', folder), path.join(uiDir, folder), { recursive: true });
await cp(path.join(root, 'knowledge/capabilities.json'), path.join(repo, 'knowledge/capabilities.json'));
await mkdir(path.join(repo, 'knowledge'), { recursive: true });
await writeFile(path.join(repo, 'knowledge/capabilities.lock.json'), JSON.stringify({ version: 1, installed: {} }));
await writeFile(path.join(repo, 'workspace/alpha/notes.md'), '# Alpha notes\n\nSynthetic navigation fixture.\n');
await writeFile(path.join(repo, 'workspace/workspace.json'), JSON.stringify({ entities: [{ id: 'alpha', title: 'Alpha Study', description: 'Navigation fixture', type: 'group', category: 'research', created: '2026-11-04', updated: '2026-11-04', sample: true, pinned: true, folder: 'alpha', steps: [{ name: 'Notes', path: 'notes.md' }], status: 'active' }] }));
const wake = Object.assign(new EventEmitter(), { state: { status: 'off' }, stop() {}, mute() {}, cancel() {} });
// Valid silent WAV keeps greeting playback local and avoids malformed-media noise.
const silence = Buffer.alloc(1644);
silence.write('RIFF'); silence.writeUInt32LE(1636, 4); silence.write('WAVEfmt ', 8);
silence.writeUInt32LE(16, 16); silence.writeUInt16LE(1, 20); silence.writeUInt16LE(1, 22);
silence.writeUInt32LE(8000, 24); silence.writeUInt32LE(16000, 28); silence.writeUInt16LE(2, 32); silence.writeUInt16LE(16, 34);
silence.write('data', 36); silence.writeUInt32LE(1600, 40);
const voiceOut = { folder: temp, configured: async () => false, usage: async () => null, prepare: async () => ({ made: 0 }), phrase: async () => ({ audio: silence, text: '' }) };
const service = await createService({ repo, stateDir: path.join(repo, '.state'), uiDir, capabilityOptions: { home, env: {}, which: () => null, run: async () => ({ stdout: '' }), nativeWindows: false }, mcpOptions: { home, env: {} }, voiceOptions: { wake, voiceOut }, newsOptions: { fetcher: async () => ({ ok: true, text: async () => '<rss><channel/></rss>' }) } });

if (process.argv.includes('--serve')) {
  // Keep authentication out of terminal output. The URL is read locally by the browser check.
  await writeFile(path.join(shots, 'service.json'), JSON.stringify({ url: service.urls.workspace, shots }));
  console.log('Synthetic navigation review service ready. Local receipt: .cache/navigation-review/service.json');
  await new Promise(resolve => { process.on('SIGINT', resolve); process.on('SIGTERM', resolve); });
  await service.close();
} else {
  const browser = await chromium.launch({ channel: 'msedge' });
  const context = await browser.newContext({ viewport: { width: 1500, height: 950 } });
  const errors = [], knownConsole = [], failures = [], checks = [];
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() !== 'error') return;
    const url = message.location().url;
    // Baseline desktop import starts mobile reconnects against a desktop-only service.
    // Preserve that unrelated diagnostic separately; every other console error fails.
    (url.endsWith('/mobile/api/bootstrap') ? knownConsole : errors).push({ message: message.text(), path: new URL(url, service.urls.workspace).pathname });
  });
  const settle = () => page.waitForTimeout(450);
  const showRail = async () => {
    if (await page.locator('.files-container.rail-hidden').count()) {
      await page.mouse.move(10, 300);
      await page.getByRole('button', { name: 'Show sidebar', exact: true }).click();
    }
    await page.locator('.files-container.rail-shown').waitFor({ state: 'attached' });
    await settle();
  };
  const select = async name => { await showRail(); await page.getByRole('button', { name, exact: true }).click(); };
  const hiddenRail = async () => {
    assert.equal(await page.locator('.files-container.rail-hidden').count(), 1, 'ribbon begins closing in the navigation click');
    assert.equal(await page.locator('.files-rail').evaluate(element => element.inert), true, 'closing ribbon cannot intercept keyboard input');
  };
  const sidebarClosed = async () => assert.equal(await page.locator('.app-layout.sidebar-collapsed').count(), 1, 'Workspace sidebar closes');
  const noCapabilities = async () => {
    await settle();
    assert.equal(await page.locator('.jh-cap').count(), 0, 'Capabilities is dismissed');
  };
  const check = async (name, fn) => {
    try { await fn(); checks.push(name); console.log(`PASS ${name}`); }
    catch (error) { failures.push({ name, error: error.message }); console.log(`FAIL ${name}: ${error.message}`); }
  };
  try {
    await page.goto(service.urls.workspace);
    await page.locator('.jupiter-home').waitFor();
    await check('Files and Settings keep the ribbon open', async () => {
      await select('Toggle files'); await page.locator('.files-panel').waitFor();
      assert.equal(await page.locator('.files-container.rail-shown').count(), 1);
      await select('Toggle settings'); await page.locator('.workspace-settings').waitFor();
      assert.equal(await page.locator('.files-container.rail-shown').count(), 1);
    });
    for (const [name, tab] of [['Open plugins', 'Harness'], ['Open MCP servers', 'Connections']]) {
      await check(`${name} dismisses ribbon and opens an interactive destination`, async () => {
        await select(name); await hiddenRail(); await sidebarClosed();
        await page.getByRole('tab', { name: new RegExp(`^${tab}`) }).waitFor();
        if (tab === 'Harness') {
          await page.getByRole('searchbox', { name: 'Search your plugins' }).fill('usable');
          await page.getByRole('searchbox', { name: 'Search your plugins' }).fill('');
        } else {
          await page.getByRole('tab', { name: /^Tools/ }).click();
          assert.equal(await page.getByRole('tab', { name: /^Tools/ }).getAttribute('aria-selected'), 'true');
          await page.getByRole('tab', { name: /^Connections/ }).click();
        }
      });
    }
    await check('Workspace closes Capabilities and opens its card sidebar', async () => {
      await select('Open Workspace'); await hiddenRail(); await noCapabilities();
      assert.equal(await page.locator('.app-layout.sidebar-collapsed').count(), 0);
      await page.getByRole('textbox', { name: 'Search entities' }).fill('Alpha');
      await page.getByRole('textbox', { name: 'Search entities' }).fill('');
    });
    await check('opening ribbon closes Workspace sidebar', async () => {
      await showRail(); await sidebarClosed();
      await settle();
      const box = await page.locator('.sidebar').boundingBox();
      assert.ok(!box || box.x + box.width <= 1, 'sidebar is off screen after closing');
    });
    await check('Workspace sidebar closes smoothly and becomes inert immediately', async () => {
      await select('Open Workspace'); await settle();
      const samples = await page.evaluate(async () => {
        document.querySelector('[aria-label="Show sidebar"]').click();
        const sidebar = document.querySelector('.sidebar'), result = [];
        for (let i = 0; i < 18; i++) {
          await new Promise(requestAnimationFrame);
          const box = sidebar.getBoundingClientRect();
          result.push({ right: box.right, width: box.width, inert: sidebar.inert });
        }
        return result;
      });
      assert.ok(samples.every(sample => sample.inert), 'sidebar stops accepting input when closing starts');
      assert.ok(samples.some(sample => sample.right > 1 && sample.right < sample.width - 1), 'sidebar has intermediate positions rather than disappearing');
      await writeFile(path.join(shots, 'sidebar-motion.json'), JSON.stringify(samples, null, 2));
    });
    await check('closing Capabilities remains animated but cannot block Workspace', async () => {
      await select('Open plugins'); await page.locator('.jh-cap').waitFor();
      await select('Open Workspace');
      assert.equal(await page.locator('.jh-focus[inert]').count(), 1, 'closing window is retained and inert during its exit');
      await settle(); assert.equal(await page.locator('.jh-focus').count(), 0);
      await page.getByRole('textbox', { name: 'Search entities' }).fill('Alpha');
      await page.getByRole('textbox', { name: 'Search entities' }).fill('');
    });
    await check('Help closes Capabilities and Workspace', async () => {
      await select('Open plugins'); await page.locator('.jh-cap').waitFor();
      await select('Open Workspace help'); await hiddenRail(); await sidebarClosed();
      await page.locator('.file-preview').waitFor(); await noCapabilities();
      await page.screenshot({ path: path.join(shots, 'help.png') });
    });
    await check('Plugins replaces Help and remains interactive', async () => {
      await select('Open plugins'); await page.locator('.jh-cap').waitFor(); await settle();
      assert.equal(await page.locator('.file-preview').count(), 0);
      await page.getByRole('tab', { name: /^Connections/ }).click();
      assert.equal(await page.getByRole('tab', { name: /^Connections/ }).getAttribute('aria-selected'), 'true');
    });
    await check('late Help response cannot replace newer Workspace', async () => {
      let release;
      const held = new Promise(resolve => { release = resolve; });
      await page.route('**/api/preview?path=workspace%2F_shared%2Fhelp.md', async route => { await held; await route.continue(); });
      try {
        await select('Open Workspace help'); await hiddenRail();
        await select('Open Workspace');
      } finally { release(); await page.unrouteAll({ behavior: 'wait' }); }
      await settle();
      assert.equal(await page.locator('.file-preview').count(), 0, 'old Help does not cover Workspace');
      assert.equal(await page.locator('.app-layout.sidebar-collapsed').count(), 0);
    });
    await check('navigation from a card clears remembered Capabilities', async () => {
      await select('Open plugins'); await page.locator('.jh-cap').waitFor();
      await page.evaluate(() => { location.hash = '#/alpha/0'; });
      await page.locator('.main.is-card').waitFor();
      await select('Open Workspace'); await page.locator('.jupiter-home').waitFor(); await noCapabilities();
      assert.equal(await page.locator('.app-layout.sidebar-collapsed').count(), 0);
    });
    await check('late Help cannot cover Plugins opened through Ask Jupiter', async () => {
      let release;
      const held = new Promise(resolve => { release = resolve; });
      await page.route('**/api/preview?path=workspace%2F_shared%2Fhelp.md', async route => { await held; await route.continue(); });
      try {
        await select('Open Workspace help');
        await page.locator('.jh-ask input').fill('open plugins');
        await page.locator('.jh-ask input').press('Enter');
        await page.locator('.jh-cap').waitFor();
      } finally { release(); await page.unrouteAll({ behavior: 'wait' }); }
      await settle();
      assert.equal(await page.locator('.file-preview').count(), 0, 'Ask navigation invalidates the older Help request');
      await page.getByRole('searchbox', { name: 'Search your plugins' }).fill('usable');
    });
    await check('MCP opens from Workspace search results', async () => {
      await select('Open Workspace');
      await page.getByRole('textbox', { name: 'Search entities' }).fill('Alpha');
      await select('Open MCP servers'); await hiddenRail();
      await page.locator('.jh-cap').waitFor();
      assert.equal(await page.getByRole('tab', { name: /^Connections/ }).getAttribute('aria-selected'), 'true');
    });
    await check('reopening Capabilities during its exit cancels old removal', async () => {
      await select('Open plugins'); await page.locator('.jh-cap').waitFor();
      await page.evaluate(async () => {
        for (const label of ['Show sidebar', 'Open Workspace', 'Show sidebar', 'Open MCP servers']) {
          document.querySelector(`[aria-label="${label}"]`).click();
          await new Promise(requestAnimationFrame);
        }
      });
      await settle();
      assert.equal(await page.locator('.jh-focus:not([inert]) .jh-cap').count(), 1);
      await page.getByRole('tab', { name: /^Tools/ }).click();
      assert.equal(await page.getByRole('tab', { name: /^Tools/ }).getAttribute('aria-selected'), 'true');
    });
    await check('rapid destination changes leave the last destination usable', async () => {
      // Real DOM handlers with no animation waits: simulate a burst while exits are still running.
      await page.evaluate(async () => {
        const click = label => document.querySelector(`[aria-label="${label}"]`)?.click();
        for (let i = 0; i < 6; i++) {
          for (const label of ['Show sidebar', 'Open plugins', 'Show sidebar', 'Open Workspace']) { click(label); await new Promise(requestAnimationFrame); }
        }
      });
      await settle(); await noCapabilities();
      assert.equal(await page.locator('.app-layout.sidebar-collapsed').count(), 0);
      await page.getByRole('textbox', { name: 'Search entities' }).fill('Alpha');
      await page.getByRole('textbox', { name: 'Search entities' }).fill('');
      await page.screenshot({ path: path.join(shots, 'rapid-workspace.png') });
    });
    await check('reduced motion keeps navigation functional', async () => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await select('Open MCP servers'); await hiddenRail(); await page.locator('.jh-cap').waitFor();
      await select('Open Workspace'); await noCapabilities();
      await page.getByRole('textbox', { name: 'Search entities' }).fill('Alpha');
      await page.screenshot({ path: path.join(shots, 'reduced-motion.png') });
    });
    // Native compositor frames capture the real transitions without a video encoder.
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await select('Open Workspace'); await settle();
    const framesDir = path.join(shots, 'frames');
    await mkdir(framesDir, { recursive: true });
    const cdp = await context.newCDPSession(page), frames = [], writes = [];
    cdp.on('Page.screencastFrame', event => {
      const file = `frame-${String(frames.length).padStart(3, '0')}.png`;
      frames.push({ file, timestamp: event.metadata.timestamp });
      writes.push(writeFile(path.join(framesDir, file), Buffer.from(event.data, 'base64')));
      void cdp.send('Page.screencastFrameAck', { sessionId: event.sessionId });
    });
    await cdp.send('Page.startScreencast', { format: 'png', maxWidth: 1500, maxHeight: 950, everyNthFrame: 1 });
    await select('Open MCP servers'); await settle();
    await select('Open Workspace help'); await page.locator('.file-preview').waitFor(); await settle();
    await select('Open Workspace'); await settle();
    await cdp.send('Page.stopScreencast'); await Promise.all(writes); await cdp.detach();
    await writeFile(path.join(framesDir, 'timeline.json'), JSON.stringify({ sequences: ['Workspace to ribbon', 'ribbon to MCP', 'MCP to Help', 'Help to Workspace'], frames }, null, 2));
    assert.ok(frames.length > 5, 'transition frames were captured');
    assert.equal(await page.locator('.jupiter-chats-panel:not([hidden])').count(), 1, 'navigation leaves Chats visible');
    await writeFile(path.join(shots, 'results.json'), JSON.stringify({ checks, failures, errors, knownConsole }, null, 2));
    assert.deepEqual(errors, [], 'browser console and page errors (baseline mobile endpoint messages recorded separately)');
    assert.deepEqual(failures, [], 'navigation acceptance checks');
    console.log(`Navigation: ${checks.length} checks passed. Evidence: ${shots}`);
  } finally { await context.close(); await browser.close(); await service.close(); }
}
