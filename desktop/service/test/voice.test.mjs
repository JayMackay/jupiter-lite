import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtemp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createVoiceOut, PHRASES, speakable } from '../voice-out.mjs';
import { WakeWord } from '../wake-word.mjs';

async function repoWithKey() {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'jupiter-voice-'));
  await writeFile(path.join(repo, '.env'), 'ELEVENLABS_API_KEY=test-key\nELEVENLABS_VOICE_ID=voice123\nELEVENLABS_MODEL=eleven_flash_v2_5\n');
  return repo;
}

test('clips are made once and reused, so the same line is never paid for twice', async () => {
  const repo = await repoWithKey();
  const calls = [];
  const fetcher = async (url, options) => { calls.push({ url, body: JSON.parse(options.body), key: options.headers['xi-api-key'] }); return { ok: true, arrayBuffer: async () => new TextEncoder().encode('mp3').buffer }; };
  const voice = createVoiceOut(repo, { fetcher });
  const first = await voice.speak('All done, boss.');
  const second = await voice.speak('All done, boss.');
  assert.equal(calls.length, 1, 'second time is free');
  assert.equal(first.cached, false); assert.equal(second.cached, true);
  assert.equal(calls[0].key, 'test-key');
  assert.match(calls[0].url, /text-to-speech\/voice123/);
  assert.equal(calls[0].body.model_id, 'eleven_multilingual_v2', 'short lines use the richer model');
  await voice.speak('This reply is long enough to be spoken with the faster model that the env file names.');
  assert.equal(calls.at(-1).body.model_id, 'eleven_flash_v2_5');
  const prepared = await voice.prepare();
  assert.equal(prepared.made, Object.values(PHRASES).flat().length - 1, 'the phrase bank reuses the line already made on the same model');
  assert.equal((await voice.prepare()).made, 0);
  const index = JSON.parse(await readFile(path.join(repo, 'knowledge/voice/clips/index.json'), 'utf8'));
  assert.ok(Object.values(index.clips).every(clip => clip.file.endsWith('.mp3') && clip.voice === 'voice123'));
  assert.ok(!JSON.stringify(index).includes('test-key'), 'the key is never stored');
  // Changing the voice makes new clips rather than reusing another voice's.
  await writeFile(path.join(repo, '.env'), 'ELEVENLABS_API_KEY=test-key\nELEVENLABS_VOICE_ID=other\n');
  await voice.speak('All done, boss.');
  assert.match(calls.at(-1).url, /text-to-speech\/other/);
});

test('long answers are spoken as a short version, and long one offs are not kept', async () => {
  const repo = await repoWithKey();
  const voice = createVoiceOut(repo, { fetcher: async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(3) }) });
  const long = `## Plan\n\nHere is **the plan** with [a link](https://x.y). ${'This sentence repeats to make the answer long. '.repeat(30)}`;
  const spoken = speakable(long);
  assert.ok(spoken.length < 680 && spoken.endsWith('The rest is on screen.'));
  assert.doesNotMatch(spoken, /\*\*|##|https?:/);
  const result = await voice.speak(long);
  assert.ok(result.audio && !result.file, 'played but not saved');
  assert.equal((await readdir(path.join(repo, 'knowledge/voice/clips')).catch(() => [])).filter(name => name.endsWith('.mp3')).length, 0);
});

test('farewells never repeat back to back, and no separate title clip is tacked on', async () => {
  const repo = await repoWithKey();
  const calls = [];
  const voice = createVoiceOut(repo, { fetcher: async (url, options) => { calls.push(JSON.parse(options.body).text); return { ok: true, arrayBuffer: async () => new ArrayBuffer(3) }; } });
  let previous = null;
  for (let round = 0; round < 40; round++) {
    const result = await voice.phrase('farewell');
    assert.notEqual(result.file, previous, 'the same goodbye is not said twice running');
    assert.equal(result.title, undefined, 'no "Sir." or "Boss." clip after the line');
    previous = result.file;
  }
  assert.equal(PHRASES.title, undefined, 'no standalone title clips in the phrase bank');
  assert.ok(calls.every(text => PHRASES.farewell.includes(text)), 'only whole farewell lines are made');
  assert.ok(calls.length <= PHRASES.farewell.length, 'every clip is made once at most');
});

test('without a key the voice says how to fix it', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'jupiter-voice-'));
  await assert.rejects(createVoiceOut(repo, { fetcher: async () => { throw new Error('should not call'); } }).speak('Hi'), /ELEVENLABS_API_KEY/);
});

test('the wake word manager starts the listener, relays what it hears, mutes it and restarts it', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'jupiter-wake-'));
  await mkdir(path.join(repo, '.cache/dictation/venv/Scripts'), { recursive: true });
  await mkdir(path.join(repo, '.cache/dictation/model'), { recursive: true });
  await writeFile(path.join(repo, '.cache/dictation/venv/Scripts/python.exe'), '');
  await writeFile(path.join(repo, '.cache/dictation/venv/bin'), '').catch(() => {});
  await mkdir(path.join(repo, '.cache/dictation/venv/bin'), { recursive: true }).catch(() => {});
  await writeFile(path.join(repo, '.cache/dictation/venv/bin/python'), '').catch(() => {});
  await writeFile(path.join(repo, '.cache/dictation/model/model.bin'), '');
  const children = [];
  const spawner = () => { const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough(); child.written = []; child.stdin.on('data', chunk => child.written.push(String(chunk))); child.kill = () => child.emit('exit'); children.push(child); return child; };
  const wake = new WakeWord(repo, { spawner });
  const heard = [];
  wake.on('wake', () => heard.push('wake')); wake.on('command', text => heard.push(text));
  await wake.start();
  children[0].stdout.write('{"type":"ready","device":"Mic"}\n{"type":"wake"}\n{"type":"command","text":"what is on my list"}\n');
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(wake.state.status, 'listening'); assert.equal(wake.state.device, 'Mic');
  assert.deepEqual(heard, ['wake', 'what is on my list']);
  wake.mute(true);
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.match(children[0].written.join(''), /"mute":true/);
  wake.mute(false);
  wake.cancel();
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.match(children[0].written.join(''), /"cancel":true/, 'the J button can drop a request without stopping the wake word');
  wake.stop();
  assert.equal(wake.state.status, 'off');
  const missing = new WakeWord(await mkdtemp(path.join(os.tmpdir(), 'jupiter-wake-')), { spawner });
  assert.equal((await missing.start()).status, 'unavailable');
});
