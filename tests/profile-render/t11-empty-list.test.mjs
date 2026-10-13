// S3 G3 — empty managed lists render valid YAML (contract v1.4.7-rc1).
import { describe, it } from 'node:test';
import { parse as parseYaml } from 'yaml';
import { renderDesiredState } from '../../profile/surgical-render.mjs';
import { assert, desiredSix, modelRecord, buildPatchText } from './helpers.mjs';

function providerModels(parsed, route) {
  const rows = parsed.filter((row) => row && row.id === 'llm-pi-ai');
  assert.equal(rows.length, 1, 'exactly one llm-pi-ai row');
  const models = (((rows[0].config || {}).providers || {})[route] || {}).models;
  return (models || []).map((m) => m.id);
}

function checkCandidate(res, desired) {
  assert.equal(res.ok, true);
  assert.ok(res.candidateBytes, 'change must carry candidate bytes');
  const text = Buffer.from(res.candidateBytes).toString('utf8');
  const lines = text.split('\n');
  for (const line of lines) {
    assert.ok(!/\[\]\s+\S/.test(line), 'no key may trail an empty list: ' + line);
  }
  const parsed = parseYaml(text);
  for (const route of Object.keys(desired)) {
    assert.deepEqual(providerModels(parsed, route), (desired[route] || []).map((m) => m.id), route);
  }
  return text;
}

describe('S3 G3 — empty managed lists', () => {
  it('empty list followed by another managed provider stays valid', () => {
    const providers = { 'opencode-go': { displayName: 'opencode-go', models: [modelRecord('a'), modelRecord('b')] }, 'opencode': { displayName: 'opencode', models: [modelRecord('c')] } };
    const text = buildPatchText({ providersObj: providers, header: '', trailer: '' });
    const desired = desiredSix({ 'opencode-go': [], 'opencode': [modelRecord('c')] });
    const res = renderDesiredState({ patchBytes: Buffer.from(text, 'utf8'), storedConfig: { providers: providers }, desired: desired });
    checkCandidate(res, desired);
  });
  it('empty list as the last managed provider stays valid', () => {
    const providers = { 'opencode': { displayName: 'opencode', models: [modelRecord('c')] }, 'opencode-go': { displayName: 'opencode-go', models: [modelRecord('a')] } };
    const text = buildPatchText({ providersObj: providers, header: '', trailer: '' });
    const desired = desiredSix({ 'opencode': [modelRecord('c')], 'opencode-go': [] });
    const res = renderDesiredState({ patchBytes: Buffer.from(text, 'utf8'), storedConfig: { providers: providers }, desired: desired });
    checkCandidate(res, desired);
  });
});
