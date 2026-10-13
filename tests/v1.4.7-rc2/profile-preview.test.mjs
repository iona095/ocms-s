// OCMS-S v1.4.7-rc2 tests: profile Preview shows its plan (U1-U4, A2).
// Scratch profile under a temp DSH home, stubbed fetches and stub anchor;
// no live calls, never the real home.
import { describe, it, beforeEach, afterEach } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {
  assert, REPO_ROOT, postJson, authHeaders, fetchFromBodies,
  validSourceBodies, scratchSettingsFile, emptyCurrent, catRecord, validSources,
} from '../v1.3/helpers.mjs';
import { makeTempHome, sandboxDshHome } from '../profile-commit/helpers.mjs';
import { makeProfile as makeS4Profile, makeFixtureBundle, llmRow as s4Row } from '../profile-commit/helpers.mjs';
import { makeStubAnchor, sandboxPathWithoutDsh } from '../v1.4.6-rc2/helpers.mjs';
import { bindReal, readerOpts } from '../profile-reader/helpers.mjs';
import { resolveProfileTarget } from '../../profile/target-resolver.mjs';
import { readManagedConfig } from '../../profile/config-reader.mjs';
import { buildProfileAwarePlan } from '../../profile/plan-builder.mjs';
import { withR2Port } from '../profile-cli-ui/helpers.mjs';

const UI_HTML = path.join(REPO_ROOT, 'ui', 'index.html');

function providersObj() {
  const rec = (id) => ({ id: id, name: id, input: ['text'], contextWindow: 1000, maxTokens: 100, reasoningEfforts: false });
  return {
    'opencode-go': { displayName: 'opencode-go', models: [rec('keep-g'), rec('move-gm'), rec('drop-g')] },
    'opencode': { displayName: 'opencode', models: [rec('keep-o'), rec('old-o')] },
  };
}

function liveParts() {
  const hint = (npm) => (npm === undefined ? {} : { provider: { npm: npm } });
  const models = {
    'keep-g': catRecord({ id: 'keep-g', name: 'keep-g', provider: { npm: '@ai-sdk/openai-compatible' } }),
    'move-gm': catRecord({ id: 'move-gm', name: 'move-gm', provider: { npm: '@ai-sdk/openai-compatible' } }),
    'new-g': catRecord({ id: 'new-g', name: 'new-g', provider: { npm: '@ai-sdk/openai-compatible' } }),
    'odd-u': catRecord({ id: 'odd-u', name: 'odd-u', provider: undefined }),
    'fb': catRecord({ id: 'fb', name: 'fb', provider: { npm: '@ai-sdk/openai-compatible' } }),
    'fb-free': catRecord({ id: 'fb-free', name: 'fb-free', provider: undefined }),
    'z-keep': catRecord({ id: 'z-keep', name: 'z-keep', provider: { npm: '@ai-sdk/openai' } }),
  };
  const docs = {
    'keep-g': 'https://opencode.ai/inference/go/v1/chat/completions',
    'move-gm': 'https://opencode.ai/zen/go/v1/messages',
    'new-g': 'https://opencode.ai/zen/go/v1/chat/completions',
    'odd-u': 'https://opencode.ai/zen/go/v1/future-protocol-9',
    'fb': 'https://opencode.ai/zen/go/v1/chat/completions',
    'z-keep': 'https://opencode.ai/zen/v1/responses',
  };
  models['keep-o'] = catRecord({ id: 'keep-o', name: 'keep-o', provider: { npm: '@ai-sdk/openai' } });
  return {
    rosters: { go: ['keep-g', 'move-gm', 'new-g', 'odd-u', 'fb', 'fb-free', 'lonely-u'], zen: ['z-keep', 'keep-o', 'old-o'] },
    catalog: { go: { npm: '@ai-sdk/openai-compatible', models: models }, zen: { npm: '@ai-sdk/openai', models: { 'z-keep': models['z-keep'], 'keep-o': models['keep-o'] } } },
    docs: { go: docs, zen: { 'z-keep': 'https://opencode.ai/zen/v1/responses', 'keep-o': 'https://opencode.ai/zen/v1/responses' } },
  };
}

