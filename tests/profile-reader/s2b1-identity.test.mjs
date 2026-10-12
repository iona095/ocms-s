// S2-B1 bounded identity repair — RED-first (P1-S2-R1).
// Verifies checkBinding rejects altered classification/entry, returns detached snapshot,
// validates structured identity without throwing. Synthetic fixtures only.
import { describe, it, beforeEach, afterEach } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { readManagedConfig } from '../../profile/config-reader.mjs';
import {
  assert,
  makeTempHome,
  sandboxDshHome,
  llmRow,
  modelsConfig,
  makeProfile,
  makeFixtureBundle,
  bindReal,
  readerOpts,
  snapshotTree,
  assertNoMutation,
  FIXTURE_LLM_NAME,
  FIXTURE_BUNDLE_PKG,
} from './helpers.mjs';

let home;
let cleanupHome;
let restoreDshHome;

function bind(name, extra = {}) {
  return bindReal(home, name, extra);
}

function userModels() {
  return modelsConfig({ opencode: [{ id: 'user-model' }] });
}

beforeEach(() => {
  restoreDshHome = sandboxDshHome();
  ({ home, cleanup: cleanupHome } = makeTempHome());
});

afterEach(() => {
  cleanupHome();
  restoreDshHome();
});

describe('S2-B1 bounded identity (P1-S2-R1)', () => {
  it('changed classification refuses STALE_TARGET', async () => {
    const profileDir = makeProfile(home, 'cls', { entries: [llmRow({ config: userModels() })], bundles: [FIXTURE_BUNDLE_PKG] });
    makeFixtureBundle(profileDir);
    const target = bind('cls');
    const flipped = target.classification === 'SCRATCH' ? 'PRODUCTION' : 'SCRATCH';
    const r = await readManagedConfig(readerOpts({ ...target, classification: flipped }));
    assert.equal(r.ok, false, 'expected refusal, got ' + JSON.stringify(r));
    assert.equal(r.code, 'STALE_TARGET');
  });

  it('changed entry name refuses STALE_TARGET', async () => {
    const profileDir = makeProfile(home, 'entry', { entries: [llmRow({ config: userModels() })], bundles: [FIXTURE_BUNDLE_PKG] });
    makeFixtureBundle(profileDir);
    const target = bind('entry');
    assert.equal(target.pluginEntryName, FIXTURE_LLM_NAME);
    const r = await readManagedConfig(readerOpts({ ...target, pluginEntryName: 'forged-entry-name' }));
    assert.equal(r.ok, false, 'expected refusal, got ' + JSON.stringify(r));
    assert.equal(r.code, 'STALE_TARGET');
  });

  it('absent-name fallback: genuine llm-pi-ai passes, forged name refuses', async () => {
    const profileDir = makeProfile(home, 'noname', { entries: [llmRow({ config: userModels(), name: null })], bundles: [FIXTURE_BUNDLE_PKG] });
    makeFixtureBundle(profileDir);
    const target = bind('noname');
    assert.equal(target.pluginEntryName, 'llm-pi-ai');
    const good = await readManagedConfig(readerOpts(target));
    assert.equal(good.ok, true, 'genuine fallback should succeed: ' + JSON.stringify(good));
    assert.equal(good.status, 'MATCHED');
    const bad = await readManagedConfig(readerOpts({ ...target, pluginEntryName: FIXTURE_LLM_NAME }));
    assert.equal(bad.ok, false, 'forged name should refuse, got ' + JSON.stringify(bad));
    assert.equal(bad.code, 'STALE_TARGET');
  });

  it('genuine target returns original successful result', async () => {
    const profileDir = makeProfile(home, 'genuine', { entries: [llmRow({ config: userModels() })], bundles: [FIXTURE_BUNDLE_PKG] });
    makeFixtureBundle(profileDir);
    const target = bind('genuine');
    const snap = snapshotTree(profileDir);
    const r = await readManagedConfig(readerOpts(target));
    assert.equal(r.ok, true, 'expected success: ' + JSON.stringify(r));
    assert.equal(r.status, 'MATCHED');
    assert.equal(r.patchDigest, target.patchDigest);
    assert.deepEqual(r.storedConfig, userModels());
    assert.deepEqual(r.effectiveConfig, userModels());
    assertNoMutation(snap, profileDir, 'genuine read mutated disk');
  });

  it('returned target is detached, not caller-owned reference', async () => {
    const profileDir = makeProfile(home, 'detach', { entries: [llmRow({ config: userModels() })], bundles: [FIXTURE_BUNDLE_PKG] });
    makeFixtureBundle(profileDir);
    const target = bind('detach');
    const r = await readManagedConfig(readerOpts(target));
    assert.equal(r.ok, true, 'expected success: ' + JSON.stringify(r));
    assert.notEqual(r.target, target, 'returned target must not be caller reference');
    assert.deepEqual(r.target, target, 'returned snapshot must be value-preserving');
    assert.notEqual(r.target.declaredOverlays, target.declaredOverlays);
    // liveAttestation null case: detached still holds (both null deepEqual, reference check vacuous)
    // so exercise object attestation detach below
  });

  it('caller mutates target after reading => returned identity unchanged', async () => {
    const profileDir = makeProfile(home, 'mutate', { entries: [llmRow({ config: userModels() })], bundles: [FIXTURE_BUNDLE_PKG] });
    makeFixtureBundle(profileDir);
    const target = bind('mutate', { declaredOverlays: [], liveAttestation: { mode: 'B', at: '2026-01-01T00:00:00.000Z' } });
    const r = await readManagedConfig(readerOpts(target));
    assert.equal(r.ok, true, 'expected success: ' + JSON.stringify(r));
    const beforeOverlays = JSON.stringify(r.target.declaredOverlays);
    const beforeAtt = JSON.stringify(r.target.liveAttestation);
    target.declaredOverlays.push('/tmp/evil.yml');
    target.liveAttestation.mode = 'MUTATED';
    target.liveAttestation.extra = 'evil';
    target.pluginEntryName = 'mutated-name';
    target.classification = target.classification === 'SCRATCH' ? 'PRODUCTION' : 'SCRATCH';
    assert.equal(JSON.stringify(r.target.declaredOverlays), beforeOverlays, 'overlays snapshot mutated');
    assert.equal(JSON.stringify(r.target.liveAttestation), beforeAtt, 'attestation snapshot mutated');
    assert.notEqual(r.target.pluginEntryName, target.pluginEntryName);
  });

  it('malformed structured identity refuses without throwing', async () => {
    const profileDir = makeProfile(home, 'malformed', { entries: [llmRow({ config: userModels() })], bundles: [FIXTURE_BUNDLE_PKG] });
    makeFixtureBundle(profileDir);
    const good = bind('malformed');
    const cases = [];
    cases.push({ ...good, liveAttestation: function () { return 1; } });
    cases.push({ ...good, liveAttestation: new Date() });
    cases.push({ ...good, liveAttestation: Symbol('s') });
    cases.push({ ...good, liveAttestation: 10n });
    cases.push({ ...good, liveAttestation: undefined });
    cases.push({ ...good, liveAttestation: { a: undefined } });
    cases.push({ ...good, liveAttestation: { n: NaN } });
    const sparse = new Array(2); sparse[1] = 'x';
    cases.push({ ...good, liveAttestation: sparse });
    const cyclic = { a: 1 }; cyclic.self = cyclic;
    cases.push({ ...good, liveAttestation: cyclic });
    cases.push({ ...good, liveAttestation: { f: function () {} } });
    for (let i = 0; i < cases.length; i++) {
      let r = null;
      let threw = null;
      try {
        r = await readManagedConfig(readerOpts(cases[i]));
      } catch (e) {
        threw = e;
      }
      assert.equal(threw, null, 'case ' + i + ' threw: ' + (threw && threw.message));
      assert.ok(r && r.ok === false, 'case ' + i + ' should refuse, got ' + JSON.stringify(r));
      assert.equal(r.code, 'STALE_TARGET', 'case ' + i + ' code');
    }
  });
});
