// Brainstorm whiteboards. Each board is saved under its title in knowledge/boards as
// <slug>.json (everything needed to draw it) plus <slug>.md, a readable summary for agents.
// Pasted images live in inbox/attachments; boards only reference them by path.
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const MAX_ITEMS = 500, MAX_LINKS = 1000, MAX_STROKES = 500, MAX_POINTS = 3000;
const TYPES = new Set(['note', 'shape', 'image', 'link']);
const SHAPES = new Set(['rect', 'ellipse', 'diamond', 'triangle']);
// Fill colours for notes and shapes, by name (the colours themselves live in the app). 'none' is a shape outline.
export const FILLS = new Set(['navy', 'teal', 'indigo', 'umber', 'ice', 'mint', 'butter', 'coral', 'lilac', 'none']);
const invalid = message => Object.assign(new Error(message), { status: 400 });
const text = (value, max) => String(value ?? '').replace(/\r\n?/g, '\n').slice(0, max);
const line = (value, max = 200) => text(value, max).replace(/\s+/g, ' ').trim();
const num = (value, min, max, fallback = 0) => { const n = Number(value); return Number.isFinite(n) ? Math.round(Math.min(max, Math.max(min, n)) * 10) / 10 : fallback; };
const colour = (value, fallback) => /^#[0-9a-f]{6}$/i.test(String(value)) ? String(value).toLowerCase() : fallback;
const safeId = value => /^[A-Za-z0-9_-]{1,64}$/.test(String(value)) ? String(value) : randomUUID().slice(0, 12);
export const slugOf = title => line(title, 80).toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, '_').slice(0, 60) || 'untitled';

export function cleanBoard(input = {}) {
  const title = line(input.title, 120) || 'Untitled board';
  const ids = new Set();
  const items = (Array.isArray(input.items) ? input.items : []).slice(0, MAX_ITEMS).flatMap(raw => {
    if (!raw || typeof raw !== 'object' || !TYPES.has(raw.type)) return [];
    const item = { id: safeId(raw.id), type: raw.type, x: num(raw.x, -50000, 50000), y: num(raw.y, -50000, 50000), w: num(raw.w, 24, 4000, 220), h: num(raw.h, 24, 4000, 90) };
    if (ids.has(item.id)) item.id = randomUUID().slice(0, 12);
    if (raw.type === 'note' || raw.type === 'shape') item.text = text(raw.text, 2000);
    if (raw.type === 'note') item.tone = Math.max(0, Math.min(3, Math.trunc(Number(raw.tone) || 0)));
    // A fill chosen with the bucket. Boards saved before it have none, so notes keep their tone and shapes their outline.
    if ((raw.type === 'note' || raw.type === 'shape') && FILLS.has(raw.fill) && !(raw.type === 'note' && raw.fill === 'none')) item.fill = raw.fill;
    // A note whose height was set by hand keeps it (and scrolls); otherwise it grows with its text.
    if (raw.type === 'note' && raw.sized === true) item.sized = true;
    if (raw.type === 'shape') { item.shape = SHAPES.has(raw.shape) ? raw.shape : 'rect'; item.color = colour(raw.color, '#7fe3ff'); }
    if (raw.type === 'image') {
      const src = String(raw.src || '').replaceAll('\\', '/');
      if (!/^inbox\/attachments\/[\w .()-]+(\/[\w .()-]+)*$/.test(src) || src.split('/').includes('..')) return [];
      item.src = src; item.name = line(raw.name, 120);
    }
    if (raw.type === 'link') {
      let url; try { url = new URL(String(raw.url)); } catch { return []; }
      if (!['http:', 'https:'].includes(url.protocol)) return [];
      item.url = url.href.slice(0, 2000); item.text = line(raw.text, 200) || url.hostname;
    }
    ids.add(item.id);
    return [item];
  });
  const links = (Array.isArray(input.links) ? input.links : []).slice(0, MAX_LINKS)
    .filter(link => link && ids.has(link.from) && ids.has(link.to) && link.from !== link.to)
    .map(link => ({ id: safeId(link.id), from: link.from, to: link.to }));
  const strokes = (Array.isArray(input.strokes) ? input.strokes : []).slice(0, MAX_STROKES).flatMap(raw => {
    const points = (Array.isArray(raw?.points) ? raw.points : []).slice(0, MAX_POINTS).filter(point => Array.isArray(point) && point.length === 2).map(([x, y]) => [num(x, -50000, 50000), num(y, -50000, 50000)]);
    if (points.length < 2) return [];
    const stroke = { id: safeId(raw.id), kind: raw.kind === 'highlight' ? 'highlight' : 'pen', color: colour(raw.color, '#ffd27a'), size: num(raw.size, 1, 48, 3), points };
    // A highlight on a card keeps the card's id; one on a card that no longer exists is dropped.
    if (raw.on !== undefined) { if (!ids.has(raw.on)) return []; stroke.on = raw.on; }
    return [stroke];
  });
  return { title, items, links, strokes };
}