async function previewU1(t, home) {
  const dir = makeS4Profile(home, 'u1rev', { entries: [s4Row({ config: { providers: providersObj() } })], bundles: ['@fixture/base'] });
  makeFixtureBundle(dir);
  const parts = liveParts();
  const sources = { rosters: parts.rosters, catalog: parts.catalog, docs: parts.docs };
  const { anchor } = makeStubAnchor(t);
  t.after(sandboxPathWithoutDsh());
  const ui = await import('../../ui.mjs');
  const started = await withR2Port(t, (port) => ui.startServer({ port: port, fetchFn: fetchFromBodies(validSourceBodies(sources)), openBrowser: false, installAnchorDir: anchor }));
  const res = await postJson(started.port, '/api/preview', { profileName: 'u1rev', dshHome: home }, authHeaders(started.token));
  assert.equal(res.status, 200);
  return res.json;
}

describe('v1.4.7-rc2 profile Preview reviewable content', () => {
  let home;
  let cleanupHome;
  let restore;
  beforeEach(() => {
    restore = sandboxDshHome();
    const h = makeTempHome();
    home = h.home;
    cleanupHome = h.cleanup;
  });
  afterEach(() => {
    try { cleanupHome(); } catch {}
    try { restore(); } catch {}
  });
  it('U1 profile response carries every group with exact counts', async (t) => {
    const data = await previewU1(t, home);
    assert.equal(data.ok, true);
    assert.equal(data.state, 'READY');
    assert.deepEqual((data.changes.added || []).map((e) => e.gateway + '/' + e.id).sort(), ['go/fb', 'go/fb-free', 'go/new-g', 'zen/z-keep']);
    assert.deepEqual((data.changes.removed || []).map((e) => e.gateway + '/' + e.id), ['go/drop-g']);
    assert.deepEqual((data.changes.moved || []).map((e) => e.gateway + '/' + e.id + ' ' + e.from + '->' + e.to), ['go/move-gm opencode-go->opencode-go-messages']);
    assert.deepEqual(data.changes.metadataChanged || [], []);
    assert.deepEqual(data.preservedUnresolved, [{ gateway: 'zen', id: 'old-o', reason: 'CATALOG_MISSING', route: 'opencode' }]);
    assert.deepEqual(data.skippedUnresolved, [{ gateway: 'go', id: 'lonely-u', reason: 'CATALOG_MISSING' }]);
    assert.deepEqual(data.unsupportedSkipped, [{ gateway: 'go', id: 'odd-u', reason: 'UNSUPPORTED_PROTOCOL', endpoint: 'https://opencode.ai/zen/go/v1/future-protocol-9' }]);
    assert.deepEqual(data.fallbackResolved, [{ gateway: 'go', id: 'fb-free', counterpart: 'fb', route: 'opencode-go', provenance: 'FREE_COUNTERPART_FALLBACK' }]);
    assert.deepEqual(data.endpointBaseDrift, [{ gateway: 'go', documentedBase: 'https://opencode.ai/inference/go/v1', routedBase: 'https://opencode.ai/zen/go/v1', models: 1 }]);
    assert.deepEqual(data.sources, { goRoster: { ok: true, count: 7 }, zenRoster: { ok: true, count: 3 }, catalog: { ok: true }, goDocs: { ok: true }, zenDocs: { ok: true } });
    assert.deepEqual(data.routeCounts, {
      'opencode-go': { current: 3, desired: 4 },
      'opencode-go-messages': { current: 0, desired: 1 },
      'opencode-go-responses': { current: 0, desired: 0 },
      'opencode-completions': { current: 0, desired: 0 },
      'opencode-messages': { current: 0, desired: 0 },
      'opencode': { current: 2, desired: 3 },
    });
    assert.equal(typeof data.previewId, 'string');
    assert.equal(data.target.profileName, 'u1rev');
  });
  it('legacy response shape unchanged since rc1', async (t) => {
    const file = scratchSettingsFile(t);
    const { startTestServer, nextTestPort } = await import('../v1.3/helpers.mjs');
    const sources = validSources();
    const started = await startTestServer(t, { settingsPath: file, port: nextTestPort(), fetchFn: fetchFromBodies(validSourceBodies(sources)) });
    const res = await postJson(started.port, '/api/preview', {}, authHeaders(started.token));
    assert.equal(res.status, 200);
    assert.deepEqual(Object.keys(res.json).sort(), ['changes', 'endpointBaseDrift', 'fallbackResolved', 'generatedAt', 'ok', 'preservedUnresolved', 'previewId', 'skippedUnresolved', 'sources', 'state', 'target', 'unsupportedSkipped']);
  });
});

