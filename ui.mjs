// OCMS-S v1.3.0 Stage 3 — loopback UI server / API / retained-preview adapter.
// Owns only: CLI parsing, target selection via shared engine semantics,
// loopback lifecycle, template injection, per-process token, Host/Origin
// validation, routing, body parsing, single retained Preview slot,
// Preview/Apply concurrency guards, engine->API translation, safe errors,
// optional browser open, shutdown. No sync business logic lives here.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { buildPlan, commitPlan, fetchSources, defaultSettingsPath } from './sync.mjs';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const HTML_PATH = path.join(MODULE_DIR, 'ui', 'index.html');
const PACKAGE_PATH = path.join(MODULE_DIR, 'package.json');

const BIND_HOST = '127.0.0.1';
const DEFAULT_PORT = 18751;
const MAX_BODY_BYTES = 1024 * 1024;

const CSP =
  "default-src 'self'; " +
  "script-src 'self' 'unsafe-inline'; " +
  "style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data:; " +
  "font-src 'self'; " +
  "connect-src 'self'; " +
  "object-src 'none'; " +
  "base-uri 'none'; " +
  "frame-ancestors 'none'; " +
  "form-action 'self'";

function readPackageVersion() {
  const raw = fs.readFileSync(PACKAGE_PATH, 'utf8');
  const pkg = JSON.parse(raw);
  if (!pkg || typeof pkg.version !== 'string' || !pkg.version) throw new Error('PACKAGE_VERSION_MISSING');
  return pkg.version;
}

