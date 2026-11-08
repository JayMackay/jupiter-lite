import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createJupiterHome, parseNotes, parseOne, parseTodos } from '../jupiter-home.mjs';

test('an empty knowledge folder gives an empty dashboard, not sample data', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'jupiter-home-'));
  assert.deepEqual(await createJupiterHome(repo).read(), { one: '', todos: [], notes: [], board: { positions: {}, links: [], strokes: [] } });
});

test('one thing, to-dos and notes round-trip through readable Markdown', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'jupiter-home-'));
  const home = createJupiterHome(repo);
  const saved = await home.update({ one: 'Fix the scaled hitboxes', todos: [{ text: 'Tune pathing', done: false }, { text: 'Pick a voice', done: true }, { text: '   ' }], notes: ['Orb hubs = real projects', ''] });
  assert.deepEqual({ ...saved, board: undefined }, { one: 'Fix the scaled hitboxes', todos: [{ text: 'Tune pathing', done: false }, { text: 'Pick a voice', done: true }], notes: ['Orb hubs = real projects'], board: undefined });
  assert.match(await readFile(path.join(repo, 'knowledge/todo.md'), 'utf8'), /^# To do\n\n- \[ \] Tune pathing\n- \[x\] Pick a voice\n$/);
  assert.match(await readFile(path.join(repo, 'knowledge/notes/brainstorm.md'), 'utf8'), /- Orb hubs = real projects/);
});

test('hand-edited files are read leniently and line breaks cannot inject new items', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'jupiter-home-'));
  await mkdir(path.join(repo, 'knowledge'), { recursive: true });
  await writeFile(path.join(repo, 'knowledge/todo.md'), '# My list\r\n* [X] Done thing\r\nnot a task\r\n- [ ] Open thing\r\n');
  const home = createJupiterHome(repo);
  assert.deepEqual((await home.read()).todos, [{ text: 'Done thing', done: true }, { text: 'Open thing', done: false }]);
  const saved = await home.update({ one: 'Line one\n- [ ] injected', notes: ['a\n- b'] });
  assert.equal(saved.one, 'Line one - [ ] injected');
  assert.deepEqual(saved.notes, ['a - b']);
  assert.equal(parseOne('# Title\n\n<!-- hint -->\nReal line'), 'Real line');
  assert.deepEqual(parseTodos('- [ ] x'), [{ text: 'x', done: false }]);
  assert.deepEqual(parseNotes('- [ ] task\n- note'), ['note']);
});

test('invalid shapes are rejected', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'jupiter-home-'));
  await assert.rejects(createJupiterHome(repo).update({ todos: 'nope' }), /list/);
});

test('the brainstorm board layout is saved as clean JSON beside the ideas', async () => {
  const { cleanBoard } = await import('../jupiter-home.mjs');
  const repo = await mkdtemp(path.join(os.tmpdir(), 'jupiter-home-'));
  const home = createJupiterHome(repo);
  const saved = await home.update({ notes: ['A', 'B'], board: { positions: { A: { x: 0.25, y: 2 }, B: { x: -1, y: 0.5 } }, links: [['A', 'B'], ['A', 'A'], 'bad'], strokes: [[[0.1, 0.1], [0.2, 0.3]], [[0.5, 0.5]]] } });
  assert.deepEqual(saved.board, { positions: { A: { x: 0.25, y: 1 }, B: { x: 0, y: 0.5 } }, links: [['A', 'B']], strokes: [[[0.1, 0.1], [0.2, 0.3]]] });
  assert.match(await readFile(path.join(repo, 'knowledge/notes/brainstorm.board.json'), 'utf8'), /"positions"/);
  await writeFile(path.join(repo, 'knowledge/notes/brainstorm.board.json'), '{broken');
  assert.deepEqual((await home.read()).board, { positions: {}, links: [], strokes: [] }, 'a broken file starts fresh');
  assert.equal(cleanBoard({ strokes: Array.from({ length: 500 }, () => [[0, 0], [1, 1]]) }).strokes.length, 300);
});
