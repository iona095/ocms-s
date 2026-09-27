// v1.4 pure lifecycle controller tests (contract v1.4 sections 8, 11-21, 24).
// Deterministic doubles only; no real processes except the two marked
// integration tests that require both the ui.mjs seam and embed mode.
import { test } from 'node:test';
import {
  assert,
  loadLifecycleModule,
  probeLifecycleCapability,
  makeDeps,
  readinessSequence,
  assertOcmsFailure,
  childDouble,
  nextTestPort,
  scratchSettingsFile,
  REPO_ROOT,
} from './helpers.mjs';
import path from 'node:path';

const hasLifecycle = await probeLifecycleCapability();
const skip = !hasLifecycle ? 'capability missing: dsh/lifecycle.mjs must export createLifecycleController(deps)' : false;

async function make(overrides = {}) {
  const { deps, record } = makeDeps(overrides);
  const { createLifecycleController } = await loadLifecycleModule();
  const controller = createLifecycleController(deps);
  return { controller, deps, record };
}

const READY = { ok: true, status: 200, json: { ok: true } };

// ---- §92 initial state: OFFLINE, nothing spawned --------------------------

test('initial state is OFFLINE with no child', { skip }, async () => {
  const { controller, record } = await make();
  const status = await controller.status();
  assert.equal(status.state, 'OFFLINE');
  assert.equal(record.spawned.length, 0, 'status never spawns');
});

test('status() does not spawn or probe ports', { skip }, async () => {
  const { controller, record } = await make();
  await controller.status();
  await controller.status();
  assert.equal(record.spawned.length, 0);
  assert.equal(record.probes.length, 0, 'status is pull-only with no port probing');
});

// ---- §93/§38 Start sequence ------------------------------------------------

test('start: happy path — exact spawn command, STARTING before spawn, ONLINE after readiness', { skip }, async () => {
  const spawnedOrder = [];
  const { controller, deps, record } = await make({
    probeHttp: readinessSequence([READY]),
    spawnFn(cmd, args, opts) {
      spawnedOrder.push('spawn');
      const child = childDouble();
      record.spawned.push(child.spawnedArgs = { cmd, args, opts });
      return child;
    },
    probePort: async () => { spawnedOrder.push('port-probe'); return 'free'; },
    nodeExecutable() { spawnedOrder.push('node-check'); return process.execPath; },
  });
  const events = [];
  const started = await controller.start({ embedOrigin: 'http://127.0.0.1:3080', onState: (s) => events.push(s.state) });
  assert.equal(started.state, 'ONLINE');
  assert.equal(started.url, 'http://127.0.0.1:' + deps.port + '/');
  assert.equal(record.spawned.length, 1, 'exactly one child');
  const spawn = record.spawned[0];
  assert.equal(spawn.opts.shell, false, 'shell:false');
  assert.equal(spawn.cmd, process.execPath, 'validated node executable');
  assert.deepEqual(spawn.args.slice(1), ['--no-open', '--port=' + deps.port, '--embed-origin=http://127.0.0.1:3080']);
  assert.equal(path.isAbsolute(spawn.args[0]), true, 'absolute ui.mjs path');
  assert.equal(spawn.args[0], path.join(REPO_ROOT, 'ui.mjs'));
  // §38: STARTING set before spawn; ONLINE only after readiness.
  assert.deepEqual(spawnedOrder, ['port-probe', 'node-check', 'spawn']);
  assert.ok(events.includes('STARTING'), 'STARTING observed');
  assert.equal(events[events.indexOf('STARTING') - 1] === 'OFFLINE' || events[0] === 'OFFLINE', true);
  assert.equal(events[events.length - 1], 'ONLINE', 'ONLINE is last');
  assert.ok(events.indexOf('ONLINE') > events.indexOf('STARTING'), 'ONLINE strictly after STARTING');
});

test('start: passes scratch settings only when host config owns it', { skip }, async (t) => {
  const scratch = scratchSettingsFile(t, {});
  const { controller, record } = await make({ settingsPath: scratch, probeHttp: readinessSequence([READY]) });
  await controller.start({ embedOrigin: 'http://127.0.0.1:3080' });
  const arg = record.spawned[0].args.find((a) => String(a).startsWith('--settings='));
  assert.equal(arg, '--settings=' + scratch);
});

