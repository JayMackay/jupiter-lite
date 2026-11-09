// Spoken answers Jupiter can give straight away, without the coordinator:
// the weather (Open-Meteo, free, no key), the news (Jupiter's own feeds) and mapping a project
// folder in projects/ with graphify. Everything here is plain text for the voice.
import path from 'node:path';
import { readdir, stat } from 'node:fs/promises';

const LONDON = { name: 'London', latitude: 51.5072, longitude: -0.1276, timezone: 'Europe/London' };

// ---------- Weather ----------

export const WEATHER_ASK = /\b(weather|forecast|temperature|umbrella|raining|rain (?:today|later|tomorrow)|will it rain|is it (?:cold|hot|warm|sunny|wet)|how (?:cold|hot|warm) is it|need a coat|snow(?:ing)?)\b/i;

const SKY = code => code === 0 ? 'clear' : code <= 2 ? 'partly cloudy' : code === 3 ? 'grey and overcast' : code <= 48 ? 'foggy'
  : code <= 57 ? 'drizzly' : code <= 67 ? 'raining' : code <= 77 ? 'snowing' : code <= 82 ? 'showery' : code <= 86 ? 'snowy' : 'stormy';
const WET = code => (code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95;
const SNOW = code => (code >= 71 && code <= 77) || code === 85 || code === 86;
const feel = t => t <= 0 ? 'below freezing' : t <= 5 ? 'freezing' : t <= 10 ? 'chilly' : t <= 15 ? 'fresh' : t <= 20 ? 'mild' : t <= 25 ? 'warm' : 'hot';
const clock = hour => { const h = hour % 12 || 12; return hour < 12 ? `${h} this morning` : hour < 17 ? `${h} this afternoon` : `${h} this evening`; };
const pick = (list, seed) => list[Math.abs(seed) % list.length];

export function createWeather({ fetcher = fetch, now = () => new Date() } = {}) {
  const places = new Map(), forecasts = new Map();

  async function place(name) {
    const wanted = String(name || '').trim();
    if (!wanted || /^london$/i.test(wanted)) return LONDON;
    const key = wanted.toLowerCase();
    if (places.has(key)) return places.get(key);
    const url = `https://geocoding-api.open-meteo.com/v1/search?count=1&language=en&format=json&name=${encodeURIComponent(wanted.slice(0, 80))}`;
    const response = await fetcher(url, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error('The weather service did not answer.');
    const hit = (await response.json()).results?.[0];
    if (!hit) throw Object.assign(new Error(`I couldn't find ${wanted}.`), { status: 404 });
    const found = { name: hit.name, latitude: hit.latitude, longitude: hit.longitude, timezone: hit.timezone || 'auto' };
    places.set(key, found);
    return found;
  }

  async function forecast(where) {
    const key = `${where.latitude},${where.longitude}`, cached = forecasts.get(key);
    if (cached && now() - cached.at < 10 * 60 * 1000) return cached.data;
    const query = new URLSearchParams({
      latitude: String(where.latitude), longitude: String(where.longitude), timezone: where.timezone || 'auto', forecast_days: '2',
      current: 'temperature_2m,apparent_temperature,weather_code,wind_speed_10m,precipitation',
      hourly: 'temperature_2m,precipitation_probability,weather_code',
      daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    });
    const response = await fetcher(`https://api.open-meteo.com/v1/forecast?${query}`, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error('The weather service did not answer.');
    const data = await response.json();
    forecasts.set(key, { at: now(), data });
    return data;
  }

  // "What's the weather Jupiter?" -> "It's 5 degrees in London and freezing, boss. ..."
  async function describe(question = '', home = 'London') {
    const asked = String(question);
    const named = asked.match(/\b(?:in|for|at)\s+([A-Z][\w' -]{1,40}?)(?:\s+(?:today|tomorrow|tonight|later|this|right now|now))?\s*[?.!]*$/);
    const where = await place(named ? named[1] : home);
    const data = await forecast(where);
    const tomorrow = /\btomorrow\b/i.test(asked);
    const seed = Math.floor(now().getTime() / 60000);
    if (tomorrow) {
      const d = data.daily, hi = Math.round(d.temperature_2m_max[1]), lo = Math.round(d.temperature_2m_min[1]), rain = d.precipitation_probability_max[1] ?? 0, code = d.weather_code[1];
      const lines = [`Tomorrow in ${where.name}: ${SKY(code)}, ${lo} to ${hi} degrees.`];
      if (SNOW(code)) lines.push('Snow is likely, so wrap up and take care on the roads.');
      else if (rain >= 50) lines.push(`There's a ${rain} percent chance of rain, so pack an umbrella.`);
      else if (rain >= 25) lines.push('Maybe a shower, nothing serious.');
      if (hi <= 8) lines.push('A proper coat day, boss.'); else if (hi >= 24) lines.push('A warm one, so go light.');
      return lines.join(' ');
    }
    const c = data.current, t = Math.round(c.temperature_2m), feels = Math.round(c.apparent_temperature);
    const lines = [pick([`It's ${t} degrees in ${where.name} and ${SKY(c.weather_code)}`, `${where.name}'s at ${t} degrees, ${SKY(c.weather_code)}`], seed)
      + (feels <= 5 || feels >= 26 ? `, ${feel(feels)}, boss.` : '.')];
    if (Math.abs(feels - t) >= 3) lines.push(`Feels more like ${feels}.`);
    if (WET(c.weather_code)) lines.push("It's wet out right now, so grab an umbrella.");
    else {
      // The rest of today: the first hour that is likely to rain.
      const hourNow = Number(String(c.time || '').slice(11, 13)) || now().getHours();
      const today = String(c.time || '').slice(0, 10);
      const rainy = (data.hourly?.time || []).map((time, index) => ({ time, hour: Number(time.slice(11, 13)), chance: data.hourly.precipitation_probability[index] ?? 0, code: data.hourly.weather_code[index] }))
        .find(slot => slot.time.startsWith(today) && slot.hour > hourNow && slot.hour <= 23 && (slot.chance >= 50 || WET(slot.code)));
      if (rainy) lines.push(pick([`Rain's due from about ${clock(rainy.hour)}, so bring an umbrella.`, `It turns wet around ${clock(rainy.hour)}, so take an umbrella with you.`], seed));
      else if (SNOW(c.weather_code)) lines.push('Snow about, so mind your step.');
      else lines.push(pick(['Dry for the rest of the day.', 'No rain on the way today.'], seed));
    }
    if (feels <= 3) lines.push(pick(['I suggest a warm coat, maybe a scarf.', 'Wear your warmest coat.'], seed));
    else if (feels <= 9) lines.push(pick(['I suggest you wear a coat.', "You'll want a coat."], seed));
    else if (feels <= 14) lines.push('A jacket should do.');
    else if (feels >= 25) lines.push("Stay hydrated, and don't forget sun cream.");
    if (c.wind_speed_10m >= 40) lines.push("And it's blustery, so hold on to that umbrella.");
    return lines.join(' ');
  }
  return { place, forecast, describe };
}

// ---------- News ----------

export const NEWS_ASK = /\b(news|headlines?|(?:top|biggest|main) stor(?:y|ies)|(?:what'?s|what is|what are|anything) (?:happening|going on|new|the latest|latest)\b|what'?s up in|catch me up|latest (?:in|on|from))/i;
const TOPICS = [[/\b(?:gaming|games?|gamers?|video ?games?|esports?|playstation|xbox|nintendo|steam)\b/i, 'gaming'], [/\b(?:finance|financial|markets?|stocks?|shares|money|economy|economic|business|crypto|bitcoin|ftse|interest rates?)\b/i, 'finance'], [/\bagent(?:ic|s)?\b/i, 'agentic'], [/\b(?:ai|a\.i\.|artificial intelligence)\b/i, 'ai'], [/\btech(?:nology)?\b/i, 'tech'], [/\b(?:uk|british|britain|england|home)\b/i, 'uk'], [/\b(?:world|global|international)\b/i, 'world']];

export async function describeNews(news, question = '') {
  const asked = String(question);
  const hit = TOPICS.find(([pattern]) => pattern.test(asked));
  const one = /\btop story\b|\bbiggest story\b|\bthe story\b/i.test(asked);
  const clean = text => String(text).replace(/\s*\|.*$/, '').replace(/\s+/g, ' ').trim();
  if (hit) {
    const result = await news.topic(hit[1]);
    const items = result.items.slice(0, one ? 1 : 3);
    if (!items.length) return { text: `I couldn't reach the ${result.label || hit[1]} sources just now.`, topic: hit[1] };
    const label = result.label || hit[1];
    const text = one ? `Top story in ${label}, from ${items[0].source}: ${clean(items[0].title)}.`
      : `Here's the latest in ${label}. ${items.map((item, index) => `${['First', 'Next', 'And'][index]}, from ${item.source}: ${clean(item.title)}.`).join(' ')}`;
    return { text: `${text} Want me to open it?`, topic: hit[1] };
  }
  // No topic: the lead story from the UK, the world and AI.
  const picks = [];
  for (const id of ['uk', 'world', 'ai']) { const item = (await news.topic(id).catch(() => ({ items: [] }))).items[0]; if (item) picks.push({ id, item }); }
  if (!picks.length) return { text: "I couldn't reach the news sources just now.", topic: null };
  const name = { uk: 'At home', world: 'Around the world', ai: 'In AI' };
  return { text: `${picks.map(({ id, item }) => `${name[id]}, ${clean(item.title)}.`).join(' ')} Want me to open the news?`, topic: picks[0].id };
}

// ---------- Project maps ----------

// "Jupiter scan test", "can you map my test project", "read test again", "update the test project".
const SCAN = /^(?:(?:hey |ok |okay )?jupiter[,.!]?\s*)?(?:(?:can|could|would) you |please )?(scan|map(?: out)?|read|re-?read|update|refresh|re-?scan|re-?map|index)\s+(?:my |the |our )?["“']?(.+?)["”']?(?:\s+(?:project|folder|repo))?(?:\s+(again|for me|to update|please))*\s*[.?!]*$/i;

export async function projectFolders(repo, root = path.join(repo, 'projects')) {
  const names = await readdir(root, { withFileTypes: true }).catch(() => []);
  return names.filter(entry => entry.isDirectory() && !entry.name.startsWith('.')).map(entry => ({ name: entry.name, path: path.join(root, entry.name) }));
}

const squash = text => String(text).toLowerCase().replace(/[^a-z0-9]+/g, '');

/** Returns { project, update } when the words ask to map a folder that exists in projects/. */
export async function matchProjectScan(repo, text, root) {
  const m = String(text).trim().match(SCAN);
  if (!m) return null;
  const wanted = squash(m[2].replace(/\b(project|folder|repo|again)\b/gi, ''));
  if (!wanted) return null;
  const folders = await projectFolders(repo, root);
  const project = folders.find(entry => squash(entry.name) === wanted) || folders.find(entry => squash(entry.name).startsWith(wanted) || wanted.startsWith(squash(entry.name)));
  if (!project) return null;
  const update = /^(?:re-?read|update|refresh|re-?scan|re-?map)$/i.test(m[1]) || /\bagain\b|\bupdate\b/i.test(text);
  return { project, update };
}

export async function findProject(repo, name, root) {
  const wanted = squash(name);
  const folders = await projectFolders(repo, root);
  return folders.find(entry => squash(entry.name) === wanted) || folders.find(entry => squash(entry.name).includes(wanted)) || null;
}

/** The brief a Claude Code chat follows to map (or refresh the map of) one project folder. */
export async function scanBrief(repo, project, { update = false } = {}) {
  const existing = await stat(path.join(project.path, 'PROJECT_MAP.md')).then(() => true, () => false);
  const refresh = update || existing;
  return [
    `# ${refresh ? 'Refresh the map of' : 'Map'} the "${project.name}" project`,
    '',
    `Project folder: ${project.path}`,
    `Shared knowledge (read only, for rules and past decisions): ${path.join(repo, 'knowledge')}`,
    '',
    'Work only inside the project folder. Do not change the project\'s own source files.',
    '',
    '## Steps',
    '',
    refresh
      ? '1. Run graphify on this folder in update mode (the /graphify skill, incremental update) so graphify-out/ reflects what changed. If there is no graphify-out/ yet, do a full run.'
      : '1. Run graphify on this folder (the /graphify skill). Its output stays in graphify-out/ inside this folder.',
    '   Keep graphify-out/ in the project root (never in a scratchpad or temporary copy) so later rereads only update what changed. It is outside Unity\'s Assets folder, so Unity will not import it. If the project uses git and graphify-out/ is not ignored, add it to .gitignore.',
    '2. If graphify cannot run, or a part needs more detail, use the repomix MCP with its secret scan on. Keep any pack inside this folder under .jupiter/ and never paste secrets into the map.',
    '3. Search agentmemory for earlier decisions about this project and include the relevant ones.',
    `4. ${refresh ? 'Update' : 'Write'} PROJECT_MAP.md in the project folder: what the project is, how it is laid out, the main parts and how they connect (from the graph), how to run and test it, decisions so far, open questions, and a "Last mapped" line with today's date (dd/mm/yyyy).${refresh ? ' Keep what is still true, change what moved, and add a short "What changed" section.' : ''}`,
    '5. Save one short agentmemory note for any important decision you found. Never store secrets or personal data.',
    '',
    'When you finish, reply in two or three plain sentences saying what the project is and what you found or what changed.',
  ].join('\n');
}
