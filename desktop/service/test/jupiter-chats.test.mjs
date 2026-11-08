import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { JupiterChats, NEW_TITLE, titleFrom } from '../jupiter-chats.mjs';

const op = (id, text, conversation, at) => ({ id, text, result: `Answer to ${text}`, status: 'completed', at, conversation });

test('titles come from the opening words of the first message', () => {
  assert.equal(titleFrom('Hey Jupiter, can you open my brainstorm board please?'), 'Open my brainstorm board please');
  assert.equal(titleFrom('what is the weather in London today and tomorrow and next week'), 'What is the weather in London today');
  assert.equal(titleFrom(''), NEW_TITLE);
});

test('conversations keep their own messages, survive a restart, rename and delete', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'jupiter-chats-'));
  // The first start turns earlier requests into one conversation.
  const chats = await new JupiterChats(dir).init([op('old1', 'Show the news', undefined, '2026-11-01T10:00:00.000Z')]);
  assert.equal(chats.list.chats.length, 1);
  const earlier = chats.list.chats[0];
  assert.equal(earlier.title, 'Earlier conversation');
  assert.equal((await chats.read(earlier.id))[0].conversation, earlier.id);

  const first = await chats.create();
  assert.equal(chats.active, first.id);
  assert.equal((await chats.create()).id, first.id, 'an unused empty conversation is reused');
  await chats.record(op('a1', 'Open my to do list', first.id, '2026-11-04T09:00:00.000Z'));
  assert.equal(chats.find(first.id).title, 'Open my to do list', 'named from its first message');
  const second = await chats.create();
  assert.notEqual(second.id, first.id);
  await chats.record(op('b1', 'What is the weather', second.id, '2026-11-04T09:05:00.000Z'));
  await chats.record({ ...op('b2', 'running one', second.id, '2026-11-04T09:06:00.000Z'), status: 'running' });
  assert.deepEqual((await chats.read(first.id)).map(item => item.id), ['a1']);
  assert.deepEqual((await chats.read(second.id)).map(item => item.id), ['b1'], 'no messages from another conversation, none still running');

  await chats.rename(first.id, '  Board   planning ');
  await chats.record(op('a2', 'Add a card', first.id, '2026-11-04T09:10:00.000Z'));
  assert.equal(chats.find(first.id).title, 'Board planning', 'a name you chose is kept');
  await assert.rejects(chats.rename(first.id, '   '), /name/);

  const reopened = await new JupiterChats(dir).init([]);
  assert.equal(reopened.active, second.id);
  assert.deepEqual((await reopened.read(first.id)).map(item => item.id), ['a1', 'a2'], 'history survives a restart');
  assert.equal(reopened.recent()[0].id, first.id, 'most recently used first');

  await reopened.remove(second.id);
  assert.equal(reopened.find(second.id), null);
  assert.equal(reopened.active, first.id, 'another conversation becomes active');
  await assert.rejects(reopened.read(second.id), /no longer exists/);
  await reopened.remove(first.id); await reopened.remove(earlier.id);
  assert.equal(reopened.list.chats.length, 1, 'there is always one conversation');
  assert.equal(await reopened.record(op('late', 'late answer', second.id, '2026-11-04T10:00:00.000Z')), null, 'a late answer for a deleted conversation is dropped');
});