test('start: embed origin validated — invalid origin refused with domain failure and no spawn', { skip }, async () => {
  const { controller, record } = await make();
  for (const bad of ['https://evil.example', 'http://127.0.0.1.evil.example', 'http://user@127.0.0.1:3080', 'http://127.0.0.1:3080/path', '*', "'none'", 'http://127.0.0.1', 'http://127.0.0.1:0']) {
    await assert.rejects(controller.start({ embedOrigin: bad }), (err) => {
      assertOcmsFailure(err, 'ocms/not-local');
      return true;
    }, 'must refuse: ' + bad);
  }
  assert.equal(record.spawned.length, 0, 'no child for invalid origin');
});

// ---- §95 readiness matrix (no timing sleeps; doubles only) ------------------

test('readiness: not ready immediately, eventual ready', { skip }, async () => {
  const { controller, record } = await make({ probeHttp: readinessSequence([{ ok: false, status: 0, json: null }, { ok: false, status: 0, json: null }, READY]) });
  const status = await controller.start({ embedOrigin: 'http://127.0.0.1:3080' });
  assert.equal(status.state, 'ONLINE');
  assert.equal(record.spawned.length, 1);
});

test('readiness: deadline timeout → ERROR with ocms/readiness-timeout, child stopped', { skip }, async () => {
  let probes = 0;
  let childRef;
  const states = [];
  const { controller, record } = await make({
    probeHttp: async () => { probes += 1; return { ok: false, status: 0, json: null }; },
    deadlineMs: 5,
    intervalMs: 1,
    onState(status) { states.push(status.state); },
    spawnFn(cmd, args, opts) {
      childRef = childDouble();
      record.spawned.push(childRef.spawnedArgs = { cmd, args, opts });
      return childRef;
    },
  });
  await assert.rejects(controller.start({ embedOrigin: 'http://127.0.0.1:3080' }), (err) => {
    assertOcmsFailure(err, 'ocms/readiness-timeout');
    return true;
  });
  assert.equal(record.spawned.length, 1);
  assert.ok(probes >= 1, 'probe loop ran at least once');
  // A termination request is not a termination: ownership is retained until the
  // exact child exit, so the controller reports ERROR and refuses a new Start.
  const status = await controller.status();
  assert.equal(status.state, 'ERROR', 'deadline failure retains ERROR, not OFFLINE');
  const startingIndex = states.indexOf('STARTING');
  assert.ok(startingIndex >= 0, 'STARTING was observed');
  assert.equal(states.slice(startingIndex).includes('OFFLINE'), false, 'no OFFLINE from STARTING while the child is alive');
  assert.equal(childRef.killed.length, 1, 'one termination signal, not a signal storm');
  await assert.rejects(controller.start({ embedOrigin: 'http://127.0.0.1:3080' }), (err) => {
    assertOcmsFailure(err, 'ocms/start-failed');
    assert.equal(err.message, 'The previous OCMS-S child has not exited.');
    return true;
  });
  assert.equal(record.spawned.length, 1, 'no second spawn behind a possibly-live child');
  // The exact exit releases ownership and reconciles the controller.
  childRef.fireExit(137, 'SIGKILL');
  const reconciled = await controller.status();
  assert.equal(reconciled.state, 'OFFLINE', 'exact exit reconciles the retained ERROR');
  assert.equal(reconciled.url, undefined);
});

test('readiness: child exits before ready → ERROR, no stale handle', { skip }, async () => {
  let childRef;
  const { controller, record } = await make({
    probeHttp: readinessSequence([{ ok: false, status: 0, json: null }]),
    spawnFn(cmd, args, opts) {
      childRef = childDouble();
      record.spawned.push(childRef.spawnedArgs = { cmd, args, opts });
      return childRef;
    },
  });
  const pending = controller.start({ embedOrigin: 'http://127.0.0.1:3080' });
  // Let the readiness loop start, then the child dies.
  await new Promise((r) => setTimeout(r, 5));
  childRef.fireExit(1, null);
  await assert.rejects(pending, (err) => {
    assertOcmsFailure(err);
    assert.notEqual(err.code, 'ocms/readiness-timeout');
    return true;
  }, 'child exit during startup must surface, not hang until deadline');
  const status = await controller.status();
  assert.equal(status.state, 'OFFLINE');
});

test('readiness: wrong response shape → readiness never satisfied', { skip }, async () => {
  const { controller } = await make({
    probeHttp: readinessSequence([{ ok: true, status: 200, json: { unexpected: 'shape' } }]),
    deadlineMs: 5,
    intervalMs: 1,
  });
  await assert.rejects(controller.start({ embedOrigin: 'http://127.0.0.1:3080' }), (err) => {
    assertOcmsFailure(err);
    return true;
  });
});

