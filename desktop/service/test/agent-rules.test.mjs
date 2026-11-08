import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { syncAgentRules, withRules, withoutRules } from '../agent-rules.mjs';

test('rules are added between markers, updated in place and never disturb the rest of the file', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'jupiter-rules-'));
  const repo = path.join(root, 'repo'), home = path.join(root, 'home');
  await mkdir(path.join(repo, 'knowledge/instructions'), { recursive: true });
  await writeFile(path.join(repo, 'knowledge/instructions/tool-rules.md'), '# Rules\n- one\n');
  await mkdir(path.join(home, '.claude'), { recursive: true });
  await writeFile(path.join(home, '.claude/CLAUDE.md'), '# Mine\nKeep this.\n');
  const changed = await syncAgentRules(repo, { home, env: {} });
  assert.equal(changed.length, 2);
  const claude = await readFile(path.join(home, '.claude/CLAUDE.md'), 'utf8');
  assert.match(claude, /^# Mine\nKeep this\.\n\n<!-- jupiter:tool-rules:start[^\n]*-->\n# Rules\n- one\n<!-- jupiter:tool-rules:end -->\n$/);
  assert.match(await readFile(path.join(home, '.codex/AGENTS.md'), 'utf8'), /^<!-- jupiter:tool-rules:start[\s\S]*- one\n<!-- jupiter:tool-rules:end -->\n$/);
  assert.deepEqual(await syncAgentRules(repo, { home, env: {} }), [], 'nothing to do when unchanged');
  await writeFile(path.join(repo, 'knowledge/instructions/tool-rules.md'), '# Rules\n- two\n');
  await writeFile(path.join(home, '.claude/CLAUDE.md'), claude + '\nAdded later by hand.\n');
  await syncAgentRules(repo, { home, env: {} });
  const updated = await readFile(path.join(home, '.claude/CLAUDE.md'), 'utf8');
  assert.match(updated, /- two\n<!-- jupiter:tool-rules:end -->\n\nAdded later by hand\.\n$/);
  assert.doesNotMatch(updated, /- one/);
  assert.equal(withoutRules(withRules('# Mine\n', 'x')).trim(), '# Mine');
});

test('no rules file means no changes', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'jupiter-rules-'));
  assert.deepEqual(await syncAgentRules(root, { home: root, env: {} }), []);
});
