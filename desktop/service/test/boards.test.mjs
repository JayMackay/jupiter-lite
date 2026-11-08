import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { cleanBoard, createBoards, slugOf } from '../boards.mjs';

const temp = () => mkdtemp(path.join(os.tmpdir(), 'jupiter-boards-'));

test('the old brainstorm notes become a board called Brainstorm', async () => {
  const repo = await temp();
  await mkdir(path.join(repo, 'knowledge/notes'), { recursive: true });
  await writeFile(path.join(repo, 'knowledge/notes/brainstorm.md'), '# Brainstorm\n\n- Orb hubs\n- Daily brief\n');
  await writeFile(path.join(repo, 'knowledge/notes/brainstorm.board.json'), JSON.stringify({ positions: { 'Orb hubs': { x: 0.5, y: 0.5 } }, links: [['Orb hubs', 'Daily brief']], strokes: [[[0, 0], [1, 1]]] }));
  const boards = createBoards(repo);
  const list = await boards.list();
  assert.deepEqual(list.map(board => [board.slug, board.title, board.count]), [['brainstorm', 'Brainstorm', 2]]);
  const board = await boards.read('brainstorm');
  assert.deepEqual(board.items.map(item => item.text), ['Orb hubs', 'Daily brief']);
  assert.equal(board.items[0].x, 590);
  assert.equal(board.links.length, 1);
  assert.equal(board.strokes[0].kind, 'pen');
});

