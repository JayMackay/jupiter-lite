// Jupiter's Connections dashboard: the MCP inventory across the workspace and the
// user's recent and pinned projects. Reads configuration files only; a server is
// started solely by an explicit check, and only for a project in this list.
import { stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { McpInventory } from './mcp.mjs';
import { projectKey } from './recent-projects.mjs';

const EVERYWHERE = new Set(['global', 'plugin', 'managed']);
const NEEDS_SETUP = new Set(['missing-env', 'missing-command', 'approval']);
const DEFAULT_LIMIT = 16;

// One status per server for the dashboard: what the user needs to know at a glance.
export function connectionState(server) {
  if (!server.enabled || server.readiness === 'disabled') return 'off';
  if (NEEDS_SETUP.has(server.readiness)) return 'setup';
  const check = server.connection;
  if (check && !check.stale) return check.status === 'available' ? 'online' : 'problem';
  if (server.readiness === 'managed') return 'managed';
  return 'ready';
}

const isDirectory = async folder => { try { return (await stat(folder)).isDirectory(); } catch { return false; } };

export class ConnectionsOverview {
  constructor({ repo, projects, workspaceInventory, mcpOptions = {}, limit = DEFAULT_LIMIT }) {
    Object.assign(this, { repo, projects, mcpOptions, limit });
    this.inventories = new Map([[projectKey(repo), workspaceInventory || new McpInventory(repo, mcpOptions)]]);
  }

  inventory(folder) {
    const id = projectKey(folder);
    if (!this.inventories.has(id)) this.inventories.set(id, new McpInventory(folder, this.mcpOptions));
    return this.inventories.get(id);
  }

  // The workspace first, then pinned and recently used project folders that still exist.
  async folders() {
    const listed = await this.projects().catch(() => []);
    const ordered = [{ path: this.repo, name: path.basename(this.repo), workspace: true },
      ...listed.filter(item => item.pinned), ...listed.filter(item => !item.pinned)];
    const seen = new Set(); const result = [];
    for (const item of ordered) {
      const id = projectKey(item.path);
      if (seen.has(id)) continue; seen.add(id);
      if (!item.workspace && !this.projectFolder(item.path)) continue;
      if (!await isDirectory(item.path)) continue;
      result.push({ path: item.path, name: item.name || path.basename(item.path), workspace: !!item.workspace });
      if (result.length > this.limit) break;
    }
    return result;
  }

  // The home folder, drive roots and Windows folders show up in agent history but aren't
  // projects: scanning home would read your user settings as if they were a project's.
  projectFolder(folder) {
    const key = projectKey(folder);
    const homes = [this.mcpOptions.home, os.homedir()].filter(Boolean).map(projectKey);
    const system = [process.env.SystemRoot, process.env.windir, process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean).map(projectKey);
    return !homes.includes(key) && path.parse(key).root !== key && !system.some(root => key === root || key.startsWith(root + path.sep));
  }

  async overview() {
    const folders = await this.folders();
    const scans = await Promise.all(folders.map(async folder => ({ folder, inventory: await this.inventory(folder.path).list().catch(error => ({ servers: [], problems: [{ path: folder.path, message: `Could not read this project's settings: ${error.message}` }] })) })));
    const everywhere = new Map(); const projects = []; const problems = new Map();
    for (const { folder, inventory } of scans) {
      for (const problem of inventory.problems || []) problems.set(problem.path, problem);
      const local = [];
      for (const server of inventory.servers || []) {
        const item = { ...server, state: connectionState(server), project: folder.path };
        if (EVERYWHERE.has(server.scope)) { if (!everywhere.has(server.id)) everywhere.set(server.id, item); }
        else local.push(item);
      }
      if (local.length) projects.push({ path: folder.path, name: folder.name, workspace: folder.workspace, servers: local });
    }
    const all = [...everywhere.values(), ...projects.flatMap(project => project.servers)];
    const summary = { total: all.length, online: 0, ready: 0, setup: 0, problem: 0, off: 0, managed: 0, tools: 0 };
    for (const server of all) { summary[server.state] += 1; if (server.state === 'online') summary.tools += server.connection?.toolCount || 0; }
    return { scannedAt: new Date().toISOString(), scanned: folders.length, summary, everywhere: [...everywhere.values()], projects, problems: [...problems.values()] };
  }

  async check(project, id) {
    if (typeof project !== 'string' || typeof id !== 'string') throw new Error('Choose a connection to check.');
    const known = (await this.folders()).some(folder => projectKey(folder.path) === projectKey(project));
    if (!known) throw new Error('That project is not in your project list.');
    return this.inventory(project).check(id);
  }

  close() { for (const inventory of this.inventories.values()) inventory.close(); }
}
