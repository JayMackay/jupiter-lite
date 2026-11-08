// Jupiter's home dashboard data, stored as plain Markdown in the knowledge folder
// so agents and people can read and edit the same files.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

const MAX_ITEMS = 200;
const MAX_TEXT = 500;
const clean = value => String(value ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, MAX_TEXT);

export const homeFiles = repo => ({
  one: path.join(repo, 'knowledge', 'today.md'),
  todos: path.join(repo, 'knowledge', 'todo.md'),
  notes: path.join(repo, 'knowledge', 'notes', 'brainstorm.md'),
  board: path.join(repo, 'knowledge', 'notes', 'brainstorm.board.json'),
});

// The Brainstorm board's layout: where each idea sits (as a fraction of the board), the
// lines connecting ideas, and pen strokes. The ideas themselves stay in brainstorm.md.
export const EMPTY_BOARD = Object.freeze({ positions: {}, links: [], strokes: [] });
const unit = value => Math.round(Math.min(1, Math.max(0, Number(value) || 0)) * 10000) / 10000;
export function cleanBoard(value) {
  const board = value && typeof value === 'object' ? value : {};
  const positions = {};
  for (const [note, point] of Object.entries(board.positions && typeof board.positions === 'object' ? board.positions : {}).slice(0, MAX_ITEMS)) {
    const key = clean(note); if (key && point && typeof point === 'object') positions[key] = { x: unit(point.x), y: unit(point.y) };
  }
  const links = (Array.isArray(board.links) ? board.links : []).slice(0, 400)
    .filter(link => Array.isArray(link) && link.length === 2).map(([a, b]) => [clean(a), clean(b)]).filter(([a, b]) => a && b && a !== b);
  const strokes = (Array.isArray(board.strokes) ? board.strokes : []).slice(0, 300)
    .map(stroke => (Array.isArray(stroke) ? stroke : []).slice(0, 1500).filter(point => Array.isArray(point) && point.length === 2).map(([x, y]) => [unit(x), unit(y)]))
    .filter(stroke => stroke.length > 1);
  return { positions, links, strokes };
}

export function parseOne(text) {
  return String(text).split(/\r?\n/).map(line => line.trim()).find(line => line && !line.startsWith('#') && !line.startsWith('<!--')) || '';
}

export function parseTodos(text) {
  const items = [];
  for (const line of String(text).split(/\r?\n/)) {
    const match = line.match(/^\s*[-*]\s+\[( |x|X)\]\s+(.+?)\s*$/);
    if (match) items.push({ text: clean(match[2]), done: match[1].toLowerCase() === 'x' });
  }
  return items.slice(0, MAX_ITEMS);
}

export function parseNotes(text) {
  const items = [];
  for (const line of String(text).split(/\r?\n/)) {
    const match = line.match(/^\s*[-*]\s+(?!\[[ xX]\])(.+?)\s*$/);
    if (match) items.push(clean(match[1]));
  }
  return items.slice(0, MAX_ITEMS);
}

const formatOne = one => `# Today's one thing\n\n${clean(one)}\n`;
const formatTodos = todos => `# To do\n\n${todos.map(item => `- [${item.done ? 'x' : ' '}] ${clean(item.text)}`).join('\n')}\n`;
const formatNotes = notes => `# Brainstorm\n\nIdeas captured from Jupiter's dashboard.\n\n${notes.map(note => `- ${clean(note)}`).join('\n')}\n`;

async function readText(file) {
  try { return await readFile(file, 'utf8'); } catch (error) { if (error.code === 'ENOENT') return ''; throw error; }
}
async function writeText(file, text) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, text, 'utf8');
  await rename(temporary, file);
}

export function createJupiterHome(repo) {
  const files = homeFiles(repo);
  return {
    files,
    async read() {
      const [one, todos, notes, board] = await Promise.all([readText(files.one), readText(files.todos), readText(files.notes), readText(files.board)]);
      let layout = EMPTY_BOARD; try { if (board.trim()) layout = cleanBoard(JSON.parse(board)); } catch { /* a hand-broken layout file starts fresh */ }
      return { one: parseOne(one), todos: parseTodos(todos), notes: parseNotes(notes), board: { ...layout } };
    },
    async update(data = {}) {
      if (data.one !== undefined) await writeText(files.one, formatOne(data.one));
      if (data.todos !== undefined) {
        if (!Array.isArray(data.todos)) throw new Error('To do items must be a list.');
        await writeText(files.todos, formatTodos(data.todos.slice(0, MAX_ITEMS).filter(item => clean(item?.text)).map(item => ({ text: item.text, done: item.done === true }))));
      }
      if (data.notes !== undefined) {
        if (!Array.isArray(data.notes)) throw new Error('Notes must be a list.');
        await writeText(files.notes, formatNotes(data.notes.slice(0, MAX_ITEMS).map(clean).filter(Boolean)));
      }
      if (data.board !== undefined) await writeText(files.board, JSON.stringify(cleanBoard(data.board), null, 1) + '\n');
      return this.read();
    },
  };
}
