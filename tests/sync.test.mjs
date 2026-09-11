// Tests for the simple OpenCode Model Sync script (contract v1.2,
// section 19). Temporary fixture YAML only; production settings are never
// touched here (no production path string appears in this file).
import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import {
  DSH_INPUT_MODALITIES,
  SOURCE_URLS,
  defaultSettingsPath,
  SUPPORTED_EFFORTS,
  buildModelRecord,
  buildNewConfig,
  checkMembership,
  diffDesired,
  endpointApi,
  extractReasoningEfforts,
  fetchSources,
  formatReport,
  normalizeInput,
  parseCatalog,
  parseDocs,
  parseRoster,
  planDesired,
  resolveFreeCounterpartRoute,
  resolvePlacement,
  routeFor,
  resolveSettingsPath,
  runSync,
  syncFromSources,
} from '../sync.mjs';

function catRecord(overrides = {}) {
  return {
    id: 'model-a',
    name: 'Model A',
    modalities: { input: ['text'] },
    limit: { context: 1000, output: 100 },
    reasoning: false,
    ...overrides,
  };
}

function sourcesFor({ goIds, zenIds, goModels, zenModels, goDocs, zenDocs }) {
  return {
    rosters: { go: goIds, zen: zenIds },
    catalog: {
      go: { npm: '@ai-sdk/openai-compatible', models: goModels },
      zen: { npm: '@ai-sdk/openai-compatible', models: zenModels },
    },
    docs: { go: goDocs, zen: zenDocs },
  };
}

// Scratch settings fixture: always a temp file, never production.
function writeTempSettings(config) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocms-s-test-'));
  const file = path.join(dir, 'settings.yaml');
  fs.writeFileSync(file, stringifyYaml(config), 'utf8');
  return file;
}

function emptyCurrent() {
  return { llm: { unrelated: true }, 'llm-pi-ai': { providers: {} } };
}

describe('docs parsing + roster/catalog shapes', () => {
  it('parses roster list responses', () => {
    assert.deepEqual(parseRoster(JSON.stringify({ object: 'list', data: [{ id: 'a' }, { id: 'b' }] }), 'go'), ['a', 'b']);
  });

  it('parses the endpoint table by exact Model ID / Endpoint headers', () => {
    const html = '<table><thead><tr><th>Model</th><th>Model ID</th><th>Endpoint</th><th>AI SDK Package</th></tr></thead>' +
      '<tbody><tr><td>M</td><td>model-a</td><td>https://opencode.ai/zen/go/v1/chat/completions</td><td>@ai-sdk/openai-compatible</td></tr></tbody></table>';
    assert.deepEqual(parseDocs(html, 'go'), { 'model-a': 'https://opencode.ai/zen/go/v1/chat/completions' });
  });

  it('keeps docs-only unsupported endpoint rows inert', () => {
    const html = '<table><tr><th>Model ID</th><th>Endpoint</th></tr>' +
      '<tr><td>live</td><td>https://opencode.ai/zen/go/v1/chat/completions</td></tr>' +
      '<tr><td>docs-only</td><td>https://opencode.ai/zen/go/v1/unknown</td></tr></table>';
    assert.equal(parseDocs(html, 'go')['docs-only'], 'https://opencode.ai/zen/go/v1/unknown');
    assert.equal(resolvePlacement({
      gateway: 'go', id: 'live', docsMap: parseDocs(html, 'go'),
      catalogRecord: catRecord({ provider: { npm: '@ai-sdk/openai-compatible' } }), priors: new Map(),
    }), 'opencode-go');
  });

  it('keeps gateway-level npm for reporting without using it for placement', () => {
    const catalog = parseCatalog(JSON.stringify({
      'opencode-go': { npm: '@ai-sdk/openai', models: { 'model-a': catRecord() } },
      opencode: { npm: '@ai-sdk/anthropic', models: { 'model-z': catRecord({ id: 'model-z', name: 'Z' }) } },
    }));
    assert.equal(catalog.go.npm, '@ai-sdk/openai');
  });
});

describe('1. exact docs placement (docs win over provider.npm)', () => {
  it('routes to the docs endpoint even when the catalog hint disagrees', () => {
    const priors = new Map();
    const route = resolvePlacement({
      gateway: 'go',
      id: 'model-a',
      docsMap: { 'model-a': 'https://opencode.ai/zen/go/v1/chat/completions' },
      catalogRecord: catRecord({ provider: { npm: '@ai-sdk/anthropic' } }),
      priors,
    });
    assert.equal(route, 'opencode-go');
  });

  it('maps /messages and /responses docs rows to the matching routes', () => {
    const priors = new Map();
    assert.equal(
      resolvePlacement({
        gateway: 'zen', id: 'm1',
        docsMap: { m1: 'https://opencode.ai/zen/v1/messages' },
        catalogRecord: catRecord({ provider: { npm: '@ai-sdk/openai-compatible' } }),
        priors,
      }),
      'opencode-messages',
    );
    assert.equal(
      resolvePlacement({
        gateway: 'zen', id: 'm2',
        docsMap: { m2: 'https://opencode.ai/zen/v1/responses' },
        catalogRecord: catRecord({ provider: { npm: '@ai-sdk/openai-compatible' } }),
        priors,
      }),
      'opencode',
    );
  });
});

describe('2. nested provider.npm fallback (exact model hint only)', () => {
  it('uses catalog[gateway].models[id].provider.npm when no docs row exists', () => {
    const priors = new Map();
    assert.equal(
      resolvePlacement({
        gateway: 'go', id: 'model-a', docsMap: {},
        catalogRecord: catRecord({ provider: { npm: '@ai-sdk/openai' } }),
        priors,
      }),
      'opencode-go-responses',
    );
    assert.equal(
      resolvePlacement({
        gateway: 'zen', id: 'model-a', docsMap: {},
        catalogRecord: catRecord({ provider: { npm: '@ai-sdk/openai-compatible' } }),
        priors,
      }),
      'opencode-completions',
    );
  });

  it('does not treat inherited properties as exact docs rows', () => {
    assert.equal(
      resolvePlacement({
        gateway: 'go', id: 'toString', docsMap: {},
        catalogRecord: catRecord({ provider: { npm: '@ai-sdk/openai-compatible' } }),
        priors: new Map(),
      }),
      'opencode-go',
    );
  });

  it('ignores gateway-level npm (per-model hint decides)', () => {
    // No docs row; the per-model hint is anthropic even though the gateway
    // npm elsewhere is @ai-sdk/openai. planDesired must place via the nested
    // hint only.
    const sources = sourcesFor({
      goIds: ['model-a'],
      zenIds: ['model-z'],
      goModels: { 'model-a': catRecord({ provider: { npm: '@ai-sdk/anthropic' } }) },
      zenModels: { 'model-z': catRecord({ id: 'model-z', name: 'Z', provider: { npm: '@ai-sdk/openai' } }) },
      goDocs: {},
      zenDocs: {},
    });
    const plan = planDesired({ ...sources, current: emptyCurrent() });
    assert.equal(plan.ok, true);
    assert.equal(plan.desired['opencode-go-messages'].map((m) => m.id).join(','), 'model-a');
  });
});

describe('3. input modality normalization', () => {
  it('keeps only DSH-supported modalities in OpenCode order', () => {
    assert.deepEqual(DSH_INPUT_MODALITIES, ['text', 'image']);
    assert.deepEqual(normalizeInput(['text']), ['text']);
    assert.deepEqual(normalizeInput(['text', 'image', 'video']), ['text', 'image']);
    assert.deepEqual(normalizeInput(['text', 'image', 'video', 'audio', 'pdf']), ['text', 'image']);
  });

  it('marks models with no supported modality unresolved', () => {
    assert.equal(normalizeInput(['video', 'audio']), null);
    assert.equal(normalizeInput([]), null);
    assert.throws(() => buildModelRecord('go', 'model-a', catRecord({ modalities: { input: ['video'] } })), /INPUT_NOT_PROJECTABLE/);
  });
});

describe('4. reasoning effort extraction regardless of array position', () => {
  it('finds the effort entry wherever it sits', () => {
    const expected = { low: 'low', medium: 'medium', high: 'high' };
    const variants = [
      [{ type: 'effort', values: ['low', 'medium', 'high'] }, { type: 'toggle' }, { type: 'budget_tokens', max: 10 }],
      [{ type: 'toggle' }, { type: 'effort', values: ['low', 'medium', 'high'] }, { type: 'budget_tokens', max: 10 }],
      [{ type: 'toggle' }, { type: 'budget_tokens', max: 10 }, { type: 'effort', values: ['low', 'medium', 'high'] }],
    ];
    for (const options of variants) {
      assert.deepEqual(extractReasoningEfforts(true, options), expected);
    }
  });

  it('omits reasoningEfforts when reasoning:true has no effort option', () => {
    assert.equal(extractReasoningEfforts(true, [{ type: 'toggle' }]), undefined);
    assert.equal(extractReasoningEfforts(true, []), undefined);
    const record = buildModelRecord('go', 'model-a', catRecord({ reasoning: true, reasoning_options: [{ type: 'toggle' }] }));
    assert.ok(!Object.hasOwn(record, 'reasoningEfforts'));
  });

  it('rejects unsupported effort values as unresolved', () => {
    assert.throws(() => extractReasoningEfforts(true, [{ type: 'effort', values: ['low', 'telepathy'] }]), /EFFORT_NOT_PROJECTABLE/);
  });
});

