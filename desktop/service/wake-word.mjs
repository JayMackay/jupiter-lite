// Runs the offline "Hey Jupiter" listener (wake-listener.py) with the local Whisper install.
// Emits 'state', 'wake' and 'command' events. Audio never leaves the listener process.
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { localConfig } from './local-dictation.mjs';

const worker = fileURLToPath(new URL('./wake-listener.py', import.meta.url));

export class WakeWord extends EventEmitter {
  constructor(repo, { env = {}, spawner = spawn } = {}) {
    super();
    Object.assign(this, { repo, env, spawner });
    this.state = { status: 'off', device: null, error: null };
    this.child = null; this.wanted = false; this.restarts = 0; this.muteTimer = null;
  }
  setState(patch) { this.state = { ...this.state, ...patch }; this.emit('state', this.state); }
  async available() {
    const config = localConfig(this.repo, this.env);
    try { await Promise.all([access(config.python), access(`${config.model}/model.bin`)]); return config; } catch { return null; }
  }
  async start() {
    this.wanted = true;
    if (this.child) return this.state;
    const config = await this.available();
    if (!config) { this.setState({ status: 'unavailable', error: 'Local Whisper is not installed. Run scripts/setup-local-dictation.ps1.' }); return this.state; }
    this.setState({ status: 'starting', error: null });
    const child = this.spawner(config.python, [worker, '--model', config.model], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child = child;
    let buffer = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      buffer += chunk;
      for (let at = buffer.indexOf('\n'); at >= 0; at = buffer.indexOf('\n')) {
        const line = buffer.slice(0, at); buffer = buffer.slice(at + 1);
        let message; try { message = JSON.parse(line); } catch { continue; }
        if (message.type === 'ready') { this.restarts = 0; this.setState({ status: 'listening', device: String(message.device || '').slice(0, 120), error: null }); }
        else if (message.type === 'wake') this.emit('wake');
        else if (message.type === 'command' && typeof message.text === 'string' && message.text.trim()) this.emit('command', message.text.trim().slice(0, 2000));
        else if (message.type === 'timeout') this.emit('timeout');
        else if (message.type === 'error') this.setState({ error: String(message.message || 'The listener stopped.').slice(0, 300) });
      }
    });
    child.stderr.on('data', () => { /* model warnings; nothing personal is printed */ });
    child.on('exit', () => {
      this.child = null;
      if (!this.wanted) { this.setState({ status: 'off' }); return; }
      // Restart after a crash (for example a microphone unplugged), backing off up to 30 seconds.
      this.restarts++;
      this.setState({ status: 'restarting' });
      setTimeout(() => { if (this.wanted) void this.start(); }, Math.min(30000, 1000 * 2 ** Math.min(this.restarts, 5)));
    });
    return this.state;
  }
  stop() {
    this.wanted = false;
    clearTimeout(this.muteTimer);
    if (this.child) { this.child.kill(); this.child = null; }
    this.setState({ status: 'off', error: null });
    return this.state;
  }
  // The next thing said is a request, no "Hey Jupiter" needed.
  listen(seconds = 7) { if (this.child?.stdin.writable) this.child.stdin.write(JSON.stringify({ listen: true, seconds }) + '\n'); }
  // Stop listening for a request (or transcribing one) without stopping the wake word.
  cancel() { if (this.child?.stdin.writable) this.child.stdin.write(JSON.stringify({ cancel: true }) + '\n'); }
  // While Jupiter speaks the listener pauses, so it never hears itself. A safety timer resumes it.
  mute(on, seconds = 45) {
    clearTimeout(this.muteTimer);
    if (this.child?.stdin.writable) this.child.stdin.write(JSON.stringify({ mute: on }) + '\n');
    if (on) this.muteTimer = setTimeout(() => this.mute(false), seconds * 1000);
  }
}
