// What Jupiter says when Brainstorm, To do, Projects or News opens.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { greetingKind, newsGreeting, newsKind, NEWS_LINES, partOfDay, VIEW_LINES } from '../greetings.mjs';
import { PHRASES } from '../voice-out.mjs';
import { createService } from '../server.mjs';

const root = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));

test('each window has about twenty lines, in the phrase bank, with no dashes', () => {
  for (const [view, parts] of Object.entries(VIEW_LINES)) {
    const all = Object.values(parts).flat();
    assert.equal(all.length, 20, view);
    for (const [part, lines] of Object.entries(parts)) assert.deepEqual(PHRASES[`${view}_${part}`], lines);
    assert.ok(all.every(line => !/[-–—]/.test(line)), view);
  }
  assert.equal(partOfDay(8), 'morning'); assert.equal(partOfDay(14), 'afternoon'); assert.equal(partOfDay(19), 'evening'); assert.equal(partOfDay(23), 'late'); assert.equal(partOfDay(3), 'late');
  assert.equal(greetingKind('todo', { hour: 23, random: () => 0.1 }), 'todo_late');
  assert.equal(greetingKind('todo', { hour: 23, random: () => 0.9 }), 'todo_any');
  assert.equal(NEWS_LINES.length, 20);
  assert.equal(newsKind(['Trump signs order'], () => 0.1), 'news_topical_0');
  assert.equal(newsKind(['Trump signs order'], () => 0.9), 'news_any');
  assert.equal(newsKind(['Quiet day'], () => 0.1), 'news_any');
  assert.ok(PHRASES.news_any && PHRASES.news_topical_0);
  assert.equal(newsGreeting('gaming', 'Enshrouded 1.0 review | PC Gamer', () => 0), 'Interesting one in gaming: Enshrouded 1.0 review.');
});

test('the greet route speaks once per window, and News reads the open tab', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'jupiter-greet-'));
  const repo = path.join(temp, 'repo');
  await mkdir(path.join(repo, 'workspace'), { recursive: true });
  await writeFile(path.join(repo, 'workspace/workspace.json'), '{"entities":[]}');
  const said = [];
  const wake = Object.assign(new EventEmitter(), { state: { status: 'off' }, start: async () => ({}), stop: () => ({}), mute() {}, listen() {} });
  const voiceOut = { folder: temp, configured: async () => true, usage: async () => null, prepare: async () => ({}),
    phrase: async kind => { said.push(kind); return { audio: Buffer.from('a'), text: PHRASES[kind][0] }; },
    speak: async text => { said.push(text); return { audio: Buffer.from('a'), text }; } };
  const feed = '<rss><channel><item><title>Big launch day</title><link>https://g.example/a</link><pubDate>Mon, 02 Nov 2026 09:00:00 GMT</pubDate></item></channel></rss>';
  const service = await createService({ repo, stateDir: path.join(repo, '.state'), uiDir: path.join(root, 'dist'), mcpOptions: { home: temp, env: {} },
    newsOptions: { fetcher: async () => ({ ok: true, status: 200, text: async () => feed }) }, voiceOptions: { wake, voiceOut } });
  try {
    const post = body => fetch(service.origin + '/api/voice/greet', { method: 'POST', headers: { Authorization: `Bearer ${service.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(response => response.json());
    const first = await post({ view: 'todo' });
    assert.match(said[0], /^todo_(any|morning|afternoon|evening|late)$/);
    assert.ok(first.url && first.text);
    const again = await post({ view: 'todo' });
    assert.ok(again.url, 'a line every time a window opens');
    assert.match(said[1], /^todo_/);
    // News: the headline readout on the first open, saved lines for the next nineteen, then the headline again.
    const news = await post({ view: 'news', topic: 'gaming' });
    assert.match(news.text, /gaming: Big launch day\.$/);
    for (let open = 2; open <= 20; open++) { const line = await post({ view: 'news', topic: 'gaming' }); assert.ok(NEWS_LINES.includes(line.text), `open ${open} uses a saved line`); }
    assert.match((await post({ view: 'news', topic: 'gaming' })).text, /Big launch day/, 'the twenty first open reads the headline again');
    assert.equal((await post({ view: 'nope' })).error, 'Unknown window.');
  } finally { await service.close(); }
});
