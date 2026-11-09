import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { agentStatus, cleanName, elevenLabsStatus, elevenLabsVoices, saveElevenLabs, saveProfile, setEnvValues } from '../setup.mjs';
import { syncManagedContent } from '../managed-content.mjs';
import { syncAgentRules } from '../agent-rules.mjs';

const temp = prefix => mkdtemp(path.join(os.tmpdir(), `jupiter-${prefix}-`));

test('the profile is validated and kept between markers in context/me.md, beside anything the user wrote', async () => {
  const repo = await temp('profile');
  await mkdir(path.join(repo, 'context'));
  await writeFile(path.join(repo, 'context', 'me.md'), '# About me\n\nI make pixel art games.\n');
  assert.deepEqual(await saveProfile(repo, { name: '  Jared   Mackay ', nickname: 'Jay' }), { ownerName: 'Jared Mackay', nickname: 'Jay' });
  assert.deepEqual(await saveProfile(repo, { name: "Siân O'Neil-Brown" }), { ownerName: "Siân O'Neil-Brown", nickname: "Siân O'Neil-Brown" }, 'the nickname defaults to the name');
  const text = await readFile(path.join(repo, 'context', 'me.md'), 'utf8');
  assert.match(text, /I make pixel art games\./);
  assert.equal(text.match(/jupiter:profile:start/g).length, 1, 'saving again replaces the block');
  assert.match(text, /- Call me: Siân O'Neil-Brown/);
  for (const bad of ['', '   ', 'x'.repeat(61), '<script>', 'a;b', 42]) assert.throws(() => cleanName(bad, 'your name'), /Enter your name/, String(bad));
  assert.equal(cleanName('Jay\nMackay', 'your name'), 'Jay Mackay', 'line breaks cannot reach the file');
});

test('.env values are replaced in place or appended, starting from .env.example, and newlines are refused', async () => {
  const repo = await temp('env');
  await writeFile(path.join(repo, '.env.example'), '# Voice\nELEVENLABS_API_KEY=\nELEVENLABS_VOICE_ID=\nOTHER=1\n');
  await setEnvValues(repo, { ELEVENLABS_API_KEY: 'sk_abc$&1', ELEVENLABS_VOICE_ID: 'voice123456' });
  await setEnvValues(repo, { NEW_ONE: 'x' });
  assert.equal(await readFile(path.join(repo, '.env'), 'utf8'), '# Voice\nELEVENLABS_API_KEY=sk_abc$&1\nELEVENLABS_VOICE_ID=voice123456\nOTHER=1\nNEW_ONE=x\n');
  await assert.rejects(setEnvValues(repo, { BAD: 'a\nINJECTED=1' }), /Invalid setting/);
  await assert.rejects(setEnvValues(repo, { 'bad key': 'a' }), /Invalid setting/);
});

test('ElevenLabs keys are checked by listing voices; only a listed voice is saved and the key is never echoed', async () => {
  const repo = await temp('eleven');
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, key: options.headers['xi-api-key'] });
    if (options.headers['xi-api-key'] !== 'sk_goodgoodgoodgoodgood') return new Response('{}', { status: 401 });
    return Response.json({ voices: [{ voice_id: 'pFZP5JQG7iQjIQuC4Bku', name: 'Lily', category: 'premade' }, { voice_id: '../bad', name: 'Bad' }] });
  };
  await assert.rejects(elevenLabsVoices('short', fetcher), /Paste your ElevenLabs API key/);
  await assert.rejects(elevenLabsVoices('sk_wrongwrongwrongwrongwrong', fetcher), /did not accept/);
  assert.deepEqual(await elevenLabsVoices(' sk_goodgoodgoodgoodgood ', fetcher), [{ id: 'pFZP5JQG7iQjIQuC4Bku', name: 'Lily', category: 'premade' }]);
  await assert.rejects(saveElevenLabs(repo, { key: 'sk_goodgoodgoodgoodgood', voiceId: 'someone-else' }, fetcher), /Choose one of your/);
  const saved = await saveElevenLabs(repo, { key: 'sk_goodgoodgoodgoodgood', voiceId: 'pFZP5JQG7iQjIQuC4Bku' }, fetcher);
  assert.deepEqual(saved, { configured: true, voiceId: 'pFZP5JQG7iQjIQuC4Bku', voice: 'Lily' });
  assert.doesNotMatch(JSON.stringify(saved), /sk_/);
  assert.deepEqual(await elevenLabsStatus(repo), { configured: true, voiceId: 'pFZP5JQG7iQjIQuC4Bku' });
  assert.ok(calls.every(call => call.url === 'https://api.elevenlabs.io/v1/voices'));
});

