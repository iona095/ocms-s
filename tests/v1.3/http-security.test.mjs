// OCMS-S v1.3 contract tests — F (HTTP/security), I (lifecycle/arguments),
// and side-effect negatives for every refusal class. All tests depend on the
// ui.mjs server capability and are fully written now, conditionally skipping
// until it exists (contract v1.3 sections 7, 13, 14, 15). No live network;
// acquisition is injected and refuses unexpected requests.
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {
  REPO_ROOT,
  hasUiServer,
  nextTestPort,
  scratchDir,
  scratchSettingsFile,
  assertNoBackupOrTemp,
  validSources,
  currentWithExtras,
  fetchFromBodies,
  fetchNever,
  startTestServer,
  captureConsole,
  getJson,
  postJson,
  authHeaders,
  httpRequest,
  validSourceBodies,
  loadUiServerModule,
  nodeSpawn,
  spawnUntilStdout,
} from './helpers.mjs';

const SKIP = !hasUiServer;
const CSP_REQUIRED = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self'",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
];

// ---------------------------------------------------------------------------
// Binding.
// ---------------------------------------------------------------------------

test('F1: the server binds literal 127.0.0.1 and never 0.0.0.0 or ::', { skip: SKIP }, async (t) => {
  const file = scratchSettingsFile(t, currentWithExtras());
  const started = await startTestServer(t, { settingsPath: file, port: nextTestPort() });
  const address = started.address ? started.address() : started.server.address();
  assert.equal(address.address, '127.0.0.1', 'literal loopback bind');
  assert.notEqual(address.address, '0.0.0.0');
  const page = await httpRequest({ port: started.port, method: 'GET', urlPath: '/' });
  assert.equal(page.status, 200);
});

test('F2: port conflict fails clearly instead of binding elsewhere', { skip: SKIP }, async (t) => {
  const file = scratchSettingsFile(t, currentWithExtras());
  const port = nextTestPort();
  const first = await startTestServer(t, { settingsPath: file, port });
  const ui = await loadUiServerModule();
  let second = null;
  let bindFailed = false;
  try {
    second = await ui.startServer({ settingsPath: file, port, fetchFn: fetchNever });
  } catch {
    bindFailed = true;
  }
  try {
    assert.equal(bindFailed, true, 'second bind on the same port must fail, never silently fall back');
    const page = await httpRequest({ port, method: 'GET', urlPath: '/' });
    assert.equal(page.status, 200, 'the first server is unaffected');
  } finally {
    if (second && second.close) await second.close();
  }
});

// ---------------------------------------------------------------------------
// Host validation (every request).
// ---------------------------------------------------------------------------

test('F3: Host allowlist accepts only exact loopback forms on the bound port', { skip: SKIP }, async (t) => {
  const file = scratchSettingsFile(t, currentWithExtras());
  const port = nextTestPort();
  const started = await startTestServer(t, { settingsPath: file, port, fetchFn: fetchFromBodies(validSourceBodies()) });
  const cases = [
    { hostValue: '127.0.0.1:' + port, expected: 200 },
    { hostValue: 'localhost:' + port, expected: 200 },
    { hostValue: 'foreign.example:' + port, expected: 403, label: 'foreign host' },
    { hostValue: '127.0.0.1:' + (port + 1), expected: 403, label: 'wrong port (127)' },
    { hostValue: 'localhost:' + (port + 1), expected: 403, label: 'wrong port (localhost)' },
    { hostValue: 'localhost.:' + port, expected: 403, label: 'trailing dot' },
    { hostValue: '[::1]:' + port, expected: 403, label: 'IPv6 form' },
    { hostValue: '127.0.0.1:', expected: 403, label: 'empty port' },
    { setHost: false, expected: [403], label: 'missing Host (Node may pre-empt with 400)', relaxed: true },
  ];
  for (const c of cases) {
    const res = await httpRequest({
      port,
      method: 'GET',
      urlPath: '/api/state',
      setHost: c.setHost !== false,
      hostValue: c.hostValue,
    });
    const accepted = Array.isArray(c.expected) ? c.expected : [c.expected];
    assert.ok(accepted.includes(res.status) || (c.relaxed && res.status === 400), 'Host case ' + (c.label || c.hostValue) + ' -> ' + res.status);
    if (res.status === 403) {
      const parsed = JSON.parse(res.body);
      assert.equal(parsed.code, 'BAD_HOST');
    }
  }
});

