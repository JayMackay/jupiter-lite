import { readFile, stat } from 'node:fs/promises';
import { watch } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { realFile, saveJson, sleep } from './util.mjs';
import { validateCard, cardText, CARD_MAX_BYTES } from './card-schema.mjs';

const execute = promisify(execFile);
export const localDay = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const brief = ({ id, title, description, status, category, created, updated, pinned, steps }) => ({ id, title, description, status, category, created, updated, pinned: !!pinned, steps: (steps || []).map(({ name }, index) => ({ name, index })) });
const invalid = message => Object.assign(new Error(message), { status: 400 });

// Removes <script> and <style> blocks in one pass. A lazy regex up to the closing
// tag rescans the rest of the text for every unclosed opening tag, which lets a
// report stall the service. An unclosed block hides the rest, as it does in a browser.
export function stripCodeBlocks(text) {
  const opening = /<(script|style)\b/gi, closing = { script: /<\/script>/gi, style: /<\/style>/gi };
  let result = '', kept = 0, match;
  while ((match = opening.exec(text))) {
    const tagEnd = text.indexOf('>', opening.lastIndex);
    if (tagEnd < 0) break;
    const close = closing[match[1].toLowerCase()];
    close.lastIndex = tagEnd + 1;
    result += text.slice(kept, match.index) + ' ';
    if (!close.exec(text)) return result;
    kept = opening.lastIndex = close.lastIndex;
  }
  return result + text.slice(kept);
}

// UI requests can only change card metadata, never report paths or contents.
export function metadataPatch(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.keys(value).length || Object.keys(value).some(key => !['status', 'category', 'pinned', 'title', 'description'].includes(key))) {
    throw invalid('Choose a title, description, status, category or pin change.');
  }
  return value;
}
export const TITLE_MAX = 200, DESCRIPTION_MAX = 2000, PAGE_REQUEST_MAX = 4000;
const pageTypes = /\.(html?|md|markdown|txt)$/i;
const safeFolder = folder => typeof folder === 'string' && folder && !/[\\/]|^\.\.?$/.test(folder);

// The brief a visible chat receives when someone asks for a change to one page.
export function pageEditBrief({ entity, step, relative, file, request }) {
  return [
    'Please edit one page in my Jupiter Workspace.', '',
    `Card: "${entity.title}" (id ${entity.id})`,
    ...(step ? [`Page: "${step.name}"`] : []),
    `File: ${relative}`,
    `Full path: ${file}`, '',
    '## What to change', '', request, '',
    '## Rules', '',
    '- Edit this file only. Do not create, rename or delete other files, and leave workspace/workspace.json unchanged.',
    '- Keep the page\'s existing style, structure, tone and formatting, and match how the rest of the page is written.',
    '- When you finish, tell me in one or two sentences what you changed.',
  ].join('\n');
}

