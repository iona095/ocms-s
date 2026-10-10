// OCMS-S acceptance smoke test: the real runtime, real children, real
// retirement ordering.
//
// This script is the real-runtime companion to the synthetic suite
// (tests/v1.4/), which proves the lifecycle and the HMR sequencing
// deterministically with injected doubles. Here the same invariants are driven
// against things only a real process can show:
//
//   * the committed dsh/host.mjs loaded through a real Cordis runtime and driven
//     through the real ocmsLifecycleService Remote methods (status/start/stop);
//   * a real ui.mjs child process on a real ephemeral port;
//   * real-child acceptance of the retirement-before-replacement ordering
//     required by DSH 0.2.1-alpha.2: registry.delete(previous plugin) frees the
//     service key and starts old-fiber disposal, the framework awaits that
//     settlement, and only then is the replacement loaded/activated. OCMS owns
//     no process-global generation coordinator and never serializes HMR itself;
//   * child liveness and listener cleanup read from the operating system, not
//     from anything the code under test reports;
//   * that a retiring generation keeps owning its real child until the actual
//     exit, that no OFFLINE is ever reported while that child is alive, and that
//     the replacement is created only after the old fiber settled.
//
// Scope: this smoke drives the OCMS layer through a real Cordis Context. It does
// not invoke @deepseek-ai/dsh-hmr itself, so it makes no claim about that
// package's internal implementation, and @deepseek-ai/dsh-hmr is not installed
// here. The OCMS-layer sequencing contract is also covered deterministically by
// the accepted tests/v1.4/hmr-generation.test.mjs compatibility tests, which
// replay the same order against the real Cordis registry.
//
// Everything it creates (a scratch settings file, real children) is removed or
// killed on every exit path, so it is safe to run on a developer machine. It
// never touches the production settings file, never calls Preview/Apply, and
// never writes to the repository.
//
// usage:
//   node tests/acceptance/smoke.mjs [options]
//     --host <path>        Host plugin to test          (default dsh/host.mjs)
//     --strict             fail instead of skipping when a required section
//                          cannot run (also: OCMS_SMOKE_STRICT=1). Intended for
//                          unattended runners, so a missing prerequisite can
//                          never be reported as a green acceptance.
//     --timeout <seconds>  watchdog for the whole run    (default 240)
//
// exit codes: 0 = all checks passed or the run was skipped for an environmental
// reason (clearly reported), 1 = at least one check failed.
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const IS_WINDOWS = process.platform === 'win32';

// ---------------------------------------------------------------------------
// arguments (no dependencies; everything is a built-in)
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const options = {
    host: path.join(REPO_ROOT, 'dsh', 'host.mjs'),
    // Strict mode is for unattended runners: there, an environmental skip of a
    // required section must fail the run instead of reporting a green
    // acceptance. Local and manual runs keep the explicit-skip behaviour, which
    // is useful when a checkout or environment genuinely cannot host it.
    strict: process.env.OCMS_SMOKE_STRICT === '1',
    timeoutSeconds: 240,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--host') options.host = path.resolve(argv[++i]);
    else if (flag === '--strict') options.strict = true;
    else if (flag === '--timeout') options.timeoutSeconds = Number(argv[++i]);
    else throw new Error('unknown option: ' + flag);
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));

// ---------------------------------------------------------------------------
// reporting
// ---------------------------------------------------------------------------
const results = [];
let startedAt = 0;
function step(name, detail) {
  const line = { name, ...detail };
  results.push(line);
  const suffix = detail && Object.keys(detail).length > 0 ? ' :: ' + JSON.stringify(detail) : '';
  console.log('[' + String(Date.now() - startedAt).padStart(6) + 'ms] ' + name + suffix);
}
const failures = [];
function check(label, ok, detail) {
  if (ok) {
    console.log('   PASS  ' + label);
  } else {
    failures.push(label + (detail ? ' :: ' + JSON.stringify(detail) : ''));
    console.log('   FAIL  ' + label + (detail ? ' :: ' + JSON.stringify(detail) : ''));
  }
}

// Every port this run may have bound, so cleanup can never miss a child.
const usedPorts = new Set();

// A watchdog so a real hang can never wedge a machine or a CI job.
const watchdog = setTimeout(() => {
  console.error('SMOKE RESULT: FAIL (watchdog after ' + options.timeoutSeconds + 's)');
  for (const port of usedPorts) killChildren(port);
  process.exit(1);
}, options.timeoutSeconds * 1000);
watchdog.unref();

