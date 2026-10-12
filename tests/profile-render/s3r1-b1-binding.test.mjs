// S3-R1 B1 — Reader and target binding integrity (RED FIRST).
// Synthetic fixtures only; no production contact, no live roster.
import { describe, it, beforeEach, afterEach } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { buildProfileAwarePlan } from '../../profile/plan-builder.mjs';
import { sameTarget } from '../../profile/target-resolver.mjs';
import { readManagedConfig } from '../../profile/config-reader.mjs';
import { assert, minimalSources } from './helpers.mjs';
import { makeTempHome as makeS2Home, sandboxDshHome, llmRow, modelsConfig, makeProfile, makeFixtureBundle, bindReal, readerOpts, FIXTURE_LLM_NAME, FIXTURE_BUNDLE_PKG } from '../profile-reader/helpers.mjs';

function sha(b) { return crypto.createHash('sha256').update(b).digest('hex'); }

function decoyPatchText() {
  return '- id: llm-pi-ai\n  name: LLM Pi AI\n  config:\n    providers:\n      other:\n        displayName: other\n        models: []\n';
}
function readerStubValid(target) {
  const text = decoyPatchText();
  const bytes = Buffer.from(text, 'utf8');
  const digest = sha(bytes);
  const t = target ? structuredClone(target) : {
    profileName: 'fixture',
    profileDirReal: path.join(os.tmpdir(), 'ocms-s3-fixture-profile'),
    patchPathReal: path.join(os.tmpdir(), 'ocms-s3-fixture-profile', 'cordis.patch.yml'),
    pluginEntryName: 'LLM Pi AI',
    classification: 'SCRATCH',
    dshHomeReal: os.tmpdir(),
    patchDigest: digest,
    declaredOverlays: [],
    liveAttestation: null,
  };
  t.patchDigest = digest;
  return {
    ok: true,
    status: 'MATCHED',
    target: structuredClone(t),
    patchBytes: bytes,
    patchDigest: digest,
    documentModel: { root: 'sequence', size: 1, rows: [{ id: 'llm-pi-ai' }] },
    llmEntryIndex: 0,
    storedConfig: { providers: { other: { displayName: 'other', models: [] } } },
    effectiveConfig: { providers: { other: { displayName: 'other', models: [] } } },
    effectiveDigest: sha(Buffer.from(JSON.stringify({ providers: {} }), 'utf8')),
    overriddenBy: [],
    warnings: [],
  };
}

let home = null;
let cleanupHome = null;
let restoreDshHome = null;
beforeEach(() => { restoreDshHome = sandboxDshHome(); const h = makeS2Home(); home = h.home; cleanupHome = h.cleanup; });
afterEach(() => { cleanupHome(); restoreDshHome(); });

