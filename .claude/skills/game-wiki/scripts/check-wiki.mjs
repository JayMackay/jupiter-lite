#!/usr/bin/env node
// Validate a game wiki built from the standard template.
// Usage: node .agents/skills/game-wiki/scripts/check-wiki.mjs workspace/<folder>/wiki.html
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const attr = (tag, name) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];
const line = (html, index) => html.slice(0, index).split('\n').length;

export async function checkWiki(file) {
  const html = await readFile(file, 'utf8');
  const problems = [];
  const fail = (message, index) => problems.push(index === undefined ? message : `line ${line(html, index)}: ${message}`);
  const visible = html.replace(/<!--[\s\S]*?-->/g, comment => ' '.repeat(comment.length));

  if (!/<html[^>]*\sdata-jupiter-report="document"/.test(visible)) fail('The <html> element needs data-jupiter-report="document".');
  if (!visible.includes('href="../_shared/report.css"')) fail('Link ../_shared/report.css.');
  if (!visible.includes('src="../_shared/report.js"')) fail('Load ../_shared/report.js.');
  if (!visible.includes('.wiki-layout{') || visible.includes('__WIKI_CSS__')) fail('The wiki layout styles are missing: scaffold the wiki from the template.');
  for (const match of visible.matchAll(/\{\{[A-Z_]+\}\}/g)) fail(`Unreplaced template token ${match[0]}.`, match.index);
  for (const match of visible.matchAll(/<[a-z][^>]*\sdata-placeholder[\s>=]/gi)) fail('Placeholder content remains: replace it, or remove the element.', match.index);
  for (const match of visible.matchAll(/data:image\//g)) fail('Embedded base64 image: save it in media/ and link it instead.', match.index);

  const navIds = [...visible.matchAll(/<a\s[^>]*class="nav-link[^"]*"[^>]*>/g)].map(match => ({ id: attr(match[0], 'data-page'), index: match.index }));
  const articles = [...visible.matchAll(/<article\s[^>]*class="wiki-page"[^>]*>([\s\S]*?)<\/article>/g)].map(match => ({ tag: match[0].slice(0, match[0].indexOf('>') + 1), body: match[1], index: match.index, id: attr(match[0], 'data-page') }));
  if (!articles.length) fail('The wiki has no pages.');
  const pageIds = new Set();
  for (const article of articles) {
    if (!article.id) { fail('A page is missing data-page.', article.index); continue; }
    if (pageIds.has(article.id)) fail(`Duplicate page id "${article.id}".`, article.index);
    pageIds.add(article.id);
    for (const name of ['data-title', 'data-group']) if (!attr(article.tag, name)) fail(`Page "${article.id}" is missing ${name}.`, article.index);
    if (!/<h1>[\s\S]*?\S[\s\S]*?<\/h1>/.test(article.body)) fail(`Page "${article.id}" needs an <h1>.`, article.index);
    if (!/class="page-intro"/.test(article.body)) fail(`Page "${article.id}" needs a .page-intro paragraph.`, article.index);
    if (!/class="page-footer"/.test(article.body)) fail(`Page "${article.id}" needs a .page-footer.`, article.index);
  }
  if (articles[0]?.id && articles[0].id !== 'overview') fail('The first page must be "overview".');
  const navSet = new Set(navIds.map(item => item.id));
  for (const item of navIds) if (!pageIds.has(item.id)) fail(`Navigation links to missing page "${item.id}".`, item.index);
  for (const id of pageIds) if (!navSet.has(id)) fail(`Page "${id}" has no navigation link.`);

  let data;
  const json = /<script type="application\/json" id="wiki-data">([\s\S]*?)<\/script>/.exec(visible);
  if (!json) fail('The wiki-data script is missing.');
  else {
    try { data = JSON.parse(json[1]); } catch (error) { fail(`wiki-data is not valid JSON: ${error.message}`, json.index); }
  }
  const sourceIds = new Set();
  if (data) {
    if (typeof data.title !== 'string' || !data.title.trim()) fail('wiki-data needs a "title".');
    if (!Array.isArray(data.sources)) fail('wiki-data "sources" must be a list.');
    else for (const source of data.sources) {
      if (!source || !/^[a-z0-9][a-z0-9-]*$/.test(source.id || '')) { fail(`Source ids must be lowercase words joined by hyphens (got "${source?.id}").`); continue; }
      if (sourceIds.has(source.id)) fail(`Duplicate source id "${source.id}".`);
      sourceIds.add(source.id);
      if (!source.title || typeof source.text !== 'string' || !source.text.trim()) fail(`Source "${source.id}" needs a title and a text snapshot.`);
    }
    if (!data.concepts || typeof data.concepts !== 'object' || Array.isArray(data.concepts)) fail('wiki-data "concepts" must be an object keyed by page id.');
    else for (const [page, links] of Object.entries(data.concepts)) {
      if (!pageIds.has(page)) fail(`Concepts are listed for missing page "${page}".`);
      if (!Array.isArray(links)) { fail(`Concepts for "${page}" must be a list.`); continue; }
      for (const link of links) {
        if (!Array.isArray(link) || link.length !== 3 || link.some(value => typeof value !== 'string')) { fail(`Concept entries for "${page}" must be [title, status, route].`); continue; }
        checkRoute(link[2], `Concept "${link[0]}"`);
      }
    }
  }

  function checkRoute(route, label, index) {
    const [page, anchor] = decodeURIComponent(route).split('/');
    if (!pageIds.has(page)) return fail(`${label} links to missing page "#${route}".`, index);
    if (page === 'sources' && anchor && !sourceIds.has(anchor)) fail(`${label} links to missing source "${anchor}".`, index);
  }
  for (const match of visible.matchAll(/\shref="#([^"]+)"/g)) checkRoute(match[1], 'A link', match.index);

  const folder = path.dirname(path.resolve(file));
  for (const match of visible.matchAll(/<img\s[^>]*>/g)) {
    const src = attr(match[0], 'src');
    if (!attr(match[0], 'alt')) fail('Every image needs meaningful alt text.', match.index);
    if (!src) { fail('An image has no src.', match.index); continue; }
    if (/^(?:https?:|data:)/.test(src)) continue;
    const target = path.resolve(folder, decodeURIComponent(src.split(/[?#]/)[0]));
    if (!target.startsWith(folder + path.sep)) fail(`Image "${src}" must live inside the card folder.`, match.index);
    else if (!await access(target).then(() => true, () => false)) fail(`Image "${src}" does not exist.`, match.index);
  }
  return { ok: problems.length === 0, problems, pages: pageIds.size, sources: sourceIds.size };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const file = process.argv[2];
  if (!file) { console.error('Usage: node check-wiki.mjs <path to wiki.html>'); process.exit(2); }
  const result = await checkWiki(file).catch(error => ({ ok: false, problems: [error.message] }));
  if (result.ok) console.log(`Wiki passed: ${result.pages} pages, ${result.sources} sources.`);
  else { console.error(`Wiki has ${result.problems.length} problem(s):\n- ${result.problems.join('\n- ')}`); process.exitCode = 1; }
}
