// S3-R2 admission — RED FIRST. Synthetic only; no production contact, no live roster.
import { describe, it, beforeEach, afterEach } from 'node:test';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { buildProfileAwarePlan } from '../../profile/plan-builder.mjs';
import { assert, minimalSources } from './helpers.mjs';
import { makeTempHome as makeS2Home, sandboxDshHome, llmRow, makeProfile, makeFixtureBundle, bindReal, readerOpts } from '../profile-reader/helpers.mjs';
import { readManagedConfig } from '../../profile/config-reader.mjs';

function sha(b) { return crypto.createHash('sha256').update(b).digest('hex'); }
function decoyText() { return '- id: llm-pi-ai\n  name: LLM Pi AI\n  config:\n    providers:\n      other:\n        displayName: other\n        models: []\n'; }
function validTarget(digest, overrides = {}) {
  return { profileName: 'fixture', profileDirReal: path.join(os.tmpdir(), 'ocms-s3-fixture-profile'), patchPathReal: path.join(os.tmpdir(), 'ocms-s3-fixture-profile', 'cordis.patch.yml'), pluginEntryName: 'LLM Pi AI', classification: 'SCRATCH', dshHomeReal: os.tmpdir(), patchDigest: digest, declaredOverlays: [], liveAttestation: null, ...overrides };
}
function validReader(target) {
  const bytes = Buffer.from(decoyText(), 'utf8');
  const digest = sha(bytes);
  const t = target || validTarget(digest);
  const stored = { providers: { other: { displayName: 'other', models: [] } } };
  return { ok: true, status: 'MATCHED', target: structuredClone(t), patchBytes: bytes, patchDigest: digest, storedConfig: structuredClone(stored), effectiveConfig: structuredClone(stored), effectiveDigest: digest, documentModel: { root: 'sequence', size: 1, rows: [{ id: 'llm-pi-ai' }] }, llmEntryIndex: 0, overriddenBy: [], warnings: [] };
}
function noCandidate(res, label) {
  assert.equal(res.ok, false, label + ' must be BLOCKED, got ' + JSON.stringify(res).slice(0, 400));
  assert.equal(res.status, 'BLOCKED', label + ' status');
  assert.ok(typeof res.code === 'string' && res.code, label + ' code');
  assert.ok(!('candidateBytes' in res) || res.candidateBytes === undefined, label + ' no candidateBytes');
  assert.ok(!('candidateText' in res) || res.candidateText === undefined, label + ' no candidateText');
}

describe('S3-R2 B1 unbound success never READY', () => {
  it('all three markers absent is BLOCKED', () => {
    const bytes = Buffer.from(decoyText(), 'utf8');
    const digest = sha(bytes);
    const reader = { patchBytes: bytes, patchDigest: digest, storedConfig: { providers: { other: { displayName: 'other', models: [] } } }, llmEntryIndex: 0, warnings: [] };
    const caller = { profileName: 'fixture', profileDirReal: path.join(os.tmpdir(), 'x'), patchPathReal: path.join(os.tmpdir(), 'x', 'cordis.patch.yml'), pluginEntryName: 'LLM Pi AI', classification: 'SCRATCH', patchDigest: digest, declaredOverlays: [], liveAttestation: null };
    const res = buildProfileAwarePlan({ target: caller, readerResult: reader, sources: minimalSources() });
    noCandidate(res, 'unbound');
  });
  it('only ok present is BLOCKED', () => {
    const rr = validReader(); delete rr.status; delete rr.target;
    const res = buildProfileAwarePlan({ target: validTarget(rr.patchDigest), readerResult: rr, sources: minimalSources() });
    noCandidate(res, 'only-ok');
  });
  it('only status present is BLOCKED', () => {
    const bytes = Buffer.from(decoyText(), 'utf8');
    const reader = { status: 'MATCHED', patchBytes: bytes, patchDigest: sha(bytes), storedConfig: { providers: { other: { displayName: 'other', models: [] } } }, llmEntryIndex: 0, warnings: [] };
    const res = buildProfileAwarePlan({ target: validTarget(sha(bytes)), readerResult: reader, sources: minimalSources() });
    noCandidate(res, 'only-status');
  });
  it('only target present is BLOCKED', () => {
    const bytes = Buffer.from(decoyText(), 'utf8');
    const digest = sha(bytes);
    const reader = { target: validTarget(digest), patchBytes: bytes, patchDigest: digest, storedConfig: { providers: { other: { displayName: 'other', models: [] } } }, llmEntryIndex: 0, warnings: [] };
    const res = buildProfileAwarePlan({ target: validTarget(digest), readerResult: reader, sources: minimalSources() });
    noCandidate(res, 'only-target');
  });
  it('ok:true missing status is BLOCKED', () => {
    const rr = validReader(); delete rr.status;
    const res = buildProfileAwarePlan({ target: structuredClone(rr.target), readerResult: rr, sources: minimalSources() });
    noCandidate(res, 'missing-status');
  });
  it('ok:true missing target is BLOCKED', () => {
    const rr = validReader(); delete rr.target;
    const res = buildProfileAwarePlan({ target: validTarget(rr.patchDigest), readerResult: rr, sources: minimalSources() });
    noCandidate(res, 'missing-target');
  });
  it('correct reader digest with incorrect target digest is BLOCKED', () => {
    const rr = validReader();
    const caller = structuredClone(rr.target); caller.patchDigest = 'f'.repeat(64);
    const res = buildProfileAwarePlan({ target: caller, readerResult: rr, sources: minimalSources() });
    noCandidate(res, 'target-digest');
  });
  it('missing dshHomeReal is BLOCKED', () => {
    const rr = validReader();
    const caller = structuredClone(rr.target); delete caller.dshHomeReal;
    const res = buildProfileAwarePlan({ target: caller, readerResult: rr, sources: minimalSources() });
    noCandidate(res, 'home-anchor');
  });
  it('incorrect llmEntryIndex is BLOCKED', () => {
    const rr = validReader(); rr.llmEntryIndex = 999;
    const res = buildProfileAwarePlan({ target: structuredClone(rr.target), readerResult: rr, sources: minimalSources() });
    noCandidate(res, 'index');
  });
  it('valid bytes with mismatched profile identity is BLOCKED', () => {
    const rr = validReader();
    const caller = structuredClone(rr.target); caller.profileName = 'WRONG';
    const res = buildProfileAwarePlan({ target: caller, readerResult: rr, sources: minimalSources() });
    noCandidate(res, 'identity');
  });
  it('WRONG PRODUCTION zero-digest index-999 unmarked is BLOCKED', () => {
    const bytes = Buffer.from(decoyText(), 'utf8');
    const digest = sha(bytes);
    const caller = { profileName: 'WRONG', profileDirReal: path.join(os.tmpdir(), 'w'), patchPathReal: path.join(os.tmpdir(), 'w', 'cordis.patch.yml'), pluginEntryName: 'WRONG', classification: 'PRODUCTION', patchDigest: '0'.repeat(64), declaredOverlays: [], liveAttestation: null };
    const reader = { patchBytes: bytes, patchDigest: digest, storedConfig: { providers: { other: { displayName: 'other', models: [] } } }, llmEntryIndex: 999, warnings: [] };
    const res = buildProfileAwarePlan({ target: caller, readerResult: reader, sources: minimalSources() });
    noCandidate(res, 'wrong-fixture');
    assert.ok(!('candidateBytes' in res), 'never candidate bytes');
  });
});

