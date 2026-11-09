// Content shipped inside the app (skills, the capability catalogue, tool rules, report chrome) is
// copied into the user's repository at start, so an app update also updates them. A file the user
// changed or deleted since Jupiter last wrote it is left alone and reported.
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { readJson, saveJson } from './util.mjs';

export const MANAGED = ['AGENTS.md', 'CLAUDE.md', '.agents/skills', '.claude/skills', 'knowledge/capabilities.json', 'knowledge/instructions/tool-rules.md', 'processes', 'workspace/_shared',
  'workspace/2026-09-15_make-workspace-yours', 'workspace/2026-09-15_creative-mcp'];
// Every earlier committed version of each managed file (git blob ids), written by desktop/prepare.mjs.
export const HISTORY_FILE = '.jupiter-history.json';
const SKIP = new Set(['node_modules', '.git', '__pycache__', '.DS_Store']);
const hash = data => createHash('sha256').update(data).digest('hex');
export const gitBlobId = data => createHash('sha1').update(`blob ${data.length}\0`).update(data).digest('hex');

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
  const history = await readJson(path.join(source, HISTORY_FILE), null) || {};
  const report = { written: [], kept: [], unchanged: 0 };
  for (const entry of MANAGED) {
    const info = await stat(path.join(source, ...entry.split('/'))).catch(() => null);
    if (!info) continue;
    const list = info.isFile() ? [entry] : await listFiles(source, entry);
    for (const rel of list) {
      const data = await readFile(path.join(source, ...rel.split('/')));
      const next = hash(data);
      const target = path.join(repo, ...rel.split('/'));
      const currentData = await readFile(target).catch(() => null);
      const current = currentData && hash(currentData);
      const last = manifest.files[rel];
      if (current === next) { manifest.files[rel] = next; report.unchanged++; continue; }
      // Still exactly as an earlier release shipped it, so nobody has edited it.
      const shipped = currentData !== null && Array.isArray(history[rel]) && history[rel].includes(gitBlobId(currentData));
      // Deleted after Jupiter wrote it, or edited since (or never written by Jupiter): the user's choice wins.
      if (!shipped && ((current === null && last) || (current !== null && current !== last))) { report.kept.push(rel); continue; }
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, data);
      manifest.files[rel] = next;
      report.written.push(rel);
    }
  }
  await saveJson(manifestFile, manifest);
  report.cards = await syncSampleCards({ source, repo });
  return report;
}

// Sample cards belong to Jupiter: their registry entries follow the shipped ones, keeping the user's
// status and pin. Cards the user created, or removed, are untouched.
async function syncSampleCards({ source, repo }) {
  const shipped = await readJson(path.join(source, 'workspace', 'workspace.json'), null);
  const file = path.join(repo, 'workspace', 'workspace.json');
  const registry = await readJson(file, null);
  if (!Array.isArray(shipped?.entities) || !Array.isArray(registry?.entities)) return [];
  const updated = [];
  for (const card of shipped.entities.filter(entity => entity.sample === true)) {
    const index = registry.entities.findIndex(entity => entity.id === card.id && entity.sample === true);
    if (index < 0) continue;
    const mine = registry.entities[index];
    const next = { ...card, status: mine.status ?? card.status, pinned: mine.pinned ?? card.pinned };
    if (JSON.stringify(next) === JSON.stringify(mine)) continue;
    registry.entities[index] = next;
    updated.push(card.id);
  }
  if (updated.length) await writeFile(file, JSON.stringify(registry, null, 2) + '\n');
  return updated;
}