export function summary(board) {
  const byId = new Map(board.items.map(item => [item.id, item]));
  const label = item => item.type === 'link' ? item.text : item.type === 'image' ? item.name || path.basename(item.src) : (item.text || '').split('\n')[0] || `(${item.shape || item.type})`;
  const section = (title, rows) => rows.length ? `\n## ${title}\n\n${rows.join('\n')}\n` : '';
  return `# ${board.title}\n\nA Jupiter brainstorm board. Edit it in Jupiter; this file is rewritten on every save.\n`
    + section('Ideas', board.items.filter(item => item.type === 'note').map(item => `- ${(item.text || '').replace(/\n+/g, ' ')}`))
    + section('Shapes', board.items.filter(item => item.type === 'shape' && item.text).map(item => `- ${item.text.replace(/\n+/g, ' ')}`))
    + section('Links', board.items.filter(item => item.type === 'link').map(item => `- [${item.text}](${item.url})`))
    + section('Images', board.items.filter(item => item.type === 'image').map(item => `- ${item.src}`))
    + section('Connections', board.links.map(link => `- ${label(byId.get(link.from))} → ${label(byId.get(link.to))}`));
}

async function readJson(file) { try { return JSON.parse(await readFile(file, 'utf8')); } catch { return null; } }
async function writeAtomic(file, data) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomUUID().slice(0, 6)}.tmp`;
  await writeFile(temporary, data, 'utf8'); await rename(temporary, file);
}

export function createBoards(repo) {
  const folder = path.join(repo, 'knowledge', 'boards');
  const fileOf = slug => { if (!/^[\p{L}\p{N}_]{1,60}$/u.test(slug)) throw invalid('That board name is not valid.'); return path.join(folder, `${slug}.json`); };
  let writes = Promise.resolve();
  const serial = task => { const next = writes.catch(() => {}).then(task); writes = next; return next; };

  // The first time, the old single brainstorm (knowledge/notes) becomes a board called Brainstorm.
  async function migrate() {
    if (await stat(folder).then(() => true, () => false)) return;
    const notes = String(await readFile(path.join(repo, 'knowledge/notes/brainstorm.md'), 'utf8').catch(() => ''))
      .split(/\r?\n/).map(row => row.match(/^\s*[-*]\s+(?!\[[ xX]\])(.+?)\s*$/)?.[1]).filter(Boolean);
    const old = await readJson(path.join(repo, 'knowledge/notes/brainstorm.board.json')) || {};
    if (!notes.length) { await mkdir(folder, { recursive: true }); return; }
    const ids = new Map(notes.map(note => [note, randomUUID().slice(0, 12)]));
    const items = notes.map((note, index) => {
      const spot = old.positions?.[note] || { x: 0.04 + (index % 4) * 0.3, y: 0.06 + Math.floor(index / 4) * 0.3 };
      return { id: ids.get(note), type: 'note', text: note, tone: index % 4, x: Math.round(spot.x * 1100) + 40, y: Math.round(spot.y * 520) + 40, w: 220, h: 90 };
    });
    const links = (old.links || []).filter(([a, b]) => ids.has(a) && ids.has(b)).map(([a, b]) => ({ id: randomUUID().slice(0, 12), from: ids.get(a), to: ids.get(b) }));
    const strokes = (old.strokes || []).map(points => ({ kind: 'pen', color: '#ffd27a', size: 3, points: points.map(([x, y]) => [x * 1180 + 40, y * 600 + 40]) }));
    await save(null, { title: 'Brainstorm', items, links, strokes });
  }

  async function list() {
    await migrate();
    const names = (await readdir(folder).catch(() => [])).filter(name => name.endsWith('.json'));
    const boards = await Promise.all(names.map(async name => {
      const file = path.join(folder, name), data = await readJson(file), info = await stat(file).catch(() => null);
      if (!data) return null;
      return { slug: name.slice(0, -5), title: data.title, updated: info?.mtime.toISOString() || null, count: data.items?.length || 0,
        preview: (data.items || []).filter(item => item.type === 'note').slice(-4).map(item => line(item.text, 120)) };
    }));
    return boards.filter(Boolean).sort((a, b) => String(b.updated).localeCompare(String(a.updated)));
  }

  async function read(slug) {
    await migrate();
    const data = await readJson(fileOf(slug));
    if (!data) throw Object.assign(new Error('That board was not found.'), { status: 404 });
    return { slug, ...cleanBoard(data) };
  }

  // Saves under the board's title. A new title moves the board to its new name.
  function save(slug, input) {
    return serial(async () => {
      const board = cleanBoard(input);
      let target = slugOf(board.title);
      if (target !== slug) {
        // Two boards with the same title get a number rather than overwriting each other.
        for (let n = 2; await stat(fileOf(target)).then(() => true, () => false); n++) target = `${slugOf(board.title)}_${n}`;
      }
      await writeAtomic(fileOf(target), JSON.stringify(board, null, 1) + '\n');
      await writeAtomic(path.join(folder, `${target}.md`), summary(board));
      if (slug && slug !== target) { await rm(fileOf(slug), { force: true }); await rm(path.join(folder, `${slug}.md`), { force: true }); }
      return { slug: target, ...board };
    });
  }

  // "idea: …" from Ask Jupiter lands on the board you used last.
  async function quick(idea) {
    const note = line(idea, 2000); if (!note) throw invalid('Say the idea to add.');
    const boards = await list();
    const current = boards[0] ? await read(boards[0].slug) : { slug: null, title: 'Brainstorm', items: [], links: [], strokes: [] };
    const notes = current.items.filter(item => item.type === 'note').length;
    current.items.push({ id: randomUUID().slice(0, 12), type: 'note', text: note, tone: notes % 4, x: 60 + (notes % 5) * 250, y: 60 + Math.floor(notes / 5) * 130, w: 220, h: 90 });
    return save(current.slug, current);
  }

  function remove(slug) {
    return serial(async () => {
      const file = fileOf(slug);
      if (!await stat(file).then(() => true, () => false)) throw Object.assign(new Error('That board was not found.'), { status: 404 });
      const bin = path.join(folder, '.deleted'), stamp = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
      await mkdir(bin, { recursive: true });
      await rename(file, path.join(bin, `${slug}_${stamp}.json`));
      await rename(path.join(folder, `${slug}.md`), path.join(bin, `${slug}_${stamp}.md`)).catch(() => {});
      return { deleted: slug };
    });
  }

  // Find a board by title (ignoring case), or make a new one with that title.
  async function ensure(title) {
    const wanted = line(title, 120) || 'Brainstorm';
    const existing = (await list()).find(board => board.title.toLowerCase() === wanted.toLowerCase());
    return existing ? read(existing.slug) : save(null, { title: wanted, items: [], links: [], strokes: [] });
  }
  // Cards and connections added by Jupiter, laid out in rows beside what's there.
  async function add(slug, { notes = [], links = [] } = {}) {
    const board = await read(slug);
    const key = text => String(text).trim().toLowerCase();
    const byText = new Map(board.items.filter(item => item.type === 'note').map(item => [key(item.text), item]));
    const bottom = board.items.reduce((max, item) => Math.max(max, item.y + item.h), 0);
    let placed = 0;
    const card = text => {
      const found = byText.get(key(text)); if (found) return found;
      const index = placed++, tone = (board.items.filter(item => item.type === 'note').length) % 4;
      const item = { id: randomUUID().slice(0, 12), type: 'note', text: line(text, 2000), tone, x: 60 + (index % 4) * 270, y: (bottom ? bottom + 60 : 60) + Math.floor(index / 4) * 150, w: 220, h: 90 };
      board.items.push(item); byText.set(key(text), item); return item;
    };
    for (const text of notes) if (line(text, 2000)) card(text);
    for (const link of links) {
      if (!line(link?.from) || !line(link?.to)) continue;
      const a = card(link.from), b = card(link.to);
      if (a.id !== b.id && !board.links.some(edge => (edge.from === a.id && edge.to === b.id) || (edge.from === b.id && edge.to === a.id))) board.links.push({ id: randomUUID().slice(0, 12), from: a.id, to: b.id });
    }
    return save(slug, board);
  }

  return { folder, list, read, save, quick, remove, ensure, add };
}
