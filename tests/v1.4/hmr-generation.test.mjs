// v1.4 generation-handoff regression tests (contract v1.4 sections 19, 29, 38,
// 45). Two Host plugin module generations can be live in one DSH process at the
// same time: Cordis HMR imports the replacement, drops the retiring plugin from
// the registry, and starts unloading the old fiber WITHOUT awaiting its
// disposer. The retiring generation's owned child must be gone before the
// replacement publishes, so one Host root can never have two children.
//
// Each `?generation=` import below is a distinct ESM module instance of
// dsh/host.mjs sharing one process-global coordinator, which is what the
// installed HMR plugin produces. The fiber-based cases drive the real
// ctx.plugin()/fiber.dispose() path HMR uses; the last case uses a minimal
// context seam to exercise the lease protocol itself.
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

let generationCounter = 0;

function generationModule() {
  generationCounter += 1;
  return import(HOST_URL + '?generation=' + generationCounter);
}

async function drain(ticks = 4) {
  for (let i = 0; i < ticks; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

function portFree(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port, timeout: 500 });
    socket.on('connect', () => { socket.destroy(); resolve(false); });
    socket.on('error', () => { socket.destroy(); resolve(true); });
    socket.on('timeout', () => { socket.destroy(); resolve(true); });
  });
}

// A context seam with the shape apply() depends on: one root identity for the
// per-root lease, an assertActive fence, and a service registry that records
// instead of enforcing Cordis' one-provider rule.
function seamContext(root) {
  const provided = [];
  return {
    root,
    fiber: { assertActive() {} },
    reflect: { provide(name, value) { provided.push({ name, value }); return () => {}; } },
    provided,
  };
}

// The first generation of a process takes the per-root lease immediately; a
// replacement generation waits for the retiring generation's exact-exit
// disposal. This is the HMR sequence: registry.delete -> fiber.dispose() without
// awaiting, then the replacement's apply.
test('a replacement generation publishes only after the retiring generation disposes', { skip }, async () => {
  const root = new Context();
  const genA = await generationModule();
  const genB = await generationModule();

  const fiberA = root.plugin(genA.apply, {});
  await fiberA;
  const controllerA = genA.currentController();
  assert.ok(controllerA !== null, 'the first generation publishes without waiting');

  const fiberB = root.plugin(genB.apply, {});
  await drain();
  assert.equal(genB.currentController(), null, 'no controller is published before the lease is free');

  const retiring = fiberA.dispose();
  await retiring;
  await fiberB;
  assert.ok(genB.currentController() !== null, 'the replacement publishes after the release');
  assert.notEqual(genB.currentController(), controllerA, 'each generation owns a distinct controller');
  assert.equal(genA.currentController(), null, 'the retired generation reports no controller');

  await fiberB.dispose();
  assert.equal(genB.currentController(), null, 'the disposed generation reports no controller');
});

// A/B/C: the middle generation is superseded while queued. Publishing it after
// the release would put a stale controller behind the newest one.
test('a superseded queued generation never publishes (no stale publication)', { skip }, async () => {
  const root = new Context();
  const genA = await generationModule();
  const genB = await generationModule();
  const genC = await generationModule();

  const fiberA = root.plugin(genA.apply, {});
  await fiberA;
  const fiberB = root.plugin(genB.apply, {});
  const fiberC = root.plugin(genC.apply, {});
  await drain();
  assert.equal(genB.currentController(), null, 'B is queued, not published');
  assert.equal(genC.currentController(), null, 'C is queued, not published');

  await fiberA.dispose();
  await fiberC;
  assert.ok(genC.currentController() !== null, 'the newest generation takes the free lease');
  assert.equal(genB.currentController(), null, 'the superseded generation publishes nothing');

  await fiberB;
  assert.equal(genB.currentController(), null, 'the superseded generation stays unpublished after the handoff');
  assert.ok(genC.currentController() !== null, 'the newest generation stays published');

  await fiberB.dispose();
  await fiberC.dispose();
  assert.equal(genC.currentController(), null);
});

// A setup failure after the lease is taken must not strand it: the next
// generation would otherwise wait forever for a holder that never published.
test('a setup failure releases the lease instead of deadlocking the next generation', { skip, timeout: 30_000 }, async () => {
  const root = new Context();
  const genA = await generationModule();
  const genB = await generationModule();

  // Publication fails after the lease was already taken.
  const broken = seamContext(root);
  broken.reflect.provide = () => { throw new Error('ocms/hmr-test: publication refused'); };
  await assert.rejects(genA.apply(broken, {}), /publication refused/);
  assert.equal(genA.currentController(), null, 'a failed setup publishes no controller');

  const fiberB = root.plugin(genB.apply, {});
  await fiberB;
  assert.ok(genB.currentController() !== null, 'the lease was free again, so the next generation loads');
  await fiberB.dispose();
});

