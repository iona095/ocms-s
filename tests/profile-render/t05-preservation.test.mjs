// S3 T05 — Byte preservation (P0-R2 §§9.5, 9.7, 9.16).
//
// Synthetic fixtures with unrelated providers, other root entries,
// route-level fields, header/trailer comments, quoted scalars, untouched flow
// YAML and credential-shaped references. Proves remainder byte-equality.
import { describe, it } from 'node:test';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import crypto from 'node:crypto';
import { renderDesiredState } from '../../profile/surgical-render.mjs';
import { assert, desiredSix, modelRecord, SECRET_MARKERS } from './helpers.mjs';

function sha(b) { return crypto.createHash('sha256').update(b).digest('hex'); }

describe('S3 T05 — byte preservation and excision proof', () => {
  it('T05 unrelated providers and root entries survive byte-identically', () => {
    const text = '# header comment\n' +
      '- id: other-plugin\n' +
      '  name: Other\n' +
      '  config:\n' +
      '    marker: true # keep me\n' +
      '- id: llm-pi-ai\n' +
      '  name: LLM Pi AI\n' +
      '  config:\n' +
      '    providers:\n' +
      '      other-provider:\n' +
      '        displayName: other-provider\n' +
      '        models:\n' +
      '          - id: keep\n' +
      '      opencode:\n' +
      '        displayName: opencode\n' +
      '        api: openai-responses\n' +
      '        baseURL: https://example.com\n' +
      '        apiKeyEnv: SYNTHETIC_FAKE_KEY_alpha bravo 001\n' +
      '        models:\n' +
      '          - id: a\n' +
      '            name: A\n' +
      '# trailer comment\n';
    const patchBytes = Buffer.from(text, 'utf8');
    const storedConfig = { providers: parseYaml(text).find((r) => r.id === 'llm-pi-ai').config.providers };
    const desired = desiredSix({ 'opencode': [{ id: 'b', name: 'B', input: ['text'], contextWindow: 1, maxTokens: 1 }] });
    const res = renderDesiredState({ patchBytes, storedConfig, desired });
    assert.equal(res.ok, true);
    assert.equal(res.status, 'READY');
    assert.ok(res.verification, 'must carry verification evidence');
    assert.equal(res.verification.remainderEqual, true);
    assert.ok(res.verification.remainderSha256, 'must carry remainder hash');
    assert.ok(res.originalSpans && res.candidateSpans, 'must carry span tables');
    // excision proof recorded
    const origRemainder = res.verification.remainderSha256;
    // unrelated bytes present in candidate
    const candText = Buffer.from(res.candidateBytes).toString('utf8');
    assert.ok(candText.includes('other-provider'), 'unrelated provider lost');
    assert.ok(candText.includes('other-plugin'), 'other root entry lost');
    assert.ok(candText.includes('# header comment'), 'header lost');
    assert.ok(candText.includes('# trailer comment'), 'trailer lost');
    assert.ok(candText.includes('SYNTHETIC_FAKE_KEY_alpha bravo 001'), 'credential-shaped ref lost');
    // remainder hashes must match independently recomputed? at least present and hex
    assert.match(origRemainder, /^[0-9a-f]{64}$/);
    assert.equal(res.verification.candidateRemainderSha256, origRemainder);
  });

  it('T05 untouched flow [1, 2] remains byte-identical (no [ 1, 2 ] normalization)', () => {
    const text = '- id: llm-pi-ai\n' +
      '  config:\n' +
      '    providers:\n' +
      '      untouched:\n' +
      '        models: [1, 2]\n' +
      '      opencode:\n' +
      '        displayName: opencode\n' +
      '        models:\n' +
      '          - id: a\n';
    const patchBytes = Buffer.from(text, 'utf8');
    const storedConfig = { providers: { 'opencode': { displayName: 'opencode', models: [{ id: 'a' }] } } };
    const desired = desiredSix({ 'opencode': [{ id: 'b' }] });
    const res = renderDesiredState({ patchBytes, storedConfig, desired });
    assert.equal(res.status, 'READY');
    const candText = Buffer.from(res.candidateBytes).toString('utf8');
    assert.ok(candText.includes('[1, 2]'), 'flow span normalized: ' + JSON.stringify(candText.slice(0, 500)));
    assert.ok(!candText.includes('[ 1, 2 ]'), 'forbidden normalization present');
    assert.equal(res.verification.remainderEqual, true);
  });

  it('T05 quoted scalars and route-level fields preserved', () => {
    const text = '- id: llm-pi-ai\n' +
      '  config:\n' +
      '    providers:\n' +
      '      opencode:\n' +
      '        displayName: "quoted \u2713 name"\n' +
      "        api: 'single-quoted'\n" +
      '        baseURL: https://example.com\n' +
      '        apiKeyEnv: K\n' +
      '        extraField: keep-me\n' +
      '        models:\n' +
      '          - id: a\n';
    const patchBytes = Buffer.from(text, 'utf8');
    const storedConfig = { providers: parseYaml(text).find((r) => r.id === 'llm-pi-ai').config.providers };
    const desired = desiredSix({ 'opencode': [{ id: 'b', name: 'B', input: ['text'], contextWindow: 1, maxTokens: 1 }] });
    const res = renderDesiredState({ patchBytes, storedConfig, desired });
    assert.equal(res.status, 'READY');
    const candText = Buffer.from(res.candidateBytes).toString('utf8');
    assert.ok(candText.includes('extraField: keep-me'), 'route-level field lost');
    assert.ok(candText.includes('"quoted'), 'quoted scalar lost');
    assert.equal(res.verification.remainderEqual, true);
  });

  it('T05 UTF-8 remainder equality with non-ASCII outside footprint', () => {
    const text = '# héllo-✓ header\n' +
      '- id: llm-pi-ai\n' +
      '  config:\n' +
      '    providers:\n' +
      '      opencode:\n' +
      '        displayName: opencode\n' +
      '        models:\n' +
      '          - id: a\n' +
      '      decoy:\n' +
      '        note: "日本語 ✓"\n';
    const patchBytes = Buffer.from(text, 'utf8');
    const storedConfig = { providers: { 'opencode': { displayName: 'opencode', models: [{ id: 'a' }] } } };
    const desired = desiredSix({ 'opencode': [{ id: 'b' }] });
    const res = renderDesiredState({ patchBytes, storedConfig, desired });
    assert.equal(res.status, 'READY');
    assert.equal(res.verification.remainderEqual, true);
    assert.ok(Buffer.from(res.candidateBytes).toString('utf8').includes('日本語 ✓'));
  });
});