test('F3b: Host refusals fetch nothing and write nothing', { skip: SKIP }, async (t) => {
  const file = scratchSettingsFile(t, currentWithExtras());
  const beforeBytes = fs.readFileSync(file);
  const seen = [];
  const port = nextTestPort();
  const started = await startTestServer(t, { settingsPath: file, port, fetchFn: fetchFromBodies(validSourceBodies(), seen) });
  await httpRequest({ port, method: 'POST', urlPath: '/api/preview', hostValue: 'foreign.example:' + port, headers: authHeaders(started.token), body: {} });
  await httpRequest({ port, method: 'POST', urlPath: '/api/apply', hostValue: 'foreign.example:' + port, headers: authHeaders(started.token), body: { previewId: 'x' } });
  assert.deepEqual(seen, [], 'BAD_HOST refusals never fetch sources');
  assertNoBackupOrTemp(path.dirname(file), beforeBytes);
});

// ---------------------------------------------------------------------------
// Origin validation (state-changing requests; contract 15.3 verbatim).
// ---------------------------------------------------------------------------

test('F4: Origin rules follow contract 15.3 (loopback accepted, foreign refused, absent accepted with valid token)',
  { skip: SKIP },
  async (t) => {
    const file = scratchSettingsFile(t, currentWithExtras());
    const port = nextTestPort();
    const started = await startTestServer(t, { settingsPath: file, port, fetchFn: fetchFromBodies(validSourceBodies()) });
    const token = authHeaders(started.token);
    const valid = await postJson(port, '/api/preview', {}, { ...token, Origin: 'http://127.0.0.1:' + port });
    assert.equal(valid.status, 200, 'valid 127.0.0.1 Origin accepted');
    const validLocal = await postJson(port, '/api/preview', {}, { ...token, Origin: 'http://localhost:' + port });
    assert.equal(validLocal.status, 200, 'valid localhost Origin accepted');
    const foreign = await postJson(port, '/api/preview', {}, { ...token, Origin: 'http://evil.example' });
    assert.equal(foreign.status, 403);
    assert.equal(foreign.json.code, 'BAD_ORIGIN', 'foreign Origin refused');
    const wrongPort = await postJson(port, '/api/preview', {}, { ...token, Origin: 'http://127.0.0.1:' + (port + 1) });
    assert.equal(wrongPort.status, 403);
    assert.equal(wrongPort.json.code, 'BAD_ORIGIN', 'wrong-port Origin refused');
    const absent = await postJson(port, '/api/preview', {}, token);
    assert.equal(absent.status, 200, 'Origin absent with valid token is accepted (contract 15.3); token always required');
  });

// ---------------------------------------------------------------------------
// Token.
// ---------------------------------------------------------------------------

test('F5: token exists, is at least 256 bits, and authorizes POSTs', { skip: SKIP }, async (t) => {
  const file = scratchSettingsFile(t, currentWithExtras());
  const port = nextTestPort();
  const started = await startTestServer(t, { settingsPath: file, port, fetchFn: fetchFromBodies(validSourceBodies()) });
  assert.match(started.token, /^[0-9a-f]{64,}$/, 'token is hex of at least 256 bits');
  const ok = await postJson(port, '/api/preview', {}, authHeaders(started.token));
  assert.equal(ok.status, 200, 'correct token accepted');
});

test('F6: missing and incorrect tokens are refused with BAD_TOKEN and no side effects', { skip: SKIP }, async (t) => {
  const file = scratchSettingsFile(t, currentWithExtras());
  const beforeBytes = fs.readFileSync(file);
  const seen = [];
  const port = nextTestPort();
  const started = await startTestServer(t, { settingsPath: file, port, fetchFn: fetchFromBodies(validSourceBodies(), seen) });
  const missing = await postJson(port, '/api/preview', {}, {});
  assert.equal(missing.status, 403);
  assert.equal(missing.json.code, 'BAD_TOKEN');
  const wrong = await postJson(port, '/api/preview', {}, authHeaders('f'.repeat(64)));
  assert.equal(wrong.status, 403);
  assert.equal(wrong.json.code, 'BAD_TOKEN');
  const wrongApply = await postJson(port, '/api/apply', { previewId: 'x' }, authHeaders('f'.repeat(64)));
  assert.equal(wrongApply.status, 403);
  assert.equal(wrongApply.json.code, 'BAD_TOKEN');
  assert.deepEqual(seen, [], 'token refusals never fetch sources');
  assertNoBackupOrTemp(path.dirname(file), beforeBytes);
});

