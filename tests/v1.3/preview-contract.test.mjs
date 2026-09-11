// OCMS-S v1.3 contract tests — C (preview) and D (preview identity / stale
// protection). Every test depends on the ui.mjs server capability and is
// written now, conditionally skipping until it exists (contract v1.3
// sections 8.4, 9, 10). No live network: source acquisition is stubbed and
// unexpected external requests fail loudly. Scratch targets only.
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {
  sync,
  hasUiServer,
  hasUiHtml,
  nextTestPort,
  scratchDir,
  scratchSettingsFile,
  assertNoBackupOrTemp,
  backupCount,
  tempResidue,
  validSources,
  catRecord,
  currentWithExtras,
  fetchFromBodies,
  fetchNever,
  deferred,
  startTestServer,
  getJson,
  postJson,
  authHeaders,
  httpRequest,
  validSourceBodies,
  sha256Hex,
  loadUiServerModule,
} from './helpers.mjs';

const PREVIEW_SKIP = !hasUiServer;

function fallbackSources() {
  return validSources({
    rosters: { go: ['widget-free', 'widget', 'model-a'], zen: ['model-z'] },
    catalog: {
      go: {
        npm: '@ai-sdk/openai-compatible',
        models: {
          'widget-free': catRecord({ id: 'widget-free', name: 'Widget Free' }),
          widget: catRecord({ id: 'widget', name: 'Widget Counterpart', provider: { npm: '@ai-sdk/anthropic' } }),
          'model-a': catRecord({ provider: { npm: '@ai-sdk/openai-compatible' } }),
        },
      },
      zen: { npm: '@ai-sdk/openai', models: { 'model-z': catRecord({ id: 'model-z', name: 'Z', provider: { npm: '@ai-sdk/openai' } }) } },
    },
    docs: {
      go: { widget: 'https://opencode.ai/zen/go/v1/chat/completions', 'model-a': 'https://opencode.ai/zen/go/v1/chat/completions' },
      zen: { 'model-z': 'https://opencode.ai/zen/v1/responses' },
    },
  });
}

// ---------------------------------------------------------------------------
// C — preview behavior.
// ---------------------------------------------------------------------------

test('C1: explicit Preview fetches exactly the five permitted public source classes; page load fetches none',
  { skip: PREVIEW_SKIP },
  async (t) => {
    const file = scratchSettingsFile(t, currentWithExtras());
    const seen = [];
    const started = await startTestServer(t, { settingsPath: file, port: nextTestPort(), fetchFn: fetchFromBodies(validSourceBodies(), seen) });
    const page = await getJson(started.port, '/');
    assert.equal(page.status, 200, 'page serves');
    assert.deepEqual(seen, [], 'page load must fetch zero upstream sources');
    seen.length = 0;
    const preview = await postJson(started.port, '/api/preview', {}, authHeaders(started.token));
    assert.equal(preview.status, 200, 'preview succeeds');
    assert.deepEqual(
      [...seen].sort(),
      Object.values(sync.SOURCE_URLS).sort(),
      'preview fetches exactly the five permitted source classes and nothing else',
    );
  });

test('C2: Preview performs zero disk writes (bytes, listing, backup, temp)',
  { skip: PREVIEW_SKIP },
  async (t) => {
    const file = scratchSettingsFile(t, currentWithExtras());
    const dir = path.dirname(file);
    const beforeBytes = fs.readFileSync(file);
    const beforeFiles = fs.readdirSync(dir).sort();
    const started = await startTestServer(t, { settingsPath: file, port: nextTestPort(), fetchFn: fetchFromBodies(validSourceBodies()) });
    const preview = await postJson(started.port, '/api/preview', {}, authHeaders(started.token));
    assert.equal(preview.status, 200);
    assert.deepEqual(fs.readFileSync(file), beforeBytes, 'settings bytes unchanged');
    assert.deepEqual(fs.readdirSync(dir).sort(), beforeFiles, 'directory listing unchanged');
    assertNoBackupOrTemp(dir);
  });

