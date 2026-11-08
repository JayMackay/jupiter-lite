// Jupiter's work boards: simple kanban boards stored in the knowledge folder.
// Each board is knowledge/work/<slug>.json, with a readable Markdown summary
// (knowledge/work/<slug>.md) rewritten alongside it on every save.
import { access, mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

// Three columns: Backlog (stored as 'todo', so saved items keep their state), In progress and Done.
export const COLUMNS = Object.freeze(['todo', 'doing', 'done']);
export const COLUMN_LABELS = Object.freeze({ todo: 'Backlog', doing: 'In progress', done: 'Done' });
// Testing was retired on 4 November 2026: its items (and tasks) move to In progress, and the move is
// kept in the item's history. Old history entries may still name it.
const RETIRED = Object.freeze({ testing: 'doing' });
const HISTORY_STATES = Object.freeze([...COLUMNS, 'testing']);
const LIMIT_CYCLES = 100, LIMIT_HISTORY = 200;
export const LIMITS = Object.freeze({ title: 500, text: 5000, items: 300, tasks: 100, boards: 100, tags: 20, tag: 40, boardTags: 100 });
export const TAG_COLORS = Object.freeze(['ice', 'violet', 'green', 'amber', 'pink', 'teal', 'lime', 'orange']);
// Top level items are features, bugs or spikes (research). Tasks only exist as children of an item.
export const TYPES = Object.freeze(['feature', 'bug', 'spike']);
export const TYPE_LABELS = Object.freeze({ feature: 'Feature', bug: 'Bug', spike: 'Spike' });
export const PRIORITIES = Object.freeze(['none', 'low', 'medium', 'high']);
// Optional work in progress limit for In progress (null means no limit).
export const LIMITED = Object.freeze(['doing']);
export const DEFAULT_LIMITS = Object.freeze({ doing: 3 });
export const LIMIT_RANGE = Object.freeze({ min: 1, max: 50 });
const DAY = 86400000;
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const SAFE_PROJECT = /^[A-Za-z0-9._-]{1,128}$/;

const line = (value, max = LIMITS.title) => String(value ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, max);
const block = (value, max = LIMITS.text) => String(value ?? '').replace(/\r\n?/g, '\n').slice(0, max);
const newId = prefix => `${prefix}${Date.now().toString(36)}${randomBytes(4).toString('hex')}`;
const safeId = (value, prefix) => (typeof value === 'string' && SAFE_ID.test(value) ? value : newId(prefix));
const project = value => (typeof value === 'string' && SAFE_PROJECT.test(value) ? value : null);
const dueDate = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? value : null;
};
const stamp = (value, fallback) => (typeof value === 'string' && value.length <= 40 && !Number.isNaN(Date.parse(value)) ? value : fallback);