test('F7: malformed attacker-controlled tokens are refused without throwing', { skip: SKIP }, async (t) => {
  const file = scratchSettingsFile(t, currentWithExtras());
  const port = nextTestPort();
  const started = await startTestServer(t, { settingsPath: file, port, fetchFn: fetchFromBodies(validSourceBodies()) });
  for (const bad of ['', 'a', 'x'.repeat(10240), 'a b c', ' Zed ', '\u00e9'.repeat(1)]) {
    const res = await postJson(port, '/api/preview', {}, { 'x-ocms-token': bad });
    assert.equal(res.status, 403, 'malformed token refused: ' + JSON.stringify(bad.slice(0, 12)));
    assert.equal(res.json.code, 'BAD_TOKEN');
  }
  const stillUp = await getJson(port, '/api/state');
  assert.equal(stillUp.status, 200, 'server survives malformed tokens');
});

test('F8: token is only ever delivered inside the served page (never headers, cookies, logs, disk, or API bodies)',
  { skip: SKIP },
  async (t) => {
    const file = scratchSettingsFile(t, currentWithExtras());
    const dir = path.dirname(file);
    const lines = captureConsole(t);
    const port = nextTestPort();
    const started = await startTestServer(t, { settingsPath: file, port, fetchFn: fetchFromBodies(validSourceBodies()) });
    const page = await httpRequest({ port, method: 'GET', urlPath: '/' });
    assert.ok(page.body.includes(started.token), 'page bootstraps the token');
    for (const headerKey of Object.keys(page.headers)) {
      assert.equal(headerKey.toLowerCase() !== 'set-cookie' || String(page.headers[headerKey]).includes(started.token) === false, true, 'token never via cookie');
      assert.equal(String(page.headers[headerKey]).includes(started.token), false, 'token never in response headers: ' + headerKey);
    }
    const state = await getJson(port, '/api/state');
    assert.equal(state.body.includes(started.token), false, 'token never in API responses');
    await postJson(port, '/api/preview', {}, authHeaders(started.token));
    assert.equal(lines.join('\n').includes(started.token), false, 'token never logged');
    assert.equal(page.headers.location, undefined, 'no redirect carrying the token');
    for (const name of fs.readdirSync(dir)) {
      assert.equal(fs.readFileSync(path.join(dir, name), 'utf8').includes(started.token), false, 'token never written to disk: ' + name);
    }
  });

// ---------------------------------------------------------------------------
// Routing / traversal / methods.
// ---------------------------------------------------------------------------

test('F9: unknown routes are 404 and traversal-shaped paths cannot read disk', { skip: SKIP }, async (t) => {
  const file = scratchSettingsFile(t, currentWithExtras());
  const port = nextTestPort();
  const started = await startTestServer(t, { settingsPath: file, port, fetchFn: fetchFromBodies(validSourceBodies()) });
  for (const urlPath of ['/definitely-not-here', '/api', '/api/nope', '/..%2F..%2Fsync.mjs', '/../../package.json', '/ui/', '/index.html', '/ui/index.html']) {
    const res = await httpRequest({ port, method: 'GET', urlPath });
    assert.equal(res.status, 404, 'unexpected route ' + urlPath + ' -> ' + res.status);
    assert.equal(res.body.includes('SOURCE_URLS'), false, 'no source-file leak for ' + urlPath);
    assert.equal(res.body.includes('node-html-parser'), false, 'no package.json leak for ' + urlPath);
  }
});

test('F10: unsupported methods are 405 (GET Apply, PUT/DELETE on known routes)', { skip: SKIP }, async (t) => {
  const file = scratchSettingsFile(t, currentWithExtras());
  const port = nextTestPort();
  const started = await startTestServer(t, { settingsPath: file, port, fetchFn: fetchFromBodies(validSourceBodies()) });
  for (const c of [
    { method: 'GET', urlPath: '/api/preview' },
    { method: 'GET', urlPath: '/api/apply' },
    { method: 'PUT', urlPath: '/api/preview' },
    { method: 'DELETE', urlPath: '/api/state' },
    { method: 'PUT', urlPath: '/' },
  ]) {
    const res = await httpRequest({ port, method: c.method, urlPath: c.urlPath, headers: authHeaders(started.token) });
    assert.equal(res.status, 405, c.method + ' ' + c.urlPath + ' -> ' + res.status);
  }
});

// ---------------------------------------------------------------------------
// Security headers.
// ---------------------------------------------------------------------------