describe('S3-R1 B1 binding integrity', () => {
  it('S2 refusal with otherwise valid-looking fields cannot return READY', () => {
    const target = readerStubValid().target;
    const rr = readerStubValid(target);
    rr.ok = false;
    rr.code = 'OVERRIDDEN';
    rr.message = 'overridden';
    const res = buildProfileAwarePlan({ target: structuredClone(target), readerResult: rr, sources: minimalSources() });
    assert.equal(res.ok, false, 'refusal must not be READY, got ' + JSON.stringify(res).slice(0, 500));
    assert.notEqual(res.status, 'READY');
  });
  it('Different profile identity cannot return READY', () => {
    const rr = readerStubValid();
    const caller = structuredClone(rr.target);
    caller.profileName = 'other-profile';
    const res = buildProfileAwarePlan({ target: caller, readerResult: rr, sources: minimalSources() });
    assert.equal(res.ok, false, 'different profile must block, got ' + JSON.stringify(res).slice(0, 500));
    assert.notEqual(res.status, 'READY');
  });
  it('Changed plugin entry name cannot return READY', () => {
    const rr = readerStubValid();
    const caller = structuredClone(rr.target);
    caller.pluginEntryName = 'forged-entry';
    const res = buildProfileAwarePlan({ target: caller, readerResult: rr, sources: minimalSources() });
    assert.equal(res.ok, false, 'forged entry name must block, got ' + JSON.stringify(res).slice(0, 500));
  });
  it('Changed bound classification/home/overlay/attestation cannot return READY', () => {
    const base = readerStubValid();
    const cases = [];
    const c1 = structuredClone(base.target); c1.classification = c1.classification === 'SCRATCH' ? 'PRODUCTION' : 'SCRATCH'; cases.push(c1);
    const c2 = structuredClone(base.target); c2.dshHomeReal = path.join(os.tmpdir(), 'other-home-' + process.pid); cases.push(c2);
    const c3 = structuredClone(base.target); c3.declaredOverlays = ['/tmp/evil.yml']; cases.push(c3);
    const c4 = structuredClone(base.target); c4.liveAttestation = { mode: 'FORGED' }; cases.push(c4);
    for (const caller of cases) {
      const res = buildProfileAwarePlan({ target: caller, readerResult: base, sources: minimalSources() });
      assert.equal(res.ok, false, 'forged binding must block, got ' + JSON.stringify(res).slice(0, 500));
    }
  });
  it('Missing or different target patch digest cannot return READY', () => {
    const rr = readerStubValid();
    const missing = structuredClone(rr.target);
    delete missing.patchDigest;
    const r1 = buildProfileAwarePlan({ target: missing, readerResult: rr, sources: minimalSources() });
    assert.equal(r1.ok, false, 'missing digest must block');
    const diff = structuredClone(rr.target);
    diff.patchDigest = 'f'.repeat(64);
    const r2 = buildProfileAwarePlan({ target: diff, readerResult: rr, sources: minimalSources() });
    assert.equal(r2.ok, false, 'different digest must block, got ' + JSON.stringify(r2).slice(0, 300));
    const badReader = readerStubValid();
    badReader.patchDigest = 'e'.repeat(64);
    const r3 = buildProfileAwarePlan({ target: rr.target, readerResult: badReader, sources: minimalSources() });
    assert.equal(r3.ok, false, 'bad reader digest must block');
  });
  it('Incorrect reader entry index cannot return READY', () => {
    const rr = readerStubValid();
    rr.llmEntryIndex = 5;
    const res = buildProfileAwarePlan({ target: structuredClone(rr.target), readerResult: rr, sources: minimalSources() });
    assert.equal(res.ok, false, 'bad index must block, got ' + JSON.stringify(res).slice(0, 500));
  });
  it('Genuine synthetic S1->S2 admission can produce appropriate S3 state', async () => {
    const profileDir = makeProfile(home, 'genuine', { entries: [llmRow({ config: { providers: { other: { displayName: 'other', models: [] } } }, name: 'LLM Pi AI' })], bundles: [FIXTURE_BUNDLE_PKG] });
    makeFixtureBundle(profileDir);
    const target = bindReal(home, 'genuine');
    // Align entry name expectation: S1 binds pluginEntryName from patch name; patch uses LLM Pi AI
    const rr = await readManagedConfig(readerOpts(target));
    assert.equal(rr.ok, true, 'genuine S2 must succeed: ' + JSON.stringify(rr).slice(0, 800));
    const res = buildProfileAwarePlan({ target: structuredClone(target), readerResult: rr, sources: minimalSources() });
    assert.equal(res.ok, true, 'genuine S1->S2->S3 must succeed, got ' + JSON.stringify(res).slice(0, 800));
    assert.ok(res.status === 'READY' || res.status === 'NO_CHANGE', 'unexpected status ' + res.status);
  });
  it('Returned target detached from caller mutation', () => {
    const rr = readerStubValid();
    const caller = structuredClone(rr.target);
    caller.declaredOverlays = [];
    caller.liveAttestation = { mode: 'B' };
    const rr2 = readerStubValid(caller);
    // Ensure caller and reader share value but not reference for this test
    const inputTarget = structuredClone(caller);
    const res = buildProfileAwarePlan({ target: inputTarget, readerResult: rr2, sources: minimalSources() });
    assert.equal(res.ok, true, 'setup must be READY, got ' + JSON.stringify(res).slice(0, 500));
    const before = JSON.stringify(res.target);
    inputTarget.declaredOverlays.push('/tmp/evil.yml');
    inputTarget.liveAttestation.mode = 'MUTATED';
    inputTarget.profileName = 'mutated';
    assert.equal(JSON.stringify(res.target), before, 'result target mutated via caller');
    assert.notEqual(res.target, inputTarget, 'same reference');
  });
});
