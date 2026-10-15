// P2-2 RED: a key stored twice on its wanted route must surface the surplus
// copy in the section-13 report (removed), while the write path stays byte
// identical: duplicated priors must not change a single written byte.
// Temporary fixture YAML only; production settings are never touched here.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { diffDesired, syncFromSources } from '../sync.mjs';

function model(id) {
  return { id, name: 'Model ' + id, input: ['text'], contextWindow: 1000, maxTokens: 100 };
}

function desiredWith(route, ids) {
  const out = {
    'opencode-go': [],
    'opencode-go-messages': [],
    'opencode-go-responses': [],
    'opencode-completions': [],
    'opencode-messages': [],
    opencode: [],
  };
  out[route] = ids.map(model);
  return out;
}

function priorsWith(key, records) {
  return new Map([[key, { route: records[0].route, record: model('m1'), records }]]);
}

function writeTempSettings(config) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocms-p22-'));
  const file = path.join(dir, 'settings.yaml');
  fs.writeFileSync(file, stringifyYaml(config), 'utf8');
  return file;
}

function sourcesForM1() {
  const rec = {
    id: 'm1', name: 'M1', modalities: { input: ['text'] },
    limit: { context: 1000, output: 100 }, reasoning: false,
    provider: { npm: '@ai-sdk/openai' },
  };
  const goRec = {
    id: 'gx', name: 'GX', modalities: { input: ['text'] },
    limit: { context: 1000, output: 100 }, reasoning: false,
    provider: { npm: '@ai-sdk/openai-compatible' },
  };
  return {
    rosters: { go: ['gx'], zen: ['m1'] },
    catalog: {
      go: { npm: '@ai-sdk/openai-compatible', models: { gx: goRec } },
      zen: { npm: '@ai-sdk/openai', models: { m1: rec } },
    },
    docs: { go: { gx: 'https://opencode.ai/zen/go/v1/chat/completions' }, zen: { m1: 'https://opencode.ai/zen/v1/responses' } },
  };
}

describe('P2-2 duplicate stored copies on the wanted route', () => {
  it('reports the surplus copy in removed', () => {
    const diff = diffDesired(
      desiredWith('opencode', ['m1']),
      priorsWith('zen/m1', [{ route: 'opencode' }, { route: 'opencode' }]),
    );
    assert.deepEqual(diff.added, []);
    assert.deepEqual(diff.moved, []);
    assert.deepEqual(diff.removed, [{ key: 'zen/m1', route: 'opencode' }]);
  });

  it('control: a single stored copy reports no removal', () => {
    const diff = diffDesired(
      desiredWith('opencode', ['m1']),
      priorsWith('zen/m1', [{ route: 'opencode' }]),
    );
    assert.deepEqual(diff.added, []);
    assert.deepEqual(diff.moved, []);
    assert.deepEqual(diff.removed, []);
  });

  it('regression pin: a lone copy on another route still reports moved, not removed', () => {
    const diff = diffDesired(
      desiredWith('opencode', ['m1']),
      priorsWith('zen/m1', [{ route: 'opencode-messages' }]),
    );
    assert.deepEqual(diff.moved, [{ key: 'zen/m1', from: 'opencode-messages', to: 'opencode' }]);
    assert.deepEqual(diff.removed, []);
  });

  it('duplicated priors do not change a single written byte', () => {
    const seed = writeTempSettings({ llm: { unrelated: true }, 'llm-pi-ai': { providers: {} } });
    const first = syncFromSources({ settingsPath: seed, sources: sourcesForM1() });
    assert.equal(first.result, 'UPDATED');
    const rec = parseYaml(fs.readFileSync(seed, 'utf8'))['llm-pi-ai'].providers.opencode.models[0];
    const provider = (models) => ({ displayName: 'opencode', models });
    const dup = writeTempSettings({ llm: { unrelated: true }, 'llm-pi-ai': { providers: { opencode: provider([rec, rec]) } } });
    const single = writeTempSettings({ llm: { unrelated: true }, 'llm-pi-ai': { providers: { opencode: provider([rec]) } } });
    syncFromSources({ settingsPath: dup, sources: sourcesForM1() });
    syncFromSources({ settingsPath: single, sources: sourcesForM1() });
    assert.deepEqual(
      [...fs.readFileSync(dup)],
      [...fs.readFileSync(single)],
      'duplicated priors must write byte-identical settings',
    );
  });
});