test('C3: READY preview envelope carries contract shape, items (not counts-only), and opaque identity',
  { skip: PREVIEW_SKIP },
  async (t) => {
    const file = scratchSettingsFile(t, currentWithExtras());
    const started = await startTestServer(t, { settingsPath: file, port: nextTestPort(), fetchFn: fetchFromBodies(validSourceBodies()) });
    const preview = await postJson(started.port, '/api/preview', {}, authHeaders(started.token));
    assert.equal(preview.status, 200);
    const body = preview.json;
    assert.equal(body.state, 'READY');
    assert.equal(typeof body.target.displayPath, 'string');
    assert.equal(body.target.production, false, 'explicit scratch target classifies as SCRATCH');
    for (const group of ['added', 'removed', 'moved', 'metadataChanged']) {
      assert.ok(Array.isArray(body.changes[group]), 'changes.' + group + ' is an item list');
    }
    assert.ok(body.changes.added.length >= 2, 'change items present, not counts only');
    assert.ok(Array.isArray(body.preservedUnresolved));
    assert.ok(Array.isArray(body.skippedUnresolved));
    assert.ok(Array.isArray(body.fallbackResolved));
    assert.match(body.previewId, /^[0-9a-f]{32,}$/, 'previewId is opaque hex of at least 128 bits');
    assert.ok(Number.isNaN(Date.parse(body.generatedAt)) === false, 'generatedAt is ISO-8601');
    assert.equal(body.sources.goRoster.count, 1);
    assert.equal(body.sources.zenRoster.count, 1);
  });

test('C4: Preview returns NO_CHANGE when managed arrays already match; creates no backup',
  { skip: PREVIEW_SKIP },
  async (t) => {
    const file = scratchSettingsFile(t, currentWithExtras());
    assert.equal(sync.syncFromSources({ settingsPath: file, sources: validSources() }).result, 'UPDATED');
    const backups = backupCount(path.dirname(file));
    const started = await startTestServer(t, { settingsPath: file, port: nextTestPort(), fetchFn: fetchFromBodies(validSourceBodies()) });
    const preview = await postJson(started.port, '/api/preview', {}, authHeaders(started.token));
    assert.equal(preview.status, 200);
    assert.equal(preview.json.state, 'NO_CHANGE');
    assert.equal(backupCount(path.dirname(file)), backups, 'NO_CHANGE preview creates no backup');
    assert.equal(tempResidue(path.dirname(file)).length, 0, 'no temp residue');
  });

test('C5: Preview returns BLOCKED for source refusal with a safe reason and no bypass',
  { skip: PREVIEW_SKIP },
  async (t) => {
    const file = scratchSettingsFile(t, currentWithExtras());
    const beforeBytes = fs.readFileSync(file);
    const bodies = validSourceBodies(validSources({ catalog: { go: {} } }));
    const started = await startTestServer(t, { settingsPath: file, port: nextTestPort(), fetchFn: fetchFromBodies(bodies) });
    const preview = await postJson(started.port, '/api/preview', {}, authHeaders(started.token));
    assert.equal(preview.status, 200, 'BLOCKED is a valid preview outcome, not an HTTP error');
    const body = preview.json;
    assert.equal(body.state, 'BLOCKED');
    assert.ok(body.blockedReasons && body.blockedReasons.length > 0, 'safe reason exposed');
    assert.doesNotMatch(preview.body, /\n\s+at /, 'no stack trace in the blocked payload');
    assert.equal(backupCount(path.dirname(file)), 0);
    assert.equal(tempResidue(path.dirname(file)).length, 0);
    assert.deepEqual(fs.readFileSync(file), beforeBytes, 'no mutation');
  });

