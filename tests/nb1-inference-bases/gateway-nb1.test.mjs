// OCMS-S NB1: new inference bases (go + zen docs move, captured 2026-10-15).
// RED-first gate: fails against the pre-NB1 known-base table, passes after the
// table is extended. Fixture bytes only; no live network. Scratch settings only.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import * as sync from '../../sync.mjs';
import { goDocsHtml, zenDocsHtml, FIXTURE_META } from './helpers.mjs';
import { scratchSettingsFile, emptyCurrent, catRecord, validSources } from '../v1.3/helpers.mjs';

const GO_OPENAI = '/inference/go/openai/v1/';
const GO_ANTHROPIC = '/inference/go/anthropic/v1/';
const GO_GOOGLE = '/inference/go/google/v1beta/';
const ZEN_OPENAI = '/inference/openai/v1/';
const ZEN_ANTHROPIC = '/inference/anthropic/v1/';
const ZEN_GOOGLE = '/inference/google/v1beta/';
const ZEN_SYSTEMONE = '/inference/systemone/v1/';

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

function sourcesFromDocs({ goMap, zenMap }) {
  const modelsFor = (map) => {
    const models = {};
    for (const id of Object.keys(map)) {
      const tail = new URL(map[id]).pathname.split('/').pop();
      models[id] = catRecord({ id, name: id, provider: { npm: hintForTail(tail) } });
    }
    return models;
  };
  return {
    rosters: { go: Object.keys(goMap), zen: Object.keys(zenMap) },
    catalog: {
      go: { npm: '@ai-sdk/openai-compatible', models: modelsFor(goMap) },
      zen: { npm: '@ai-sdk/openai', models: modelsFor(zenMap) },
    },
    docs: { go: goMap, zen: zenMap },
  };
}