describe('5. none maps to off:none', () => {
  it('maps none to the off key, everything else directly', () => {
    assert.deepEqual(
      extractReasoningEfforts(true, [{ type: 'effort', values: ['none'] }]),
      { off: 'none' },
    );
    assert.throws(
      () => extractReasoningEfforts(true, [{ type: 'effort', values: ['none', 'off'] }]),
      /EFFORT_NOT_PROJECTABLE/,
    );
    assert.deepEqual(
      extractReasoningEfforts(true, [{ type: 'effort', values: ['none', 'low', 'medium', 'high'] }]),
      { off: 'none', low: 'low', medium: 'medium', high: 'high' },
    );
    assert.deepEqual(
      extractReasoningEfforts(true, [{ type: 'effort', values: ['low', 'high', 'max'] }]),
      { low: 'low', high: 'high', max: 'max' },
    );
  });

  it('knows the supported DSH effort keys', () => {
    assert.deepEqual(SUPPORTED_EFFORTS, ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
  });
});

describe('6. reasoning:false becomes reasoningEfforts:false', () => {
  it('projects false directly', () => {
    assert.equal(extractReasoningEfforts(false, [{ type: 'toggle' }]), false);
    assert.equal(extractReasoningEfforts(false, null), false);
    assert.equal(extractReasoningEfforts(false, [{ type: 'effort', values: ['unsupported'] }]), false);
    const record = buildModelRecord('go', 'model-a', catRecord({ reasoning: false }));
    assert.equal(record.reasoningEfforts, false);
  });
});

describe('7. compat survives a route move', () => {
  it('copies compat unchanged to the new route', () => {
    const compat = { engine: 'x', flags: [1, 2] };
    const current = {
      'llm-pi-ai': { providers: {
        'opencode-go': {
          displayName: 'opencode-go',
          api: 'openai-completions',
          baseURL: 'https://opencode.ai/zen/go/v1',
          apiKeyEnv: 'OPENCODE_GO_API_KEY',
          models: [{ id: 'model-x', name: 'Old', input: ['text'], contextWindow: 1, maxTokens: 1, compat }],
        },
      } },
    };
    const sources = sourcesFor({
      goIds: ['model-x'],
      zenIds: ['model-z'],
      goModels: {
        'model-x': {
          id: 'model-x', name: 'New', modalities: { input: ['text'] },
          limit: { context: 2000, output: 200 }, reasoning: false,
          provider: { npm: '@ai-sdk/openai-compatible' },
        },
      },
      zenModels: {
        'model-z': {
          id: 'model-z', name: 'Z', modalities: { input: ['text'] },
          limit: { context: 2000, output: 200 }, reasoning: false,
          provider: { npm: '@ai-sdk/openai' },
        },
      },
      goDocs: { 'model-x': 'https://opencode.ai/zen/go/v1/messages' },
      zenDocs: { 'model-z': 'https://opencode.ai/zen/v1/responses' },
    });
    const plan = planDesired({ ...sources, current });
    assert.equal(plan.ok, true);
    // Docs moved model-x from completions to messages; compat moves with it.
    assert.deepEqual(plan.desired['opencode-go'].map((m) => m.id), []);
    assert.equal(plan.desired['opencode-go-messages'].length, 1);
    assert.deepEqual(plan.desired['opencode-go-messages'][0].compat, compat);
    // All other old metadata is replaced.
    assert.equal(plan.desired['opencode-go-messages'][0].name, 'New');
    const diff = diffDesired(plan.desired, plan.priors);
    assert.equal(diff.moved.length, 1);
    assert.equal(diff.moved[0].from, 'opencode-go');
    assert.equal(diff.moved[0].to, 'opencode-go-messages');
  });
});

describe('8. v1.2 unresolved dispositions do not block resolvable models', () => {
  it('skips a new catalog-missing live model while synchronizing the rest', () => {
    const file = writeTempSettings(emptyCurrent());
    const sources = sourcesFor({
      goIds: ['ghost'],
      zenIds: ['model-z'],
      // Structurally valid (nonempty) Go catalog that simply lacks the live
      // 'ghost' ID: a per-model gap. An empty whole gateway map is
      // source-invalid under the v1.2 empty-catalog source gate.
      goModels: { 'model-a': catRecord() },
      zenModels: {
        'model-z': {
          id: 'model-z', name: 'Z', modalities: { input: ['text'] },
          limit: { context: 10, output: 10 }, reasoning: false,
          provider: { npm: '@ai-sdk/openai' },
        },
      },
      goDocs: {},
      zenDocs: { 'model-z': 'https://opencode.ai/zen/v1/responses' },
    });
    const outcome = syncFromSources({ settingsPath: file, sources });
    assert.equal(outcome.result, 'UPDATED');
    assert.deepEqual(outcome.skippedUnresolved, [{ gateway: 'go', id: 'ghost', reason: 'CATALOG_MISSING' }]);
    assert.deepEqual(outcome.preservedUnresolved, []);
    const providers = parseYaml(fs.readFileSync(file, 'utf8'))['llm-pi-ai'].providers;
    assert.deepEqual(providers['opencode'].models.map((m) => m.id), ['model-z']);
  });

  it('skips a new placement-unresolved live model while synchronizing the rest', () => {
    const file = writeTempSettings(emptyCurrent());
    const sources = sourcesFor({
      goIds: ['model-a'],
      zenIds: ['model-z'],
      // No docs row and no nested hint: placement is unresolvable, but the
      // model is new, so it is skipped instead of refusing the whole run.
      goModels: { 'model-a': catRecord() },
      zenModels: {
        'model-z': {
          id: 'model-z', name: 'Z', modalities: { input: ['text'] },
          limit: { context: 10, output: 10 }, reasoning: false,
          provider: { npm: '@ai-sdk/openai' },
        },
      },
      goDocs: {},
      zenDocs: { 'model-z': 'https://opencode.ai/zen/v1/responses' },
    });
    const outcome = syncFromSources({ settingsPath: file, sources });
    assert.equal(outcome.result, 'UPDATED');
    assert.deepEqual(outcome.skippedUnresolved, [{ gateway: 'go', id: 'model-a', reason: 'PLACEMENT_UNRESOLVED' }]);
    assert.deepEqual(outcome.preservedUnresolved, []);
  });
});

describe('9. generated YAML parses and matches the rosters', () => {
  it('writes parseable YAML whose membership equals the rosters', () => {
    const file = writeTempSettings({
      keepMe: true,
      'llm-pi-ai': { providers: {
        'opencode-go': {
          displayName: 'custom name stays',
          api: 'openai-completions',
          baseURL: 'https://opencode.ai/zen/go/v1',
          apiKeyEnv: 'OPENCODE_GO_API_KEY',
          models: [{ id: 'stale-model', name: 'Stale', input: ['text'], contextWindow: 5, maxTokens: 5 }],
        },
      } },
    });
    const sources = sourcesFor({
      goIds: ['model-a'],
      zenIds: ['model-z'],
      goModels: {
        'model-a': {
          id: 'model-a', name: 'A', modalities: { input: ['text', 'image', 'video'] },
          limit: { context: 100, output: 50 }, reasoning: false,
          provider: { npm: '@ai-sdk/anthropic' },
        },
      },
      zenModels: {
        'model-z': {
          id: 'model-z', name: 'Z', modalities: { input: ['text'] },
          limit: { context: 100, output: 50 }, reasoning: false,
          provider: { npm: '@ai-sdk/openai' },
        },
      },
      goDocs: { 'model-a': 'https://opencode.ai/zen/go/v1/chat/completions' },
      zenDocs: { 'model-z': 'https://opencode.ai/zen/v1/responses' },
    });
    const outcome = syncFromSources({ settingsPath: file, sources });
    assert.equal(outcome.result, 'UPDATED');
    const written = parseYaml(fs.readFileSync(file, 'utf8'));
    // Round-trips through the YAML library and keeps unrelated settings.
    assert.equal(written.keepMe, true);
    assert.equal(written['llm-pi-ai'].providers['opencode-go'].displayName, 'custom name stays');
    // Stale models disappear; arrays are sorted by exact model ID.
    checkMembership(
      Object.fromEntries(
        ['opencode-go', 'opencode-go-messages', 'opencode-go-responses', 'opencode-completions', 'opencode-messages', 'opencode']
          .map((route) => [route, (written['llm-pi-ai'].providers[route] && written['llm-pi-ai'].providers[route].models) || []]),
      ),
      sources.rosters,
    );
    // A second run over the same sources reports NO CHANGE.
    const again = syncFromSources({ settingsPath: file, sources });
    assert.equal(again.result, 'NO CHANGE');
  });

  it('endpointApi validates identity strictly', () => {
    assert.equal(endpointApi('https://opencode.ai/zen/go/v1/chat/completions', 'go', 'x'), 'openai-completions');
    assert.throws(() => endpointApi('http://opencode.ai/zen/go/v1/chat/completions', 'go', 'x'), /ENDPOINT_INVALID/);
    assert.throws(() => endpointApi('https://opencode.ai/zen/v1/chat/completions', 'go', 'x'), /ENDPOINT_UNSUPPORTED/);
    assert.equal(routeFor('go', 'anthropic-messages'), 'opencode-go-messages');
  });
});

describe('10. exact rebuild and malformed configuration refusal', () => {
  function validSources() {
    return sourcesFor({
      goIds: ['model-a'],
      zenIds: ['model-z'],
      goModels: { 'model-a': catRecord({ provider: { npm: '@ai-sdk/openai-compatible' } }) },
      zenModels: { 'model-z': catRecord({ id: 'model-z', name: 'Z', provider: { npm: '@ai-sdk/openai' } }) },
      goDocs: { 'model-a': 'https://opencode.ai/zen/go/v1/chat/completions' },
      zenDocs: { 'model-z': 'https://opencode.ai/zen/v1/responses' },
    });
  }

  it('rewrites duplicate current records', () => {
    const file = writeTempSettings({
      'llm-pi-ai': { providers: {
        'opencode-go': {
          models: [
            { id: 'model-a', name: 'A', input: ['text'], contextWindow: 1000, maxTokens: 100, reasoningEfforts: false },
            { id: 'model-a', name: 'A', input: ['text'], contextWindow: 1000, maxTokens: 100, reasoningEfforts: false },
          ],
        },
      } },
    });
    const outcome = syncFromSources({ settingsPath: file, sources: validSources() });
    assert.equal(outcome.result, 'UPDATED');
    const written = parseYaml(fs.readFileSync(file, 'utf8'));
    assert.deepEqual(written['llm-pi-ai'].providers['opencode-go'].models.map((m) => m.id), ['model-a']);
  });

  it('rewrites current arrays in exact sorted order', () => {
    const sources = validSources();
    sources.rosters.go = ['model-a', 'model-b'];
    sources.catalog.go.models['model-b'] = catRecord({ id: 'model-b', name: 'B', provider: { npm: '@ai-sdk/openai-compatible' } });
    sources.docs.go['model-b'] = 'https://opencode.ai/zen/go/v1/chat/completions';
    const file = writeTempSettings({
      'llm-pi-ai': { providers: {
        'opencode-go': {
          models: [
            { id: 'model-b', name: 'B', input: ['text'], contextWindow: 1000, maxTokens: 100, reasoningEfforts: false },
            { id: 'model-a', name: 'A', input: ['text'], contextWindow: 1000, maxTokens: 100, reasoningEfforts: false },
          ],
        },
      } },
    });
    const outcome = syncFromSources({ settingsPath: file, sources });
    assert.equal(outcome.result, 'UPDATED');
    const written = parseYaml(fs.readFileSync(file, 'utf8'));
    assert.deepEqual(written['llm-pi-ai'].providers['opencode-go'].models.map((m) => m.id), ['model-a', 'model-b']);
  });

  it('removes stale model-local metadata during rebuild', () => {
    const file = writeTempSettings({
      'llm-pi-ai': { providers: {
        'opencode-go': {
          models: [{
            id: 'model-a', name: 'A', input: ['text'], contextWindow: 1000, maxTokens: 100,
            reasoningEfforts: false, legacy: 'stale', thinkingBudgets: { low: 1 },
          }],
        },
      } },
    });
    const outcome = syncFromSources({ settingsPath: file, sources: validSources() });
    assert.equal(outcome.result, 'UPDATED');
    const model = parseYaml(fs.readFileSync(file, 'utf8'))['llm-pi-ai'].providers['opencode-go'].models[0];
    assert.deepEqual(model, { id: 'model-a', name: 'Model A', input: ['text'], contextWindow: 1000, maxTokens: 100, reasoningEfforts: false });
  });

  it('refuses malformed providers without changing settings', () => {
    const file = writeTempSettings({ keep: true, 'llm-pi-ai': { providers: [] } });
    const before = fs.readFileSync(file, 'utf8');
    const outcome = syncFromSources({ settingsPath: file, sources: validSources() });
    assert.equal(outcome.result, 'NOT WRITTEN');
    assert.equal(fs.readFileSync(file, 'utf8'), before);
  });

  it('refuses malformed existing managed routes without changing settings', () => {
    const file = writeTempSettings({ 'llm-pi-ai': { providers: { 'opencode-go': [] } } });
    const before = fs.readFileSync(file, 'utf8');
    const outcome = syncFromSources({ settingsPath: file, sources: validSources() });
    assert.equal(outcome.result, 'NOT WRITTEN');
    assert.equal(fs.readFileSync(file, 'utf8'), before);
  });
});

describe('11. write-boundary source validation', () => {
  function validSources() {
    return sourcesFor({
      goIds: ['model-a'],
      zenIds: ['model-z'],
      goModels: { 'model-a': catRecord({ provider: { npm: '@ai-sdk/openai-compatible' } }) },
      zenModels: { 'model-z': catRecord({ id: 'model-z', name: 'Z', provider: { npm: '@ai-sdk/openai' } }) },
      goDocs: { 'model-a': 'https://opencode.ai/zen/go/v1/chat/completions' },
      zenDocs: { 'model-z': 'https://opencode.ai/zen/v1/responses' },
    });
  }

  it('refuses an empty roster before planning or writing', () => {
    const file = writeTempSettings({ 'llm-pi-ai': { providers: { 'opencode-go': { models: [{ id: 'stale' }] } } } });
    const before = fs.readFileSync(file, 'utf8');
    const sources = validSources();
    sources.rosters.go = [];
    const outcome = syncFromSources({ settingsPath: file, sources });
    assert.equal(outcome.result, 'NOT WRITTEN');
    assert.equal(fs.readFileSync(file, 'utf8'), before);
  });

  it('refuses a source bundle missing a required docs map', () => {
    const file = writeTempSettings({ 'llm-pi-ai': { providers: {} } });
    const before = fs.readFileSync(file, 'utf8');
    const sources = validSources();
    delete sources.docs.go;
    const outcome = syncFromSources({ settingsPath: file, sources });
    assert.equal(outcome.result, 'NOT WRITTEN');
    assert.equal(fs.readFileSync(file, 'utf8'), before);
  });
});

// Contract v1.2 empty-catalog source gate: a required gateway model map must
// be present, a mapping, and nonempty. An empty whole-source catalog map is a
// broken source structure that must refuse the whole run (NOT WRITTEN) — it
// must never soften into per-model CATALOG_MISSING dispositions.
describe('22. v1.2 empty required catalog source gate', () => {
  function assertNoResidue(file) {
    const dir = path.dirname(file);
    assert.equal(fs.readdirSync(dir).filter((f) => f.startsWith('settings.yaml.bak-')).length, 0, 'no backup expected');
    assert.equal(fs.existsSync(file + '.tmp'), false, 'no .tmp residue expected');
  }

  function normalBodies(goModels, zenModels) {
    return {
      [SOURCE_URLS.goRoster]: JSON.stringify({ data: [{ id: 'model-a' }] }),
      [SOURCE_URLS.zenRoster]: JSON.stringify({ data: [{ id: 'model-z' }] }),
      [SOURCE_URLS.catalog]: JSON.stringify({
        'opencode-go': { npm: '@ai-sdk/openai-compatible', models: goModels },
        opencode: { npm: '@ai-sdk/openai', models: zenModels },
      }),
      [SOURCE_URLS.goDocs]: '<table><tr><th>Model ID</th><th>Endpoint</th></tr><tr><td>model-a</td><td>https://opencode.ai/zen/go/v1/chat/completions</td></tr></table>',
      [SOURCE_URLS.zenDocs]: '<table><tr><th>Model ID</th><th>Endpoint</th></tr><tr><td>model-z</td><td>https://opencode.ai/zen/v1/responses</td></tr></table>',
    };
  }

  const validGoModels = { 'model-a': catRecord({ provider: { npm: '@ai-sdk/openai-compatible' } }) };
  const validZenModels = { 'model-z': catRecord({ id: 'model-z', name: 'Z', provider: { npm: '@ai-sdk/openai' } }) };
  const validGoDocs = { 'model-a': 'https://opencode.ai/zen/go/v1/chat/completions' };
  const validZenDocs = { 'model-z': 'https://opencode.ai/zen/v1/responses' };

  it('T1: refuses an empty Go catalog through the normal fetched-source path', async () => {
    const file = writeTempSettings({ keep: true, 'llm-pi-ai': { providers: {} } });
    const before = fs.readFileSync(file);
    const bodies = normalBodies({}, validZenModels);
    const mockedLog = mock.method(console, 'log', () => {});
    let outcome;
    try {
      outcome = await runSync({
        settingsPath: file,
        fetchFn: async (url) => ({ ok: true, status: 200, text: async () => bodies[url] }),
      });
    } finally {
      mockedLog.mock.restore();
    }
    assert.equal(outcome.result, 'NOT WRITTEN');
    assert.match(outcome.report, /CATALOG_INVALID: catalog opencode-go\.models map is empty/);
    // No per-model CATALOG_MISSING softening may continue the write.
    assert.doesNotMatch(outcome.report, /CATALOG_MISSING/);
    assert.doesNotMatch(outcome.report, /preserved unresolved \([1-9]/);
    assert.doesNotMatch(outcome.report, /skipped unresolved \([1-9]/);
    assert.deepEqual(fs.readFileSync(file), before, 'settings bytes unchanged');
    assertNoResidue(file);
  });

  it('T2: refuses an empty Zen catalog through the normal fetched-source path', async () => {
    const file = writeTempSettings({ keep: true, 'llm-pi-ai': { providers: {} } });
    const before = fs.readFileSync(file);
    const bodies = normalBodies(validGoModels, {});
    const mockedLog = mock.method(console, 'log', () => {});
    let outcome;
    try {
      outcome = await runSync({
        settingsPath: file,
        fetchFn: async (url) => ({ ok: true, status: 200, text: async () => bodies[url] }),
      });
    } finally {
      mockedLog.mock.restore();
    }
    assert.equal(outcome.result, 'NOT WRITTEN');
    assert.match(outcome.report, /CATALOG_INVALID: catalog opencode\.models map is empty/);
    assert.doesNotMatch(outcome.report, /CATALOG_MISSING/);
    assert.deepEqual(fs.readFileSync(file), before, 'settings bytes unchanged');
    assertNoResidue(file);
  });

  it('T3: direct bundle validation refuses an empty Go map (validateSourceBundle independently)', () => {
    const file = writeTempSettings({ 'llm-pi-ai': { providers: {} } });
    const before = fs.readFileSync(file);
    const sources = sourcesFor({
      goIds: ['model-a'],
      zenIds: ['model-z'],
      goModels: {},
      zenModels: validZenModels,
      goDocs: validGoDocs,
      zenDocs: validZenDocs,
    });
    const outcome = syncFromSources({ settingsPath: file, sources });
    assert.equal(outcome.result, 'NOT WRITTEN');
    assert.match(outcome.unresolved[0].reason, /SOURCE_INVALID: catalog go\.models is missing or empty/);
    assert.deepEqual(fs.readFileSync(file), before);
    assertNoResidue(file);
  });

  it('T4: direct bundle validation refuses an empty Zen map (validateSourceBundle independently)', () => {
    const file = writeTempSettings({ 'llm-pi-ai': { providers: {} } });
    const before = fs.readFileSync(file);
    const sources = sourcesFor({
      goIds: ['model-a'],
      zenIds: ['model-z'],
      goModels: validGoModels,
      zenModels: {},
      goDocs: validGoDocs,
      zenDocs: validZenDocs,
    });
    const outcome = syncFromSources({ settingsPath: file, sources });
    assert.equal(outcome.result, 'NOT WRITTEN');
    assert.match(outcome.unresolved[0].reason, /SOURCE_INVALID: catalog zen\.models is missing or empty/);
    assert.deepEqual(fs.readFileSync(file), before);
    assertNoResidue(file);
  });

  it('T5: one absent live ID in a nonempty catalog stays a soft per-model gap', () => {
    const file = writeTempSettings(emptyCurrent());
    const sources = sourcesFor({
      goIds: ['ghost', 'model-a'],
      zenIds: ['model-z'],
      goModels: validGoModels,
      zenModels: validZenModels,
      goDocs: validGoDocs,
      zenDocs: validZenDocs,
    });
    const outcome = syncFromSources({ settingsPath: file, sources });
    assert.equal(outcome.result, 'UPDATED');
    assert.deepEqual(outcome.skippedUnresolved, [{ gateway: 'go', id: 'ghost', reason: 'CATALOG_MISSING' }]);
    const providers = parseYaml(fs.readFileSync(file, 'utf8'))['llm-pi-ai'].providers;
    assert.deepEqual(providers['opencode-go'].models.map((m) => m.id), ['model-a']);
  });

  it('T6: a one-record catalog map is accepted as nonempty', () => {
    assert.doesNotThrow(() => parseCatalog(JSON.stringify({
      'opencode-go': { models: { 'only-go': catRecord({ id: 'only-go', name: 'OG' }) } },
      opencode: { models: { 'only-zen': catRecord({ id: 'only-zen', name: 'OZ' }) } },
    })));
    const file = writeTempSettings(emptyCurrent());
    const sources = sourcesFor({
      goIds: ['only-go'],
      zenIds: ['only-zen'],
      goModels: { 'only-go': catRecord({ id: 'only-go', name: 'OG', provider: { npm: '@ai-sdk/openai-compatible' } }) },
      zenModels: { 'only-zen': catRecord({ id: 'only-zen', name: 'OZ', provider: { npm: '@ai-sdk/openai' } }) },
      goDocs: { 'only-go': 'https://opencode.ai/zen/go/v1/chat/completions' },
      zenDocs: { 'only-zen': 'https://opencode.ai/zen/v1/responses' },
    });
    const outcome = syncFromSources({ settingsPath: file, sources });
    assert.equal(outcome.result, 'UPDATED');
  });

  it('adversarial: parseCatalog refuses null/array/missing model maps and a missing provider object', () => {
    const shapes = [null, [], undefined];
    for (const gateway of ['opencode-go', 'opencode']) {
      for (const shape of shapes) {
        const broken = {};
        if (shape !== undefined) broken.models = shape;
        const parsed = {
          'opencode-go': gateway === 'opencode-go' ? broken : { models: { 'model-a': catRecord() } },
          opencode: gateway === 'opencode' ? broken : { models: { 'model-z': catRecord({ id: 'model-z', name: 'Z' }) } },
        };
        assert.throws(() => parseCatalog(JSON.stringify(parsed)), /CATALOG_INVALID/, gateway + ' ' + String(shape));
      }
    }
    // provider object entirely missing
    assert.throws(
      () => parseCatalog(JSON.stringify({ opencode: { models: { 'model-z': catRecord({ id: 'model-z', name: 'Z' }) } } })),
      /CATALOG_INVALID/,
    );
  });

  it('adversarial: syncFromSources refuses every malformed catalog shape on both gateways', () => {
    const shapes = [null, [], undefined, {}];
    for (const gateway of ['go', 'zen']) {
      for (const shape of shapes) {
        const file = writeTempSettings({ 'llm-pi-ai': { providers: {} } });
        const before = fs.readFileSync(file);
        const sources = sourcesFor({
          goIds: ['model-a'],
          zenIds: ['model-z'],
          goModels: gateway === 'go' ? shape : validGoModels,
          zenModels: gateway === 'zen' ? shape : validZenModels,
          goDocs: validGoDocs,
          zenDocs: validZenDocs,
        });
        if (shape === undefined) delete sources.catalog[gateway].models; // provider present, models absent
        const outcome = syncFromSources({ settingsPath: file, sources });
        assert.equal(outcome.result, 'NOT WRITTEN', gateway + ' ' + String(shape));
        assert.match(outcome.unresolved[0].reason, /SOURCE_INVALID/, gateway + ' ' + String(shape));
        assert.deepEqual(fs.readFileSync(file), before);
        assertNoResidue(file);
      }
    }
    // Both gateways empty at once.
    {
      const file = writeTempSettings({ 'llm-pi-ai': { providers: {} } });
      const before = fs.readFileSync(file);
      const sources = sourcesFor({
        goIds: ['model-a'], zenIds: ['model-z'],
        goModels: {}, zenModels: {},
        goDocs: validGoDocs, zenDocs: validZenDocs,
      });
      const outcome = syncFromSources({ settingsPath: file, sources });
      assert.equal(outcome.result, 'NOT WRITTEN');
      assert.match(outcome.unresolved[0].reason, /SOURCE_INVALID/);
      assert.deepEqual(fs.readFileSync(file), before);
      assertNoResidue(file);
    }
    // Provider object missing entirely.
    {
      const file = writeTempSettings({ 'llm-pi-ai': { providers: {} } });
      const before = fs.readFileSync(file);
      const sources = sourcesFor({
        goIds: ['model-a'], zenIds: ['model-z'],
        goModels: validGoModels, zenModels: validZenModels,
        goDocs: validGoDocs, zenDocs: validZenDocs,
      });
      delete sources.catalog.go; // bundle-level gateway key (raw keys are parseCatalog's input)
      const outcome = syncFromSources({ settingsPath: file, sources });
      assert.equal(outcome.result, 'NOT WRITTEN');
      assert.match(outcome.unresolved[0].reason, /SOURCE_INVALID/);
      assert.deepEqual(fs.readFileSync(file), before);
      assertNoResidue(file);
    }
  });
});

describe('12. v1.1 complete-document and compat regressions', () => {
  function validSourcesV11({ goId = 'go-live', zenId = 'zen-live', goDocs = {}, zenDocs = {}, goModel, zenModel } = {}) {
    return sourcesFor({
      goIds: [goId],
      zenIds: [zenId],
      goModels: { [goId]: goModel || catRecord({ id: goId, provider: { npm: '@ai-sdk/openai-compatible' } }) },
      zenModels: { [zenId]: zenModel || catRecord({ id: zenId, name: 'Zen Live', provider: { npm: '@ai-sdk/openai' } }) },
      goDocs: Object.keys(goDocs).length ? goDocs : { [goId]: 'https://opencode.ai/zen/go/v1/chat/completions' },
      zenDocs: Object.keys(zenDocs).length ? zenDocs : { [zenId]: 'https://opencode.ai/zen/v1/responses' },
    });
  }

  it('rebuilds llm-pi-ai.providers, never injects root providers, and preserves unrelated configuration', () => {
    const current = {
      providers: { sentinel: { models: [{ id: 'must-remain-unread' }] } },
      topLevel: { keep: true },
      'llm-pi-ai': {
        keep: 'this field',
        providers: {
          unrelated: { custom: true },
          'opencode-go': { displayName: 'custom', models: [{ id: 'stale' }] },
        },
      },
    };
    const file = writeTempSettings(current);
    const outcome = syncFromSources({ settingsPath: file, sources: validSourcesV11() });
    assert.equal(outcome.result, 'UPDATED');
    const written = parseYaml(fs.readFileSync(file, 'utf8'));
    assert.deepEqual(written.providers, current.providers);
    assert.equal(written.topLevel.keep, true);
    assert.equal(written['llm-pi-ai'].keep, 'this field');
    assert.deepEqual(written['llm-pi-ai'].providers.unrelated, { custom: true });
    assert.deepEqual(written['llm-pi-ai'].providers['opencode-go'].models.map((m) => m.id), ['go-live']);
    assert.deepEqual(written['llm-pi-ai'].providers['opencode'].models.map((m) => m.id), ['zen-live']);
  });

  it('cleans duplicates and wrong routes while preferring compat on the desired route', () => {
    const desiredCompat = { mode: 'desired' };
    const staleCompat = { mode: 'stale' };
    const current = {
      'llm-pi-ai': { providers: {
        'opencode-go': { models: [
          { id: 'go-live', compat: staleCompat },
          { id: 'go-live', compat: { mode: 'other' } },
          { id: 'stale', compat: { mode: 'stale-model' } },
        ] },
        'opencode-go-messages': { models: [
          { id: 'go-live', compat: desiredCompat },
          { id: 'go-live', compat: desiredCompat },
        ] },
      } },
    };
    const file = writeTempSettings(current);
    const sources = validSourcesV11({
      goDocs: { 'go-live': 'https://opencode.ai/zen/go/v1/messages' },
    });
    const outcome = syncFromSources({ settingsPath: file, sources });
    assert.equal(outcome.result, 'UPDATED');
    const providers = parseYaml(fs.readFileSync(file, 'utf8'))['llm-pi-ai'].providers;
    assert.deepEqual(providers['opencode-go'].models, []);
    assert.deepEqual(providers['opencode-go-messages'].models.map((m) => m.id), ['go-live']);
    assert.deepEqual(providers['opencode-go-messages'].models[0].compat, desiredCompat);
  });

  it('carries a unique compat value across a legitimate move', () => {
    const compat = { tokenizer: 'local' };
    const current = { 'llm-pi-ai': { providers: {
      'opencode-go': { models: [{ id: 'go-live', compat }] },
    } } };
    const file = writeTempSettings(current);
    const outcome = syncFromSources({
      settingsPath: file,
      sources: validSourcesV11({ goDocs: { 'go-live': 'https://opencode.ai/zen/go/v1/responses' } }),
    });
    assert.equal(outcome.result, 'UPDATED');
    const providers = parseYaml(fs.readFileSync(file, 'utf8'))['llm-pi-ai'].providers;
    assert.deepEqual(providers['opencode-go-responses'].models[0].compat, compat);
  });

  it('refuses conflicting compat values when no desired-route compat resolves the ambiguity', () => {
    const current = { 'llm-pi-ai': { providers: {
      'opencode-go': { models: [{ id: 'go-live', compat: { value: 'a' } }] },
      'opencode-go-messages': { models: [{ id: 'go-live', compat: { value: 'b' } }] },
    } } };
    const file = writeTempSettings(current);
    const before = fs.readFileSync(file);
    const outcome = syncFromSources({
      settingsPath: file,
      sources: validSourcesV11({ goDocs: { 'go-live': 'https://opencode.ai/zen/go/v1/responses' } }),
    });
    assert.equal(outcome.result, 'NOT WRITTEN');
    assert.match(outcome.unresolved[0].reason, /COMPAT_AMBIGUOUS/);
    assert.deepEqual(fs.readFileSync(file), before);
  });

  it('preserves an existing Google-style route, skips a new one, refuses an ambiguous one', () => {
    const google = { id: 'google-live', name: 'Google Live', modalities: { input: ['text'] },
      limit: { context: 100, output: 20 }, reasoning: false, provider: { npm: '@ai-sdk/google' } };
    const current = { 'llm-pi-ai': { providers: {
      'opencode-go-responses': { models: [{ id: 'google-live', compat: { local: true } }] },
    } } };
    const file = writeTempSettings(current);
    const sources = validSourcesV11({
      goId: 'google-live',
      goModel: google,
      goDocs: { 'google-live': 'https://opencode.ai/zen/go/v1/models/google-live' },
    });
    const preserved = syncFromSources({ settingsPath: file, sources });
    assert.equal(preserved.result, 'UPDATED');
    assert.deepEqual(preserved.preservedUnresolved, [{ gateway: 'go', id: 'google-live', reason: 'UNSUPPORTED_GOOGLE_STYLE', route: 'opencode-go-responses' }]);
    assert.deepEqual(preserved.skippedUnresolved, []);
    const providers = parseYaml(fs.readFileSync(file, 'utf8'))['llm-pi-ai'].providers;
    assert.deepEqual(providers['opencode-go-responses'].models[0].compat, { local: true });
    assert.equal(providers['opencode-go-responses'].models[0].name, 'Google Live');

    const newFile = writeTempSettings(emptyCurrent());
    const newOutcome = syncFromSources({ settingsPath: newFile, sources });
    assert.equal(newOutcome.result, 'UPDATED');
    assert.deepEqual(newOutcome.skippedUnresolved, [{ gateway: 'go', id: 'google-live', reason: 'UNSUPPORTED_GOOGLE_STYLE' }]);
    assert.deepEqual(newOutcome.preservedUnresolved, []);
    const newProviders = parseYaml(fs.readFileSync(newFile, 'utf8'))['llm-pi-ai'].providers;
    assert.deepEqual(newProviders['opencode'].models.map((m) => m.id), ['zen-live']);

    const ambiguousFile = writeTempSettings({ 'llm-pi-ai': { providers: {
      'opencode-go': { models: [{ id: 'google-live' }] },
      'opencode-go-responses': { models: [{ id: 'google-live' }] },
    } } });
    const ambiguousBefore = fs.readFileSync(ambiguousFile);
    const ambiguous = syncFromSources({ settingsPath: ambiguousFile, sources });
    assert.equal(ambiguous.result, 'NOT WRITTEN');
    assert.match(ambiguous.unresolved[0].reason, /PLACEMENT_AMBIGUOUS/);
    assert.deepEqual(fs.readFileSync(ambiguousFile), ambiguousBefore);
  });

  it('rejects a catalog record whose id does not equal the live roster id', () => {
    const file = writeTempSettings(emptyCurrent());
    const before = fs.readFileSync(file);
    const outcome = syncFromSources({
      settingsPath: file,
      sources: validSourcesV11({ goModel: catRecord({ id: 'wrong-id' }) }),
    });
    assert.equal(outcome.result, 'NOT WRITTEN');
    assert.deepEqual(fs.readFileSync(file), before);
  });

  it('does not report NO CHANGE when an existing managed route lacks its models array', () => {
    const file = writeTempSettings({ 'llm-pi-ai': { providers: {
      'opencode-go': { displayName: 'preserve me' },
    } } });
    const outcome = syncFromSources({ settingsPath: file, sources: validSourcesV11({
      goDocs: { 'go-live': 'https://opencode.ai/zen/go/v1/responses' },
      zenDocs: { 'zen-live': 'https://opencode.ai/zen/v1/responses' },
    }) });
    assert.equal(outcome.result, 'UPDATED');
    const written = parseYaml(fs.readFileSync(file, 'utf8'))['llm-pi-ai'].providers;
    assert.deepEqual(written['opencode-go'].models, []);
    assert.equal(written['opencode-go'].displayName, 'preserve me');
  });
});

describe('13. v1.1 source and settings-path regressions', () => {
  it('requires and fetches all five public sources', async () => {
    const html = '<table><tr><th>Model ID</th><th>Endpoint</th></tr><tr><td>x</td><td>https://opencode.ai/zen/go/v1/chat/completions</td></tr></table>';
    const bodies = {
      [SOURCE_URLS.goRoster]: JSON.stringify({ data: [{ id: 'go' }] }),
      [SOURCE_URLS.zenRoster]: JSON.stringify({ data: [{ id: 'zen' }] }),
      [SOURCE_URLS.catalog]: JSON.stringify({
        'opencode-go': { models: { go: catRecord({ id: 'go' }) } },
        opencode: { models: { zen: catRecord({ id: 'zen' }) } },
      }),
      [SOURCE_URLS.goDocs]: html,
      [SOURCE_URLS.zenDocs]: html,
    };
    const seen = [];
    const sources = await fetchSources(async (url) => {
      seen.push(url);
      return { ok: true, status: 200, text: async () => bodies[url] };
    });
    assert.deepEqual([...seen].sort(), Object.values(SOURCE_URLS).sort());
    assert.deepEqual(sources.rosters, { go: ['go'], zen: ['zen'] });
    await assert.rejects(
      fetchSources(async (url) => ({ ok: url !== SOURCE_URLS.zenDocs, status: 503, text: async () => '' })),
      /FETCH_FAILED/,
    );
  });

  it('fails closed for malformed llm-pi-ai.providers and leaves bytes untouched', () => {
    const file = writeTempSettings({ 'llm-pi-ai': { providers: [] } });
    const before = fs.readFileSync(file);
    const outcome = syncFromSources({ settingsPath: file, sources: {
      rosters: { go: ['go'], zen: ['zen'] },
      catalog: {
        go: { models: { go: catRecord({ id: 'go', name: 'Go' }) } },
        zen: { models: { zen: catRecord({ id: 'zen', name: 'Zen', provider: { npm: '@ai-sdk/openai' } }) } },
      },
      docs: {
        go: { go: 'https://opencode.ai/zen/go/v1/chat/completions' },
        zen: { zen: 'https://opencode.ai/zen/v1/responses' },
      },
    } });
    assert.equal(outcome.result, 'NOT WRITTEN');
    assert.deepEqual(fs.readFileSync(file), before);
  });

  it('uses an explicit scratch settings path and ignores OCMS_SETTINGS', () => {
    const original = process.env.OCMS_SETTINGS;
    process.env.OCMS_SETTINGS = 'C:\\must-not-be-used.yaml';
    try {
      assert.equal(resolveSettingsPath(['node', 'sync.mjs', '--settings=C:\\scratch\\settings.yaml']), 'C:\\scratch\\settings.yaml');
      const defaultPath = resolveSettingsPath(['node', 'sync.mjs']);
      assert.notEqual(defaultPath, process.env.OCMS_SETTINGS);
    } finally {
      if (original === undefined) delete process.env.OCMS_SETTINGS;
      else process.env.OCMS_SETTINGS = original;
    }
  });
});

describe('14. backup and temporary-file failure behavior', () => {
  function validSources() {
    return sourcesFor({
      goIds: ['model-a'],
      zenIds: ['model-z'],
      goModels: { 'model-a': catRecord({ provider: { npm: '@ai-sdk/openai-compatible' } }) },
      zenModels: { 'model-z': catRecord({ id: 'model-z', name: 'Z', provider: { npm: '@ai-sdk/openai' } }) },
      goDocs: { 'model-a': 'https://opencode.ai/zen/go/v1/chat/completions' },
      zenDocs: { 'model-z': 'https://opencode.ai/zen/v1/responses' },
    });
  }

  it('backs up the exact original bytes before replacing, then removes the temporary file', () => {
    const file = writeTempSettings({ keep: true, 'llm-pi-ai': { providers: {} } });
    const original = fs.readFileSync(file, 'utf8');
    const outcome = syncFromSources({ settingsPath: file, sources: validSources() });
    assert.equal(outcome.result, 'UPDATED');
    const dir = path.dirname(file);
    const backups = fs.readdirSync(dir).filter((f) => f.startsWith('settings.yaml.bak-'));
    assert.equal(backups.length, 1);
    assert.equal(fs.readFileSync(path.join(dir, backups[0]), 'utf8'), original);
    assert.equal(fs.existsSync(file + '.tmp'), false);
  });

  it('leaves the original untouched when the temporary write fails after backup', () => {
    const file = writeTempSettings({ keep: true, 'llm-pi-ai': { providers: {} } });
    const before = fs.readFileSync(file);
    const realWrite = fs.writeFileSync;
    let calls = 0;
    const mocked = mock.method(fs, 'writeFileSync', (fileArg, data, options) => {
      calls += 1;
      if (calls === 2) throw new Error('SIMULATED_TMP_WRITE_FAILURE');
      return realWrite(fileArg, data, options);
    });
    try {
      const outcome = syncFromSources({ settingsPath: file, sources: validSources() });
      assert.equal(outcome.result, 'NOT WRITTEN');
      assert.equal(calls, 2);
      assert.deepEqual(fs.readFileSync(file), before);
      assert.equal(fs.existsSync(file + '.tmp'), false);
    } finally {
      mocked.mock.restore();
    }
  });
});

describe('15. same model ID under Go and Zen', () => {
  it('places the shared ID independently per gateway and never crosses compat', () => {
    const sources = {
      rosters: { go: ['shared'], zen: ['shared'] },
      catalog: {
        go: { npm: '@ai-sdk/openai-compatible', models: { shared: catRecord({ id: 'shared', name: 'Go Shared', provider: { npm: '@ai-sdk/openai-compatible' } }) } },
        zen: { npm: '@ai-sdk/anthropic', models: { shared: catRecord({ id: 'shared', name: 'Zen Shared', provider: { npm: '@ai-sdk/anthropic' } }) } },
      },
      docs: { go: { shared: 'https://opencode.ai/zen/go/v1/chat/completions' }, zen: { shared: 'https://opencode.ai/zen/v1/messages' } },
    };
    const plan = planDesired({ ...sources, current: emptyCurrent() });
    assert.equal(plan.ok, true);
    assert.deepEqual(plan.desired['opencode-go'].map((m) => m.id), ['shared']);
    assert.deepEqual(plan.desired['opencode-go'].map((m) => m.name), ['Go Shared']);
    assert.deepEqual(plan.desired['opencode-messages'].map((m) => m.id), ['shared']);
    assert.deepEqual(plan.desired['opencode-messages'].map((m) => m.name), ['Zen Shared']);
    // A compat recorded for the shared id under the OTHER gateway never leaks.
    const plan2 = planDesired({
      ...sources,
      current: { 'llm-pi-ai': { providers: {
        'opencode-completions': { models: [{ id: 'shared', compat: { zenOnly: true } }] },
      } } },
    });
    assert.equal(plan2.ok, true);
    assert.equal(plan2.desired['opencode-go'][0].compat, undefined);
    // But a same-gateway wrong-route compat still follows the legitimate move.
    assert.deepEqual(plan2.desired['opencode-messages'][0].compat, { zenOnly: true });
    // End to end: one write, per-gateway records, membership exact.
    const file = writeTempSettings(emptyCurrent());
    const outcome = syncFromSources({ settingsPath: file, sources });
    assert.equal(outcome.result, 'UPDATED');
    const providers = parseYaml(fs.readFileSync(file, 'utf8'))['llm-pi-ai'].providers;
    assert.equal(providers['opencode-go'].models[0].name, 'Go Shared');
    assert.equal(providers['opencode-messages'].models[0].name, 'Zen Shared');
    checkMembership(
      Object.fromEntries(
        ['opencode-go', 'opencode-go-messages', 'opencode-go-responses', 'opencode-completions', 'opencode-messages', 'opencode']
          .map((route) => [route, (providers[route] && providers[route].models) || []]),
      ),
      sources.rosters,
    );
  });
});

describe('16. runSync CLI path', () => {
  it('synchronizes an explicit scratch settings path end to end and ignores OCMS_SETTINGS', async () => {
    const file = writeTempSettings({ topLevel: 'keep', 'llm-pi-ai': { providers: {} } });
    const original = process.env.OCMS_SETTINGS;
    process.env.OCMS_SETTINGS = 'C:\\must-not-be-used.yaml';
    const bodies = {
      [SOURCE_URLS.goRoster]: JSON.stringify({ data: [{ id: 'go-live' }] }),
      [SOURCE_URLS.zenRoster]: JSON.stringify({ data: [{ id: 'zen-live' }] }),
      [SOURCE_URLS.catalog]: JSON.stringify({
        'opencode-go': { models: { 'go-live': catRecord({ id: 'go-live', provider: { npm: '@ai-sdk/openai-compatible' } }) } },
        opencode: { models: { 'zen-live': catRecord({ id: 'zen-live', name: 'Zen Live', provider: { npm: '@ai-sdk/openai' } }) } },
      }),
      [SOURCE_URLS.goDocs]: '<table><tr><th>Model ID</th><th>Endpoint</th></tr><tr><td>go-live</td><td>https://opencode.ai/zen/go/v1/chat/completions</td></tr></table>',
      [SOURCE_URLS.zenDocs]: '<table><tr><th>Model ID</th><th>Endpoint</th></tr><tr><td>zen-live</td><td>https://opencode.ai/zen/v1/responses</td></tr></table>',
    };
    const printed = [];
    const mockedLog = mock.method(console, 'log', (...args) => { printed.push(args.join(' ')); });
    try {
      const outcome = await runSync({
        settingsPath: file,
        fetchFn: async (url) => ({ ok: true, status: 200, text: async () => bodies[url] }),
      });
      assert.equal(outcome.result, 'UPDATED');
      const written = parseYaml(fs.readFileSync(file, 'utf8'));
      assert.equal(written.topLevel, 'keep');
      assert.deepEqual(written['llm-pi-ai'].providers['opencode-go'].models.map((m) => m.id), ['go-live']);
      assert.deepEqual(written['llm-pi-ai'].providers['opencode'].models.map((m) => m.id), ['zen-live']);
      assert.equal(printed.join('\n').endsWith('UPDATED'), true);
    } finally {
      mockedLog.mock.restore();
      if (original === undefined) delete process.env.OCMS_SETTINGS;
      else process.env.OCMS_SETTINGS = original;
    }
  });
});

describe('17. import performs no synchronization', () => {
  it('importing sync.mjs from another module starts no run and writes nothing', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocms-s-import-'));
    fs.writeFileSync(path.join(dir, 'settings.yaml'), 'llm-pi-ai:\n  providers: {}\n', 'utf8');
    const syncUrl = new URL('../sync.mjs', import.meta.url).href;
    const launcher = path.join(dir, 'launcher.mjs');
    // The launcher blocks any fetch so a broken main-module guard can only
    // fail fast; it must never reach the scratch settings file.
    fs.writeFileSync(launcher, [
      "globalThis.fetch = async () => { throw new Error('AUDIT_FETCH_BLOCKED'); };",
      `await import(${JSON.stringify(syncUrl)});`,
      "console.log('IMPORTED_OK');",
    ].join('\n'), 'utf8');
    const run = spawnSync(process.execPath, [launcher], {
      encoding: 'utf8',
      timeout: 30000,
      env: { ...process.env, OCMS_SETTINGS: 'C:\\must-not-be-used.yaml' },
    });
    assert.equal(run.status, 0, 'launcher exits cleanly');
    assert.equal(run.stderr, '', 'no import-time errors');
    assert.equal((run.stdout || '').trim(), 'IMPORTED_OK', 'only the launcher marker is printed');
    assert.deepEqual(
      fs.readdirSync(dir).sort(),
      ['launcher.mjs', 'settings.yaml'],
      'import created no backup, temporary file, or other residue',
    );
  });
});

describe('18. dependency surface', () => {
  it('keeps runtime dependencies to YAML and HTML parsing only', () => {
    const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    assert.deepEqual(Object.keys(pkg.dependencies).sort(), ['node-html-parser', 'yaml']);
    assert.deepEqual(pkg.devDependencies ?? {}, {});
  });
});

describe('19. default settings path derivation', () => {
  it('derives the default path from USERPROFILE and never from HOME', () => {
    const savedU = process.env.USERPROFILE;
    const savedH = process.env.HOME;
    try {
      process.env.USERPROFILE = 'C:\\user-trap';
      process.env.HOME = 'C:\\home-trap';
      assert.equal(defaultSettingsPath(), path.join('C:\\user-trap', '.dsh', 'settings.yaml'));
      delete process.env.USERPROFILE;
      const fallback = defaultSettingsPath();
      assert.notEqual(fallback, path.join('C:\\home-trap', '.dsh', 'settings.yaml'));
      assert.ok(fallback.endsWith(path.join('.dsh', 'settings.yaml')));
    } finally {
      if (savedU === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = savedU;
      if (savedH === undefined) delete process.env.HOME;
      else process.env.HOME = savedH;
    }
  });
});

describe('20. v1.2 model-local unresolved dispositions', () => {
  function stuckSources(extra = {}) {
    return sourcesFor({
      goIds: ['stuck', 'fresh'],
      zenIds: ['model-z'],
      goModels: {
        stuck: catRecord({ id: 'stuck', name: 'New Name' }),
        fresh: catRecord({ id: 'fresh', name: 'Fresh', provider: { npm: '@ai-sdk/openai-compatible' } }),
      },
      zenModels: {
        'model-z': catRecord({ id: 'model-z', name: 'Z', provider: { npm: '@ai-sdk/openai' } }),
      },
      goDocs: { fresh: 'https://opencode.ai/zen/go/v1/chat/completions' },
      zenDocs: { 'model-z': 'https://opencode.ai/zen/v1/responses' },
      ...extra,
    });
  }

  it('preserves a placement-unresolved model on its unique route with rebuilt metadata', () => {
    const compat = { keep: 'yes' };
    const current = { 'llm-pi-ai': { providers: {
      'opencode-go': { models: [{ id: 'stale-gone', name: 'Stale' }] },
      'opencode-go-messages': { models: [{
        id: 'stuck', name: 'Old Name', input: ['text'], contextWindow: 1, maxTokens: 1,
        legacy: 'drop-me', compat,
      }] },
    } } };
    const file = writeTempSettings(current);
    const outcome = syncFromSources({ settingsPath: file, sources: stuckSources() });
    assert.equal(outcome.result, 'UPDATED');
    assert.deepEqual(outcome.preservedUnresolved, [{ gateway: 'go', id: 'stuck', reason: 'PLACEMENT_UNRESOLVED', route: 'opencode-go-messages' }]);
    assert.deepEqual(outcome.skippedUnresolved, []);
    const providers = parseYaml(fs.readFileSync(file, 'utf8'))['llm-pi-ai'].providers;
    const models = providers['opencode-go-messages'].models;
    assert.deepEqual(models.map((m) => m.id), ['stuck']);
    assert.equal(models[0].name, 'New Name');
    assert.deepEqual(models[0].compat, compat);
    assert.ok(!Object.hasOwn(models[0], 'legacy'));
    // A stale model absent from the roster is still removed.
    assert.equal(fs.readFileSync(file, 'utf8').includes('stale-gone'), false);
  });

  it('classifies every live ID exactly once and omits only skipped IDs', () => {
    const sources = stuckSources({ goIds: ['new-stuck', 'fresh'] });
    sources.catalog.go.models['new-stuck'] = catRecord({ id: 'new-stuck', name: 'New Stuck' });
    delete sources.catalog.go.models.stuck;
    const plan = planDesired({ ...sources, current: emptyCurrent() });
    assert.equal(plan.ok, true);
    assert.deepEqual(
      Object.fromEntries(plan.dispositions.map((d) => [d.gateway + '/' + d.id, d.disposition])),
      { 'go/fresh': 'RESOLVED', 'go/new-stuck': 'SKIPPED_UNRESOLVED', 'zen/model-z': 'RESOLVED' },
    );
    checkMembership(plan.desired, sources.rosters, { go: ['new-stuck'], zen: [] });
    const file = writeTempSettings(emptyCurrent());
    const outcome = syncFromSources({ settingsPath: file, sources });
    assert.equal(outcome.result, 'UPDATED');
    assert.equal(fs.readFileSync(file, 'utf8').includes('new-stuck'), false);
  });

  it('refuses placement-unresolved models duplicated across routes', () => {
    const current = { 'llm-pi-ai': { providers: {
      'opencode-go': { models: [{ id: 'dup', name: 'Dup' }] },
      'opencode-go-messages': { models: [{ id: 'dup', name: 'Dup' }] },
    } } };
    const file = writeTempSettings(current);
    const before = fs.readFileSync(file);
    const sources = stuckSources({ goIds: ['dup', 'fresh'] });
    sources.catalog.go.models.dup = catRecord({ id: 'dup', name: 'Dup' });
    delete sources.catalog.go.models.stuck;
    const outcome = syncFromSources({ settingsPath: file, sources });
    assert.equal(outcome.result, 'NOT WRITTEN');
    assert.match(outcome.unresolved[0].reason, /PLACEMENT_AMBIGUOUS/);
    assert.deepEqual(fs.readFileSync(file), before);
  });

  it('preserves a catalog-missing record byte-identically without compat migration', () => {
    const opaque = {
      id: 'vanished', name: 'Old Vanished', input: ['text'], contextWindow: 42, maxTokens: 7,
      reasoningEfforts: false, legacy: 'stays', thinkingBudgets: { x: 1 }, compat: { c: 1 },
    };
    const current = { 'llm-pi-ai': { providers: {
      opencode: { displayName: 'keep', models: [opaque] },
    } } };
    const sources = sourcesFor({
      goIds: ['fresh'],
      zenIds: ['vanished'],
      goModels: { fresh: catRecord({ id: 'fresh', name: 'Fresh', provider: { npm: '@ai-sdk/openai-compatible' } }) },
      // Nonempty Zen catalog lacking only the live 'vanished' ID: a legitimate
      // per-model gap (an empty whole gateway map is source-invalid).
      zenModels: { 'model-z': catRecord({ id: 'model-z', name: 'Z', provider: { npm: '@ai-sdk/openai' } }) },
      goDocs: { fresh: 'https://opencode.ai/zen/go/v1/chat/completions' },
      zenDocs: {},
    });
    const file = writeTempSettings(current);
    const outcome = syncFromSources({ settingsPath: file, sources });
    assert.equal(outcome.result, 'UPDATED');
    assert.deepEqual(outcome.preservedUnresolved, [{ gateway: 'zen', id: 'vanished', reason: 'CATALOG_MISSING', route: 'opencode' }]);
    const provider = parseYaml(fs.readFileSync(file, 'utf8'))['llm-pi-ai'].providers.opencode;
    assert.equal(provider.displayName, 'keep');
    assert.deepEqual(provider.models, [opaque]);
  });

  it('refuses a catalog-missing model with multiple existing records', () => {
    const current = { 'llm-pi-ai': { providers: {
      opencode: { models: [{ id: 'vanished', name: 'A' }] },
      'opencode-messages': { models: [{ id: 'vanished', name: 'B' }] },
    } } };
    const file = writeTempSettings(current);
    const before = fs.readFileSync(file);
    const sources = sourcesFor({
      goIds: ['fresh'],
      zenIds: ['vanished'],
      goModels: { fresh: catRecord({ id: 'fresh', name: 'Fresh', provider: { npm: '@ai-sdk/openai-compatible' } }) },
      // Nonempty Zen catalog lacking only the live 'vanished' ID: a legitimate
      // per-model gap (an empty whole gateway map is source-invalid).
      zenModels: { 'model-z': catRecord({ id: 'model-z', name: 'Z', provider: { npm: '@ai-sdk/openai' } }) },
      goDocs: { fresh: 'https://opencode.ai/zen/go/v1/chat/completions' },
      zenDocs: {},
    });
    const outcome = syncFromSources({ settingsPath: file, sources });
    assert.equal(outcome.result, 'NOT WRITTEN');
    assert.match(outcome.unresolved[0].reason, /CATALOG_AMBIGUOUS/);
    assert.deepEqual(fs.readFileSync(file), before);
  });

  it('sorts unresolved report entries by gateway then model ID', async () => {
    const bodies = {
      [SOURCE_URLS.goRoster]: JSON.stringify({ data: [{ id: 'zulu-stuck' }, { id: 'alpha-stuck' }, { id: 'fresh' }] }),
      [SOURCE_URLS.zenRoster]: JSON.stringify({ data: [{ id: 'model-z' }, { id: 'middle-stuck' }] }),
      [SOURCE_URLS.catalog]: JSON.stringify({
        'opencode-go': { models: {
          'zulu-stuck': catRecord({ id: 'zulu-stuck', name: 'Z' }),
          'alpha-stuck': catRecord({ id: 'alpha-stuck', name: 'A' }),
          fresh: catRecord({ id: 'fresh', name: 'Fresh', provider: { npm: '@ai-sdk/openai-compatible' } }),
        } },
        opencode: { models: {
          'model-z': catRecord({ id: 'model-z', name: 'Z', provider: { npm: '@ai-sdk/openai' } }),
          'middle-stuck': catRecord({ id: 'middle-stuck', name: 'M' }),
        } },
      }),
      [SOURCE_URLS.goDocs]: '<table><tr><th>Model ID</th><th>Endpoint</th></tr><tr><td>fresh</td><td>https://opencode.ai/zen/go/v1/chat/completions</td></tr></table>',
      [SOURCE_URLS.zenDocs]: '<table><tr><th>Model ID</th><th>Endpoint</th></tr><tr><td>model-z</td><td>https://opencode.ai/zen/v1/responses</td></tr></table>',
    };
    const file = writeTempSettings({ 'llm-pi-ai': { providers: {
      'opencode-go': { models: [{ id: 'alpha-stuck', name: 'A' }] },
      'opencode-messages': { models: [{ id: 'middle-stuck', name: 'M' }] },
    } } });
    const printed = [];
    const mockedLog = mock.method(console, 'log', (...args) => { printed.push(args.join(' ')); });
    try {
      const outcome = await runSync({
        settingsPath: file,
        fetchFn: async (url) => ({ ok: true, status: 200, text: async () => bodies[url] }),
      });
      assert.equal(outcome.result, 'UPDATED');
      const report = outcome.report;
      const alpha = report.indexOf('- go/alpha-stuck reason=PLACEMENT_UNRESOLVED route=opencode-go');
      const middle = report.indexOf('- zen/middle-stuck reason=PLACEMENT_UNRESOLVED route=opencode-messages');
      const zulu = report.indexOf('- go/zulu-stuck reason=PLACEMENT_UNRESOLVED');
      assert.ok(alpha >= 0 && middle >= 0 && zulu >= 0);
      assert.ok(alpha < zulu && alpha < middle);
    } finally {
      mockedLog.mock.restore();
    }
  });

  it('lists warnings on NO CHANGE without creating a backup', () => {
    const current = { 'llm-pi-ai': { providers: {
      'opencode-go-messages': { models: [{
        id: 'stuck', name: 'New Name', input: ['text'], contextWindow: 1000, maxTokens: 100,
        reasoningEfforts: false,
      }] },
    } } };
    const file = writeTempSettings(current);
    const first = syncFromSources({ settingsPath: file, sources: stuckSources() });
    assert.equal(first.result, 'UPDATED');
    const dir = path.dirname(file);
    assert.equal(fs.readdirSync(dir).filter((f) => f.startsWith('settings.yaml.bak-')).length, 1);
    const second = syncFromSources({ settingsPath: file, sources: stuckSources() });
    assert.equal(second.result, 'NO CHANGE');
    assert.deepEqual(second.preservedUnresolved, [{ gateway: 'go', id: 'stuck', reason: 'PLACEMENT_UNRESOLVED', route: 'opencode-go-messages' }]);
    assert.equal(fs.readdirSync(dir).filter((f) => f.startsWith('settings.yaml.bak-')).length, 1);
  });
});

describe('21. exact terminal -free counterpart fallback', () => {
  function freeSuccessSources() {
    return sourcesFor({
      goIds: ['widget-free', 'widget', 'model-g'],
      zenIds: ['model-z'],
      goModels: {
        'widget-free': catRecord({ id: 'widget-free', name: 'Widget Free', modalities: { input: ['text', 'image'] }, limit: { context: 777, output: 77 }, reasoning: false }),
        widget: catRecord({ id: 'widget', name: 'Widget Counterpart', modalities: { input: ['text'] }, limit: { context: 111, output: 11 }, reasoning: false, provider: { npm: '@ai-sdk/anthropic' } }),
        'model-g': catRecord({ id: 'model-g', name: 'G', provider: { npm: '@ai-sdk/openai-compatible' } }),
      },
      zenModels: {
        'model-z': catRecord({ id: 'model-z', name: 'Z', provider: { npm: '@ai-sdk/openai' } }),
      },
      goDocs: {
        widget: 'https://opencode.ai/zen/go/v1/chat/completions',
        'model-g': 'https://opencode.ai/zen/go/v1/chat/completions',
      },
      zenDocs: { 'model-z': 'https://opencode.ai/zen/v1/responses' },
    });
  }

  it('resolves an unresolved -free target from the live counterpart docs route', () => {
    const sources = freeSuccessSources();
    const plan = planDesired({ ...sources, current: emptyCurrent() });
    assert.equal(plan.ok, true);
    assert.deepEqual(
      plan.dispositions.find((d) => d.gateway === 'go' && d.id === 'widget-free'),
      { gateway: 'go', id: 'widget-free', disposition: 'RESOLVED', reason: null, route: 'opencode-go', provenance: 'FREE_COUNTERPART_FALLBACK', counterpart: 'widget' },
    );
    const file = writeTempSettings(emptyCurrent());
    const outcome = syncFromSources({ settingsPath: file, sources });
    assert.equal(outcome.result, 'UPDATED');
    assert.deepEqual(outcome.fallbackResolved, [{ gateway: 'go', id: 'widget-free', counterpart: 'widget', route: 'opencode-go', provenance: 'FREE_COUNTERPART_FALLBACK' }]);
    assert.deepEqual(outcome.preservedUnresolved, []);
    assert.deepEqual(outcome.skippedUnresolved, []);
    const providers = parseYaml(fs.readFileSync(file, 'utf8'))['llm-pi-ai'].providers;
    assert.deepEqual(
      providers['opencode-go'].models.find((m) => m.id === 'widget-free'),
      { id: 'widget-free', name: 'Widget Free', input: ['text', 'image'], contextWindow: 777, maxTokens: 77, reasoningEfforts: false },
    );
    assert.equal(providers['opencode-go'].models.find((m) => m.id === 'widget').name, 'Widget Counterpart');
  });

  it('uses counterpart nested hint only when counterpart has no usable docs row', () => {
    const nested = freeSuccessSources();
    delete nested.docs.go.widget;
    const nestedPlan = planDesired({ ...nested, current: emptyCurrent() });
    assert.equal(nestedPlan.ok, true);
    assert.deepEqual(
      nestedPlan.dispositions.find((d) => d.gateway === 'go' && d.id === 'widget-free'),
      { gateway: 'go', id: 'widget-free', disposition: 'RESOLVED', reason: null, route: 'opencode-go-messages', provenance: 'FREE_COUNTERPART_FALLBACK', counterpart: 'widget' },
    );
    const docsWin = freeSuccessSources();
    const docsPlan = planDesired({ ...docsWin, current: emptyCurrent() });
    assert.equal(docsPlan.ok, true);
    assert.equal(docsPlan.dispositions.find((d) => d.gateway === 'go' && d.id === 'widget-free').route, 'opencode-go');
  });

  it('lets exact target authority outrank the counterpart fallback', () => {
    const docsOwn = freeSuccessSources();
    docsOwn.docs.go['widget-free'] = 'https://opencode.ai/zen/go/v1/messages';
    const docsPlan = planDesired({ ...docsOwn, current: emptyCurrent() });
    assert.equal(docsPlan.ok, true);
    const docsEntry = docsPlan.dispositions.find((d) => d.gateway === 'go' && d.id === 'widget-free');
    assert.equal(docsEntry.disposition, 'RESOLVED');
    assert.equal(docsEntry.route, 'opencode-go-messages');
    assert.equal(docsEntry.provenance, undefined);
    const hintOwn = freeSuccessSources();
    hintOwn.catalog.go.models['widget-free'].provider = { npm: '@ai-sdk/openai' };
    const hintPlan = planDesired({ ...hintOwn, current: emptyCurrent() });
    assert.equal(hintPlan.ok, true);
    const hintEntry = hintPlan.dispositions.find((d) => d.gateway === 'go' && d.id === 'widget-free');
    assert.equal(hintEntry.disposition, 'RESOLVED');
    assert.equal(hintEntry.route, 'opencode-go-responses');
    assert.equal(hintEntry.provenance, undefined);
    assert.deepEqual(syncFromSources({ settingsPath: writeTempSettings(emptyCurrent()), sources: hintOwn }).fallbackResolved, []);
  });

  it('never copies counterpart compat to the free target', () => {
    const sources = freeSuccessSources();
    const current = { 'llm-pi-ai': { providers: {
      'opencode-go': { models: [
        { id: 'widget-free', compat: { target: 'local' } },
        { id: 'widget', compat: { counterpart: 'poison' } },
      ] },
    } } };
    const file = writeTempSettings(current);
    const outcome = syncFromSources({ settingsPath: file, sources });
    assert.equal(outcome.result, 'UPDATED');
    const models = parseYaml(fs.readFileSync(file, 'utf8'))['llm-pi-ai'].providers['opencode-go'].models;
    assert.deepEqual(models.find((m) => m.id === 'widget-free').compat, { target: 'local' });
    assert.deepEqual(models.find((m) => m.id === 'widget').compat, { counterpart: 'poison' });
  });

  it('does not borrow counterpart metadata for a catalog-missing free target', () => {
    const sources = freeSuccessSources();
    delete sources.catalog.go.models['widget-free'];
    const plan = planDesired({ ...sources, current: emptyCurrent() });
    assert.equal(plan.ok, true);
    assert.deepEqual(
      plan.dispositions.find((d) => d.gateway === 'go' && d.id === 'widget-free'),
      { gateway: 'go', id: 'widget-free', disposition: 'SKIPPED_UNRESOLVED', reason: 'CATALOG_MISSING' },
    );
    const file = writeTempSettings(emptyCurrent());
    const outcome = syncFromSources({ settingsPath: file, sources });
    assert.equal(outcome.result, 'UPDATED');
    assert.deepEqual(outcome.fallbackResolved, []);
    assert.equal(fs.readFileSync(file, 'utf8').includes('widget-free'), false);
  });

  it('rejects a counterpart that is absent from the same-gateway live roster', () => {
    const sources = sourcesFor({
      goIds: ['widget-free', 'model-g'],
      zenIds: ['model-z'],
      goModels: {
        'widget-free': catRecord({ id: 'widget-free', name: 'Widget Free' }),
        widget: catRecord({ id: 'widget', name: 'Widget Counterpart' }),
        'model-g': catRecord({ id: 'model-g', name: 'G', provider: { npm: '@ai-sdk/openai-compatible' } }),
      },
      zenModels: {
        'model-z': catRecord({ id: 'model-z', name: 'Z', provider: { npm: '@ai-sdk/openai' } }),
      },
      goDocs: {
        widget: 'https://opencode.ai/zen/go/v1/chat/completions',
        'model-g': 'https://opencode.ai/zen/go/v1/chat/completions',
      },
      zenDocs: { 'model-z': 'https://opencode.ai/zen/v1/responses' },
    });
    assert.equal(resolveFreeCounterpartRoute({ gateway: 'go', id: 'widget-free', rosters: sources.rosters, catalog: sources.catalog, docs: sources.docs }), undefined);
    const file = writeTempSettings(emptyCurrent());
    const outcome = syncFromSources({ settingsPath: file, sources });
    assert.equal(outcome.result, 'UPDATED');
    assert.deepEqual(outcome.skippedUnresolved, [{ gateway: 'go', id: 'widget-free', reason: 'PLACEMENT_UNRESOLVED' }]);
    assert.deepEqual(outcome.fallbackResolved, []);
  });

  it('rejects cross-gateway, inexact, fuzzy, recursive, and Google counterparts', () => {
    const Live = { go: ['model-g'], zen: ['foo-free', 'model-z'] };
    const catalog = {
      go: { models: {
        'model-g': catRecord({ id: 'model-g', name: 'G', provider: { npm: '@ai-sdk/openai-compatible' } }),
        foo: catRecord({ id: 'foo', name: 'Go Foo', provider: { npm: '@ai-sdk/openai-compatible' } }),
      } },
      zen: { models: {
        'foo-free': catRecord({ id: 'foo-free', name: 'Zen Foo Free' }),
        'model-z': catRecord({ id: 'model-z', name: 'Z', provider: { npm: '@ai-sdk/openai' } }),
      } },
    };
    const docs = {
      go: {
        foo: 'https://opencode.ai/zen/go/v1/chat/completions',
        'model-g': 'https://opencode.ai/zen/go/v1/chat/completions',
      },
      zen: { 'model-z': 'https://opencode.ai/zen/v1/responses' },
    };
    assert.equal(resolveFreeCounterpartRoute({ gateway: 'zen', id: 'foo-free', rosters: Live, catalog, docs }), undefined);
    assert.equal(resolveFreeCounterpartRoute({ gateway: 'go', id: 'free-foo', rosters: { go: ['free-foo'] }, catalog: { go: { models: {} } }, docs: { go: {} } }), undefined);
    assert.equal(resolveFreeCounterpartRoute({ gateway: 'go', id: 'foo-free-preview', rosters: { go: ['foo-free-preview'] }, catalog: { go: { models: {} } }, docs: { go: {} } }), undefined);
    assert.equal(resolveFreeCounterpartRoute({ gateway: 'go', id: 'foo-free-v2', rosters: { go: ['foo-free-v2'] }, catalog: { go: { models: {} } }, docs: { go: {} } }), undefined);
    assert.equal(resolveFreeCounterpartRoute({ gateway: 'go', id: 'a-free-free', rosters: { go: ['a-free-free', 'a-free', 'a'] }, catalog: { go: { models: {} } }, docs: { go: {} } }), undefined);
    const fuzzy = sourcesFor({
      goIds: ['foo-free', 'foo-v2', 'model-g'],
      zenIds: ['model-z'],
      goModels: {
        'foo-free': catRecord({ id: 'foo-free', name: 'Foo Free' }),
        'foo-v2': catRecord({ id: 'foo-v2', name: 'Foo V2', provider: { npm: '@ai-sdk/openai-compatible' } }),
        'model-g': catRecord({ id: 'model-g', name: 'G', provider: { npm: '@ai-sdk/openai-compatible' } }),
      },
      zenModels: {
        'model-z': catRecord({ id: 'model-z', name: 'Z', provider: { npm: '@ai-sdk/openai' } }),
      },
      goDocs: {
        'foo-v2': 'https://opencode.ai/zen/go/v1/chat/completions',
        'model-g': 'https://opencode.ai/zen/go/v1/chat/completions',
      },
      zenDocs: { 'model-z': 'https://opencode.ai/zen/v1/responses' },
    });
    const fuzzyPlan = planDesired({ ...fuzzy, current: emptyCurrent() });
    assert.equal(fuzzyPlan.ok, true);
    assert.deepEqual(
      fuzzyPlan.dispositions.find((d) => d.gateway === 'go' && d.id === 'foo-free'),
      { gateway: 'go', id: 'foo-free', disposition: 'SKIPPED_UNRESOLVED', reason: 'PLACEMENT_UNRESOLVED' },
    );
    const google = sourcesFor({
      goIds: ['foo-free', 'foo', 'model-g'],
      zenIds: ['model-z'],
      goModels: {
        'foo-free': catRecord({ id: 'foo-free', name: 'Foo Free' }),
        foo: catRecord({ id: 'foo', name: 'Foo', provider: { npm: '@ai-sdk/google' } }),
        'model-g': catRecord({ id: 'model-g', name: 'G', provider: { npm: '@ai-sdk/openai-compatible' } }),
      },
      zenModels: {
        'model-z': catRecord({ id: 'model-z', name: 'Z', provider: { npm: '@ai-sdk/openai' } }),
      },
      goDocs: { 'model-g': 'https://opencode.ai/zen/go/v1/chat/completions' },
      zenDocs: { 'model-z': 'https://opencode.ai/zen/v1/responses' },
    });
    assert.equal(resolveFreeCounterpartRoute({ gateway: 'go', id: 'foo-free', rosters: google.rosters, catalog: google.catalog, docs: google.docs }), undefined);
    const googleFile = writeTempSettings(emptyCurrent());
    const googleOutcome = syncFromSources({ settingsPath: googleFile, sources: google });
    assert.equal(googleOutcome.result, 'UPDATED');
    assert.deepEqual(
      googleOutcome.skippedUnresolved.find((d) => d.gateway === 'go' && d.id === 'foo-free'),
      { gateway: 'go', id: 'foo-free', reason: 'PLACEMENT_UNRESOLVED' },
    );
    assert.deepEqual(googleOutcome.fallbackResolved, []);
  });

  it('reports fallback provenance on UPDATED and NO CHANGE without extra backup', () => {
    const sources = freeSuccessSources();
    const file = writeTempSettings(emptyCurrent());
    const first = syncFromSources({ settingsPath: file, sources });
    assert.equal(first.result, 'UPDATED');
    assert.deepEqual(first.fallbackResolved, [{ gateway: 'go', id: 'widget-free', counterpart: 'widget', route: 'opencode-go', provenance: 'FREE_COUNTERPART_FALLBACK' }]);
    const firstReport = formatReport(first);
    assert.ok(firstReport.includes('FREE_COUNTERPART_FALLBACK (1)'));
    assert.ok(firstReport.includes('- go/widget-free counterpart=go/widget route=opencode-go'));
    assert.ok(firstReport.endsWith('UPDATED'));
    const dir = path.dirname(file);
    assert.equal(fs.readdirSync(dir).filter((f) => f.startsWith('settings.yaml.bak-')).length, 1);
    const second = syncFromSources({ settingsPath: file, sources: freeSuccessSources() });
    assert.equal(second.result, 'NO CHANGE');
    assert.deepEqual(second.fallbackResolved, first.fallbackResolved);
    const secondReport = formatReport(second);
    assert.ok(secondReport.includes('FREE_COUNTERPART_FALLBACK (1)'));
    assert.ok(secondReport.includes('- go/widget-free counterpart=go/widget route=opencode-go'));
    assert.ok(secondReport.endsWith('NO CHANGE'));
    assert.equal(fs.readdirSync(dir).filter((f) => f.startsWith('settings.yaml.bak-')).length, 1);
  });

  it('sorts multiple fallback entries by gateway then exact target ID', () => {
    const sources = sourcesFor({
      goIds: ['b-free', 'a-free', 'b', 'a', 'model-g'],
      zenIds: ['z-free', 'z', 'model-z'],
      goModels: {
        'b-free': catRecord({ id: 'b-free', name: 'B Free' }),
        b: catRecord({ id: 'b', name: 'B', provider: { npm: '@ai-sdk/anthropic' } }),
        'a-free': catRecord({ id: 'a-free', name: 'A Free' }),
        a: catRecord({ id: 'a', name: 'A', provider: { npm: '@ai-sdk/openai-compatible' } }),
        'model-g': catRecord({ id: 'model-g', name: 'G', provider: { npm: '@ai-sdk/openai-compatible' } }),
      },
      zenModels: {
        'z-free': catRecord({ id: 'z-free', name: 'Z Free' }),
        z: catRecord({ id: 'z', name: 'Z', provider: { npm: '@ai-sdk/openai' } }),
        'model-z': catRecord({ id: 'model-z', name: 'Zed', provider: { npm: '@ai-sdk/openai' } }),
      },
      goDocs: {
        b: 'https://opencode.ai/zen/go/v1/messages',
        a: 'https://opencode.ai/zen/go/v1/chat/completions',
        'model-g': 'https://opencode.ai/zen/go/v1/chat/completions',
      },
      zenDocs: {
        z: 'https://opencode.ai/zen/v1/responses',
        'model-z': 'https://opencode.ai/zen/v1/responses',
      },
    });
    const file = writeTempSettings(emptyCurrent());
    const outcome = syncFromSources({ settingsPath: file, sources });
    assert.equal(outcome.result, 'UPDATED');
    assert.deepEqual(outcome.fallbackResolved, [
      { gateway: 'go', id: 'a-free', counterpart: 'a', route: 'opencode-go', provenance: 'FREE_COUNTERPART_FALLBACK' },
      { gateway: 'go', id: 'b-free', counterpart: 'b', route: 'opencode-go-messages', provenance: 'FREE_COUNTERPART_FALLBACK' },
      { gateway: 'zen', id: 'z-free', counterpart: 'z', route: 'opencode', provenance: 'FREE_COUNTERPART_FALLBACK' },
    ]);
    const report = formatReport(outcome);
    assert.ok(report.indexOf('- go/a-free counterpart=go/a route=opencode-go') < report.indexOf('- go/b-free counterpart=go/b route=opencode-go-messages'));
    assert.ok(report.indexOf('- go/b-free counterpart=go/b route=opencode-go-messages') < report.indexOf('- zen/z-free counterpart=zen/z route=opencode'));
  });
});