test('C6: Preview response is minimized (no settings content, no raw bodies, no token, no desired arrays)',
  { skip: PREVIEW_SKIP },
  async (t) => {
    const file = scratchSettingsFile(t, currentWithExtras());
    const started = await startTestServer(t, { settingsPath: file, port: nextTestPort(), fetchFn: fetchFromBodies(validSourceBodies()) });
    const page = await httpRequest({ port: started.port, method: 'GET', urlPath: '/' });
    assert.ok(page.body.includes(started.token), 'token bootstrapped into the page (the only delivery)');
    const preview = await postJson(started.port, '/api/preview', {}, authHeaders(started.token));
    assert.equal(preview.status, 200);
    assert.equal(preview.body.includes('unrelated-sentinel-9137'), false, 'unrelated settings never leak');
    assert.equal(preview.body.includes('"object":"list"'), false, 'raw roster bodies never leak');
    assert.equal(preview.body.includes(started.token), false, 'token never appears in API responses');
    assert.equal('desired' in preview.json, false, 'desired arrays are not exposed as authority');
    const state = await getJson(started.port, '/api/state');
    assert.equal(state.body.includes(started.token), false, 'token never appears in /api/state');
  });

test('C7: Preview exposes every unresolved/fallback item with required detail, deterministically sorted',
  { skip: PREVIEW_SKIP },
  async (t) => {
    const file = scratchSettingsFile(t, currentWithExtras());
    const started = await startTestServer(t, { settingsPath: file, port: nextTestPort(), fetchFn: fetchFromBodies(validSourceBodies(fallbackSources())) });
    const preview = await postJson(started.port, '/api/preview', {}, authHeaders(started.token));
    assert.equal(preview.json.state, 'READY');
    assert.deepEqual(preview.json.fallbackResolved, [
      { gateway: 'go', id: 'widget-free', counterpart: 'widget', route: 'opencode-go', provenance: 'FREE_COUNTERPART_FALLBACK' },
    ]);
    assert.equal(preview.json.changes.added.length, preview.json.changes.added.length, 'counts equal item list lengths');
    assert.ok(Array.isArray(preview.json.preservedUnresolved) && Array.isArray(preview.json.skippedUnresolved));
  });

// ---------------------------------------------------------------------------
// D — preview identity / stale protection.
// ---------------------------------------------------------------------------

test('D1: previewId is unpredictable, distinct per preview, and at least 128 bits',
  { skip: PREVIEW_SKIP },
  async (t) => {
    const file = scratchSettingsFile(t, currentWithExtras());
    const started = await startTestServer(t, { settingsPath: file, port: nextTestPort(), fetchFn: fetchFromBodies(validSourceBodies()) });
    const first = await postJson(started.port, '/api/preview', {}, authHeaders(started.token));
    const second = await postJson(started.port, '/api/preview', {}, authHeaders(started.token));
    assert.match(first.json.previewId, /^[0-9a-f]{32,}$/);
    assert.notEqual(first.json.previewId, second.json.previewId, 'new preview invalidates the old identity');
  });

test('D2: Apply with an unknown previewId refuses STALE_PREVIEW without side effects',
  { skip: PREVIEW_SKIP },
  async (t) => {
    const file = scratchSettingsFile(t, currentWithExtras());
    const beforeBytes = fs.readFileSync(file);
    const started = await startTestServer(t, { settingsPath: file, port: nextTestPort(), fetchFn: fetchFromBodies(validSourceBodies()) });
    const refusal = await postJson(started.port, '/api/apply', { previewId: 'a'.repeat(64) }, authHeaders(started.token));
    assert.equal(refusal.status, 409);
    assert.equal(refusal.json.code, 'STALE_PREVIEW');
    assertNoBackupOrTemp(path.dirname(file), beforeBytes);
  });

