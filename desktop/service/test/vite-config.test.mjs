// An agent verifying its work starts an isolated preview. That must never open a browser window on the
// owner's PC: created work opens inside Jupiter, and a browser is an explicit choice.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveConfig } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

test('the dev server and the preview server do not open a browser by themselves', async () => {
  const config = await resolveConfig({ root, configFile: path.join(root, 'vite.config.ts') }, 'serve');
  assert.equal(config.server.open, false);
  assert.equal(config.preview.open, false);
});

test('a person can still ask for a browser on purpose', async () => {
  const config = await resolveConfig({ root, configFile: path.join(root, 'vite.config.ts'), server: { open: true } }, 'serve');
  assert.equal(config.server.open, true);
});