export class Workspace {
  constructor(repo, changed = () => {}) { this.repo = repo; this.file = path.join(repo, 'workspace', 'workspace.json'); this.changed = changed; this.writes = Promise.resolve(); }
  async registry() {
    const registry = JSON.parse(await readFile(this.file, 'utf8'));
    if (!Array.isArray(registry.entities)) throw new Error('Workspace registry is not ready.');
    return registry;
  }
  async list({ query = '', date, status } = {}) {
    const { entities } = await this.registry();
    return entities.filter(item => (!query || `${item.id} ${item.title} ${item.description}`.toLowerCase().includes(query.toLowerCase())) && (!date || item.created === date || item.updated === date) && (!status || item.status === status)).map(brief);
  }
  async read(id, step = 0) {
    const entity = (await this.registry()).entities.find(item => item.id === id);
    if (!entity) throw new Error('Workspace card was not found.');
    const result = { ...brief(entity), text: '' };
    const selected = entity.steps?.[step];
    if (!selected) return result;
    const relative = path.join(entity.folder, selected.path.split('?')[0]);
    const { file } = await realFile(path.join(this.repo, 'workspace'), relative);
    if (selected.viewer === 'card' && file.endsWith('.card.json') && (await stat(file)).size <= CARD_MAX_BYTES) return { ...result, text: cardText(validateCard(JSON.parse(await readFile(file, 'utf8')))).slice(0, 12000) };
    if (!/\.(html?|md|txt)$/i.test(file) || (await stat(file)).size > 3 * 1024 * 1024) return { ...result, note: 'The card uses a visual or large report. Open it for the full content.' };
    const text = await readFile(file, 'utf8');
    result.text = stripCodeBlocks(text).replace(/<[^<>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim().slice(0, 12000);
    return result;
  }
  async activity(date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw new Error('Use a date in YYYY-MM-DD format.');
    const registry = await this.registry();
    const { stdout = '' } = await execute('git', ['log', `--since=${date}T00:00:00`, `--until=${date}T23:59:59`, '--format=%s', '--name-only', '--max-count=45', '--', 'workspace'], { cwd: this.repo, windowsHide: true, maxBuffer: 128 * 1024 }).catch(() => ({}));
    const lines = stdout.split(/\r?\n/).filter(Boolean);
    const paths = lines.filter(line => line.startsWith('workspace/'));
    const cards = registry.entities.filter(item => item.created === date || item.updated === date || paths.some(file => file.startsWith(`workspace/${item.folder}/`))).map(brief);
    return { date, cards, commits: [...new Set(lines.filter(line => !line.startsWith('workspace/')))].slice(0, 15), basis: 'Workspace dates and recorded Git changes; not a complete record of unsaved work.' };
  }
  update(id, patch) {
    const operation = this.writes.catch(() => {}).then(async () => {
      if (patch.status !== undefined && !['active', 'done', 'archived'].includes(patch.status)) throw invalid('Use active, done or archived status.');
      if (patch.pinned !== undefined && typeof patch.pinned !== 'boolean') throw invalid('Pinned must be true or false.');
      if (patch.category !== undefined && (typeof patch.category !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(patch.category))) throw invalid('Use a category with lowercase letters, numbers and hyphens.');
      const title = patch.title === undefined ? undefined : typeof patch.title === 'string' ? patch.title.trim() : null;
      if (title !== undefined && (!title || title.length > TITLE_MAX || /[\x00-\x1f\x7f]/.test(title))) throw invalid(`Enter a title of 1 to ${TITLE_MAX} characters.`);
      const description = patch.description === undefined ? undefined : typeof patch.description === 'string' ? patch.description.trim() : null;
      if (description !== undefined && (description === null || description.length > DESCRIPTION_MAX || /\x00/.test(description))) throw invalid(`Keep the description to ${DESCRIPTION_MAX.toLocaleString('en-US')} characters or fewer.`);
      if (patch.status === undefined && patch.pinned === undefined && patch.category === undefined && title === undefined && description === undefined) throw invalid('Choose a title, description, status, category or pin change.');
      for (let attempt = 0; attempt < 6; attempt++) {
        const source = await readFile(this.file, 'utf8');
        const registry = JSON.parse(source);
        const entity = registry.entities.find(item => item.id === id);
        if (!entity) throw Object.assign(new Error('Workspace card was not found.'), { status: 404 });
        if (patch.status !== undefined) entity.status = patch.status;
        if (patch.pinned !== undefined) entity.pinned = patch.pinned;
        if (patch.category !== undefined) entity.category = patch.category;
        if (title !== undefined) entity.title = title;
        if (description !== undefined) entity.description = description;
        entity.updated = localDay();
        // Preserve other agents' latest registry changes instead of saving a stale snapshot.
        if (await readFile(this.file, 'utf8') !== source) continue;
        try { await saveJson(this.file, registry, { beforeReplace: async () => {
          if (await readFile(this.file, 'utf8') !== source) throw Object.assign(new Error('Workspace changed while saving.'), { code: 'ESTALE' });
        } }); }
        catch (error) {
          // Windows indexers/readers can briefly lock atomic replacements. Retry
          // from a fresh registry so another agent's edits are still retained.
          if (!['EPERM', 'EACCES', 'EBUSY', 'ESTALE'].includes(error.code) || attempt === 5) throw error;
          await sleep(40 * (attempt + 1));
          continue;
        }
        this.changed();
        return brief(entity);
      }
      throw new Error('Workspace is being updated by another task. Try the change again.');
    });
    this.writes = operation;
    return operation;
  }

  // Checks a page edit request: the page must be a text page inside this card's own
  // folder. Returns the brief for the chat and starts watching the page, so an open
  // viewer reloads when the chat saves it.
  async editPage(id, { path: requested, request } = {}, pageChanged = () => {}) {
    const wanted = typeof request === 'string' ? request.trim() : '';
    if (!wanted || wanted.length > PAGE_REQUEST_MAX || /\x00/.test(wanted)) throw invalid(`Describe the change in 1 to ${PAGE_REQUEST_MAX.toLocaleString('en-US')} characters.`);
    const entity = (await this.registry()).entities.find(item => item.id === id);
    if (!entity) throw Object.assign(new Error('Workspace card was not found.'), { status: 404 });
    if (!safeFolder(entity.folder)) throw invalid('This card has no folder of its own to edit.');
    if (typeof requested !== 'string' || !requested || requested.length > 500 || /[\\\x00-\x1f]/.test(requested)) throw invalid('Choose a page from this card.');
    const prefix = `workspace/${entity.folder}/`;
    const inside = (requested.startsWith(prefix) ? requested.slice(prefix.length) : requested).split('?')[0].split('#')[0];
    if (!inside || path.isAbsolute(inside) || !pageTypes.test(inside)) throw invalid('Only HTML, Markdown and text pages can be edited this way.');
    const folder = path.join(path.dirname(this.file), entity.folder);
    const { file, info } = await realFile(folder, inside).catch(error => {
      throw error.status ? error : Object.assign(new Error('That page was not found in this card.'), { status: 404 });
    });
    if (!info.isFile()) throw invalid('Choose a page from this card.');
    // The viewer matches change events against the path it opened, so keep the requested spelling.
    const relative = `${prefix}${path.posix.normalize(inside)}`;
    const step = (entity.steps || []).find(item => typeof item.path === 'string' && item.path.split('?')[0] === inside);
    this.watchPage(file, relative, pageChanged);
    return { entity: brief(entity), relative, file, name: `Edit ${step?.name || entity.title}`.slice(0, 60), brief: pageEditBrief({ entity, step, relative, file, request: wanted }) };
  }
  watchPage(file, relative, pageChanged) {
    this.pageWatchers ??= new Map(); this.pageListeners ??= new Map();
    this.pageListeners.set(file, pageChanged);
    if (this.pageWatchers.has(file)) return;
    // A few pages at a time are enough. The oldest watch stops first.
    if (this.pageWatchers.size >= 20) { const [oldest, watcher] = this.pageWatchers.entries().next().value; watcher.close(); this.pageWatchers.delete(oldest); this.pageListeners.delete(oldest); }
    const name = path.basename(file);
    let timer;
    try {
      // Watch the folder, because editors often replace a file instead of writing into it.
      const watcher = watch(path.dirname(file), (event, changed) => {
        if (changed && changed !== name) return;
        clearTimeout(timer); timer = setTimeout(() => this.pageListeners.get(file)?.(relative), 150);
      });
      watcher.on('error', () => { watcher.close(); this.pageWatchers?.delete(file); });
      watcher.on('close', () => clearTimeout(timer));
      watcher.unref?.();
      this.pageWatchers.set(file, watcher);
    } catch { /* The viewer still reloads when it is opened again. */ }
  }
  close() {
    for (const watcher of this.pageWatchers?.values() || []) watcher.close();
    this.pageWatchers?.clear(); this.pageListeners?.clear();
  }

  // Takes a card off the board and returns its folder, which the caller sends to the
  // Recycle Bin, so a card thrown away by mistake can still be restored from there.
  remove(id) {
    const operation = this.writes.catch(() => {}).then(async () => {
      for (let attempt = 0; attempt < 6; attempt++) {
        const source = await readFile(this.file, 'utf8');
        const registry = JSON.parse(source);
        const entity = registry.entities.find(item => item.id === id);
        if (!entity) throw Object.assign(new Error('Workspace card was not found.'), { status: 404 });
        if (entity.pinned) throw invalid('Unpin this card before throwing it away.');
        const root = path.dirname(this.file);
        const folder = typeof entity.folder === 'string' && entity.folder && !/[\\/]|^\.\.?$/.test(entity.folder) ? path.join(root, entity.folder) : null;
        registry.entities = registry.entities.filter(item => item.id !== id);
        try { await saveJson(this.file, registry, { beforeReplace: async () => {
          if (await readFile(this.file, 'utf8') !== source) throw Object.assign(new Error('Workspace changed while saving.'), { code: 'ESTALE' });
        } }); }
        catch (error) {
          if (!['EPERM', 'EACCES', 'EBUSY', 'ESTALE'].includes(error.code) || attempt === 5) throw error;
          await sleep(40 * (attempt + 1));
          continue;
        }
        this.changed();
        return { id, title: entity.title, folder };
      }
      throw new Error('Workspace is being updated by another task. Try again.');
    });
    this.writes = operation;
    return operation;
  }
}
