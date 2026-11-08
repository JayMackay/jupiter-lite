// Token usage from Claude Code and Codex's own local logs. Reads only the usage numbers,
// model and time of each reply; conversation text is never parsed or kept. Read only.
import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';

const day = iso => { const date = new Date(iso); return Number.isNaN(date.getTime()) ? null : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; };
const zero = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 });
const add = (into, usage) => { for (const key of ['input', 'output', 'cacheRead', 'cacheWrite']) into[key] += usage[key] || 0; into.total = into.input + into.output + into.cacheRead + into.cacheWrite; return into; };
const count = value => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : 0;

async function files(folder, depth = 4) {
  if (depth < 0) return [];
  let entries; try { entries = await readdir(folder, { withFileTypes: true }); } catch { return []; }
  const nested = await Promise.all(entries.map(entry => entry.isDirectory() ? files(path.join(folder, entry.name), depth - 1) : entry.name.endsWith('.jsonl') ? [path.join(folder, entry.name)] : []));
  return nested.flat();
}

// One file → a list of { day, agent, model, usage } rows. Lines without usage are skipped
// before parsing, so long transcripts stay cheap to read.
async function readClaude(file) {
  const rows = [], seen = new Set();
  const lines = createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.includes('"usage"')) continue;
    let entry; try { entry = JSON.parse(line); } catch { continue; }
    const message = entry?.message, usage = message?.usage;
    if (!usage || entry.type !== 'assistant') continue;
    // A streamed reply is logged in pieces with the same id; count it once.
    const id = message.id || entry.requestId; if (id) { if (seen.has(id)) continue; seen.add(id); }
    const when = day(entry.timestamp); if (!when) continue;
    rows.push({ day: when, agent: 'claude', model: String(message.model || 'unknown').slice(0, 60), usage: { input: count(usage.input_tokens), output: count(usage.output_tokens), cacheRead: count(usage.cache_read_input_tokens), cacheWrite: count(usage.cache_creation_input_tokens) } });
  }
  return rows;
}
async function readCodex(file) {
  const rows = []; let model = 'unknown';
  const lines = createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of lines) {
    const tokens = line.includes('token_count');
    if (!tokens && !line.includes('"model"')) continue;
    let entry; try { entry = JSON.parse(line); } catch { continue; }
    const payload = entry?.payload;
    if (payload?.model && typeof payload.model === 'string') model = payload.model.slice(0, 60);
    const last = payload?.type === 'token_count' ? payload.info?.last_token_usage : null;
    if (!last) continue;
    const when = day(entry.timestamp); if (!when) continue;
    const cached = count(last.cached_input_tokens);
    rows.push({ day: when, agent: 'codex', model, usage: { input: Math.max(0, count(last.input_tokens) - cached), output: count(last.output_tokens) + count(last.reasoning_output_tokens), cacheRead: cached, cacheWrite: count(last.cache_write_input_tokens) } });
  }
  return rows;
}

export function createTokenUsage({ home = os.homedir(), env = process.env } = {}) {
  const claudeHome = env.CLAUDE_CONFIG_DIR || path.join(home, '.claude');
  const codexHome = env.CODEX_HOME || path.join(home, '.codex');
  const cache = new Map(); // file → { key, rows }

  async function rowsFor(file, reader) {
    const info = await stat(file).catch(() => null); if (!info) return [];
    const key = `${info.size}:${info.mtimeMs}`, cached = cache.get(file);
    if (cached?.key === key) return cached.rows;
    const rows = await reader(file).catch(() => []);
    cache.set(file, { key, rows });
    return rows;
  }

  async function summary({ days = 14 } = {}) {
    const [claudeFiles, codexFiles] = await Promise.all([files(path.join(claudeHome, 'projects')), files(path.join(codexHome, 'sessions'))]);
    const rows = (await Promise.all([...claudeFiles.map(file => rowsFor(file, readClaude)), ...codexFiles.map(file => rowsFor(file, readCodex))])).flat();
    const today = day(new Date().toISOString());
    const dates = Array.from({ length: days }, (_, index) => day(new Date(Date.now() - (days - 1 - index) * 86400000).toISOString()));
    const inRange = new Set(dates);
    const byDay = dates.map(date => ({ date, claude: zero(), codex: zero() }));
    const index = new Map(byDay.map(entry => [entry.date, entry]));
    const totals = { today: { claude: zero(), codex: zero() }, week: { claude: zero(), codex: zero() }, range: { claude: zero(), codex: zero() } };
    const weekStart = dates[Math.max(0, dates.length - 7)];
    const models = new Map();
    for (const row of rows) {
      if (!inRange.has(row.day)) continue;
      add(index.get(row.day)[row.agent], row.usage);
      add(totals.range[row.agent], row.usage);
      if (row.day >= weekStart) add(totals.week[row.agent], row.usage);
      if (row.day === today) add(totals.today[row.agent], row.usage);
      const key = `${row.agent}|${row.model}`;
      if (!models.has(key)) models.set(key, { agent: row.agent, model: row.model, usage: zero(), replies: 0 });
      const entry = models.get(key); add(entry.usage, row.usage); entry.replies++;
    }
    return { updatedAt: new Date().toISOString(), days, today, totals, byDay, models: [...models.values()].sort((a, b) => b.usage.total - a.usage.total).slice(0, 12), sources: { claude: claudeFiles.length, codex: codexFiles.length } };
  }

  return { summary };
}
