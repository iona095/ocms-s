// Shared helpers for the OCMS-S v1.4 DSH integration pre-implementation test
// suite (controlled RED gate). Same discipline as tests/v1.3/helpers.mjs:
// Node built-ins only, production guard, capability anchors, conditional skips.
// Contract v1.4 SHA-256 3a4461d099e8994c773c98cfe3d001b9fb872fc182c64d31eddf8e46d4f27831.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

import {
  REPO_ROOT,
  assertScratchTarget,
  scratchDir,
  scratchSettingsFile,
  sha256Hex,
} from '../v1.3/helpers.mjs';

export { assert } from '../v1.3/helpers.mjs';
export {
  REPO_ROOT,
  assertScratchTarget,
  scratchDir,
  scratchSettingsFile,
  sha256Hex,
};

// ---------------------------------------------------------------------------
// v1.4 capability anchors (contract v1.4 sections 14, 23, 26, 32). These are
// the ONLY intentional RED sources; dependent tests conditionally skip.
// ---------------------------------------------------------------------------

const UI_PATH = path.join(REPO_ROOT, 'ui.mjs');
export const LIFECYCLE_PATH = path.join(REPO_ROOT, 'dsh', 'lifecycle.mjs');
export const HOST_PATH = path.join(REPO_ROOT, 'dsh', 'host.mjs');
export const CLIENT_SOURCE_PATH = path.join(REPO_ROOT, 'dsh', 'client.mjs');
export const PATCH_PATH = path.join(REPO_ROOT, 'cordis.patch.yml');
export const BUILD_SCRIPT_PATH = path.join(REPO_ROOT, 'dsh', 'build-client.mjs');
export const CLIENT_BUNDLE_PATH = path.join(REPO_ROOT, 'dsh', 'client.js');

export async function loadUiModule() {
  return import(pathToFileURL(UI_PATH).href);
}

export async function loadLifecycleModule() {
  return import(pathToFileURL(LIFECYCLE_PATH).href);
}

export async function loadClientSourceModule() {
  return import(pathToFileURL(CLIENT_SOURCE_PATH).href);
}

// Anchor: ui.mjs must export the embed-origin parser as a pure function.
export async function probeEmbedOriginCapability() {
  try {
    const ui = await loadUiModule();
    return typeof ui.parseEmbedOrigin === 'function' && typeof ui.startServer === 'function';
  } catch {
    return false;
  }
}

// Anchor: the pure lifecycle controller module must exist with the factory.
export async function probeLifecycleCapability() {
  if (!fs.existsSync(LIFECYCLE_PATH)) return false;
  try {
    const m = await loadLifecycleModule();
    return typeof m.createLifecycleController === 'function';
  } catch {
    return false;
  }
}

// Anchor: the client view source must exist with the component factory.
export async function probeClientSourceCapability() {
  if (!fs.existsSync(CLIENT_SOURCE_PATH)) return false;
  try {
    const m = await loadClientSourceModule();
    return typeof m.makeModelsView === 'function';
  } catch {
    return false;
  }
}

// Anchor: bundle build script exists (Phase G artifact producer).
export function probeBundleBuildCapability() {
  return fs.existsSync(BUILD_SCRIPT_PATH);
}

// Anchor: built client bundle exists in rc.2 __ModuleLoader__ form.
export function probeClientBundleCapability() {
  if (!fs.existsSync(CLIENT_BUNDLE_PATH)) return false;
  const head = fs.readFileSync(CLIENT_BUNDLE_PATH, 'utf8').slice(0, 200);
  return head.includes('window.__ModuleLoader__.load');
}

// v1.3 released identity (contract v1.4 section 2): sync.mjs and ui/index.html
// MUST stay byte-identical to the published v1.3 release hashes.
export const V13_SYNC_SHA = '9211544a0bba60e3e19a78a8d089d84f9eacedb6105631489ebe377285188c07';
export const V13_UI_HTML_SHA = '6610e7354f64eb1edbd4827df65fa120c1410ba9121e33fcab87637d96deddf8';

// ---------------------------------------------------------------------------
// RemoteError-shaped failure contract (contract v1.4 section 24): the pure
// controller throws objects carrying exactly { code, message } domain codes.
// ---------------------------------------------------------------------------

export const OCMS_CODES = [
  'ocms/incompatible-dsh',
  'ocms/port-in-use',
  'ocms/start-failed',
  'ocms/readiness-timeout',
  'ocms/not-owned',
  'ocms/stop-failed',
  'ocms/not-local',
  'ocms/busy',
];

