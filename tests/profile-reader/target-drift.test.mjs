// S2 input contract and identity drift (P0-R2 §§8.3, 8.6; P1-A §5 S2).
//
// The reader consumes an explicitly supplied S1 binding: required identity
// fields are validated, the target is re-resolved (bytes digest plus real
// paths), and any drift refuses STALE_TARGET/SYMLINK_ESCAPE/PATCH_UNREADABLE.
// Attestation stays opaque (admission, never proof). Reading grants no write
// authority and mutates nothing.
import { describe, it, beforeEach, afterEach } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readManagedConfig } from '../../profile/config-reader.mjs';
import {
  assert,
  makeTempHome,
  sandboxDshHome,
  sha256Hex,
  llmRow,
  modelsConfig,
  makeProfile,
  makeFixtureBundle,
  bindReal,
  readerOpts,
  snapshotTree,
  assertNoMutation,
  FIXTURE_BUNDLE_PKG,
} from './helpers.mjs';

let home;
let cleanupHome;
let restoreDshHome;

function bind(name, extra = {}) {
  return bindReal(home, name, extra);
}

beforeEach(() => {
  restoreDshHome = sandboxDshHome();
  ({ home, cleanup: cleanupHome } = makeTempHome());
});

afterEach(() => {
  cleanupHome();
  restoreDshHome();
});

