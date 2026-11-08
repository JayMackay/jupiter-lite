// No microphone, paid model request, native terminal or personal workspace is used.
import assert from 'node:assert/strict';
import { copyFile, cp, mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createService } from '../server.mjs';
import { launchBrowser } from './browser.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
await mkdir(path.join(root, '.cache'), { recursive: true });
const repo = await mkdtemp(path.join(root, '.cache/voice-ui-'));
await mkdir(path.join(repo, 'workspace'));
const uiDir = path.join(repo, 'ui');
await cp(path.join(root, 'dist'), uiDir, { recursive: true });
for (const name of ['jupiter.png', 'jupiter-192.png']) await copyFile(path.join(root, 'public/assets', name), path.join(uiDir, 'assets', name));
await writeFile(path.join(repo, 'workspace/workspace.json'), '{"entities":[]}');
// A placeholder key, so the J button takes the OpenAI live path this test covers (nothing is sent: the mic is refused).
await writeFile(path.join(repo, '.env'), 'OPENAI_API_KEY=test-placeholder\n');
const service = await createService({ repo, uiDir, mcpOptions: { home: repo, env: {} } });
const requests = [];
let fail = false;
service.coordinator.ask = async data => {
  requests.push(data);
  // The same shape as the real coordinator's result, including the conversation it belongs to.
  const operation = { ...data, conversation: data.conversationId, at: new Date().toISOString(), status: fail ? 'failed' : 'completed', result: fail ? 'Fixture request failed. Please retry.' : 'Fixture completed.' };
  service.coordinator.operations.set(data.id, operation);
  service.coordinator.emit('result', operation);
  return operation;
};
service.quick.ask = async () => null;
const imageBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jvWQAAAAASUVORK5CYII=';
let browser;
try {
  browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 650, height: 800 } });
  page.setDefaultTimeout(10000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    window.fixtureMicRequests = 0;
    // Patch the prototype: WebKit ignores an own-property override on navigator.mediaDevices.
    MediaDevices.prototype.getUserMedia = async () => { window.fixtureMicRequests++; throw new DOMException('Permission denied', 'NotAllowedError'); };
  });
  // In the Workspace window the J voice button rides with the left rail, which starts hidden.
  const showRail = async surface => { if (surface !== 'workspace') return; await page.mouse.move(10, 300); const arrow = page.getByRole('button', { name: 'Show sidebar' }); await arrow.waitFor({ timeout: 3000 }).catch(() => {}); if (await arrow.count()) await arrow.click(); await page.locator('.voice-dock.workspace').getByRole('button', { name: 'Start voice', exact: true }).waitFor(); };
  for (const surface of ['chats', 'workspace']) {
    await page.goto(service.urls[surface]);
    await showRail(surface);
    await page.getByRole('button', { name: 'Start voice', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Permission denied' }).waitFor();
    await page.getByRole('button', { name: 'Dismiss voice error' }).click();
    assert.equal(await page.getByRole('alert').count(), 0);
    assert.equal(await page.evaluate(() => window.fixtureMicRequests), 1);
    const input = page.getByRole('textbox', { name: 'Message Jupiter' });
    const before = requests.length;
    await input.fill('First line'); await input.press('Shift+Enter'); await input.pressSequentially('Second line');
    assert.equal(await input.inputValue(), 'First line\nSecond line'); assert.equal(requests.length, before);
    await input.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true });
    assert.equal(requests.length, before);
    // Hide and reopen the conversation; the draft is kept. The Workspace window has no separate
    // conversation button any more: the panel's × hides it and the J reopens it.
    if (surface === 'chats') { await page.getByRole('button', { name: 'Toggle conversation' }).click(); await page.getByRole('button', { name: 'Toggle conversation' }).click(); }
    else {
      assert.equal(await page.getByRole('button', { name: 'Toggle conversation' }).isVisible(), false);
      await page.getByTitle('Hide conversation · voice stays as selected').click();
      await showRail(surface);
      await page.getByRole('button', { name: 'Start voice', exact: true }).click();
      await page.getByRole('alert').filter({ hasText: 'Permission denied' }).waitFor();
      await page.getByRole('button', { name: 'Dismiss voice error' }).click();
    }
    assert.equal(await input.inputValue(), 'First line\nSecond line');
    await input.press('Enter');
    await page.waitForFunction(() => document.querySelector('.voice-compose textarea')?.value === '');
    assert.equal(requests.at(-1).text, 'First line\nSecond line'); assert.equal(requests.length, before + 1);

    await input.fill('Review this screenshot');
    await input.evaluate((element, encoded) => {
      const bytes = Uint8Array.from(atob(encoded), value => value.charCodeAt(0));
      const clipboardData = new DataTransfer(); clipboardData.items.add(new File([bytes], 'Screenshot.png', { type: 'image/png' }));
      element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData }));
    }, imageBase64);
    const attached = page.getByLabel('Attached images', { exact: true });
    await attached.locator('img').waitFor();
    await page.waitForFunction(() => !document.querySelector('.voice-compose button[type=submit]').disabled);
    await attached.getByRole('link').click(); await page.getByRole('dialog', { name: 'Image preview' }).waitFor();
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await page.screenshot({ path: path.join(repo, `composer-${surface}.png`) });
    fail = true;
    await input.press('Enter');
    await page.getByRole('alert').filter({ hasText: 'Fixture request failed' }).waitFor();
    assert.equal(await input.inputValue(), 'Review this screenshot'); assert.equal(await attached.locator('img').count(), 1);
    await page.getByRole('button', { name: 'Dismiss message error' }).click();
    fail = false; await input.press('Enter');
    await page.waitForFunction(() => document.querySelector('.voice-compose textarea')?.value === '');
    assert.equal(await attached.count(), 0);
    assert.equal(requests.at(-1).images.length, 1);
    const saved = requests.at(-1).images[0];
    assert.ok(saved.startsWith(path.join(repo, 'inbox/attachments') + path.sep));
    assert.deepEqual(await readFile(saved), Buffer.from(imageBase64, 'base64'));
    await page.getByLabel('Sent images', { exact: true }).last().locator('img').waitFor();

    await page.locator('input[type=file][aria-label="Choose images for Jupiter"]').setInputFiles({ name: 'Reference.png', mimeType: 'image/png', buffer: Buffer.from(imageBase64, 'base64') });
    await attached.locator('img').waitFor();
    await attached.getByRole('button', { name: /^Remove / }).click();
    assert.equal(await attached.count(), 0);
  }
  assert.deepEqual(errors, []);
  console.log('Talk to Jupiter: newline/send/IME, dismissable errors, image paste/upload/preview/removal, retry and hidden-panel draft retention passed in both windows.');
  console.log(`Screenshots: ${repo}`);
} finally { await browser?.close(); await service.close(); }
