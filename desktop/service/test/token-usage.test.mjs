import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createTokenUsage } from '../token-usage.mjs';

test('usage is totalled from Claude Code and Codex logs without reading the conversation', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'jupiter-tokens-'));
  const now = new Date().toISOString(), old = new Date(Date.now() - 3 * 86400000).toISOString();
  await mkdir(path.join(home, '.claude/projects/D--game'), { recursive: true });
  const reply = (id, ts, usage, model = 'claude-opus-5-5') => JSON.stringify({ type: 'assistant', timestamp: ts, message: { id, model, content: [{ type: 'text', text: 'secret words' }], usage } });
  await writeFile(path.join(home, '.claude/projects/D--game/a.jsonl'), [
    JSON.stringify({ type: 'user', timestamp: now, message: { content: 'hello' } }),
    reply('m1', now, { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 100, cache_creation_input_tokens: 5 }),
    reply('m1', now, { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 100, cache_creation_input_tokens: 5 }),
    reply('m2', old, { input_tokens: 1, output_tokens: 2 }, 'claude-sonnet-5-5'),
    'not json',
  ].join('\n'));
  await mkdir(path.join(home, '.codex/sessions/2026/11/02'), { recursive: true });
  await writeFile(path.join(home, '.codex/sessions/2026/11/02/r.jsonl'), [
    JSON.stringify({ type: 'turn_context', timestamp: now, payload: { model: 'gpt-6-astra' } }),
    JSON.stringify({ type: 'event_msg', timestamp: now, payload: { type: 'token_count', info: { last_token_usage: { input_tokens: 50, cached_input_tokens: 30, output_tokens: 7, reasoning_output_tokens: 3 } } } }),
  ].join('\n'));
  const usage = await createTokenUsage({ home, env: {} }).summary();
  assert.deepEqual(usage.totals.today.claude, { input: 10, output: 20, cacheRead: 100, cacheWrite: 5, total: 135 }, 'a streamed reply counts once');
  assert.deepEqual(usage.totals.today.codex, { input: 20, output: 10, cacheRead: 30, cacheWrite: 0, total: 60 });
  assert.equal(usage.totals.week.claude.total, 138);
  assert.deepEqual(usage.models.map(model => [model.agent, model.model, model.usage.total]), [['claude', 'claude-opus-5-5', 135], ['codex', 'gpt-6-astra', 60], ['claude', 'claude-sonnet-5-5', 3]]);
  assert.equal(usage.byDay.length, 14);
  assert.doesNotMatch(JSON.stringify(usage), /secret words|hello/, 'no conversation text');
});

test('no logs means zero usage, not an error', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'jupiter-tokens-'));
  const usage = await createTokenUsage({ home, env: {} }).summary();
  assert.equal(usage.totals.week.claude.total + usage.totals.week.codex.total, 0);
  assert.deepEqual(usage.sources, { claude: 0, codex: 0 });
});