// Per-root isolation: a held lease on one root must not gate another root, and
// the held root must still hand over only on its own release.
test('per-root isolation: a held lease on one root does not gate another root', { skip }, async () => {
  const rootA = new Context();
  const rootB = new Context();
  const genA = await generationModule();
  const genB = await generationModule();
  const genC = await generationModule();

  const fiberA = rootA.plugin(genA.apply, {});
  await fiberA;
  assert.ok(genA.currentController() !== null, 'root A generation published');

  const fiberB = rootA.plugin(genB.apply, {});
  let settledB = false;
  fiberB.then(() => { settledB = true; });
  const fiberC = rootB.plugin(genC.apply, {});
  await fiberC;
  assert.ok(genC.currentController() !== null, 'root B published without waiting for root A');
  await drain();
  assert.equal(settledB, false, 'root A is still held by generation A');
  assert.equal(genB.currentController(), null, 'the queued root A generation publishes nothing');

  await fiberA.dispose();
  await fiberB;
  assert.ok(genB.currentController() !== null, 'root A hands over only after its holder disposes');
  assert.ok(genC.currentController() !== null, 'root B was never gated by root A');

  await fiberB.dispose();
  await fiberC.dispose();
});

// Lease protocol at the seam: a repeated disposal cannot free a lease the next
// generation already holds, and a duplicate apply of one module generation is
// serialized instead of publishing a second controller beside the first.
test('lease protocol: repeated disposal and duplicate applies never overlap', { skip }, async () => {
  const root = new Context();
  const genA = await generationModule();
  const genB = await generationModule();

  const ctxA = seamContext(root);
  const disposeA = await genA.apply(ctxA, {});
  const controllerA = genA.currentController();
  assert.ok(controllerA !== null, 'the first apply published');
  assert.equal(ctxA.provided.length, 1, 'exactly one service registration');

  // A duplicate apply of the SAME module generation must queue, not publish.
  const duplicate = genA.apply(seamContext(root), {});
  await drain();
  assert.equal(genA.currentController(), controllerA, 'the duplicate apply publishes nothing while the lease is held');
  assert.equal(ctxA.provided.length, 1, 'still exactly one service registration');

  // A different generation waits too.
  let publishedB = false;
  const applyB = genB.apply(seamContext(root), {}).then((dispose) => { publishedB = true; return dispose; });
  await drain();
  assert.equal(publishedB, false, 'a different generation is queued as well');

  await disposeA();
  const disposeB = await applyB;
  assert.ok(genB.currentController() !== null, 'B holds the lease after the release');
  assert.equal(genA.currentController(), null, 'the retired generation reports no controller');

  // Stale re-invocations of the retired disposer must not free B's lease.
  await disposeA();
  await disposeA();
  await drain();
  assert.ok(genB.currentController() !== null, 'B keeps the lease after stale disposals');
  assert.equal(publishedB, true);

  const disposeDuplicate = await duplicate;
  await disposeDuplicate;
  assert.equal(genA.currentController(), null, 'the duplicate apply never published a controller');
  assert.ok(genB.currentController() !== null, 'B is unaffected by the duplicate apply');

  await disposeB();
  assert.equal(genB.currentController(), null);
});

// End-to-end with a real child: while the retiring generation's ui.mjs child is
// alive, the replacement stays unpublished, and only the exact child exit
// completes disposal and hands the lease over.
test('a live child keeps the replacement unpublished until its exact exit', {
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
  let disposeA = null;
  let disposeB = null;
  try {
    const fiberA = root.plugin(genA.apply, { port });
    await fiberA;
    controllerA = genA.currentController();
    assert.ok(controllerA !== null, 'generation A published');
    const started = await controllerA.start({ embedOrigin: 'http://127.0.0.1:3080' });
    assert.equal(started.state, 'ONLINE', 'the real ui.mjs child became ready');

    const fiberB = root.plugin(genB.apply, { port });
    disposeB = fiberB.dispose;
    let settledB = false;
    const stateAtPublication = [];
    const observedB = fiberB.then(async () => {
      settledB = true;
      // Sampled at publication: the retiring generation's controller can only
      // report OFFLINE once its exact child exit released ownership.
      stateAtPublication.push((await controllerA.status()).state);
    });
    await drain();
    assert.equal(settledB, false, 'the replacement has not finished loading while the child is alive');
    assert.equal(genB.currentController(), null, 'no controller published by the replacement');

    await fiberA.dispose();
    assert.deepEqual(stateAtPublication, ['OFFLINE'], 'the replacement published only after the exact child exit');
    assert.equal(genA.currentController(), null, 'the retired generation reports no controller');
    assert.equal((await controllerA.status()).url, undefined, 'no stale ONLINE claim survives the handoff');
    controllerA = null;

    await observedB;
    assert.equal(settledB, true, 'the replacement finished loading');
    assert.ok(genB.currentController() !== null, 'the replacement publishes after the exact exit');
    const replacement = await genB.currentController().status();
    assert.equal(replacement.state, 'OFFLINE', 'the replacement starts idle, never inheriting a stale ONLINE claim');
    disposeA = null;
  } finally {
    // Never leave a real child behind, whatever the assertions did.
    if (controllerA !== null) {
      try { await controllerA.stop(); } catch { /* already gone or unconfirmable */ }
    }
    if (disposeA !== null) {
      try { await disposeA(); } catch { /* pending until the exact exit */ }
    }
    const live = genB.currentController();
    if (live !== null && live !== undefined) {
      try { await live.stop(); } catch { /* nothing owned */ }
    }
    if (disposeB !== null) await disposeB();
  }
});