test('agent status reports installed and signed-in states from the CLIs\' own files', async () => {
  const home = await temp('agents-home');
  const empty = { PATH: home, Path: home };
  const before = await agentStatus({ home, env: empty });
  assert.deepEqual(before.map(item => [item.id, item.installed, item.signedIn]), [['git', false, false], ['node', false, false], ['claude', false, false], ['codex', false, false]]);
  assert.ok(before.slice(0, 2).every(item => item.requirement), 'Git and Node.js are requirements, not agents');
  assert.match(before.find(item => item.id === 'claude').install, /claude\.ai\/install/);
  assert.match(before.find(item => item.id === 'codex').install, /chatgpt\.com\/codex\/install/, 'Codex installs without npm');
  await writeFile(path.join(home, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'someone@example.com' } }));
  await mkdir(path.join(home, '.codex')); await writeFile(path.join(home, '.codex', 'auth.json'), '{}');
  const after = await agentStatus({ home, env: empty });
  assert.deepEqual(after.filter(item => !item.requirement).map(item => item.signedIn), [true, true]);
  assert.doesNotMatch(JSON.stringify(after), /someone@example\.com/, 'account details are not returned');
});

test('managed content updates untouched files, keeps edited or deleted ones, and adds new ones', async () => {
  const source = await temp('content-source'), repo = await temp('content-repo'), stateDir = path.join(repo, '.jupiter');
  const put = async (root, rel, text) => { await mkdir(path.dirname(path.join(root, rel)), { recursive: true }); await writeFile(path.join(root, rel), text); };
  await put(source, '.agents/skills/wiki/SKILL.md', 'v1');
  await put(source, '.agents/skills/wiki/node_modules/x.js', 'skip me');
  await put(source, 'knowledge/capabilities.json', '{"v":1}');
  await put(source, 'AGENTS.md', 'rules v1');
  await put(repo, 'AGENTS.md', 'my own rules');
  const first = await syncManagedContent({ source, repo, stateDir });
  assert.deepEqual(first.written.sort(), ['.agents/skills/wiki/SKILL.md', 'knowledge/capabilities.json']);
  assert.deepEqual(first.kept, ['AGENTS.md'], 'a file Jupiter never wrote is not overwritten');
  assert.equal(await readFile(path.join(repo, 'AGENTS.md'), 'utf8'), 'my own rules');
  await assert.rejects(readFile(path.join(repo, '.agents/skills/wiki/node_modules/x.js')));

  await put(source, '.agents/skills/wiki/SKILL.md', 'v2');
  await put(source, 'knowledge/capabilities.json', '{"v":2}');
  await put(source, '.agents/skills/new/SKILL.md', 'new');
  await put(repo, 'knowledge/capabilities.json', '{"v":1,"mine":true}');
  const second = await syncManagedContent({ source, repo, stateDir });
  assert.deepEqual(second.written.sort(), ['.agents/skills/new/SKILL.md', '.agents/skills/wiki/SKILL.md']);
  assert.ok(second.kept.includes('knowledge/capabilities.json'), 'an edited file is kept');
  assert.equal(await readFile(path.join(repo, '.agents/skills/wiki/SKILL.md'), 'utf8'), 'v2');

  await rm(path.join(repo, '.agents/skills/new/SKILL.md'));
  await put(source, '.agents/skills/new/SKILL.md', 'new v2');
  const third = await syncManagedContent({ source, repo, stateDir });
  assert.ok(third.kept.includes('.agents/skills/new/SKILL.md'), 'a deleted file stays deleted');
});

test('tool rules fill in this repository path and the nickname', async () => {
  const repo = await temp('rules'), home = await temp('rules-home');
  await mkdir(path.join(repo, 'knowledge', 'instructions'), { recursive: true });
  await writeFile(path.join(repo, 'knowledge', 'instructions', 'tool-rules.md'), '# Rules\nRun `node {{JUPITER_REPO}}/.jupiter/tools/pixelfx/x.mjs`.\n');
  await syncAgentRules(repo, { home, env: {}, nickname: 'Jay' });
  const text = await readFile(path.join(home, '.claude', 'CLAUDE.md'), 'utf8');
  assert.ok(text.includes(`node ${repo.split(path.sep).join('/')}/.jupiter/tools/pixelfx/x.mjs`));
  assert.doesNotMatch(text, /\{\{JUPITER_REPO\}\}/);
  assert.match(text, /Call the user Jay\./);
});
