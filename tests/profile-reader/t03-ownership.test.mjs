// S2 T03 — ownership, stored/effective distinction, override attribution
// (P0-R2 §§8.2, 8.4–8.5; P1-A §5 S2).
//
// Dormant owned rows are admitted; outer-layer-only definitions refuse
// NOT_PROFILE_OWNED with attribution; later-layer managed overrides surface
// stored vs effective with both digests. Fixtures synthetic; no live contact.
import { describe, it, beforeEach, afterEach } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import { readManagedConfig } from '../../profile/config-reader.mjs';
import {
  assert,
  makeTempHome,
  sandboxDshHome,
  sha256Hex,
  decoyRow,
  llmRow,
  modelsConfig,
  makeProfile,
  makeFixtureBundle,
  bindReal,
  readerOpts,
  requireRealCompositionOrSkip,
  snapshotTree,
  assertNoMutation,
  FIXTURE_LLM_NAME,
  FIXTURE_BUNDLE_PKG,
} from './helpers.mjs';

let home;
let cleanupHome;
let restoreDshHome;

function bind(name) {
  return bindReal(home, name);
}

beforeEach(() => {
  restoreDshHome = sandboxDshHome();
  ({ home, cleanup: cleanupHome } = makeTempHome());
});

afterEach(() => {
  cleanupHome();
  restoreDshHome();
});

function userModels() {
  return modelsConfig({ opencode: [{ id: 'user-model', name: 'User' }] });
}

