// OCMS-S v1.4.7-rc1 tests: GO DOCS MOVE AND FAIL-CLOSED UNKNOWN BASE.
// Captured 2026-10-13 fixtures; no live network. Scratch settings only.
import { describe, it } from 'node:test';
import crypto from 'node:crypto';
import * as sync from '../../sync.mjs';
import { assert, goDocsHtml, zenDocsHtml, FIXTURE_META } from './helpers.mjs';
import { scratchSettingsFile, emptyCurrent, catRecord, validSources } from '../v1.3/helpers.mjs';

const GO_NEW_BASE = '/inference/go/v1/';
const GO_UNLISTED_BASE = '/inference/go/v2/';

function apiOrError(endpoint, gateway, id) {
  try { return sync.endpointApi(endpoint, gateway, id); }
  catch (err) { return String((err && err.message) || err).split(':')[0]; }
}

function fullApiOrError(endpoint, gateway, id) {
  try { return sync.endpointApi(endpoint, gateway, id); }
  catch (err) { return String((err && err.message) || err); }
}

function hintForTail(tail) {
  if (tail === 'messages') return '@ai-sdk/anthropic';
  if (tail === 'responses') return '@ai-sdk/openai';
  return '@ai-sdk/openai-compatible';
}

function goSourcesFromDocs(docsMap) {
  const ids = Object.keys(docsMap);
  const models = {};
  for (const id of ids) {
    const tail = new URL(docsMap[id]).pathname.split('/').pop();
    models[id] = catRecord({ id: id, name: id, provider: { npm: hintForTail(tail) } });
  }
  const base = validSources();
  const zenModels = { 'zen-keep': catRecord({ id: 'zen-keep', name: 'zen-keep', provider: { npm: '@ai-sdk/openai' } }) };
  return {
    rosters: { go: ids, zen: ['zen-keep'] },
    catalog: { go: { npm: '@ai-sdk/openai-compatible', models: models }, zen: { npm: '@ai-sdk/openai', models: zenModels } },
    docs: { go: docsMap, zen: { 'zen-keep': 'https://opencode.ai/zen/v1/responses' } },
  };
}

function desiredIds(desired) {
  const ids = [];
  for (const route of sync.MANAGED_ROUTE_KEYS) {
    for (const record of (desired && desired[route]) || []) ids.push(route + ':' + record.id);
  }
  return ids.sort();
}