describe('v1.4.7-rc2 CLI per-route counts', () => {
  let home;
  let cleanupHome;
  let restore;
  beforeEach(() => {
    restore = sandboxDshHome();
    const h = makeTempHome();
    home = h.home;
    cleanupHome = h.cleanup;
  });
  afterEach(() => {
    try { cleanupHome(); } catch {}
    try { restore(); } catch {}
  });
  it('U4 runProfileSync text prints per-route current turning into desired', async (t) => {
    const rec = (id) => ({ id: id, name: id, input: ['text'], contextWindow: 1000, maxTokens: 100, reasoningEfforts: false });
    const dir = makeS4Profile(home, 'u4cli', { entries: [s4Row({ config: { providers: { 'opencode': { displayName: 'opencode', models: [rec('keep-1')] } } } })], bundles: ['@fixture/base'] });
    makeFixtureBundle(dir);
    const models = { 'keep-1': catRecord({ id: 'keep-1', name: 'keep-1', provider: { npm: '@ai-sdk/openai' } }), 'new-1': catRecord({ id: 'new-1', name: 'new-1', provider: { npm: '@ai-sdk/openai' } }), 'g-keep': catRecord({ id: 'g-keep', name: 'g-keep', provider: { npm: '@ai-sdk/openai-compatible' } }) };
    const sources = { rosters: { go: ['g-keep'], zen: ['keep-1', 'new-1'] }, catalog: { go: { npm: '@ai-sdk/openai-compatible', models: { 'g-keep': models['g-keep'] } }, zen: { npm: '@ai-sdk/openai', models: models } }, docs: { go: { 'g-keep': 'https://opencode.ai/zen/go/v1/chat/completions' }, zen: { 'keep-1': 'https://opencode.ai/zen/v1/responses', 'new-1': 'https://opencode.ai/zen/v1/responses' } } };
    const { anchor } = makeStubAnchor(t);
    t.after(sandboxPathWithoutDsh());
    const syncMod = await import('../../sync.mjs');
    const lines = [];
    const out = await syncMod.runProfileSync({ profile: 'u4cli', dshHome: home, installAnchorDir: anchor, pathEnv: '', fetchFn: fetchFromBodies(validSourceBodies(sources)), liveStateRaw: 'not-running', confirmFn: async () => false, print: (s) => { lines.push(String(s)); } });
    assert.equal(out.code, 'CONFIRMATION_DECLINED');
    const text = lines.join('\n');
    for (const route of ['opencode-go', 'opencode-go-messages', 'opencode-go-responses', 'opencode-completions', 'opencode-messages', 'opencode']) {
      assert.ok(text.includes(route + ': current '), 'missing per-route line for ' + route + ':\n' + text);
    }
    assert.ok(text.includes('opencode: current 1 -> desired 2'), 'opencode counts wrong:\n' + text);
  });
});

function extractPure(source, name) {
  const startMarker = '// __PURE:' + name + ':START';
  const endMarker = '// __PURE:' + name + ':END';
  const si = source.indexOf(startMarker);
  const ei = source.indexOf(endMarker);
  assert.ok(si >= 0 && ei > si, 'pure block markers for ' + name);
  const body = source.slice(si + startMarker.length, ei);
  const sb = {};
  vm.createContext(sb);
  vm.runInContext(body + '\nthis.__fn = ' + name + ';', sb);
  assert.equal(typeof sb.__fn, 'function', name + ' loads dependency-free');
  return sb.__fn;
}