describe('S2 T03 — ownership and stored/effective distinction', () => {
  it('T03 dormant owned row reads MATCHED with undefined configs', async () => {
    const profileDir = makeProfile(home, 'dormant', { entries: [llmRow({ config: 'absent' }), decoyRow('x')], bundles: [FIXTURE_BUNDLE_PKG] });
    makeFixtureBundle(profileDir);
    const snap = snapshotTree(profileDir);
    const r = await readManagedConfig(readerOpts(bind('dormant')));
    assert.equal(r.ok, true, `expected success: ${JSON.stringify(r)}`);
    assert.equal(r.status, 'MATCHED');
    assert.equal(r.storedConfig, undefined);
    assert.equal(r.effectiveConfig, undefined);
    assert.deepEqual(r.overriddenBy, []);
    assert.equal(typeof r.effectiveDigest, 'string');
    assert.equal(r.effectiveDigest.length, 64);
    assertNoMutation(snap, profileDir, 'T03 dormant: read mutated disk');
  });

  it('T03 dormant user with bundle-supplied config refuses NOT_PROFILE_OWNED', async () => {    const profileDir = makeProfile(home, 'bundled', { entries: [llmRow({ config: 'absent' })], bundles: [FIXTURE_BUNDLE_PKG] });
    makeFixtureBundle(profileDir, FIXTURE_BUNDLE_PKG, {
      insertRows: [
        { id: 'llm-pi-ai', name: FIXTURE_LLM_NAME, config: userModels() },
      ],
    });
    const snap = snapshotTree(profileDir);
    const r = await readManagedConfig(readerOpts(bind('bundled')));
    assert.equal(r.ok, false);
    assert.equal(r.code, 'NOT_PROFILE_OWNED');
    assertNoMutation(snap, profileDir, 'T03 bundle-owned: read mutated disk');
  });

  it('T03 home-only definition refuses NOT_PROFILE_OWNED with home attribution', async (t) => {
    if (!requireRealCompositionOrSkip(t, 'real DSH home-layer composition semantics')) return;
    // No user row at all; the home layer alone supplies managed arrays.
    // S1 refuses this shape at admission, so the binding is transplanted
    // from a valid donor: S2 discovers current bytes, never trusts shape.
    const profileDir = makeProfile(home, 'homeonly', { entries: [decoyRow('x')], bundles: [FIXTURE_BUNDLE_PKG] });
    makeFixtureBundle(profileDir);
    const donorDir = makeProfile(home, 'homeonly-donor', { entries: [llmRow(), decoyRow('x')], bundles: [FIXTURE_BUNDLE_PKG] });
    makeFixtureBundle(donorDir);
    const donor = bind('homeonly-donor');
    const patchPath = path.join(profileDir, 'cordis.patch.yml');
    const forged = {
      ...donor,
      profileName: 'homeonly',
      profileDirReal: fs.realpathSync(profileDir),
      patchPathReal: fs.realpathSync(patchPath),
      patchDigest: sha256Hex(fs.readFileSync(patchPath)),
    };
    fs.writeFileSync(
      path.join(home, 'cordis.patch.yml'),
      stringifyYaml([{ id: 'llm-pi-ai', name: FIXTURE_LLM_NAME, config: userModels() }]),
      'utf8',
    );
    const snap = snapshotTree(profileDir);
    const r = await readManagedConfig(readerOpts(forged));
    assert.equal(r.ok, false, `expected NOT_PROFILE_OWNED: ${JSON.stringify(r)}`);
    assert.equal(r.code, 'NOT_PROFILE_OWNED');
    assert.equal(r.detail.source, 'home');
    assert.deepEqual(r.detail.effectiveFrom, {
      layer: 'home',
      source: path.join(fs.realpathSync(home), 'cordis.patch.yml'),
    });
    assertNoMutation(snap, profileDir, 'T03 home-only: read mutated disk');
  });

  it('T03 later home layer replacing managed arrays reports OVERRIDDEN with attribution', async (t) => {
    if (!requireRealCompositionOrSkip(t, 'real DSH home-layer composition semantics')) return;
    const profileDir = makeProfile(home, 'homeoverride', { entries: [llmRow({ config: userModels() })], bundles: [FIXTURE_BUNDLE_PKG] });
    makeFixtureBundle(profileDir);
    const target = bind('homeoverride');
    // The home layer appears after binding: absorbed never, attributed always.
    fs.writeFileSync(
      path.join(home, 'cordis.patch.yml'),
      stringifyYaml([{ id: 'llm-pi-ai', name: FIXTURE_LLM_NAME, config: modelsConfig({ opencode: [{ id: 'home-model' }] }) }]),
      'utf8',
    );
    const snap = snapshotTree(profileDir);
    const r = await readManagedConfig(readerOpts(target));
    assert.equal(r.ok, false, `expected OVERRIDDEN: ${JSON.stringify(r)}`);
    assert.equal(r.code, 'OVERRIDDEN');
    assert.equal(r.detail.patchDigest, target.patchDigest);
    assert.equal(typeof r.detail.effectiveDigest, 'string');
    assert.deepEqual(r.detail.overriddenBy, [{ layer: 'home', source: path.join(fs.realpathSync(home), 'cordis.patch.yml') }]);
    assert.ok((r.detail.managedRoutes ?? []).includes('opencode'));
    assertNoMutation(snap, profileDir, 'T03 home override: read mutated disk');
  });

  it('T03 home layer with identical managed content stays MATCHED', async () => {
    const profileDir = makeProfile(home, 'homesame', { entries: [llmRow({ config: userModels() })], bundles: [FIXTURE_BUNDLE_PKG] });
    makeFixtureBundle(profileDir);
    const target = bind('homesame');
    fs.writeFileSync(path.join(home, 'cordis.patch.yml'), stringifyYaml([
      { id: 'llm-pi-ai', name: FIXTURE_LLM_NAME, config: userModels() },
    ]), 'utf8');
    const snap = snapshotTree(profileDir);
    const r = await readManagedConfig(readerOpts(target));
    assert.equal(r.ok, true, `expected success: ${JSON.stringify(r)}`);
    assert.equal(r.status, 'MATCHED');
    assert.deepEqual(r.overriddenBy, []);
    assertNoMutation(snap, profileDir, 'T03 home identical: read mutated disk');
  });

  it('T03 bundle order decides the effective config (dormant user refuses with source)', async () => {
    // One base bundle mounts the row dormant; supplier bundles configure it
    // with id-targeted rows — the native later-wins posture (competing
    // inserts would duplicate, not override).
    const supplierPatch = (pkg) => stringifyYaml([
      { id: 'llm-pi-ai', name: FIXTURE_LLM_NAME, config: modelsConfig({ opencode: [{ id: `${pkg}-model` }] }) },
    ]);
    const mk = (name, bundles) => {
      const dir = makeProfile(home, name, { entries: [llmRow({ config: 'absent' })], bundles: ['@fixture/base', ...bundles] });
      makeFixtureBundle(dir, '@fixture/base');
      for (const pkg of bundles) makeFixtureBundle(dir, pkg, { rawPatch: supplierPatch(pkg) });
      return dir;
    };
    // Both suppliers configure competing managed arrays; the later manifest
    // entry wins the effective row.
    const dirAB = mk('orderAB', ['@fixture/a', '@fixture/b']);
    const dirBA = mk('orderBA', ['@fixture/b', '@fixture/a']);
    for (const [label, dir, name, winner] of [
      ['AB', dirAB, 'orderAB', '@fixture/b'],
      ['BA', dirBA, 'orderBA', '@fixture/a'],
    ]) {
      const snap = snapshotTree(dir);
      const r = await readManagedConfig(readerOpts(bind(name)));
      assert.equal(r.ok, false, `${label}: expected NOT_PROFILE_OWNED: ${JSON.stringify(r)}`);
      assert.equal(r.code, 'NOT_PROFILE_OWNED', label);
      assert.equal(r.detail.effectiveFrom.source, winner, `${label}: bundle order not honored`);
      assertNoMutation(snap, dir, `T03 bundle order ${label}: read mutated disk`);
    }
  });

  it('T03 stored and effective stay distinct objects with distinct digests', async () => {
    const profileDir = makeProfile(home, 'distinct', { entries: [llmRow({ config: userModels() })], bundles: [FIXTURE_BUNDLE_PKG] });
    makeFixtureBundle(profileDir);
    const r = await readManagedConfig(readerOpts(bind('distinct')));
    assert.equal(r.ok, true, `expected success: ${JSON.stringify(r)}`);
    assert.notEqual(r.storedConfig, r.effectiveConfig);
    assert.deepEqual(r.storedConfig, r.effectiveConfig);
    assert.equal(typeof r.patchDigest, 'string');
    assert.equal(typeof r.effectiveDigest, 'string');
  });
});