test('F11: every response carries the contract CSP, no-store, nosniff, no-referrer, and never a CORS wildcard',
  { skip: SKIP },
  async (t) => {
    const file = scratchSettingsFile(t, currentWithExtras());
    const port = nextTestPort();
    const started = await startTestServer(t, { settingsPath: file, port, fetchFn: fetchFromBodies(validSourceBodies()) });
    const responses = [
      await httpRequest({ port, method: 'GET', urlPath: '/' }),
      await httpRequest({ port, method: 'GET', urlPath: '/api/state' }),
      await postJson(port, '/api/preview', {}, authHeaders(started.token)),
      await postJson(port, '/api/preview', {}, authHeaders('f'.repeat(64))),
      await httpRequest({ port, method: 'GET', urlPath: '/nope' }),
    ];
    for (const res of responses) {
      const csp = res.headers['content-security-policy'] || '';
      for (const directive of CSP_REQUIRED) {
        assert.ok(csp.includes(directive), 'CSP includes ' + directive + ' (got: ' + csp + ')');
      }
      assert.equal(res.headers['x-content-type-options'], 'nosniff');
      assert.equal(res.headers['referrer-policy'], 'no-referrer');
      assert.equal(res.headers['cache-control'], 'no-store');
      assert.equal(res.headers['access-control-allow-origin'], undefined, 'no CORS header, certainly no wildcard');
    }
  });

// ---------------------------------------------------------------------------
// GET /api/state shape (no plan details, no digests, no token).
// ---------------------------------------------------------------------------

test('F12: /api/state exposes only target/process info and never plan data or preview authorization',
  { skip: SKIP },
  async (t) => {
    const file = scratchSettingsFile(t, currentWithExtras());
    const port = nextTestPort();
    const started = await startTestServer(t, { settingsPath: file, port, fetchFn: fetchFromBodies(validSourceBodies()) });
    const state = await getJson(port, '/api/state');
    assert.equal(state.status, 200);
    assert.equal(state.json.ok, true);
    assert.equal(state.json.target.production, false);
    assert.equal(state.json.hasPreview, false);
    assert.equal(state.json.previewState, null);
    assert.equal(state.json.generatedAt, null);
    assert.equal(state.body.includes('previewId'), false, 'no reusable preview authorization exposed');
    await postJson(port, '/api/preview', {}, authHeaders(started.token));
    const after = await getJson(port, '/api/state');
    assert.equal(after.json.hasPreview, true);
    assert.equal(after.json.previewState, 'READY');
    assert.equal(after.body.includes('previewId'), false, 'previewId never exposed through state');
    assert.equal(after.body.includes('"added"'), false, 'no plan details exposed');
  });

// ---------------------------------------------------------------------------
// Malformed requests (L negatives).
// ---------------------------------------------------------------------------

test('F13: malformed request bodies are 400 and perform nothing', { skip: SKIP }, async (t) => {
  const file = scratchSettingsFile(t, currentWithExtras());
  const beforeBytes = fs.readFileSync(file);
  const seen = [];
  const port = nextTestPort();
  const started = await startTestServer(t, { settingsPath: file, port, fetchFn: fetchFromBodies(validSourceBodies(), seen) });
  const baseline = seen.length;
  const malformed = await httpRequest({
    port,
    method: 'POST',
    urlPath: '/api/preview',
    headers: { ...authHeaders(started.token), 'content-type': 'application/json' },
    body: '{not-json',
  });
  assert.equal(malformed.status, 400, 'malformed JSON refused');
  const malformedApply = await httpRequest({
    port,
    method: 'POST',
    urlPath: '/api/apply',
    headers: { ...authHeaders(started.token), 'content-type': 'application/json' },
    body: '{oops',
  });
  assert.equal(malformedApply.status, 400, 'malformed Apply body refused');
  assert.equal(seen.length, baseline, 'malformed requests never fetch');
  assertNoBackupOrTemp(path.dirname(file), beforeBytes);
});

// ---------------------------------------------------------------------------
// I — lifecycle / arguments.
// ---------------------------------------------------------------------------

test('I1: importing ui.mjs binds no port and starts no server', { skip: SKIP }, async () => {
  await loadUiServerModule();
  const probe = await httpRequest({ port: 18751, method: 'GET', urlPath: '/api/state' }).then(
    () => 'listened',
    () => 'refused',
  );
  assert.equal(probe, 'refused', 'importing ui.mjs must not start a server on the default port');
});