async function planForB1(t, home, profile, providers, live) {
  const dir = makeS4Profile(home, profile, { entries: [s4Row({ config: { providers: providers } })], bundles: ['@fixture/base'] });
  makeFixtureBundle(dir);
  const { anchor } = makeStubAnchor(t);
  const bound = resolveProfileTarget({ profileName: profile, dshHome: home, installAnchorDir: anchor, pathEnv: '' });
  assert.equal(bound.ok, true, 'stub-anchor bind failed: ' + JSON.stringify(bound));
  const target = bound.target;
  const readerResult = await readManagedConfig(readerOpts(target, { installAnchorDir: anchor }));
  assert.equal(readerResult.ok, true);
  const out = await buildProfileAwarePlan({ target: structuredClone(target), readerResult: readerResult, sources: live });
  assert.equal(out.ok, true);
  return out;
}

function tripleProviders(routes) {
  const rec = (id) => ({ id: id, name: id, input: ['text'], contextWindow: 1000, maxTokens: 100, reasoningEfforts: false });
  const providers = {};
  for (const route of routes) providers[route] = { displayName: route, models: [rec('triple')] };
  return providers;
}

function tripleLive(docsUrl) {
  const cat = { id: 'triple', name: 'triple', modalities: { input: ['text'] }, limit: { context: 1000, output: 100 }, reasoning: false, provider: { npm: '@ai-sdk/openai-compatible' } };
  const zcat = { id: 'z', name: 'z', modalities: { input: ['text'] }, limit: { context: 1000, output: 100 }, reasoning: false, provider: { npm: '@ai-sdk/openai' } };
  return {
    rosters: { go: ['triple'], zen: ['z'] },
    catalog: { go: { npm: '@ai-sdk/openai-compatible', models: { 'triple': cat } }, zen: { npm: '@ai-sdk/openai', models: { 'z': zcat } } },
    docs: { go: { 'triple': docsUrl }, zen: { 'z': 'https://opencode.ai/zen/v1/responses' } },
  };
}

describe('v1.4.7-rc2 Amendment B per-copy removed rows', () => {
  let home;
  let cleanupHome;
  let restore;
  beforeEach(() => {
    restore = sandboxDshHome();
    const h = makeTempHome();
    home = h.home;
    cleanupHome = h.cleanup;
  });
  afterEach(() => {
    try { cleanupHome(); } catch {}
    try { restore(); } catch {}
  });
  it('B1 three stored copies desired on one: both dropped copies listed, no move, digest pinned', async (t) => {
    const out = await planForB1(t, home, 'b1three', tripleProviders(['opencode-go', 'opencode-go-messages', 'opencode-go-responses']), tripleLive('https://opencode.ai/zen/go/v1/messages'));
    assert.deepEqual(out.changes.removed, [{ key: 'go/triple', route: 'opencode-go' }, { key: 'go/triple', route: 'opencode-go-responses' }]);
    assert.deepEqual(out.changes.moved, []);
    assert.equal(out.candidateDigest, '13743b192094b75fe11268799659ca443fdba92d84b118995fea5a2f4a483faa');
  });
  it('B1 no stored copy on the desired route: desired copy added, every copy removed', async (t) => {
    const out = await planForB1(t, home, 'b1split', tripleProviders(['opencode-go-messages', 'opencode-go-responses']), tripleLive('https://opencode.ai/zen/go/v1/chat/completions'));
    assert.deepEqual(out.changes.added, [{ key: 'go/triple', route: 'opencode-go' }, { key: 'zen/z', route: 'opencode' }]);
    assert.deepEqual(out.changes.removed, [{ key: 'go/triple', route: 'opencode-go-messages' }, { key: 'go/triple', route: 'opencode-go-responses' }]);
    assert.deepEqual(out.changes.moved, []);
  });
  it('B2 plan carries observed per-route stored counts', async (t) => {
    const out = await planForB1(t, home, 'b1three', tripleProviders(['opencode-go', 'opencode-go-messages', 'opencode-go-responses']), tripleLive('https://opencode.ai/zen/go/v1/messages'));
    assert.deepEqual(out.currentRouteCounts, { 'opencode-go': 1, 'opencode-go-messages': 1, 'opencode-go-responses': 1, 'opencode-completions': 0, 'opencode-messages': 0, 'opencode': 0 });
  });
});

