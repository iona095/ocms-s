// OCMS-S v1.4 — pure DSH-side OCMS lifecycle controller (contract v1.4
// sections 8, 11-21). No DSH package imports: every side effect (spawn, port
// probe, readiness probe, timers) arrives through the deps seam, so the whole
// state machine is deterministically testable. The DSH plugin wrapper
// (dsh/host.mjs) owns configuration, the embed-origin policy, and the typed
// Remote surface.
//
// States: OFFLINE STARTING ONLINE STOPPING EXTERNAL ERROR.
// Exactly one owned child per controller; ownership is the spawned child
// handle itself (contract section 12) — never inferred from process tables.
import fs from 'node:fs';
import path from 'node:path';
import { parseEmbedOrigin } from '../ui.mjs';

const READINESS_DEADLINE_MS = 15_000;
const READINESS_INTERVAL_MS = 250;
const STOP_GRACEFUL_MS = 5_000;
const STOP_FORCE_MS = 2_000;

// RemoteError-shaped domain failures (contract section 24): { code, message }
// with a safe human message; no stack content ever crosses Remote.
function ocmsFailure(code, message) {
  return Object.assign(new Error(message), { code, ocmsFailure: true });
}

/** True when a caught value is this controller's RemoteError-shaped failure. */
export function isOcmsFailure(value) {
  return value instanceof Error && typeof value.code === 'string' && value.ocmsFailure === true;
}

function readinessSatisfied(probe) {
  return Boolean(
    probe &&
    probe.ok === true &&
    probe.status === 200 &&
    probe.json &&
    typeof probe.json === 'object' &&
    probe.json.ok === true,
  );
}

