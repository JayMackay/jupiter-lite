import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { ToolEditors } from '../tool-editors.mjs';

test('an editor starts once, reports its local address, and stops when asked or on close', async () => {
  const started = [];
  const spawner = (file, args, options) => {
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.kill = () => { child.killed = true; setImmediate(() => child.emit('exit', null)); };
    started.push({ file, args, options, child });
    setImmediate(() => child.stdout.write('Pixelbolt studio: http://127.0.0.1:4748\nPort 4747 is in use, so this studio has another.\n'));
    return child;
  };
  const editors = new ToolEditors({ toolsDir: 'C:/Jupiter/.jupiter/tools', cwd: 'C:/Jupiter/projects', node: 'node', spawner });
  const editor = { script: 'bin/pixelbolt.js', args: ['preview'] };
  const [first, second] = await Promise.all([editors.open('pixelbolt', editor), editors.open('pixelbolt', editor)]);
  assert.equal(first, 'http://127.0.0.1:4748/'); assert.equal(second, first);
  assert.equal(started.length, 1, 'opening twice reuses the running editor');
  assert.match(started[0].args[0].replace(/\\/g, '/'), /\.jupiter\/tools\/pixelbolt\/bin\/pixelbolt\.js$/);
  assert.deepEqual(editors.state('pixelbolt'), { running: true, url: first });
  assert.deepEqual(editors.stop('pixelbolt'), { running: false, url: null });
  assert.ok(started[0].child.killed);
  await editors.open('pixelbolt', editor);
  editors.stopAll();
  assert.ok(started[1].child.killed, 'closing Jupiter stops it');
  await assert.rejects(editors.open('pixelbolt', { script: '../x.js; rm', args: [] }), /no editor/);
});
