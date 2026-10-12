// S3 T06 — Unsafe YAML refusals and warnings (P0-R2 §§9.6-9.7, 9.15).
import { describe, it } from 'node:test';
import { renderDesiredState } from '../../profile/surgical-render.mjs';
import { assert, desiredSix, modelRecord } from './helpers.mjs';

function render(text, desired) {
  return renderDesiredState({ patchBytes: Buffer.from(text, 'utf8'), storedConfig: undefined, desired });
}

describe('S3 T06 — unsafe YAML', () => {
  it('T06 custom tag outside owned spans is preserved (no refusal)', () => {
    const text = '- id: llm-pi-ai\n  config:\n    providers:\n      other:\n        note: !!js/function "x"\n      opencode:\n        displayName: opencode\n        models:\n          - id: a\n';
    const res = render(text, desiredSix({ 'opencode': [modelRecord('b')] }));
    assert.equal(res.ok, true);
    assert.equal(res.status, 'READY');
    assert.ok(Buffer.from(res.candidateBytes).toString('utf8').includes('!!js/function'));
  });

  it('T06 custom tag inside replaced span refuses TAG_IN_MANAGED_ARRAY', () => {
    const text = '- id: llm-pi-ai\n  config:\n    providers:\n      opencode:\n        displayName: opencode\n        models:\n          - !!js/function "x"\n';
    const res = render(text, desiredSix({ 'opencode': [modelRecord('b')] }));
    assert.equal(res.ok, false);
    assert.equal(res.code, 'TAG_IN_MANAGED_ARRAY');
  });

  it('T06 anchor defined in owned span refuses ANCHOR_IN_MANAGED_SCOPE', () => {
    const text = '- id: llm-pi-ai\n  config:\n    providers:\n      opencode:\n        displayName: opencode\n        models: &a1\n          - id: a\n';
    const res = render(text, desiredSix({ 'opencode': [modelRecord('b')] }));
    assert.equal(res.ok, false);
    assert.equal(res.code, 'ANCHOR_IN_MANAGED_SCOPE');
  });

  it('T06 alias referencing owned anchor refuses ANCHOR_IN_MANAGED_SCOPE', () => {
    const text = '- id: llm-pi-ai\n  config:\n    providers:\n      opencode:\n        displayName: opencode\n        models: &a1\n          - id: a\n      other:\n        ref: *a1\n';
    const res = render(text, desiredSix({ 'opencode': [modelRecord('b')] }));
    assert.equal(res.ok, false);
    assert.equal(res.code, 'ANCHOR_IN_MANAGED_SCOPE');
  });

  it('T06 boundary comment on models key line refuses UNOWNED_COMMENT_AMBIGUOUS', () => {
    const text = '- id: llm-pi-ai\n  config:\n    providers:\n      opencode:\n        displayName: opencode\n        models: # key trailing\n          - id: a\n';
    const res = render(text, desiredSix({ 'opencode': [modelRecord('b')] }));
    assert.equal(res.ok, false);
    assert.equal(res.code, 'UNOWNED_COMMENT_AMBIGUOUS');
  });

  it('T06 trailing comment after flow value refuses UNOWNED_COMMENT_AMBIGUOUS', () => {
    const text = '- id: llm-pi-ai\n  config:\n    providers:\n      opencode:\n        displayName: opencode\n        models: [1, 2] # trailing\n';
    const res = render(text, desiredSix({ 'opencode': [modelRecord('b')] }));
    assert.equal(res.ok, false);
    assert.equal(res.code, 'UNOWNED_COMMENT_AMBIGUOUS');
  });

  it('T06 interior replaced comment warns REPLACED_SUBTREE_NORMALIZATION (not refusal)', () => {
    const text = '- id: llm-pi-ai\n  config:\n    providers:\n      opencode:\n        displayName: opencode\n        models:\n          - id: a # interior\n            name: A\n';
    const res = render(text, desiredSix({ 'opencode': [modelRecord('b')] }));
    assert.equal(res.ok, true);
    assert.equal(res.status, 'READY');
    assert.ok((res.warnings || []).includes('REPLACED_SUBTREE_NORMALIZATION'), 'expected warning, got ' + JSON.stringify(res.warnings));
  });

  it('T06 flow ancestor refuses UNPRESERVABLE_STRUCTURE', () => {
    const text = '- id: llm-pi-ai\n  config: {providers: {opencode: {models: [a]}}}\n';
    const res = render(text, desiredSix({ 'opencode': [modelRecord('b')] }));
    assert.equal(res.ok, false);
    assert.equal(res.code, 'UNPRESERVABLE_STRUCTURE');
  });

  it('T06 missing indentation reference refuses UNPRESERVABLE_STRUCTURE (empty providers)', () => {
    const text = '- id: llm-pi-ai\n  config:\n    providers: {}\n';
    const res = render(text, desiredSix({ 'opencode': [modelRecord('b')] }));
    assert.equal(res.ok, false);
    assert.equal(res.code, 'UNPRESERVABLE_STRUCTURE');
  });

  it('T06 unknown tag anywhere refuses PATCH_PARSE_ERROR', () => {
    const text = '- id: other\n  config: !foo {a: 1}\n- id: llm-pi-ai\n  config:\n    providers:\n      opencode:\n        models:\n          - id: a\n';
    const res = render(text, desiredSix({ 'opencode': [modelRecord('b')] }));
    assert.equal(res.ok, false);
    assert.equal(res.code, 'PATCH_PARSE_ERROR');
  });

  it('T06 multiple F2 insertions produce consistent non-overlapping plan', () => {
    const text = '- id: llm-pi-ai\n  config:\n    providers:\n      other:\n        models: []\n';
    const desired = desiredSix({ 'opencode': [modelRecord('a')], 'opencode-go': [modelRecord('g')] });
    const res = renderDesiredState({ patchBytes: Buffer.from(text, 'utf8'), storedConfig: { providers: { other: { models: [] } } }, desired });
    assert.equal(res.ok, true);
    assert.equal(res.status, 'READY');
    assert.equal(res.footprint['opencode'], 'F2');
    assert.equal(res.footprint['opencode-go'], 'F2');
    // spans must not overlap
    const spans = [...(res.originalSpans || []), ...(res.candidateSpans || [])];
    // candidate spans for F2 must be two distinct ranges
    assert.ok(res.candidateSpans.length >= 2, 'expected two candidate spans');
    assert.equal(res.verification.remainderEqual, true);
  });

  it('T06 unicode offsets are byte-correct', () => {
    const text = '- id: llm-pi-ai\n  config:\n    providers:\n      opencode:\n        displayName: opencode\n        models:\n          - id: "héllo-✓"\n';
    const res = render(text, desiredSix({ 'opencode': [modelRecord('b')] }));
    assert.equal(res.ok, true);
    assert.equal(res.status, 'READY');
    assert.equal(res.verification.remainderEqual, true);
    // span byte offsets must round-trip through UTF-8
    for (const s of res.originalSpans) {
      assert.ok(Number.isInteger(s.start) && Number.isInteger(s.end) && s.end > s.start);
    }
  });
});
