// OCMS-S v1.4.7-rc5 withdrawn-docs test: W1 report-only removals (a)-(f).
// Engine fixtures only (captured docs pair without the v4-flash rows).
// No live calls, no Apply, no real profiles.
import { describe, it } from 'node:test';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import * as sync from '../../sync.mjs';
import { buildProfileAwarePlan } from '../../profile/plan-builder.mjs';
import { assert, scratchSettingsFile, catRecord, startTestServer, postJson, authHeaders, fetchFromBodies, validSourceBodies } from '../v1.3/helpers.mjs';
import { __reuse as planReuse } from '../../profile/plan-builder.mjs';
import { withR2Port } from '../profile-cli-ui/helpers.mjs';
import { sandboxDshHome, makeTempHome, makeProfile, makeFixtureBundle, llmRow, modelsConfig } from '../profile-commit/helpers.mjs';
import { makeStubAnchor, sandboxPathWithoutDsh } from '../v1.4.6-rc2/helpers.mjs';

const OLD1 = 'deepseek-v4-flash';
const OLD2 = 'deepseek-v4-flash-vision-exp';
const NEW1 = 'deepseek-v4.1-flash';
const KEEPZ = 'keep-z';

const oldRec = (id) => catRecord({ id, name: id });

function W_sources() {
  return {
    rosters: { go: [OLD1, OLD2], zen: [KEEPZ] },
    catalog: {
      go: { npm: '@ai-sdk/openai-compatible', models: { [OLD1]: oldRec(OLD1), [OLD2]: oldRec(OLD2) } },
      zen: { npm: '@ai-sdk/openai', models: { [KEEPZ]: catRecord({ id: KEEPZ, name: 'KZ', provider: { npm: '@ai-sdk/openai' } }) } },
    },
    docs: {
      go: { [NEW1]: 'https://opencode.ai/zen/go/v1/chat/completions' },
      zen: { [KEEPZ]: 'https://opencode.ai/zen/v1/responses' },
    },
  };
}

function W_current() {
  return { 'llm-pi-ai': { providers: {
    'opencode-go': { models: [{ id: OLD1 }, { id: OLD2 }] },
    'opencode-go-messages': { models: [{ id: OLD1 }, { id: OLD2 }] },
    'opencode': { models: [{ id: KEEPZ }] },
  } } };
}

function W_plan(t, sources, current) {
  const file = scratchSettingsFile(t, current);
  return sync.buildPlan({ settingsPath: file, sources });
}

function W_sha(b) { return crypto.createHash('sha256').update(b).digest('hex'); }
function W_reader(storedConfig) {
  const text = '- id: llm-pi-ai\n  name: LLM Pi AI\n  config:\n    providers:\n      other:\n        displayName: other\n        models: []\n';
  const bytes = Buffer.from(text, 'utf8');
  const digest = W_sha(bytes);
  const target = { profileName: 'w1fx', profileDirReal: path.join(os.tmpdir(), 'ocms-s5-w1-profile'), patchPathReal: path.join(os.tmpdir(), 'ocms-s5-w1-profile', 'cordis.patch.yml'), pluginEntryName: 'LLM Pi AI', classification: 'SCRATCH', dshHomeReal: os.tmpdir(), patchDigest: digest, declaredOverlays: [], liveAttestation: null };
  const stored = structuredClone(storedConfig);
  return { ok: true, status: 'MATCHED', target: structuredClone(target), patchBytes: bytes, patchDigest: digest, storedConfig: stored, effectiveConfig: structuredClone(stored), effectiveDigest: digest, documentModel: { root: 'sequence', size: 1, rows: [{ id: 'llm-pi-ai' }] }, llmEntryIndex: 0, overriddenBy: [], warnings: [] };
}

function W_dispositions(plan, gateway, id) {
  return (plan.dispositions || []).filter((d) => d.gateway === gateway && d.id === id);
}

const W_REMOVED = [
  { key: 'go/' + OLD1, route: 'opencode-go', reason: 'DOCS_WITHDRAWN' },
  { key: 'go/' + OLD1, route: 'opencode-go-messages', reason: 'DOCS_WITHDRAWN' },
  { key: 'go/' + OLD2, route: 'opencode-go', reason: 'DOCS_WITHDRAWN' },
  { key: 'go/' + OLD2, route: 'opencode-go-messages', reason: 'DOCS_WITHDRAWN' },
];

