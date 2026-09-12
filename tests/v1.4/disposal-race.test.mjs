// v1.4 disposal-vs-Start race regression tests (contract v1.4 section 19).
// Frozen gate: Host disposal MUST cancel an in-flight Start. A child MUST NOT
// spawn after disposal, and a disposed STARTING operation MUST NOT transition
// to ONLINE — not even with a stale READY. Deterministic doubles only.
import { test } from 'node:test';
import {
  assert,
  loadLifecycleModule,
  probeLifecycleCapability,
  makeDeps,
  readinessSequence,
  assertOcmsFailure,
  childDouble,
  deferred,
} from './helpers.mjs';

const hasLifecycle = await probeLifecycleCapability();
const skip = !hasLifecycle ? 'capability missing: dsh/lifecycle.mjs must export createLifecycleController(deps)' : false;

async function make(overrides = {}) {
  const { deps, record } = makeDeps(overrides);
  const { createLifecycleController } = await loadLifecycleModule();
  const controller = createLifecycleController(deps);
  return { controller, deps, record };
}

const READY = { ok: true, status: 200, json: { ok: true } };
const ORIGIN = 'http://127.0.0.1:3080';

// Dispose while Start is blocked on the pre-spawn port probe: no child may
// spawn afterward and Start must not reach ONLINE. Final state OFFLINE.
test('disposal cancels Start blocked before spawn: zero spawn, no ONLINE, final OFFLINE', { skip }, async () => {
  const gate = deferred();
  let spawnCount = 0;
  const { controller, record } = await make({
    probePort: () => gate.promise,
    spawnFn(cmd, args, opts) {
      spawnCount += 1;
      const child = childDouble();
      child.spawnedArgs = { cmd, args, opts };
      record.spawned.push(child.spawnedArgs);
      return child;
    },
    probeHttp: readinessSequence([READY]),
  });
  const startP = controller.start({ embedOrigin: ORIGIN });
  // Prevent unhandled rejection while disposal wins the race.
  startP.catch(() => {});
  await new Promise((r) => setTimeout(r, 10));
  await controller.dispose();
  gate.resolve('free');
  await assert.rejects(startP, (err) => {
    assertOcmsFailure(err, 'ocms/start-failed');
    return true;
  }, 'in-flight Start must reject once its Host instance is disposed');
  assert.equal(spawnCount, 0, 'no child spawns after disposal');
  assert.equal(record.spawned.length, 0, 'no spawn recorded after disposal');
  const status = await controller.status();
  assert.equal(status.state, 'OFFLINE', 'final state OFFLINE, not ONLINE/EXTERNAL');
  assert.equal(status.url, undefined, 'no stale URL after cancelled Start');
});

// Dispose after spawn while readiness is blocked: the exact owned child is
// terminated, a later READY is ignored, Start rejects, final OFFLINE.
test('disposal cancels Start blocked on readiness: child terminated, READY ignored, final OFFLINE', { skip }, async () => {
  const gate = deferred();
  let childRef = null;
  const { controller, record } = await make({
    probePort: async () => 'free',
    spawnFn(cmd, args, opts) {
      childRef = childDouble();
      childRef.spawnedArgs = { cmd, args, opts };
      record.spawned.push(childRef.spawnedArgs);
      return childRef;
    },
    probeHttp: () => gate.promise.then(() => READY),
  });
  const startP = controller.start({ embedOrigin: ORIGIN });
  startP.catch(() => {});
  // Wait until the child has spawned and Start is parked on readiness.
  for (let i = 0; i < 100 && record.spawned.length === 0; i += 1) {
    await new Promise((r) => setTimeout(r, 5));
  }
  assert.equal(record.spawned.length, 1, 'child spawned before disposal');
  await controller.dispose();
  assert.ok(childRef !== null, 'owned child handle observed');
  assert.ok(childRef.killed.length >= 1, 'exact owned child terminated at disposal');
  // Release a stale READY after disposal: it must be ignored.
  gate.resolve();
  await assert.rejects(startP, (err) => {
    assertOcmsFailure(err, 'ocms/start-failed');
    return true;
  }, 'disposed STARTING Start must reject even when readiness later reports READY');
  const status = await controller.status();
  assert.equal(status.state, 'OFFLINE', 'final state OFFLINE, never ONLINE with no child');
  assert.equal(status.url, undefined, 'no stale URL after disposed STARTING');
});

// A permanently disposed controller refuses a later Start with zero spawn.
test('start after permanent controller disposal is refused with zero spawn', { skip }, async () => {
  const { controller, record } = await make({
    probeHttp: readinessSequence([READY, READY]),
    spawnFn(cmd, args, opts) {
      const child = childDouble();
      child.spawnedArgs = { cmd, args, opts };
      record.spawned.push(child.spawnedArgs);
      const origKill = child.kill.bind(child);
      child.kill = (signal) => {
        const out = origKill(signal);
        // Bounded stop completes promptly: exit on the next macrotask.
        setTimeout(() => child.fireExit(0, null), 0);
        return out;
      };
      return child;
    },
  });
  await controller.start({ embedOrigin: ORIGIN });
  assert.equal(record.spawned.length, 1, 'initial Start spawns once');
  await controller.dispose();
  const after = await controller.status();
  assert.equal(after.state, 'OFFLINE');
  await assert.rejects(controller.start({ embedOrigin: ORIGIN }), (err) => {
    assertOcmsFailure(err, 'ocms/start-failed');
    return true;
  }, 'Start after disposal must be refused');
  assert.equal(record.spawned.length, 1, 'refused Start spawns nothing');
});
