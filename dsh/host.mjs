// OCMS-S v1.4 — DSH Host plugin (contract v1.4 sections 6-8, 12-24).
// Owns exactly one OCMS server lifecycle controller per DSH Host process:
// status, Start, Stop, child ownership, and plugin disposal. It hosts the
// existing ui.mjs child and exposes a minimal typed Remote surface; it is
// NOT a synchronization implementation and never touches model data.
import path from 'node:path';
import net from 'node:net';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { Service } from '@deepseek-ai/cordis';
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol';
import { createLifecycleController, isOcmsFailure } from './lifecycle.mjs';

export const name = 'ocms-s';
export const inject = [];

const UI_PATH = fileURLToPath(new URL('../ui.mjs', import.meta.url));
const DEFAULT_PORT = 18751;

// Config comes only from Host-owned profile configuration (contract section
// 31): never from the browser. settingsPath is a development/scratch-only
// escape hatch and must stay unset in production rows.
let schemastery = null;
try {
  const mod = await import('@deepseek-ai/schemastery');
  schemastery = mod.default ?? mod;
} catch (err) {
  throw new Error('ocms/incompatible-dsh: @deepseek-ai/schemastery is unavailable in this DSH runtime');
}

export const Config = schemastery.object({
  port: schemastery.number().default(DEFAULT_PORT),
  nodeBin: schemastery.string(),
  settingsPath: schemastery.string(),
});

// §13: validated process.execPath, or a validated configured nodeBin. The
// candidate must be a Node binary that executes successfully; no shell.
function resolveNodeExecutable(configuredNodeBin) {
  const candidate = configuredNodeBin || process.execPath;
  if (typeof candidate !== 'string' || candidate.length === 0) return null;
  const base = path.basename(candidate).toLowerCase();
  if (!(base === 'node' || base === 'node.exe')) return null;
  const probe = spawnSync(candidate, ['--version'], { shell: false, encoding: 'utf8', timeout: 5000 });
  if (probe.error || probe.status !== 0) return null;
  const version = String(probe.stdout || '').trim();
  if (!/^v\d/.test(version)) return null;
  return candidate;
}

// §36: bounded local TCP connect probe. It never creates authority over the
// listening process; a timeout is treated as free so a spawn race resolves
// to ERROR rather than an ownership claim.
function probePortTcp(port) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch (ignored) { /* best effort */ }
      resolve(result);
    };
    const socket = net.connect({ host: '127.0.0.1', port, timeout: 1000 });
    socket.on('connect', () => finish('occupied'));
    socket.on('error', () => finish('free'));
    socket.on('timeout', () => finish('free'));
  });
}

async function probeHttpState(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
  let json = null;
  try { json = await res.json(); } catch (ignored) { /* wrong shape stays not-ready */ }
  return { ok: res.ok, status: res.status, json };
}

function safeLog() {
  return {
    info() {},
    warn(message) { try { console.warn('[ocms-s]', message); } catch (ignored) { /* best effort */ } },
    error(message) { try { console.error('[ocms-s]', message); } catch (ignored) { /* best effort */ } },
  };
}

// Typed Remote surface (§22/§23): status/start/stop only; lifecycle data
// only. Hand-assembled Remote markers follow the exact runtime protocol the
// @Remote decorators produce (prototype descriptor version 1 + the visible
// typertRemote binding), because this plugin ships as plain ESM.
const REMOTE_METHOD_DESCRIPTOR = '@deepseek-ai/dsh-typert-protocol/remote-methods';

export class OcmsLifecycleService extends Service {
  constructor(ctx, controller) {
    super(ctx, 'ocmsLifecycleService');
    this.controller = controller;
    this.typertRemote = Object.freeze({ service: this, serviceKey: this.name, namespace: 'ocms' });
  }

  async status() {
    return this.forwardFailure(() => this.controller.status());
  }

  async start(embedOrigin) {
    return this.forwardFailure(() => this.controller.start({ embedOrigin }));
  }

  async stop() {
    return this.forwardFailure(() => this.controller.stop());
  }

  async forwardFailure(operation) {
    try {
      return await operation();
    } catch (err) {
      if (isOcmsFailure(err)) throw new RemoteError(err.code, err.message, {});
      throw err;
    }
  }
}

Object.defineProperty(OcmsLifecycleService.prototype, REMOTE_METHOD_DESCRIPTOR, {
  configurable: true,
  value: Object.freeze({
    version: 1,
    methods: Object.freeze([
      Object.freeze({ method: 'status', invocation: Object.freeze({ kind: 'direct' }) }),
      Object.freeze({ method: 'start', invocation: Object.freeze({ kind: 'direct' }) }),
      Object.freeze({ method: 'stop', invocation: Object.freeze({ kind: 'direct' }) }),
    ]),
  }),
});