export function assertOcmsFailure(thrown, expectedCode) {
  const code = thrown && thrown.code;
  const message = thrown && thrown.message;
  if (typeof code !== 'string') throw new Error('expected RemoteError-shaped {code,message} failure, got ' + JSON.stringify(thrown));
  if (expectedCode !== undefined) {
    if (code !== expectedCode) throw new Error('expected code ' + expectedCode + ', got ' + code + ' (' + String(message) + ')');
  } else if (!OCMS_CODES.includes(code)) {
    throw new Error('unknown ocms domain code: ' + code);
  }
  if (typeof message !== 'string' || message.length === 0) throw new Error('failure must carry a safe human message');
  if (/\n\s+at |\s+at .+:\d+/.test(message)) throw new Error('failure message must not carry stack frames');
  return thrown;
}

// ---------------------------------------------------------------------------
// Deterministic lifecycle doubles. The pure controller receives every side
// effect as an injected dependency, so all scheduling is deterministic.
//
// Child double contract (what lifecycle.mjs may rely on):
//   { pid, kill(signal?), on(event, cb), stdout: { on(ev, cb) }, stderr: { on(ev, cb) } }
// ---------------------------------------------------------------------------

export function deferred() {
  let resolve;
  const promise = new Promise((res) => { resolve = res; });
  return { promise, resolve };
}

export function childDouble({ pid = 4242, exitEvent = 'exit', exitPayload = [0] } = {}) {
  const handlers = new Map();
  const stdoutHandlers = [];
  const stderrHandlers = [];
  const child = {
    pid,
    exited: false,
    exitPayload: null,
    spawnedArgs: null,
    killed: [],
    on(event, cb) {
      if (event === exitEvent) {
        if (exitEvent === 'exit') {
          // Mirror real ChildProcess: 'exit' fires when terminated.
        }
        const list = handlers.get(event) ?? [];
        list.push(cb);
        handlers.set(event, list);
      } else {
        const list = handlers.get(event) ?? [];
        list.push(cb);
        handlers.set(event, list);
      }
      return child;
    },
    stdout: { on(ev, cb) { stdoutHandlers.push([ev, cb]); } },
    stderr: { on(ev, cb) { stderrHandlers.push([ev, cb]); } },
    kill(signal) {
      child.killed.push(signal ?? undefined);
      return true;
    },
    fire(type, ...args) {
      if (type === 'stdio') {
        for (const [, cb] of stdoutHandlers) cb(Buffer.from(String(args[0])));
        return;
      }
      const list = handlers.get(type) ?? [];
      for (const cb of list) cb(...args);
    },
    fireExit(code, signal) {
      if (child.exited) return;
      child.exited = true;
      child.exitPayload = [code, signal];
      child.fire('exit', code, signal);
    },
    fireError(err) {
      child.exited = true;
      child.fire('error', err);
    },
  };
  return child;
}

export function makeDeps(overrides = {}) {
  const record = {
    spawned: [],
    probes: [],
    readinessCalls: [],
    killed: [],
    timers: [],
  };
  let childCounter = 0;
  const deps = {
    uiPath: path.join(REPO_ROOT, 'ui.mjs'),
    port: 18751,
    settingsPath: undefined,
    nodeExecutable() { return process.execPath; },
    // Default: port appears free, and the first spawned child binds it.
    probePort: async () => 'free',
    spawnFn(cmd, args, opts) {
      const child = childDouble();
      child.spawnedArgs = { cmd, args, opts };
      record.spawned.push(child.spawnedArgs);
      childCounter += 1;
      // Default behavior: child stays alive; tests drive exit via the handle.
      return child;
    },
    // Default readiness: never ready (tests override with a sequence).
    probeHttp: async () => ({ ok: false, status: 0, json: null }),
    deadlineMs: 15_000,
    intervalMs: 250,
    timers: {
      setTimeout(fn, ms) { record.timers.push(ms); fn(); return 0; },
      clearTimeout() {},
      async delay() {},
    },
    log: { info() {}, warn() {}, error() {} },
    ...overrides,
  };
  return { deps, record };
}

// Readiness sequence helper: probeHttp results consumed in order, last repeats.
export function readinessSequence(results) {
  let i = 0;
  return async () => {
    const value = results[Math.min(i, results.length - 1)];
    i += 1;
    return value;
  };
}

// ---------------------------------------------------------------------------
// Deterministic v1.4 ports (contract v1.4 section 32): derived from the
// calling file name, distinct from the v1.3 block (base 18900).
// ---------------------------------------------------------------------------

const callingFile = path.basename(process.argv[1] || 'unknown.test.mjs');
const portSeed = crypto.createHash('sha256').update('ocms-v14-test-port:' + callingFile).digest().readUInt32BE(0) % 32;
const PORT_BASE = 18900 + portSeed * 6;
let portCursor = 0;

export function nextTestPort() {
  const port = PORT_BASE + (portCursor % 6);
  portCursor += 1;
  return port;
}

export { createRequire };
