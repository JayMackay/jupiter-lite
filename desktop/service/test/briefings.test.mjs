// Spoken weather, news and project maps.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createWeather, describeNews, matchProjectScan, scanBrief, NEWS_ASK, WEATHER_ASK } from '../briefings.mjs';

const hours = (date, values) => ({
  time: Array.from({ length: 24 }, (_, h) => `${date}T${String(h).padStart(2, '0')}:00`),
  precipitation_probability: Array.from({ length: 24 }, (_, h) => values[h]?.chance ?? 5),
  temperature_2m: Array(24).fill(5), weather_code: Array.from({ length: 24 }, (_, h) => values[h]?.code ?? 3),
});

test('the weather answer sounds natural: temperature, how it feels, coat and umbrella advice', async () => {
  const calls = [];
  const fetcher = async url => { calls.push(url); return { ok: true, json: async () => ({
    current: { time: '2026-11-02T09:00', temperature_2m: 5.2, apparent_temperature: 1.6, weather_code: 3, wind_speed_10m: 12, precipitation: 0 },
    hourly: hours('2026-11-02', { 16: { chance: 80, code: 61 } }),
    daily: { weather_code: [3, 61], temperature_2m_max: [7, 9], temperature_2m_min: [2, 4], precipitation_probability_max: [80, 70] },
  }) }; };
  const weather = createWeather({ fetcher, now: () => new Date('2026-11-02T09:00:00Z') });
  const now = await weather.describe("what's the weather Jupiter");
  assert.match(now, /5 degrees/); assert.match(now, /London/); assert.match(now, /freezing, boss/);
  assert.match(now, /4 this afternoon/); assert.match(now, /umbrella/); assert.match(now, /coat/);
  assert.match(calls[0], /api\.open-meteo\.com\/v1\/forecast\?latitude=51\.5072/);
  const tomorrow = await weather.describe('will it rain tomorrow');
  assert.match(tomorrow, /^Tomorrow in London: raining, 4 to 9 degrees\. There's a 70 percent chance of rain/);
  assert.equal(calls.length, 1, 'the forecast is reused for ten minutes');
  assert.ok(WEATHER_ASK.test("what's the weather like today") && WEATHER_ASK.test('do I need a coat') && !WEATHER_ASK.test('open my to do list'));
});

test('news is read as a sentence per headline from the right topic', async () => {
  const items = id => [1, 2, 3, 4].map(n => ({ title: `${id} story ${n} | Site`, source: `Source ${n}` }));
  const news = { topic: async id => ({ label: { tech: 'Tech', uk: 'UK', world: 'World', ai: 'AI' }[id], items: items(id) }) };
  const top = await describeNews(news, "what's the top story in tech");
  assert.equal(top.text, 'Top story in Tech, from Source 1: tech story 1. Want me to open it?');
  const latest = await describeNews(news, 'latest AI news');
  assert.match(latest.text, /^Here's the latest in AI\. First, from Source 1: ai story 1\. Next, from Source 2: ai story 2\. And, from Source 3: ai story 3\./);
  const mix = await describeNews(news, "what's the news");
  assert.match(mix.text, /^At home, uk story 1\. Around the world, world story 1\. In AI, ai story 1\./);
  assert.ok(NEWS_ASK.test('any headlines') && NEWS_ASK.test("what's the top story in tech currently"));
  for (const phrase of ['Top story in AI', 'biggest story in finance', 'the top story in gaming', 'Tell me the news in AI', 'Latest AI news', 'any agentic news', 'headlines in world', 'news in finance', "what's new in tech", 'latest on crypto', "What's the news", 'Any news', 'any headlines', "what's happening today"])
    assert.ok(NEWS_ASK.test(phrase), phrase);
  for (const phrase of ["What's the weather", "What's the weather today", "what's the forecast", 'how cold is it', 'is it cold', 'is it sunny', "what's the temperature", 'Do I need a coat', 'Do I need an umbrella', 'will it rain', 'is it raining', 'rain later', 'Will it rain tomorrow', 'forecast for tomorrow', "What's the weather in Manchester"])
    assert.ok(WEATHER_ASK.test(phrase), phrase);
  // It doesn't have to be precise.
  const asked = [];
  const any = { topic: async id => { asked.push(id); return { label: id, items: items(id) }; } };
  for (const [question, topic] of [['hey jupiter what is happening in gaming today', 'gaming'], ["what's going on in the markets", 'finance'], ['can you tell me the news in agentic', 'agentic'], ['catch me up on world news', 'world'], ["anything new in video games", 'gaming']]) {
    assert.ok(NEWS_ASK.test(question), question);
    asked.length = 0; await describeNews(any, question);
    assert.deepEqual(asked, [topic], question);
  }
});

test('"scan test", "map my test project" and "read test again" find the folder in projects', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'jupiter-scan-'));
  await mkdir(path.join(repo, 'projects', 'test'), { recursive: true });
  await mkdir(path.join(repo, 'projects', 'Dream Game'), { recursive: true });
  assert.equal((await matchProjectScan(repo, 'Jupiter scan test')).project.name, 'test');
  assert.equal((await matchProjectScan(repo, 'can you map my "Dream Game" project')).project.name, 'Dream Game');
  const again = await matchProjectScan(repo, 'Jupiter can you read test again');
  assert.equal(again.update, true);
  assert.equal((await matchProjectScan(repo, 'update the dream game project')).update, true);
  assert.equal(await matchProjectScan(repo, 'read the news'), null, 'only real project folders count');
  // The phrasings in the Jupiter Voice Commands guide.
  for (const phrase of ['Jupiter, scan Dream Game', 'Map Dream Game', 'can you map my Dream Game project', 'map out the Dream Game folder', 'index Dream Game', 'could you scan the Dream Game repo', 'scan dream'])
    assert.equal((await matchProjectScan(repo, phrase))?.update, false, phrase);
  for (const phrase of ['Read Dream Game again', 'Can you read Dream Game again to update', 'reread Dream Game', 'update the Dream Game project', 'refresh Dream Game', 'rescan Dream Game', 'remap Dream Game'])
    assert.equal((await matchProjectScan(repo, phrase))?.update, true, phrase);
  const brief = await scanBrief(repo, again.project, { update: true });
  assert.match(brief, /graphify/); assert.match(brief, /update mode/); assert.match(brief, /PROJECT_MAP\.md/); assert.match(brief, /repomix MCP with its secret scan on/);
  assert.ok(brief.includes(path.join(repo, 'projects', 'test')) && brief.includes(path.join(repo, 'knowledge')));
});
