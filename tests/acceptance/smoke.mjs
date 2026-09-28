// OCMS-S acceptance smoke test: the real runtime, real children, real HMR
// ordering. The synthetic suite (tests/v1.4/) proves the lifecycle and the
// generation coordinator deterministically with injected doubles; this script
// proves the same invariants against things only a real process can show:
//
//   * the committed dsh/host.mjs loaded through a real Cordis runtime and driven
//     through the real ocmsLifecycleService Remote methods (status/start/stop);
//   * a real ui.mjs child process on a real ephemeral port;
//   * the installed @deepseek-ai/cordis-plugin-hmr ordering, i.e. replacement
//     import -> synchronous registry.delete() whose fiber.dispose() is NOT
//     awaited -> replacement Fiber creation;
//   * child liveness and listener cleanup read from the operating system, not
//     from anything the code under test reports;
//   * that a replacement generation publishes nothing and spawns nothing while
//     the retiring generation's child is alive, and that the OS process death
//     and the exit-driven reconciliation are genuinely distinct events;
//   * the documented cold-start upgrade boundary, reproduced with a real
//     pre-coordinator generation and a real child.
//
// Everything it creates (a scratch settings file, a scratch pre-coordinator
// module tree, real children) is removed or killed on every exit path, so it is
// safe to run on a developer machine. It never touches the production settings
// file, never calls Preview/Apply, and never writes to the repository.
//
// usage:
//   node tests/acceptance/smoke.mjs [options]
//     --host <path>        Host plugin to test          (default dsh/host.mjs)
//     --prefix-ref <ref>   pre-coordinator generation to
//                          materialize from git          (default v1.4.1)
//     --no-boundary        skip the cold-start boundary phase
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
  const options = { host: path.join(REPO_ROOT, 'dsh', 'host.mjs'), prefixRef: 'v1.4.1', boundary: true, timeoutSeconds: 240 };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--host') options.host = path.resolve(argv[++i]);
    else if (flag === '--prefix-ref') options.prefixRef = argv[++i];
    else if (flag === '--no-boundary') options.boundary = false;
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
function skip(label, reason) {
  console.log('   SKIP  ' + label + ' :: ' + reason);
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

// Materialize a pre-coordinator generation from a git ref so the cold-start
// boundary can be reproduced without keeping stale copies in the repository.
function materializePrefixGeneration(ref) {
  const repoModules = path.join(REPO_ROOT, 'node_modules');
  if (!fs.existsSync(repoModules)) return null;
  let hostSource;
  try {
    hostSource = run('git', ['-C', REPO_ROOT, 'show', ref + ':dsh/host.mjs']);
  } catch {
    return null;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocms-smoke-prefix-'));
  fs.mkdirSync(path.join(dir, 'dsh'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'ui'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'dsh', 'host.mjs'), hostSource, 'utf8');
  // The pre-coordinator wrapper only lacked the coordinator; the lifecycle
  // controller and the served module are the current, released ones.
  for (const file of ['dsh/lifecycle.mjs', 'ui.mjs', 'package.json', 'sync.mjs', 'ui/index.html']) {
    fs.copyFileSync(path.join(REPO_ROOT, file), path.join(dir, file));
  }
  // The relocated copy must resolve the same pinned peers as the repository.
  try {
    fs.symlinkSync(repoModules, path.join(dir, 'node_modules'), IS_WINDOWS ? 'junction' : 'dir');
  } catch {
    return null;
  }
  return path.join(dir, 'dsh', 'host.mjs');
}

// ---------------------------------------------------------------------------
// environment gates
// ---------------------------------------------------------------------------
startedAt = Date.now();
let CordisContext = null;
try {
  ({ Context: CordisContext } = await import('@deepseek-ai/cordis'));
} catch (err) {
  console.log('SMOKE RESULT: SKIPPED (capability missing: @deepseek-ai/cordis must be installed to run the acceptance smoke test)');
  console.log('  ' + (err && err.message));
  process.exit(0);
}
if (!fs.existsSync(path.join(REPO_ROOT, 'ui.mjs'))) {
  console.log('SMOKE RESULT: SKIPPED (capability missing: ui.mjs is not present in this checkout)');
  process.exit(0);
}
if (!fs.existsSync(options.host)) {
  console.log('SMOKE RESULT: FAIL (host plugin not found: ' + options.host + ')');
  process.exit(1);
}

const scratch = scratchSettings();
const hostUrl = new URL('file:///' + options.host.replace(/\\/g, '/')).href;
const genA = await import(hostUrl);

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
  const stopAgain = await serviceA1.stop().then(() => null, (err) => err);
  check('a second Stop is refused with ocms/not-owned', Boolean(stopAgain) && stopAgain.code === 'ocms/not-owned', { code: stopAgain && stopAgain.code });
  await fiberA1.dispose();
  check('an idle generation disposes with no child', genA.currentController() === null);

  // =====================================================================
  // PHASE 2 — HMR while the child is running, in the installed ordering
  // =====================================================================
  const port2 = await freePort();
  const root2 = new CordisContext();
  const fiberOld = root2.plugin(genA.apply, { port: port2, settingsPath: scratch.file });
  await fiberOld;
  const serviceOld = root2.ocmsLifecycleService;
  const started2 = await serviceOld.start('http://127.0.0.1:3080');
  const pidsBeforeHmr = await waitFor(() => (childPids(port2).length === 1 ? childPids(port2) : null), 15_000);
  const predecessorPid = Array.isArray(pidsBeforeHmr) ? pidsBeforeHmr[0] : null;
  step('phase 2: predecessor ONLINE before HMR', { state: started2.state, pids: pidsBeforeHmr });
  check('predecessor is ONLINE with exactly one child', started2.state === 'ONLINE' && predecessorPid !== null);
  const controllerOld = genA.currentController();

  // The installed @deepseek-ai/cordis-plugin-hmr sequence, verbatim in shape:
  // import the replacement, synchronously drop the retiring plugin (whose
  // disposer is therefore not awaited), then create the replacement fiber.
  const generationB = await import(hostUrl + '?hmr=' + Date.now());
  const retiring = root2.registry.delete(genA.apply); // NOT awaited
  const fiberNew = root2.plugin(generationB.apply, { port: port2, settingsPath: scratch.file }); // NOT awaited
  let publishedAt = null;
  const retiringStateAtPublication = [];
  const observedNew = fiberNew.then(async () => {
    publishedAt = Date.now();
    retiringStateAtPublication.push((await controllerOld.status()).state);
  });
  step('phase 2: HMR sequence issued (registry.delete not awaited)', {
    pids: childPids(port2),
    replacementController: generationB.currentController() === null ? null : 'PUBLISHED',
  });
  check('the replacement generation published nothing synchronously', generationB.currentController() === null);
  check('the retiring generation still owns its controller', genA.currentController() === controllerOld);
  check('no second child was spawned by the replacement', childPids(port2).length === 1, { pids: childPids(port2) });

  // Dense sampling of the handoff window. Everything in this loop is
  // microsecond-cheap on purpose: the OS is asked directly (signal 0) whether
  // the predecessor child is still alive. The blocking process-table scan runs
  // only before and after the window so it can never starve the sampler.
  const samples = [];
  const sampling = (async () => {
    for (;;) {
      samples.push({
        childAlive: processAlive(predecessorPid),
        replacementPublished: generationB.currentController() !== null,
        retiringState: (await controllerOld.status()).state,
        retiringHasController: genA.currentController() !== null,
      });
      if (publishedAt !== null && Date.now() - publishedAt > 200) break;
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
  })();

  const childGone = await waitFor(() => (processAlive(predecessorPid) === false ? true : null), 30_000);
  step('phase 2: predecessor child exit observed (OS signal 0)', { childGone, retiringState: (await controllerOld.status()).state });
  check('the predecessor child actually exited (OS process check)', childGone === true);
  await observedNew;
  await retiring;
  await sampling;

  const whileChildAlive = samples.filter((s) => s.childAlive === true);
  const stoppingSamples = samples.filter((s) => s.retiringState === 'STOPPING');
  const firstPublication = samples.find((s) => s.replacementPublished === true);
  const firstOsDeath = samples.find((s) => s.childAlive === false);
  const stateSequence = samples.map((s) => s.retiringState).filter((value, index, all) => value !== all[index - 1]);
  step('phase 2: handoff sampling summary', {
    samples: samples.length,
    samplesWithChildAlive: whileChildAlive.length,
    stateSequence,
    firstOsDeathObserved: firstOsDeath,
    firstReplacementPublication: firstPublication,
  });
  check('the retiring window was actually observed (non-vacuous sampling)', whileChildAlive.length > 0 && firstPublication !== undefined && samples.length > 5, {
    withChildAlive: whileChildAlive.length,
    samples: samples.length,
  });
  check('the retiring generation walked ONLINE -> STOPPING -> OFFLINE', stateSequence[0] === 'ONLINE' && stateSequence[stateSequence.length - 1] === 'OFFLINE' && stateSequence.length >= 2, { stateSequence });
  check('NEVER the replacement published while the real child was alive', whileChildAlive.every((s) => s.replacementPublished === false), {
    offenders: whileChildAlive.filter((s) => s.replacementPublished).length,
  });
  check('NEVER OFFLINE reported while the real child was alive', whileChildAlive.every((s) => s.retiringState !== 'OFFLINE'), {
    offenders: whileChildAlive.filter((s) => s.retiringState === 'OFFLINE').length,
  });
  // The OS process disappears before its 'exit' event is delivered, so in that
  // window ownership is legitimately still held and the replacement is still
  // unpublished. That lag is the guarantee, not a defect.
  check('in the exit-not-yet-observed window ownership was still held and the replacement unpublished', stoppingSamples.every((s) => s.retiringHasController === true && s.replacementPublished === false), {
    stoppingSamples: stoppingSamples.length,
    offenders: stoppingSamples.filter((s) => s.retiringHasController !== true || s.replacementPublished !== false).length,
  });
  check('the first replacement publication happened only once ownership was released', firstPublication !== undefined && firstPublication.retiringState === 'OFFLINE' && firstPublication.retiringHasController === false, { firstPublication });
  check('the retiring generation kept its controller until its child exited', samples.filter((s) => s.retiringState !== 'OFFLINE').every((s) => s.retiringHasController === true));

  const pidsAfterHandoff = childPids(port2);
  const listenersAfterHandoff = listenerPids(port2);
  step('phase 2: external confirmation after the handoff', { pids: pidsAfterHandoff, listeners: listenersAfterHandoff });
  check('the predecessor process is gone from the OS process table', pidsAfterHandoff.length === 0, { pids: pidsAfterHandoff });
  check('nothing is listening on the port after the handoff', listenersAfterHandoff.length === 0, { listeners: listenersAfterHandoff });
  check('a second child was impossible: the replacement stayed unpublished for the whole window', whileChildAlive.every((s) => s.replacementPublished === false));

  const replacementState = await generationB.currentController().status();
  step('phase 2: replacement activated', { state: replacementState.state, serviceReplaced: root2.ocmsLifecycleService !== serviceOld });
  check('the replacement published only after the exact child exit', retiringStateAtPublication[0] === 'OFFLINE', { atPublication: retiringStateAtPublication });
  check('the retiring generation reports no controller', genA.currentController() === null);
  check('the replacement starts idle, never inheriting a stale ONLINE claim', replacementState.state === 'OFFLINE');
  check('the registered service instance is now the replacement', root2.ocmsLifecycleService !== serviceOld);

  const restarted = await root2.ocmsLifecycleService.start('http://127.0.0.1:3080');
  const pidsAfterRestart = await waitFor(() => (childPids(port2).length === 1 ? childPids(port2) : null), 15_000);
  step('phase 2: replacement drives its own child', { state: restarted.state, pids: pidsAfterRestart });
  check('the replacement generation can Start', restarted.state === 'ONLINE');
  check('the replacement owns exactly one child', Array.isArray(pidsAfterRestart) && pidsAfterRestart.length === 1);
  check('the replacement child is a different process than the retired one', Array.isArray(pidsAfterRestart) && pidsAfterRestart[0] !== predecessorPid, { before: predecessorPid, after: pidsAfterRestart });
  const stoppedNew = await root2.ocmsLifecycleService.stop();
  check('the replacement generation can Stop', stoppedNew.state === 'OFFLINE');
  await fiberNew.dispose();
  check('no child survives the replacement disposal', (await waitFor(() => (childPids(port2).length === 0 ? true : null), 15_000)) === true);

  // =====================================================================
  // PHASE 3 — the documented cold-start upgrade boundary, reproduced
  // =====================================================================
  if (!options.boundary) {
    step('phase 3 skipped', { reason: '--no-boundary' });
  } else {
    const prefixHost = materializePrefixGeneration(options.prefixRef);
    if (prefixHost === null) {
      step('phase 3 skipped', { reason: 'git ref not materializable: ' + options.prefixRef });
      skip('cold-start boundary', 'pre-coordinator generation unavailable (needs a git checkout with ' + options.prefixRef + ')');
    } else {
      const genPre = await import(new URL('file:///' + prefixHost.replace(/\\/g, '/')).href);
      const port3 = await freePort();
      const root3 = new CordisContext();
      const fiberPre = root3.plugin(genPre.apply, { port: port3, settingsPath: scratch.file });
      await fiberPre;
      const startedPre = await root3.ocmsLifecycleService.start('http://127.0.0.1:3080');
      const pidsPre = await waitFor(() => (childPids(port3).length === 1 ? childPids(port3) : null), 15_000);
      step('phase 3: pre-coordinator generation ONLINE (no coordinator)', { state: startedPre.state, pids: pidsPre });
      check('a pre-coordinator generation still serves normally', startedPre.state === 'ONLINE' && pidsPre.length === 1);

      // Hot-swapping a coordinator generation over it is deliberately NOT
      // serialized: that is the documented upgrade boundary, demonstrated
      // rather than asserted.
      const genPost = await import(hostUrl + '?coldPost=' + Date.now());
      const fiberPost = root3.plugin(genPost.apply, { port: port3, settingsPath: scratch.file });
      let swapError = null;
      await fiberPost.then(() => {}, (err) => { swapError = err; });
      const pidsAfterSwap = childPids(port3);
      const listenersAfterSwap = listenerPids(port3);
      const predecessorState = (await genPre.currentController().status()).state;
      step('phase 3: hot swap from a pre-coordinator generation', {
        swapError: swapError ? String(swapError.message).slice(0, 80) : null,
        pids: pidsAfterSwap,
        listeners: listenersAfterSwap,
        predecessorState,
        predecessorServiceStillRegistered: Boolean(root3.ocmsLifecycleService),
      });
      check('BOUNDARY: the replacement reached publication immediately instead of queueing', Boolean(swapError) && /has been registered/.test(String(swapError.message)), { message: swapError && swapError.message });
      check('BOUNDARY: the pre-coordinator child was still alive and serving during the swap', pidsAfterSwap.length === 1 && listenersAfterSwap.length === 1, { pids: pidsAfterSwap, listeners: listenersAfterSwap });
      check('BOUNDARY: the pre-coordinator generation was still ONLINE with its service registered', predecessorState === 'ONLINE' && Boolean(root3.ocmsLifecycleService));
      step('phase 3: boundary consequence', { note: 'one cold DSH/profile restart is required after upgrading from a pre-coordinator generation' });

      try { await genPre.currentController().stop(); } catch { /* already gone */ }
      await fiberPre.dispose();
      check('the boundary demo leaves no child behind', (await waitFor(() => (childPids(port3).length === 0 ? true : null), 15_000)) === true, { pids: childPids(port3) });
    }
  }
} catch (err) {
  // An unexpected fault (an unavailable OS probe, a refused port, a changed
  // service shape) is a failure of this acceptance run, not a crash.
  failures.push('unexpected error: ' + (err && err.message ? err.message : String(err)));
  console.log('   FAIL  unexpected error :: ' + (err && err.stack ? err.stack : String(err)));
} finally {
  clearTimeout(watchdog);
  for (const port of usedPorts) killChildren(port);
  try { fs.rmSync(scratch.dir, { recursive: true, force: true }); } catch { /* best effort */ }
}

console.log('');
if (failures.length === 0) {
  console.log('SMOKE RESULT: PASS (' + results.length + ' steps)');
  process.exit(0);
}
console.log('SMOKE RESULT: FAIL (' + failures.length + ')');
for (const failure of failures) console.log('  - ' + failure);
process.exit(1);
