// OCMS-S v1.3 contract tests — H (UI static contract) and K (hostile-input
// rendering). The two capability anchors may RED pre-implementation; dependent
// static tests conditionally skip until the page exists (contract v1.3
// sections 15.2, 19; gate sections 23, 26). No real browser dependency.
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {
  REPO_ROOT,
  hasUiServer,
  hasUiHtml,
  nextTestPort,
  scratchSettingsFile,
  currentWithExtras,
  fetchFromBodies,
  startTestServer,
  httpRequest,
  postJson,
  validSourceBodies,
  authHeaders,
  validSources,
  catRecord,
} from './helpers.mjs';

const UI_HTML_PATH = path.join(REPO_ROOT, 'ui', 'index.html');
const STATIC_SKIP = !hasUiHtml;
const HOSTILE_SKIP = !(hasUiHtml && hasUiServer);

// Capability anchors (intentional RED pre-implementation).
test('capability anchor: ui/index.html exists (v1.3 contract section 5.2 / 19)', () => {
  assert.equal(hasUiHtml, true, 'the self-contained v1.3 page must exist at ui/index.html');
});

test('capability anchor: ui.mjs exists (v1.3 contract section 5.2 / 13)', () => {
  assert.equal(hasUiServer, true, 'the loopback server adapter must exist at ui.mjs');
});

// ---------------------------------------------------------------------------
// H — UI static contract.
// ---------------------------------------------------------------------------