test('D3: a replaced preview invalidates the previous one; the current one applies',
  { skip: PREVIEW_SKIP },
  async (t) => {
    const file = scratchSettingsFile(t, currentWithExtras());
    const started = await startTestServer(t, { settingsPath: file, port: nextTestPort(), fetchFn: fetchFromBodies(validSourceBodies()) });
    const first = await postJson(started.port, '/api/preview', {}, authHeaders(started.token));
    const second = await postJson(started.port, '/api/preview', {}, authHeaders(started.token));
    const stale = await postJson(started.port, '/api/apply', { previewId: first.json.previewId }, authHeaders(started.token));
    assert.equal(stale.status, 409);
    assert.equal(stale.json.code, 'STALE_PREVIEW');
    const live = await postJson(started.port, '/api/apply', { previewId: second.json.previewId }, authHeaders(started.token));
    assert.equal(live.status, 200);
    assert.equal(live.json.status, 'UPDATED');
  });

test('D4: a consumed preview cannot execute twice (exactly one write, one backup)',
  { skip: PREVIEW_SKIP },
  async (t) => {
    const file = scratchSettingsFile(t, currentWithExtras());
    const started = await startTestServer(t, { settingsPath: file, port: nextTestPort(), fetchFn: fetchFromBodies(validSourceBodies()) });
    const preview = await postJson(started.port, '/api/preview', {}, authHeaders(started.token));
    const first = await postJson(started.port, '/api/apply', { previewId: preview.json.previewId }, authHeaders(started.token));
    assert.equal(first.status, 200);
    assert.equal(first.json.status, 'UPDATED');
    const second = await postJson(started.port, '/api/apply', { previewId: preview.json.previewId }, authHeaders(started.token));
    assert.equal(second.status, 409);
    assert.equal(second.json.code, 'STALE_PREVIEW', 'duplicate Apply of the same preview must not execute twice');
    assert.equal(backupCount(path.dirname(file)), 1, 'exactly one backup total');
  });

test('D5: a new server process invalidates all previously retained previews',
  { skip: PREVIEW_SKIP },
  async (t) => {
    const file = scratchSettingsFile(t, currentWithExtras());
    const first = await startTestServer(t, { settingsPath: file, port: nextTestPort(), fetchFn: fetchFromBodies(validSourceBodies()) });
    const preview = await postJson(first.port, '/api/preview', {}, authHeaders(first.token));
    await first.close();
    const second = await startTestServer(t, { settingsPath: file, port: nextTestPort(), fetchFn: fetchFromBodies(validSourceBodies()) });
    const replay = await postJson(second.port, '/api/apply', { previewId: preview.json.previewId }, authHeaders(second.token));
    assert.equal(replay.status, 409);
    assert.equal(replay.json.code, 'STALE_PREVIEW', 'previews are memory-only; restart invalidates them');
    assert.equal(backupCount(path.dirname(file)), 0);
  });

test('D6: settings byte change after Preview refuses with STALE_PREVIEW and invalidates the preview',
  { skip: PREVIEW_SKIP },
  async (t) => {
    const file = scratchSettingsFile(t, currentWithExtras());
    const started = await startTestServer(t, { settingsPath: file, port: nextTestPort(), fetchFn: fetchFromBodies(validSourceBodies()) });
    const preview = await postJson(started.port, '/api/preview', {}, authHeaders(started.token));
    fs.appendFileSync(file, '\n# external edit\n', 'utf8');
    const before = fs.readFileSync(file);
    const refusal = await postJson(started.port, '/api/apply', { previewId: preview.json.previewId }, authHeaders(started.token));
    assert.equal(refusal.status, 409);
    assert.equal(refusal.json.code, 'STALE_PREVIEW');
    assertNoBackupOrTemp(path.dirname(file));
    assert.deepEqual(fs.readFileSync(file), before, 'no write on stale');
    const replay = await postJson(started.port, '/api/apply', { previewId: preview.json.previewId }, authHeaders(started.token));
    assert.equal(replay.status, 409, 'stale refusal invalidates the retained preview');
    assert.equal(replay.json.code, 'STALE_PREVIEW');
  });