describe('v1.4.7-rc1 go docs move and fail-closed base', () => {
  it('G1 go bases list the inference/go base second and stay disjoint', () => {
    const bases = sync.DOC_ENDPOINT_BASES;
    assert.ok(Object.isFrozen(bases) && Object.isFrozen(bases.go) && Object.isFrozen(bases.zen));
    assert.deepEqual([...bases.go], ['/zen/go/v1/', '/inference/go/v1/']);
    assert.equal(bases.go[0], new URL(sync.routeBaseURL('go', 'openai-completions')).pathname + '/');
    for (const a of bases.go) for (const b of bases.zen) {
      assert.ok(!a.startsWith(b) && !b.startsWith(a), 'I-DISJOINT ' + a + ' vs ' + b);
    }
  });
  it('G1 new-base tails map exactly like canonical tails', () => {
    const pairs = [['chat/completions', 'openai-completions'], ['messages', 'anthropic-messages'], ['responses', 'openai-responses']];
    for (const pair of pairs) {
      assert.equal(sync.endpointApi('https://opencode.ai' + GO_NEW_BASE + pair[0], 'go', 'm'), pair[1]);
      assert.equal(sync.endpointApi('https://opencode.ai/zen/go/v1/' + pair[0], 'go', 'm'), pair[1]);
    }
  });
  it('G1 drift reports the inference/go alias with written URLs unchanged', () => {
    const goMap = sync.parseDocs(goDocsHtml(), 'go');
    const drift = sync.endpointBaseDrift({ rosters: { go: Object.keys(goMap), zen: [] }, docs: { go: goMap, zen: {} } });
    assert.deepEqual(drift, [{ gateway: 'go', documentedBase: 'https://opencode.ai/inference/go/v1', routedBase: 'https://opencode.ai/zen/go/v1', models: 32 }]);
    for (const route of sync.MANAGED_ROUTE_KEYS) {
      const r = sync.MANAGED_ROUTES[route];
      assert.ok(!String(r.baseURL).includes('/inference/'), route + ' written baseURL unchanged: ' + r.baseURL);
    }
  });
  it('G2 unknown base throws naming gateway, model and URL', () => {
    assert.equal(fullApiOrError('https://opencode.ai/future/v9/chat/completions', 'go', 'kimi-k3'), 'ENDPOINT_BASE_UNKNOWN: go/kimi-k3 https://opencode.ai/future/v9/chat/completions');
    assert.equal(fullApiOrError('https://opencode.ai/future/v9/responses', 'zen', 'mz'), 'ENDPOINT_BASE_UNKNOWN: zen/mz https://opencode.ai/future/v9/responses');
    assert.equal(apiOrError('https://opencode.ai/zen/v1/systemone', 'zen', 'm'), 'ENDPOINT_UNSUPPORTED');
  });
  it('G2 unknown base with a valid managed hint still blocks, never skips', () => {
    const docsMap = { 'kimi-k3': 'https://opencode.ai/future/v9/chat/completions' };
    const catalogRecord = catRecord({ id: 'kimi-k3', name: 'kimi-k3', provider: { npm: '@ai-sdk/openai-compatible' } });
    const verdict = sync.classifyProtocolSupport({ gateway: 'go', id: 'kimi-k3', docsMap: docsMap, catalogRecord: catalogRecord });
    assert.equal(verdict.status, 'UNRESOLVED');
    assert.ok(String(verdict.reason).startsWith('ENDPOINT_BASE_UNKNOWN: go/kimi-k3'));
  });
  it('G4 fixtures are the recorded 2026-10-13 captures', () => {
    assert.equal(FIXTURE_META.go.url, 'https://opencode.ai/v2/docs/console/go/');
    assert.equal(FIXTURE_META.zen.url, 'https://opencode.ai/v2/docs/console/models/');
    const goBytes = Buffer.from(goDocsHtml(), 'utf8');
    const zenBytes = Buffer.from(zenDocsHtml(), 'utf8');
    assert.equal(crypto.createHash('sha256').update(goBytes).digest('hex'), FIXTURE_META.go.sha256);
    assert.equal(crypto.createHash('sha256').update(zenBytes).digest('hex'), FIXTURE_META.zen.sha256);
    assert.equal(Object.keys(sync.parseDocs(goDocsHtml(), 'go')).length, 32);
    assert.equal(Object.keys(sync.parseDocs(zenDocsHtml(), 'zen')).length, 89);
  });
  it('G4a today: all 32 documented Go rows place normally', (t) => {
    const goMap = sync.parseDocs(goDocsHtml(), 'go');
    const counts = {};
    for (const entry of Object.entries(goMap)) {
      const k = sync.endpointApi(entry[1], 'go', entry[0]);
      counts[k] = (counts[k] || 0) + 1;
    }
    assert.deepEqual(counts, { 'openai-completions': 20, 'anthropic-messages': 6, 'openai-responses': 6 });
    const sources = goSourcesFromDocs(goMap);
    const planned = sync.planDesired({ rosters: sources.rosters, catalog: sources.catalog, docs: sources.docs, current: emptyCurrent() });
    assert.equal(planned.ok, true, 'today plan must resolve, got ' + JSON.stringify(planned.unresolved));
    assert.equal(planned.dispositions.length, 33);
    for (const d of planned.dispositions) assert.equal(d.disposition, 'RESOLVED', d.gateway + '/' + d.id);
    const goDisp = planned.dispositions.filter((d) => d.gateway === 'go');
    assert.equal(goDisp.length, 32);
    assert.equal(desiredIds(planned.desired).length, 33);
    const perRoute = {};
    for (const route of sync.MANAGED_ROUTE_KEYS) perRoute[route] = (planned.desired[route] || []).length;
    assert.deepEqual(perRoute, { 'opencode-go': 20, 'opencode-go-messages': 6, 'opencode-go-responses': 6, 'opencode-completions': 0, 'opencode-messages': 0, 'opencode': 1 });
    const settingsPath = scratchSettingsFile(t, emptyCurrent());
    const plan = sync.buildPlan({ settingsPath: settingsPath, sources: sources });
    assert.equal(plan.state, 'READY', JSON.stringify(plan.blockedReasons));
    assert.deepEqual(plan.unsupportedSkipped, []);
  });
  it('G4b without the new base the same plan blocks under G2', (t) => {
    const goMap = sync.parseDocs(goDocsHtml(), 'go');
    const moved = {};
    for (const entry of Object.entries(goMap)) moved[entry[0]] = String(entry[1]).split(GO_NEW_BASE).join(GO_UNLISTED_BASE);
    const sources = goSourcesFromDocs(moved);
    const planned = sync.planDesired({ rosters: sources.rosters, catalog: sources.catalog, docs: sources.docs, current: emptyCurrent() });
    assert.equal(planned.ok, false, 'unlisted-base plan must block');
    assert.equal(planned.desired, null, 'blocked plan places nothing');
    assert.deepEqual(planned.dispositions, []);
    assert.equal(planned.unresolved.length, 32);
    for (const u of planned.unresolved) assert.ok(String(u.reason).startsWith('ENDPOINT_BASE_UNKNOWN: go/'), u.gateway + '/' + u.id);
    const sample = planned.unresolved.find((u) => u.id === Object.keys(moved)[0]);
    assert.ok(String(sample.reason).includes(moved[sample.id]), 'reason names the URL');
    const settingsPath = scratchSettingsFile(t, emptyCurrent());
    const plan = sync.buildPlan({ settingsPath: settingsPath, sources: sources });
    assert.equal(plan.state, 'BLOCKED');
    assert.equal(plan.blockedReasons.length, 32);
    assert.deepEqual(plan.unsupportedSkipped, []);
    assert.equal(desiredIds(plan.desired || {}).length, 0, 'nothing placed via hints, no route changes');
  });
});