test('H1: the page is fully self-contained (no remote scripts, styles, fonts, CDN, analytics, or telemetry)',
  { skip: STATIC_SKIP },
  () => {
    const html = fs.readFileSync(UI_HTML_PATH, 'utf8');
    assert.doesNotMatch(html, /<script[^>]+src\s*=\s*["']https?:/i, 'no remote script src');
    assert.doesNotMatch(html, /<link[^>]+href\s*=\s*["']https?:/i, 'no remote stylesheet');
    assert.doesNotMatch(html, /@import\s+url\(\s*["']?https?:/i, 'no remote CSS import');
    assert.doesNotMatch(html, /url\(\s*["']?https?:/i, 'no remote font/media URL');
    assert.doesNotMatch(html, /<img[^>]+src\s*=\s*["']https?:/i, 'no remote images');
    for (const cdn of ['cdnjs.cloudflare.com', 'fonts.googleapis.com', 'unpkg.com', 'jsdelivr', 'google-analytics', 'googletagmanager', 'telemetry']) {
      assert.equal(html.includes(cdn), false, 'no CDN/analytics marker: ' + cdn);
    }
  });

test('H2: the token bootstrap placeholder mechanism exists and the page never persists the token',
  { skip: STATIC_SKIP },
  () => {
    const html = fs.readFileSync(UI_HTML_PATH, 'utf8');
    assert.ok(html.includes('__OCMS_TOKEN__'), 'the served page template carries the injection placeholder');
    for (const banned of ['localStorage', 'sessionStorage', 'document.cookie']) {
      assert.equal(html.includes(banned), false, 'token must never be persisted via ' + banned);
    }
  });

test('H3: all primary states have textual labels (not color-only semantics)', { skip: STATIC_SKIP }, () => {
  const html = fs.readFileSync(UI_HTML_PATH, 'utf8');
  for (const state of ['IDLE', 'READY', 'NO CHANGE', 'BLOCKED', 'APPLYING', 'UPDATED', 'ERROR']) {
    assert.ok(html.includes(state) || html.includes(state.replace(' ', '_')), 'state label present: ' + state);
  }
});

test('H4: Refresh Preview and Apply controls exist with confirmation and an identity-only Apply body',
  { skip: STATIC_SKIP },
  () => {
    const html = fs.readFileSync(UI_HTML_PATH, 'utf8');
    assert.ok(html.includes('Refresh Preview'), 'Refresh Preview control present');
    assert.ok(html.includes('Apply'), 'Apply control present');
    assert.ok(html.includes('disabled'), 'control availability logic present');
    assert.ok(html.includes('previewId'), 'Apply carries only the preview authorization identity');
    assert.ok(/confirm/i.test(html), 'explicit Apply confirmation present');
  });

test('H5: no polling, no background refresh, no hidden retry channel', { skip: STATIC_SKIP }, () => {
  const html = fs.readFileSync(UI_HTML_PATH, 'utf8');
  assert.equal(html.includes('setInterval('), false, 'no polling interval');
  assert.equal(html.includes('WebSocket'), false, 'no background channel');
  assert.equal(html.includes('EventSource'), false, 'no background event stream');
});

test('H6: no arbitrary filesystem path surface and PRODUCTION/SCRATCH display exists', { skip: STATIC_SKIP }, () => {
  const html = fs.readFileSync(UI_HTML_PATH, 'utf8');
  assert.ok(html.includes('PRODUCTION'), 'production badge exists');
  assert.ok(html.includes('SCRATCH'), 'scratch badge exists');
  assert.equal(/<input[^>]+type\s*=\s*["']file/i.test(html), false, 'no file-picker path surface');
  assert.equal(/<form/i.test(html), false, 'no form-based path entry surface');
});

// ---------------------------------------------------------------------------
// K — hostile-input rendering.
// ---------------------------------------------------------------------------

test('K1: the page never renders server-derived values through innerHTML/document.write',
  { skip: STATIC_SKIP },
  () => {
    const html = fs.readFileSync(UI_HTML_PATH, 'utf8');
    assert.equal(html.includes('innerHTML'), false, 'no innerHTML usage anywhere in the page');
    assert.equal(html.includes('document.write'), false, 'no document.write');
    assert.equal(html.includes('outerHTML'), false, 'no outerHTML assignment');
    assert.ok(html.includes('textContent'), 'dynamic values render through text-safe DOM paths');
  });

test('K2: hostile model IDs and names flow through the Preview API as JSON data and the served page stays text-safe',
  { skip: HOSTILE_SKIP },
  async (t) => {
    const hostileId = '<script>alert(1)</script>';
    const hostileName = '"><svg/onload=alert(1)>';
    const sources = validSources({
      rosters: { go: [hostileId, 'model-a'], zen: ['model-z'] },
      catalog: {
        go: {
          npm: '@ai-sdk/openai-compatible',
          models: {
            [hostileId]: catRecord({ id: hostileId, name: hostileName, provider: { npm: '@ai-sdk/openai-compatible' } }),
            'model-a': catRecord({ provider: { npm: '@ai-sdk/openai-compatible' } }),
          },
        },
        zen: { npm: '@ai-sdk/openai', models: { 'model-z': catRecord({ id: 'model-z', name: 'Z', provider: { npm: '@ai-sdk/openai' } }) } },
      },
      docs: {
        go: { [hostileId]: 'https://opencode.ai/zen/go/v1/chat/completions', 'model-a': 'https://opencode.ai/zen/go/v1/chat/completions' },
        zen: { 'model-z': 'https://opencode.ai/zen/v1/responses' },
      },
    });
    const file = scratchSettingsFile(t, currentWithExtras());
    const started = await startTestServer(t, { settingsPath: file, port: nextTestPort(), fetchFn: fetchFromBodies(validSourceBodies(sources)) });
    const preview = await postJson(started.port, '/api/preview', {}, authHeaders(started.token));
    assert.equal(preview.status, 200, 'hostile-but-valid sources still preview');
    assert.ok((preview.headers['content-type'] || '').includes('application/json'), 'API stays JSON');
    assert.ok(preview.body.includes(hostileId), 'hostile id is transported as data, never stripped or rendered');
    const page = await httpRequest({ port: started.port, method: 'GET', urlPath: '/' });
    assert.equal(page.body.includes('innerHTML'), false, 'served page never assigns innerHTML');
    assert.ok(page.headers['content-security-policy'].includes("default-src 'self'"), 'CSP still enforced while hostile data flows');
  });

test('K2b: hostile ampersand/quote payloads survive JSON transport unmangled for text-node rendering',
  { skip: HOSTILE_SKIP },
  async (t) => {
    const hostileId = '& < > " ' + String.fromCharCode(39);
    const sources = validSources({
      rosters: { go: [hostileId, 'model-a'], zen: ['model-z'] },
      catalog: {
        go: {
          npm: '@ai-sdk/openai-compatible',
          models: {
            [hostileId]: catRecord({ id: hostileId, name: 'Entity Bomb &amp; <x>', provider: { npm: '@ai-sdk/openai-compatible' } }),
            'model-a': catRecord({ provider: { npm: '@ai-sdk/openai-compatible' } }),
          },
        },
        zen: { npm: '@ai-sdk/openai', models: { 'model-z': catRecord({ id: 'model-z', name: 'Z', provider: { npm: '@ai-sdk/openai' } }) } },
      },
      docs: {
        go: { [hostileId]: 'https://opencode.ai/zen/go/v1/chat/completions', 'model-a': 'https://opencode.ai/zen/go/v1/chat/completions' },
        zen: { 'model-z': 'https://opencode.ai/zen/v1/responses' },
      },
    });
    const file = scratchSettingsFile(t, currentWithExtras());
    const started = await startTestServer(t, { settingsPath: file, port: nextTestPort(), fetchFn: fetchFromBodies(validSourceBodies(sources)) });
    const preview = await postJson(started.port, '/api/preview', {}, authHeaders(started.token));
    assert.equal(preview.status, 200);
    // The model ID arrives character-exact through JSON transport, so a client
    // rendering via textContent reproduces it literally with no HTML decoding.
    const addedIds = (preview.json.changes && preview.json.changes.added ? preview.json.changes.added : []).map((x) => x.id);
    assert.ok(addedIds.includes(hostileId), 'entity-laden id survives transport intact');
  });