function loadTemplate() {
  const html = fs.readFileSync(HTML_PATH, 'utf8');
  if (!html.includes('__OCMS_TOKEN__') || !html.includes('__OCMS_VERSION__')) {
    throw new Error('HTML_TEMPLATE_PLACEHOLDER_MISSING');
  }
  return html;
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

function sortByGatewayId(items) {
  return [...items].sort((a, b) => {
    if (a.gateway !== b.gateway) return a.gateway < b.gateway ? -1 : 1;
    if (a.id !== b.id) return a.id < b.id ? -1 : 1;
    return 0;
  });
}

function splitKey(key) {
  const s = String(key);
  const i = s.indexOf('/');
  if (i < 0) return { gateway: s, id: '' };
  return { gateway: s.slice(0, i), id: s.slice(i + 1) };
}

function translateChanges(changes) {
  const src = changes || {};
  const added = Array.isArray(src.added) ? src.added.map((e) => {
    const { gateway, id } = splitKey(e.key);
    return { gateway, id, route: e.route };
  }) : [];
  const removed = Array.isArray(src.removed) ? src.removed.map((e) => {
    const { gateway, id } = splitKey(e.key);
    return { gateway, id, route: e.route };
  }) : [];
  const moved = Array.isArray(src.moved) ? src.moved.map((e) => {
    const { gateway, id } = splitKey(e.key);
    return { gateway, id, from: e.from, to: e.to, oldRoute: e.from, newRoute: e.to };
  }) : [];
  const metadataChanged = Array.isArray(src.metadataChanged) ? src.metadataChanged.map((e) => {
    const { gateway, id } = splitKey(e.key);
    return { gateway, id, route: e.route };
  }) : [];
  return { added, removed, moved, metadataChanged };
}

function tokenMatches(provided, expected) {
  try {
    if (typeof provided !== 'string') return false;
    const a = crypto.createHash('sha256').update(provided, 'utf8').digest();
    const b = crypto.createHash('sha256').update(expected, 'utf8').digest();
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function hostAllowed(req, boundPort) {
  try {
    const raw = req.rawHeaders || [];
    let count = 0;
    for (let i = 0; i < raw.length; i += 2) {
      if (String(raw[i]).toLowerCase() === 'host') count += 1;
    }
    if (count !== 1) return false;
    const value = req.headers.host;
    if (typeof value !== 'string') return false;
    const lower = value.toLowerCase();
    return lower === ('127.0.0.1:' + boundPort) || lower === ('localhost:' + boundPort);
  } catch {
    return false;
  }
}

function originAllowed(req, boundPort) {
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  if (typeof origin !== 'string') return false;
  return origin === ('http://127.0.0.1:' + boundPort) || origin === ('http://localhost:' + boundPort);
}

function applySecurityHeaders(res) {
  res.setHeader('content-security-policy', CSP);
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('referrer-policy', 'no-referrer');
  res.setHeader('cache-control', 'no-store');
}

function sendJson(res, status, obj) {
  applySecurityHeaders(res);
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(body);
}

function refusal(res, status, code, message) {
  sendJson(res, status, { ok: false, code, message });
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let failed = false;
    req.on('data', (c) => {
      if (failed) return;
      total += c.length;
      if (total > limit) {
        failed = true;
        reject(new Error('BODY_TOO_LARGE'));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (failed) return;
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', (err) => {
      if (!failed) {
        failed = true;
        reject(err);
      }
    });
  });
}

function listBackups(dir) {
  try {
    return fs.readdirSync(dir).filter((n) => n.startsWith('settings.yaml.bak-')).sort();
  } catch {
    return [];
  }
}

function defaultOpenBrowser(url) {
  try {
    if (process.platform === 'win32') {
      const child = spawn('cmd', ['/c', 'start', '""', url], { detached: true, stdio: 'ignore', shell: false });
      if (child && typeof child.unref === 'function') child.unref();
    } else if (process.platform === 'darwin') {
      const child = spawn('open', [url], { detached: true, stdio: 'ignore', shell: false });
      if (child && typeof child.unref === 'function') child.unref();
    } else {
      const child = spawn('xdg-open', [url], { detached: true, stdio: 'ignore', shell: false });
      if (child && typeof child.unref === 'function') child.unref();
    }
  } catch {
    // best effort only
  }
}

function knownSourceError(err) {
  const msg = err && typeof err.message === 'string' ? err.message : String(err);
  return /^(FETCH_FAILED|ROSTER_INVALID|CATALOG_INVALID|DOCS_INVALID|SOURCE_INVALID|SETTINGS_INVALID)/.test(msg) ? msg : null;
}

export async function startServer(options = {}) {
  const { settingsPath, port, fetchFn, openBrowser } = options;
  const resolvedTarget = path.resolve(settingsPath !== undefined ? String(settingsPath) : defaultSettingsPath());
  const resolvedDefault = path.resolve(defaultSettingsPath());
  const production = resolvedTarget.toLowerCase() === resolvedDefault.toLowerCase();
  const displayPath = resolvedTarget;

  let boundPort = port;
  if (boundPort === undefined) boundPort = DEFAULT_PORT;
  if (typeof boundPort !== 'number' || !Number.isInteger(boundPort) || boundPort < 1 || boundPort > 65535) {
    throw new Error('INVALID_PORT');
  }
  const fetchImpl = fetchFn !== undefined ? fetchFn : globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('FETCH_IMPL_MISSING');

  const template = loadTemplate();
  const version = readPackageVersion();
  const token = crypto.randomBytes(32).toString('hex');
  const page = template.split('__OCMS_TOKEN__').join(token).split('__OCMS_VERSION__').join(version);

  let activePreview = null;
  let previewBusy = false;
  let applyBusy = false;

  const targetInfo = () => ({ displayPath, production });

  function statePayload() {
    return {
      ok: true,
      target: targetInfo(),
      hasPreview: activePreview !== null,
      previewState: activePreview ? activePreview.state : null,
      generatedAt: activePreview ? activePreview.generatedAt : null,
    };
  }

  function previewResponsePayload(retained) {
    const plan = retained.plan;
    const changes = translateChanges(plan.changes);
    const preserved = sortByGatewayId(Array.isArray(plan.preservedUnresolved) ? plan.preservedUnresolved.map((e) => ({ ...e })) : []);
    const skipped = sortByGatewayId(Array.isArray(plan.skippedUnresolved) ? plan.skippedUnresolved.map((e) => ({ ...e })) : []);
    const fallback = sortByGatewayId(Array.isArray(plan.fallbackResolved) ? plan.fallbackResolved.map((e) => ({ ...e })) : []);
    let sources;
    if (retained.sourcesSummary) {
      sources = retained.sourcesSummary;
    } else {
      sources = { goRoster: { ok: false, count: 0 }, zenRoster: { ok: false, count: 0 }, catalog: { ok: false }, goDocs: { ok: false }, zenDocs: { ok: false } };
    }
    const body = {
      ok: true,
      state: retained.state,
      target: targetInfo(),
      sources,
      changes,
      preservedUnresolved: preserved,
      skippedUnresolved: skipped,
      fallbackResolved: fallback,
      previewId: retained.previewId,
      generatedAt: retained.generatedAt,
    };
    if (retained.state === 'BLOCKED') {
      body.blockedReasons = Array.isArray(plan.blockedReasons) ? plan.blockedReasons.map((e) => ({ reason: String(e.reason) })) : [];
    }
    return body;
  }

  async function handlePreview(req, res) {
    if (previewBusy || applyBusy) {
      refusal(res, 409, 'PREVIEW_BUSY', 'Preview build already in progress.');
      return;
    }
    previewBusy = true;
    try {
      let sources;
      try {
        sources = await fetchSources(fetchImpl);
      } catch (err) {
        const known = knownSourceError(err);
        if (known) {
          const previewId = crypto.randomBytes(32).toString('hex');
          const generatedAt = new Date().toISOString();
          const blockedPlan = {
            state: 'BLOCKED',
            desired: null,
            dispositions: [],
            changes: { added: [], removed: [], moved: [], metadataChanged: [] },
            preservedUnresolved: [],
            skippedUnresolved: [],
            fallbackResolved: [],
            settingsPath: resolvedTarget,
            settingsDigest: null,
            sourceSnapshotDigest: null,
            generatedAt,
            blockedReasons: [{ reason: known }],
          };
          const retained = {
            previewId,
            targetPath: resolvedTarget,
            production,
            settingsDigest: null,
            sourceSnapshotDigest: null,
            state: 'BLOCKED',
            generatedAt,
            plan: deepFreeze(structuredClone(blockedPlan)),
            sourcesSummary: { goRoster: { ok: false, count: 0 }, zenRoster: { ok: false, count: 0 }, catalog: { ok: false }, goDocs: { ok: false }, zenDocs: { ok: false } },
          };
          activePreview = retained;
          sendJson(res, 200, previewResponsePayload(retained));
          return;
        }
        refusal(res, 500, 'ERROR', 'Unexpected internal error.');
        return;
      }
      let plan;
      try {
        plan = buildPlan({ settingsPath: resolvedTarget, sources });
      } catch (err) {
        refusal(res, 500, 'ERROR', 'Unexpected internal error.');
        return;
      }
      const previewId = crypto.randomBytes(32).toString('hex');
      const generatedAt = (plan && typeof plan.generatedAt === 'string') ? plan.generatedAt : new Date().toISOString();
      const sourcesSummary = {
        goRoster: { ok: true, count: Array.isArray(sources.rosters.go) ? sources.rosters.go.length : 0 },
        zenRoster: { ok: true, count: Array.isArray(sources.rosters.zen) ? sources.rosters.zen.length : 0 },
        catalog: { ok: true },
        goDocs: { ok: true },
        zenDocs: { ok: true },
      };
      const retained = {
        previewId,
        targetPath: resolvedTarget,
        production,
        settingsDigest: plan.settingsDigest !== undefined ? plan.settingsDigest : null,
        sourceSnapshotDigest: plan.sourceSnapshotDigest !== undefined ? plan.sourceSnapshotDigest : null,
        state: plan.state,
        generatedAt,
        plan: deepFreeze(structuredClone(plan)),
        sourcesSummary,
      };
      activePreview = retained;
      sendJson(res, 200, previewResponsePayload(retained));
    } catch (err) {
      try { refusal(res, 500, 'ERROR', 'Unexpected internal error.'); } catch { try { res.end(); } catch {} }
    } finally {
      previewBusy = false;
    }
  }

  async function handleApply(req, res, parsed) {
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      refusal(res, 400, 'BAD_REQUEST', 'Malformed request.');
      return;
    }
    const keys = Object.keys(parsed);
    if (keys.length !== 1 || keys[0] !== 'previewId' || typeof parsed.previewId !== 'string') {
      refusal(res, 400, 'BAD_REQUEST', 'Malformed request.');
      return;
    }
    const previewId = parsed.previewId;
    if (applyBusy) {
      refusal(res, 409, 'APPLY_BUSY', 'Apply already in progress.');
      return;
    }
    if (previewBusy) {
      refusal(res, 409, 'PREVIEW_BUSY', 'Preview build already in progress.');
      return;
    }
    if (!activePreview || previewId !== activePreview.previewId) {
      refusal(res, 409, 'STALE_PREVIEW', 'Preview is stale. Run Refresh Preview to build a new one.');
      return;
    }
    if (activePreview.state !== 'READY') {
      refusal(res, 409, 'PREVIEW_NOT_READY', 'Preview is not ready for Apply.');
      return;
    }
    applyBusy = true;
    try {
      const dir = path.dirname(resolvedTarget);
      const before = new Set(listBackups(dir));
      let outcome;
      try {
        outcome = commitPlan(activePreview.plan);
      } catch (err) {
        refusal(res, 500, 'ERROR', 'Unexpected internal error.');
        return;
      }
      if (outcome && outcome.stale === true) {
        activePreview = null;
        refusal(res, 409, 'STALE_PREVIEW', 'Preview is stale. Run Refresh Preview to build a new one.');
        return;
      }
      if (!outcome || outcome.result !== 'UPDATED') {
        refusal(res, 500, 'ERROR', 'Unexpected internal error.');
        return;
      }
      activePreview = null;
      const after = listBackups(dir);
      const fresh = after.filter((n) => !before.has(n));
      let backupPath = null;
      if (fresh.length > 0) backupPath = path.join(dir, fresh[fresh.length - 1]);
      else if (after.length > 0) backupPath = path.join(dir, after[after.length - 1]);
      else backupPath = resolvedTarget + '.bak';
      sendJson(res, 200, { ok: true, status: 'UPDATED', backupPath, target: targetInfo() });
    } finally {
      applyBusy = false;
    }
  }

  const server = http.createServer((req, res) => {
    (async () => {
      let pathname = '/';
      try {
        const u = new URL(req.url || '/', 'http://127.0.0.1');
        pathname = u.pathname;
      } catch {
        refusal(res, 404, 'NOT_FOUND', 'Not found.');
        return;
      }
      const method = req.method || 'GET';
      const bound = server.address() && typeof server.address() === 'object' ? server.address().port : boundPort;
      if (!hostAllowed(req, bound)) {
        refusal(res, 403, 'BAD_HOST', 'Unexpected Host header.');
        return;
      }
      const isKnown = pathname === '/' || pathname === '/api/state' || pathname === '/api/preview' || pathname === '/api/apply';
      if (!isKnown) {
        refusal(res, 404, 'NOT_FOUND', 'Not found.');
        return;
      }
      if (pathname === '/' && method !== 'GET') {
        refusal(res, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed.');
        return;
      }
      if (pathname === '/api/state' && method !== 'GET') {
        refusal(res, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed.');
        return;
      }
      if ((pathname === '/api/preview' || pathname === '/api/apply') && method !== 'POST') {
        refusal(res, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed.');
        return;
      }
      if (pathname === '/') {
        applySecurityHeaders(res);
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(page);
        return;
      }
      if (pathname === '/api/state') {
        sendJson(res, 200, statePayload());
        return;
      }
      if (!originAllowed(req, bound)) {
        refusal(res, 403, 'BAD_ORIGIN', 'Unexpected Origin.');
        return;
      }
      if (!tokenMatches(req.headers['x-ocms-token'], token)) {
        refusal(res, 403, 'BAD_TOKEN', 'Missing or invalid authorization token.');
        return;
      }
      let raw = '';
      try {
        raw = await readBody(req, MAX_BODY_BYTES);
      } catch (err) {
        refusal(res, 400, 'BAD_REQUEST', 'Malformed request.');
        return;
      }
      let parsed;
      if (!raw || raw.length === 0) {
        parsed = {};
      } else {
        try {
          parsed = JSON.parse(raw);
        } catch {
          refusal(res, 400, 'BAD_REQUEST', 'Malformed request.');
          return;
        }
      }
      if (pathname === '/api/preview') {
        if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
          await handlePreview(req, res);
          return;
        }
        refusal(res, 400, 'BAD_REQUEST', 'Malformed request.');
        return;
      }
      if (pathname === '/api/apply') {
        await handleApply(req, res, parsed);
        return;
      }
      refusal(res, 404, 'NOT_FOUND', 'Not found.');
    })().catch(() => {
      try { refusal(res, 500, 'ERROR', 'Unexpected internal error.'); } catch { try { res.end(); } catch {} }
    });
  });

  const sockets = new Set();
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  await new Promise((resolve, reject) => {
    const onError = (err) => {
      server.removeListener('listening', onListen);
      reject(err);
    };
    const onListen = () => {
      server.removeListener('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListen);
    server.listen(boundPort, BIND_HOST);
  });

  const actual = server.address() && typeof server.address() === 'object' ? server.address().port : boundPort;
  const url = 'http://' + BIND_HOST + ':' + actual + '/';
  try {
    console.log('OCMS-S v' + version + ' listening on ' + url);
    console.log('target: ' + displayPath + ' (' + (production ? 'PRODUCTION' : 'SCRATCH') + ')');
  } catch {}
  if (openBrowser) {
    try {
      if (typeof openBrowser === 'function') await openBrowser(url);
      else defaultOpenBrowser(url);
    } catch {}
  }

  async function close() {
    for (const socket of [...sockets]) {
      try { socket.destroy(); } catch {}
    }
    await new Promise((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }

  function address() {
    return server.address();
  }

  return { server, port: actual, token, close, address };
}

function printUsage() {
  try {
    console.error('Usage: node ui.mjs [--settings=<path>] [--port=<port>] [--no-open]');
  } catch {}
}

function parseCliArgs(argv) {
  let settings;
  let settingsCount = 0;
  let port;
  let portCount = 0;
  let noOpen = false;
  for (const arg of argv.slice(2)) {
    if (arg === '--no-open') {
      noOpen = true;
      continue;
    }
    if (arg.startsWith('--port=')) {
      portCount += 1;
      if (portCount > 1) throw new Error('DUPLICATE_PORT');
      const raw = arg.slice('--port='.length);
      if (!/^\d+$/.test(raw)) throw new Error('INVALID_PORT');
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 1 || n > 65535) throw new Error('INVALID_PORT');
      port = n;
      continue;
    }
    if (arg === '--port' || arg.startsWith('--port')) throw new Error('INVALID_PORT');
    if (arg.startsWith('--settings=')) {
      settingsCount += 1;
      if (settingsCount > 1) throw new Error('DUPLICATE_SETTINGS');
      const raw = arg.slice('--settings='.length);
      if (!raw) throw new Error('INVALID_SETTINGS');
      settings = raw;
      continue;
    }
    if (arg === '--settings' || arg.startsWith('--settings')) throw new Error('INVALID_SETTINGS');
    throw new Error('UNKNOWN_FLAG: ' + arg);
  }
  return { settings, port, noOpen };
}

async function cliMain() {
  let parsed;
  try {
    parsed = parseCliArgs(process.argv);
  } catch (err) {
    printUsage();
    process.exitCode = 1;
    return;
  }
  const settingsPath = parsed.settings !== undefined ? parsed.settings : defaultSettingsPath();
  const listenPort = parsed.port !== undefined ? parsed.port : DEFAULT_PORT;
  try {
    await startServer({ settingsPath, port: listenPort, fetchFn: globalThis.fetch, openBrowser: parsed.noOpen ? false : true });
  } catch (err) {
    try { console.error(String((err && err.message) || err)); } catch {}
    process.exitCode = 1;
  }
}

const invokedAsMain =
  typeof process !== 'undefined' &&
  process.argv &&
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedAsMain) {
  cliMain();
}
