// The Project Overview panel's figures: health, Next up, the refinement queue and Due soon.
import test from 'node:test';
import assert from 'node:assert/strict';
import { dueSoon, nextUp, projectHealth, refinementQueue } from '../../../src/lib/work-overview.ts';

const item = (id, fields = {}) => ({ id, title: id, type: 'feature', state: 'todo', priority: 'none', due: null, refined: false, order: 0, ...fields });
const today = new Date(2026, 10, 4, 15, 30); // 4 November 2026

test('project health counts completed, in progress, backlog and tickets awaiting refinement', () => {
  const items = [
    item('a', { state: 'done' }), item('b', { state: 'done' }), item('c', { state: 'doing' }),
    item('d', { state: 'todo', refined: true }), item('e', { state: 'todo' }), item('f', { state: 'todo' }),
    item('g', { state: 'doing', refined: false }), item('h', { state: 'done' }),
  ];
  // Needs refinement is a Backlog idea: an unrefined ticket already In progress or Done is not waiting to be refined.
  assert.deepEqual(projectHealth(items), { total: 8, done: 3, percent: 38, doing: 2, backlog: 3, needsRefinement: 2 });
});

test('an empty project has zero progress, not a division by zero', () => {
  assert.deepEqual(projectHealth([]), { total: 0, done: 0, percent: 0, doing: 0, backlog: 0, needsRefinement: 0 });
  assert.equal(projectHealth([item('a', { state: 'done' })]).percent, 100);
});

test('Next up is only Ready Backlog tickets, by priority and then due date', () => {
  const items = [
    item('low early', { refined: true, priority: 'low', due: '2026-11-05' }),
    item('high late', { refined: true, priority: 'high', due: '2026-12-01' }),
    item('high early', { refined: true, priority: 'high', due: '2026-11-10' }),
    item('high none', { refined: true, priority: 'high' }),
    item('medium', { refined: true, priority: 'medium', due: '2026-11-04' }),
    item('none dated', { refined: true, due: '2026-11-01' }),
    item('needs refinement', { refined: false, priority: 'high', due: '2026-11-01' }),
    item('doing', { state: 'doing', refined: true, priority: 'high' }),
    item('done', { state: 'done', refined: true, priority: 'high' }),
  ];
  assert.deepEqual(nextUp(items).map(entry => entry.id), ['high early', 'high late', 'high none', 'medium', 'low early', 'none dated']);
  assert.deepEqual(nextUp([item('x', { refined: true, priority: 'low', order: 2 }), item('y', { refined: true, priority: 'low', order: 1 })]).map(entry => entry.id), ['y', 'x'], 'board order breaks a tie');
  assert.deepEqual(nextUp([item('x')]), [], 'nothing is Ready');
});

test('the refinement queue is the Backlog tickets that still need refining, most important first', () => {
  const items = [
    item('plain'), item('urgent', { priority: 'high' }), item('ready', { refined: true, priority: 'high' }),
    item('doing', { state: 'doing' }), item('dated', { due: '2026-11-06' }),
  ];
  assert.deepEqual(refinementQueue(items).map(entry => entry.id), ['urgent', 'dated', 'plain']);
});

test('Due soon lists unfinished tickets by deadline, flags overdue ones and ignores finished work', () => {
  const items = [
    item('later', { due: '2026-11-20' }), item('tomorrow', { due: '2026-11-05', state: 'doing' }), item('today', { due: '2026-11-04' }),
    item('overdue', { due: '2026-11-01' }), item('finished late', { due: '2026-10-01', state: 'done' }), item('undated'),
    item('also overdue', { due: '2026-10-30', priority: 'high' }),
  ];
  const soon = dueSoon(items, today);
  assert.deepEqual(soon.map(entry => [entry.item.id, entry.days, entry.overdue]), [
    ['also overdue', -5, true], ['overdue', -3, true], ['today', 0, false], ['tomorrow', 1, false], ['later', 16, false],
  ]);
  assert.deepEqual(dueSoon([item('a'), item('b', { state: 'done', due: '2026-11-01' })], today), [], 'no deadlines');
});