describe('v1.4.7-rc5 withdrawn-docs removals', () => {
  it('(a) W1: withdrawn multi-copy fixture no longer blocks (RED documented the old PLACEMENT_AMBIGUOUS block pre-implementation)', (t) => {
    const plan = W_plan(t, W_sources(), W_current());
    assert.notEqual(plan.state, 'BLOCKED', 'W1 converts the block, got ' + JSON.stringify(plan.blockedReasons || null));
    assert.ok(!(plan.blockedReasons || []).some((r) => String(r.reason).includes('PLACEMENT_AMBIGUOUS')), 'no PLACEMENT_AMBIGUOUS refusal remains');
  });

  it('(b) GREEN: same fixture plans per-copy DOCS_WITHDRAWN removals, READY', (t) => {
    const plan = W_plan(t, W_sources(), W_current());
    assert.equal(plan.state, 'READY', 'W1 plans READY with removals, got ' + plan.state + ' ' + JSON.stringify(plan.blockedReasons || plan.unresolved || null));
    assert.deepEqual(plan.changes.removed, W_REMOVED);
    const control = W_plan(t, W_sources(), { 'llm-pi-ai': { providers: { 'opencode': { models: [{ id: KEEPZ }] } } } });
    assert.deepEqual(plan.desired, control.desired, 'candidate differs in nothing else');
    for (const route of Object.keys(plan.desired || {})) {
      for (const rec of plan.desired[route]) {
        assert.ok(rec.id !== OLD1 && rec.id !== OLD2, 'candidate lacks every withdrawn copy');
      }
    }
  });

  it('(c) one-route PRESERVED and zero-route SKIPPED stay unchanged', (t) => {
    const one = W_plan(t, W_sources(), { 'llm-pi-ai': { providers: { 'opencode-go': { models: [{ id: OLD1 }] } } } });
    assert.deepEqual(W_dispositions(one, 'go', OLD1), [{ gateway: 'go', id: OLD1, disposition: 'PRESERVED_UNRESOLVED', reason: 'PLACEMENT_UNRESOLVED', route: 'opencode-go' }]);
    const zero = W_plan(t, W_sources(), { 'llm-pi-ai': { providers: {} } });
    assert.deepEqual(W_dispositions(zero, 'go', OLD1), [{ gateway: 'go', id: OLD1, disposition: 'SKIPPED_UNRESOLVED', reason: 'PLACEMENT_UNRESOLVED' }]);
  });

  it('(d) refusal paths stay blocking: not-OK sources, malformed docs, compat clash, other-gateway row', (t) => {
    const src = W_sources(); const cur = W_current();
    const multi = { rosters: src.rosters, catalog: src.catalog, docs: src.docs, current: cur, allSourcesOk: false };
    const blocked = sync.planDesired(multi);
    assert.equal(blocked.ok, false);
    assert.ok(JSON.stringify(blocked.unresolved).includes('PLACEMENT_AMBIGUOUS'), 'not-OK sources keep the block');
    const badDocs = structuredClone(src); badDocs.docs.go[OLD1] = 'http://insecure.example/x';
    const malformed = sync.planDesired({ rosters: src.rosters, catalog: src.catalog, docs: badDocs.docs, current: cur });
    assert.equal(malformed.ok, false);
    assert.ok(JSON.stringify(malformed.unresolved).includes('ENDPOINT_INVALID'), 'malformed docs identity blocks');
    const clash = { 'llm-pi-ai': { providers: { 'opencode-go': { models: [{ id: 'clash', compat: { tag: 'a' } }, { id: 'clash', compat: { tag: 'b' } }] } } } };
    const clashSrc = structuredClone(src); clashSrc.rosters.go = ['clash']; clashSrc.catalog.go.models = { clash: catRecord({ id: 'clash', name: 'clash' }) };
    const compat = sync.planDesired({ rosters: clashSrc.rosters, catalog: clashSrc.catalog, docs: clashSrc.docs, current: clash });
    assert.equal(compat.ok, false);
    assert.ok(JSON.stringify(compat.unresolved).includes('COMPAT_AMBIGUOUS'), 'compat clash blocks');
    const other = structuredClone(src); other.docs.zen[OLD1] = 'https://opencode.ai/zen/v1/responses';
    const trunc = sync.planDesired({ rosters: src.rosters, catalog: src.catalog, docs: other.docs, current: cur });
    assert.equal(trunc.ok, false);
    assert.ok(JSON.stringify(trunc.unresolved).includes('PLACEMENT_AMBIGUOUS'), 'other-gateway row keeps the block');
  });

  it('(e) reason renders in CLI lines, translator output and page rows', async (t) => {
    const text = sync.formatReport({ result: 'READY', removed: [{ key: 'go/' + OLD1, route: 'opencode-go', reason: 'DOCS_WITHDRAWN' }] });
    assert.ok(text.includes('DOCS_WITHDRAWN'), 'CLI removed line carries the reason');
    const ui = await import('../../ui.mjs');
    assert.equal(typeof ui.translateChanges, 'function', 'translator is importable');
    const out = ui.translateChanges({ removed: [{ key: 'go/' + OLD1, route: 'opencode-go', reason: 'DOCS_WITHDRAWN' }] });
    assert.deepEqual(out.removed, [{ gateway: 'go', id: OLD1, route: 'opencode-go', reason: 'DOCS_WITHDRAWN' }]);
    const fs = await import('node:fs');
    const html = fs.readFileSync(new URL('../../ui/index.html', import.meta.url), 'utf8');
    assert.ok(html.includes("fieldOf(item, ['reason'])"), 'page Removed rows read the reason');
    assert.ok(!/\.innerHTML/.test(html), 'reason renders via textContent only');
  });

  it('(f) legacy buildPlan and profile plan-builder agree on desired, rows and skipped', async (t) => {
    const file = scratchSettingsFile(t, W_current());
    const legacy = sync.buildPlan({ settingsPath: file, sources: W_sources() });
    assert.equal(legacy.state, 'READY');
    const stored = W_current()['llm-pi-ai'];
    const rr = W_reader(stored);
    const pro = buildProfileAwarePlan({ target: structuredClone(rr.target), readerResult: rr, sources: W_sources() });
    assert.equal(pro.ok, true, 'profile plans: ' + JSON.stringify(pro).slice(0, 400));
    assert.equal(pro.status, 'READY');
    assert.deepEqual(pro.desired, legacy.desired, 'equal managed desired arrays');
    const ui = await import('../../ui' + '.mjs');
    const proRows = ui.translateChanges(pro.changes, pro.dispositions).removed;
    const quad = (rows) => rows.map((e) => [e.gateway, e.id, e.route, e.reason]).sort();
    const legQuad = legacy.changes.removed.map((e) => { const i = e.key.indexOf('/'); return [e.key.slice(0, i), e.key.slice(i + 1), e.route, e.reason]; }).sort();
    assert.deepEqual(quad(proRows), legQuad, 'equal per-copy DOCS_WITHDRAWN removal rows');
    for (const row of legacy.changes.removed) assert.equal(row.reason, 'DOCS_WITHDRAWN', 'legacy rows carry the reason');
    for (const id of [OLD1, OLD2]) {
      assert.ok(!(legacy.skippedUnresolved || []).some((e) => e.id === id), 'legacy skipped omits ' + id);
    }
    const servedSkipped = (pro.dispositions || []).filter((e) => e && e.disposition === 'SKIPPED_UNRESOLVED' && e.reason !== 'DOCS_WITHDRAWN');
    for (const id of [OLD1, OLD2]) {
      assert.ok(!servedSkipped.some((e) => e.id === id), 'profile skipped omits ' + id);
    }
  });

  it('(4) translator fills the reason from dispositions; unmatched rows stay bare', async (t) => {
    const ui = await import('../../ui' + '.mjs');
    const disp = [
      { gateway: 'go', id: OLD1, disposition: 'SKIPPED_UNRESOLVED', reason: 'DOCS_WITHDRAWN', route: 'opencode-go' },
      { gateway: 'go', id: OLD1, disposition: 'SKIPPED_UNRESOLVED', reason: 'DOCS_WITHDRAWN', route: 'opencode-go-messages' },
    ];
    const out = ui.translateChanges({ removed: [
      { key: 'go/' + OLD1, route: 'opencode-go' },
      { key: 'go/' + OLD1, route: 'opencode-go-messages' },
      { key: 'go/other', route: 'opencode-go' },
    ] }, disp);
    assert.deepEqual(out.removed, [
      { gateway: 'go', id: OLD1, route: 'opencode-go', reason: 'DOCS_WITHDRAWN' },
      { gateway: 'go', id: OLD1, route: 'opencode-go-messages', reason: 'DOCS_WITHDRAWN' },
      { gateway: 'go', id: 'other', route: 'opencode-go' },
    ]);
  });

  it('(5) frozen loss warnings fire over the W1 fixture routes', async (t) => {
    const fs = await import('node:fs');
    const html = fs.readFileSync(new URL('../../ui/index.html', import.meta.url), 'utf8');
    const s = '// __PURE:routeLossWarnings:START';
    const e = '// __PURE:routeLossWarnings:END';
    const i = html.indexOf(s), j = html.indexOf(e);
    assert.ok(i >= 0 && j > i, 'pure banners present');
    const vm = await import('node:vm');
    const sb = {};
    vm.createContext(sb);
    vm.runInContext(html.slice(i, j + e.length) + '\nthis.__fn = routeLossWarnings;', sb);
    const warn = (v) => JSON.parse(JSON.stringify(sb.__fn(v)));
    assert.deepEqual(warn({ 'opencode-go': { current: 2, desired: 0 }, 'opencode-go-messages': { current: 2, desired: 0 }, 'opencode': { current: 1, desired: 1 } }).map((w) => w.route), ['opencode-go', 'opencode-go-messages']);
    assert.deepEqual(warn({ 'opencode': { current: 1, desired: 1 } }), []);
  });

  it('(d2) real source refusals through both server paths carry codes, no withdrawals', async (t) => {
    const restoreHome = sandboxDshHome();
    t.after(() => { try { restoreHome(); } catch {} });
    const bodies = validSourceBodies(W_sources());
    const badRoster = { ...bodies, [sync.SOURCE_URLS.goRoster]: 'not json at all' };
    const badDocs = { ...bodies, [sync.SOURCE_URLS.goDocs]: '<table><tr><th>Model ID</th><th>Endpoint</th></tr></table>' };
    await assert.rejects(sync.fetchSources(fetchFromBodies(badRoster)), /ROSTER_INVALID/, 'fetch layer reports roster');
    await assert.rejects(sync.fetchSources(fetchFromBodies(badDocs)), /DOCS_INVALID/, 'fetch layer reports docs');
    for (const [name, stub, code] of [['roster', badRoster, 'ROSTER_INVALID'], ['docs', badDocs, 'DOCS_INVALID']]) {
      const file = scratchSettingsFile(t, W_current());
      const started = await withR2Port(t, (port) => startTestServer(t, { settingsPath: file, port, fetchFn: fetchFromBodies(stub) }));
      const res = await postJson(started.port, '/api/preview', {}, authHeaders(started.token));
      assert.equal(res.status, 200, name + ' legacy preview answers');
      assert.equal(res.json.state, 'BLOCKED', name + ' legacy preview blocked');
      assert.ok(JSON.stringify(res.json.blockedReasons || []).includes(code), name + ' refusal carries ' + code);
      assert.deepEqual((res.json.changes || {}).removed || [], [], 'no removal rows on ' + name + ' refusal');
      assert.ok(!JSON.stringify(res.json).includes('DOCS_WITHDRAWN'), 'no withdrawals on ' + name + ' refusal');
    }
    const ui = await import('../../ui' + '.mjs');
    const { anchor } = makeStubAnchor(t);
    t.after(sandboxPathWithoutDsh());
    const fullRec = (id) => ({ id, name: id, input: ['text'], contextWindow: 1000, maxTokens: 100, reasoningEfforts: false });
    const h = makeTempHome('ocms-s5-w1-');
    t.after(() => { try { h.cleanup(); } catch {} });
    makeProfile(h.home, 'w1pos', { entries: [llmRow({ config: modelsConfig({ 'opencode-go': [fullRec(OLD1), fullRec(OLD2)], 'opencode-go-messages': [fullRec(OLD1), fullRec(OLD2)], 'opencode': [fullRec(KEEPZ)] }) })], bundles: ['@fixture/base'] });
    makeFixtureBundle(h.home + '/profiles/w1pos');
    const pos = await withR2Port(t, (port) => ui.startServer({ port, fetchFn: fetchFromBodies(bodies), openBrowser: false, installAnchorDir: anchor }));
    const posRes = await postJson(pos.port, '/api/preview', { profileName: 'w1pos', dshHome: h.home }, authHeaders(pos.token));
    assert.equal(posRes.status, 200, 'positive control answers');
    assert.equal(posRes.json.ok, true, 'positive control ok');
    assert.equal(posRes.json.state, 'READY', 'positive control READY');
    const posRows = ((posRes.json.changes || {}).removed || []).map((e) => [e.gateway, e.id, e.route, e.reason]);
    assert.ok(posRows.some((r) => r[1] === OLD1 && r[3] === 'DOCS_WITHDRAWN'), 'positive control lists DOCS_WITHDRAWN rows');
    assert.ok(posRows.some((r) => r[1] === OLD2 && r[3] === 'DOCS_WITHDRAWN'), 'both withdrawn ids listed');
    for (const [name, stub, code] of [['roster', badRoster, 'ROSTER_INVALID'], ['docs', badDocs, 'DOCS_INVALID']]) {
      await assert.rejects(sync.fetchSources(fetchFromBodies(stub)), new RegExp(code), name + ' fetch refusal carries ' + code);
      const started = await withR2Port(t, (port) => ui.startServer({ port, fetchFn: fetchFromBodies(stub), openBrowser: false, installAnchorDir: anchor }));
      const res = await postJson(started.port, '/api/preview', { profileName: 'w1pos', dshHome: h.home }, authHeaders(started.token));
      assert.equal(res.json.ok, false, name + ' profile preview refuses');
      assert.ok(!('previewId' in (res.json || {})), 'no preview retained on ' + name + ' refusal');
      assert.ok(!JSON.stringify(res.json).includes('DOCS_WITHDRAWN'), 'no withdrawals on profile ' + name + ' refusal');
    }
  });
});


