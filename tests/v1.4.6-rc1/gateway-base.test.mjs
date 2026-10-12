// OCMS-S v1.4.6-rc1 tests: GATEWAY BASE DERIVATION AND DOCUMENTED BASE ALIASES.
// Test-first gate written against the frozen contract v1.4.6-rc1 (see
// helpers.mjs freeze anchor). Scratch settings only; no live network.
// Frozen test identities (§8): 14 tests.
import { describe, it } from 'node:test';
import * as sync from '../../sync.mjs';
import {
  assert,
  scratchSettingsFile,
  emptyCurrent,
  catRecord,
  validSources,
  FROZEN_CONTRACT_FILE,
  FROZEN_CONTRACT_SHA256,
  FROZEN_CONTRACT_LINES,
  frozenContractBytes,
  sha256HexBytes,
  countTextLines,
  goDocsHtml,
  zenDocsHtml,
  V145_ROUTE_BASE_URLS,
  ZEN_ALIAS,
} from './helpers.mjs';

function zenSources({ roster, models, docs }) {
  const base = validSources();
  return {
    rosters: { go: base.rosters.go, zen: roster },
    catalog: { go: base.catalog.go, zen: { npm: '@ai-sdk/openai', models } },
    docs: { go: base.docs.go, zen: docs },
  };
}

function routeOf(desired, id) {
  const hits = [];
  for (const route of sync.MANAGED_ROUTE_KEYS) {
    for (const record of desired[route] || []) if (record.id === id) hits.push(route);
  }
  return hits;
}

function apiOrError(endpoint, gateway, id) {
  try {
    return sync.endpointApi(endpoint, gateway, id);
  } catch (err) {
    return String(err.message).split(':')[0];
  }
}

