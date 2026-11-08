// Jupiter's capability manager: the chosen Harness, Skills, Memory, Tools and Token Bill
// picks, installed through each agent's own mechanism and pinned to what you reviewed.
//
// Flow: review(id) pins a commit (or package version), fetches exactly that code and lists
// what it would add: hooks, MCP servers, skills, commands and install scripts. install(id)
// only runs with the token from that review, so the code that runs is the code you saw.
// Every change is recorded in knowledge/capabilities.lock.json so remove() can undo it.
// Nothing here runs on start-up; every install and removal is a user action.
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { cp, lstat, mkdir, readFile, readdir, readlink, rm, stat, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { commandPath } from './agents.mjs';
import { readJson, saveJson } from './util.mjs';

const isWindows = process.platform === 'win32';
const REVIEW_TTL = 30 * 60 * 1000;
const MARKER = '.jupiter-capability.json';
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const SAFE_PACKAGE = /^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const SAFE_VERSION = /^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$/;
const SHA = /^[0-9a-f]{40}$/;
const SCRIPT_FILES = /\.(sh|bash|ps1|psm1|bat|cmd|exe|dll|so|dylib|py|js|mjs|cjs|ts)$/i;
const INSTALL_SCRIPTS = ['preinstall', 'install', 'postinstall', 'prepare'];
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const hookSignatures = hooks => (hooks || []).map(hook => `${hook.event} ${hook.matcher} ${hook.command}`).sort();
const exists = async file => { try { await stat(file); return true; } catch { return false; } };
const pathKey = value => { const resolved = path.resolve(value); return isWindows ? resolved.toLowerCase() : resolved; };

// Runs a program without a shell. Windows .cmd shims (npm, npx) go through cmd.exe with
// arguments the catalogue and the checks above have already restricted to safe characters.
export function runCommand(file, args, { cwd, timeout = 10 * 60 * 1000, env = process.env } = {}) {
  const shim = isWindows && /^(npm|npx)$/i.test(file);
  const program = shim ? (env.ComSpec || 'cmd.exe') : file;
  const argv = shim ? ['/d', '/c', file, ...args] : args;
  return new Promise((resolve, reject) => execFile(program, argv, { cwd, timeout, env, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
    if (error) reject(Object.assign(new Error(String(stderr || stdout || error.message).trim().split(/\r?\n/).slice(-6).join('\n') || error.message), { status: 502 }));
    else resolve({ stdout: String(stdout), stderr: String(stderr) });
  }));
}

// --- reading what a pinned checkout contains -------------------------------------------------

async function readJsonFile(file) { try { return JSON.parse((await readFile(file, 'utf8')).replace(/^﻿/, '')); } catch { return null; } }

async function walk(root, visit, depth = 0, limit = { files: 0 }) {
  if (depth > 6 || limit.files > 6000) return;
  let entries; try { entries = await readdir(root, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) await walk(full, visit, depth + 1, limit);
    else if (entry.isFile()) { limit.files++; await visit(full, entry.name); }
  }
}

const hookList = (hooks, owner) => Object.entries(hooks && typeof hooks === 'object' ? hooks : {}).flatMap(([event, groups]) =>
  (Array.isArray(groups) ? groups : []).flatMap(group => (Array.isArray(group?.hooks) ? group.hooks : [group]).map(hook => ({
    owner, event, matcher: group?.matcher || '', command: String(hook?.command || hook?.prompt || hook?.url || hook?.type || '').slice(0, 300),
  }))));

// Lists everything a checkout would add, for the review screen. Reads files only.
export async function inspectCheckout(root) {
  const found = { plugins: [], hooks: [], mcpServers: [], skills: [], commands: 0, agents: 0, statusLine: [], installScripts: [], scripts: 0, outside: [], files: 0 };
  const rel = file => path.relative(root, file).replaceAll('\\', '/');
  const marketplace = await readJsonFile(path.join(root, '.claude-plugin/marketplace.json'));
  if (marketplace) for (const plugin of Array.isArray(marketplace.plugins) ? marketplace.plugins : []) {
    const source = plugin?.source;
    const local = typeof source === 'string' && (source.startsWith('./') || source === '.');
    found.plugins.push({ name: String(plugin?.name || ''), source: typeof source === 'string' ? source : JSON.stringify(source) });
    // A plugin whose source is another repository is not covered by this pin.
    if (!local) found.outside.push(`${plugin?.name}: ${typeof source === 'string' ? source : source?.repo || source?.url || source?.package || JSON.stringify(source)}`);
    if (plugin?.hooks && typeof plugin.hooks === 'object') found.hooks.push(...hookList(plugin.hooks.hooks || plugin.hooks, plugin.name));
    if (plugin?.mcpServers && typeof plugin.mcpServers === 'object') for (const [name, server] of Object.entries(plugin.mcpServers)) found.mcpServers.push({ name, command: [server?.command, ...(server?.args || [])].filter(Boolean).join(' ') || server?.url || '' });
  }
  await walk(root, async (file, name) => {
    found.files++;
    const relative = rel(file);
    if (SCRIPT_FILES.test(name)) found.scripts++;
    if (name === 'SKILL.md') found.skills.push({ name: path.basename(path.dirname(file)), path: rel(path.dirname(file)) });
    else if (name === 'hooks.json' && /(^|\/)hooks\/hooks\.json$/.test(relative)) { const data = await readJsonFile(file); found.hooks.push(...hookList(data?.hooks || data, relative.split('/').slice(-3, -2)[0] || relative)); }
    else if (name === 'plugin.json' && relative.endsWith('.claude-plugin/plugin.json')) {
      const data = await readJsonFile(file);
      if (data?.hooks && typeof data.hooks === 'object') found.hooks.push(...hookList(data.hooks.hooks || data.hooks, data.name));
      if (data?.mcpServers && typeof data.mcpServers === 'object') for (const [server, config] of Object.entries(data.mcpServers)) found.mcpServers.push({ name: server, command: [config?.command, ...(config?.args || [])].filter(Boolean).join(' ') || config?.url || '' });
    } else if (name === '.mcp.json') { const data = await readJsonFile(file); for (const [server, config] of Object.entries(data?.mcpServers || {})) found.mcpServers.push({ name: server, command: [config?.command, ...(config?.args || [])].filter(Boolean).join(' ') || config?.url || '' }); }
    else if (name === 'settings.json' && relative.includes('.claude')) { const data = await readJsonFile(file); found.hooks.push(...hookList(data?.hooks, relative)); if (data?.statusLine) found.statusLine.push(relative); }
    else if (name === 'package.json') { const data = await readJsonFile(file); for (const script of INSTALL_SCRIPTS) if (data?.scripts?.[script]) found.installScripts.push(`${relative} ${script}: ${String(data.scripts[script]).slice(0, 200)}`); }
    else if (name.endsWith('.md') && /(^|\/)commands\//.test(relative)) found.commands++;
    else if (name.endsWith('.md') && /(^|\/)agents\//.test(relative)) found.agents++;
  });
  const seen = new Set();
  found.hooks = found.hooks.filter(hook => { const key = JSON.stringify(hook); if (seen.has(key)) return false; seen.add(key); return true; });
  return found;
}

// --- Codex config.toml edits: plain text, so the user's comments and layout survive --------

const tomlString = value => JSON.stringify(String(value));
const tableHeader = name => `[mcp_servers.${/^[A-Za-z0-9_-]+$/.test(name) ? name : tomlString(name)}]`;
export function addEnvVars(text, name, vars) {
  if (!vars.length) return text;
  const lines = text.split(/\r?\n/); const header = tableHeader(name);
  const start = lines.findIndex(line => line.trim() === header);
  if (start < 0) throw fail(`Codex did not record ${name} in its settings.`, 502);
  let end = start + 1; while (end < lines.length && !/^\s*\[/.test(lines[end])) end++;
  if (lines.slice(start + 1, end).some(line => /^\s*env_vars\s*=/.test(line))) return text;
  lines.splice(start + 1, 0, `env_vars = [${vars.map(tomlString).join(', ')}]`);
  return lines.join('\n');
}
export function addCodexBlock(text, id, name, command, args, vars) {
  const header = tableHeader(name);
  if (text.split(/\r?\n/).some(line => line.trim() === header || line.trim().startsWith(`${header.slice(0, -1)}.`))) throw fail(`This project's Codex settings already have a server called ${name}.`, 409);
  const block = [`# Added by Jupiter (capability ${id}). Remove it from Jupiter's Capabilities view.`, header, `command = ${tomlString(command)}`, `args = [${args.map(tomlString).join(', ')}]`, ...(vars.length ? [`env_vars = [${vars.map(tomlString).join(', ')}]`] : [])];
  return `${text.replace(/\s*$/, '')}${text.trim() ? '\n\n' : ''}${block.join('\n')}\n`;
}
export function removeCodexBlock(text, id, name) {
  const lines = text.split(/\r?\n/); const header = tableHeader(name);
  const start = lines.findIndex((line, index) => line.trim() === header && lines[index - 1]?.includes(`(capability ${id})`));
  if (start < 0) return text;
  let end = start + 1; while (end < lines.length && !/^\s*(\[|# Added by Jupiter)/.test(lines[end])) end++;
  lines.splice(start - 1, end - start + 1);
  return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}

async function defaultFetchJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30 * 1000), headers: { Accept: 'application/json' } });
  if (!response.ok) throw fail(`${new URL(url).host} answered ${response.status}.`, 502);
  return response.json();
}

// "*" means every folder with a SKILL.md directly under `from`.
async function skillFolders(root, from, names) {
  if (!names.includes('*')) return names;
  const base = path.join(root, from || '');
  const found = [];
  for (const entry of await readdir(base, { withFileTypes: true }).catch(() => [])) if (entry.isDirectory() && SAFE_NAME.test(entry.name) && await exists(path.join(base, entry.name, 'SKILL.md'))) found.push(entry.name);
  return found.sort();
}

// --- card tags -------------------------------------------------------------------------------
// A card shows at most five tags, in this order: how it connects (labels.type, e.g. MCP, CLI,
// Skill), what it does (labels.does, most useful first), then an agent tag only when it works
// with just one of Claude Code and Codex. Agent support is never a label: it comes from the
// catalogue's verified agentSupport plus where Jupiter actually finds the tool configured.

export const MAX_TAGS = 5;
const TYPE_TAG = { plugin: 'Plugin', skills: 'Skill', mcp: 'MCP', 'npm-cli': 'CLI', 'uv-tool': 'CLI' };
const AGENT_TAG = { claude: 'Claude Code', codex: 'Codex' };

/** Agents a capability works with: verified in the catalogue, or found configured on this PC. */
export function agentSupport(item, found = []) {
  const agents = new Set((item.agentSupport || []).filter(agent => AGENT_TAG[agent]));
  for (const where of found) {
    if (/^Claude Code\b/.test(where)) agents.add('claude');
    else if (/^Codex\b/.test(where)) agents.add('codex');
    else if (/ command$/.test(where)) { agents.add('claude'); agents.add('codex'); } // a command on PATH works from either
  }
  return ['claude', 'codex'].filter(agent => agents.has(agent));
}

/** The tags a card shows. */
export function cardTags(item, agents) {
  const types = item.labels?.type?.length ? item.labels.type : [TYPE_TAG[item.setup?.kind] || (item.detect?.mcp ? 'MCP' : '')].filter(Boolean);
  const only = agents.length === 1 ? AGENT_TAG[agents[0]] : null;
  const room = MAX_TAGS - (only ? 1 : 0), seen = new Set(), tags = [];
  for (const tag of [...types, ...(item.labels?.does || [])]) {
    const key = String(tag).trim().toLowerCase();
    if (!key || seen.has(key) || tags.length >= room) continue;
    seen.add(key); tags.push(String(tag).trim());
  }
  return only ? [...tags, only] : tags;
}

// --- the manager -----------------------------------------------------------------------------

export class Capabilities {
  constructor({ repo, stateDir, home = os.homedir(), env = process.env, run = runCommand, which = name => commandPath(name, env), fetchJson = defaultFetchJson, connections, projects = async () => [], catalogFile } = {}) {
    Object.assign(this, { repo, home, env, run, which, fetchJson, connections, projects });
    this.catalogFile = catalogFile || path.join(repo, 'knowledge/capabilities.json');
    this.lockFile = path.join(repo, 'knowledge/capabilities.lock.json');
    this.sources = path.join(stateDir || path.join(repo, '.jupiter'), 'capabilities');
    // Shared tools: a stable link to a pinned checkout, so every agent and project runs one copy.
    this.toolsDir = path.join(stateDir || path.join(repo, '.jupiter'), 'tools');
    this.claudeHome = env.CLAUDE_CONFIG_DIR || path.join(home, '.claude');
    this.codexHome = env.CODEX_HOME || path.join(home, '.codex');
    this.skillDirs = { claude: path.join(this.claudeHome, 'skills'), codex: path.join(home, '.agents/skills') };
    this.reviews = new Map(); this.queue = Promise.resolve();
  }

  async catalog() {
    const data = await readJsonFile(this.catalogFile);
    if (!data || !Array.isArray(data.items)) throw fail('knowledge/capabilities.json is missing or not valid JSON.', 500);
    return data;
  }
  async item(id) {
    const item = (await this.catalog()).items.find(entry => entry.id === id);
    if (!item) throw fail('That capability is not in the catalogue.', 404);
    return item;
  }
  async lock() { const data = await readJson(this.lockFile, null); return data && typeof data.installed === 'object' ? data : { version: 1, installed: {} }; }
  async saveLock(lock) { await saveJson(this.lockFile, lock); }

  // One install or removal at a time: they edit the same agent settings files.
  serial(task) { const next = this.queue.catch(() => {}).then(task); this.queue = next; return next; }

  async claudePlugins() {
    const data = await readJsonFile(path.join(this.claudeHome, 'plugins/installed_plugins.json'));
    return new Set(Object.keys(data?.plugins || {}));
  }

  // What is on this computer now, whoever installed it.
  async detect(item, context, installed = null) {
    const setup = item.setup || {}; const where = [];
    if (setup.kind === 'plugin') for (const plugin of setup.plugins || []) if (context.plugins.has(`${plugin}@${setup.marketplace}`)) where.push(`Claude Code plugin ${plugin}`);
    if (setup.kind === 'skills' || setup.codexSkills) for (const [agent, folder] of Object.entries(this.skillDirs)) {
      const listed = setup.kind === 'skills' ? setup.names || [] : setup.codexSkills?.names || [];
      // A "*" list is resolved at review time, so use the folders the install recorded.
      const names = listed.includes('*') ? [...new Set((installed?.actions || []).filter(action => action.type === 'skill' && action.agent === agent).map(action => path.basename(action.path)))] : listed;
      if (agent === 'claude' && setup.kind !== 'skills') continue;
      const present = []; for (const name of names) if (await exists(path.join(folder, name, 'SKILL.md'))) present.push(name);
      if (present.length) where.push(`${agent === 'claude' ? 'Claude Code' : 'Codex'} skills: ${present.join(', ')}`);
    }
    if (setup.kind === 'mcp' || item.detect?.mcp) {
      const names = new Set([setup.server, ...(item.detect?.mcp || [])].filter(Boolean).map(name => name.toLowerCase()));
      for (const server of context.servers) if (names.has(String(server.name).toLowerCase())) where.push(`${server.client === 'claude' ? 'Claude Code' : server.client === 'codex' ? 'Codex' : server.client} · ${server.where}`);
    }
    if (item.detect?.marketplace && context.marketplaces.has(item.detect.marketplace)) where.push(`Claude Code marketplace ${item.detect.marketplace}`);
    for (const bin of [setup.bin, ...(item.detect?.bins || [])].filter(Boolean)) if (this.which(bin)) where.push(`${bin} command`);
    return [...new Set(where)];
  }

  async list() {
    const [catalog, lock, plugins, marketplaces, overview, projectList] = await Promise.all([this.catalog(), this.lock(), this.claudePlugins(), readJsonFile(path.join(this.claudeHome, 'plugins/known_marketplaces.json')).then(data => new Set(Object.keys(data || {}))), this.connections?.overview().catch(() => null), this.projects().catch(() => [])]);
    const servers = overview ? [...overview.everywhere.map(server => ({ ...server, where: 'everywhere' })), ...overview.projects.flatMap(project => project.servers.map(server => ({ ...server, where: project.name })))] : [];
    const context = { plugins, marketplaces, servers };
    const items = await Promise.all(catalog.items.map(async item => {
      const installed = lock.installed[item.id] || null;
      const found = await this.detect(item, context, installed);
      const state = installed ? 'installed' : found.length ? 'present' : item.status === 'take' ? (item.setup?.kind === 'manual' ? 'manual' : 'available') : item.status;
      // Names of required keys that aren't set; values are never read into the list.
      const missingEnv = [...(item.setup?.env || []), ...(item.setup?.headerEnv ? [item.setup.headerEnv] : [])].filter(name => !this.env[name]);
      const agents = agentSupport(item, found);
      return { ...item, state, found, missingEnv, agentSupport: agents, cardTags: cardTags(item, agents), installed: installed && { commit: installed.commit, version: installed.version, installedAt: installed.installedAt, targets: installed.targets, hooks: installed.hooks || 0 } };
    }));
    // Tool targets are project folders: not the home folder, a drive root or Windows itself.
    const system = [process.env.SystemRoot, process.env.windir, process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean).map(pathKey);
    const usable = folder => { const key = pathKey(folder); return key !== pathKey(this.home) && key !== pathKey(os.homedir()) && path.parse(key).root !== key && !system.some(root => key === root || key.startsWith(root + path.sep)); };
    const recent = projectList.filter(project => project?.path && usable(project.path)).slice(0, 16).map(project => ({ path: project.path, name: project.name || path.basename(project.path) }));
    return { categories: catalog.categories, items, projects: recent, updates: await this.updates(), lockFile: path.relative(this.repo, this.lockFile).replaceAll('\\', '/') };
  }

  // --- review ---

  async resolveCommit(repo) {
    const { stdout } = await this.run('git', ['ls-remote', `https://github.com/${repo}.git`, 'HEAD'], { timeout: 60 * 1000 });
    const commit = stdout.trim().split(/\s+/)[0];
    if (!SHA.test(commit)) throw fail(`Could not read the latest commit of ${repo}.`, 502);
    return commit;
  }

  async checkout(item, commit) {
    const folder = path.join(this.sources, item.id, commit);
    if (await exists(path.join(folder, '.jupiter-pinned'))) return folder;
    await rm(folder, { recursive: true, force: true }); await mkdir(folder, { recursive: true });
    const git = args => this.run('git', ['-c', 'core.hooksPath=NUL', '-c', 'advice.detachedHead=false', ...args], { cwd: folder, timeout: 5 * 60 * 1000 });
    await git(['init', '-q']);
    await git(['fetch', '-q', '--depth', '1', `https://github.com/${item.repo}.git`, commit]);
    await git(['checkout', '-q', 'FETCH_HEAD']);
    const { stdout } = await git(['rev-parse', 'HEAD']);
    if (stdout.trim() !== commit) throw fail('The downloaded code does not match the pinned commit.', 502);
    await writeFile(path.join(folder, '.jupiter-pinned'), commit);
    return folder;
  }

  async packageVersion(name) {
    if (!SAFE_PACKAGE.test(name)) throw fail('The catalogue lists an invalid package name.', 500);
    const { stdout } = await this.run('npm', ['view', name, 'version'], { timeout: 90 * 1000 });
    const version = stdout.trim().split(/\s+/).pop();
    if (!SAFE_VERSION.test(version || '')) throw fail(`Could not read the latest version of ${name}.`, 502);
    return version;
  }

  // The exact commands an install would run, for the review screen and for install itself.
  plan(item, pin, targets) {
    const setup = item.setup; const steps = [];
    if (setup.kind === 'plugin') {
      steps.push({ label: `Add the pinned ${setup.marketplace} marketplace to Claude Code`, file: 'claude', args: ['plugin', 'marketplace', 'add', pin.folder] });
      for (const plugin of setup.plugins) steps.push({ label: `Install ${plugin} for Claude Code`, file: 'claude', args: ['plugin', 'install', `${plugin}@${setup.marketplace}`, '--scope', 'user'] });
      if (setup.codexSkills && pin.skills?.length) steps.push({ label: `Copy ${pin.skills.join(', ')} into Codex skills`, copy: { agents: ['codex'], names: pin.skills, from: setup.codexSkills.from } });
      // The same tool's MCP server for Codex, run with Node from the reviewed checkout (the shared link),
      // so Codex runs exactly the code that was reviewed and nothing is downloaded at start.
      if (setup.codexMcp && setup.shared && SAFE_NAME.test(setup.codexMcp.server || '') && /^[A-Za-z0-9._/-]+$/.test(setup.codexMcp.script || '')) {
        const script = path.join(this.toolsDir, item.id, ...setup.codexMcp.script.split('/'));
        steps.push({ label: `Add ${setup.codexMcp.server} to Codex (everywhere)`, file: 'codex', target: 'everywhere', server: setup.codexMcp.server, args: ['mcp', 'add', setup.codexMcp.server, '--', 'node', script, ...(setup.codexMcp.args || [])] });
      }
    } else if (setup.kind === 'skills') {
      steps.push({ label: `Copy ${pin.skills.join(', ')} into ${setup.agents.map(agent => agent === 'claude' ? 'Claude Code' : 'Codex').join(' and ')} skills`, copy: { agents: setup.agents, names: pin.skills, from: setup.from, root: setup.root === true, exclude: setup.exclude || [] } });
    } else if (setup.kind === 'mcp') {
      const launch = setup.package ? (setup.launch || ['npx', '-y', '{package}@{version}']).map(part => part.replace('{package}', setup.package).replace('{version}', pin.version)).concat(setup.args || []) : null;
      const [command, ...args] = launch ? (isWindows && launch[0] === 'npx' ? ['cmd', '/c', ...launch] : launch) : [];
      for (const target of targets) {
        const project = target === 'everywhere' ? null : target;
        const where = project ? path.basename(project) : 'everywhere';
        if (setup.agents.includes('claude')) steps.push({ label: `Add ${setup.server} to Claude Code (${where})`, file: 'claude', cwd: project || undefined, target,
          args: setup.url ? ['mcp', 'add', '--scope', project ? 'project' : 'user', '--transport', 'http', setup.server, setup.url, ...(setup.headerEnv ? ['--header', `Authorization: Bearer \${${setup.headerEnv}}`] : [])] : ['mcp', 'add', '--scope', project ? 'project' : 'user', setup.server, '--', command, ...args] });
        if (setup.agents.includes('codex')) {
          if (!project) steps.push({ label: `Add ${setup.server} to Codex (everywhere)`, file: 'codex', target, envVars: setup.url ? [] : [...(setup.env || []), ...(setup.optionalEnv || [])],
            args: setup.url ? ['mcp', 'add', setup.server, '--url', setup.url, ...(setup.headerEnv ? ['--bearer-token-env-var', setup.headerEnv] : [])] : ['mcp', 'add', setup.server, '--', command, ...args] });
          else if (!setup.url) steps.push({ label: `Add ${setup.server} to Codex (${where})`, codexProject: { project, command, args, vars: [...(setup.env || []), ...(setup.optionalEnv || [])] }, target });
        }
      }
    } else if (setup.kind === 'npm-cli') {
      steps.push({ label: `Install the ${setup.bin} command (${setup.package}@${pin.version})`, file: 'npm', args: ['install', '--global', ...(setup.allowScripts ? [] : ['--ignore-scripts']), `${setup.package}@${pin.version}`] });
    } else if (setup.kind === 'uv-tool') {
      steps.push({ label: `Install the ${setup.bin} command (${setup.package}==${pin.version})`, file: 'uv', args: ['tool', 'install', `${setup.package}==${pin.version}`] });
    }
    if (setup.shared && pin.folder) steps.unshift({ label: `Link the pinned checkout as ${path.join(this.toolsDir, item.id)}`, link: { name: item.id } });
    return steps;
  }

  async review(id, targets = ['everywhere']) {
    const item = await this.item(id);
    const setup = item.setup;
    if (!setup || setup.kind === 'manual') throw fail(setup?.note || 'This one is set up by hand; follow its notes.', 400);
    const lock = await this.lock();
    const pin = {};
    if (setup.package && setup.kind !== 'uv-tool') pin.version = await this.packageVersion(setup.package);
    if (setup.kind === 'uv-tool') {
      if (!SAFE_PACKAGE.test(setup.package)) throw fail('The catalogue lists an invalid package name.', 500);
      const version = (await this.fetchJson(`https://pypi.org/pypi/${setup.package}/json`))?.info?.version;
      if (!SAFE_VERSION.test(version || '')) throw fail(`Could not read the latest version of ${setup.package}.`, 502);
      pin.version = version;
    }
    if (['plugin', 'skills'].includes(setup.kind)) {
      pin.commit = await this.resolveCommit(item.repo);
      pin.folder = await this.checkout(item, pin.commit);
    }
    const wanted = setup.kind === 'skills' ? setup : setup.codexSkills;
    if (pin.folder && setup.root) {
      // The whole checkout is the skill (its SKILL.md at the top), installed under one name.
      if (setup.names?.length !== 1 || !SAFE_NAME.test(setup.names[0])) throw fail('A whole checkout skill needs exactly one name in the catalogue.', 500);
      if (!await exists(path.join(pin.folder, 'SKILL.md'))) throw fail('The pinned code has no SKILL.md at its top.', 409);
      pin.skills = [...setup.names];
    } else if (pin.folder && wanted) {
      pin.skills = await skillFolders(pin.folder, wanted.from, wanted.names);
      if (!pin.skills.length) throw fail('The pinned code has no skills where the catalogue expects them.', 409);
      for (const name of pin.skills) if (!await exists(path.join(pin.folder, wanted.from || '', name, 'SKILL.md'))) throw fail(`The pinned code has no ${name} skill at ${[wanted.from, name].filter(Boolean).join('/')}.`, 409);
    }
    // A skills-only install copies just the skill folders, so only those are reviewed.
    let inspection = null;
    if (setup.kind === 'skills' && setup.root) inspection = await inspectCheckout(pin.folder);
    else if (setup.kind === 'skills') {
      const parts = await Promise.all(pin.skills.map(name => inspectCheckout(path.join(pin.folder, setup.from || '', name))));
      inspection = parts.reduce((all, part) => { for (const [key, value] of Object.entries(part)) all[key] = Array.isArray(value) ? [...(all[key] || []), ...value] : (all[key] || 0) + value; return all; }, {});
      inspection.skills = pin.skills.map(name => ({ name, path: [setup.from, name].filter(Boolean).join('/') }));
    } else if (pin.folder) inspection = await inspectCheckout(pin.folder);
    else if (setup.kind === 'npm-cli') {
      const { stdout } = await this.run('npm', ['view', `${setup.package}@${pin.version}`, 'scripts', '--json'], { timeout: 90 * 1000 });
      let scripts = {}; try { scripts = JSON.parse(stdout || '{}') || {}; } catch { /* no scripts listed */ }
      const installScripts = INSTALL_SCRIPTS.filter(name => scripts[name]).map(name => `${setup.package} ${name}: ${String(scripts[name]).slice(0, 200)}${setup.allowScripts ? '' : ' (not run: installed with --ignore-scripts)'}`);
      inspection = { plugins: [], hooks: [], mcpServers: [], skills: [], commands: 0, agents: 0, statusLine: [], installScripts, scripts: 0, outside: [], files: 0 };
    }
    if (setup.kind === 'plugin') {
      const marketplace = await readJsonFile(path.join(pin.folder, '.claude-plugin/marketplace.json'));
      if (marketplace?.name !== setup.marketplace) throw fail(`The pinned code names its marketplace "${marketplace?.name || 'nothing'}", not "${setup.marketplace}". Update the catalogue after checking the repo.`, 409);
      const known = (await readJsonFile(path.join(this.claudeHome, 'plugins/known_marketplaces.json')))?.[setup.marketplace];
      if (known && !lock.installed[id]) throw fail(`Claude Code already has a marketplace called ${setup.marketplace} (from ${known.source?.repo || known.source?.path || known.installLocation || 'elsewhere'}), so it is not pinned. Remove it with “claude plugin marketplace remove ${setup.marketplace}”, then review again.`, 409);
      const missing = setup.plugins.filter(plugin => !inspection.plugins.some(entry => entry.name === plugin));
      if (missing.length) throw fail(`The pinned marketplace has no plugin called ${missing.join(', ')}.`, 409);
    }
    const chosen = this.targets(setup, targets);
    const steps = this.plan(item, pin, chosen);
    const token = randomBytes(18).toString('base64url');
    const review = { id, token, commit: pin.commit || null, version: pin.version || null, folder: pin.folder || null, skills: pin.skills || null, targets: chosen, createdAt: Date.now(),
      steps: steps.map(step => step.link ? `link ${path.join(this.toolsDir, step.link.name)} → ${pin.folder}` : step.copy ? `copy ${step.copy.names.join(', ')} → ${step.copy.agents.map(agent => this.skillDirs[agent]).join(' and ')}` : step.codexProject ? `write [mcp_servers.${setup.server}] → ${path.join(step.codexProject.project, '.codex/config.toml')}` : [step.file, ...step.args].join(' ')),
      found: inspection, env: setup.env || (setup.headerEnv ? [setup.headerEnv] : []), optionalEnv: setup.optionalEnv || [], notes: [setup.note, item.risk].filter(Boolean),
      previous: lock.installed[id] ? { commit: lock.installed[id].commit, version: lock.installed[id].version } : null };
    this.reviews.set(id, review);
    return review;
  }

  targets(setup, targets) {
    if (setup.kind !== 'mcp') return ['everywhere'];
    const list = [...new Set((Array.isArray(targets) && targets.length ? targets : ['everywhere']).map(String))];
    for (const target of list) if (target !== 'everywhere' && !path.isAbsolute(target)) throw fail('Choose “Everywhere” or a project folder.');
    return list;
  }

  // --- install and remove ---

  async copySkills(item, pin, copy) {
    const actions = [];
    for (const agent of copy.agents) for (const name of copy.names) {
      if (!SAFE_NAME.test(name)) throw fail(`Invalid skill name ${name}.`, 500);
      const target = path.join(this.skillDirs[agent], name);
      if (await exists(target)) {
        const marker = await readJsonFile(path.join(target, MARKER));
        if (marker?.id !== item.id) throw fail(`${agent === 'claude' ? 'Claude Code' : 'Codex'} already has a ${name} skill that Jupiter did not install. Remove or rename it first.`, 409);
        await rm(target, { recursive: true, force: true });
      }
      await mkdir(path.dirname(target), { recursive: true });
      const from = copy.root ? pin.folder : path.join(pin.folder, copy.from || '', name);
      const skip = new Set(['.git', '.jupiter-pinned', ...(copy.exclude || [])]);
      await cp(from, target, { recursive: true, filter: source => { const parts = path.relative(from, source).split(/[\\/]/); return !parts.includes('.git') && !skip.has(parts[0]); } });
      await writeFile(path.join(target, MARKER), JSON.stringify({ id: item.id, repo: item.repo, commit: pin.commit }, null, 2) + '\n');
      actions.push({ type: 'skill', agent, path: target });
    }
    return actions;
  }

  async runStep(item, pin, step) {
    if (step.copy) return this.copySkills(item, pin, step.copy);
    if (step.link) return [await this.linkTool(step.link.name, pin.folder)];
    if (step.codexProject) {
      const { project, command, args, vars } = step.codexProject;
      const file = path.join(project, '.codex/config.toml');
      const text = await readFile(file, 'utf8').catch(error => { if (error.code === 'ENOENT') return ''; throw error; });
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, addCodexBlock(text, item.id, item.setup.server, command, args, vars));
      return [{ type: 'codex-project-mcp', file, name: item.setup.server, target: step.target }];
    }
    const resolved = ['npm', 'git'].includes(step.file) ? step.file : this.which(step.file) || step.file;
    const result = await this.run(resolved, step.args, { cwd: step.cwd });
    if (step.file === 'claude' && step.args[0] === 'plugin' && step.args[1] === 'marketplace') return [{ type: 'claude-marketplace', name: item.setup.marketplace }];
    if (step.file === 'claude' && step.args[0] === 'plugin') return [{ type: 'claude-plugin', id: step.args[2] }];
    if (step.file === 'claude' && step.args[0] === 'mcp') return [{ type: 'claude-mcp', name: item.setup.server, scope: step.args[3], cwd: step.cwd || null, target: step.target }];
    if (step.file === 'codex') {
      if (step.envVars?.length) {
        const file = path.join(this.codexHome, 'config.toml');
        await writeFile(file, addEnvVars(await readFile(file, 'utf8'), item.setup.server, step.envVars));
      }
      return [{ type: 'codex-mcp', name: step.server || item.setup.server, target: step.target }];
    }
    if (step.file === 'npm') return [{ type: 'npm-global', package: item.setup.package }];
    if (step.file === 'uv') return [{ type: 'uv-tool', package: item.setup.package }];
    return [{ type: 'command', output: result.stdout.slice(0, 200) }];
  }

  async undo(action) {
    const claude = this.which('claude') || 'claude', codex = this.which('codex') || 'codex';
    if (action.type === 'skill') {
      const marker = await readJsonFile(path.join(action.path, MARKER));
      if (marker) await rm(action.path, { recursive: true, force: true });
    } else if (action.type === 'claude-plugin') await this.run(claude, ['plugin', 'uninstall', action.id]);
    else if (action.type === 'claude-marketplace') await this.run(claude, ['plugin', 'marketplace', 'remove', action.name]);
    else if (action.type === 'claude-mcp') await this.run(claude, ['mcp', 'remove', '--scope', action.scope, action.name], { cwd: action.cwd || undefined });
    else if (action.type === 'codex-mcp') await this.run(codex, ['mcp', 'remove', action.name]);
    else if (action.type === 'codex-project-mcp') { const text = await readFile(action.file, 'utf8').catch(() => null); if (text != null) await writeFile(action.file, removeCodexBlock(text, action.capability || '', action.name)); }
    else if (action.type === 'npm-global') await this.run('npm', ['uninstall', '--global', action.package]);
    else if (action.type === 'uv-tool') await this.run(this.which('uv') || 'uv', ['tool', 'uninstall', action.package]);
    else if (action.type === 'tool-link') await this.unlinkTool(action.path);
  }

  // .jupiter/tools/<id> points at the pinned checkout. Only a link Jupiter made is replaced or removed,
  // and removing it never touches the checkout it points to.
  async linkTool(name, folder) {
    if (!SAFE_NAME.test(name) || !folder) throw fail('Invalid shared tool.', 500);
    const link = path.join(this.toolsDir, name);
    await mkdir(this.toolsDir, { recursive: true });
    const info = await lstat(link).catch(() => null);
    if (info && !info.isSymbolicLink()) throw fail(`${link} already exists and is not a link Jupiter made. Move it first.`, 409);
    if (info) await this.unlinkTool(link);
    await symlink(folder, link, isWindows ? 'junction' : 'dir');
    return { type: 'tool-link', path: link, to: folder };
  }
  async unlinkTool(link) {
    const info = await lstat(link).catch(() => null);
    if (!info) return;
    if (!info.isSymbolicLink()) throw fail(`${link} is not a link, so it was left in place.`, 409);
    await readlink(link);
    await rm(link, { force: true });
  }

  install(id, { token, targets, acceptHooks = false } = {}) {
    return this.serial(async () => {
      const item = await this.item(id); const lock = await this.lock();
      const existing = lock.installed[id];
      let review = this.reviews.get(id), pin, chosen;
      if (token) {
        if (!review || review.token !== token) throw fail('Review this capability again before installing; the review has changed.', 409);
        if (Date.now() - review.createdAt > REVIEW_TTL) { this.reviews.delete(id); throw fail('That review is more than 30 minutes old. Review it again.', 409); }
        if (review.found?.hooks.length && acceptHooks !== true) throw fail('This adds hooks that run automatically. Tick that you have read them, then install.', 400);
        pin = { commit: review.commit, version: review.version, folder: review.folder, skills: review.skills }; chosen = review.targets;
        if (existing) {
          // An update replaces the old pin completely, so nothing from it is left behind.
          const problems = await this.removeActions(id, existing.actions);
          if (problems.length) throw fail(`The installed version could not be removed first: ${problems.join(' · ')}`, 502);
          delete lock.installed[id]; await this.saveLock(lock);
        }
      } else {
        // Adding an installed tool to more projects reuses the version already reviewed.
        if (!existing || item.setup?.kind !== 'mcp') throw fail('Review this capability before installing it.', 409);
        pin = { commit: existing.commit, version: existing.version }; chosen = this.targets(item.setup, targets).filter(target => !existing.targets.includes(target));
        if (!chosen.length) return this.list();
      }
      const steps = this.plan(item, pin, chosen); const done = [];
      try {
        for (const step of steps) done.push(...(await this.runStep(item, pin, step)).map(action => ({ ...action, capability: id })));
      } catch (error) {
        for (const action of done.reverse()) await this.undo(action).catch(() => {});
        // A failed update puts the version you had back, from its pinned copy.
        const restored = token && existing ? await this.restore(item, existing).catch(() => false) : false;
        throw fail(`${existing && token ? 'Update' : 'Install'} stopped and was rolled back${restored ? '; your previous version is back in place' : ''}: ${error.message}`, error.status || 502);
      }
      const fresh = await this.lock();
      const keep = token ? null : fresh.installed[id];
      fresh.installed[id] = {
        name: item.name, repo: item.repo || null, commit: pin.commit || null, version: pin.version || null, kind: item.setup.kind,
        installedAt: keep?.installedAt || new Date().toISOString(), updatedAt: new Date().toISOString(),
        reviewedAt: keep?.reviewedAt || new Date(review?.createdAt || Date.now()).toISOString(), hooks: keep?.hooks ?? (review?.found?.hooks.length || 0), hookList: keep?.hookList ?? hookSignatures(review?.found?.hooks),
        targets: [...new Set([...(keep?.targets || []), ...chosen])], actions: [...(keep?.actions || []), ...done],
      };
      await this.saveLock(fresh);
      if (token) this.reviews.delete(id);
      return this.list();
    });
  }

  async restore(item, entry) {
    const pin = { commit: entry.commit, version: entry.version, folder: entry.commit ? path.join(this.sources, item.id, entry.commit) : null,
      skills: [...new Set(entry.actions.filter(action => action.type === 'skill').map(action => path.basename(action.path)))] };
    if (pin.folder && !await exists(path.join(pin.folder, '.jupiter-pinned'))) return false;
    const done = [];
    for (const step of this.plan(item, pin, entry.targets)) done.push(...(await this.runStep(item, pin, step)).map(action => ({ ...action, capability: item.id })));
    const lock = await this.lock(); lock.installed[item.id] = { ...entry, actions: done, updatedAt: new Date().toISOString() }; await this.saveLock(lock);
    return true;
  }

  // Compares every installed pick with its latest commit or release. Reads only.
  async checkUpdates() {
    const [catalog, lock] = await Promise.all([this.catalog(), this.lock()]);
    const results = {};
    await Promise.all(Object.entries(lock.installed).map(async ([id, entry]) => {
      const item = catalog.items.find(candidate => candidate.id === id); const setup = item?.setup || {};
      try {
        if (!item) results[id] = { status: 'unsupported', reason: 'No longer in the catalogue' };
        else if (entry.commit) { const latest = await this.resolveCommit(item.repo); results[id] = { status: latest === entry.commit ? 'current' : 'update', current: entry.commit, latest }; }
        else if (setup.kind === 'uv-tool') { const latest = (await this.fetchJson(`https://pypi.org/pypi/${setup.package}/json`))?.info?.version; results[id] = { status: latest === entry.version ? 'current' : 'update', current: entry.version, latest }; }
        else if (setup.package) { const latest = await this.packageVersion(setup.package); results[id] = { status: latest === entry.version ? 'current' : 'update', current: entry.version, latest }; }
        else if (setup.url) results[id] = { status: 'current', hosted: true };
        else results[id] = { status: 'unsupported', reason: 'No version to compare' };
      } catch (error) { results[id] = { status: 'unsupported', reason: `Could not check: ${String(error.message).split(/\r?\n/)[0].slice(0, 160)}` }; }
    }));
    this.lastCheck = { checkedAt: new Date().toISOString(), results };
    await saveJson(path.join(this.sources, 'updates.json'), this.lastCheck).catch(() => {});
    return this.lastCheck;
  }

  async updates() {
    if (this.lastCheck === undefined) this.lastCheck = await readJson(path.join(this.sources, 'updates.json'), null);
    return this.lastCheck;
  }

  // Review the latest version and install it in place of the current one, keeping the same
  // projects. If the update changes its hooks, nothing happens until you confirm them.
  async update(id, { acceptHooks = false } = {}) {
    const existing = (await this.lock()).installed[id];
    if (!existing) throw fail('Only installed capabilities can be updated.', 409);
    const review = await this.review(id, existing.targets);
    if ((review.commit || null) === (existing.commit || null) && (review.version || null) === (existing.version || null)) {
      if (this.lastCheck?.results?.[id]) this.lastCheck.results[id] = { ...this.lastCheck.results[id], status: 'current', current: existing.commit || existing.version };
      return { updated: false, list: await this.list() };
    }
    const hooks = review.found?.hooks || [];
    const before = existing.hookList || null, after = hookSignatures(hooks);
    const changed = before ? JSON.stringify(before) !== JSON.stringify(after) : hooks.length !== (existing.hooks || 0);
    if (hooks.length && changed && acceptHooks !== true) return { updated: false, confirm: { hooks }, list: await this.list() };
    await this.install(id, { token: review.token, acceptHooks: true });
    if (this.lastCheck?.results?.[id]) this.lastCheck.results[id] = { status: 'current', current: review.commit || review.version, latest: review.commit || review.version };
    if (this.lastCheck) await saveJson(path.join(this.sources, 'updates.json'), this.lastCheck).catch(() => {});
    return { updated: true, list: await this.list() };
  }

  async removeActions(id, actions) {
    const problems = [];
    for (const action of [...actions].reverse()) await this.undo({ ...action, capability: id }).catch(error => problems.push(error.message));
    return problems;
  }

  remove(id, { target } = {}) {
    return this.serial(async () => {
      const lock = await this.lock(); const entry = lock.installed[id];
      if (!entry) throw fail('Jupiter did not install this one, so it will not remove it. Remove it in the agent instead.', 409);
      const matching = target ? entry.actions.filter(action => action.target === target) : entry.actions;
      const problems = await this.removeActions(id, matching);
      if (problems.length) throw fail(`Some parts could not be removed: ${problems.join(' · ')}`, 502);
      if (target && entry.targets.length > 1) { entry.actions = entry.actions.filter(action => action.target !== target); entry.targets = entry.targets.filter(item => item !== target); }
      else delete lock.installed[id];
      await this.saveLock(lock);
      return this.list();
    });
  }
}
