// Visual editors that come with an installed tool (Pixelbolt's studio). An editor starts only
// when asked, from the tool's shared checkout (.jupiter/tools/<id>), runs once however often it
// is opened, and stops when asked or when Jupiter closes. It listens on 127.0.0.1 only.
import { spawn } from 'node:child_process';
import path from 'node:path';

const SAFE = /^[A-Za-z0-9._/-]+$/;
const ADDRESS = /(http:\/\/127\.0\.0\.1:\d{2,5})\/?/;
const START_LIMIT = 20000;

export class ToolEditors {
  constructor({ toolsDir, cwd, node = process.execPath, spawner = spawn }) {
    Object.assign(this, { toolsDir, cwd, node, spawner });
    this.running = new Map(); // id -> { child, url, starting }
  }
  state(id) { const entry = this.running.get(id); return entry?.url ? { running: true, url: entry.url } : { running: false, url: null }; }
  /** Starts the editor if it isn't running, and resolves with its local address. */
  open(id, editor) {
    const current = this.running.get(id);
    if (current?.url) return Promise.resolve(current.url);
    if (current?.starting) return current.starting;
    if (!editor || !SAFE.test(editor.script || '') || !(editor.args || []).every(arg => SAFE.test(arg))) return Promise.reject(Object.assign(new Error('This tool has no editor.'), { status: 400 }));
    const script = path.join(this.toolsDir, id, ...editor.script.split('/'));
    const child = this.spawner(this.node, [script, ...(editor.args || [])], { cwd: this.cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const entry = { child, url: null, starting: null };
    entry.starting = new Promise((resolve, reject) => {
      let seen = '';
      const timer = setTimeout(() => { child.kill(); reject(Object.assign(new Error('The editor did not start in time.'), { status: 504 })); }, START_LIMIT);
      const read = chunk => {
        seen = (seen + chunk).slice(-4000);
        const match = ADDRESS.exec(seen);
        if (match && !entry.url) { entry.url = `${match[1]}/`; clearTimeout(timer); resolve(entry.url); }
      };
      child.stdout.setEncoding('utf8'); child.stdout.on('data', read);
      child.stderr.setEncoding('utf8'); child.stderr.on('data', chunk => { seen = (seen + chunk).slice(-4000); });
      child.once('error', error => { clearTimeout(timer); this.running.delete(id); reject(Object.assign(new Error(`The editor could not start: ${error.message}`), { status: 502 })); });
      child.once('exit', code => {
        clearTimeout(timer);
        if (this.running.get(id) === entry) this.running.delete(id);
        if (!entry.url) reject(Object.assign(new Error(`The editor stopped (${code ?? 'signal'}): ${seen.trim().split(/\r?\n/).pop() || 'no output'}`), { status: 502 }));
      });
    }).finally(() => { entry.starting = null; });
    this.running.set(id, entry);
    return entry.starting;
  }
  stop(id) { const entry = this.running.get(id); if (entry) { this.running.delete(id); entry.child.kill(); } return this.state(id); }
  stopAll() { for (const id of [...this.running.keys()]) this.stop(id); }
}