export function slugify(title) {
  const slug = String(title ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48).replace(/-+$/, '');
  return slug || 'board';
}
// A file name in knowledge/work/.deleted: <slug>-<ISO time with : and . as ->[-<n>].
const DELETED_NAME = /^([a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?)-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z(?:-\d{1,4})?$/;
const validSlug = slug =>typeof slug === 'string' && /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(slug);
// A missing limit gets the default; null clears it; anything else must be a whole number from 1 to 50.
export function cleanLimits(value) {
  const source = value && typeof value === 'object' ? value : {};
  const limits = {};
  for (const column of LIMITED) {
    const raw = source[column];
    if (raw === null) limits[column] = null;
    else if (Number.isInteger(raw) && raw >= LIMIT_RANGE.min && raw <= LIMIT_RANGE.max) limits[column] = raw;
    else limits[column] = DEFAULT_LIMITS[column];
  }
  return limits;
}
const notFound = () => Object.assign(new Error('That board does not exist.'), { status: 404 });

function cleanTask(task, seen, parent) {
  const title = line(task?.title);
  if (!title) return null;
  let id = safeId(task?.id, 't');
  while (seen.has(id)) id = newId('t');
  seen.add(id);
  // A task's state is one of the four columns; done is simply state === 'done'. Older tasks only had
  // done, so their state comes from it. Older tasks also had no dates, so they borrow the parent's.
  const state = COLUMNS.includes(task?.state) ? task.state : RETIRED[task?.state] || (task?.done === true ? 'done' : 'todo');
  const created = stamp(task?.created, parent.created);
  const completed = state === 'done' ? stamp(task?.completed, parent.updated) : null;
  // A task's time starts when it first enters In progress, never from when it was created or from its
  // parent. It has work cycles like an item: a task never started has none. A task already In progress
  // that was saved before tasks had cycles gets one legacy cycle from its created date.
  let cycles = cleanCycles(task?.cycles);
  if (!Array.isArray(task?.cycles) && state === 'doing') cycles = [{ start: created, end: null, fresh: true, legacy: true }];
  cycles = settleCycles(cycles, state, state === 'done' ? completed : parent.updated);
  return { id, title, done: state === 'done', state, details: block(task?.details), created, completed, cycles };
}

// Board tags: unique by name (ignoring case), each with a colour from TAG_COLORS. `add` returns the
// stored name, or null when the name is empty or the board already has LIMITS.boardTags tags.
function tagList(initial = []) {
  const tags = [];
  const byKey = new Map();
  const add = (name, color) => {
    const clean = line(name, LIMITS.tag);
    if (!clean) return null;
    const key = clean.toLowerCase();
    if (byKey.has(key)) return byKey.get(key).name;
    if (tags.length >= LIMITS.boardTags) return null;
    const tag = { name: clean, color: TAG_COLORS.includes(color) ? color : TAG_COLORS[tags.length % TAG_COLORS.length] };
    tags.push(tag); byKey.set(key, tag);
    return tag.name;
  };
  for (const tag of Array.isArray(initial) ? initial : []) add(tag?.name, tag?.color);
  return { tags, add };
}

// `context.tags` is the board's tag list (new tag names are added to it); `context.projectTitles`
// maps Workspace card ids to titles so an older item's project becomes a tag of that title.
export function cleanItem(item, now = new Date().toISOString(), seen = new Set(), context = {}) {
  const title = line(item?.title);
  if (!title) return null;
  let id = safeId(item?.id, 'w');
  while (seen.has(id)) id = newId('w');
  seen.add(id);
  const order = Number(item?.order);
  const created = stamp(item?.created, now);
  const updated = stamp(item?.updated, created);
  const state = COLUMNS.includes(item?.state) ? item.state : RETIRED[item?.state] || 'todo';
  const history = cleanHistory(item?.history);
  if (RETIRED[item?.state]) history.push({ at: updated, from: item.state, to: state });
  const completedAt = state === 'done' ? stamp(item?.completed, updated) : null;
  // Work cycles: when the item was actually in progress. A board saved before cycles existed gets one
  // from the dates its calendar already used (created to done, or to now while in progress), marked
  // legacy; a Backlog item gets none. Nothing else is made up.
  let cycles = cleanCycles(item?.cycles);
  if (!Array.isArray(item?.cycles)) {
    if (state === 'doing') cycles = [{ start: created, end: null, fresh: true, legacy: true }];
    else if (state === 'done') cycles = [{ start: created, end: completedAt, fresh: true, legacy: true }];
  }
  cycles = settleCycles(cycles, state, state === 'done' ? completedAt : updated);
  const taskIds = new Set();
  const tasks = (Array.isArray(item?.tasks) ? item.tasks : []).slice(0, LIMITS.tasks).map(task => cleanTask(task, taskIds, { created, updated })).filter(Boolean);
  const board = context.tags || tagList();
  const names = (Array.isArray(item?.tags) ? item.tags : []).filter(name => typeof name === 'string');
  const legacy = project(item?.project);
  if (legacy && context.projectTitles?.[legacy]) names.push(context.projectTitles[legacy]);
  const tags = [];
  for (const name of names) {
    if (tags.length >= LIMITS.tags) break;
    const stored = board.add(name);
    if (stored && !tags.includes(stored)) tags.push(stored);
  }
  return {
    id,
    // Older boards had top level tasks; they (and anything unknown) become features.
    type: TYPES.includes(item?.type) ? item.type : 'feature',
    title,
    details: block(item?.details),
    acceptance: block(item?.acceptance),
    state,
    tags,
    priority: PRIORITIES.includes(item?.priority) ? item.priority : 'none',
    due: dueDate(item?.due),
    // Refinement is the item's own property, not a tag: new items need refining until marked Refined.
    refined: item?.refined === true,
    cycles,
    history: history.slice(-LIMIT_HISTORY),
    order: Number.isFinite(order) ? order : 0,
    tasks,
    created,
    updated,
    // When the item reached Done; cleared when it leaves Done.
    completed: completedAt,
  };
}

// --- work cycles ---------------------------------------------------------------------------------
// A cycle is one stretch In progress: { start, end } (end null while it runs). `fresh` marks a cycle
// that started a new count (Start a new work cycle); otherwise it continues the one before.
// Durations are measured from the moment of each move, in milliseconds; a day is 24 hours. Shown
// values round to whole hours under a day and whole days after. Backlog time never counts as active.

function cleanCycles(value) {
  if (!Array.isArray(value)) return [];
  const cycles = value.slice(-LIMIT_CYCLES).flatMap(cycle => {
    const start = stamp(cycle?.start, null);
    if (!start) return [];
    const end = cycle?.end == null ? null : stamp(cycle.end, null);
    return [{ start, end: end && Date.parse(end) < Date.parse(start) ? start : end, ...(cycle?.fresh === true ? { fresh: true } : {}), ...(cycle?.legacy === true ? { legacy: true } : {}) }];
  }).sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  if (cycles[0]) cycles[0].fresh = true;
  return cycles;
}
function cleanHistory(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(-LIMIT_HISTORY).flatMap(entry => {
    const at = stamp(entry?.at, null);
    return at && HISTORY_STATES.includes(entry?.from) && COLUMNS.includes(entry?.to) && entry.from !== entry.to ? [{ at, from: entry.from, to: entry.to }] : [];
  });
}
/**
 * Keeps cycles in step with the state, however the item was moved (the board, a voice command or an
 * agent editing the file): In progress has exactly one open cycle, anything else has none. A cycle
 * left open by mistake ends where the next one starts; a missing one starts at `at` and continues the
 * count (as the resume question's default does).
 */
export function settleCycles(cycles, state, at) {
  const list = cycles.map((cycle, index) => index < cycles.length - 1 && cycle.end === null ? { ...cycle, end: cycles[index + 1].start } : cycle);
  const last = list.at(-1);
  if (state === 'doing' && (!last || last.end !== null)) list.push({ start: at, end: null, ...(list.length ? {} : { fresh: true }) });
  if (state !== 'doing' && last && last.end === null) list[list.length - 1] = { ...last, end: Date.parse(at) < Date.parse(last.start) ? last.start : at };
  return list;
}
/**
 * An item's tracked time. currentMs: the latest cycle. inFlightMs: the count shown on the card, from the
 * latest fresh cycle on (Continue keeps adding; a new cycle starts again). activeMs: every cycle.
 * elapsedMs: from first starting to Done, or to now, pauses included.
 */
export function tracking(item, now = Date.now()) {
  const cycles = Array.isArray(item?.cycles) ? item.cycles : [];
  const length = cycle => Math.max(0, (cycle.end ? Date.parse(cycle.end) : now) - Date.parse(cycle.start));
  if (!cycles.length) return { cycles: 0, currentMs: 0, inFlightMs: 0, activeMs: 0, elapsedMs: 0, started: null };
  let from = cycles.length - 1;
  while (from > 0 && !cycles[from].fresh) from--;
  const sum = list => list.reduce((total, cycle) => total + length(cycle), 0);
  const last = cycles.at(-1);
  const finish = item.state === 'done' && last.end ? Date.parse(last.end) : now;
  return { cycles: cycles.length, currentMs: length(last), inFlightMs: sum(cycles.slice(from)), activeMs: sum(cycles), elapsedMs: Math.max(0, finish - Date.parse(cycles[0].start)), started: cycles[0].start };
}

// Validates and clamps a whole board. Orders are renumbered 0..n within each column.
export function cleanBoard(value, { slug, id, now = new Date().toISOString(), projectTitles = {} } = {}) {
  const board = value && typeof value === 'object' ? value : {};
  const seen = new Set();
  const tags = tagList(board.tags);
  const items = (Array.isArray(board.items) ? board.items : []).slice(0, LIMITS.items).map(item => cleanItem(item, now, seen, { tags, projectTitles })).filter(Boolean);
  for (const column of COLUMNS) {
    items.filter(item => item.state === column).sort((a, b) => a.order - b.order).forEach((item, index) => { item.order = index; });
  }
  items.sort((a, b) => COLUMNS.indexOf(a.state) - COLUMNS.indexOf(b.state) || a.order - b.order);
  return {
    id: safeId(id ?? board.id, 'b'),
    slug: slug ?? board.slug,
    title: line(board.title) || 'Untitled board',
    project: project(board.project),
    columns: [...COLUMNS],
    limits: cleanLimits(board.limits),
    tags: tags.tags,
    items,
    created: stamp(board.created, now),
    updated: now,
  };
}

export function boardMarkdown(board, projectTitles = {}) {
  const linked = board.project ? `${projectTitles[board.project] || board.project} (${board.project})` : 'none';
  const out = [`# ${board.title}`, '', `Project: ${linked}`, ''];
  const limits = cleanLimits(board.limits);
  out.push(`Limits: ${LIMITED.map(column => `${COLUMN_LABELS[column]} ${limits[column] ?? 'none'}`).join(', ')}`, '');
  if (board.tags?.length) out.push(`Tags: ${board.tags.map(tag => tag.name).join(', ')}`, '');
  for (const column of COLUMNS) {
    const items = board.items.filter(item => item.state === column).sort((a, b) => a.order - b.order);
    const limit = LIMITED.includes(column) ? limits[column] : null;
    const over = limit !== null && items.length > limit ? ', over the limit' : '';
    out.push(`## ${COLUMN_LABELS[column]} (${limit === null ? items.length : `${items.length}/${limit}${over}`})`, '');
    if (!items.length) out.push('Nothing here.', '');
    for (const item of items) {
      const chips = [TYPE_LABELS[item.type]];
      if (item.priority !== 'none') chips.push(`${item.priority} priority`);
      if (item.due) chips.push(`due ${item.due}`);
      if (item.tags.length) chips.push(`tags ${item.tags.join(', ')}`);
      if (item.tasks.length) chips.push(`${item.tasks.filter(task => task.done).length}/${item.tasks.length} tasks`);
      chips.push(`created ${item.created.slice(0, 10)}`);
      if (item.completed) chips.push(`done ${item.completed.slice(0, 10)}`);
      out.push(`### ${item.title}`, '', `_${chips.join(' · ')}_`, '');
      if (item.details.trim()) out.push(item.details.trim(), '');
      if (item.tasks.length) {
        for (const task of item.tasks) {
          const note = task.state === 'doing' ? ` (${COLUMN_LABELS[task.state]})` : '';
          out.push(`- [${task.done ? 'x' : ' '}] ${task.title}${note}`);
          if (task.details.trim()) out.push(...task.details.trim().split('\n').map(text => `  ${text}`.trimEnd()));
        }
        out.push('');
      }
      if (item.acceptance.trim()) out.push('**Acceptance criteria**', '', item.acceptance.trim(), '');
    }
  }
  return `${out.join('\n').trimEnd()}\n`;
}

// "5 hours", "3 days", "2 weeks": the same wording as the board's cards and sheet.
export function spanText(ms) {
  const hours = Math.max(1, Math.round(ms / 3600000));
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  const days = Math.round(ms / DAY);
  if (days < 14) return `${days} ${days === 1 ? 'day' : 'days'}`;
  return `${Math.round(days / 7)} weeks`;
}
const localDay = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
// UK dates (DD/MM/YYYY), the same format as the board and sheet.
const ukDate = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
export const ukDay = date => ukDate.format(date);

// The UK calendar week (Monday 00:00 to the next Monday, local time) that is `offsetWeeks` before
// this one (negative is a later week, so the calendar can page forward).
export function weekBounds(now = new Date(), offsetWeeks = 0) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7) - offsetWeeks * 7);
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7);
  return { start, end };
}

