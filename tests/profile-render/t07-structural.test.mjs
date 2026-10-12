// S3 T07 — Structural refusals (P0-R2 §§9.3-9.4, 9.13).
import { describe, it } from 'node:test';
import { renderDesiredState } from '../../profile/surgical-render.mjs';
import { assert, desiredSix, modelRecord } from './helpers.mjs';

describe('S3 T07 — structural refusals', () => {
  it('T07 unparsable YAML refuses PATCH_PARSE_ERROR', () => {
    const res = renderDesiredState({ patchBytes: Buffer.from('- id: [unclosed\n  bad: : :\n', 'utf8'), storedConfig: undefined, desired: desiredSix({}) });
    assert.equal(res.ok, false);
    assert.equal(res.code, 'PATCH_PARSE_ERROR');
  });
  it('T07 non-sequence root refuses PATCH_ROOT_NOT_SEQUENCE', () => {
    const res = renderDesiredState({ patchBytes: Buffer.from('a: 1\n', 'utf8'), storedConfig: undefined, desired: desiredSix({}) });
    assert.equal(res.ok, false);
    assert.equal(res.code, 'PATCH_ROOT_NOT_SEQUENCE');
  });
  it('T07 missing llm-pi-ai refuses PLUGIN_ENTRY_MISSING', () => {
    const res = renderDesiredState({ patchBytes: Buffer.from('- id: other\n  config: {}\n', 'utf8'), storedConfig: undefined, desired: desiredSix({}) });
    assert.equal(res.ok, false);
    assert.equal(res.code, 'PLUGIN_ENTRY_MISSING');
  });
  it('T07 duplicate llm-pi-ai refuses PLUGIN_ENTRY_DUPLICATE', () => {
    const text = '- id: llm-pi-ai\n  config:\n    providers: {}\n- id: llm-pi-ai\n  config:\n    providers: {}\n';
    const res = renderDesiredState({ patchBytes: Buffer.from(text, 'utf8'), storedConfig: undefined, desired: desiredSix({}) });
    assert.equal(res.ok, false);
    assert.equal(res.code, 'PLUGIN_ENTRY_DUPLICATE');
  });
  it('T07 non-mapping config refuses SETTINGS_INVALID', () => {
    const text = '- id: llm-pi-ai\n  config: scalar\n';
    const res = renderDesiredState({ patchBytes: Buffer.from(text, 'utf8'), storedConfig: undefined, desired: desiredSix({ 'opencode': [modelRecord('a')] }) });
    assert.equal(res.ok, false);
    assert.equal(res.code, 'SETTINGS_INVALID');
  });
  it('T07 non-mapping providers refuses SETTINGS_INVALID', () => {
    const text = '- id: llm-pi-ai\n  config:\n    providers: []\n';
    const res = renderDesiredState({ patchBytes: Buffer.from(text, 'utf8'), storedConfig: undefined, desired: desiredSix({ 'opencode': [modelRecord('a')] }) });
    assert.equal(res.ok, false);
    assert.equal(res.code, 'SETTINGS_INVALID');
  });
  it('T07 non-array models refuses SETTINGS_INVALID', () => {
    const text = '- id: llm-pi-ai\n  config:\n    providers:\n      opencode:\n        displayName: opencode\n        models: {} \n';
    const res = renderDesiredState({ patchBytes: Buffer.from(text, 'utf8'), storedConfig: undefined, desired: desiredSix({ 'opencode': [modelRecord('a')] }) });
    assert.equal(res.ok, false);
    assert.equal(res.code, 'SETTINGS_INVALID');
  });
  it('T07 generated membership mismatch is typed (candidate must equal desired)', () => {
    // This is exercised via verification: if desired has dupes, membership refuses before render.
    const text = '- id: llm-pi-ai\n  config:\n    providers:\n      opencode:\n        models: []\n';
    const desired = desiredSix({ 'opencode': [modelRecord('x')], 'opencode-messages': [modelRecord('x')] });
    const res = renderDesiredState({ patchBytes: Buffer.from(text, 'utf8'), storedConfig: { providers: { 'opencode': { models: [] } } }, desired });
    assert.equal(res.ok, false);
    assert.ok(['MEMBERSHIP_MISMATCH', 'GENERATED_MEMBERSHIP_MISMATCH'].includes(res.code));
  });
});
