#!/usr/bin/env node
// Scaffold a game wiki card from the standard template and register it in the Workspace.
// Usage: node .agents/skills/game-wiki/scripts/new-wiki.mjs --title "Game title" [--tagline "..."] [--description "..."] [--repo <path>]
import { randomBytes } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TEMPLATE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../assets/wiki-template.html');
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const escapeHtml = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// Safe inside <script type="application/json">: no "</script" or "<!--" can appear.
const scriptJson = value => JSON.stringify(value).replace(/</g, '\\u003c');
export const slugify = title => String(title).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'game';
const isoDay = date => date.toISOString().slice(0, 10);
const longDay = date => `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;

export function renderTemplate(template, { title, tagline, date }) {
  return template
    .replaceAll('{{GAME_TITLE_JSON}}', scriptJson(title))
    .replaceAll('{{GAME_TITLE}}', escapeHtml(title))
    .replaceAll('{{TAGLINE}}', escapeHtml(tagline))
    .replaceAll('{{DATE_LONG}}', escapeHtml(longDay(date)));
}

export async function createWiki({ repo, title, tagline, description, date = new Date(), suffix = randomBytes(4).toString('hex') }) {
  title = String(title ?? '').replace(/\s+/g, ' ').trim();
  if (!title) throw new Error('A game title is required (--title).');
  if (title.length > 80) throw new Error('Keep the game title under 80 characters.');
  tagline = String(tagline ?? '').replace(/\s+/g, ' ').trim() || 'The living design reference for this game.';
  const registryFile = path.join(repo, 'workspace', 'workspace.json');
  const registry = JSON.parse(await readFile(registryFile, 'utf8'));
  if (!Array.isArray(registry.entities)) throw new Error('workspace/workspace.json has no entities list.');
  const id = `${slugify(title)}-wiki-${suffix}`;
  if (registry.entities.some(entity => entity.id === id)) throw new Error(`A card with the ID ${id} already exists.`);
  const day = isoDay(date);
  const folder = `${day}_${id}`;
  const directory = path.join(repo, 'workspace', folder);
  if (await access(directory).then(() => true, () => false)) throw new Error(`The folder workspace/${folder} already exists.`);
  await mkdir(path.join(directory, 'media'), { recursive: true });
  const file = path.join(directory, 'wiki.html');
  await writeFile(file, renderTemplate(await readFile(TEMPLATE, 'utf8'), { title, tagline, date }));
  const entity = {
    id,
    title: `${title} · Game Wiki`,
    description: String(description ?? '').trim() || `The ${title} game wiki: world, design, development and sources.`,
    type: 'standalone',
    category: 'dev',
    created: day,
    updated: day,
    folder,
    steps: [{ name: 'Game Wiki', path: 'wiki.html' }],
    defaultStep: 0,
    status: 'active',
    pinned: false,
  };
  registry.entities.push(entity);
  await writeFile(registryFile, JSON.stringify(registry, null, 2) + '\n');
  return { id, folder, file, entity, link: `[${entity.title}](#/${id})` };
}

async function findRepo(start) {
  let current = path.resolve(start);
  for (;;) {
    if (await access(path.join(current, 'workspace', 'workspace.json')).then(() => true, () => false)) return current;
    const parent = path.dirname(current);
    if (parent === current) throw new Error('Run this inside a Jupiter workspace (no workspace/workspace.json found), or pass --repo.');
    current = parent;
  }
}

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const match = /^--(title|tagline|description|repo)$/.exec(argv[i]);
    if (!match || i + 1 >= argv.length) throw new Error(`Unexpected argument: ${argv[i]}`);
    options[match[1]] = argv[++i];
  }
  return options;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const repo = options.repo ? path.resolve(options.repo) : await findRepo(process.cwd());
    const result = await createWiki({ ...options, repo });
    console.log(JSON.stringify({ id: result.id, file: path.relative(repo, result.file).replaceAll('\\', '/'), link: result.link }, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
