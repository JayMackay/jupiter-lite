import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createNews, parseFeed, plain } from '../news.mjs';

const RSS = `<?xml version="1.0"?><rss><channel><title>Feed</title>
<item><title><![CDATA[Models get <b>faster</b> &amp; cheaper]]></title><link>https://example.com/a?utm=1</link><pubDate>Mon, 02 Nov 2026 09:00:00 GMT</pubDate>
<description><![CDATA[<p>Big <script>alert(1)</script>news &mdash; really.</p>]]></description></item>
<item><title>Older story</title><link>https://example.com/b</link><pubDate>Sun, 01 Nov 2026 09:00:00 GMT</pubDate></item>
<item><title>Bad link</title><link>javascript:alert(1)</link></item>
</channel></rss>`;
const ATOM = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Atom entry</title><link rel="alternate" href="https://atom.example/x"/><updated>2026-11-02T10:00:00Z</updated><summary>Short</summary></entry>
<entry><title>Models get faster &amp; cheaper</title><link href="https://example.com/a"/><updated>2026-11-02T08:00:00Z</updated></entry></feed>`;

test('feeds are reduced to plain text with safe links only', () => {
  const items = parseFeed(RSS, 'Example');
  assert.deepEqual(items.map(item => item.title), ['Models get faster & cheaper', 'Older story']);
  assert.equal(items[0].summary, 'Big news — really.');
  assert.equal(items[0].link, 'https://example.com/a?utm=1');
  assert.equal(items[0].published, '2026-11-02T09:00:00.000Z');
  assert.equal(parseFeed(ATOM, 'Atom')[0].link, 'https://atom.example/x');
  assert.equal(plain('<img src=x onerror=alert(1)>Hello &lt;b&gt;there&lt;/b&gt;'), 'Hello there');
});

test('a topic merges its feeds newest first, drops duplicates and keeps the last good headlines', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'jupiter-news-'));
  let down = false, calls = 0, clock = 0;
  const fetcher = async url => { calls++; if (down) throw new Error('offline'); return { ok: true, text: async () => url.includes('atom') ? ATOM : RSS }; };
  const news = createNews(repo, { fetcher, now: () => clock });
  const { writeFile, mkdir } = await import('node:fs/promises');
  await mkdir(path.join(repo, 'knowledge/news'), { recursive: true });
  await writeFile(path.join(repo, 'knowledge/news/feeds.json'), JSON.stringify({ topics: [{ id: 'ai', label: 'AI', feeds: [{ name: 'Example', url: 'https://example.com/rss' }, { name: 'Atom', url: 'https://example.com/atom' }] }] }));
  const ai = await news.topic('ai');
  assert.deepEqual(ai.items.map(item => item.title), ['Atom entry', 'Models get faster & cheaper', 'Older story']);
  assert.deepEqual(ai.failed, []);
  await news.topic('ai');
  assert.equal(calls, 2, 'cached for a while');
  down = true; clock += 21 * 60 * 1000;
  const stale = await news.topic('ai');
  assert.equal(stale.items.length, 3, 'a source that is down keeps its last headlines');
  assert.deepEqual(stale.failed, ['Example', 'Atom']);
});

test('the default sources are written on first use so they can be edited', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'jupiter-news-'));
  const news = createNews(repo, { fetcher: async () => ({ ok: false, status: 503, text: async () => '' }) });
  const result = await news.topic('uk');
  assert.equal(result.label, 'UK');
  assert.deepEqual(result.topics.map(topic => topic.id), ['ai', 'agentic', 'tech', 'uk', 'world', 'gaming', 'finance']);
  assert.match(await readFile(path.join(repo, 'knowledge/news/feeds.json'), 'utf8'), /feeds\.bbci\.co\.uk\/news\/uk/);
});

test('stories carry their best image, and a topic can gather matching stories from other topics', async () => {
  const feed = `<rss><channel>
<item><title>New coding agent ships</title><link>https://t.example/a</link><pubDate>Mon, 02 Nov 2026 09:00:00 GMT</pubDate><media:thumbnail url="https://ichef.bbci.co.uk/ace/standard/240/x.jpg" width="240"/><media:content url="https://img.example/big.jpg" medium="image" width="1200"/></item>
<item><title>Chip prices rise</title><link>https://t.example/b</link><pubDate>Mon, 02 Nov 2026 08:00:00 GMT</pubDate><description>&lt;img src="https://img.example/inline.png"&gt; text</description></item>
<item><title>Insecure image</title><link>https://t.example/c</link><enclosure url="http://img.example/x.jpg" type="image/jpeg"/></item>
</channel></rss>`;
  const { parseFeed } = await import('../news.mjs');
  const items = parseFeed(feed, 'T');
  assert.deepEqual(items.map(item => item.image ?? null), ['https://img.example/big.jpg', 'https://img.example/inline.png', null]);
  assert.equal(parseFeed(feed.replace(/<media:content[^>]*>/, ''), 'T')[0].image, 'https://ichef.bbci.co.uk/ace/standard/976/x.jpg', 'BBC thumbnails are upsized');
  const repo = await mkdtemp(path.join(os.tmpdir(), 'jupiter-news-'));
  const news = createNews(repo, { fetcher: async () => ({ ok: true, text: async () => feed }) });
  const agentic = await news.topic('agentic');
  assert.deepEqual(agentic.items.map(item => item.title), ['New coding agent ships']);
});
