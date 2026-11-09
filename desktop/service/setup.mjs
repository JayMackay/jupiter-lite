// First-run setup: who the user is, the agent CLIs (installed and signed in) and ElevenLabs.
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parse as parseEnv } from 'dotenv';
import { commandPath } from './agents.mjs';
import { isWindows } from './platform.mjs';

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const exists = file => stat(file).then(() => true, () => false);

// The official install commands, run in a visible terminal so the user sees exactly what runs.
// Both are standalone installers: neither needs Node.js or npm on the user's computer.
export function installCommands() {
  return {
    claude: isWindows ? 'irm https://claude.ai/install.ps1 | iex' : 'curl -fsSL https://claude.ai/install.sh | bash',
    codex: isWindows ? 'irm https://chatgpt.com/codex/install.ps1 | iex' : 'curl -fsSL https://chatgpt.com/codex/install.sh | sh',
  };
}
export const AGENT_DOCS = { claude: 'https://code.claude.com/docs/en/setup', codex: 'https://learn.chatgpt.com/docs/codex/cli', git: 'https://git-scm.com/downloads', node: 'https://nodejs.org/en/download' };

// Git downloads the starter plugins and skills; Node.js (npm, npx) pins and runs the MCP tools.
function requirementCommands(env, home) {
  const winget = isWindows && commandPath('winget', env, home);
  const brew = process.platform === 'darwin' && commandPath('brew', env, home);
  const viaWinget = id => `winget install --id ${id} -e --source winget --accept-package-agreements --accept-source-agreements`;
  return {
    git: winget ? viaWinget('Git.Git') : process.platform === 'darwin' ? 'xcode-select --install' : null,
    node: winget ? viaWinget('OpenJS.NodeJS.LTS') : brew ? 'brew install node' : null,
  };
}

export async function agentStatus({ home = os.homedir(), env = process.env } = {}) {
  const claudeDir = env.CLAUDE_CONFIG_DIR || path.join(home, '.claude');
  const claudeState = await readFile(path.join(env.CLAUDE_CONFIG_DIR ? claudeDir : home, '.claude.json'), 'utf8').then(JSON.parse).catch(() => null);
  const codexHome = env.CODEX_HOME || path.join(home, '.codex');
  const commands = installCommands();
  const needs = requirementCommands(env, home);
  const requirement = (id, label, command, install) => {
    const installed = !!commandPath(command, env, home);
    return { id, label, requirement: true, installed, signedIn: installed, install, docs: AGENT_DOCS[id], note: install ? undefined : `Download it from ${AGENT_DOCS[id]}` };
  };
  return [
    requirement('git', 'Git', 'git', needs.git),
    requirement('node', 'Node.js', 'npm', needs.node),
    { id: 'claude', label: 'Claude Code', installed: !!commandPath('claude', env, home), signedIn: Boolean(claudeState?.oauthAccount) || await exists(path.join(claudeDir, '.credentials.json')), install: commands.claude, docs: AGENT_DOCS.claude },
    { id: 'codex', label: 'Codex', installed: !!commandPath('codex', env, home), signedIn: await exists(path.join(codexHome, 'auth.json')), install: commands.codex, docs: AGENT_DOCS.codex },
  ];
}

const PROFILE_START = '<!-- jupiter:profile:start (written by Jupiter setup) -->';
const PROFILE_END = '<!-- jupiter:profile:end -->';
export function cleanName(value, label) {
  const text = typeof value === 'string' ? value.normalize('NFC').trim().replace(/\s+/g, ' ') : '';
  if (!text || text.length > 60 || !/^[\p{L}\p{M}\p{N} .'’-]+$/u.test(text)) throw fail(`Enter ${label} using letters, spaces, apostrophes or hyphens.`);
  return text;
}
// context/me.md tells agents who they work for. Only the block between Jupiter's markers is replaced.
export async function saveProfile(repo, { name, nickname }) {
  const profile = { ownerName: cleanName(name, 'your name'), nickname: cleanName(nickname || name, 'what to call you') };
  const file = path.join(repo, 'context', 'me.md');
  const block = `${PROFILE_START}\n- Name: ${profile.ownerName}\n- Call me: ${profile.nickname}\n${PROFILE_END}`;
  const before = await readFile(file, 'utf8').catch(() => '# About me\n');
  const start = before.indexOf(PROFILE_START), end = before.indexOf(PROFILE_END);
  const after = start >= 0 && end > start ? before.slice(0, start) + block + before.slice(end + PROFILE_END.length) : `${before.replace(/\s*$/, '')}\n\n${block}\n`;
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, after);
  return profile;
}

// Replaces or appends KEY=value lines in .env, starting from .env.example when there is no .env yet.
export async function setEnvValues(repo, values) {
  const file = path.join(repo, '.env');
  let text = await readFile(file, 'utf8').catch(() => null);
  if (text == null) text = await readFile(path.join(repo, '.env.example'), 'utf8').catch(() => '');
  for (const [key, value] of Object.entries(values)) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(key) || /[\r\n]/.test(value)) throw fail('Invalid setting.');
    const line = `${key}=${value}`;
    const pattern = new RegExp(`^${key}=.*$`, 'm');
    text = pattern.test(text) ? text.replace(pattern, () => line) : `${text.replace(/\s*$/, '')}\n${line}\n`;
  }
  await writeFile(file, text);
}

export async function elevenLabsStatus(repo) {
  const env = parseEnv(await readFile(path.join(repo, '.env'), 'utf8').catch(() => ''));
  return { configured: Boolean((env.ELEVENLABS_API_KEY || process.env.ELEVENLABS_API_KEY) && env.ELEVENLABS_VOICE_ID), voiceId: env.ELEVENLABS_VOICE_ID || null };
}

const cleanKey = key => {
  const value = typeof key === 'string' ? key.trim() : '';
  if (!/^[A-Za-z0-9_-]{20,200}$/.test(value)) throw fail('Paste your ElevenLabs API key.');
  return value;
};
// Checks the key by listing the account's voices. The key is never returned or logged.
export async function elevenLabsVoices(key, fetcher = globalThis.fetch) {
  const response = await fetcher('https://api.elevenlabs.io/v1/voices', { headers: { 'xi-api-key': cleanKey(key) }, signal: AbortSignal.timeout(15000) });
  if (response.status === 401) throw fail('ElevenLabs did not accept that key.');
  if (!response.ok) throw fail(`ElevenLabs answered ${response.status}. Give the key Text to Speech access and Voices: Read.`, 502);
  const data = await response.json();
  return (data.voices || []).filter(voice => /^[A-Za-z0-9]{10,40}$/.test(voice.voice_id || '')).slice(0, 300)
    .map(voice => ({ id: voice.voice_id, name: String(voice.name || voice.voice_id).slice(0, 80), category: voice.category || null }));
}
export async function saveElevenLabs(repo, { key, voiceId }, fetcher) {
  const voices = await elevenLabsVoices(key, fetcher);
  const voice = voices.find(item => item.id === voiceId);
  if (!voice) throw fail('Choose one of your ElevenLabs voices.');
  await setEnvValues(repo, { ELEVENLABS_API_KEY: cleanKey(key), ELEVENLABS_VOICE_ID: voice.id });
  return { configured: true, voiceId: voice.id, voice: voice.name };
}
