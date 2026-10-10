// v1.4.4 HMR sequencing tests (DSH 0.2.1-alpha.2 authority).
//
// The installed 0.2.1-alpha.2 HMR orders replacement as:
//   registry.delete(previous plugin)
//   -> old fibers dispose
//   -> await old fibers
//   -> reload replacement
// so the OCMS process-global generation coordinator is obsolete and removed.
// These tests prove the required OCMS-layer property, not implementation text:
// generations are never gated by OCMS itself; the async disposer (exact child
// exit) is what keeps an old Fiber unsettled; the framework owns the reload
// order. Cordis frees the service key synchronously on registry.delete and
// rejects duplicate keys, which is why the framework deletes before reloading.
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { Context, Service } from '@deepseek-ai/cordis';

import { assert, HOST_PATH, REPO_ROOT, nextTestPort } from './helpers.mjs';

const HOST_URL = pathToFileURL(HOST_PATH).href;

let hostLoadError = null;
try {
  await import(HOST_URL);
} catch (err) {
  hostLoadError = err;
}
const skip = hostLoadError
  ? 'capability missing: dsh/host.mjs must load in this runtime (' + (hostLoadError && hostLoadError.message) + ')'
  : false;

const COORDINATOR_KEY = Symbol.for('ocms-s/generation-coordinator');

let generationCounter = 0;

function generationModule() {
  generationCounter += 1;
  return import(HOST_URL + '?generation=' + generationCounter);
}

async function drain(ticks = 4) {
  for (let i = 0; i < ticks; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

function withTimeout(promise, ms, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ]);
}

// registry.delete owns the old teardown asynchronously: join retirement by
// polling the generation controller, never by re-disposing a detached fiber.
async function joinRetired(gen, ms, message) {
  const start = Date.now();
  while (gen.currentController() !== null) {
    if (Date.now() - start > ms) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function portFree(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port, timeout: 500 });
    socket.on('connect', () => { socket.destroy(); resolve(false); });
    socket.on('error', () => { socket.destroy(); resolve(true); });
    socket.on('timeout', () => { socket.destroy(); resolve(true); });
  });
}

// Minimal context seam with the shape apply() depends on: a root identity and
// a service registry that records instead of enforcing Cordis' one-provider
// rule, so same-process generations can be observed without a framework.
function seamContext(root) {
  const provided = [];
  return {
    root,
    fiber: { assertActive() {} },
    reflect: { provide(name, value) { provided.push({ name, value }); return () => {}; } },
    provided,
  };
}

// No OCMS-owned cross-generation gate may exist: applying (and disposing)
// generations must never create a process-global coordinator.
test('host creates no process-global generation coordinator', { skip }, async () => {
  assert.equal(globalThis[COORDINATOR_KEY], undefined, 'precondition: no coordinator leaks in from another suite');
  const genA = await generationModule();
  const genB = await generationModule();
  const disposeA = await genA.apply(seamContext(new Context()), {});
  assert.ok(genA.currentController() !== null, 'generation A published');
  const disposeB = await genB.apply(seamContext(new Context()), {});
  assert.ok(genB.currentController() !== null, 'generation B published without waiting');
  assert.equal(globalThis[COORDINATOR_KEY], undefined, 'no process-global lease coordinator may be created');
  await disposeA();
  await disposeB();
  assert.equal(globalThis[COORDINATOR_KEY], undefined, 'disposal leaves no coordinator behind');
  assert.equal(genA.currentController(), null, 'A retired');
  assert.equal(genB.currentController(), null, 'B retired');
});

// After the framework deletes the previous plugin, the replacement apply must
// publish immediately even while the old teardown is still unsettled. Any OCMS
// wait here is the removed lease blocking the framework's own ordering.
test('replacement publishes immediately after registry delete while old teardown is unsettled', { skip, timeout: 60_000 }, async () => {
  const root = new Context();
  const genA = await generationModule();
  const genB = await generationModule();

  const fiberA = root.plugin(genA.apply, {});
  await withTimeout(fiberA, 10_000, 'ocms/hmr-test: generation A did not publish');
  const controllerA = genA.currentController();
  assert.ok(controllerA !== null, 'generation A published');

  // Hold the old teardown pending: the framework deletion frees the service
  // key synchronously, but retirement must stay open until this gate releases.
  let releaseOld = null;
  const gate = new Promise((resolve) => { releaseOld = resolve; });
  const originalDispose = controllerA.dispose.bind(controllerA);
  controllerA.dispose = () => gate.then(() => originalDispose());

  let fiberB = null;
  try {
    root.registry.delete(genA.apply);
    fiberB = root.plugin(genB.apply, {});
    await withTimeout(fiberB, 10_000, 'ocms/hmr-test: replacement did not publish while the old teardown was unsettled (OCMS is still gating generations)');
    assert.ok(genB.currentController() !== null, 'replacement published without waiting for old retirement');
    assert.ok(genB.currentController() !== controllerA, 'replacement owns exactly one fresh controller');
    assert.equal((await genB.currentController().status()).state, 'OFFLINE', 'replacement starts idle with no child');

    releaseOld();
    await joinRetired(genA, 10_000, 'ocms/hmr-test: old generation did not retire after disposal released');
  } finally {
    releaseOld?.();
    await joinRetired(genA, 10_000, 'cleanup: old generation did not retire').catch(() => {});
    if (fiberB !== null) await fiberB.dispose().catch(() => {});
  }
  assert.equal(genB.currentController(), null, 'replacement retired cleanly');
});