// ---------------------------------------------------------------------------
// Process-global, per-root generation handoff (contract v1.4 sections 19, 29,
// 45). A Cordis HMR replacement imports the new module generation, drops the
// retiring plugin from the registry and starts unloading the old fiber WITHOUT
// awaiting its disposer, so two evaluations of this file are live in one
// process at the same time. Only a process-global arbiter can order them: the
// retiring generation must finish its exact-exit child cleanup before the
// replacement publishes a service, or one Host root would have two children.
// ---------------------------------------------------------------------------

const COORDINATOR_KEY = Symbol.for('ocms-s/generation-coordinator');

function coordinator() {
  const found = globalThis[COORDINATOR_KEY];
  if (found !== undefined) return found;
  const created = { roots: new WeakMap() };
  Object.defineProperty(globalThis, COORDINATOR_KEY, {
    value: created,
    enumerable: false,
    writable: false,
    configurable: false,
  });
  return created;
}

function rootLease(root) {
  const roots = coordinator().roots;
  const existing = roots.get(root);
  if (existing !== undefined) return existing;
  const lease = { holder: null, waiting: [] };
  roots.set(root, lease);
  return lease;
}

// Resolves the lease this apply owns, or null when a newer generation
// superseded it while it was queued — a stale generation must never resurrect
// itself behind its replacement. The lease token is per apply call, so a second
// apply of the same module generation is serialized instead of running a second
// controller beside the first.
function acquireLease(root) {
  const state = rootLease(root);
  const lease = { root, token: {} };
  if (state.holder === null) {
    state.holder = lease.token;
    return Promise.resolve(lease);
  }
  return new Promise((resolve) => {
    const superseded = state.waiting.splice(0, state.waiting.length);
    state.waiting.push({ lease, resolve });
    for (const waiter of superseded) waiter.resolve(null);
  });
}

// Releasing is identity-checked against the lease token: a disposer that runs
// twice, or that runs after another apply already took the lease, can never
// free a lease it does not hold. The newest queued generation wins the free
// lease; everything queued before it is retired.
function releaseLease(lease) {
  const state = rootLease(lease.root);
  if (state.holder !== lease.token) return;
  state.holder = null;
  const next = state.waiting.pop() ?? null;
  const superseded = state.waiting.splice(0, state.waiting.length);
  for (const waiter of superseded) waiter.resolve(null);
  if (next === null) return;
  state.holder = next.lease.token;
  next.resolve(next.lease);
}

// The controller published by THIS module generation (null when idle). Module
// scope is the generation scope: a retiring generation can never report a
// controller that a replacement has already published.
let activeController = null;

export async function apply(ctx, options = {}) {
  const config = {
    port: typeof options.port === 'number' && Number.isInteger(options.port) && options.port >= 1 && options.port <= 65535 ? options.port : DEFAULT_PORT,
    nodeBin: typeof options.nodeBin === 'string' ? options.nodeBin : undefined,
    settingsPath: typeof options.settingsPath === 'string' ? options.settingsPath : undefined,
  };

  if (typeof process.execPath !== 'string') {
    throw new Error('ocms/incompatible-dsh: no Node runtime executable is resolvable in this host');
  }

  // §19/§45: the lease is the publication barrier. A replacement generation
  // passes this await only after the retiring generation's exact-exit child
  // cleanup completed, so the service and its controller appear atomically.
  const lease = await acquireLease(ctx.root);
  // §38: a generation that a newer one superseded publishes nothing at all.
  if (lease === null) return function dispose() {};
  let controller = null;
  try {
    // Cordis' own fence: a fiber that was disposed while the lease was pending
    // is retired instead of published.
    ctx.fiber.assertActive();
    // §29: exactly one process-global lifecycle controller per Host plugin
    // instance — not per session, tab, workspace, or browser connection.
    controller = createLifecycleController({
      uiPath: UI_PATH,
      port: config.port,
      settingsPath: config.settingsPath,
      nodeExecutable: () => resolveNodeExecutable(config.nodeBin),
      probePort: () => probePortTcp(config.port),
      probeHttp: (url) => probeHttpState(url),
      spawnFn: (cmd, args, opts) => spawn(cmd, args, opts),
      log: safeLog(),
    });
    new OcmsLifecycleService(ctx, controller);
    activeController = controller;
  } catch (err) {
    // A setup failure must not strand the per-root lease: the next generation
    // would wait forever for a holder that never published anything.
    if (controller !== null && activeController === controller) activeController = null;
    releaseLease(lease);
    throw err;
  }

  // §45: the owned child must not outlive this Host plugin instance, and the
  // lease is released only after that cleanup completed on the exact exit.
  return async function dispose() {
    await controller.dispose();
    if (activeController === controller) activeController = null;
    releaseLease(lease);
  };
}

// Test seam: the controller for this module generation (null when idle).
export function currentController() {
  return activeController;
}

export function uiScriptPath() {
  return fs.existsSync(UI_PATH) ? UI_PATH : null;
}