describe('S3-R2 B2 refusal preservation without patch bytes', () => {
  it('OVERRIDDEN without patchBytes preserves code', () => {
    const detail = { patchDigest: 'a'.repeat(64), effectiveDigest: 'b'.repeat(64), overriddenBy: [{ layer: 'home' }], managedRoutes: ['opencode'] };
    const res = buildProfileAwarePlan({ target: validTarget('a'.repeat(64)), readerResult: { ok: false, code: 'OVERRIDDEN', message: 'overridden', detail }, sources: minimalSources() });
    assert.equal(res.ok, false); assert.equal(res.status, 'BLOCKED'); assert.equal(res.code, 'OVERRIDDEN');
    assert.ok(!('candidateBytes' in res)); assert.ok(res.status !== 'READY' && res.status !== 'NO_CHANGE');
  });
  it('STALE_TARGET without patchBytes preserves code', () => {
    const res = buildProfileAwarePlan({ target: validTarget('a'.repeat(64)), readerResult: { ok: false, code: 'STALE_TARGET', message: 'stale', detail: { cause: 'x' } }, sources: minimalSources() });
    assert.equal(res.code, 'STALE_TARGET'); assert.equal(res.status, 'BLOCKED'); assert.ok(!('candidateBytes' in res));
  });
  it('NOT_PROFILE_OWNED without patchBytes preserves code', () => {
    const res = buildProfileAwarePlan({ target: validTarget('a'.repeat(64)), readerResult: { ok: false, code: 'NOT_PROFILE_OWNED', message: 'owned', detail: { source: 'home' } }, sources: minimalSources() });
    assert.equal(res.code, 'NOT_PROFILE_OWNED'); assert.equal(res.status, 'BLOCKED'); assert.ok(!('candidateBytes' in res));
  });
  it('refusal detail is detached', () => {
    const detail = { nested: { x: 1 }, arr: [1, 2] };
    const rr = { ok: false, code: 'OVERRIDDEN', message: 'm', detail };
    const res = buildProfileAwarePlan({ target: validTarget('a'.repeat(64)), readerResult: rr, sources: minimalSources() });
    assert.equal(res.code, 'OVERRIDDEN');
    detail.nested.x = 999; detail.arr.push(3);
    assert.deepEqual(res.detail, { nested: { x: 1 }, arr: [1, 2] });
  });
  it('no refused result yields plan', () => {
    for (const code of ['OVERRIDDEN', 'STALE_TARGET', 'NOT_PROFILE_OWNED']) {
      const res = buildProfileAwarePlan({ target: validTarget('a'.repeat(64)), readerResult: { ok: false, code, message: 'm' }, sources: minimalSources() });
      assert.equal(res.ok, false, code); assert.ok(res.status !== 'READY' && res.status !== 'NO_CHANGE', code);
      assert.ok(!('candidateBytes' in res) && !('desired' in res), code);
    }
  });
});

let s2home = null; let s2cleanup = null; let s2restore = null;
// genuine flow guard lives in R1 suite; R2 asserts reviewer can re-run it via existing test — no new network here.