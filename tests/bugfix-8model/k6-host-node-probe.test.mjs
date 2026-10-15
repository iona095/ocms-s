// K6 host-node-probe [Space Bunny]. Verdict NOT REPRODUCIBLE with a hermetic,
// deterministic slow fake, so NO product change (rules: no repro, no fix).
//
// Probe output (all attempts on this machine, Node v24.15.0, Windows):
//  1. cmd.exe copied to node.exe -> exits in ~8 ms (cmd with args is not
//     interactive), no block to observe.
//  2. clip/sort/find/choice/more.com/cscript copies -> all exit in 33-73 ms.
//  3. wscript/ftp/nslookup copies -> hang 1.5 s here, but via GUI dialogs
//     (hostile in CI) or DNS stalls (environment-dependent), so neither is a
//     hermetic deterministic fake.
//  4. node.exe on \\192.0.2.1\share (TEST-NET-1) -> stalls ~21 s on FIRST
//     resolution, then fast-fails (SMB negative caching): non-deterministic
//     even on one machine.
//  5. NODE_OPTIONS=--require slow.js with real node --version -> the require
//     never runs (marker absent): --version short-circuits before preload.
// The spawnSync probe (timeout 5000) therefore blocks the loop only for
// network-share-hosted Node binaries, which no hermetic fake reproduces.
//
// Guard below: a fast non-Node candidate exercises the whole probe seam
// (basename check passes, version check refuses, domain failure surfaces, no
// spawn, loop alive). It passes before and after; it pins the seam shape.
import { describe, it } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { assert, HOST_PATH } from '../v1.4/helpers.mjs';

let hostModule = null;
let hostLoadError = null;
try {
  hostModule = await import(pathToFileURL(HOST_PATH).href);
} catch (err) {
  hostLoadError = err;
}
const skip = hostLoadError ? 'capability missing: dsh/host.mjs must load (' + (hostLoadError && hostLoadError.message) + ')' : false;

async function freePort() {
  const net = await import('node:net');
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function fakeCtx() {
  return {
    root: {},
    fiber: { assertActive() {} },
    reflect: { provide() { return () => {}; } },
    slots: { inject: () => () => {}, register: () => () => {} },
    get: () => undefined,
  };
}

describe('K6 host-node-probe (guard: NOT REPRODUCIBLE, no product change)', () => {
  it('a fast non-Node candidate is refused cleanly with the loop alive and nothing spawned', { skip, timeout: 30000 }, async (t) => {
    const comspec = process.env.COMSPEC;
    assert.ok(typeof comspec === 'string' && comspec.length > 0, 'COMSPEC must resolve at runtime');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocms-k6-'));
    t.after(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });
    const fakeNode = path.join(dir, 'node.exe');
    fs.copyFileSync(comspec, fakeNode);
    const beats = [];
    const timer = setInterval(() => beats.push(Date.now()), 50);
    let dispose = null;
    try {
      const t0 = Date.now();
      dispose = await hostModule.apply(fakeCtx(), { port: await freePort(), nodeBin: fakeNode });
      const controller = hostModule.currentController();
      await controller.start({ embedOrigin: 'http://127.0.0.1:3080' }).then(
        () => { throw new Error('non-Node candidate must not start'); },
        (err) => { assert.equal(err && err.code, 'ocms/start-failed', 'domain refusal, got ' + JSON.stringify(err && err.code)); },
      );
      const elapsed = Date.now() - t0;
      assert.ok(elapsed < 2000, 'fast probe refuses fast (' + elapsed + ' ms, nothing spawned)');
      let maxGap = 0;
      for (let i = 1; i < beats.length; i++) maxGap = Math.max(maxGap, beats[i] - beats[i - 1]);
      assert.ok(maxGap < 1000, 'loop alive during probe (max gap ' + maxGap + ' ms)');
    } finally {
      clearInterval(timer);
      try { await dispose(); } catch {}
    }
  });
});
