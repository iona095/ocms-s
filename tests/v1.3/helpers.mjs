// Shared helpers for the OCMS-S v1.3 pre-implementation contract test suite
// (controlled RED gate). No production access, no live network, no new
// dependencies: only Node built-ins plus the already-installed "yaml" package
// for fixture serialization.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { mock } from 'node:test';
import assert from 'node:assert/strict';
import { stringify as stringifyYaml } from 'yaml';
import { pathToFileURL, fileURLToPath } from 'node:url';

export { assert };

// ---------------------------------------------------------------------------
// Capability anchors (contract v1.3 sections 5.5, 13, 19). These are the ONLY
// intentional RED sources; dependent tests conditionally skip on the matching
// flag so the skips disappear automatically once implementation exists.
// ---------------------------------------------------------------------------

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const sync = await import(pathToFileURL(path.join(REPO_ROOT, 'sync.mjs')).href);
export const hasBuildPlan = typeof sync.buildPlan === 'function';
export const hasCommitPlan = typeof sync.commitPlan === 'function';
export const hasEngineSeam = hasBuildPlan && hasCommitPlan;

export const UI_PATH = path.join(REPO_ROOT, 'ui.mjs');
export const UI_HTML_PATH = path.join(REPO_ROOT, 'ui', 'index.html');
export const hasUiServer = fs.existsSync(UI_PATH);
export const hasUiHtml = fs.existsSync(UI_HTML_PATH);

// Dynamic import used inside dependent test bodies only (never at module load,
// so a missing ui.mjs cannot abort the whole test file with MODULE_NOT_FOUND).
export function loadUiServerModule() {
  return import(pathToFileURL(UI_PATH).href);
}

// ---------------------------------------------------------------------------
// Production guard (gate section 12). Fails loudly; never reads production.
// ---------------------------------------------------------------------------

export function productionSettingsPath() {
  return path.join(process.env.USERPROFILE || '', '.dsh', 'settings.yaml');
}

export function assertScratchTarget(settingsPath) {
  const resolved = path.resolve(String(settingsPath));
  const production = path.resolve(productionSettingsPath());
  if (production && resolved.toLowerCase() === production.toLowerCase()) {
    throw new Error('TEST_HARNESS_GUARD: refusing production settings target: ' + resolved);
  }
  return resolved;
}

export function scratchDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocms-v13-'));
  t.after(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  });
  return dir;
}

export function scratchSettingsFile(t, config) {
  const dir = scratchDir(t);
  const file = path.join(dir, 'settings.yaml');
  fs.writeFileSync(file, stringifyYaml(config ?? emptyCurrent()), 'utf8');
  return file;
}

export function readSettingsBytes(settingsPath) {
  assertScratchTarget(settingsPath);
  return fs.readFileSync(settingsPath);
}

// ---------------------------------------------------------------------------
// Deterministic side-effect assertions (gate sections 12, 27).
// ---------------------------------------------------------------------------

export function backupCount(dir) {
  return fs.readdirSync(dir).filter((n) => n.startsWith('settings.yaml.bak-')).length;
}

export function tempResidue(dir) {
  return fs.readdirSync(dir).filter((n) => n.endsWith('.tmp') || n.startsWith('settings.yaml.tmp'));
}

export function assertNoBackupOrTemp(dir, beforeBytes) {
  assert.equal(backupCount(dir), 0, 'no backup expected');
  assert.equal(tempResidue(dir).length, 0, 'no temp file residue expected');
  if (beforeBytes !== undefined) {
    assert.deepEqual(fs.readFileSync(path.join(dir, 'settings.yaml')), beforeBytes, 'settings bytes unchanged');
  }
}

// ---------------------------------------------------------------------------
// Source fixtures (contract v1.2 sections 3/5/6; mirrors tests/sync.test.mjs).
// ---------------------------------------------------------------------------

export function catRecord(overrides = {}) {
  return {
    id: 'model-a',
    name: 'Model A',
    modalities: { input: ['text'] },
    limit: { context: 1000, output: 100 },
    reasoning: false,
    ...overrides,
  };
}

export function emptyCurrent() {
  return { llm: { unrelated: true }, 'llm-pi-ai': { providers: {} } };
}

// One valid five-source bundle. Tests override only the relevant field.
export function validSources(overrides = {}) {
  const base = {
    rosters: { go: ['model-a'], zen: ['model-z'] },
    catalog: {
      go: { npm: '@ai-sdk/openai-compatible', models: { 'model-a': catRecord({ provider: { npm: '@ai-sdk/openai-compatible' } }) } },
      zen: { npm: '@ai-sdk/openai', models: { 'model-z': catRecord({ id: 'model-z', name: 'Z', provider: { npm: '@ai-sdk/openai' } }) } },
    },
    docs: {
      go: { 'model-a': 'https://opencode.ai/zen/go/v1/chat/completions' },
      zen: { 'model-z': 'https://opencode.ai/zen/v1/responses' },
    },
  };
  const merged = { ...base };
  for (const key of Object.keys(overrides)) {
    merged[key] = { ...base[key], ...overrides[key] };
  }
  return merged;
}