// What reached Done in a UK calendar week (Monday to Sunday; offsetWeeks 0 is this week, 1 the week
// before), plus items In progress for over 7 days of in flight time by the end of that week (or now,
// when the week has not finished yet).
export function weeklySummary(board, { offsetWeeks = 0, now = new Date() } = {}) {
  const offset = Number.isInteger(offsetWeeks) && Math.abs(offsetWeeks) <= 520 ? offsetWeeks : 0;
  const { start, end } = weekBounds(now, offset);
  const last = new Date(end.getTime() - 1);
  const until = Math.min(end.getTime(), now.getTime());
  const done = board.items
    .filter(item => item.state === 'done' && item.completed && Date.parse(item.completed) >= start.getTime() && Date.parse(item.completed) < end.getTime())
    .sort((a, b) => Date.parse(b.completed) - Date.parse(a.completed))
    .map(item => {
      // Time actually worked (every cycle In progress), not time since it was created.
      const track = tracking(item, until);
      const ms = track.cycles ? track.activeMs : Math.max(0, Date.parse(item.completed) - Date.parse(item.created));
      return { id: item.id, type: item.type, title: item.title, tags: item.tags, created: item.created, completed: item.completed, ms, after: spanText(ms) };
    });
  // In progress for over 7 days by the end of the week (or now): its in flight count, Backlog time excluded.
  const inFlight = board.items
    .filter(item => item.state === 'doing')
    .map(item => ({ item, ms: tracking(item, until).inFlightMs }))
    .filter(entry => entry.ms > 7 * DAY)
    .sort((a, b) => b.ms - a.ms)
    .map(({ item, ms }) => ({ id: item.id, type: item.type, title: item.title, tags: item.tags, state: item.state, created: item.created, ms, for: spanText(ms) }));
  const byType = Object.fromEntries(TYPES.map(type => [type, done.filter(item => item.type === type).length]));
  const averageMs = done.length ? Math.round(done.reduce((sum, item) => sum + item.ms, 0) / done.length) : null;
  const range = `${ukDay(start)} to ${ukDay(last)}`;
  const summary = { slug: board.slug, title: board.title, offsetWeeks: offset, start: start.toISOString(), end: end.toISOString(), date: localDay(start), range, total: done.length, byType, averageMs, average: averageMs === null ? null : spanText(averageMs), done, inFlight };
  return { ...summary, markdown: weeklyMarkdown(summary) };
}