test('I2: CLI rejects invalid ports with nonzero exit and never binds', { skip: SKIP }, async (t) => {
  const file = scratchSettingsFile(t, currentWithExtras());
  for (const portArg of ['--port=0', '--port=-1', '--port=70000', '--port=abc', '--port=']) {
    const run = await nodeSpawn([path.join(REPO_ROOT, 'ui.mjs'), portArg, '--settings=' + file, '--no-open']);
    assert.notEqual(run.code, 0, portArg + ' must fail with nonzero exit');
  }
});

test('I3: unknown CLI flags cause a usage error, never silent startup', { skip: SKIP }, async (t) => {
  const file = scratchSettingsFile(t, currentWithExtras());
  const run = await nodeSpawn([path.join(REPO_ROOT, 'ui.mjs'), '--definitely-not-a-flag', '--settings=' + file, '--no-open']);
  assert.notEqual(run.code, 0, 'unknown flag must cause nonzero exit');
});

test('I4: --no-open suppresses browser opening and the server stays fully functional', { skip: SKIP }, async (t) => {
  const file = scratchSettingsFile(t, currentWithExtras());
  const port = nextTestPort();
  const spawned = await spawnUntilStdout([path.join(REPO_ROOT, 'ui.mjs'), '--port=' + port, '--settings=' + file, '--no-open'], '127.0.0.1:');
  assert.equal(spawned.matched, true, 'server prints the loopback URL');
  try {
    const page = await httpRequest({ port, method: 'GET', urlPath: '/' });
    assert.equal(page.status, 200, 'server fully functional with --no-open');
  } finally {
    spawned.child.kill();
  }
});

test('I5: browser-open failure is best effort and does not kill the server', { skip: SKIP }, async (t) => {
  const file = scratchSettingsFile(t, currentWithExtras());
  const port = nextTestPort();
  const started = await startTestServer(t, {
    settingsPath: file,
    port,
    openBrowser: async () => { throw new Error('SIMULATED_OPEN_FAILURE'); },
  });
  const page = await httpRequest({ port, method: 'GET', urlPath: '/' });
  assert.equal(page.status, 200, 'open failure leaves the server functional');
  await started.close();
});

test('I6: target and index.html resolution work from a non-repository CWD', { skip: SKIP }, async (t) => {
  const file = scratchSettingsFile(t, currentWithExtras());
  const port = nextTestPort();
  const otherCwd = scratchDir(t);
  const spawned = await spawnUntilStdout(
    [path.join(REPO_ROOT, 'ui.mjs'), '--port=' + port, '--settings=' + file, '--no-open'],
    '127.0.0.1:',
    { cwd: otherCwd },
  );
  assert.equal(spawned.matched, true, 'server starts from a foreign CWD');
  try {
    const page = await httpRequest({ port, method: 'GET', urlPath: '/' });
    assert.equal(page.status, 200, 'index.html resolved from module path, not CWD');
    const state = await getJson(port, '/api/state');
    assert.equal(state.json.ok, true);
  } finally {
    spawned.child.kill();
  }
});

test('I7: default port is 18751 when --port is absent', { skip: SKIP }, async (t) => {
  const file = scratchSettingsFile(t, currentWithExtras());
  const spawned = await spawnUntilStdout([path.join(REPO_ROOT, 'ui.mjs'), '--settings=' + file, '--no-open'], '127.0.0.1:18751');
  assert.equal(spawned.matched, true, 'default port printed in the URL');
  try {
    const page = await httpRequest({ port: 18751, method: 'GET', urlPath: '/api/state' });
    assert.equal(page.status, 200);
  } finally {
    spawned.child.kill();
  }
});

test('I8: duplicate --port never silently binds the default; behavior is deterministic and visible', { skip: SKIP }, async (t) => {
  const file = scratchSettingsFile(t, currentWithExtras());
  const portA = nextTestPort();
  const portB = portA + 1;
  const spawned = await spawnUntilStdout(
    [path.join(REPO_ROOT, 'ui.mjs'), '--port=' + portA, '--port=' + portB, '--settings=' + file, '--no-open'],
    '127.0.0.1:',
  );
  try {
    if (spawned.matched) {
      // Accepted form: exactly one explicit port, never the silent default.
      assert.equal(spawned.stdout.includes('127.0.0.1:18751'), false, 'duplicate --port must not silently fall back to the default');
      assert.ok(
        spawned.stdout.includes(':' + portA) || spawned.stdout.includes(':' + portB),
        'one of the two explicit ports is bound',
      );
    } else {
      assert.notEqual(spawned.code, 0, 'otherwise a usage error exits nonzero');
    }
  } finally {
    if (!spawned.child.killed && spawned.matched) spawned.child.kill();
  }
});