export function currentWithExtras() {
  return {
    unrelatedSentinel: 'unrelated-sentinel-9137',
    'llm-pi-ai': { providers: {} },
  };
}

// ---------------------------------------------------------------------------
// Network stubs (gate section 13). Default: refuse every request loudly.
// ---------------------------------------------------------------------------

export const fetchNever = async () => {
  throw new Error('UNEXPECTED_LIVE_NETWORK');
};

export function fetchFromBodies(bodies, counter) {
  return async (url) => {
    if (counter) counter.push(url);
    const body = bodies[url];
    if (body === undefined) throw new Error('UNEXPECTED_LIVE_NETWORK: ' + String(url));
    return { ok: true, status: 200, text: async () => body };
  };
}

export function deferred() {
  let resolve;
  const promise = new Promise((res) => { resolve = res; });
  return { promise, resolve };
}

// ---------------------------------------------------------------------------
// Deterministic test ports (gate section 31): per-file block derived from the
// running test file name, sequential within a file. All ports are explicit;
// no test relies on port fallback or weakens production behavior.
// ---------------------------------------------------------------------------

const callingFile = path.basename(process.argv[1] || 'unknown.test.mjs');
const portSeed = crypto.createHash('sha256').update('ocms-v13-test-port:' + callingFile).digest().readUInt32BE(0) % 32;
const PORT_BASE = 18800 + portSeed * 6;
let portCursor = 0;

export function nextTestPort() {
  const port = PORT_BASE + (portCursor % 6);
  portCursor += 1;
  return port;
}

// ---------------------------------------------------------------------------
// HTTP client helpers (node:http only).
// ---------------------------------------------------------------------------

export function httpRequest({ port, method = 'GET', urlPath = '/', headers = {}, body = null, setHost = true, hostValue }) {
  return new Promise((resolve, reject) => {
    const requestHeaders = { ...headers };
    if (setHost) requestHeaders.Host = hostValue !== undefined ? hostValue : ('127.0.0.1:' + port);
    const req = http.request({ host: '127.0.0.1', port, method, path: urlPath, setHost, headers: requestHeaders }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    req.on('error', reject);
    if (body !== null) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

// Initiate a POST whose JSON body is deliberately withheld so the request is
// held in flight server-side. Returns { started, response, finish, abort }.
export function beginHeldRequest({ port, urlPath, headers }) {
  let resolveResponse;
  const response = new Promise((res) => { resolveResponse = res; });
  let startedResolve;
  const started = new Promise((res) => { startedResolve = res; });
  const req = http.request({
    host: '127.0.0.1',
    port,
    method: 'POST',
    path: urlPath,
    headers: { 'content-type': 'application/json', ...headers },
  }, (res) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => resolveResponse({
      status: res.statusCode,
      headers: res.headers,
      body: Buffer.concat(chunks).toString('utf8'),
    }));
  });
  req.on('socket', () => startedResolve());
  req.on('error', (err) => resolveResponse({ status: 0, headers: {}, body: 'SOCKET_ERROR: ' + String(err && err.message) }));
  req.write('{');
  let finished = false;
  return {
    started,
    response,
    finish(rest) {
      if (!finished) { finished = true; req.end(rest === undefined ? '"}' : rest); }
      return response;
    },
    abort() {
      if (!finished) { finished = true; req.destroy(); }
    },
  };
}

// Capture console output for token-never-logged assertions.
export function captureConsole(t) {
  const lines = [];
  const mocks = ['log', 'error', 'warn', 'info'].map((m) => mock.method(console, m, (...args) => {
    lines.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
  }));
  t.after(() => { for (const m of mocks) m.mock.restore(); });
  return lines;
}

export function sha256Hex(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

// Spawn a child process and resolve as soon as stdout contains marker (event
// driven; no timing sleeps). The caller owns child.kill().
export function spawnUntilStdout(args, marker, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd: options.cwd || REPO_ROOT,
      env: { ...process.env, ...(options.env || {}) },
      shell: false,
    });
    let stdout = '';
    let settled = false;
    const finish = (outcome) => {
      if (settled) return;
      settled = true;
      resolve({ child, stdout, stderr: outcome.stderr || '', code: outcome.code, matched: outcome.matched });
    };
    child.stdout.on('data', (d) => {
      stdout += String(d);
      if (stdout.includes(marker)) finish({ matched: true });
    });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += String(d); });
    child.on('close', (code) => finish({ code, stderr, matched: stdout.includes(marker) }));
    child.on('error', (err) => finish({ code: null, stderr: String(err), matched: false }));
  });
}

