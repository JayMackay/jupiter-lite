import test from 'node:test';
import assert from 'node:assert/strict';
import { PHRASES, dayPart, pickGreeting } from '../../../src/lib/greeting.ts';

const at = (hour, minute = 0) => new Date(2026, 10, 4, hour, minute);

test('the local time picks one of four day parts', () => {
  const expected = [[0, 'night'], [4, 'night'], [5, 'morning'], [11, 'morning'], [12, 'afternoon'], [17, 'afternoon'], [18, 'evening'], [21, 'evening'], [22, 'night'], [23, 'night']];
  for (const [hour, part] of expected) assert.equal(dayPart(at(hour, 59)), part, `${hour}:59`);
  assert.equal(dayPart(at(11, 59)), 'morning');
  assert.equal(dayPart(at(12, 0)), 'afternoon');
});

test('every day part has several short phrases and none uses a hyphen or dash', () => {
  for (const part of ['morning', 'afternoon', 'evening', 'night']) {
    const pool = PHRASES[part];
    assert.ok(pool.length >= 5, `${part} has ${pool.length} phrases`);
    assert.equal(new Set(pool).size, pool.length, `${part} has no duplicates`);
    for (const text of pool) {
      assert.doesNotMatch(text, /[-‐-―−]/, `no hyphen or dash in "${text}"`);
      assert.ok(text.length <= 24, `"${text}" stays short`);
    }
  }
});

test('the owner name comes from the configured name only, and a missing name leaves no stray punctuation', () => {
  const named = pickGreeting('morning', 'Jay', 0);
  assert.match(named.text, /, Jay\??$/);
  const blank = pickGreeting('morning', '   ', 0);
  assert.doesNotMatch(blank.text, /,|\s{2}|\s$/);
  const asked = PHRASES.night.find(text => text.endsWith('?'));
  assert.ok(asked, 'the night pool has a question');
  const seeds = Array.from({ length: 100 }, (_, index) => index / 100);
  assert.equal(seeds.map(seed => pickGreeting('night', 'Jay', seed)).find(pick => pick.id === asked)?.text, `${asked.slice(0, -1)}, Jay?`, 'the question mark stays at the end');
  assert.equal(seeds.map(seed => pickGreeting('night', '', seed)).find(pick => pick.id === asked)?.text, asked);
});

test('the same inputs always give the same wording, so re-renders and clock ticks never change it', () => {
  for (const part of ['morning', 'afternoon', 'evening', 'night']) {
    for (const seed of [0, 0.13, 0.5, 0.99]) {
      assert.deepEqual(pickGreeting(part, 'Jay', seed, 'Good morning'), pickGreeting(part, 'Jay', seed, 'Good morning'));
    }
  }
});

test('a new visit never repeats the wording of the last one, and every phrase can appear', () => {
  for (const part of ['morning', 'afternoon', 'evening', 'night']) {
    const seen = new Set();
    for (const last of PHRASES[part]) {
      for (let seed = 0; seed < 1; seed += 0.01) {
        const next = pickGreeting(part, 'Jay', seed, last);
        assert.notEqual(next.id, last, `${part}: "${last}" is not shown twice in a row`);
        assert.ok(PHRASES[part].includes(next.id));
        seen.add(next.id);
      }
    }
    assert.equal(seen.size, PHRASES[part].length, `${part}: every phrase is reachable`);
  }
});

test('odd seeds are clamped into the pool', () => {
  for (const seed of [-1, 1, 7, Number.NaN]) {
    const pick = pickGreeting('evening', 'Jay', seed);
    assert.ok(PHRASES.evening.includes(pick.id), `seed ${seed}`);
  }
});