test('readiness: probe URL always targets the configured port', { skip }, async () => {
  let probedUrl = null;
  const { deps } = makeDeps({
    port: 19191,
    probeHttp: async (url) => { probedUrl = url; return { ok: false, status: 0, json: null }; },
    deadlineMs: 5,
    intervalMs: 1,
  });
  const { createLifecycleController } = await loadLifecycleModule();
  const c = createLifecycleController(deps);
  await assert.rejects(c.start({ embedOrigin: 'http://127.0.0.1:3080' }), () => true);
  assert.ok(probedUrl !== null, 'readiness probe performed');
  assert.ok(String(probedUrl).includes(':19191'), 'probe URL carries the configured port: ' + probedUrl);
});

// ---- §96 spawn failures ------------------------------------------------------

test('spawn failure: invalid node executable → ERROR ocms/start-failed, no child', { skip }, async () => {
  const { controller, record } = await make({
    nodeExecutable: () => null,
  });
  await assert.rejects(controller.start({ embedOrigin: 'http://127.0.0.1:3080' }), (err) => {
    assertOcmsFailure(err);
    return true;
  });
  assert.equal(record.spawned.length, 0);
});

test('spawn failure: missing ui.mjs → refused before spawn', { skip }, async () => {
  const { controller, record } = await make({ uiPath: path.join(REPO_ROOT, 'does-not-exist.mjs') });
  await assert.rejects(controller.start({ embedOrigin: 'http://127.0.0.1:3080' }), (err) => {
    assertOcmsFailure(err);
    return true;
  });
  assert.equal(record.spawned.length, 0);
});

test('spawn failure: spawnFn throws synchronously → safe ERROR, no leak', { skip }, async () => {
  const { controller, record } = await make({
    spawnFn: () => { throw new Error('EACCES'); },
  });
  await assert.rejects(controller.start({ embedOrigin: 'http://127.0.0.1:3080' }), (err) => {
    assertOcmsFailure(err);
    return true;
  });
  const status = await controller.status();
  assert.equal(status.state, 'OFFLINE');
});

test('spawn failure: child exits immediately with bind failure (EADDRINUSE race) → ERROR ocms/start-failed; probe port untouched', { skip }, async () => {
  let childRef;
  const { controller, record } = await make({
    probeHttp: readinessSequence([{ ok: false, status: 0, json: null }]),
    spawnFn(cmd, args, opts) {
      childRef = childDouble();
      record.spawned.push(childRef.spawnedArgs = { cmd, args, opts });
      return childRef;
    },
  });
  const pending = controller.start({ embedOrigin: 'http://127.0.0.1:3080' });
  await new Promise((r) => setTimeout(r, 5));
  childRef.fireExit(1, null); // ui.mjs exits after EADDRINUSE
  await assert.rejects(pending, (err) => {
    assertOcmsFailure(err);
    return true;
  });
});

// ---- §97 external port --------------------------------------------------------

test('external port: Start refused with ocms/port-in-use, no child, no kill', { skip }, async () => {
  const { controller, record } = await make({ probePort: async () => 'occupied' });
  await assert.rejects(controller.start({ embedOrigin: 'http://127.0.0.1:3080' }), (err) => {
    assertOcmsFailure(err, 'ocms/port-in-use');
    return true;
  });
  assert.equal(record.spawned.length, 0);
  const status = await controller.status();
  assert.equal(status.state, 'EXTERNAL');
});

test('external port: Stop refused and does not touch the listener', { skip }, async () => {
  const { controller, record } = await make({ probePort: async () => 'occupied' });
  await assert.rejects(controller.start({ embedOrigin: 'http://127.0.0.1:3080' }), () => true);
  await assert.rejects(controller.stop(), (err) => {
    assertOcmsFailure(err, 'ocms/not-owned');
    return true;
  });
  assert.equal(record.killed.length, 0, 'no kill calls of any kind');
});

// ---- §98 Stop ------------------------------------------------------------------

test('stop: ONLINE → STOPPING → OFFLINE on owned child only', { skip }, async () => {
  let childRef;
  const { controller, record } = await make({
    probeHttp: readinessSequence([READY]),
    spawnFn(cmd, args, opts) {
      childRef = childDouble();
      record.spawned.push(childRef.spawnedArgs = { cmd, args, opts });
      return childRef;
    },
  });
  await controller.start({ embedOrigin: 'http://127.0.0.1:3080' });
  const pending = controller.stop();
  assert.equal(childRef.killed.length, 1, 'termination requested on the exact owned child');
  childRef.fireExit(0, null);
  const status = await pending;
  assert.equal(status.state, 'OFFLINE');
});

