// Copies Jupiter's tool rules (knowledge/instructions/tool-rules.md) into the agents' global
// instruction files, so every Claude Code and Codex chat follows them. Only the text between
// Jupiter's markers is ever replaced; anything else in those files is left exactly as it is.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const START = '<!-- jupiter:tool-rules:start (managed by Jupiter; edit knowledge/instructions/tool-rules.md instead) -->';
const END = '<!-- jupiter:tool-rules:end -->';

export function withRules(text, rules) {
  const block = `${START}\n${rules.trim()}\n${END}`;
  const start = text.indexOf(START.slice(0, 30)), end = text.indexOf(END);
  if (start >= 0 && end > start) return text.slice(0, start) + block + text.slice(end + END.length);
  return text.trim() ? `${text.replace(/\s*$/, '')}\n\n${block}\n` : `${block}\n`;
}

export function withoutRules(text) {
  const start = text.indexOf(START.slice(0, 30)), end = text.indexOf(END);
  if (start < 0 || end < start) return text;
  return (text.slice(0, start).replace(/\s*$/, '') + text.slice(end + END.length)).replace(/^\s+$/, '');
}

export function ruleTargets({ home = os.homedir(), env = process.env } = {}) {
  return [
    path.join(env.CLAUDE_CONFIG_DIR || path.join(home, '.claude'), 'CLAUDE.md'),
    path.join(env.CODEX_HOME || path.join(home, '.codex'), 'AGENTS.md'),
  ];
}

// Returns the files it changed. A missing rules file means there is nothing to sync.
export async function syncAgentRules(repo, options = {}) {
  let rules;
  try { rules = await readFile(path.join(repo, 'knowledge/instructions/tool-rules.md'), 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const changed = [];
  for (const file of ruleTargets(options)) {
    const before = await readFile(file, 'utf8').catch(error => { if (error.code === 'ENOENT') return ''; throw error; });
    const after = withRules(before, rules);
    if (after === before) continue;
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, after);
    changed.push(file);
  }
  return changed;
}
