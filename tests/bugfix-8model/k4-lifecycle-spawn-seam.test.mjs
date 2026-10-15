// K4 lifecycle-spawn-seam [report C13; Muse/MiMo/Haiku; DeepSeek F7]. Fault-injected
// fake children only; every wait bounded (per-test timeout + disposal race);
// controllers disposed in finally. No real processes, no real ports.
import { describe, it } from 'node:test';
import {
  assert, loadLifecycleModule, probeLifecycleCapability, makeDeps, readinessSequence,
  assertOcmsFailure, childDouble,
} from '../v1.4/helpers.mjs';

const hasLifecycle = await probeLifecycleCapability();
const skip = !hasLifecycle ? 'capability missing: createLifecycleController' : false;
const READY = { ok: true, status: 200, json: { ok: true } };
const ORIGIN = 'http://127.0.0.1:3080';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function make(overrides = {}) {
  const { deps, record } = makeDeps({ deadlineMs: 2000, intervalMs: 10, ...overrides });
  const { createLifecycleController } = await loadLifecycleModule();
  return { controller: createLifecycleController(deps), deps, record };
}

// Bounded disposal: true when dispose() settles within budget, false on hang.
async function disposeSettled(controller, ms = 1500) {
  return Promise.race([controller.dispose().then(() => true), sleep(ms).then(() => false)]);
}

describe('K4 lifecycle-spawn-seam', () => {
  it('an unvalidated spawnFn return (undefined) fails the Start without wedging STARTING', { skip, timeout: 30000 }, async () => {
    let calls = 0;
    const { controller } = await make({
      probeHttp: readinessSequence([READY]),
      spawnFn(cmd, args, opts) {
        calls += 1;
        if (calls === 1) return undefined;
        const child = childDouble();
        const origKill = child.kill.bind(child);
        child.kill = (sig) => { origKill(sig); setTimeout(() => child.fireExit(0), 5); return true; };
        return child;
      },
    });
    try {
      await assert.rejects(controller.start({ embedOrigin: ORIGIN }), (err) => {
        assertOcmsFailure(err, 'ocms/start-failed');
        return true;
      });
      assert.equal((await controller.status()).state, 'OFFLINE', 'failed spawn leaves OFFLINE, not STARTING');
      const retry = await controller.start({ embedOrigin: ORIGIN });
      assert.equal(retry.state, 'ONLINE', 'restart spawns fresh after an invalid handle');
    } finally {
      assert.equal(await disposeSettled(controller), true, 'dispose settles (never waits unbounded)');
    }
  });

  it('error-without-exit reconciles on close: restart and disposal are not blocked', { skip, timeout: 30000 }, async () => {
    let childRef = null;
    const { controller } = await make({
      probeHttp: async () => ({ ok: false, status: 0, json: null }),
      spawnFn(cmd, args, opts) {
        childRef = childDouble();
        const origKill = childRef.kill.bind(childRef);
        childRef.kill = (sig) => { origKill(sig); setTimeout(() => childRef.fireExit(0), 5); return true; };
        return childRef;
      },
    });
    try {
      const failing = controller.start({ embedOrigin: ORIGIN });
      await sleep(30);
      childRef.fireError(Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }));
      await assert.rejects(failing, (err) => { assertOcmsFailure(err); return true; });
      // The runtime always follows error with close; exit may never fire.
      childRef.fire('close', -2, null);
      await sleep(20);
      assert.equal((await controller.status()).state, 'OFFLINE', 'close reconciles error retention to OFFLINE');
      await assert.rejects(controller.start({ embedOrigin: ORIGIN }), (err) => {
        assertOcmsFailure(err, 'ocms/readiness-timeout');
        return true;
      }, 'restart proceeds to a fresh attempt (readiness never satisfied here)');
      assert.equal((await controller.status()).state, 'ERROR', 'fresh attempt fails ERROR, not a wedge refusal');
    } finally {
      try { if (childRef && !childRef.exited) childRef.fireExit(0); } catch {}
      assert.equal(await disposeSettled(controller), true, 'dispose settles (never waits unbounded)');
    }
  });

  it('F7: a child that dies during the probe never becomes ONLINE on a dead port', { skip, timeout: 30000 }, async () => {
    let childRef = null;
    const { controller } = await make({
      probeHttp: async () => {
        // The server answered once, then died mid-probe: stale READY, dead child.
        childRef.fireExit(1);
        return READY;
      },
      spawnFn(cmd, args, opts) { childRef = childDouble(); return childRef; },
    });
    try {
      await assert.rejects(controller.start({ embedOrigin: ORIGIN }), (err) => { assertOcmsFailure(err); return true; });
      const status = await controller.status();
      assert.equal(status.state, 'OFFLINE', 'exit during probe reconciles to OFFLINE, got ' + JSON.stringify(status));
    } finally {
      assert.equal(await disposeSettled(controller), true, 'dispose settles (never waits unbounded)');
    }
  });
});