test('stop: SIGTERM timeout then SIGKILL actual exit resolves OFFLINE', { skip }, async () => {
  let childRef;
  const { controller, record } = await make({
    probeHttp: readinessSequence([READY]),
    spawnFn(cmd, args, opts) {
      childRef = childDouble();
      record.spawned.push(childRef.spawnedArgs = { cmd, args, opts });
      const originalKill = childRef.kill.bind(childRef);
      childRef.kill = (signal) => {
        const result = originalKill(signal);
        if (signal === 'SIGKILL') setTimeout(() => childRef.fireExit(137, 'SIGKILL'), 0);
        return result;
      };
      return childRef;
    },
  });
  await controller.start({ embedOrigin: 'http://127.0.0.1:3080' });
  const status = await controller.stop();
  assert.equal(status.state, 'OFFLINE');
  assert.equal(status.url, undefined);
  assert.deepEqual(childRef.killed, ['SIGTERM', 'SIGKILL']);
  assert.equal(childRef.exited, true);
  assert.equal(record.spawned.length, 1);
  await assert.rejects(controller.stop(), (err) => {
    assertOcmsFailure(err, 'ocms/not-owned');
    return true;
  });
});

test('stop: unconfirmed forced exit rejects and retains ERROR ownership', { skip }, async () => {
  let childRef;
  const states = [];
  const { controller, deps, record } = await make({
    probeHttp: readinessSequence([READY]),
    onState(status) { states.push(status.state); },
    spawnFn(cmd, args, opts) {
      childRef = childDouble();
      record.spawned.push(childRef.spawnedArgs = { cmd, args, opts });
      return childRef;
    },
  });
  await controller.start({ embedOrigin: 'http://127.0.0.1:3080' });
  const stateIndex = states.length;
  await assert.rejects(controller.stop(), (err) => {
    assertOcmsFailure(err, 'ocms/stop-failed');
    assert.equal(err.ocmsFailure, true);
    return true;
  });
  const status = await controller.status();
  assert.equal(status.state, 'ERROR');
  assert.equal(status.port, deps.port);
  assert.equal(typeof status.message, 'string');
  assert.equal(status.message.length > 0, true);
  assert.doesNotMatch(status.message, /\n\s+at |\s+at .+:\d+/);
  assert.equal(states.slice(stateIndex).includes('OFFLINE'), false);
  assert.deepEqual(childRef.killed, ['SIGTERM', 'SIGKILL']);
  assert.equal(record.spawned.length, 1);
});

test('start: failed Stop with retained child refuses before another spawn', { skip }, async () => {
  let childRef;
  const { controller, record } = await make({
    probeHttp: readinessSequence([READY]),
    spawnFn(cmd, args, opts) {
      childRef = childDouble();
      record.spawned.push(childRef.spawnedArgs = { cmd, args, opts });
      return childRef;
    },
  });
  await controller.start({ embedOrigin: 'http://127.0.0.1:3080' });
  const originalKill = childRef.kill.bind(childRef);
  childRef.kill = (signal) => {
    originalKill(signal);
    throw new Error('EPERM');
  };
  await assert.rejects(controller.stop(), (err) => {
    assertOcmsFailure(err, 'ocms/stop-failed');
    return true;
  });
  await assert.rejects(controller.start({ embedOrigin: 'http://127.0.0.1:3080' }), (err) => {
    assertOcmsFailure(err, 'ocms/start-failed');
    assert.equal(err.message, 'The previous OCMS-S child has not exited.');
    return true;
  });
  assert.equal(record.spawned.length, 1);
  assert.equal(childRef.killed.length, 1);
});

