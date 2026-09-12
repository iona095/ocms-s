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

  function clearOwnership() {
    ownedChild = null;
    ownedUrl = null;
    ownedEmbedOrigin = null;
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
      if (exitInfo === null) exitInfo = { kind: 'exit', code, signal };
      if (state === 'STARTING') {
        abortStartup('OCMS-S exited during startup (exit code ' + String(code) + ').');
        log.error(lastMessage);
      } else if (state === 'ONLINE') {
        // §43: never retain stale ONLINE ownership after an unexpected exit.
        clearOwnership();
        lastMessage = 'OCMS-S server exited unexpectedly.';
        log.warn(lastMessage);
        emit('OFFLINE');
      }
      // STOPPING: the stop flow consumes this exit; state is already moving.
    });
    child.on('error', (err) => {
      if (exitInfo === null) exitInfo = { kind: 'error', err };
      if (state === 'STARTING') {
        clearOwnership();
        lastMessage = 'OCMS-S failed to start.';
        log.error(lastMessage);
        emit('OFFLINE');
      } else if (state === 'ONLINE') {
        clearOwnership();
        lastMessage = 'OCMS-S server failed.';
        log.warn(lastMessage);
        emit('OFFLINE');
      }
    });
  }

  async function status() {
    return statusPayload();
  }

  function abortStartup(message) {
    clearOwnership();
    lastMessage = message;
    emit('OFFLINE');
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
      // Disposal fence (§19): a dispose() racing the sync spawn window must
      // not leave an orphan. Ownership has not been assigned yet, so terminate
      // the just-spawned child here; the pending Start never reaches ONLINE.
      if (startInvalidated(myGeneration)) {
        try { child.kill('SIGKILL'); } catch { /* already gone */ }
        lastMessage = 'The DSH Host instance was disposed during startup.';
        emit('OFFLINE');
        throw ocmsFailure('ocms/start-failed', lastMessage);
      }
      ownedChild = child;
      ownedUrl = 'http://127.0.0.1:' + port + '/';
      ownedEmbedOrigin = normalizedOrigin;
      exitInfo = null;

      // (8) exit/error handlers attached immediately (§38).
      attachChildHandlers(child);

      // (9) bounded readiness during STARTING only (§16). The deadline is
      // measured against the real clock; the inter-probe pause comes from the
      // injected timers so tests stay deterministic. No steady-state polling:
      // this loop exists only inside the STARTING transition.
      const startedAt = Date.now();
      for (;;) {
        // Disposal fence (§19): a dispose() during any readiness await
        // invalidates this Start. Pending work may finish but MUST NOT
        // transition ONLINE. Terminate the exact child this Start spawned.
        if (startInvalidated(myGeneration)) {
          try { child.kill('SIGKILL'); } catch { /* already gone */ }
          if (ownedChild === child) clearOwnership();
          lastMessage = 'The DSH Host instance was disposed during startup.';
          emit('OFFLINE');
          throw ocmsFailure('ocms/start-failed', lastMessage);
        }
        if (exitInfo !== null) {
          abortStartup('OCMS-S exited during startup.');
          throw ocmsFailure('ocms/start-failed', lastMessage);
        }
        let probe;
        try {
          probe = await probeHttp('http://127.0.0.1:' + port + '/api/state');
        } catch {
          probe = { ok: false, status: 0, json: null };
        }
        // Disposal fence (§19): a stale READY after disposal is ignored.
        if (startInvalidated(myGeneration)) {
          try { child.kill('SIGKILL'); } catch { /* already gone */ }
          if (ownedChild === child) clearOwnership();
          lastMessage = 'The DSH Host instance was disposed during startup.';
          emit('OFFLINE');
          throw ocmsFailure('ocms/start-failed', lastMessage);
        }
        if (readinessSatisfied(probe)) break;
        if (exitInfo !== null) {
          abortStartup('OCMS-S exited during startup.');
          throw ocmsFailure('ocms/start-failed', lastMessage);
        }
        if (Date.now() - startedAt >= deadlineMs) {
          try { ownedChild.kill('SIGKILL'); } catch { /* already gone */ }
          abortStartup('OCMS-S did not become ready before the startup deadline.');
          throw ocmsFailure('ocms/readiness-timeout', lastMessage);
        }
        // A real event-loop yield between probes: a purely microtask-based
        // pause would starve child exit/error callbacks and timers.
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }
      // Disposal fence (§19): final gate immediately before ONLINE. No
      // disposed STARTING operation ever transitions back to ONLINE.
      if (startInvalidated(myGeneration)) {
        try { child.kill('SIGKILL'); } catch { /* already gone */ }
        if (ownedChild === child) clearOwnership();
        lastMessage = 'The DSH Host instance was disposed during startup.';
        emit('OFFLINE');
        throw ocmsFailure('ocms/start-failed', lastMessage);
      }
      // (10) ONLINE only after readiness.
      emit('ONLINE');
      // (11) trusted lifecycle state.
      return statusPayload();
    } finally {
      transition = null;
      onStateListener = null;
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
    try {
      const child = ownedChild;
      emit('STOPPING');
      child.kill('SIGTERM');
      if (!(await waitForExit(STOP_GRACEFUL_MS))) {
        // Force fallback targets the exact owned child handle only (§44).
        try { child.kill('SIGKILL'); } catch { /* already gone */ }
        await waitForExit(STOP_FORCE_MS);
      }
      clearOwnership();
      exitInfo = null;
      lastMessage = null;
      emit('OFFLINE');
      return statusPayload();
    } catch (err) {
      // A failed stop leaves ownership with the child that refused to exit;
      // the state falls back to ERROR (contract section 35).
      const detail = err && typeof err.message === 'string' ? err.message.split('\n')[0] : 'unknown cause';
      safeLog.error('stop failed: ' + detail);
      lastMessage = 'OCMS-S could not be stopped cleanly (' + detail + ').';
      emit('ERROR');
      throw ocmsFailure('ocms/stop-failed', lastMessage);
    } finally {
      transition = null;
    }
  }

  async function waitForExit(ms) {
    const started = Date.now();
    while (exitInfo === null && Date.now() - started < ms) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return exitInfo !== null;
  }

  async function dispose() {
    // Disposal fence (§19): synchronously invalidate the current generation so
    // any in-flight Start observes cancellation after its next await and can
    // neither spawn nor transition ONLINE. Permanent: the creating Host
    // instance is gone, so later Starts are refused and no child may outlive it.
    disposed = true;
    generation += 1;
    if (ownedChild !== null && transition === null) {
      try { await stop(); } catch { /* disposal never throws past its own stop attempt */ }
      return;
    }
    if (ownedChild !== null) {
      // Disposal racing a transition: stop the exact owned child handle.
      // The pending Start observes the bumped generation and aborts; a later
      // READY is ignored and ONLINE is never emitted.
      try { ownedChild.kill('SIGKILL'); } catch { /* already gone */ }
      clearOwnership();
      exitInfo = null;
      lastMessage = null;
      emit('OFFLINE');
    }
    // No owned child (Start blocked before spawn, EXTERNAL, or idle): the
    // generation bump above is the fence. The pending Start aborts after its
    // probe resolves; there is nothing to terminate here and transition
    // ownership stays with the in-flight Start until its finally clears it.
  }

  return { status, start, stop, dispose };
}