describe('NB1 new inference bases', () => {
  it('N0 fixtures are the recorded 2026-10-15 captures', () => {
    assert.equal(FIXTURE_META.go.url, 'https://opencode.ai/v2/docs/console/go/');
    assert.equal(FIXTURE_META.zen.url, 'https://opencode.ai/v2/docs/console/models/');
    const goBytes = Buffer.from(goDocsHtml(), 'utf8');
    const zenBytes = Buffer.from(zenDocsHtml(), 'utf8');
    assert.equal(crypto.createHash('sha256').update(goBytes).digest('hex'), FIXTURE_META.go.sha256);
    assert.equal(crypto.createHash('sha256').update(zenBytes).digest('hex'), FIXTURE_META.zen.sha256);
    assert.equal(Object.keys(sync.parseDocs(goDocsHtml(), 'go')).length, FIXTURE_META.go.rows);
    assert.equal(Object.keys(sync.parseDocs(zenDocsHtml(), 'zen')).length, FIXTURE_META.zen.rows);
  });

  it('N1 table lists exactly the observed bases, closed and disjoint', () => {
    const bases = sync.DOC_ENDPOINT_BASES;
    assert.ok(Object.isFrozen(bases) && Object.isFrozen(bases.go) && Object.isFrozen(bases.zen));
    assert.deepEqual([...bases.go], ['/zen/go/v1/', '/inference/go/v1/', GO_OPENAI, GO_ANTHROPIC, GO_GOOGLE]);
    assert.deepEqual([...bases.zen], ['/zen/v1/', '/inference/v1/', ZEN_OPENAI, ZEN_ANTHROPIC, ZEN_GOOGLE, ZEN_SYSTEMONE]);
    for (const g of ['go', 'zen']) {
      const canonical = new URL(sync.routeBaseURL(g, 'openai-completions')).pathname + '/';
      assert.equal(bases[g][0], canonical, g + ' canonical doc base matches the routed base');
    }
    for (const a of bases.go) for (const b of bases.zen) {
      assert.ok(!a.startsWith(b) && !b.startsWith(a), 'I-DISJOINT ' + a + ' vs ' + b);
    }
  });

  it('N2a go openai base maps chat and responses', () => {
    assert.equal(sync.endpointApi('https://opencode.ai' + GO_OPENAI + 'chat/completions', 'go', 'm'), 'openai-completions');
    assert.equal(sync.endpointApi('https://opencode.ai' + GO_OPENAI + 'responses', 'go', 'm'), 'openai-responses');
  });

  it('N2b go anthropic base maps messages', () => {
    assert.equal(sync.endpointApi('https://opencode.ai' + GO_ANTHROPIC + 'messages', 'go', 'm'), 'anthropic-messages');
  });

  it('N2c go google base maps models/{id} to unsupported-google', () => {
    assert.equal(sync.endpointApi('https://opencode.ai' + GO_GOOGLE + 'models/gem-x', 'go', 'gem-x'), 'unsupported-google');
    assert.equal(apiOrError('https://opencode.ai' + GO_GOOGLE + 'models/other', 'go', 'gem-x'), 'ENDPOINT_UNSUPPORTED');
  });

  it('N2d zen openai base maps chat and responses', () => {
    assert.equal(sync.endpointApi('https://opencode.ai' + ZEN_OPENAI + 'chat/completions', 'zen', 'm'), 'openai-completions');
    assert.equal(sync.endpointApi('https://opencode.ai' + ZEN_OPENAI + 'responses', 'zen', 'm'), 'openai-responses');
  });

  it('N2e zen anthropic base maps messages', () => {
    assert.equal(sync.endpointApi('https://opencode.ai' + ZEN_ANTHROPIC + 'messages', 'zen', 'm'), 'anthropic-messages');
  });

  it('N2f zen google base maps models/{id} to unsupported-google', () => {
    assert.equal(sync.endpointApi('https://opencode.ai' + ZEN_GOOGLE + 'models/gem-x', 'zen', 'gem-x'), 'unsupported-google');
    assert.equal(apiOrError('https://opencode.ai' + ZEN_GOOGLE + 'models/other', 'zen', 'gem-x'), 'ENDPOINT_UNSUPPORTED');
  });

  it('N2g zen systemone base is recognized but unsupported (no managed api)', () => {
    assert.equal(apiOrError('https://opencode.ai' + ZEN_SYSTEMONE + 'systemone', 'zen', 'jev-1.13'), 'ENDPOINT_UNSUPPORTED');
  });

  it('N3 negative controls stay refused', () => {
    for (const g of ['go', 'zen']) {
      assert.equal(apiOrError('https://opencode.ai/future/v9/chat/completions', g, 'm'), 'ENDPOINT_BASE_UNKNOWN');
      assert.equal(apiOrError('https://opencode.ai/other/v1/responses', g, 'm'), 'ENDPOINT_BASE_UNKNOWN');
    }
    assert.equal(apiOrError('https://opencode.ai/inference/v1/responses', 'go', 'm'), 'ENDPOINT_BASE_UNKNOWN');
    assert.equal(apiOrError('https://opencode.ai/inference/go/v1/responses', 'zen', 'm'), 'ENDPOINT_BASE_UNKNOWN');
    assert.equal(apiOrError('https://opencode.ai/inference/openai/v1/chat/completions', 'go', 'm'), 'ENDPOINT_BASE_UNKNOWN');
    assert.equal(apiOrError('https://opencode.ai/inference/go/openai/v1/chat/completions', 'zen', 'm'), 'ENDPOINT_BASE_UNKNOWN');
    assert.equal(apiOrError('https://opencode.ai/zen/v1/responses', 'go', 'm'), 'ENDPOINT_BASE_UNKNOWN');
    assert.equal(apiOrError('https://opencode.ai/zen/go/v1/responses', 'zen', 'm'), 'ENDPOINT_BASE_UNKNOWN');
    assert.equal(fullApiOrError('https://opencode.ai/future/v9/chat/completions', 'go', 'kimi-k3'), 'ENDPOINT_BASE_UNKNOWN: go/kimi-k3 https://opencode.ai/future/v9/chat/completions');
  });

  it('N4 unknown tail on a known new base stays unsupported, malformed stays invalid', () => {
    assert.equal(apiOrError('https://opencode.ai' + ZEN_OPENAI + 'future-protocol-9', 'zen', 'm'), 'ENDPOINT_UNSUPPORTED');
    assert.equal(apiOrError('https://opencode.ai' + GO_OPENAI + 'future-protocol-9', 'go', 'm'), 'ENDPOINT_UNSUPPORTED');
    assert.equal(apiOrError('https://opencode.ai' + ZEN_OPENAI + 'responses?x=1', 'zen', 'm'), 'ENDPOINT_INVALID');
  });

  it('N5 fixture end-to-end preview: zero ENDPOINT_BASE_UNKNOWN, nothing applied', (t) => {
    const goMap = sync.parseDocs(goDocsHtml(), 'go');
    const zenMap = sync.parseDocs(zenDocsHtml(), 'zen');
    let baseUnknown = 0;
    const perApi = {};
    const unsupported = [];
    for (const [gateway, map] of [['go', goMap], ['zen', zenMap]]) {
      for (const [id, endpoint] of Object.entries(map)) {
        try {
          const api = sync.endpointApi(endpoint, gateway, id);
          perApi[api] = (perApi[api] || 0) + 1;
        } catch (err) {
          const msg = String((err && err.message) || err);
          if (msg.startsWith('ENDPOINT_BASE_UNKNOWN')) baseUnknown += 1;
          else if (msg.startsWith('ENDPOINT_UNSUPPORTED')) unsupported.push(gateway + '/' + id);
          else throw err;
        }
      }
    }
    assert.equal(baseUnknown, 0, 'zero ENDPOINT_BASE_UNKNOWN over the captured docs');
    assert.deepEqual(perApi, { 'openai-completions': 47, 'anthropic-messages': 25, 'openai-responses': 37, 'unsupported-google': 9 });
    assert.deepEqual(unsupported.sort(), ['zen/jev-1.13', 'zen/jev-1.13-free']);
    const sources = sourcesFromDocs({ goMap, zenMap });
    const planned = sync.planDesired({ rosters: sources.rosters, catalog: sources.catalog, docs: sources.docs, current: emptyCurrent() });
    assert.equal(planned.ok, true, 'captured-docs plan must resolve, got ' + JSON.stringify(planned.unresolved));
    const settingsPath = scratchSettingsFile(t, emptyCurrent());
    const plan = sync.buildPlan({ settingsPath, sources });
    assert.equal(plan.state, 'READY', JSON.stringify(plan.blockedReasons));
    assert.deepEqual(plan.unsupportedSkipped.map((s) => s.gateway + '/' + s.id).sort(), ['zen/jev-1.13', 'zen/jev-1.13-free']);
  });
});