describe('S2 input contract (S2.1)', () => {
  it('S2 validates required binding fields without throwing', async () => {
    const profileDir = makeProfile(home, 'contract', { entries: [llmRow({ config: modelsConfig({ opencode: [{ id: 'm1' }] }) })] });
    makeFixtureBundle(profileDir);
    const good = bind('contract');
    // Null/non-object bindings refuse; a bad profile name maps to the S1 code.
    for (const bad of [null, undefined, 42, 'x', []]) {
      const r = await readManagedConfig(readerOpts(bad, {}));
      assert.equal(r && r.ok, false, `binding ${JSON.stringify(bad)}`);
    }
    const nameless = await readManagedConfig(readerOpts({ ...good, profileName: '' }));
    assert.equal(nameless.ok, false);
    assert.equal(nameless.code, 'INVALID_PROFILE_NAME');
    // Every other required field, when missing or malformed, refuses stale
    // (identity cannot be established) — never absorbed, never throwing.
    for (const key of ['profileDirReal', 'patchPathReal', 'pluginEntryName', 'classification', 'dshHomeReal', 'patchDigest', 'declaredOverlays', 'liveAttestation']) {
      const mutated = { ...good };
      delete mutated[key];
      const r = await readManagedConfig(readerOpts(mutated));
      assert.equal(r.ok, false, `missing ${key}`);
      assert.equal(r.code, 'STALE_TARGET', `missing ${key}`);
    }
    const badDigest = await readManagedConfig(readerOpts({ ...good, patchDigest: 'not-a-digest' }));
    assert.equal(badDigest.ok, false);
    const badClass = await readManagedConfig(readerOpts({ ...good, classification: 'MAYBE' }));
    assert.equal(badClass.ok, false);
  });

  it('S2 attestation is opaque passthrough, never proof', async () => {
    const profileDir = makeProfile(home, 'attest', { entries: [llmRow({ config: modelsConfig({ opencode: [{ id: 'm1' }] }) })], bundles: [FIXTURE_BUNDLE_PKG] });
    makeFixtureBundle(profileDir);
    const withAttestation = bind('attest', {
      declaredOverlays: [],
      liveAttestation: { mode: 'B', overlays: ['C:\\fixture\\overlay.yml'], at: '2026-01-01T00:00:00.000Z' },
    });
    assert.deepEqual(withAttestation.liveAttestation, { mode: 'B', overlays: ['C:\\fixture\\overlay.yml'], at: '2026-01-01T00:00:00.000Z' });
    const snap = snapshotTree(profileDir);
    const r = await readManagedConfig(readerOpts(withAttestation));
    assert.equal(r.ok, true, `expected success: ${JSON.stringify(r)}`);
    assert.equal(r.status, 'MATCHED');
    assert.deepEqual(r.target.liveAttestation, withAttestation.liveAttestation);
    // Attestation grants no write authority: the read still mutates nothing
    // and the result exposes no write surface.
    assertNoMutation(snap, profileDir, 'S2 attestation: read mutated disk');
  });

  it('S2 rejects byte drift with STALE_TARGET carrying both digests', async () => {
    const profileDir = makeProfile(home, 'drift', { entries: [llmRow({ config: modelsConfig({ opencode: [{ id: 'm1' }] }) })] });
    makeFixtureBundle(profileDir);
    const patchPath = path.join(profileDir, 'cordis.patch.yml');
    const target = bind('drift');
    fs.appendFileSync(patchPath, '\n# drift\n', 'utf8');
    const observed = sha256Hex(fs.readFileSync(patchPath));
    assert.notEqual(observed, target.patchDigest);
    const snap = snapshotTree(profileDir);
    const r = await readManagedConfig(readerOpts(target));
    assert.equal(r.ok, false);
    assert.equal(r.code, 'STALE_TARGET');
    assert.equal(r.detail.cause, 'patch-digest-mismatch');
    assert.equal(r.detail.expected, target.patchDigest);
    assert.equal(r.detail.observed, observed);
    assertNoMutation(snap, profileDir, 'S2 drift: read mutated disk');
  });

  it('S2 rejects a deleted patch with PATCH_UNREADABLE', async () => {
    const profileDir = makeProfile(home, 'gone', { entries: [llmRow()] });
    makeFixtureBundle(profileDir);
    const target = bind('gone');
    fs.rmSync(path.join(profileDir, 'cordis.patch.yml'), { force: true });
    const r = await readManagedConfig(readerOpts(target));
    assert.equal(r.ok, false);
    assert.equal(r.code, 'PATCH_UNREADABLE');
  });

  it('S2 rejects a patch escaping the profile with SYMLINK_ESCAPE', async () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'ocms-s2-outside-'));
    try {
      const outsidePatch = path.join(outside, 'cordis.patch.yml');
      fs.writeFileSync(outsidePatch, '- id: llm-pi-ai\n  config: {providers: {}}\n', 'utf8');
      const profileDir = makeProfile(home, 'escape', { entries: [llmRow()] });
      makeFixtureBundle(profileDir);
      const donor = bind('escape');
      const forged = {
        ...donor,
        patchPathReal: fs.realpathSync(outsidePatch),
        patchDigest: sha256Hex(fs.readFileSync(outsidePatch)),
      };
      const r = await readManagedConfig(readerOpts(forged));
      assert.equal(r.ok, false);
      assert.equal(r.code, 'SYMLINK_ESCAPE');
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it('S2 rejects a vanished home anchor with STALE_TARGET', async () => {
    const profileDir = makeProfile(home, 'homeanchor', { entries: [llmRow()] });
    makeFixtureBundle(profileDir);
    const target = bind('homeanchor');
    const forged = { ...target, dshHomeReal: path.join(home, 'no-such-dir') };
    const r = await readManagedConfig(readerOpts(forged));
    assert.equal(r.ok, false);
    assert.equal(r.code, 'STALE_TARGET');
  });

  it('S2 refuses a profile name resolving deeper (home not guessable)', async () => {
    // The bound name is a junction to a deeper directory: the grandparent of
    // the real directory is not the home S1 scanned (it would read
    // <home>/profiles/cordis.patch.yml as the "home layer"). S2 must refuse
    // rather than compose against a guessed home layer set.
    const linkDir = makeProfile(home, 'real', { entries: [llmRow({ config: modelsConfig({ opencode: [{ id: 'm1' }] }) })], bundles: [FIXTURE_BUNDLE_PKG] });
    makeFixtureBundle(linkDir);
    fs.mkdirSync(path.join(home, 'profiles', 'deep'), { recursive: true });
    fs.renameSync(linkDir, path.join(home, 'profiles', 'deep', 'real'));
    fs.symlinkSync(path.join(home, 'profiles', 'deep', 'real'), path.join(home, 'profiles', 'swlink'), 'junction');
    const target = bind('swlink');
    assert.ok(
      target.profileDirReal.endsWith(path.join('deep', 'real')) || target.profileDirReal.includes('deep'),
      `expected deep resolution, got ${target.profileDirReal}`,
    );
    const snapBefore = snapshotTree(home);
    const r = await readManagedConfig(readerOpts(target));
    assert.equal(r.ok, false);
    assert.equal(r.code, 'STALE_TARGET');
    assert.equal(r.detail, 'profile-designation-mismatch');
    assertNoMutation(snapBefore, home, 'S2 swlink: read mutated disk');
  });

  it('S2 refuses a retired-bundle listing before any load call (manifest never normalized)', async () => {
    const retired = '@deepseek-ai/dsh-experimental-schedule-bundle';
    const profileDir = makeProfile(home, 'retired', {
      entries: [llmRow({ config: modelsConfig({ opencode: [{ id: 'm1' }] }) })],
      bundles: [retired, FIXTURE_BUNDLE_PKG],
    });
    makeFixtureBundle(profileDir);
    const target = bind('retired');
    const manifestPath = path.join(profileDir, 'package.json');
    const manifestBefore = fs.readFileSync(manifestPath);
    const mtimeBefore = fs.statSync(manifestPath).mtimeMs;
    const snap = snapshotTree(profileDir);
    const r = await readManagedConfig(readerOpts(target));
    assert.equal(r.ok, false);
    assert.equal(r.code, 'PROFILE_NOT_INITIALIZED');
    assert.equal(r.detail.cause, 'retired-bundle-listed');
    // The native loader would rewrite the manifest to drop the retired
    // bundle; a read must never trigger that normalization.
    assert.deepEqual(fs.readFileSync(manifestPath), manifestBefore);
    assert.equal(fs.statSync(manifestPath).mtimeMs, mtimeBefore);
    assertNoMutation(snap, profileDir, 'S2 retired: read mutated disk');
  });

  it('S2 selects no profile implicitly: target without profileName refuses', async () => {
    const profileDir = makeProfile(home, 'noselect', { entries: [llmRow()] });
    makeFixtureBundle(profileDir);
    const target = bind('noselect');
    for (const badName of [undefined, null, '']) {
      const r = await readManagedConfig(readerOpts({ ...target, profileName: badName }));
      assert.equal(r.ok, false, `name ${JSON.stringify(badName)}`);
      assert.equal(r.code, 'INVALID_PROFILE_NAME', `name ${JSON.stringify(badName)}`);
    }
  });
});
