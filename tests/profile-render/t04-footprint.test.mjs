// S3 T04 — Desired arrays and F0/F1/F1-add/F2 (P0-R2 §9.14; P1-A §5 S3).
//
// Covers all six routes, cases A–F, reordering, field changes, empty arrays,
// missing route/key, legitimate compat, duplicates and non-ASCII identifiers.
// Synthetic fixtures only; no production contact.
import { describe, it, beforeEach, afterEach } from 'node:test';
import { stringify as stringifyYaml, parse as parseYaml } from 'yaml';
import { isDeepStrictEqual } from 'node:util';
import { renderDesiredState, classifyFootprint, MANAGED_ROUTE_KEYS } from '../../profile/surgical-render.mjs';
import { assert, desiredSix, modelRecord, buildPatchText, sha256Hex } from './helpers.mjs';

function patchWithProviders(providersObj) {
  const text = buildPatchText({ providersObj, header: '', trailer: '' });
  return Buffer.from(text, 'utf8');
}

function storedOf(providersObj) {
  // storedConfig shape: { providers: {...} }
  return { providers: providersObj };
}

describe('S3 T04 — footprint classification and rendering', () => {
  it('T04 F0: identical arrays (including order/fields) classify F0 and render NO_CHANGE', () => {
    const providers = {
      'opencode-go': { displayName: 'opencode-go', models: [modelRecord('a')] },
      'opencode': { displayName: 'opencode', models: [] },
    };
    const stored = storedOf(providers);
    const desired = desiredSix({
      'opencode-go': [modelRecord('a')],
      'opencode': [],
      'opencode-go-messages': [],
      'opencode-go-responses': [],
      'opencode-completions': [],
      'opencode-messages': [],
    });
    const fp = classifyFootprint({ storedConfig: stored, desired });
    assert.equal(fp['opencode-go'], 'F0');
    // all-F0 with absent routes + empty desired is also F0
    for (const r of MANAGED_ROUTE_KEYS) assert.ok(['F0'].includes(fp[r]) || fp[r] === 'F0', 'route ' + r + ' should be F0, got ' + fp[r]);
    const res = renderDesiredState({ patchBytes: patchWithProviders(providers), storedConfig: stored, desired });
    assert.equal(res.ok, true);
    assert.equal(res.status, 'NO_CHANGE');
    assert.ok(!res.candidateBytes, 'NO_CHANGE must carry no candidate');
  });

  it('T04 case A (F1): existing models differ → REPLACE value only', () => {
    const providers = {
      'opencode': { displayName: 'opencode', api: 'openai-responses', baseURL: 'https://example.com', apiKeyEnv: 'K', models: [modelRecord('a')] },
    };
    const stored = storedOf(providers);
    const desired = desiredSix({ 'opencode': [modelRecord('b')] });
    const fp = classifyFootprint({ storedConfig: stored, desired });
    assert.equal(fp['opencode'], 'F1');
    const res = renderDesiredState({ patchBytes: patchWithProviders(providers), storedConfig: stored, desired });
    assert.equal(res.ok, true);
    assert.equal(res.status, 'READY');
    assert.ok(res.candidateBytes, 'READY must carry candidate');
    // candidate six arrays must equal desired (independent re-parse)
    const candText = Buffer.from(res.candidateBytes).toString('utf8');
    const candRows = parseYaml(candText);
    const candEntry = candRows.find((r) => r && r.id === 'llm-pi-ai');
    assert.ok(candEntry, 'candidate must retain llm-pi-ai entry');
    assert.deepEqual(candEntry.config.providers['opencode'].models, [modelRecord('b')]);
    // route-level fields preserved
    assert.equal(candEntry.config.providers['opencode'].displayName, 'opencode');
    assert.equal(res.footprint['opencode'], 'F1');
  });

  it('T04 case B (F1 empty): removal lands as models: [] with route intact', () => {
    const providers = {
      'opencode': { displayName: 'opencode', api: 'x', baseURL: 'https://e.com', apiKeyEnv: 'K', models: [modelRecord('a'), modelRecord('b')] },
    };
    const stored = storedOf(providers);
    const desired = desiredSix({ 'opencode': [] });
    assert.equal(classifyFootprint({ storedConfig: stored, desired })['opencode'], 'F1');
    const res = renderDesiredState({ patchBytes: patchWithProviders(providers), storedConfig: stored, desired });
    assert.equal(res.status, 'READY');
    const candRows = parseYaml(Buffer.from(res.candidateBytes).toString('utf8'));
    const candEntry = candRows.find((r) => r && r.id === 'llm-pi-ai');
    assert.deepEqual(candEntry.config.providers['opencode'].models, []);
    assert.ok(candEntry.config.providers['opencode'].displayName, 'route must remain');
  });

  it('T04 case C (F1-add): existing route lacks models key → add exactly that key', () => {
    const providers = {
      'opencode': { displayName: 'opencode', api: 'x', baseURL: 'https://e.com', apiKeyEnv: 'K' },
    };
    const stored = storedOf(providers);
    const desired = desiredSix({ 'opencode': [modelRecord('n1')] });
    assert.equal(classifyFootprint({ storedConfig: stored, desired })['opencode'], 'F1-add');
    const res = renderDesiredState({ patchBytes: patchWithProviders(providers), storedConfig: stored, desired });
    assert.equal(res.status, 'READY');
    const candRows = parseYaml(Buffer.from(res.candidateBytes).toString('utf8'));
    assert.deepEqual(candRows.find((r) => r.id === 'llm-pi-ai').config.providers['opencode'].models, [modelRecord('n1')]);
    // desired [] also adds key
    const desiredEmpty = desiredSix({ 'opencode': [] });
    assert.equal(classifyFootprint({ storedConfig: stored, desired: desiredEmpty })['opencode'], 'F1-add');
    const res2 = renderDesiredState({ patchBytes: patchWithProviders(providers), storedConfig: stored, desired: desiredEmpty });
    assert.equal(res2.status, 'READY');
    assert.deepEqual(parseYaml(Buffer.from(res2.candidateBytes).toString('utf8')).find((r) => r.id === 'llm-pi-ai').config.providers['opencode'].models, []);
  });

  it('T04 case D (F0): absent route with empty desired creates nothing', () => {
    const providers = {};
    const stored = storedOf(providers);
    const desired = desiredSix({});
    assert.equal(classifyFootprint({ storedConfig: stored, desired })['opencode'], 'F0');
    const res = renderDesiredState({ patchBytes: patchWithProviders(providers), storedConfig: stored, desired });
    assert.equal(res.status, 'NO_CHANGE');
  });

  it('T04 case E (F2): absent route with non-empty desired creates minimal 5-key route', () => {
    const providers = { 'other': { displayName: 'other', models: [] } };
    const stored = storedOf(providers);
    const desired = desiredSix({ 'opencode-go': [modelRecord('g1')] });
    assert.equal(classifyFootprint({ storedConfig: stored, desired })['opencode-go'], 'F2');
    const res = renderDesiredState({ patchBytes: patchWithProviders(providers), storedConfig: stored, desired });
    assert.equal(res.status, 'READY');
    const candEntry = parseYaml(Buffer.from(res.candidateBytes).toString('utf8')).find((r) => r.id === 'llm-pi-ai');
    const created = candEntry.config.providers['opencode-go'];
    assert.deepEqual(Object.keys(created).sort(), ['api', 'apiKeyEnv', 'baseURL', 'displayName', 'models'].sort());
    assert.deepEqual(created.models, [modelRecord('g1')]);
    // decoy preserved
    assert.ok(candEntry.config.providers['other'], 'decoy lost');
  });

  it('T04 reordering is F1 (order matters)', () => {
    const providers = { 'opencode': { displayName: 'opencode', models: [modelRecord('a'), modelRecord('b')] } };
    const stored = storedOf(providers);
    const desired = desiredSix({ 'opencode': [modelRecord('b'), modelRecord('a')] });
    assert.equal(classifyFootprint({ storedConfig: stored, desired })['opencode'], 'F1');
    const res = renderDesiredState({ patchBytes: patchWithProviders(providers), storedConfig: stored, desired });
    assert.equal(res.status, 'READY');
    assert.deepEqual(parseYaml(Buffer.from(res.candidateBytes).toString('utf8')).find((r) => r.id === 'llm-pi-ai').config.providers['opencode'].models, [modelRecord('b'), modelRecord('a')]);
  });

  it('T04 field change is F1', () => {
    const providers = { 'opencode': { displayName: 'opencode', models: [{ ...modelRecord('a'), name: 'Old' }] } };
    const stored = storedOf(providers);
    const desired = desiredSix({ 'opencode': [{ ...modelRecord('a'), name: 'New' }] });
    assert.equal(classifyFootprint({ storedConfig: stored, desired })['opencode'], 'F1');
  });

  it('T04 legitimate compat is carried (not a mismatch)', () => {
    const withCompat = { ...modelRecord('a'), compat: { note: 'keep' } };
    const providers = { 'opencode': { displayName: 'opencode', models: [withCompat] } };
    const stored = storedOf(providers);
    const desired = desiredSix({ 'opencode': [withCompat] });
    assert.equal(classifyFootprint({ storedConfig: stored, desired })['opencode'], 'F0');
  });

  it('T04 duplicate managed IDs refuse MEMBERSHIP_MISMATCH', () => {
    const providers = { 'opencode': { displayName: 'opencode', models: [] }, 'opencode-messages': { displayName: 'opencode-messages', models: [] } };
    const stored = storedOf(providers);
    // same id in two zen routes (both zen gateway) must refuse
    const desired = desiredSix({ 'opencode': [modelRecord('dup')], 'opencode-messages': [modelRecord('dup')] });
    const res = renderDesiredState({ patchBytes: patchWithProviders(providers), storedConfig: stored, desired });
    assert.equal(res.ok, false);
    assert.ok(['MEMBERSHIP_MISMATCH', 'GENERATED_MEMBERSHIP_MISMATCH'].includes(res.code), 'got ' + res.code);
  });

  it('T04 non-ASCII identifiers round-trip', () => {
    const uni = modelRecord('héllo-✓-日本');
    const providers = { 'opencode': { displayName: 'opencode', models: [] } };
    const stored = storedOf(providers);
    const desired = desiredSix({ 'opencode': [uni] });
    const res = renderDesiredState({ patchBytes: patchWithProviders(providers), storedConfig: stored, desired });
    assert.equal(res.status, 'READY');
    const got = parseYaml(Buffer.from(res.candidateBytes).toString('utf8')).find((r) => r.id === 'llm-pi-ai').config.providers['opencode'].models;
    assert.deepEqual(got, [uni]);
    // byte offsets must be correct: candidate must decode to same unicode
    assert.ok(Buffer.from(res.candidateBytes).toString('utf8').includes('héllo-✓-日本'));
  });

  it('T04 all six routes classified independently', () => {
    const providers = {
      'opencode-go': { displayName: 'opencode-go', models: [modelRecord('a')] },
      'opencode-go-messages': { displayName: 'opencode-go-messages', models: [] },
      'opencode-messages': { displayName: 'opencode-messages' },
    };
    const stored = storedOf(providers);
    const desired = desiredSix({
      'opencode-go': [modelRecord('a')],
      'opencode-go-messages': [modelRecord('x')],
      'opencode-messages': [modelRecord('y')],
      'opencode': [modelRecord('z')],
    });
    const fp = classifyFootprint({ storedConfig: stored, desired });
    assert.equal(fp['opencode-go'], 'F0');
    assert.equal(fp['opencode-go-messages'], 'F1');
    assert.equal(fp['opencode-messages'], 'F1-add');
    assert.equal(fp['opencode'], 'F2');
    assert.equal(fp['opencode-go-responses'], 'F0');
    assert.equal(fp['opencode-completions'], 'F0');
  });
});
