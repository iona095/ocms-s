// v1.4 ownership-retention regression tests (contract v1.4 sections 12, 19,
// 35, 44). Ownership is the exact spawned child handle: only that child's own
// 'exit' event releases it. A kill request, a kill() return value, a child
// 'error' event, a port probe, or elapsed time never release ownership, and no
// path may report OFFLINE while a retained child is still alive. Deterministic
// child doubles only.
import { test } from 'node:test';
import {
  assert,
  loadLifecycleModule,
  probeLifecycleCapability,
  makeDeps,
  assertOcmsFailure,
  childDouble,
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
const NOT_READY = { ok: false, status: 0, json: null };
const ORIGIN = 'http://127.0.0.1:3080';
const RETAINED_MESSAGE = 'The previous OCMS-S child has not exited.';

// A child double that records signals but never exits on its own, so the test
// owns the single exact-exit event.
function recordingChild(record) {
  const child = childDouble();
  child.spawnedArgs = { cmd: 'node', args: ['ui.mjs'], opts: { shell: false } };
  record.spawned.push(child.spawnedArgs);
  return child;
}

test('readiness deadline retains ownership until the exact child exit', { skip }, async () => {
  let childRef = null;
  const states = [];
  const { controller, record } = await make({
    probeHttp: async () => NOT_READY,
    deadlineMs: 5,
    intervalMs: 1,
    onState(status) { states.push(status.state); },
    spawnFn(cmd, args, opts) {
      childRef = childDouble();
      childRef.spawnedArgs = { cmd, args, opts };
      record.spawned.push(childRef.spawnedArgs);
      return childRef;
    },
  });

  await assert.rejects(controller.start({ embedOrigin: ORIGIN }), (err) => {
    assertOcmsFailure(err, 'ocms/readiness-timeout');
    return true;
  });
  assert.equal(record.spawned.length, 1, 'exactly one child');

  // The deadline is a failed Start, not a termination: the handle stays owned.
  const retained = await controller.status();
  assert.equal(retained.state, 'ERROR', 'deadline failure retains ERROR, not OFFLINE');
  assert.equal(typeof retained.message, 'string');
  const startingIndex = states.indexOf('STARTING');
  assert.ok(startingIndex >= 0, 'STARTING was observed');
  assert.equal(states.slice(startingIndex).includes('OFFLINE'), false, 'no OFFLINE from STARTING while the child is alive');
  assert.equal(childRef.killed[0], 'SIGTERM', 'one termination sequence was requested');
  assert.equal(new Set(childRef.killed).size, childRef.killed.length, 'no duplicate termination signal');

  await assert.rejects(controller.start({ embedOrigin: ORIGIN }), (err) => {
    assertOcmsFailure(err, 'ocms/start-failed');
    assert.equal(err.message, RETAINED_MESSAGE, 'Start refused while ownership is retained');
    return true;
  }, 'a second child must not spawn behind a possibly-live child');
  assert.equal(record.spawned.length, 1, 'no second spawn while ownership is retained');

  // The exact exit reconciles to OFFLINE and releases ownership.
  childRef.fireExit(137, 'SIGKILL');
  const reconciled = await controller.status();
  assert.equal(reconciled.state, 'OFFLINE', 'exact exit reconciles the retained ERROR');
  assert.equal(reconciled.url, undefined);
  await assert.rejects(controller.stop(), (err) => {
    assertOcmsFailure(err, 'ocms/not-owned');
    return true;
  }, 'ownership released by the exact exit');
});

// An 'error' event is not termination: Start fails promptly, but the handle
// stays owned until the exact exit arrives.
test('startup child error is not termination: ownership retained until the exact exit', { skip }, async () => {
  let childRef = null;
  const states = [];
  const { controller, record } = await make({
    deadlineMs: 5,
    intervalMs: 1,
    onState(status) { states.push(status.state); },
    spawnFn(cmd, args, opts) {
      childRef = childDouble();
      childRef.spawnedArgs = { cmd, args, opts };
      record.spawned.push(childRef.spawnedArgs);
      return childRef;
    },
    // The fault arrives on the first readiness probe, i.e. inside STARTING.
    probeHttp: async () => {
      childRef.fire('error', new Error('spawn transport fault'));
      return NOT_READY;
    },
  });

  await assert.rejects(controller.start({ embedOrigin: ORIGIN }), (err) => {
    assertOcmsFailure(err, 'ocms/start-failed');
    return true;
  }, 'a child error surfaces promptly, it is not waited out as a readiness timeout');

  const retained = await controller.status();
  assert.equal(retained.state, 'ERROR', 'child error retains ERROR, not OFFLINE');
  const startingIndex = states.indexOf('STARTING');
  assert.ok(startingIndex >= 0, 'STARTING was observed');
  assert.equal(states.slice(startingIndex).includes('OFFLINE'), false, 'no OFFLINE from STARTING while the child is alive');
  assert.equal(childRef.killed.length, 1, 'exactly one termination signal');
  await assert.rejects(controller.start({ embedOrigin: ORIGIN }), (err) => {
    assertOcmsFailure(err, 'ocms/start-failed');
    assert.equal(err.message, RETAINED_MESSAGE);
    return true;
  });
  assert.equal(record.spawned.length, 1, 'no second spawn while ownership is retained');

  childRef.fireExit(1, null);
  assert.equal((await controller.status()).state, 'OFFLINE', 'exact exit reconciles ERROR');
});

// Audit correction: an ONLINE child 'error' must not clear ownership or report
// OFFLINE. Ownership and the ERROR state hold until the exact exit.
test('ONLINE child error is not termination: ownership retained in ERROR until the exact exit', { skip }, async () => {
  let childRef = null;
  const states = [];
  const { controller, record } = await make({
    probeHttp: async () => READY,
    onState(status) { states.push(status.state); },
    spawnFn(cmd, args, opts) {
      childRef = recordingChild(record);
      childRef.spawnedArgs = { cmd, args, opts };
      return childRef;
    },
  });
  const started = await controller.start({ embedOrigin: ORIGIN });
  assert.equal(started.state, 'ONLINE');
  const onlineIndex = states.length;

  childRef.fire('error', new Error('stdio transport fault'));
  const afterError = await controller.status();
  assert.equal(afterError.state, 'ERROR', 'a child error is a fault, not a termination');
  assert.equal(afterError.url, undefined, 'no stale ONLINE url after the fault');
  assert.equal(states.slice(onlineIndex).includes('OFFLINE'), false, 'no OFFLINE without the exact exit');

  await assert.rejects(controller.start({ embedOrigin: ORIGIN }), (err) => {
    assertOcmsFailure(err, 'ocms/start-failed');
    assert.equal(err.message, RETAINED_MESSAGE);
    return true;
  }, 'a possibly-live child blocks a second spawn');
  assert.equal(record.spawned.length, 1, 'no second spawn while ownership is retained');

  childRef.fireExit(1, null);
  assert.equal((await controller.status()).state, 'OFFLINE', 'exact exit reconciles ERROR');
});

// The child can still be stopped from the retained ERROR state, and that stop
// joins the one termination authority instead of signalling again from scratch.
test('retained ERROR ownership is still stoppable and the exact exit releases it', { skip }, async () => {
  let childRef = null;
  const { controller, record } = await make({
    probeHttp: async () => READY,
    spawnFn(cmd, args, opts) {
      childRef = childDouble();
      childRef.spawnedArgs = { cmd, args, opts };
      record.spawned.push(childRef.spawnedArgs);
      const originalKill = childRef.kill.bind(childRef);
      childRef.kill = (signal) => {
        const out = originalKill(signal);
        setTimeout(() => childRef.fireExit(0, null), 0);
        return out;
      };
      return childRef;
    },
  });
  await controller.start({ embedOrigin: ORIGIN });
  childRef.fire('error', new Error('stdio transport fault'));
  assert.equal((await controller.status()).state, 'ERROR');

  const stopped = await controller.stop();
  assert.equal(stopped.state, 'OFFLINE', 'Stop from retained ERROR reaches OFFLINE');
  assert.deepEqual(childRef.killed, ['SIGTERM'], 'one termination sequence for the retained child');
  await assert.rejects(controller.stop(), (err) => {
    assertOcmsFailure(err, 'ocms/not-owned');
    return true;
  });
  assert.equal(record.spawned.length, 1);
});