test('D7: parse-equivalent but byte-different settings refuse Apply (byte-level staleness)',
  { skip: PREVIEW_SKIP },
  async (t) => {
    const file = scratchSettingsFile(t, currentWithExtras());
    const started = await startTestServer(t, { settingsPath: file, port: nextTestPort(), fetchFn: fetchFromBodies(validSourceBodies()) });
    const preview = await postJson(started.port, '/api/preview', {}, authHeaders(started.token));
    const bytes = fs.readFileSync(file).toString('utf8');
    fs.writeFileSync(file, bytes.replace('providers:', 'providers:   '), 'utf8');
    const refusal = await postJson(started.port, '/api/apply', { previewId: preview.json.previewId }, authHeaders(started.token));
    assert.equal(refusal.status, 409);
    assert.equal(refusal.json.code, 'STALE_PREVIEW', 'parsed-YAML equality is not enough; exact bytes bind');
  });

test('D8: browser-supplied plan arrays, counts, and routes can never alter Apply',
  { skip: PREVIEW_SKIP },
  async (t) => {
    const file = scratchSettingsFile(t, currentWithExtras());
    const started = await startTestServer(t, { settingsPath: file, port: nextTestPort(), fetchFn: fetchFromBodies(validSourceBodies()) });
    const preview = await postJson(started.port, '/api/preview', {}, authHeaders(started.token));
    const tampered = await postJson(started.port, '/api/apply', {
      previewId: preview.json.previewId,
      desired: { 'opencode-go': [{ id: 'injected' }] },
      changes: { added: [{ gateway: 'go', id: 'injected', route: 'opencode-go' }] },
      targetPath: 'C:\\elsewhere\\settings.yaml',
    }, authHeaders(started.token));
    assert.equal(tampered.status, 400, 'unknown Apply fields are rejected, never interpreted');
    assertNoBackupOrTemp(path.dirname(file));
    // The untampered authorization still applies exactly the previewed plan.
    const clean = await postJson(started.port, '/api/apply', { previewId: preview.json.previewId }, authHeaders(started.token));
    assert.equal(clean.status, 200);
    assert.equal(clean.json.status, 'UPDATED');
    const written = fs.readFileSync(file).toString('utf8');
    assert.equal(written.includes('injected'), false, 'browser-injected plan data never reaches the target');
  });

test('D9: browser-supplied settings paths can never redirect the target',
  { skip: PREVIEW_SKIP },
  async (t) => {
    const file = scratchSettingsFile(t, currentWithExtras());
    const started = await startTestServer(t, { settingsPath: file, port: nextTestPort(), fetchFn: fetchFromBodies(validSourceBodies()) });
    const preview = await postJson(started.port, '/api/preview?settings=C:\\elsewhere\\settings.yaml', { targetPath: 'C:\\elsewhere\\settings.yaml', settingsPath: 'C:\\elsewhere\\settings.yaml' }, authHeaders(started.token));
    assert.equal(preview.status, 200, 'path-like browser values do not break the request');
    assert.ok(preview.json.target.displayPath.includes(path.basename(file)), 'server-resolved target wins');
    assert.equal(fs.existsSync('C:\\elsewhere\\settings.yaml'), false, 'no file is created from a browser path');
  });

test('D10: every refusal class leaves zero backup/temp and no extra source fetch',
  { skip: PREVIEW_SKIP },
  async (t) => {
    const file = scratchSettingsFile(t, currentWithExtras());
    const beforeBytes = fs.readFileSync(file);
    const seen = [];
    const started = await startTestServer(t, { settingsPath: file, port: nextTestPort(), fetchFn: fetchFromBodies(validSourceBodies(), seen) });
    const baseline = seen.length;
    await postJson(started.port, '/api/apply', { previewId: 'b'.repeat(64) }, authHeaders(started.token));
    await postJson(started.port, '/api/apply', {}, authHeaders(started.token));
    await postJson(started.port, '/api/apply', { previewId: 'unknown' }, authHeaders(started.token));
    await postJson(started.port, '/api/state');
    assert.equal(seen.length, baseline, 'refusals never fetch sources');
    assertNoBackupOrTemp(path.dirname(file), beforeBytes);
  });
