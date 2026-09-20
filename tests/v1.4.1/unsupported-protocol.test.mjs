// OCMS-S v1.4.1 tests: UNSUPPORTED UPSTREAM PROTOCOL CONTAINMENT.
// Test-first gate: written before implementation against the frozen contract
// v1.4.1 (see tests/v1.4.1/helpers.mjs freeze anchor). Scratch settings only;
// production settings are never touched; no live network.
// Frozen test identities (§12): 13 behavioral tests + 1 freeze pin.
import { describe, it } from 'node:test';
import * as sync from '../../sync.mjs';
import {
  assert,
  scratchSettingsFile,
  emptyCurrent,
  validSources,
  FROZEN_CONTRACT_FILE,
  FROZEN_CONTRACT_SHA256,
  FROZEN_CONTRACT_LINES,
  frozenContractBytes,
  sha256HexBytes,
  countTextLines,
  UNSUPPORTED_DOCS_URL,
  UNKNOWN_DOCS_URL,
  UNKNOWN_NPM,
  missingOutputRecord,
  completeRecord,
} from './helpers.mjs';

function baseSources() {
  return validSources();
}

function withZen(sources, { roster, models, docs }) {
  return {
    rosters: { go: sources.rosters.go, zen: roster },
    catalog: {
      go: sources.catalog.go,
      zen: { npm: '@ai-sdk/openai-compatible', models },
    },
    docs: { go: sources.docs.go, zen: docs },
  };
}

function desiredIds(desired) {
  const ids = [];
  for (const route of sync.MANAGED_ROUTE_KEYS) {
    for (const record of desired[route] || []) ids.push(route + ':' + record.id);
  }
  return ids.sort();
}