// ---------------------------------------------------------------------------
// operating-system observation (Windows and POSIX)
// ---------------------------------------------------------------------------
function run(command, args) {
  return execFileSync(command, args, { encoding: 'utf8', maxBuffer: 8 << 20, stdio: ['ignore', 'pipe', 'pipe'] });
}

// PIDs of the real children serving a given port, or [] when none.
function childPids(port) {
  if (IS_WINDOWS) {
    const script = "$ErrorActionPreference='Stop'; Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | "
      + "Where-Object { $_.CommandLine -and $_.CommandLine -like '*ui.mjs*' -and $_.CommandLine -like '*--port=" + port + "*' } "
      + '| ForEach-Object { $_.ProcessId }';
    return run('powershell.exe', ['-NoProfile', '-Command', script]).split(/\s+/).filter(Boolean).map(Number);
  }
  return run('ps', ['-eo', 'pid=,args='])
    .split('\n')
    .filter((line) => line.includes('ui.mjs') && line.includes('--port=' + port))
    .map((line) => Number(line.trim().split(/\s+/)[0]))
    .filter((pid) => Number.isInteger(pid) && pid > 1);
}

// PIDs listening on a port, or [] when nothing is listening.
function listenerPids(port) {
  if (IS_WINDOWS) {
    const pids = new Set();
    for (const line of run('netstat.exe', ['-ano', '-p', 'tcp']).split(/\r?\n/)) {
      if (!line.includes('LISTENING')) continue;
      const columns = line.trim().split(/\s+/);
      if (columns.length >= 5 && columns[1].endsWith(':' + port)) pids.add(Number(columns[4]));
    }
    return [...pids].filter((pid) => Number.isInteger(pid) && pid > 0);
  }
  try {
    const pids = new Set();
    for (const line of run('ss', ['-ltnp']).split('\n')) {
      if (!line.includes(':' + port + ' ')) continue;
      const match = /pid=(\d+)/.exec(line);
      if (match) pids.add(Number(match[1]));
    }
    return [...pids];
  } catch {
    try {
      return run('lsof', ['-nP', '-iTCP:' + port, '-sTCP:LISTEN'])
        .split('\n').slice(1)
        .map((line) => Number(line.trim().split(/\s+/)[0]))
        .filter((pid) => Number.isInteger(pid) && pid > 0);
    } catch {
      return []; // no listener inspection available: never a false claim
    }
  }
}

// The cheapest possible external truth about a known child: is that OS process
// still alive? Signal 0 checks existence without delivering anything.
function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return Boolean(err) && err.code === 'EPERM';
  }
}

function killChildren(port) {
  for (const pid of childPids(port)) {
    try {
      if (IS_WINDOWS) run('taskkill.exe', ['/PID', String(pid), '/T', '/F']);
      else process.kill(pid, 'SIGKILL');
    } catch { /* already gone */ }
  }
}
process.on('exit', () => { for (const port of usedPorts) killChildren(port); });

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------
async function waitFor(predicate, timeoutMs, stepMs = 25) {
  const began = Date.now();
  for (;;) {
    const value = await predicate();
    if (value) return value;
    if (Date.now() - began >= timeoutMs) return null;
    await new Promise((resolve) => setTimeout(resolve, stepMs));
  }
}

async function drain(ticks = 8) {
  for (let i = 0; i < ticks; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

function withTimeout(promise, ms, message) {
  let timer = null;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); }),
  ]).finally(() => { if (timer) clearTimeout(timer); });
}

// Cordis' registry.delete() disposes the old fibers but does not await them, so
// retirement is joined by observing the generation's own controller, never by
// re-disposing a detached fiber.
async function joinRetired(gen, ms, message) {
  const began = Date.now();
  while (gen.currentController() !== null) {
    if (Date.now() - began > ms) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function freePort() {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => { usedPorts.add(port); resolve(port); });
    });
  });
}

// A scratch settings file: the child must never see the production target, and
// this script performs no Preview/Apply against it.
function scratchSettings() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocms-smoke-'));
  const file = path.join(dir, 'settings.yaml');
  fs.writeFileSync(file, 'llm:\n  unrelated: true\nllm-pi-ai:\n  providers: {}\n', 'utf8');
  return { dir, file };
}

// ---------------------------------------------------------------------------
// environment gates
// ---------------------------------------------------------------------------
// A gate that cannot be satisfied is a SKIP for a human run and a FAIL in strict
// mode, so an unattended runner can never turn a missing prerequisite into a
// green acceptance result.
function gate(kind, reason) {
  if (options.strict) {
    console.log('SMOKE RESULT: FAIL (strict: ' + kind + ' :: ' + reason + ')');
    process.exit(1);
  }
  console.log('SMOKE RESULT: SKIPPED (' + kind + ': ' + reason + ')');
  process.exit(0);
}

