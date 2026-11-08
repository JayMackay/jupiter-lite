// Jupiter's spoken voice through ElevenLabs. Every clip is saved, so nothing is paid for twice:
// the phrase bank (knowledge/voice/clips) holds the lines Jupiter says all the time, made once,
// and any other short reply is kept in the same folder the first time it is spoken.
// The key is read from .env on each use and never logged or returned.
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Lines Jupiter uses often. Several versions of each, so it doesn't sound like a recording.
import { greetingPhrases } from './greetings.mjs';

export const PHRASES = {
  wake: ['Yes, boss?', 'I’m listening.', 'Go ahead.', 'Mm hm?', 'What can I do for you?'],
  working: ['On it.', 'Right away.', 'Give me a second.', 'Leave it with me.', 'Working on it now.'],
  done: ['Done.', 'All done, boss.', 'That’s sorted.', 'Finished.'],
  missed: ['Sorry, I didn’t catch that.', 'Say that again?', 'One more time?'],
  failed: ['Something went wrong there.', 'That didn’t work, sorry.'],
  // Greetings when Jupiter opens, by time of day.
  morning: ['Morning, boss. What’s the plan today?', 'Good morning, boss. Ready when you are.', 'Morning. What are we tackling first?', 'Morning, boss. Coffee first, or straight in?'],
  afternoon: ['Afternoon, boss. What’s the plan today?', 'Afternoon. What are we building?', 'Good afternoon, boss. Where were we?', 'Afternoon, boss. What’s next on the list?'],
  evening: ['Evening, boss. What’s the plan tonight?', 'Evening. One more push?', 'Good evening, boss. What’s on your mind?', 'Evening, boss. Shall we pick up where you left off?'],
  welcome: ['Welcome back, boss.', 'Good to see you again.'],
  saved: ['Saved.', 'Saved it for you.'],
  added: ['Added to your board.', 'It’s on your board.'],
  opening: ['Opening it now.', 'Here you go.'],
  news: ['Here’s the latest.'],
  focus: ['Focus on for twenty five minutes. I’ll keep things quiet.'],
  bye: ['Anytime, boss.', 'Right, I’ll leave you to it.', 'Shout if you need me.', 'No worries. I’m here if you need me.'],
  unavailable: ['My voice isn’t available right now, so I’ve put the answer on screen.'],
  // Said when the J button is pressed again to stop listening.
  farewell: ['Goodbye.', 'Speak later.', 'Until next time.', 'I’ll be here if you need me.', 'Signing off.', 'Very well. Goodbye.', 'Take care.', 'I’ll be standing by.', 'At your service, as always.', 'See you shortly.'],
  // Lines for opening Brainstorm, To do and Projects (see greetings.mjs).
  ...greetingPhrases(),
};
const pick = (count, avoid = -1) => { if (count < 2) return 0; let at; do at = Math.floor(Math.random() * count); while (at === avoid); return at; };
const CACHE_LIMIT = 220;          // replies up to this length are kept for reuse
const SPOKEN_LIMIT = 600;         // longer answers are spoken as their opening sentences
const slug = text => text.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 48);

