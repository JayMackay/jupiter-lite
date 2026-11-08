// The desktop windows use WebView2 (Edge) on Windows and WKWebView (WebKit) on
// macOS; test in the matching engine. JUPITER_TEST_BROWSER overrides
// (msedge, chrome, chromium or webkit).
import { chromium, webkit } from '@playwright/test';
import { readFile } from 'node:fs/promises';

// Standalone browser tests receive the same native initialization script as Tauri.
export async function desktopAuth(context, url) {
  const address = new URL(url);
  const script = await readFile(new URL('../../../src-tauri/src/desktop-auth.js', import.meta.url), 'utf8');
  await context.addInitScript({ content: script.replace('__JUPITER_SERVICE_ORIGIN__', JSON.stringify(address.origin)).replace('__JUPITER_SERVICE_TOKEN__', JSON.stringify(address.searchParams.get('token'))) });
}

export const testBrowser = process.env.JUPITER_TEST_BROWSER || (process.platform === 'darwin' ? 'webkit' : 'msedge');

export function launchBrowser(options = {}) {
  if (testBrowser === 'webkit') {
    const { args: _chromiumOnly, ...rest } = options;
    return webkit.launch({ headless: true, ...rest });
  }
  return chromium.launch({ headless: true, ...options, channel: testBrowser === 'chromium' ? undefined : testBrowser });
}

// WebKit knows only 'clipboard-read'; its clipboard writes need no grant.
export const clipboardPermissions = testBrowser === 'webkit' ? ['clipboard-read'] : ['clipboard-read', 'clipboard-write'];

// The Chats header shows one button per group (and More groups); each opens a picker of that group's open chats.
// Opens the picker that holds the chat and returns the row's select button.
export async function openChatPicker(page, id) {
  const row = page.locator(`[data-chat-tab="${id}"] .chat-picker-item`);
  if (await row.count()) return row;
  const triggers = page.locator('.chat-groups > button.chat-group-chip');
  await triggers.first().waitFor();
  for (let index = 0, total = await triggers.count(); index < total; index++) {
    await triggers.nth(index).click();
    if (await row.count()) return row;
  }
  throw new Error(`Chat ${id} is not in any group picker`);
}

export async function chooseChat(page, id) {
  await (await openChatPicker(page, id)).click();
}

// Ids of every open chat, read by opening each picker in turn. Leaves every picker closed.
export async function openChatIds(page) {
  const ids = [];
  const triggers = page.locator('.chat-groups > button.chat-group-chip');
  await triggers.first().waitFor();
  for (let index = 0, total = await triggers.count(); index < total; index++) {
    await triggers.nth(index).click();
    ids.push(...await page.locator('.chat-picker-row').evaluateAll(rows => rows.map(row => row.dataset.chatTab)));
    await page.keyboard.press('Escape');
  }
  return ids;
}