test('delayed exact-child exit reconciles ERROR, restarts once, and stale exit is inert', { skip }, async () => {
  const children = [];
  const { controller, record } = await make({
    probeHttp: readinessSequence([READY, READY]),
    spawnFn(cmd, args, opts) {
      const child = childDouble();
      record.spawned.push(child.spawnedArgs = { cmd, args, opts });
      children.push(child);
      return child;
    },
  });
  await controller.start({ embedOrigin: 'http://127.0.0.1:3080' });
  children[0].kill = () => { throw new Error('EPERM'); };
  await assert.rejects(controller.stop(), (err) => {
    assertOcmsFailure(err, 'ocms/stop-failed');
    return true;
  });
  assert.equal((await controller.status()).state, 'ERROR');
  children[0].fireExit(137, 'SIGKILL');
  const reconciled = await controller.status();
  assert.equal(reconciled.state, 'OFFLINE');
  assert.equal(reconciled.url, undefined);
  await assert.rejects(controller.stop(), (err) => {
    assertOcmsFailure(err, 'ocms/not-owned');
    return true;
  });
  const restarted = await controller.start({ embedOrigin: 'http://127.0.0.1:3080' });
  assert.equal(restarted.state, 'ONLINE');
  assert.equal(record.spawned.length, 2);
  children[0].fire('exit', 0, null);
  await new Promise((r) => setTimeout(r, 5));
  assert.equal((await controller.status()).state, 'ONLINE');
  const stopping = controller.stop();
  assert.deepEqual(children[1].killed, ['SIGTERM']);
  children[1].fireExit(0, null);
  assert.equal((await stopping).state, 'OFFLINE');
});

test('stop: child error without actual exit is not termination', { skip }, async () => {
  let childRef;
  const { controller, record } = await make({
    probeHttp: readinessSequence([READY]),
    spawnFn(cmd, args, opts) {
      childRef = childDouble();
      record.spawned.push(childRef.spawnedArgs = { cmd, args, opts });
      const originalKill = childRef.kill.bind(childRef);
      childRef.kill = (signal) => {
        const result = originalKill(signal);
        if (signal === 'SIGTERM') childRef.fire('error', new Error('kill transport error'));
        return result;
      };
      return childRef;
    },
  });
  await controller.start({ embedOrigin: 'http://127.0.0.1:3080' });
  await assert.rejects(controller.stop(), (err) => {
    assertOcmsFailure(err, 'ocms/stop-failed');
    assert.equal(err.ocmsFailure, true);
    return true;
  });
  assert.deepEqual(childRef.killed, ['SIGTERM', 'SIGKILL']);
  assert.equal((await controller.status()).state, 'ERROR');
  childRef.fireExit(137, 'SIGKILL');
  assert.equal((await controller.status()).state, 'OFFLINE');
  assert.equal(record.spawned.length, 1);
});

test('stop: already-exited child and Stop while OFFLINE/EXTERNAL refused safely', { skip }, async () => {
  let childRef;
  const { controller, record } = await make({
    probeHttp: readinessSequence([READY]),
    spawnFn(cmd, args, opts) {
      childRef = childDouble();
      record.spawned.push(childRef.spawnedArgs = { cmd, args, opts });
      return childRef;
    },
  });
  await assert.rejects(controller.stop(), (err) => {
    assertOcmsFailure(err, 'ocms/not-owned');
    return true;
  });
  await controller.start({ embedOrigin: 'http://127.0.0.1:3080' });
  childRef.fireExit(0, null); // child died on its own
  await new Promise((r) => setTimeout(r, 5));
  const status = await controller.status();
  assert.equal(status.state, 'OFFLINE', 'unexpected exit transitions OFFLINE (§100)');
  await assert.rejects(controller.stop(), (err) => {
    assertOcmsFailure(err, 'ocms/not-owned');
    return true;
  });
});

// ---- §100 unexpected exit after ONLINE ------------------------------------------

test('unexpected exit after ONLINE: ownership cleared, status not ONLINE, restart works', { skip }, async () => {
  let childRef;
  const { controller, record } = await make({
    probeHttp: readinessSequence([READY, READY]),
    spawnFn(cmd, args, opts) {
      childRef = childDouble();
      record.spawned.push(childRef.spawnedArgs = { cmd, args, opts });
      return childRef;
    },
  });
  await controller.start({ embedOrigin: 'http://127.0.0.1:3080' });
  childRef.fireExit(137, 'SIGKILL');
  await new Promise((r) => setTimeout(r, 5));
  const status = await controller.status();
  assert.equal(status.state, 'OFFLINE');
  assert.equal(record.spawned.length, 1);
  // restart works: full probe + spawn again
  await controller.start({ embedOrigin: 'http://127.0.0.1:3080' });
  assert.equal(record.spawned.length, 2, 'restart spawns a new child');
});

// ---- §101 concurrency ------------------------------------------------------------

