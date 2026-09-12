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

let processGlobalController = null;

export async function apply(ctx, options = {}) {
  const config = {
    port: typeof options.port === 'number' && Number.isInteger(options.port) && options.port >= 1 && options.port <= 65535 ? options.port : DEFAULT_PORT,
    nodeBin: typeof options.nodeBin === 'string' ? options.nodeBin : undefined,
    settingsPath: typeof options.settingsPath === 'string' ? options.settingsPath : undefined,
  };

  if (typeof process.execPath !== 'string') {
    throw new Error('ocms/incompatible-dsh: no Node runtime executable is resolvable in this host');
  }

  // §29: exactly one process-global lifecycle controller per Host plugin
  // instance — not per session, tab, workspace, or browser connection.
  const controller = createLifecycleController({
    uiPath: UI_PATH,
    port: config.port,
    settingsPath: config.settingsPath,
    nodeExecutable: () => resolveNodeExecutable(config.nodeBin),
    probePort: () => probePortTcp(config.port),
    probeHttp: (url) => probeHttpState(url),
    spawnFn: (cmd, args, opts) => spawn(cmd, args, opts),
    log: safeLog(),
  });
  processGlobalController = controller;

  new OcmsLifecycleService(ctx, controller);

  // §45: the owned child must not outlive this Host plugin instance.
  return function dispose() {
    processGlobalController = null;
    return controller.dispose();
  };
}

// Test seam: the controller for the current host instance (null when idle).
export function currentController() {
  return processGlobalController;
}

export function uiScriptPath() {
  return fs.existsSync(UI_PATH) ? UI_PATH : null;
}