startedAt = Date.now();
let CordisContext = null;
try {
  ({ Context: CordisContext } = await import('@deepseek-ai/cordis'));
} catch (err) {
  gate('capability missing: @deepseek-ai/cordis must be installed to run the acceptance smoke test', err && err.message);
}
if (!fs.existsSync(path.join(REPO_ROOT, 'ui.mjs'))) {
  gate('capability missing: ui.mjs is not present in this checkout', REPO_ROOT);
}
if (!fs.existsSync(options.host)) {
  console.log('SMOKE RESULT: FAIL (host plugin not found: ' + options.host + ')');
  process.exit(1);
}

const scratch = scratchSettings();
const hostUrl = new URL('file:///' + options.host.replace(/\\/g, '/')).href;
const genA = await import(hostUrl);
let releaseOld = null;

try {
  // =====================================================================
  // PHASE 1 — normal Start -> Stop through the real Remote service
  // =====================================================================
  step('phase 1: generation A published from ' + path.relative(REPO_ROOT, options.host), { scratchSettings: scratch.file });
  const port1 = await freePort();
  const root1 = new CordisContext();
  const fiberA1 = root1.plugin(genA.apply, { port: port1, settingsPath: scratch.file });
  await fiberA1;
  const serviceA1 = root1.ocmsLifecycleService;
  check('the real Remote service is published', Boolean(serviceA1));
  check('the Remote surface carries its protocol binding', Boolean(serviceA1 && serviceA1.typertRemote));
  check('initial state is OFFLINE', (await serviceA1.status()).state === 'OFFLINE');

  const started = await serviceA1.start('http://127.0.0.1:3080');
  step('phase 1: Start returned', started);
  check('Start reaches ONLINE', started.state === 'ONLINE');
  check('Start reports the trusted Host URL', started.url === 'http://127.0.0.1:' + port1 + '/');

  const pidsOnline = await waitFor(() => (childPids(port1).length === 1 ? childPids(port1) : null), 15_000);
  step('phase 1: OS process table', { pids: pidsOnline });
  check('exactly one real ui.mjs child is alive', Array.isArray(pidsOnline) && pidsOnline.length === 1, { pids: pidsOnline });
  check('the real child owns its port', listenerPids(port1).length === 1, { listeners: listenerPids(port1) });

  let apiOk = false;
  let apiDetail = null;
  try {
    const res = await fetch('http://127.0.0.1:' + port1 + '/api/state', { signal: AbortSignal.timeout(5000) });
    const json = await res.json();
    apiOk = res.ok && Boolean(json) && json.ok === true;
    apiDetail = { ok: res.ok, status: res.status };
  } catch (err) {
    apiDetail = { error: err && err.message };
  }
  step('phase 1: real HTTP readiness probe', apiDetail);
  check('the real child serves /api/state', apiOk);

  const stopped = await serviceA1.stop();
  step('phase 1: Stop returned', stopped);
  check('Stop reaches OFFLINE', stopped.state === 'OFFLINE');
  check('Stop reports no URL', stopped.url === undefined);
  const goneAfterStop = await waitFor(() => (childPids(port1).length === 0 ? true : null), 15_000);
  step('phase 1: OS process table after Stop', { pids: childPids(port1) });
  check('the real child process is actually gone after Stop', goneAfterStop === true);
  const releasedListener = await waitFor(() => (listenerPids(port1).length === 0 ? true : null), 15_000);
  check('the listener is released after Stop', releasedListener === true, { listeners: listenerPids(port1) });
  const stopAgain = await serviceA1.stop().then(() => null, (err) => err);
  check('a second Stop is refused with ocms/not-owned', Boolean(stopAgain) && stopAgain.code === 'ocms/not-owned', { code: stopAgain && stopAgain.code });
  await fiberA1.dispose();
  check('an idle generation disposes with no child', genA.currentController() === null);
  check('disposal leaves no real child behind', childPids(port1).length === 0, { pids: childPids(port1) });

  // =====================================================================
  // PHASE 2 — real-child retirement-before-replacement ordering
  // (DSH 0.2.1-alpha.2: registry.delete -> await old fiber settlement ->
  //  replacement loaded/activated; OCMS owns no generation coordinator)
  // =====================================================================
  const port2 = await freePort();
  const root2 = new CordisContext();
  const genA2 = await import(hostUrl + '?genA=' + Date.now());
  const fiberOld = root2.plugin(genA2.apply, { port: port2, settingsPath: scratch.file });
  await withTimeout(fiberOld, 20_000, 'ocms/smoke: generation A did not publish');
  const serviceOld = root2.ocmsLifecycleService;
  const controllerOld = genA2.currentController();
  check('generation A published one service and one controller', Boolean(serviceOld) && controllerOld !== null);

  const started2 = await serviceOld.start('http://127.0.0.1:3080');
  const pidsBeforeRetirement = await waitFor(() => (childPids(port2).length === 1 ? childPids(port2) : null), 15_000);
  const predecessorPid = Array.isArray(pidsBeforeRetirement) ? pidsBeforeRetirement[0] : null;
  const listenersBefore = listenerPids(port2);
  step('phase 2: generation A ONLINE before retirement', { state: started2.state, pids: pidsBeforeRetirement, listeners: listenersBefore });
  check('generation A is ONLINE with exactly one real child', started2.state === 'ONLINE' && predecessorPid !== null, { pids: pidsBeforeRetirement });
  check('the real child owns the port before retirement', listenersBefore.length === 1, { listeners: listenersBefore });

  // Hold the old teardown open so the retirement window is observed rather than
  // raced: retirement must stay open, and the real child alive, until release.
  const gateOpen = new Promise((resolve) => { releaseOld = resolve; });
  const originalDispose = controllerOld.dispose.bind(controllerOld);
  controllerOld.dispose = () => gateOpen.then(() => originalDispose());

  // D. Request retirement through registry deletion. Cordis frees the service
  // key synchronously and starts old-fiber disposal; it does not await it.
  const runtime = root2.registry.delete(genA2.apply);
  check('registry.delete removed the generation A runtime record', Boolean(runtime));
  let settled = false;
  const retirement = joinRetired(genA2, 30_000, 'ocms/smoke: generation A did not retire after the exact child exit');
  void retirement.then(() => { settled = true; }, () => { settled = true; });

  await drain(8);
  let heldState = null;
  try { heldState = (await controllerOld.status()).state; } catch { heldState = null; }
  step('phase 2: retirement requested with teardown held open', { state: heldState, pids: childPids(port2), settled });
  check('retirement stays open while the owned child is alive', settled === false);
  check('the retiring generation still owns its controller', genA2.currentController() === controllerOld);
  check('NEVER a false OFFLINE while the real child is alive', heldState === 'ONLINE', { state: heldState });
  check('the real child is still alive and listening during retirement', processAlive(predecessorPid) === true && listenerPids(port2).length === 1);
  check('no second child exists during retirement', childPids(port2).length === 1, { pids: childPids(port2) });

  // E/F. Release the hold and sample the real retirement window: ownership is
  // kept until the actual exit and no OFFLINE is reported while the OS still
  // shows the child alive. The blocking process-table scan runs outside the
  // sampling loop so it can never starve the sampler.
  const samples = [];
  let samplingDone = false;
  const sampling = (async () => {
    for (;;) {
      let state = null;
      try { state = (await controllerOld.status()).state; } catch { state = null; }
      samples.push({ childAlive: processAlive(predecessorPid), state, hasController: genA2.currentController() !== null });
      if (samplingDone) break;
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
  })();
  // Collect a guaranteed, non-vacuous slice of the held window first: while the
  // gate is closed the child is alive by construction, so this cannot race.
  const heldSamples = await waitFor(() => (samples.length >= 4 ? samples.length : null), 10_000);
  check('the held retirement window was sampled with the real child alive', heldSamples !== null && samples.every((s) => s.childAlive === true), {
    samples: samples.length,
    childAlive: samples.filter((s) => s.childAlive).length,
  });
  releaseOld();
  releaseOld = null;
  const childGone = await waitFor(() => (processAlive(predecessorPid) === false ? true : null), 30_000);
  samplingDone = true;
  await sampling;
  await withTimeout(retirement, 30_000, 'ocms/smoke: generation A retirement did not settle');

  const aliveSamples = samples.filter((s) => s.childAlive === true);
  step('phase 2: retirement window sampling summary', {
    samples: samples.length,
    samplesWithChildAlive: aliveSamples.length,
    stateSequence: samples.map((s) => s.state).filter((value, index, all) => value !== all[index - 1]),
  });
  check('the retirement window was actually observed (non-vacuous sampling)', samples.length >= 4 && aliveSamples.length >= 4, {
    samples: samples.length,
    withChildAlive: aliveSamples.length,
  });
  check('NEVER OFFLINE reported while the real child was alive', aliveSamples.every((s) => s.state !== 'OFFLINE'), {
    offenders: aliveSamples.filter((s) => s.state === 'OFFLINE').length,
  });
  check('ownership was held for every sample taken while the real child was alive', aliveSamples.every((s) => s.hasController === true), {
    offenders: aliveSamples.filter((s) => s.hasController !== true).length,
  });
  check('the predecessor child actually exited (OS process check)', childGone === true);
  check('the old fiber settled and the old controller is retired', genA2.currentController() === null);
  const pidsAfterRetirement = childPids(port2);
  const listenersAfterRetirement = listenerPids(port2);
  step('phase 2: external confirmation after retirement', { pids: pidsAfterRetirement, listeners: listenersAfterRetirement });
  check('the predecessor process is gone from the OS process table', pidsAfterRetirement.length === 0, { pids: pidsAfterRetirement });
  check('the port became free once the exact child exit settled retirement', listenersAfterRetirement.length === 0, { listeners: listenersAfterRetirement });

  // G. ONLY after the old fiber settled: import and create generation B.
  const genB2 = await import(hostUrl + '?genB=' + Date.now());
  const fiberNew = root2.plugin(genB2.apply, { port: port2, settingsPath: scratch.file });
  await withTimeout(fiberNew, 20_000, 'ocms/smoke: generation B did not publish after old settlement');
  const serviceNew = root2.ocmsLifecycleService;
  const replacementState = await serviceNew.status();
  step('phase 2: generation B activated after settlement', { state: replacementState.state, serviceReplaced: serviceNew !== serviceOld });
  check('generation B published exactly one service', Boolean(serviceNew));
  check('the registered service instance is now generation B', serviceNew !== serviceOld);
  check('generation B owns a fresh controller', genB2.currentController() !== null && genB2.currentController() !== controllerOld);
  check('generation B starts OFFLINE', replacementState.state === 'OFFLINE');
  check('generation B inherited no child', childPids(port2).length === 0, { pids: childPids(port2) });

  // H. generation B drives exactly one NEW child.
  const restarted = await serviceNew.start('http://127.0.0.1:3080');
  const pidsAfterRestart = await waitFor(() => (childPids(port2).length === 1 ? childPids(port2) : null), 15_000);
  step('phase 2: generation B drives its own child', { state: restarted.state, pids: pidsAfterRestart });
  check('generation B reaches ONLINE', restarted.state === 'ONLINE');
  check('generation B owns exactly one child (no duplicate)', Array.isArray(pidsAfterRestart) && pidsAfterRestart.length === 1, { pids: pidsAfterRestart });
  check('the replacement child is a different process than the retired one', Array.isArray(pidsAfterRestart) && pidsAfterRestart[0] !== predecessorPid, { before: predecessorPid, after: pidsAfterRestart });
  check('the replacement child owns the port', listenerPids(port2).length === 1, { listeners: listenerPids(port2) });

  // I. generation B Stop.
  const stoppedNew = await serviceNew.stop();
  step('phase 2: generation B Stop returned', stoppedNew);
  check('generation B reaches OFFLINE', stoppedNew.state === 'OFFLINE');
  check('the replacement child actually exited', (await waitFor(() => (childPids(port2).length === 0 ? true : null), 15_000)) === true, { pids: childPids(port2) });
  check('the port is free again after generation B Stop', (await waitFor(() => (listenerPids(port2).length === 0 ? true : null), 15_000)) === true, { listeners: listenerPids(port2) });

  // J. dispose generation B: no child survives.
  await fiberNew.dispose();
  check('generation B retired cleanly', genB2.currentController() === null);
  check('no child survives the generation B disposal', (await waitFor(() => (childPids(port2).length === 0 ? true : null), 15_000)) === true, { pids: childPids(port2) });
} catch (err) {
  // An unexpected fault (an unavailable OS probe, a refused port, a changed
  // service shape) is a failure of this acceptance run, not a crash.
  failures.push('unexpected error: ' + (err && err.message ? err.message : String(err)));
  console.log('   FAIL  unexpected error :: ' + (err && err.stack ? err.stack : String(err)));
} finally {
  clearTimeout(watchdog);
  if (releaseOld) releaseOld();
  for (const port of usedPorts) killChildren(port);
  try { fs.rmSync(scratch.dir, { recursive: true, force: true }); } catch { /* best effort */ }
}

console.log('');
if (failures.length === 0) {
  console.log('SMOKE RESULT: PASS (' + results.length + ' steps)' + (options.strict ? ' [strict]' : ''));
  process.exit(0);
}
console.log('SMOKE RESULT: FAIL (' + failures.length + ')' + (options.strict ? ' [strict]' : ''));
for (const failure of failures) console.log('  - ' + failure);
process.exit(1);
