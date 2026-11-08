import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWiki, slugify } from '../new-wiki.mjs';
import { checkWiki } from '../check-wiki.mjs';

const template = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../assets/wiki-template.html');
const date = new Date('2026-11-08T12:00:00Z');

async function repo() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'game-wiki-'));
  await mkdir(path.join(root, 'workspace'), { recursive: true });
  await writeFile(path.join(root, 'workspace', 'workspace.json'), JSON.stringify({ entities: [{ id: 'existing', title: 'Existing' }] }, null, 2));
  return root;
}
const fill = html => html.replace(/\sdata-placeholder(?=[\s>])/g, '');
const setData = (html, data) => html.replace(/(<script type="application\/json" id="wiki-data">)[\s\S]*?(<\/script>)/, (_, open, close) => `${open}\n${JSON.stringify(data).replace(/</g, '\\u003c')}\n${close}`);

test('the template is generic and uses the shared Jupiter report system', async () => {
  const html = await readFile(template, 'utf8');
  assert.doesNotMatch(html, /\bmak\b|mrmak|--mak-|beneath.the.pale|neardark/i);
  assert.match(html, /data-jupiter-report="document"/);
  assert.match(html, /\.\.\/_shared\/report\.css/);
  assert.match(html, /\.\.\/_shared\/report\.js/);
  assert.doesNotMatch(html, /__WIKI_CSS__/, 'the wiki layout CSS must be inlined');
  for (const rule of ['.wiki-layout{', '.sidebar{', '.concept-rail{', '.layer-grid{', '.region{', '.source-document{']) assert.ok(html.includes(rule), `missing CSS rule ${rule}`);
});

test('scaffolding creates the card, escapes the title and registers it', async () => {
  const root = await repo();
  const result = await createWiki({ repo: root, title: 'Moss & Ember</script>', tagline: 'A <small> world', date, suffix: 'abcd1234' });
  assert.equal(result.id, 'moss-ember-script-wiki-abcd1234');
  assert.equal(result.folder, '2026-11-08_moss-ember-script-wiki-abcd1234');
  assert.equal(result.link, '[Moss & Ember</script> · Game Wiki](#/moss-ember-script-wiki-abcd1234)');
  const html = await readFile(result.file, 'utf8');
  assert.match(html, /<h1>Moss &amp; Ember&lt;\/script&gt;<\/h1>/);
  assert.match(html, /<p class="page-intro">A &lt;small&gt; world<\/p>/);
  assert.match(html, /Updated 8 November 2026/);
  const data = JSON.parse(/id="wiki-data">([\s\S]*?)<\/script>/.exec(html)[1]);
  assert.equal(data.title, 'Moss & Ember</script>');
  const { entities } = JSON.parse(await readFile(path.join(root, 'workspace', 'workspace.json'), 'utf8'));
  assert.deepEqual(entities.map(entity => entity.id), ['existing', result.id]);
  assert.deepEqual(entities[1], { id: result.id, title: 'Moss & Ember</script> · Game Wiki', description: 'The Moss & Ember</script> game wiki: world, design, development and sources.', type: 'standalone', category: 'dev', created: '2026-11-08', updated: '2026-11-08', folder: result.folder, steps: [{ name: 'Game Wiki', path: 'wiki.html' }], defaultStep: 0, status: 'active', pinned: false });
});

test('scaffolding rejects an empty title and never overwrites a card', async () => {
  const root = await repo();
  await assert.rejects(createWiki({ repo: root, title: '   ', date }), /title is required/);
  await createWiki({ repo: root, title: 'Twice', date, suffix: '00000000' });
  await assert.rejects(createWiki({ repo: root, title: 'Twice', date, suffix: '00000000' }), /already exists/);
  assert.equal(slugify('Ünïcode  Quest!'), 'unicode-quest');
});

test('a fresh scaffold only fails on unfilled placeholders', async () => {
  const root = await repo();
  const { file } = await createWiki({ repo: root, title: 'Hollow Lantern', date, suffix: '11111111' });
  const result = await checkWiki(file);
  assert.equal(result.ok, false);
  assert.ok(result.problems.length > 0);
  assert.ok(result.problems.every(problem => /Placeholder content remains/.test(problem)), result.problems.join('\n'));
  assert.equal(result.pages, 16);
});

test('a filled wiki with sources, concepts and a local image passes', async () => {
  const root = await repo();
  const { file } = await createWiki({ repo: root, title: 'Hollow Lantern', date, suffix: '22222222' });
  await writeFile(path.join(path.dirname(file), 'media', 'camp.png'), 'png');
  let html = fill(await readFile(file, 'utf8'));
  html = html.replace('<section class="content-block"><h2>References</h2>', '<figure class="art-figure"><img src="media/camp.png" alt="Camp study" loading="lazy"><figcaption>Study.</figcaption></figure><p class="source-line">Sources: <a href="#sources/combat">Combat</a></p>$&');
  html = setData(html, { title: 'Hollow Lantern', concepts: { mechanics: [['Grapple', 'Proposal', 'ideas']] }, sources: [{ id: 'combat', title: 'Combat', kind: 'Brainstorm board', path: 'knowledge/boards/combat.md', text: '# Combat\n- Grapple <\/script> safe' }] });
  await writeFile(file, html);
  const result = await checkWiki(file);
  assert.deepEqual(result.problems, []);
  assert.equal(result.sources, 1);
});

test('broken navigation, data, routes and images are reported', async () => {
  const root = await repo();
  const { file } = await createWiki({ repo: root, title: 'Hollow Lantern', date, suffix: '33333333' });
  let html = fill(await readFile(file, 'utf8'));
  html = html.replace('<a class="nav-link" data-page="audio" href="#audio">', '<a class="nav-link" data-page="sound" href="#sound">');
  html = html.replace('<section class="content-block"><h2>References</h2>', '<img src="media/missing.png" alt="Missing"><img src="data:image/png;base64,AAAA" alt="Inline"><a href="#sources/nowhere">x</a>$&');
  await writeFile(file, setData(html, { title: 'Hollow Lantern', concepts: { gone: [] }, sources: [] }));
  const problems = (await checkWiki(file)).problems.join('\n');
  assert.match(problems, /Navigation links to missing page "sound"/);
  assert.match(problems, /Page "audio" has no navigation link/);
  assert.match(problems, /Image "media\/missing.png" does not exist/);
  assert.match(problems, /Embedded base64 image/);
  assert.match(problems, /missing source "nowhere"/);
  assert.match(problems, /Concepts are listed for missing page "gone"/);
  await writeFile(file, html.replaceAll('.wiki-layout{', '.removed{'));
  assert.match((await checkWiki(file)).problems.join('\n'), /wiki layout styles are missing/);
  await writeFile(file, html.replace(/(id="wiki-data">)[\s\S]*?(<\/script>)/, '$1{broken$2'));
  assert.match((await checkWiki(file)).problems.join('\n'), /wiki-data is not valid JSON/);
});