export function nodeSpawn(args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd: options.cwd || REPO_ROOT,
      env: { ...process.env, ...(options.env || {}) },
      shell: false,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += String(d); });
    child.stderr.on('data', (d) => { stderr += String(d); });
    child.on('close', (code, signal) => resolve({ code, stdout, stderr }));
    child.on('error', (err) => resolve({ code: null, stdout, stderr: String(err) }));
  });
}

// Common refusal assertion: status + machine-readable code + safe message.
export async function expectRefusal(response, expectedStatus, expectedCodes) {
  assert.equal(response.status, expectedStatus, 'refusal HTTP status (body: ' + response.body.slice(0, 200) + ')');
  const parsed = JSON.parse(response.body);
  assert.equal(parsed.ok, false, 'refusal body must carry ok:false');
  assert.ok(expectedCodes.includes(parsed.code), 'refusal code ' + String(parsed.code) + ' in ' + JSON.stringify(expectedCodes));
  assert.equal(typeof parsed.message, 'string', 'refusal carries a safe human message');
  assert.doesNotMatch(parsed.message, /\n\s+at |stack trace/i, 'refusal message must not carry stack traces');
  return parsed;
}

// ---------------------------------------------------------------------------
// Server test seam (anticipated ui.mjs API, ratified planning report section
// "Proposed shared engine API" / contract v1.3 section 5.6): ui.mjs must
// export an explicit-start helper so that importing it never binds a port:
//
//   startServer({ settingsPath?, port?, fetchFn?, openBrowser? }) =>
//     { server, port, token, close(): Promise<void>, address() }
//
// "token" is a development seam for tests only; the contract forbids the
// server from logging it or putting it in URLs. fetchFn is the acquisition
// injection used to stub the five public source classes.
// ---------------------------------------------------------------------------

export async function startTestServer(t, { settingsPath, port, fetchFn = fetchNever, openBrowser = false }) {
  if (!hasUiServer) throw new Error('capability missing: ui.mjs does not exist yet');
  const ui = await loadUiServerModule();
  assert.equal(typeof ui.startServer, 'function', 'ui.mjs must export startServer(options)');
  if (settingsPath !== undefined) assertScratchTarget(settingsPath);
  const started = await ui.startServer({ settingsPath, port, fetchFn, openBrowser });
  assert.equal(typeof started.port, 'number', 'started.port present');
  assert.equal(typeof started.token, 'string', 'started.token present (test seam only)');
  assert.equal(typeof started.close, 'function', 'started.close present');
  t.after(async () => {
    try { await started.close(); } catch { /* teardown best effort */ }
  });
  return started;
}

export async function getJson(port, urlPath, headers = {}) {
  const res = await httpRequest({ port, method: 'GET', urlPath, headers });
  let json = null;
  try { json = JSON.parse(res.body); } catch { json = null; }
  return { ...res, json };
}

export async function postJson(port, urlPath, body, headers = {}) {
  const res = await httpRequest({
    port,
    method: 'POST',
    urlPath,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? '{}' : JSON.stringify(body),
  });
  let json = null;
  try { json = JSON.parse(res.body); } catch { json = null; }
  return { ...res, json };
}

export function authHeaders(token) {
  return { 'x-ocms-token': token };
}

function docsHtml(map) {
  const rows = Object.entries(map)
    .map(([id, endpoint]) => '<tr><td>' + id + '</td><td>' + endpoint + '</td></tr>')
    .join('');
  return '<table><tr><th>Model ID</th><th>Endpoint</th></tr>' + rows + '</table>';
}

// Render the validSources() fixture into five synthetic response bodies keyed
// by the real source URLs, suitable for fetchFromBodies().
export function validSourceBodies(sources = validSources()) {
  return {
    [sync.SOURCE_URLS.goRoster]: JSON.stringify({ data: sources.rosters.go.map((id) => ({ id })) }),
    [sync.SOURCE_URLS.zenRoster]: JSON.stringify({ data: sources.rosters.zen.map((id) => ({ id })) }),
    [sync.SOURCE_URLS.catalog]: JSON.stringify({
      'opencode-go': { npm: sources.catalog.go.npm, models: sources.catalog.go.models },
      opencode: { npm: sources.catalog.zen.npm, models: sources.catalog.zen.models },
    }),
    [sync.SOURCE_URLS.goDocs]: docsHtml(sources.docs.go),
    [sync.SOURCE_URLS.zenDocs]: docsHtml(sources.docs.zen),
  };
}