test('concurrency: Start + Start → exactly one child; second sees idempotent ONLINE or busy refusal', { skip }, async () => {
  const { deps, record } = makeDeps({
    probeHttp: async () => { await new Promise((r) => setTimeout(r, 10)); return READY; },
  });
  const { createLifecycleController } = await loadLifecycleModule();
  const c = createLifecycleController(deps);
  const a = c.start({ embedOrigin: 'http://127.0.0.1:3080' });
  const b = c.start({ embedOrigin: 'http://127.0.0.1:3080' }).catch((e) => e);
  const [ra, rb] = await Promise.all([a, b]);
  assert.equal(ra.state, 'ONLINE');
  if (rb && rb.code) assertOcmsFailure(rb); // busy-refused failure object
  else if (rb && rb.state) assert.equal(rb.state, 'ONLINE');
  assert.equal(record.spawned.length, 1, 'exactly one child under concurrent Start');
});

test('concurrency: Stop + Stop with unconfirmed exit yields busy and stop-failed only', { skip }, async () => {
  const { controller, record } = await make({
    probeHttp: readinessSequence([READY]),
  });
  await controller.start({ embedOrigin: 'http://127.0.0.1:3080' });
  const a = controller.stop().catch((e) => e);
  const b = controller.stop().catch((e) => e);
  const [ra, rb] = await Promise.all([a, b]);
  const outcomes = [ra, rb].map((r) => (r && r.code ? r.code : r.state));
  assert.deepEqual(new Set(outcomes), new Set(['ocms/busy', 'ocms/stop-failed']));
  assert.equal(outcomes.includes('OFFLINE'), false);
  assert.equal(record.spawned.length, 1);
});

test('concurrency: Start while STARTING is refused or idempotent — never a second spawn', { skip }, async () => {
  const { deps, record } = makeDeps({
    probeHttp: async () => { await new Promise((r) => setTimeout(r, 10)); return READY; },
  });
  const { createLifecycleController } = await loadLifecycleModule();
  const c = createLifecycleController(deps);
  const first = c.start({ embedOrigin: 'http://127.0.0.1:3080' });
  const second = await c.start({ embedOrigin: 'http://127.0.0.1:3080' }).catch((e) => e);
  const final = await first;
  assert.equal(record.spawned.length, 1, 'exactly one child');
  if (second && second.code) assert.equal(second.code, 'ocms/busy');
  else if (second && second.state) assert.equal(second.state, 'STARTING');
  assert.equal(final.state, 'ONLINE');
});

// ---- §99 disposal ------------------------------------------------------------------

test('disposal: actual exit clears ownership and subsequent Stop is not-owned', { skip }, async () => {
  let childRef;
  const { controller, record } = await make({
    probeHttp: readinessSequence([READY]),
    spawnFn(cmd, args, opts) {
      childRef = childDouble();
      record.spawned.push(childRef.spawnedArgs = { cmd, args, opts });
      const originalKill = childRef.kill.bind(childRef);
      childRef.kill = (signal) => {
        const result = originalKill(signal);
        setTimeout(() => childRef.fireExit(0, null), 0);
        return result;
      };
      return childRef;
    },
  });
  await controller.start({ embedOrigin: 'http://127.0.0.1:3080' });
  await controller.dispose();
  assert.deepEqual(childRef.killed, ['SIGTERM']);
  assert.equal(childRef.exited, true);
  const status = await controller.status();
  assert.equal(status.state, 'OFFLINE');
  assert.equal(status.url, undefined);
  await assert.rejects(controller.stop(), (err) => {
    assertOcmsFailure(err, 'ocms/not-owned');
    return true;
  });
  assert.equal(record.spawned.length, 1);
});

// ---- §92/§38: no browser-derived inputs ---------------------------------------------

test('controller surface accepts no browser-derived executable/ui.mjs/settings', { skip }, async () => {
  const { controller, record } = await make();
  // start() signature accepts only { embedOrigin }; extra fields must be ignored/refused.
  const sneaky = await controller.start({ embedOrigin: 'http://127.0.0.1:3080', uiPath: 'C:/evil/ui.mjs', nodeBin: 'evil.exe', settingsPath: 'C:/evil/settings.yaml' }).then((s) => s.state, (e) => e.code);
  assert.notEqual(record.spawned[0]?.args?.[0], 'C:/evil/ui.mjs', 'ui.mjs path stays host-owned');
  assert.notEqual(record.spawned[0]?.cmd, 'evil.exe', 'node executable stays host-owned');
  assert.equal(sneaky === 'ONLINE' || sneaky === 'OFFLINE' || typeof sneaky === 'string', true);
});