describe('v1.4.1 unsupported-protocol containment', () => {
  it('contract v1.4.1 freeze anchor is intact', () => {
    const bytes = frozenContractBytes();
    assert.equal(sha256HexBytes(bytes), FROZEN_CONTRACT_SHA256, 'contract SHA-256 must match the frozen value');
    assert.equal(countTextLines(bytes), FROZEN_CONTRACT_LINES, 'contract line count must match the frozen value');
    assert.ok(FROZEN_CONTRACT_FILE.length > 0);
  });

  it('unsupported model with missing metadata is skipped without blocking', (t) => {
    assert.equal(typeof sync.classifyProtocolSupport, 'function', 'classifyProtocolSupport seam must exist');
    const sources = withZen(baseSources(), {
      roster: ['model-z', 'jevlike'],
      models: {
        'model-z': completeRecord('model-z', { provider: { npm: '@ai-sdk/openai' } }),
        jevlike: missingOutputRecord('jevlike'),
      },
      docs: {
        'model-z': 'https://opencode.ai/zen/v1/responses',
        jevlike: UNSUPPORTED_DOCS_URL,
      },
    });
    const verdict = sync.classifyProtocolSupport({
      gateway: 'zen',
      id: 'jevlike',
      docsMap: sources.docs.zen,
      catalogRecord: sources.catalog.zen.models.jevlike,
    });
    assert.equal(verdict.status, 'UNSUPPORTED');
    const settingsPath = scratchSettingsFile(t, emptyCurrent());
    const plan = sync.buildPlan({ settingsPath, sources });
    assert.equal(plan.state, 'READY', 'unsupported skip must not block, got ' + JSON.stringify(plan.blockedReasons));
    const entry = plan.dispositions.find((d) => d.gateway === 'zen' && d.id === 'jevlike');
    assert.equal(entry && entry.disposition, 'SKIPPED_UNSUPPORTED_PROTOCOL');
    assert.equal(entry.reason, 'UNSUPPORTED_PROTOCOL');
    assert.equal(entry.endpoint, UNSUPPORTED_DOCS_URL);
    assert.ok(!desiredIds(plan.desired).some((x) => x.endsWith(':jevlike')), 'skipped model must be absent from all managed arrays');
  });

  it('unsupported model with complete metadata is still skipped', (t) => {
    const sources = withZen(baseSources(), {
      roster: ['model-z', 'jevlike'],
      models: {
        'model-z': completeRecord('model-z', { provider: { npm: '@ai-sdk/openai' } }),
        jevlike: completeRecord('jevlike'),
      },
      docs: {
        'model-z': 'https://opencode.ai/zen/v1/responses',
        jevlike: UNSUPPORTED_DOCS_URL,
      },
    });
    const settingsPath = scratchSettingsFile(t, emptyCurrent());
    const plan = sync.buildPlan({ settingsPath, sources });
    assert.equal(plan.state, 'READY', 'complete-metadata unsupported model must still not block');
    const entry = plan.dispositions.find((d) => d.gateway === 'zen' && d.id === 'jevlike');
    assert.equal(entry && entry.disposition, 'SKIPPED_UNSUPPORTED_PROTOCOL');
    assert.ok(!desiredIds(plan.desired).some((x) => x.endsWith(':jevlike')));
  });

  it('supported chat/completions model missing limit.output still blocks', (t) => {
    const sources = withZen(baseSources(), {
      roster: ['model-z'],
      models: { 'model-z': missingOutputRecord('model-z') },
      docs: { 'model-z': 'https://opencode.ai/zen/v1/chat/completions' },
    });
    const plan = sync.buildPlan({ settingsPath: scratchSettingsFile(t, emptyCurrent()), sources });
    assert.equal(plan.state, 'BLOCKED');
    assert.ok(plan.blockedReasons.some((b) => String(b.reason).includes('MODEL_INVALID') && String(b.reason).includes('limit.output')));
  });

  it('supported messages model missing limit.output still blocks', (t) => {
    const sources = withZen(baseSources(), {
      roster: ['model-z'],
      models: { 'model-z': missingOutputRecord('model-z') },
      docs: { 'model-z': 'https://opencode.ai/zen/v1/messages' },
    });
    const plan = sync.buildPlan({ settingsPath: scratchSettingsFile(t, emptyCurrent()), sources });
    assert.equal(plan.state, 'BLOCKED');
    assert.ok(plan.blockedReasons.some((b) => String(b.reason).includes('MODEL_INVALID') && String(b.reason).includes('limit.output')));
  });

  it('supported responses model missing limit.output still blocks', (t) => {
    const sources = withZen(baseSources(), {
      roster: ['model-z'],
      models: { 'model-z': missingOutputRecord('model-z') },
      docs: { 'model-z': 'https://opencode.ai/zen/v1/responses' },
    });
    const plan = sync.buildPlan({ settingsPath: scratchSettingsFile(t, emptyCurrent()), sources });
    assert.equal(plan.state, 'BLOCKED');
    assert.ok(plan.blockedReasons.some((b) => String(b.reason).includes('MODEL_INVALID') && String(b.reason).includes('limit.output')));
  });

  it('malformed docs endpoint blocks and is never skipped as unsupported', (t) => {
    const sources = withZen(baseSources(), {
      roster: ['model-z'],
      models: { 'model-z': completeRecord('model-z') },
      docs: { 'model-z': 'https://opencode.ai/zen/v1/chat/completions?x=1' },
    });
    const verdict = sync.classifyProtocolSupport({
      gateway: 'zen',
      id: 'model-z',
      docsMap: sources.docs.zen,
      catalogRecord: sources.catalog.zen.models['model-z'],
    });
    assert.equal(verdict.status, 'UNRESOLVED', 'malformed docs must not classify as unsupported');
    const plan = sync.buildPlan({ settingsPath: scratchSettingsFile(t, emptyCurrent()), sources });
    assert.equal(plan.state, 'BLOCKED');
    assert.ok(plan.blockedReasons.some((b) => String(b.reason).includes('ENDPOINT_INVALID')));
    assert.ok(!(plan.dispositions || []).some((d) => d.disposition === 'SKIPPED_UNSUPPORTED_PROTOCOL'));
  });

  it('well-formed unrecognized docs with supported nested hint keeps v1.4 fallback', (t) => {
    const sources = withZen(baseSources(), {
      roster: ['model-z'],
      models: { 'model-z': completeRecord('model-z', { provider: { npm: '@ai-sdk/openai' } }) },
      docs: { 'model-z': UNKNOWN_DOCS_URL },
    });
    const plan = sync.buildPlan({ settingsPath: scratchSettingsFile(t, emptyCurrent()), sources });
    assert.equal(plan.state, 'READY', 'v1.4 nested-hint fallback must be preserved, got ' + JSON.stringify(plan.blockedReasons));
    const entry = plan.dispositions.find((d) => d.gateway === 'zen' && d.id === 'model-z');
    assert.equal(entry && entry.disposition, 'RESOLVED');
    assert.equal(entry.route, 'opencode');
  });

  it('unknown endpoint with unknown or missing hint is skipped as unsupported', (t) => {
    for (const [id, record] of [
      ['model-u1', completeRecord('model-u1', { provider: { npm: UNKNOWN_NPM } })],
      ['model-u2', completeRecord('model-u2')],
    ]) {
      const sources = withZen(baseSources(), {
        roster: ['model-z', id],
        models: {
          'model-z': completeRecord('model-z', { provider: { npm: '@ai-sdk/openai' } }),
          [id]: record,
        },
        docs: {
          'model-z': 'https://opencode.ai/zen/v1/responses',
          [id]: UNKNOWN_DOCS_URL,
        },
      });
      const plan = sync.buildPlan({ settingsPath: scratchSettingsFile(t, emptyCurrent()), sources });
      assert.equal(plan.state, 'READY', id + ' must not block, got ' + JSON.stringify(plan.blockedReasons));
      const entry = plan.dispositions.find((d) => d.gateway === 'zen' && d.id === id);
      assert.equal(entry && entry.disposition, 'SKIPPED_UNSUPPORTED_PROTOCOL', id + ' must be skipped as unsupported');
      assert.ok(!desiredIds(plan.desired).some((x) => x.endsWith(':' + id)));
    }
  });

  it('unsupported free model with unsupported counterpart stays skipped without fallback', (t) => {
    const sources = withZen(baseSources(), {
      roster: ['model-z', 'jevlike', 'jevlike-free'],
      models: {
        'model-z': completeRecord('model-z', { provider: { npm: '@ai-sdk/openai' } }),
        jevlike: missingOutputRecord('jevlike'),
        'jevlike-free': missingOutputRecord('jevlike-free'),
      },
      docs: {
        'model-z': 'https://opencode.ai/zen/v1/responses',
        jevlike: UNSUPPORTED_DOCS_URL,
        'jevlike-free': UNSUPPORTED_DOCS_URL,
      },
    });
    const plan = sync.buildPlan({ settingsPath: scratchSettingsFile(t, emptyCurrent()), sources });
    assert.equal(plan.state, 'READY', 'unsupported free pair must not block, got ' + JSON.stringify(plan.blockedReasons));
    for (const id of ['jevlike', 'jevlike-free']) {
      const entry = plan.dispositions.find((d) => d.gateway === 'zen' && d.id === id);
      assert.equal(entry && entry.disposition, 'SKIPPED_UNSUPPORTED_PROTOCOL', id + ' must stay skipped');
    }
    assert.deepEqual(plan.fallbackResolved, [], 'no FREE_COUNTERPART_FALLBACK across unsupported protocols');
    assert.ok(!desiredIds(plan.desired).some((x) => x.endsWith(':jevlike-free')));
  });

  it('unsupported skip coexists with normal supported-model addition', (t) => {
    const sources = withZen(baseSources(), {
      roster: ['model-z', 'model-new', 'jevlike'],
      models: {
        'model-z': completeRecord('model-z', { provider: { npm: '@ai-sdk/openai' } }),
        'model-new': completeRecord('model-new'),
        jevlike: missingOutputRecord('jevlike'),
      },
      docs: {
        'model-z': 'https://opencode.ai/zen/v1/responses',
        'model-new': 'https://opencode.ai/zen/v1/responses',
        jevlike: UNSUPPORTED_DOCS_URL,
      },
    });
    const plan = sync.buildPlan({ settingsPath: scratchSettingsFile(t, emptyCurrent()), sources });
    assert.equal(plan.state, 'READY', 'coexistence must not block, got ' + JSON.stringify(plan.blockedReasons));
    const ids = desiredIds(plan.desired);
    assert.ok(ids.includes('opencode:model-new'), 'supported model must be added normally, got ' + JSON.stringify(ids));
    assert.ok(!ids.some((x) => x.endsWith(':jevlike')));
  });

  it('membership accepts intentional unsupported skip but rejects unrelated omission', () => {
    const sources = validSources();
    const plan = sync.planDesired({
      rosters: sources.rosters,
      catalog: sources.catalog,
      docs: sources.docs,
      current: emptyCurrent(),
    });
    assert.equal(plan.ok, true);
    const extraRoster = { go: [...sources.rosters.go], zen: [...sources.rosters.zen, 'jevlike'] };
    sync.checkMembership(plan.desired, extraRoster, { go: [], zen: ['jevlike'] });
    assert.throws(
      () => sync.checkMembership(plan.desired, extraRoster, { go: [], zen: [] }),
      /MEMBERSHIP_MISMATCH/,
      'unrelated omitted live model must still be rejected',
    );
  });

  it('preview report visibly lists unsupported skips with endpoint and reason', (t) => {
    const sources = withZen(baseSources(), {
      roster: ['model-z', 'jevlike', 'jevlike-free'],
      models: {
        'model-z': completeRecord('model-z', { provider: { npm: '@ai-sdk/openai' } }),
        jevlike: completeRecord('jevlike'),
        'jevlike-free': completeRecord('jevlike-free'),
      },
      docs: {
        'model-z': 'https://opencode.ai/zen/v1/responses',
        jevlike: UNSUPPORTED_DOCS_URL,
        'jevlike-free': UNSUPPORTED_DOCS_URL,
      },
    });
    const settingsPath = scratchSettingsFile(t, emptyCurrent());
    const plan = sync.buildPlan({ settingsPath, sources });
    assert.equal(plan.state, 'READY');
    assert.ok(Array.isArray(plan.unsupportedSkipped), 'buildPlan must expose unsupportedSkipped');
    assert.equal(plan.unsupportedSkipped.length, 2);
    const report = sync.formatReport({
      result: 'PREVIEW',
      added: [],
      removed: [],
      moved: [],
      metadataChanged: [],
      unresolved: [],
      unsupportedSkipped: plan.unsupportedSkipped,
    });
    assert.ok(report.includes('SKIPPED_UNSUPPORTED_PROTOCOL (2):'), 'report must carry the section, got:\n' + report);
    assert.ok(report.includes('zen/jevlike') && report.includes('zen/jevlike-free'));
    assert.ok(report.includes(UNSUPPORTED_DOCS_URL) && report.includes('UNSUPPORTED_PROTOCOL'));
  });

  it('existing prior record for an unsupported live model is removed', (t) => {
    const sources = withZen(baseSources(), {
      roster: ['model-z', 'jevlike'],
      models: {
        'model-z': completeRecord('model-z', { provider: { npm: '@ai-sdk/openai' } }),
        jevlike: missingOutputRecord('jevlike'),
      },
      docs: {
        'model-z': 'https://opencode.ai/zen/v1/responses',
        jevlike: UNSUPPORTED_DOCS_URL,
      },
    });
    const current = {
      'llm-pi-ai': {
        providers: {
          'opencode-completions': {
            displayName: 'opencode-completions',
            api: 'openai-completions',
            baseURL: 'https://opencode.ai/zen/v1',
            apiKeyEnv: 'OPENCODE_API_KEY',
            models: [{ id: 'jevlike', name: 'Old', input: ['text'], contextWindow: 1, maxTokens: 1 }],
          },
        },
      },
    };
    const settingsPath = scratchSettingsFile(t, current);
    const plan = sync.buildPlan({ settingsPath, sources });
    assert.equal(plan.state, 'READY', 'prior-removal must not block, got ' + JSON.stringify(plan.blockedReasons));
    assert.ok(!desiredIds(plan.desired).some((x) => x.endsWith(':jevlike')), 'unsupported prior must be removed from managed arrays');
    assert.ok(
      plan.changes.removed.some((r) => r.key === 'zen/jevlike'),
      'removal must be reported, got ' + JSON.stringify(plan.changes.removed),
    );
    const entry = plan.dispositions.find((d) => d.gateway === 'zen' && d.id === 'jevlike');
    assert.equal(entry && entry.disposition, 'SKIPPED_UNSUPPORTED_PROTOCOL');
  });
});