// Framework order delete -> await retirement -> reload yields exactly one
// replacement controller and retires the previous generation.
test('framework delete-await-reload order yields exactly-once replacement', { skip, timeout: 60_000 }, async () => {
  const root = new Context();
  const genA = await generationModule();
  const genB = await generationModule();

  const fiberA = root.plugin(genA.apply, {});
  await withTimeout(fiberA, 10_000, 'ocms/hmr-test: generation A did not publish');
  assert.ok(genA.currentController() !== null, 'generation A published');

  root.registry.delete(genA.apply);
  await joinRetired(genA, 10_000, 'ocms/hmr-test: old generation did not retire');
  assert.equal(genA.currentController(), null, 'old generation retired');

  const fiberB = root.plugin(genB.apply, {});
  await withTimeout(fiberB, 10_000, 'ocms/hmr-test: replacement did not publish');
  try {
    assert.ok(genB.currentController() !== null, 'replacement published exactly once');
    assert.equal(root.get('ocmsLifecycleService').typertRemote.namespace, 'ocms', 'single live service on the new namespace');
  } finally {
    await fiberB.dispose();
  }
  assert.equal(genB.currentController(), null, 'replacement retired cleanly');
});

// Cordis frees the service key synchronously on registry.delete and rejects
// duplicate keys on one root, which is why the framework must delete the
// previous plugin before reloading the replacement.
test('service key freed on delete, duplicates rejected', { skip }, async () => {
  const root = new Context();
  class Dup extends Service {
    constructor(ctx) { super(ctx, 'ocms-hmr-test-dup'); }
  }
  const first = (ctx) => { new Dup(ctx); };
  const fiber = root.plugin(first, {});
  await fiber;
  root.registry.delete(first);
  const second = (ctx) => { new Dup(ctx); };
  const fiber2 = root.plugin(second, {});
  await fiber2;
  await assert.rejects(
    (async () => { await root.plugin((ctx) => { new Dup(ctx); }, {}); })(),
    /has been registered/,
    'second provider on one root must be rejected',
  );
  await fiber2.dispose();
  // The first fiber was already retired by registry.delete (which owns its
  // teardown); a detached handle has no disposer left to call.
});

// End-to-end with a real child: the old teardown stays open (and the child
// stays alive) until the exact child exit; only then does retirement complete
// and the replacement proceed. No second child can become active: the
// replacement starts idle and spawns nothing on its own.
test('live child keeps old teardown open until its exact exit, then replacement proceeds', {
  skip: skip || (!fs.existsSync(path.join(REPO_ROOT, 'ui.mjs')) ? 'capability missing: ui.mjs' : false),
  timeout: 120_000,
}, async (t) => {
  const root = new Context();
  const port = nextTestPort();
  if (!await portFree(port)) {
    t.skip('an unrelated listener owns the derived test port ' + port);
    return;
  }
  const genA = await generationModule();
  const genB = await generationModule();

  let controllerA = null;
  let fiberB = null;
  let releaseOld = null;
  try {
    const fiberA = root.plugin(genA.apply, { port });
    await withTimeout(fiberA, 10_000, 'ocms/hmr-test: generation A did not publish');
    controllerA = genA.currentController();
    assert.ok(controllerA !== null, 'generation A published');
    const started = await controllerA.start({ embedOrigin: 'http://127.0.0.1:3080' });
    assert.equal(started.state, 'ONLINE', 'the real ui.mjs child became ready');

    // Hold retirement before the real termination so the pending window is
    // observable: teardown open, child alive, replacement not requested.
    const gate = new Promise((resolve) => { releaseOld = resolve; });
    const originalDispose = controllerA.dispose.bind(controllerA);
    controllerA.dispose = () => gate.then(() => originalDispose());

    root.registry.delete(genA.apply);
    const retired = (async () => { await joinRetired(genA, 60_000, 'late'); })();
    let done = false;
    void retired.then(() => { done = true; }, () => { done = true; });
    await drain(8);
    assert.equal(done, false, 'old teardown remains open while disposal is held');
    assert.equal((await controllerA.status()).state, 'ONLINE', 'owned child still alive while disposal is held');
    assert.equal(await portFree(port), false, 'child still owns its port while disposal is held');

    releaseOld();
    releaseOld = null;
    await withTimeout(retired, 30_000, 'ocms/hmr-test: old teardown did not complete after the exact child exit');
    assert.equal(genA.currentController(), null, 'retired generation reports no controller');
    assert.equal(await portFree(port), true, 'exact exit freed the port');
    controllerA = null;

    fiberB = root.plugin(genB.apply, { port });
    await withTimeout(fiberB, 10_000, 'ocms/hmr-test: replacement did not publish after old retirement');
    assert.ok(genB.currentController() !== null, 'replacement published after old retirement');
    const replacement = await genB.currentController().status();
    assert.equal(replacement.state, 'OFFLINE', 'replacement starts idle and spawned no second child');
  } finally {
    releaseOld?.();
    // Never leave a real child behind, whatever the assertions did.
    if (controllerA !== null) {
      try { await controllerA.stop(); } catch { /* already gone or unconfirmable */ }
    }
    const live = genB.currentController();
    if (live !== null && live !== undefined) {
      try { await live.stop(); } catch { /* nothing owned */ }
    }
    if (fiberB !== null) await fiberB.dispose();
  }
});