describe('v1.4.6-rc1 gateway base derivation and documented aliases', () => {
  it('1. contract v1.4.6-rc1 freeze anchor is intact', () => {
    const bytes = frozenContractBytes();
    assert.equal(sha256HexBytes(bytes), FROZEN_CONTRACT_SHA256, 'contract SHA-256 must match the frozen value');
    assert.equal(countTextLines(bytes), FROZEN_CONTRACT_LINES, 'contract line count must match the frozen value');
    assert.ok(FROZEN_CONTRACT_FILE.length > 0);
  });

  it('2. gateway-base-derivation: route baseURLs are derived and byte-identical to v1.4.5', () => {
    assert.equal(typeof sync.routeBaseURL, 'function', 'routeBaseURL must exist');
    assert.deepEqual({ ...sync.GATEWAY_BASE }, { go: 'https://opencode.ai/zen/go', zen: 'https://opencode.ai/zen' });
    assert.ok(Object.isFrozen(sync.GATEWAY_BASE), 'GATEWAY_BASE is frozen');
    assert.deepEqual(Object.keys(V145_ROUTE_BASE_URLS).sort(), [...sync.MANAGED_ROUTE_KEYS].sort());
    for (const route of sync.MANAGED_ROUTE_KEYS) {
      const r = sync.MANAGED_ROUTES[route];
      assert.equal(r.baseURL, sync.routeBaseURL(r.gateway, r.api), route + ' baseURL derived');
      assert.equal(r.baseURL, V145_ROUTE_BASE_URLS[route], route + ' baseURL unchanged (I-EMIT)');
    }
  });

  it('3. doc-bases-disjoint: no base of one gateway prefixes a base of the other', () => {
    const bases = sync.DOC_ENDPOINT_BASES;
    assert.ok(Object.isFrozen(bases) && Object.isFrozen(bases.go) && Object.isFrozen(bases.zen));
    assert.deepEqual([...bases.go], ['/zen/go/v1/']);
    assert.deepEqual([...bases.zen], ['/zen/v1/', '/inference/v1/']);
    for (const g of ['go', 'zen']) {
      const canonical = new URL(sync.routeBaseURL(g, 'openai-completions')).pathname + '/';
      assert.equal(bases[g][0], canonical, g + ' canonical doc base matches the routed base');
    }
    for (const a of bases.go) for (const b of bases.zen) {
      assert.ok(!a.startsWith(b) && !b.startsWith(a), 'I-DISJOINT ' + a + ' vs ' + b);
    }
  });

  it('4. zen-alias-recognized: alias tails map exactly like canonical tails', () => {
    for (const [tail, api] of [
      ['chat/completions', 'openai-completions'],
      ['messages', 'anthropic-messages'],
      ['responses', 'openai-responses'],
    ]) {
      assert.equal(sync.endpointApi(ZEN_ALIAS + '/' + tail, 'zen', 'm'), api);
      assert.equal(sync.endpointApi('https://opencode.ai/zen/v1/' + tail, 'zen', 'm'), api);
    }
  });

  it('5. zen-alias-google: /inference/v1/models/{id} is google-style', () => {
    assert.equal(sync.endpointApi(ZEN_ALIAS + '/models/gem-x', 'zen', 'gem-x'), 'unsupported-google');
    assert.equal(apiOrError(ZEN_ALIAS + '/models/other', 'zen', 'gem-x'), 'ENDPOINT_UNSUPPORTED');
  });

  it('6. zen-alias-unknown-tail: unrecognized tail stays ENDPOINT_UNSUPPORTED', () => {
    assert.equal(apiOrError(ZEN_ALIAS + '/future-protocol-9', 'zen', 'm'), 'ENDPOINT_UNSUPPORTED');
  });

  it('7. cross-gateway-rejection: aliases never cross gateways', () => {
    assert.equal(apiOrError(ZEN_ALIAS + '/responses', 'go', 'm'), 'ENDPOINT_UNSUPPORTED');
    assert.equal(apiOrError('https://opencode.ai/zen/v1/responses', 'go', 'm'), 'ENDPOINT_UNSUPPORTED');
    assert.equal(apiOrError('https://opencode.ai/zen/go/v1/responses', 'zen', 'm'), 'ENDPOINT_UNSUPPORTED');
    assert.equal(sync.endpointApi('https://opencode.ai/zen/go/v1/responses', 'go', 'm'), 'openai-responses');
  });

  it('8. no-prefix-guessing: unlisted bases rejected; malformed identity still invalid', () => {
    for (const g of ['go', 'zen']) {
      assert.equal(apiOrError('https://opencode.ai/other/v1/responses', g, 'm'), 'ENDPOINT_UNSUPPORTED');
      assert.equal(apiOrError('https://opencode.ai/v1/responses', g, 'm'), 'ENDPOINT_UNSUPPORTED');
      assert.equal(apiOrError('https://evil.example/inference/v1/responses', g, 'm'), 'ENDPOINT_INVALID');
      assert.equal(apiOrError(ZEN_ALIAS + '/responses?x=1', g, 'm'), 'ENDPOINT_INVALID');
    }
  });

  it('9. docs-authority-restored: alias completions row beats a contrary anthropic hint', (t) => {
    const sources = zenSources({
      roster: ['model-x'],
      models: { 'model-x': catRecord({ id: 'model-x', name: 'X', provider: { npm: '@ai-sdk/anthropic' } }) },
      docs: { 'model-x': ZEN_ALIAS + '/chat/completions' },
    });
    const verdict = sync.classifyProtocolSupport({
      gateway: 'zen', id: 'model-x', docsMap: sources.docs.zen, catalogRecord: sources.catalog.zen.models['model-x'],
    });
    assert.deepEqual(verdict, { status: 'SUPPORTED', api: 'openai-completions' }, 'S1, not S2');
    const plan = sync.buildPlan({ settingsPath: scratchSettingsFile(t, emptyCurrent()), sources });
    assert.equal(plan.state, 'READY', JSON.stringify(plan.blockedReasons));
    assert.deepEqual(routeOf(plan.desired, 'model-x'), ['opencode-completions']);
  });

  it('10. alias-inert-emission: no documented alias base is ever emitted', (t) => {
    const sources = zenSources({
      roster: ['m-c', 'm-m', 'm-r'],
      models: {
        'm-c': catRecord({ id: 'm-c', name: 'C' }),
        'm-m': catRecord({ id: 'm-m', name: 'M' }),
        'm-r': catRecord({ id: 'm-r', name: 'R' }),
      },
      docs: {
        'm-c': ZEN_ALIAS + '/chat/completions',
        'm-m': ZEN_ALIAS + '/messages',
        'm-r': ZEN_ALIAS + '/responses',
      },
    });
    const plan = sync.buildPlan({ settingsPath: scratchSettingsFile(t, emptyCurrent()), sources });
    assert.equal(plan.state, 'READY', JSON.stringify(plan.blockedReasons));
    assert.deepEqual(routeOf(plan.desired, 'm-c'), ['opencode-completions']);
    assert.deepEqual(routeOf(plan.desired, 'm-m'), ['opencode-messages']);
    assert.deepEqual(routeOf(plan.desired, 'm-r'), ['opencode']);
    const emitted = JSON.stringify(sync.buildNewConfig(emptyCurrent(), plan.desired));
    assert.ok(!emitted.includes('/inference'), 'alias base never written to settings');
  });

  it('11. unknown-tail-no-hint-skipped under alias (U1, endpoint preserved)', (t) => {
    const endpoint = ZEN_ALIAS + '/future-protocol-9';
    const sources = zenSources({
      roster: ['model-z', 'odd'],
      models: {
        'model-z': catRecord({ id: 'model-z', name: 'Z', provider: { npm: '@ai-sdk/openai' } }),
        odd: { id: 'odd', name: 'Odd', modalities: { input: ['text'] }, limit: { context: 1 }, reasoning: false },
      },
      docs: { 'model-z': ZEN_ALIAS + '/responses', odd: endpoint },
    });
    const plan = sync.buildPlan({ settingsPath: scratchSettingsFile(t, emptyCurrent()), sources });
    assert.equal(plan.state, 'READY', JSON.stringify(plan.blockedReasons));
    assert.deepEqual(plan.unsupportedSkipped, [{ gateway: 'zen', id: 'odd', reason: 'UNSUPPORTED_PROTOCOL', endpoint }]);
    assert.deepEqual(routeOf(plan.desired, 'odd'), []);
    assert.deepEqual(routeOf(plan.desired, 'model-z'), ['opencode']);
  });

  it('12. drift-report: live IDs only, aggregated per base, never throws', () => {
    assert.equal(typeof sync.endpointBaseDrift, 'function', 'endpointBaseDrift must exist');
    const drift = sync.endpointBaseDrift({
      rosters: { go: ['g1'], zen: ['a', 'b', 'c', 'bad', 'canon'] },
      docs: {
        go: { g1: 'https://opencode.ai/zen/go/v1/chat/completions', 'go-docs-only': ZEN_ALIAS + '/responses' },
        zen: {
          a: ZEN_ALIAS + '/responses',
          b: ZEN_ALIAS + '/models/b',
          c: ZEN_ALIAS + '/future-protocol-9',
          bad: 'not a url',
          canon: 'https://opencode.ai/zen/v1/messages',
          'docs-only': ZEN_ALIAS + '/messages',
        },
      },
    });
    assert.deepEqual(drift, [
      { gateway: 'zen', documentedBase: ZEN_ALIAS, routedBase: 'https://opencode.ai/zen/v1', models: 3 },
    ]);
    assert.deepEqual(sync.endpointBaseDrift({ rosters: { go: [], zen: [] }, docs: {} }), []);
    assert.deepEqual(sync.endpointBaseDrift({}), []);
  });

  it('13. drift-propagation-and-report: exposed, rendered, non-blocking', (t) => {
    const sources = zenSources({
      roster: ['model-z'],
      models: { 'model-z': catRecord({ id: 'model-z', name: 'Z', provider: { npm: '@ai-sdk/openai' } }) },
      docs: { 'model-z': ZEN_ALIAS + '/responses' },
    });
    const expected = [{ gateway: 'zen', documentedBase: ZEN_ALIAS, routedBase: 'https://opencode.ai/zen/v1', models: 1 }];
    const plan = sync.buildPlan({ settingsPath: scratchSettingsFile(t, emptyCurrent()), sources });
    assert.equal(plan.state, 'READY', 'drift never blocks');
    assert.deepEqual(plan.endpointBaseDrift, expected);
    const outcome = sync.syncFromSources({ settingsPath: scratchSettingsFile(t, emptyCurrent()), sources });
    assert.equal(outcome.result, 'UPDATED');
    assert.deepEqual(outcome.endpointBaseDrift, expected);
    const again = sync.syncFromSources({ settingsPath: scratchSettingsFile(t, sync.buildNewConfig(emptyCurrent(), plan.desired)), sources });
    assert.equal(again.result, 'NO CHANGE');
    assert.deepEqual(again.endpointBaseDrift, expected);
    const text = sync.formatReport({ result: 'UPDATED', endpointBaseDrift: expected });
    const lines = text.split('\n');
    const at = lines.indexOf('ENDPOINT_BASE_DRIFT (1):');
    assert.ok(at > lines.findIndex((l) => l.startsWith('FREE_COUNTERPART_FALLBACK (')), 'section after FREE_COUNTERPART_FALLBACK');
    assert.equal(lines[at + 1], '  - zen documented=' + ZEN_ALIAS + ' routed=https://opencode.ai/zen/v1 models=1');
    const empty = sync.formatReport({ result: 'NO CHANGE' }).split('\n');
    assert.equal(empty[empty.indexOf('ENDPOINT_BASE_DRIFT (0):') + 1], '  (none)');
    const blocked = sync.buildPlan({ settingsPath: scratchSettingsFile(t, emptyCurrent()), sources: {} });
    assert.equal(blocked.state, 'BLOCKED');
    assert.deepEqual(blocked.endpointBaseDrift, []);
  });

  it('14. captured-fixture-matrix: 2026-10-12 docs classify without base failures', () => {
    const tally = (gateway, html) => {
      const map = sync.parseDocs(html, gateway);
      const counts = {};
      for (const [id, endpoint] of Object.entries(map)) {
        const k = apiOrError(endpoint, gateway, id);
        counts[k] = (counts[k] || 0) + 1;
      }
      return { total: Object.keys(map).length, counts };
    };
    const go = tally('go', goDocsHtml());
    assert.equal(go.total, 32);
    assert.deepEqual(go.counts, { 'openai-completions': 20, 'anthropic-messages': 6, 'openai-responses': 6 });
    const zen = tally('zen', zenDocsHtml());
    assert.equal(zen.total, 88);
    assert.deepEqual(zen.counts, {
      'openai-completions': 29,
      'anthropic-messages': 19,
      'openai-responses': 31,
      'unsupported-google': 7,
      ENDPOINT_UNSUPPORTED: 2,
    });
    const goMap = sync.parseDocs(goDocsHtml(), 'go');
    const zenMap = sync.parseDocs(zenDocsHtml(), 'zen');
    const drift = sync.endpointBaseDrift({ rosters: { go: Object.keys(goMap), zen: Object.keys(zenMap) }, docs: { go: goMap, zen: zenMap } });
    assert.deepEqual(drift, [{ gateway: 'zen', documentedBase: ZEN_ALIAS, routedBase: 'https://opencode.ai/zen/v1', models: 88 }]);
  });
});