export function createLifecycleController(deps) {
  const {
    uiPath,
    port,
    settingsPath,
    nodeExecutable,
    probePort,
    spawnFn,
    probeHttp,
    deadlineMs = READINESS_DEADLINE_MS,
    intervalMs = READINESS_INTERVAL_MS,
    log,
  } = deps;

  const safeLog = log ?? { info() {}, warn() {}, error() {} };

  let state = 'OFFLINE';
  let ownedChild = null;
  let ownedUrl = null;
  let ownedEmbedOrigin = null;
  let lastMessage = null;
  let transition = null; // 'start' | 'stop' while a transition is in progress
  let disposed = false; // permanent Host/plugin disposal fence (contract section 19)
  let generation = 0; // epoch bumped on every dispose; invalidates in-flight Start
  let exitInfo = null; // first exit/error payload of the current owned child
  let exitedChild = null; // the one handle whose own 'exit' was observed
  let termination = null; // the one termination authority for the owned child
  const exitWaiters = new Set(); // waiters bound to one exact child exit
  const transitionWaiters = new Set(); // waiters for "no transition in flight"
  let onStateListener = null; // per-start observer (options.onState)

  const emit = (next) => {
    state = next;
    // Observers receive the same trusted status payload the Remote status()
    // returns, so every consumer renders one consistent shape.
    const payload = statusPayload();
    if (typeof deps.onState === 'function') {
      try { deps.onState(payload); } catch { /* listener faults never break the controller */ }
    }
    if (onStateListener !== null) {
      try { onStateListener(payload); } catch { /* listener faults never break the controller */ }
    }
  };

  function statusPayload() {
    const payload = { state, port };
    if (state === 'ONLINE') {
      payload.url = ownedUrl;
      if (ownedEmbedOrigin !== null) payload.embedOrigin = ownedEmbedOrigin;
    }
    if (lastMessage !== null) payload.message = lastMessage;
    return payload;
  }

  // §12: releasing ownership is an exact-child exit fact, never a signal, a
  // kill() return value, a port probe, or elapsed time. The exit marker is
  // deliberately kept here so waiters and pollers can still observe that this
  // handle exited after ownership moved on to a reconciliation.
  function clearOwnership() {
    ownedChild = null;
    ownedUrl = null;
    ownedEmbedOrigin = null;
  }

  function settleExitWaiters(child) {
    for (const waiter of [...exitWaiters]) {
      if (waiter.child !== child) continue;
      exitWaiters.delete(waiter);
      waiter.resolve(true);
    }
  }

  // §19/§45: disposal and stop completion wait for the exact child exit. This
  // promise is settled only by that child's own 'exit' event.
  function waitForExactExit(child) {
    if (exitedChild === child) return Promise.resolve(true);
    return new Promise((resolve) => { exitWaiters.add({ child, resolve }); });
  }

  // §44: exactly one termination sequence per owned child. The first requester
  // runs it; later requesters (Stop, dispose, a Start that lost its Host) join
  // the same task instead of sending another signal. A fault while requesting
  // the graceful signal means the handle itself is unusable, so the sequence
  // stops there and the caller keeps ownership.
  function requestTermination(child) {
    if (termination !== null && termination.child === child) return termination.promise;
    const task = { child, promise: null };
    task.promise = (async () => {
      try {
        child.kill('SIGTERM');
      } catch (err) {
        safeLog.error('graceful termination request failed: ' + (err && err.message ? err.message : 'unknown cause'));
        return false;
      }
      if (await waitForExit(child, STOP_GRACEFUL_MS)) return true;
      try { child.kill('SIGKILL'); } catch { /* already gone */ }
      return waitForExit(child, STOP_FORCE_MS);
    })();
    termination = task;
    return task.promise;
  }

  function settleTransitionWaiters() {
    for (const resolve of [...transitionWaiters]) {
      transitionWaiters.delete(resolve);
      resolve();
    }
  }

  // A disposal that lands while a Start is still in flight waits for that
  // transition to settle, so a child adopted in the same tick is inherited
  // here instead of escaping the disposal window.
  function whenTransitionSettled() {
    if (transition === null) return Promise.resolve();
    return new Promise((resolve) => { transitionWaiters.add(resolve); });
  }

  // A child 'error' is a fault, not a termination: it fails a Start promptly but
  // leaves ownership with the handle until the exact exit arrives.
  function childFaulted() {
    return exitInfo !== null && exitInfo.kind === 'error';
  }

  // A startup failure whose child may still be alive keeps ownership and
  // reports ERROR (§16/§35); only the exact exit moves on to OFFLINE.
  function retainStartupFailure(message) {
    lastMessage = message;
    emit('ERROR');
  }

  // §40: actively drained stdio — pipes are consumed (never filled) and the
  // child's transient output is discarded: the OCMS server emits no tokens,
  // headers, or settings content, and nothing here may log them regardless.
  function drainChildStdio(child) {
    const swallow = () => {};
    if (child.stdout && typeof child.stdout.on === 'function') child.stdout.on('data', swallow);
    if (child.stderr && typeof child.stderr.on === 'function') child.stderr.on('data', swallow);
  }

  function attachChildHandlers(child) {
    drainChildStdio(child);
    child.on('exit', (code, signal) => {
      if (ownedChild !== child) return;
      // §12: this event is the one proof that the owned child is gone.
      exitedChild = child;
      if (exitInfo === null) exitInfo = { kind: 'exit', code, signal };
      if (state === 'STARTING') {
        clearOwnership();
        lastMessage = 'OCMS-S exited during startup (exit code ' + String(code) + ').';
        log.error(lastMessage);
        emit('OFFLINE');
      } else if (state === 'ONLINE') {
        // §43: never retain stale ONLINE ownership after an unexpected exit.
        clearOwnership();
        lastMessage = 'OCMS-S server exited unexpectedly.';
        log.warn(lastMessage);
        emit('OFFLINE');
      } else if (state === 'ERROR') {
        clearOwnership();
        exitInfo = null;
        emit('OFFLINE');
      }
      // STOPPING: the stop or dispose flow consumes this exit; state is already
      // moving.
      settleExitWaiters(child);
    });
    child.on('error', (err) => {
      if (ownedChild !== child) return;
      // §12/§44: an error is a fault, not a termination. Ownership stays with
      // the exact handle until its exit arrives, and the state reports ERROR.
      if (exitInfo === null) exitInfo = { kind: 'error', err };
      if (state === 'STARTING') {
        lastMessage = 'OCMS-S failed to start.';
        log.error(lastMessage);
        emit('ERROR');
      } else if (state === 'ONLINE') {
        lastMessage = 'OCMS-S server failed.';
        log.warn(lastMessage);
        emit('ERROR');
      }
      // STOPPING/ERROR: the pending stop or dispose flow owns the outcome.
    });
  }

  async function status() {
    return statusPayload();
  }

  // Disposal fence: a Start captured myGeneration at entry. Any dispose()
  // bumped generation (or set disposed) since then invalidates it. Pending
  // async work may finish, but it MUST NOT spawn or transition ONLINE.
  function startInvalidated(myGeneration) {
    return disposed || generation !== myGeneration;
  }

  function disposalFailure() {
    return ocmsFailure('ocms/start-failed', 'The DSH Host instance was disposed during startup.');
  }

  async function start(options = {}) {
    // Synchronous transition fence (§21/§48): concurrent Starts each run this
    // sync prefix, so exactly one proceeds.
    // Permanent disposal fence (§19): a disposed Host instance never spawns.
    if (disposed) {
      return Promise.reject(ocmsFailure('ocms/start-failed', 'The DSH Host instance was disposed; Start is no longer available.'));
    }
    if (transition !== null) {
      return Promise.reject(ocmsFailure('ocms/busy', 'A lifecycle transition is already in progress; retry explicitly after it settles.'));
    }
    if (state === 'ONLINE') {
      // Idempotent Start (§21) performs no spawn, but every Start still
      // validates the supplied origin (§15 step 5 applies to every Start).
      try {
        parseEmbedOrigin(options.embedOrigin);
      } catch {
        return Promise.reject(ocmsFailure('ocms/not-local', 'The embed origin is not a validated local DSH origin.'));
      }
      return statusPayload();
    }
    if (state === 'STARTING' || state === 'STOPPING') {
      return Promise.reject(ocmsFailure('ocms/busy', 'A lifecycle transition is already in progress.'));
    }
    // §12/§19: any retained handle blocks a new spawn, whatever the reported
    // state. Only that handle's own exit releases ownership.
    if (ownedChild !== null) {
      return Promise.reject(ocmsFailure('ocms/start-failed', 'The previous OCMS-S child has not exited.'));
    }

    transition = 'start';
    const myGeneration = generation;
    lastMessage = null;
    onStateListener = typeof options.onState === 'function' ? options.onState : null;
    try {
      // (2) port state (§36): bounded local probe; occupied ⇒ EXTERNAL refusal.
      // A probe that itself fails is treated as free (the spawn race resolves
      // to ERROR at bind time) and the underlying fault is logged.
      emit('OFFLINE');
      let portState;
      try {
        portState = await probePort();
      } catch (err) {
        safeLog.warn('port probe failed (' + (err && err.message ? err.message : 'unknown') + '); proceeding to spawn');
        portState = 'free';
      }
      // Disposal fence (§19): dispose() during the probe invalidates this
      // Start. The pending probe may finish but MUST NOT spawn afterward.
      if (startInvalidated(myGeneration)) {
        clearOwnership();
        lastMessage = 'The DSH Host instance was disposed during startup.';
        emit('OFFLINE');
        throw ocmsFailure('ocms/start-failed', lastMessage);
      }
      if (portState !== 'free') {
        emit('EXTERNAL');
        lastMessage = 'Port ' + port + ' is already in use by a process not owned by this DSH instance.';
        throw ocmsFailure('ocms/port-in-use', lastMessage);
      }
      // (3) Node executable (§13).
      const nodeBin = nodeExecutable();
      if (typeof nodeBin !== 'string' || nodeBin.length === 0) {
        lastMessage = 'Configured Node executable is unavailable.';
        throw ocmsFailure('ocms/start-failed', lastMessage);
      }
      // (4) absolute ui.mjs (§14).
      if (!path.isAbsolute(uiPath) || !fs.existsSync(uiPath)) {
        lastMessage = 'The OCMS-S ui.mjs script could not be located.';
        throw ocmsFailure('ocms/start-failed', lastMessage);
      }
      // (5) embed origin (§25/§27): validated here and again inside ui.mjs.
      let normalizedOrigin;
      try {
        normalizedOrigin = parseEmbedOrigin(options.embedOrigin);
      } catch {
        throw ocmsFailure('ocms/not-local', 'The embed origin is not a validated local DSH origin.');
      }
      // Disposal fence (§19): re-check immediately before spawn so a
      // dispose() that landed after the probe cannot be followed by a spawn.
      if (startInvalidated(myGeneration)) {
        lastMessage = 'The DSH Host instance was disposed during startup.';
        emit('OFFLINE');
        throw disposalFailure();
      }
      // (6) STARTING strictly before spawn (§38).
      emit('STARTING');
      // (7) exactly one child, shell:false, host-owned arguments only (§39).
      const args = [uiPath, '--no-open', '--port=' + port, '--embed-origin=' + normalizedOrigin];
      if (settingsPath !== undefined) args.push('--settings=' + settingsPath);
      let child;
      try {
        child = spawnFn(nodeBin, args, { shell: false });
      } catch {
        lastMessage = 'OCMS-S failed to start.';
        emit('OFFLINE');
        throw ocmsFailure('ocms/start-failed', lastMessage);
      }
      // §12: a handle that exists is owned. Adoption happens before the
      // disposal fence so a same-tick dispose() and this Start share one
      // termination authority instead of racing two independent kills.
      ownedChild = child;
      ownedUrl = 'http://127.0.0.1:' + port + '/';
      ownedEmbedOrigin = normalizedOrigin;
      exitInfo = null;
      exitedChild = null;
      termination = null;

      // (8) exit/error handlers attached immediately (§38).
      attachChildHandlers(child);

      // Disposal fence (§19): a dispose() racing the sync spawn window must
      // not leave an orphan. The child is owned, so the shared termination
      // authority drives it out and the pending disposal waits for its exit;
      // this Start never reaches ONLINE.
      if (startInvalidated(myGeneration)) {
        requestTermination(child);
        lastMessage = 'The DSH Host instance was disposed during startup.';
        throw ocmsFailure('ocms/start-failed', lastMessage);
      }

      // (9) bounded readiness during STARTING only (§16). The deadline is
      // measured against the real clock; the inter-probe pause comes from the
      // injected timers so tests stay deterministic. No steady-state polling:
      // this loop exists only inside the STARTING transition.
      const startedAt = Date.now();
      for (;;) {
        // Disposal fence (§19): a dispose() during any readiness await
        // invalidates this Start. The owned child joins the one termination
        // authority; ownership and the exact exit are reconciled by the exit
        // handler and by the pending disposal, never by this Start.
        if (startInvalidated(myGeneration)) {
          requestTermination(child);
          lastMessage = 'The DSH Host instance was disposed during startup.';
          throw ocmsFailure('ocms/start-failed', lastMessage);
        }
        if (exitedChild === child) {
          throw ocmsFailure('ocms/start-failed', lastMessage ?? 'OCMS-S exited during startup.');
        }
        if (childFaulted()) {
          requestTermination(child);
          throw ocmsFailure('ocms/start-failed', lastMessage ?? 'OCMS-S failed to start.');
        }
        let probe;
        try {
          probe = await probeHttp('http://127.0.0.1:' + port + '/api/state');
        } catch {
          probe = { ok: false, status: 0, json: null };
        }
        // Disposal fence (§19): a stale READY after disposal is ignored.
        if (startInvalidated(myGeneration)) {
          requestTermination(child);
          lastMessage = 'The DSH Host instance was disposed during startup.';
          throw ocmsFailure('ocms/start-failed', lastMessage);
        }
        if (readinessSatisfied(probe)) break;
        if (exitedChild === child) {
          throw ocmsFailure('ocms/start-failed', lastMessage ?? 'OCMS-S exited during startup.');
        }
        if (childFaulted()) {
          requestTermination(child);
          throw ocmsFailure('ocms/start-failed', lastMessage ?? 'OCMS-S failed to start.');
        }
        if (Date.now() - startedAt >= deadlineMs) {
          // §16/§35: the deadline fails the Start, it does not terminate the
          // child. Ownership is retained until the exact exit arrives and a
          // later Start stays refused until then.
          requestTermination(child);
          retainStartupFailure('OCMS-S did not become ready before the startup deadline.');
          throw ocmsFailure('ocms/readiness-timeout', lastMessage);
        }
        // A real event-loop yield between probes: a purely microtask-based
        // pause would starve child exit/error callbacks and timers.
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }
      // Disposal fence (§19): final gate immediately before ONLINE. No
      // disposed STARTING operation ever transitions back to ONLINE.
      if (startInvalidated(myGeneration)) {
        requestTermination(child);
        lastMessage = 'The DSH Host instance was disposed during startup.';
        throw ocmsFailure('ocms/start-failed', lastMessage);
      }
      // (10) ONLINE only after readiness.
      emit('ONLINE');
      // (11) trusted lifecycle state.
      return statusPayload();
    } finally {
      transition = null;
      onStateListener = null;
      settleTransitionWaiters();
    }
  }

  async function stop() {
    // Synchronous fence: validate ownership and request termination in the
    // sync prefix, so Stop never races a concurrent transition (§21).
    if (transition !== null) {
      return Promise.reject(ocmsFailure('ocms/busy', 'A lifecycle transition is already in progress.'));
    }
    if (ownedChild === null) {
      const message = state === 'EXTERNAL'
        ? 'The OCMS-S port is occupied by a process not owned by this DSH instance; nothing to stop.'
        : 'No plugin-owned OCMS-S server is running.';
      return Promise.reject(ocmsFailure('ocms/not-owned', message));
    }

    transition = 'stop';
    const child = ownedChild;
    try {
      if (state !== 'STOPPING') emit('STOPPING');
      // §44: Stop joins the one termination authority for this exact child, so
      // a dispose() or a Start abort that already asked cannot double-signal.
      const exited = await requestTermination(child);
      if (!exited) {
        // A failed stop leaves ownership with the child that refused to exit;
        // the state falls back to ERROR (contract section 35).
        safeLog.error('stop failed: the owned child did not report an exit after force termination');
        lastMessage = 'OCMS-S could not be stopped cleanly (the child did not report an exit).';
        emit('ERROR');
        throw ocmsFailure('ocms/stop-failed', lastMessage);
      }
      if (ownedChild === child) {
        clearOwnership();
        exitInfo = null;
        lastMessage = null;
        emit('OFFLINE');
      }
      return statusPayload();
    } finally {
      transition = null;
      settleTransitionWaiters();
    }
  }

  async function waitForExit(child, ms) {
    const started = Date.now();
    while (exitedChild !== child && Date.now() - started < ms) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return exitedChild === child;
  }

  async function dispose() {
    // Disposal fence (§19): synchronously invalidate the current generation so
    // any in-flight Start observes cancellation after its next await and can
    // neither spawn nor transition ONLINE. Permanent: the creating Host
    // instance is gone, so later Starts are refused and no child may outlive it.
    disposed = true;
    generation += 1;
    // A Start that has not spawned yet can still adopt a child in this tick;
    // waiting for the in-flight transition to settle makes that handle part of
    // this disposal instead of an orphan.
    if (ownedChild === null) await whenTransitionSettled();
    // Nothing owned (idle, EXTERNAL, or a Start refused before spawn): the
    // generation bump above is the whole fence.
    if (ownedChild === null) return;
    const child = ownedChild;
    // A child that is going away is reported as STOPPING, never as OFFLINE
    // while it may still be alive.
    if (state !== 'STOPPING') emit('STOPPING');
    // §19/§45: disposal completes only on the exact child exit. The termination
    // authority is shared with Stop and with a Start abort, so no second signal
    // is sent and ownership is never released on a guess. An unconfirmable
    // child keeps this disposer pending for as long as it stays alive.
    requestTermination(child);
    await waitForExactExit(child);
    // The exit handler reconciles STARTING/ONLINE/ERROR. When this disposal
    // moved the state to STOPPING there is no stop flow to reconcile it.
    if (ownedChild === child && transition !== 'stop') {
      clearOwnership();
      exitInfo = null;
      lastMessage = null;
      emit('OFFLINE');
    }
  }

  return { status, start, stop, dispose };
}
