// C11 / C12: lifecycle logger and stop-retry hardening (contract v1.4 sections 19, 35, 44).
//
// C11: the child event handlers must use the guarded logger. `log` is a
// documented-optional dep, and four sites called it directly, so a host with a
// partial logger threw a TypeError inside an EventEmitter handler.
// C12: a failed stop (no exit after force termination) cached the failed
// termination attempt, so every later Stop returned stop-failed with zero new
// signals while ownership stayed with the still-alive child.
//
// Deterministic doubles only: no real processes.
import { test } from 'node:test';
import {
  assert, loadLifecycleModule, probeLifecycleCapability, makeDeps, readinessSequence,
  assertOcmsFailure, childDouble, nextTestPort,
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

test('C11: a partial logger never throws out of a child event handler', { skip }, async () => {
  // Only `error` exists; info and warn are absent, as the optional dep allows.
  const seen = [];
  let childRef = null;
  const { controller } = await make({
    probeHttp: readinessSequence([{ ok: false, status: 0, json: null }]),
    log: { error(message) { seen.push(String(message)); } },
    spawnFn(cmd, args, opts) { childRef = childDouble({ pid: nextTestPort() }); childRef.spawnedArgs = { cmd, args, opts }; return childRef; },
  });
  const pending = controller.start({ embedOrigin: 'http://127.0.0.1:3080' });
  await new Promise((resolve) => setTimeout(resolve, 5));
  // The child fails while STARTING: the STARTING branch logs through `log.error`.
  assert.equal(typeof childRef.fire, 'function', 'a child was spawned');
  let escaped = null;
  try { childRef.fire('error', new Error('synthetic start failure')); } catch (err) { escaped = err; }
  assert.equal(escaped, null, 'a partial logger must not throw out of the error handler: ' + String(escaped && escaped.message));
  childRef.fireExit(1, null);
  await assert.rejects(pending, (err) => { assertOcmsFailure(err); return true; });
  assert.ok(seen.length >= 1, 'the guarded logger received the diagnostic');
  const status = await controller.status();
  assert.equal(status.state, 'OFFLINE');
});

test('C11: an ONLINE child warning path also survives a partial logger', { skip }, async () => {
  const seen = [];
  let childRef = null;
  const { controller } = await make({
    probeHttp: readinessSequence([READY]),
    log: { error(message) { seen.push(String(message)); } },
    spawnFn(cmd, args, opts) { childRef = childDouble({ pid: nextTestPort() }); childRef.spawnedArgs = { cmd, args, opts }; return childRef; },
  });
  const started = await controller.start({ embedOrigin: 'http://127.0.0.1:3080' });
  assert.equal(started.state, 'ONLINE');
  // Unexpected exit while ONLINE goes through the warn branch.
  childRef.fireExit(0, null);
  const status = await controller.status();
  assert.equal(status.state, 'OFFLINE');
});

test('C12: a failed stop is retried instead of returning the cached failure with zero signals', { skip }, async () => {
  let childRef = null;
  const { controller, record } = await make({
    probeHttp: readinessSequence([READY]),
    spawnFn(cmd, args, opts) { childRef = childDouble({ pid: nextTestPort() }); childRef.spawnedArgs = { cmd, args, opts }; record.spawned.push(childRef.spawnedArgs); return childRef; },
  });
  const started = await controller.start({ embedOrigin: 'http://127.0.0.1:3080' });
  assert.equal(started.state, 'ONLINE');
  // The child never exits: the graceful signal, the force signal and the bounded
  // wait all fail. Ownership must stay with the handle.
  await assert.rejects(controller.stop(), (err) => { assertOcmsFailure(err); assert.equal(err.code, 'ocms/stop-failed'); return true; });
  const signalsAfterFirst = childRef.killed.length;
  assert.ok(signalsAfterFirst >= 1, 'the first stop signalled the child');
  // A second Stop must make a new attempt (new signals), not reuse the cached false.
  await assert.rejects(controller.stop(), (err) => { assertOcmsFailure(err); assert.equal(err.code, 'ocms/stop-failed'); return true; });
  assert.ok(childRef.killed.length > signalsAfterFirst, 'the retry signals the still-owned child again, got ' + JSON.stringify(childRef.killed));
  const status = await controller.status();
  assert.equal(status.state, 'ERROR', 'a failed stop keeps ownership in ERROR');
  // The retry must not double-signal while an attempt is in flight: two
  // concurrent stops join one attempt.
  const before = childRef.killed.length;
  const [a, b] = await Promise.allSettled([controller.stop(), controller.stop()]);
  assert.equal(a.status, 'rejected');
  assert.equal(b.status, 'rejected');
  assert.ok(childRef.killed.length - before <= 2, 'concurrent stops do not each force-kill; signals ' + JSON.stringify(childRef.killed.slice(before)));
  // The child finally confirms its exit: ownership clears on the exact event.
  childRef.fireExit(0, null);
  const finalStatus = await controller.status();
  assert.notEqual(finalStatus.state, 'ONLINE');
});
