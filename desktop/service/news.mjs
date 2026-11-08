// News for the dashboard: RSS and Atom feeds grouped by topic (AI, UK, World). Feeds are
// fetched by the service, reduced to plain text (title, link, time, a short summary) and
// cached. Headlines are untrusted text: nothing from a feed is run or rendered as HTML.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const DEFAULT_FEEDS = {
  version: 3,
  topics: [
    { id: 'ai', label: 'AI', feeds: [
      { name: 'The Verge', url: 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml' },
      { name: 'TechCrunch', url: 'https://techcrunch.com/category/artificial-intelligence/feed/' },
      { name: 'MIT Technology Review', url: 'https://www.technologyreview.com/topic/artificial-intelligence/feed' },
      { name: 'Ars Technica', url: 'https://arstechnica.com/ai/feed/' },
      { name: 'The Guardian', url: 'https://www.theguardian.com/technology/artificialintelligenceai/rss' },
      { name: 'OpenAI', url: 'https://openai.com/news/rss.xml' },
      { name: 'Google DeepMind', url: 'https://deepmind.google/blog/rss.xml' },
      { name: 'Hugging Face', url: 'https://huggingface.co/blog/feed.xml' },
    ] },
    { id: 'agentic', label: 'Agentic', from: ['ai', 'tech'], match: '\\b(agents?|agentic|autonomous|copilots?|assistants?|MCP|model context protocol|Claude Code|Codex|operator|computer use|multi agent|workflow automation)\\b', feeds: [] },
    { id: 'tech', label: 'Tech', feeds: [
      { name: 'The Verge', url: 'https://www.theverge.com/rss/index.xml' },
      { name: 'Ars Technica', url: 'https://feeds.arstechnica.com/arstechnica/index' },
      { name: 'Wired', url: 'https://www.wired.com/feed/rss' },
      { name: 'BBC News', url: 'https://feeds.bbci.co.uk/news/technology/rss.xml' },
    ] },
    { id: 'uk', label: 'UK', feeds: [
      { name: 'BBC News', url: 'https://feeds.bbci.co.uk/news/uk/rss.xml' },
      { name: 'The Guardian', url: 'https://www.theguardian.com/uk-news/rss' },
      { name: 'Sky News', url: 'https://feeds.skynews.com/feeds/rss/uk.xml' },
    ] },
    { id: 'world', label: 'World', feeds: [
      { name: 'BBC News', url: 'https://feeds.bbci.co.uk/news/world/rss.xml' },
      { name: 'The Guardian', url: 'https://www.theguardian.com/world/rss', exclude: '/(uk-news|politics|society|uk)/' },
      { name: 'Al Jazeera', url: 'https://www.aljazeera.com/xml/rss/all.xml' },
      { name: 'Sky News', url: 'https://feeds.skynews.com/feeds/rss/world.xml' },
    ] },
    { id: 'gaming', label: 'Gaming', feeds: [
      { name: 'The Verge', url: 'https://www.theverge.com/rss/games/index.xml' },
      { name: 'Eurogamer', url: 'https://www.eurogamer.net/feed' },
      { name: 'PC Gamer', url: 'https://www.pcgamer.com/rss/' },
      { name: 'Rock Paper Shotgun', url: 'https://www.rockpapershotgun.com/feed' },
    ] },
    { id: 'finance', label: 'Finance', feeds: [
      { name: 'BBC News', url: 'https://feeds.bbci.co.uk/news/business/rss.xml' },
      { name: 'The Guardian', url: 'https://www.theguardian.com/uk/business/rss' },
      { name: 'Sky News', url: 'https://feeds.skynews.com/feeds/rss/business.xml' },
      { name: 'CNBC', url: 'https://www.cnbc.com/id/100003114/device/rss/rss.html' },
    ] },
  ],
};