function completeResponse() {
  const arr = (n) => [{ gateway: 'go', id: 'm' + n, route: 'opencode-go' }];
  return {
    ok: true, state: 'READY',
    changes: { added: arr(1), removed: [], moved: [], metadataChanged: [] },
    preservedUnresolved: [], skippedUnresolved: [], unsupportedSkipped: [], fallbackResolved: [],
    endpointBaseDrift: [],
    sources: { goRoster: { ok: true, count: 1 }, zenRoster: { ok: true, count: 0 }, catalog: { ok: true }, goDocs: { ok: true }, zenDocs: { ok: true } },
    routeCounts: { 'opencode-go': { current: 1, desired: 2 } },
  };
}

describe('v1.4.7-rc2 page decision functions under vm', () => {
  it('A2 complete response reads true; each missing group reads false', () => {
    const source = fs.readFileSync(UI_HTML, 'utf8');
    const complete = extractPure(source, 'previewDetailsComplete');
    assert.equal(complete(completeResponse()), true);
    const groups = ['added', 'removed', 'moved', 'metadataChanged', 'preserved', 'skipped', 'unsupported', 'fallback', 'drift', 'sources'];
    for (const g of groups) {
      const broken = completeResponse();
      if (g === 'added' || g === 'removed' || g === 'moved' || g === 'metadataChanged') delete broken.changes[g];
      else if (g === 'preserved') delete broken.preservedUnresolved;
      else if (g === 'skipped') delete broken.skippedUnresolved;
      else if (g === 'unsupported') delete broken.unsupportedSkipped;
      else if (g === 'fallback') delete broken.fallbackResolved;
      else if (g === 'drift') delete broken.endpointBaseDrift;
      else delete broken.sources;
      assert.equal(complete(broken), false, 'missing group must read false: ' + g);
    }
  });
  it('A2 loss warnings name heavy-loss routes only', () => {
    const source = fs.readFileSync(UI_HTML, 'utf8');
    const warn = extractPure(source, 'routeLossWarnings');
    const heavy = JSON.parse(JSON.stringify(warn({ 'opencode-go': { current: 35, desired: 0 } })));
    assert.equal(heavy.length, 1);
    assert.equal(heavy[0].route, 'opencode-go');
    assert.equal(heavy[0].current, 35);
    assert.equal(heavy[0].desired, 0);
    assert.deepEqual(JSON.parse(JSON.stringify(warn({ 'opencode': { current: 10, desired: 9 } }))), []);
    assert.deepEqual(JSON.parse(JSON.stringify(warn({ 'opencode': { current: 10, desired: 5 } }))), []);
  });
  it('A2 page calls the pure functions at the decision points', () => {
    const source = fs.readFileSync(UI_HTML, 'utf8');
    const readyIdx = source.indexOf("setState('READY')");
    const callIdx = source.indexOf('previewDetailsComplete(');
    assert.ok(callIdx >= 0, 'page calls previewDetailsComplete');
    assert.ok(readyIdx > callIdx, 'decision precedes READY');
    assert.ok(source.includes('routeLossWarnings('), 'page calls routeLossWarnings');
    assert.ok(source.includes('Preview details not reported by server'), 'error notice present');
    assert.ok(source.includes('id="details-routes"'), 'per-route summary element present');
    assert.ok(source.includes('id="list-routes"'), 'per-route summary list present');
    assert.ok(source.includes('id="route-loss-warning"'), 'loss warning element present');
  });
});