function parseEnv(text) {
  const values = {};
  for (const line of String(text).split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (match) values[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return values;
}

// Long answers become a spoken summary: the first sentences, Markdown and links removed.
export function speakable(text) {
  let spoken = String(text || '')
    .replace(/```[\s\S]*?```/g, ' ').replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/https?:\/\/\S+/g, ' ')
    .replace(/^#+\s*/gm, '').replace(/[*_~>|]/g, '').replace(/^\s*[-•]\s+/gm, '').replace(/\s+/g, ' ').trim();
  if (spoken.length > SPOKEN_LIMIT) {
    const sentences = spoken.match(/[^.!?]+[.!?]+/g) || [spoken];
    let out = '';
    for (const sentence of sentences) { if ((out + sentence).length > SPOKEN_LIMIT) break; out += sentence; }
    spoken = `${(out || spoken.slice(0, SPOKEN_LIMIT)).trim()} The rest is on screen.`;
  }
  return spoken;
}

export function createVoiceOut(repo, { fetcher = globalThis.fetch } = {}) {
  const folder = path.join(repo, 'knowledge', 'voice', 'clips');
  const indexFile = path.join(folder, 'index.json');
  let index = null, writes = Promise.resolve();

  async function config() {
    const env = parseEnv(await readFile(path.join(repo, '.env'), 'utf8').catch(() => ''));
    return { key: env.ELEVENLABS_API_KEY || process.env.ELEVENLABS_API_KEY || '', voice: env.ELEVENLABS_VOICE_ID || '', model: env.ELEVENLABS_MODEL || 'eleven_flash_v2_5', shortModel: env.ELEVENLABS_PHRASE_MODEL || 'eleven_multilingual_v2' };
  }
  async function loadIndex() {
    if (!index) index = JSON.parse(await readFile(indexFile, 'utf8').catch(() => '{"clips":{}}'));
    return index;
  }
  // Saves run one after another; Windows can briefly lock the file, so a rename is retried.
  const saveIndex = () => {
    writes = writes.catch(() => {}).then(async () => {
      await mkdir(folder, { recursive: true });
      const temporary = `${indexFile}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`;
      await writeFile(temporary, JSON.stringify(index, null, 1) + '\n');
      for (let attempt = 0; ; attempt++) {
        try { await rename(temporary, indexFile); return; }
        catch (error) { if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt >= 5) throw error; await new Promise(resolve => setTimeout(resolve, 40 * (attempt + 1))); }
      }
    });
    return writes;
  };
  // A clip belongs to one voice and model: changing either makes new clips.
  const keyOf = (text, cfg) => createHash('sha256').update(`${cfg.voice}|${cfg.model}|${text}`).digest('hex').slice(0, 16);

  async function synthesize(text, cfg) {
    const response = await fetcher(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(cfg.voice)}?output_format=mp3_44100_128`, {
      method: 'POST', signal: AbortSignal.timeout(30000),
      headers: { 'xi-api-key': cfg.key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      body: JSON.stringify({ text, model_id: cfg.model, voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.25, use_speaker_boost: true } }),
    });
    if (!response.ok) {
      const detail = await response.json().catch(() => ({}));
      throw Object.assign(new Error(`ElevenLabs answered ${response.status}${detail?.detail?.status ? ` (${detail.detail.status})` : ''}`), { status: 502 });
    }
    return Buffer.from(await response.arrayBuffer());
  }

  // Returns the clip's file, making it only if it doesn't exist yet.
  const SHORT = 60;
  async function clip(text, { phrase = null, keep = true } = {}) {
    const base = await config();
    // Phrase bank lines and short replies (saved after the first time) get the richer model.
    const cfg = phrase || text.length <= SHORT ? { ...base, model: base.shortModel } : base;
    if (!cfg.key || !cfg.voice) throw Object.assign(new Error('Add ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID to .env.'), { status: 400 });
    const data = await loadIndex(), id = keyOf(text, cfg), known = data.clips[id];
    if (known && await stat(path.join(folder, known.file)).then(() => true, () => false)) {
      known.uses = (known.uses || 0) + 1; known.last = new Date().toISOString(); void saveIndex();
      return { file: path.join(folder, known.file), cached: true, characters: 0 };
    }
    const audio = await synthesize(text, cfg);
    if (!keep) return { audio, cached: false, characters: text.length };
    await mkdir(folder, { recursive: true });
    const file = `${phrase ? `${phrase}_` : ''}${slug(text) || 'clip'}_${id.slice(0, 6)}.mp3`;
    await writeFile(path.join(folder, file), audio);
    data.clips[id] = { file, text, phrase, voice: cfg.voice, model: cfg.model, characters: text.length, made: new Date().toISOString(), uses: 1 };
    await saveIndex();
    return { file: path.join(folder, file), cached: false, characters: text.length };
  }

  // The last line used for each kind, so the same one isn't said twice running.
  const lastLine = new Map();
  return {
    folder,
    async configured() { const cfg = await config(); return Boolean(cfg.key && cfg.voice); },
    // A random line from the phrase bank, never the same one twice in a row. No separate "Sir." or
    // "Boss." clip is tacked on afterwards: recorded apart, it never matched the line's cadence.
    async phrase(kind) {
      const lines = PHRASES[kind]; if (!lines) throw Object.assign(new Error('Unknown phrase.'), { status: 400 });
      const at = pick(lines.length, lastLine.get(kind)); lastLine.set(kind, at);
      return clip(lines[at], { phrase: kind });
    },
    async speak(text) {
      const spoken = speakable(text);
      if (!spoken) throw Object.assign(new Error('Nothing to say.'), { status: 400 });
      return { ...(await clip(spoken, { keep: spoken.length <= CACHE_LIMIT })), text: spoken };
    },
    // Makes every phrase bank clip once. Returns what was made and what it cost.
    async prepare() {
      let made = 0, characters = 0;
      for (const [kind, lines] of Object.entries(PHRASES)) for (const line of lines) {
        const result = await clip(line, { phrase: kind });
        if (!result.cached) { made++; characters += result.characters; }
      }
      const data = await loadIndex(), cfg = await config();
      for (const [id, entry] of Object.entries(data.clips)) {
        if (entry.phrase && entry.model !== cfg.shortModel) { await rm(path.join(folder, entry.file), { force: true }); delete data.clips[id]; }
      }
      await saveIndex();
      return { made, characters, folder };
    },
    async usage() {
      const cfg = await config(); if (!cfg.key) return null;
      const response = await fetcher('https://api.elevenlabs.io/v1/user/subscription', { headers: { 'xi-api-key': cfg.key }, signal: AbortSignal.timeout(15000) }).catch(() => null);
      if (!response?.ok) return null;
      const value = await response.json().catch(() => null);
      const data = await loadIndex();
      const clips = Object.values(data.clips);
      return value && { tier: value.tier, used: value.character_count, limit: value.character_limit, resets: value.next_character_count_reset_unix ? new Date(value.next_character_count_reset_unix * 1000).toISOString() : null,
        clips: clips.length, replays: clips.reduce((sum, entry) => sum + Math.max(0, (entry.uses || 1) - 1), 0), saved: clips.reduce((sum, entry) => sum + Math.max(0, (entry.uses || 1) - 1) * (entry.characters || 0), 0) };
    },
  };
}