test('a board is saved under its title, with a readable summary, and moves when renamed', async () => {
  const repo = await temp();
  const boards = createBoards(repo);
  const saved = await boards.save(null, { title: 'Game ideas', items: [
    { id: 'a', type: 'note', text: 'Spider boss', x: 10, y: 20 },
    { id: 'b', type: 'shape', shape: 'diamond', text: 'Decision', color: '#FF0000', x: 300, y: 20 },
    { id: 'c', type: 'link', url: 'https://example.com/ref', x: 0, y: 200 },
    { id: 'd', type: 'image', src: 'inbox/attachments/2026-11-02/shot.png', name: 'shot.png', x: 0, y: 400 },
  ], links: [{ from: 'a', to: 'b' }], strokes: [{ kind: 'highlight', color: '#ffff00', size: 18, points: [[0, 0], [5, 5]] }] });
  assert.equal(saved.slug, 'game_ideas');
  const markdown = await readFile(path.join(repo, 'knowledge/boards/game_ideas.md'), 'utf8');
  assert.match(markdown, /^# Game ideas/);
  assert.match(markdown, /## Ideas\n\n- Spider boss/);
  assert.match(markdown, /\[example\.com\]\(https:\/\/example\.com\/ref\)/);
  assert.match(markdown, /Spider boss → Decision/);
  const renamed = await boards.save('game_ideas', { ...saved, title: 'Golem ideas' });
  assert.equal(renamed.slug, 'golem_ideas');
  assert.deepEqual((await readdir(path.join(repo, 'knowledge/boards'))).sort(), ['golem_ideas.json', 'golem_ideas.md']);
  // Another board with the same title gets a number, never overwriting.
  const twin = await boards.save(null, { title: 'Golem ideas', items: [] });
  assert.equal(twin.slug, 'golem_ideas_2');
});

test('board contents are validated', () => {
  const board = cleanBoard({ title: '', items: [
    { id: 'x', type: 'image', src: '../secret.png' }, { id: 'y', type: 'image', src: 'C:/Users/me/pic.png' },
    { id: 'z', type: 'link', url: 'javascript:alert(1)' }, { id: 'w', type: 'script' },
    { id: 'n', type: 'note', text: 'ok', x: 1e9, w: 1 },
  ], links: [{ from: 'n', to: 'gone' }], strokes: [{ points: [[1, 1]] }] });
  assert.equal(board.title, 'Untitled board');
  assert.deepEqual(board.items.map(item => item.id), ['n']);
  assert.equal(board.items[0].x, 50000); assert.equal(board.items[0].w, 24);
  assert.deepEqual(board.links, []); assert.deepEqual(board.strokes, []);
  assert.equal(slugOf('  Hello, World! '), 'hello_world');
});

test('a quick idea lands on the most recent board', async () => {
  const repo = await temp();
  const boards = createBoards(repo);
  await boards.save(null, { title: 'Sprint', items: [] });
  const board = await boards.quick('Try a tutorial level');
  assert.equal(board.slug, 'sprint');
  assert.equal(board.items[0].text, 'Try a tutorial level');
});

test('deleting a board moves it to .deleted, out of the list', async () => {
  const repo = await temp();
  const boards = createBoards(repo);
  await boards.save(null, { title: 'Old ideas', items: [] });
  await boards.remove('old_ideas');
  assert.deepEqual((await boards.list()).map(board => board.slug), []);
  const kept = await readdir(path.join(repo, 'knowledge/boards/.deleted'));
  assert.ok(kept.some(name => name.startsWith('old_ideas_') && name.endsWith('.json')) && kept.some(name => name.endsWith('.md')));
  await assert.rejects(boards.remove('old_ideas'), /not found/);
});

test('Jupiter can open a board by title and add linked cards to it', async () => {
  const repo = await temp();
  const boards = createBoards(repo);
  const opened = await boards.ensure('Solo Levelling Design');
  assert.equal(opened.slug, 'solo_levelling_design');
  assert.equal((await boards.ensure('solo levelling design')).slug, opened.slug, 'the same board, whatever the case');
  const board = await boards.add(opened.slug, { notes: ['Character creation'], links: [{ from: 'character creation', to: 'Movement' }] });
  assert.deepEqual(board.items.map(item => item.text), ['Character creation', 'Movement']);
  assert.equal(board.links.length, 1);
  const again = await boards.add(opened.slug, { links: [{ from: 'Character creation', to: 'movement' }] });
  assert.equal(again.links.length, 1, 'no duplicate connection');
  assert.ok(again.items[1].x > again.items[0].x, 'cards are laid out side by side');
});

test('triangles, fill colours and hand sized notes are kept; older boards get sensible defaults', () => {
  const board = cleanBoard({ title: 'Shapes', items: [
    { id: 't', type: 'shape', shape: 'triangle', text: 'Idea', fill: 'butter', x: 0, y: 0, w: 120, h: 100 },
    { id: 'n', type: 'note', text: 'Tall', tone: 2, fill: 'coral', sized: true, x: 0, y: 0, w: 260, h: 340 },
    { id: 'old', type: 'note', text: 'Saved before fills', tone: 1, x: 0, y: 0, w: 220, h: 90 },
    { id: 'o', type: 'shape', shape: 'ellipse', fill: 'none', x: 0, y: 0, w: 90, h: 90 },
    { id: 'bad', type: 'note', fill: '#ff00ff', sized: 'yes', x: 0, y: 0, w: 220, h: 90 },
    { id: 'img', type: 'image', src: 'inbox/attachments/a.png', fill: 'mint', sized: true, x: 0, y: 0, w: 640, h: 90 },
  ] });
  const [triangle, tall, old, outline, bad, image] = board.items;
  assert.deepEqual([triangle.shape, triangle.fill, triangle.text], ['triangle', 'butter', 'Idea']);
  assert.deepEqual([tall.fill, tall.sized, tall.h], ['coral', true, 340]);
  assert.equal(old.fill, undefined, 'no fill saved: the note keeps its tone'); assert.equal(old.tone, 1); assert.equal(old.sized, undefined);
  assert.equal(outline.fill, 'none');
  assert.equal(bad.fill, undefined, 'only palette names'); assert.equal(bad.sized, undefined);
  assert.deepEqual([image.fill, image.sized, image.w, image.h], [undefined, undefined, 640, 90], 'an image keeps the exact size it was stretched to');
});