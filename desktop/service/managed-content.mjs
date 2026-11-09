// Content shipped inside the app (skills, the capability catalogue, tool rules, report chrome) is
// copied into the user's repository at start, so an app update also updates them. A file the user
// changed or deleted since Jupiter last wrote it is left alone and reported.
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { readJson, saveJson } from './util.mjs';

export const MANAGED = ['AGENTS.md', 'CLAUDE.md', '.agents/skills', '.claude/skills', 'knowledge/capabilities.json', 'knowledge/instructions/tool-rules.md', 'processes', 'workspace/_shared'];
const SKIP = new Set(['node_modules', '.git', '__pycache__', '.DS_Store']);
const hash = data => createHash('sha256').update(data).digest('hex');

async function listFiles(root, rel, out = []) {
  const entries = await readdir(path.join(root, ...rel.split('/')), { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (SKIP.has(entry.name)) continue;
    const child = `${rel}/${entry.name}`;
    if (entry.isDirectory()) await listFiles(root, child, out);
    else if (entry.isFile()) out.push(child);
  }
  return out;
}

export async function syncManagedContent({ source, repo, stateDir }) {
  const manifestFile = path.join(stateDir, 'managed-content.json');
  const manifest = await readJson(manifestFile, null) || { files: {} };
  const report = { written: [], kept: [], unchanged: 0 };
  for (const entry of MANAGED) {
    const info = await stat(path.join(source, ...entry.split('/'))).catch(() => null);
    if (!info) continue;
    const list = info.isFile() ? [entry] : await listFiles(source, entry);
    for (const rel of list) {
      const data = await readFile(path.join(source, ...rel.split('/')));
      const next = hash(data);
      const target = path.join(repo, ...rel.split('/'));
      const current = await readFile(target).then(hash, () => null);
      const last = manifest.files[rel];
      if (current === next) { manifest.files[rel] = next; report.unchanged++; continue; }
      // Deleted after Jupiter wrote it, or edited since (or never written by Jupiter): the user's choice wins.
      if ((current === null && last) || (current !== null && current !== last)) { report.kept.push(rel); continue; }
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, data);
      manifest.files[rel] = next;
      report.written.push(rel);
    }
  }
  await saveJson(manifestFile, manifest);
  return report;
}