export function weeklyMarkdown(summary) {
  const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
  const types = TYPES.filter(type => summary.byType[type]).map(type => plural(summary.byType[type], TYPE_LABELS[type]));
  const out = [`# ${summary.title}: ${summary.range}`, ''];
  out.push(`${summary.total} done${types.length ? ` (${types.join(', ')})` : ''}${summary.average ? `, average ${summary.average} of active work` : ''}.`, '');
  const tags = item => item.tags.length ? ` [${item.tags.join(', ')}]` : '';
  out.push('## Done', '');
  if (!summary.done.length) out.push('Nothing reached Done.', '');
  else out.push(...summary.done.map(item => `- ${TYPE_LABELS[item.type]}: ${item.title}${tags(item)}, done after ${item.after}`), '');
  out.push('## Still in flight', '');
  if (!summary.inFlight.length) out.push('Nothing has been in flight for over 7 days.', '');
  else out.push(...summary.inFlight.map(item => `- ${TYPE_LABELS[item.type]}: ${item.title}${tags(item)}, ${COLUMN_LABELS[item.state]} for ${item.for}`), '');
  return `${out.join('\n').trimEnd()}\n`;
}

async function readText(file) {
  try { return await readFile(file, 'utf8'); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function writeAtomic(file, text) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomBytes(3).toString('hex')}.tmp`;
  await writeFile(temporary, text, 'utf8');
  // On Windows a rename over a file that something is reading (an editor, a sync tool, a test)
  // briefly fails with EPERM or EBUSY, so retry for a moment before giving up.
  for (let attempt = 0; ; attempt++) {
    try { await rename(temporary, file); return; } catch (error) {
      if (attempt >= 8 || !['EPERM', 'EBUSY', 'EACCES'].includes(error.code)) { await unlink(temporary).catch(() => {}); throw error; }
      await new Promise(resolve => setTimeout(resolve, 25 * (attempt + 1)));
    }
  }
}

// A rename that retries briefly on Windows sharing errors, like writeAtomic.
async function moveFile(from, to) {
  for (let attempt = 0; ; attempt++) {
    try { await rename(from, to); return; } catch (error) {
      if (attempt >= 8 || !['EPERM', 'EBUSY', 'EACCES'].includes(error.code)) throw error;
      await new Promise(resolve => setTimeout(resolve, 25 * (attempt + 1)));
    }
  }
}

// One queue per board file (and one per repo for creating boards), shared by every caller in
// this process, so concurrent saves never interleave.
const queues = new Map();
function serial(key, task) {
  const previous = queues.get(key) || Promise.resolve();
  const next = previous.catch(() => {}).then(task);
  const tail = next.catch(() => {});
  queues.set(key, tail);
  tail.then(() => { if (queues.get(key) === tail) queues.delete(key); });
  return next;
}

export function createWorkItems(repo) {
  const folder = path.join(repo, 'knowledge', 'work');
  const fileFor = slug => path.join(folder, `${slug}.json`);
  const projectTitles = async () => {
    try {
      const registry = JSON.parse(await readFile(path.join(repo, 'workspace', 'workspace.json'), 'utf8'));
      return Object.fromEntries((registry.entities || []).filter(entity => entity?.id).map(entity => [entity.id, line(entity.title) || entity.id]));
    } catch { return {}; }
  };

  async function load(slug) {
    if (!validSlug(slug)) throw notFound();
    const text = await readText(fileFor(slug));
    if (text === null) throw notFound();
    let raw; try { raw = JSON.parse(text); } catch { raw = {}; }
    const board = cleanBoard(raw, { slug, id: raw?.id, projectTitles: await projectTitles() });
    board.updated = stamp(raw?.updated, board.updated);
    return board;
  }
  async function write(board) {
    await writeAtomic(fileFor(board.slug), `${JSON.stringify(board, null, 1)}\n`);
    await writeAtomic(path.join(folder, `${board.slug}.md`), boardMarkdown(board, await projectTitles()));
    return board;
  }
  async function slugs() {
    try { return (await readdir(folder)).filter(name => name.endsWith('.json')).map(name => name.slice(0, -5)).filter(validSlug); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  }

  const trash = path.join(folder, '.deleted');
  const seededMarker = path.join(folder, '.seeded');
  const exists = file => access(file).then(() => true, () => false);

  // True first run only: a "My board" seeded from the old knowledge/todo.md list (which is kept).
  // Once seeded (the .seeded marker) or once any board was deleted (the .deleted folder), no board
  // is ever made on its own again, so deleting the last board leaves none.
  const ensure = () => serial(`${folder}::create`, async () => {
    if ((await slugs()).length || await exists(seededMarker) || await exists(trash)) return;
    const todo = (await readText(path.join(repo, 'knowledge', 'todo.md'))) || '';
    const items = [];
    for (const text of todo.split(/\r?\n/)) {
      const match = text.match(/^\s*[-*]\s+\[( |x|X)\]\s+(.+?)\s*$/);
      if (match) items.push({ type: 'feature', title: match[2], state: match[1].toLowerCase() === 'x' ? 'done' : 'todo', order: items.length });
    }
    await write(cleanBoard({ title: 'My board', items }, { slug: 'my-board' }));
    await writeAtomic(seededMarker, `${new Date().toISOString()}\n`);
  });

  const api = {
    folder,
    async list() {
      await ensure();
      const boards = [];
      for (const slug of await slugs()) {
        try {
          const board = await load(slug);
          const counts = Object.fromEntries(COLUMNS.map(column => [column, board.items.filter(item => item.state === column).length]));
          boards.push({ slug, title: board.title, project: board.project, counts, updated: board.updated });
        } catch { /* a hand-broken file is skipped rather than breaking the list */ }
      }
      return boards.sort((a, b) => String(b.updated).localeCompare(String(a.updated)) || a.title.localeCompare(b.title));
    },
    async read(slug) { await ensure(); return load(slug); },
    async create(data = {}) {
      await ensure();
      const title = line(data.title);
      if (!title) throw Object.assign(new Error('Give the board a title.'), { status: 400 });
      return serial(`${folder}::create`, async () => {
        const existing = new Set(await slugs());
        if (existing.size >= LIMITS.boards) throw Object.assign(new Error('There are too many boards.'), { status: 400 });
        const base = slugify(title);
        let slug = base;
        for (let n = 2; existing.has(slug); n++) slug = `${base}-${n}`;
        return write(cleanBoard({ title, project: data.project, items: [] }, { slug }));
      });
    },
    async save(slug, value) {
      await ensure();
      if (!value || typeof value !== 'object') throw Object.assign(new Error('Send the board to save.'), { status: 400 });
      return serial(fileFor(slug), async () => {
        const current = await load(slug);
        return write(cleanBoard({ ...value, created: current.created }, { slug, id: current.id, projectTitles: await projectTitles() }));
      });
    },
    // Moves <slug>.json and <slug>.md to knowledge/work/.deleted/<slug>-<timestamp>.json/.md, so a
    // board can be restored (see restore) or recovered by hand. Weekly files are left alone. Deleting
    // the last board leaves no boards. Returns the board list, the slug to show next (null when none
    // remain) and `name`, the moved file name that restore takes.
    async remove(slug, now = new Date()) {
      await ensure();
      if (!validSlug(slug)) throw notFound();
      return serial(`${folder}::create`, () => serial(fileFor(slug), async () => {
        if ((await readText(fileFor(slug))) === null) throw notFound();
        await mkdir(trash, { recursive: true });
        const base = `${slug}-${now.toISOString().replace(/[:.]/g, '-')}`;
        let name = base;
        for (let n = 2; (await readText(path.join(trash, `${name}.json`))) !== null; n++) name = `${base}-${n}`;
        await moveFile(fileFor(slug), path.join(trash, `${name}.json`));
        await moveFile(path.join(folder, `${slug}.md`), path.join(trash, `${name}.md`)).catch(error => { if (error.code !== 'ENOENT') throw error; });
        return { deleted: slug, name, moved: [`knowledge/work/.deleted/${name}.json`, `knowledge/work/.deleted/${name}.md`] };
      })).then(async result => {
        const boards = await api.list();
        return { ...result, boards, next: boards[0]?.slug ?? null };
      });
    },
    // Puts a deleted board back from knowledge/work/.deleted. `name` is the moved file name that
    // remove returned (with or without .json); it must belong to `slug`. When a board with that slug
    // exists again, the restored one gets the next free slug. Returns the restored board.
    async restore(slug, name) {
      await ensure();
      const base = typeof name === 'string' ? name.replace(/\.json$/, '') : '';
      const match = DELETED_NAME.exec(base);
      if (!validSlug(slug) || !match || match[1] !== slug) throw Object.assign(new Error('That deleted board does not exist.'), { status: 404 });
      return serial(`${folder}::create`, async () => {
        const source = path.join(trash, `${base}.json`);
        const text = await readText(source);
        if (text === null) throw Object.assign(new Error('That deleted board does not exist.'), { status: 404 });
        const existing = new Set(await slugs());
        if (existing.size >= LIMITS.boards) throw Object.assign(new Error('There are too many boards.'), { status: 400 });
        let target = slug;
        for (let n = 2; existing.has(target); n++) target = `${slug}-${n}`;
        let raw; try { raw = JSON.parse(text); } catch { raw = {}; }
        const board = cleanBoard(raw, { slug: target, id: raw?.id, projectTitles: await projectTitles() });
        board.updated = new Date().toISOString();
        await write(board);
        await unlink(source).catch(() => {});
        await unlink(path.join(trash, `${base}.md`)).catch(() => {});
        return board;
      });
    },
    async weekly(slug, offsetWeeks = 0, now = new Date()) {
      await ensure();
      return weeklySummary(await load(slug), { offsetWeeks: Number(offsetWeeks), now });
    },
    // Writes the weekly summary to knowledge/work/<slug>-week-<start date>.md and returns its repo path.
    async saveWeekly(slug, offsetWeeks = 0, now = new Date()) {
      const summary = await api.weekly(slug, offsetWeeks, now);
      const name = `${summary.slug}-week-${summary.date}.md`;
      await writeAtomic(path.join(folder, name), summary.markdown);
      return { path: `knowledge/work/${name}`, summary };
    },
    // Adds a feature to the top of the To do column of the most recently updated board.
    async quick(title) {
      const text = line(title);
      if (!text) throw Object.assign(new Error('Say what to add.'), { status: 400 });
      // With no boards at all, a new "My board" is made for it.
      const [latest] = await api.list();
      const slug = latest?.slug || (await api.create({ title: 'My board' })).slug;
      return serial(fileFor(slug), async () => {
        const board = await load(slug);
        if (board.items.length >= LIMITS.items) throw Object.assign(new Error('That board is full.'), { status: 400 });
        const now = new Date().toISOString();
        board.items.unshift({ id: newId('w'), type: 'feature', title: text, details: '', acceptance: '', state: 'todo', tags: [], priority: 'none', due: null, order: -1, tasks: [], created: now, updated: now, completed: null });
        return write(cleanBoard(board, { slug, id: board.id, now }));
      });
    },
  };
  return api;
}

export const addQuickItem = (repo, title) => createWorkItems(repo).quick(title);