const FRESH_MS = 20 * 60 * 1000, PER_FEED = 15, PER_TOPIC = 60, MAX_BYTES = 6 * 1024 * 1024;
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', pound: '£', euro: '€' };
const decode = text => String(text).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code) => {
  if (code[0] === '#') { const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10); return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ''; }
  return ENTITIES[code.toLowerCase()] ?? match;
});
// Feeds often wrap HTML in CDATA or escape it; either way only the words are kept.
export const plain = (value, max = 400) => {
  let text = String(value ?? '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  text = decode(text);
  text = text.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]*>/g, ' ');
  text = decode(text).replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1).replace(/\s+\S*$/, '')}…` : text;
};
// Newest first; stories without a date go last.
const newestFirst = (a, b) => (b.published || '').localeCompare(a.published || '');
const tag = (block, name) => { const match = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i')); return match ? match[1] : ''; };
const safeLink = value => { try { const url = new URL(decode(String(value).trim())); return ['http:', 'https:'].includes(url.protocol) ? url.href : null; } catch { return null; } };

// The largest picture a story offers. Only https addresses are kept; nothing else from it is used.
function pickImage(block) {
  const candidates = [];
  for (const match of block.matchAll(/<media:(?:content|thumbnail)\b([^>]*)>/gi)) {
    const attrs = match[1], url = attrs.match(/\burl=["']([^"']+)["']/i)?.[1];
    if (!url || /\bmedium=["'](?!image)/i.test(attrs) || /\btype=["'](?!image)/i.test(attrs)) continue;
    candidates.push({ url, width: Number(attrs.match(/\bwidth=["'](\d+)/i)?.[1] || 0) });
  }
  for (const match of block.matchAll(/<enclosure\b([^>]*)>/gi)) {
    const attrs = match[1], url = attrs.match(/\burl=["']([^"']+)["']/i)?.[1];
    if (url && /type=["']image\//i.test(attrs)) candidates.push({ url, width: 0 });
  }
  if (!candidates.length) {
    const html = decode(String(block).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1'));
    const img = html.match(/<img\b[^>]*?\bsrc=["']([^"']+)["']/i)?.[1];
    if (img) candidates.push({ url: img, width: 0 });
  }
  const best = candidates.sort((a, b) => b.width - a.width).map(entry => safeLink(entry.url)).find(url => url && url.startsWith('https://'));
  // BBC serves 240px thumbnails by default; ask for its larger size.
  return best ? best.replace(/(ichef\.bbci\.co\.uk\/(?:ace|news)\/standard\/)\d+\//, '$1976/') : null;
}

export function parseFeed(xml, source) {
  const items = [];
  const blocks = String(xml).match(/<item[\s>][\s\S]*?<\/item>|<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  for (const block of blocks) {
    const title = plain(tag(block, 'title'), 220);
    let link = safeLink(plain(tag(block, 'link'), 2000));
    if (!link) { const href = block.match(/<link\b[^>]*?(?:rel=["']alternate["'][^>]*?)?href=["']([^"']+)["']/i); if (href) link = safeLink(href[1]); }
    if (!link) link = safeLink(plain(tag(block, 'guid'), 2000));
    const when = Date.parse(plain(tag(block, 'pubDate') || tag(block, 'published') || tag(block, 'updated') || tag(block, 'dc:date'), 80));
    const summary = plain(tag(block, 'description') || tag(block, 'summary') || tag(block, 'content'), 260);
    if (!title || !link) continue;
    const image = pickImage(block);
    // Video: a YouTube clip plays inside Jupiter; other video stories open on the publisher's site.
    const youtube = block.match(/(?:youtube(?:-nocookie)?\.com\/(?:watch\?(?:[^"'<>\s]*?&(?:amp;)?)?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
    const video = youtube ? { kind: 'youtube', id: youtube[1] } : /\/(videos?|av)\//i.test(new URL(link).pathname) ? { kind: 'page' } : null;
    items.push({ title, link, source, published: Number.isFinite(when) ? new Date(when).toISOString() : null, summary: summary === title ? '' : summary, ...(video ? { video } : {}), ...(image ? { image } : {}) });
  }
  return items.sort(newestFirst).slice(0, PER_FEED);
}

export function createNews(repo, { fetcher = globalThis.fetch, now = () => Date.now() } = {}) {
  const file = path.join(repo, 'knowledge', 'news', 'feeds.json');
  const cache = new Map(); // url → { at, items, error }
  const pending = new Map();

  async function config() {
    try {
      const data = JSON.parse(await readFile(file, 'utf8'));
      if (Array.isArray(data?.topics)) {
        if (!data.version) {
          const known = new Set(data.topics.map(entry => entry.id));
          const upgraded = { version: 2, topics: [...DEFAULT_FEEDS.topics.filter(entry => !known.has(entry.id) || ['ai', 'uk', 'world'].includes(entry.id)).map(entry => data.topics.find(own => own.id === entry.id) || entry), ...data.topics.filter(entry => !DEFAULT_FEEDS.topics.some(own => own.id === entry.id))] };
          await writeFile(file, JSON.stringify(upgraded, null, 2) + '\n');
          return upgraded;
        }
        // Version 3 added Gaming and Finance; your own topics and sources are kept.
        if (data.version < 3) {
          const known = new Set(data.topics.map(entry => entry.id));
          const upgraded = { ...data, version: 3, topics: [...data.topics, ...DEFAULT_FEEDS.topics.filter(entry => ['gaming', 'finance'].includes(entry.id) && !known.has(entry.id))] };
          await writeFile(file, JSON.stringify(upgraded, null, 2) + '\n');
          return upgraded;
        }
        return data;
      }
    } catch (error) {
      if (error.code !== 'ENOENT') return DEFAULT_FEEDS;
    }
    // First use: write the default sources so they can be edited by hand.
    await mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(DEFAULT_FEEDS, null, 2) + '\n'); await rename(temporary, file);
    return DEFAULT_FEEDS;
  }

  async function load(feed, force) {
    const cached = cache.get(feed.url);
    if (cached && !force && now() - cached.at < FRESH_MS) return cached;
    if (pending.has(feed.url)) return pending.get(feed.url);
    const job = (async () => {
      try {
        const url = safeLink(feed.url); if (!url) throw new Error('not a web address');
        const response = await fetcher(url, { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'Jupiter news reader', Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' } });
        if (!response.ok) throw new Error(`answered ${response.status}`);
        const text = await response.text();
        if (text.length > MAX_BYTES) throw new Error('feed is too large');
        // An optional exclude pattern drops stories that belong to another topic (matched on the link).
        let skip = null; try { if (feed.exclude) skip = new RegExp(String(feed.exclude).slice(0, 200), 'i'); } catch { skip = null; }
        const parsed = parseFeed(text, String(feed.name || new URL(url).hostname).slice(0, 60)).filter(item => !skip || !skip.test(new URL(item.link).pathname));
        const entry = { at: now(), items: parsed, error: null };
        cache.set(feed.url, entry); return entry;
      } catch (error) {
        // Keep the last good headlines when a source is briefly down.
        const entry = { at: now(), items: cached?.items || [], error: String(error.message || error).slice(0, 120) };
        cache.set(feed.url, entry); return entry;
      } finally { pending.delete(feed.url); }
    })();
    pending.set(feed.url, job);
    return job;
  }

  async function topic(id, { force = false } = {}) {
    const { topics } = await config();
    const chosen = topics.find(entry => entry.id === id) || topics[0];
    if (!chosen) return { topic: null, topics: [], items: [], failed: [] };
    const borrowed = (chosen.from || []).flatMap(other => topics.find(entry => entry.id === other)?.feeds || []);
    const feeds = [...(chosen.feeds || []), ...borrowed].filter((feed, index, list) => list.findIndex(other => other.url === feed.url) === index).slice(0, 24);
    let keep = null; try { if (chosen.match) keep = new RegExp(String(chosen.match).slice(0, 400), 'i'); } catch { keep = null; }
    const results = await Promise.all(feeds.map(feed => load(feed, force).then(entry => ({ feed, entry: keep ? { ...entry, items: entry.items.filter(item => keep.test(`${item.title} ${item.summary}`)) } : entry }))));
    const seen = new Set(), items = [];
    for (const item of results.flatMap(result => result.entry.items).sort(newestFirst)) {
      const key = item.link.replace(/[?#].*$/, '').toLowerCase(), headline = item.title.toLowerCase();
      if (seen.has(key) || seen.has(headline)) continue;
      seen.add(key); seen.add(headline); items.push({ id: key, ...item });
      if (items.length >= PER_TOPIC) break;
    }
    return {
      topic: chosen.id, label: chosen.label, topics: topics.map(entry => ({ id: entry.id, label: entry.label })), items,
      sources: [...new Set(feeds.map(feed => feed.name))], failed: results.filter(result => result.entry.error).map(result => result.feed.name),
      updated: new Date(Math.max(0, ...results.map(result => result.entry.at))).toISOString(),
    };
  }

  // A few headlines from each topic, for the home panel.
  async function overview() {
    const { topics } = await config();
    const all = await Promise.all(topics.map(entry => topic(entry.id)));
    return { topics: all.map(entry => ({ id: entry.topic, label: entry.label, items: entry.items.slice(0, 5) })) };
  }

  return { file, config, topic, overview };
}
