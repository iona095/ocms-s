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
// spawn afterward and Start must not reach ONLINE. Disposal completion waits
// for the in-flight transition to settle, so a Start that adopts a child in
// the same tick can never escape the disposal window. Final state OFFLINE.
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
  let disposed = false;
  const disposeP = controller.dispose().then(() => { disposed = true; });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(disposed, false, 'disposal stays pending while a Start transition is in flight');
  gate.resolve('free');
  await assert.rejects(startP, (err) => {
    assertOcmsFailure(err, 'ocms/start-failed');
    return true;
  }, 'in-flight Start must reject once its Host instance is disposed');
  await disposeP;
  assert.equal(spawnCount, 0, 'no child spawns after disposal');
  assert.equal(record.spawned.length, 0, 'no spawn recorded after disposal');
  const status = await controller.status();
  assert.equal(status.state, 'OFFLINE', 'final state OFFLINE, not ONLINE/EXTERNAL');
  assert.equal(status.url, undefined, 'no stale URL after cancelled Start');
});

// Dispose after spawn while readiness is blocked: the exact owned child is
// terminated by the one termination authority, ownership is retained until
// its exit, a later READY is ignored, Start rejects, and disposal completes
// only on that exit. Final state OFFLINE.
test('disposal cancels Start blocked on readiness: one signal, ownership retained, completes on exact exit', { skip }, async () => {
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
  let disposed = false;
  const disposeP = controller.dispose().then(() => { disposed = true; });
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(childRef !== null, 'owned child handle observed');
  assert.deepEqual(childRef.killed, ['SIGTERM'], 'exactly one termination signal, no duplicate from the Start abort path');
  assert.equal(disposed, false, 'disposal stays pending while the child is alive');
  const duringDisposal = await controller.status();
  assert.equal(duringDisposal.state, 'STOPPING', 'disposal reports a terminating child, never OFFLINE with a live child');

  // Release a stale READY after disposal: it must be ignored.
  gate.resolve();
  await assert.rejects(startP, (err) => {
    assertOcmsFailure(err, 'ocms/start-failed');
    return true;
  }, 'disposed STARTING Start must reject even when readiness later reports READY');

  childRef.fireExit(0, null);
  await disposeP;
  const status = await controller.status();
  assert.equal(status.state, 'OFFLINE', 'final state OFFLINE, never ONLINE with no child');
  assert.equal(status.url, undefined, 'no stale URL after disposed STARTING');
  await assert.rejects(controller.stop(), (err) => {
    assertOcmsFailure(err, 'ocms/not-owned');
    return true;
  }, 'ownership released only by the exact exit');
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

// A child that never confirms its exit keeps disposal pending forever: the
// contract trades a blocked plugin unload for a guaranteed no-orphan Host.
test('disposal of an unconfirmable child stays pending and never reports OFFLINE', { skip }, async () => {
  let childRef = null;
  const { controller, record } = await make({
    probeHttp: readinessSequence([READY]),
    spawnFn(cmd, args, opts) {
      childRef = childDouble();
      childRef.spawnedArgs = { cmd, args, opts };
      record.spawned.push(childRef.spawnedArgs);
      return childRef;
    },
  });
  await controller.start({ embedOrigin: ORIGIN });
  let settled = false;
  let rejected = null;
  const disposeP = controller.dispose().then(
    () => { settled = true; },
    (err) => { settled = true; rejected = err; },
  );
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(settled, false, 'disposal must not complete without the exact child exit');
  assert.equal(rejected, null, 'disposal does not resolve or reject on a termination guess');
  assert.equal((await controller.status()).state, 'STOPPING', 'a terminating child is reported as STOPPING');
  assert.deepEqual(childRef.killed, ['SIGTERM'], 'one termination signal so far');

  // The exact exit is the only thing that completes disposal.
  childRef.fireExit(0, null);
  await disposeP;
  assert.equal(settled, true);
  assert.equal(rejected, null, 'exact-exit disposal resolves without a failure');
  const status = await controller.status();
  assert.equal(status.state, 'OFFLINE');
  assert.equal(status.url, undefined);
  assert.deepEqual(childRef.killed, ['SIGTERM'], 'no follow-up signal after the exit');
  assert.equal(record.spawned.length, 1);
});

// A dispose() that lands in the same tick as the spawn — before ownership is
// assigned — still inherits the child: the handle exists, so it is owned, and
// disposal waits for its exact exit.
test('disposal inherits a same-tick spawn and completes only on the exact exit', { skip }, async () => {
  let childRef = null;
  let disposeP = null;
  let controllerRef = null;
  const { controller, record } = await make({
    probeHttp: readinessSequence([READY]),
    spawnFn(cmd, args, opts) {
      childRef = childDouble();
      childRef.spawnedArgs = { cmd, args, opts };
      record.spawned.push(childRef.spawnedArgs);
      // Host disposal lands between the spawn and the ownership assignment.
      disposeP = controllerRef.dispose();
      return childRef;
    },
  });
  controllerRef = controller;
  const startP = controller.start({ embedOrigin: ORIGIN });
  startP.catch(() => {});
  await assert.rejects(startP, (err) => {
    assertOcmsFailure(err, 'ocms/start-failed');
    return true;
  }, 'a Start whose Host vanished during the spawn window fails without a second spawn');
  assert.equal(record.spawned.length, 1, 'exactly one child');
  assert.equal(childRef.killed.length, 1, 'one termination signal for the inherited child');
  assert.equal(childRef.killed[0], 'SIGTERM', 'the inherited child joins the one termination sequence');
  let disposed = false;
  const disposeObserved = disposeP.then(() => { disposed = true; });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(disposed, false, 'disposal does not complete while the inherited child is alive');
  assert.notEqual((await controller.status()).state, 'OFFLINE', 'no OFFLINE with a live child');

  childRef.fireExit(0, null);
  await disposeObserved;
  assert.equal(disposed, true);
  const status = await controller.status();
  assert.equal(status.state, 'OFFLINE', 'exact exit completes the inherited disposal');
  assert.equal(status.url, undefined);
  assert.equal(childRef.killed.length, 1, 'no duplicate termination signal');
});
