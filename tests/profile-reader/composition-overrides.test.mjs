// S2 layer composition and override detection (P0-R2 §§4.1, 8.5; P1-A §5 S2).
//
// Effective configuration follows the normative DSH layer order (ordered
// bundles, user patch, home patch, declared launcher overlays, telemetry
// posture) via the admitted composition utilities. Later layers replacing
// the six managed arrays refuse OVERRIDDEN with attribution; non-managed
// differences warn EFFECTIVE_DIFFERS_FROM_STORED. Unknown or inaccessible
// layers refuse; effective truth is never guessed.
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
  resolveRealScope,
  snapshotTree,
  assertNoMutation,
  assertNoSecrets,
  SECRET_MARKERS,
  FIXTURE_LLM_NAME,
  FIXTURE_BUNDLE_PKG,
} from './helpers.mjs';

let home;
let cleanupHome;
let restoreDshHome;

function bind(name) {
  return bindReal(home, name);
}

function userModels() {
  return modelsConfig({ opencode: [{ id: 'user-model' }] });
}

let overlaySeq = 0;

function overlayFile(text) {
  const p = path.join(home, `overlay-${process.pid}-${overlaySeq++}.yml`);
  fs.writeFileSync(p, text, 'utf8');
  return p;
}

beforeEach(() => {
  restoreDshHome = sandboxDshHome();
  ({ home, cleanup: cleanupHome } = makeTempHome());
});

afterEach(() => {
  cleanupHome();
  restoreDshHome();
});

describe('S2 layer composition (bundles, user, home, overlays)', () => {
  it('S2 user layer wins over the bundle mount (MATCHED, no attribution)', async () => {
    const profileDir = makeProfile(home, 'userwins', { entries: [llmRow({ config: userModels() })], bundles: [FIXTURE_BUNDLE_PKG] });
    makeFixtureBundle(profileDir);
    const snap = snapshotTree(profileDir);
    const r = await readManagedConfig(readerOpts(bind('userwins')));
    assert.equal(r.ok, true, `expected success: ${JSON.stringify(r)}`);
    assert.equal(r.status, 'MATCHED');
    assert.deepEqual(r.overriddenBy, []);
    assert.deepEqual(r.effectiveConfig, userModels());
    assertNoMutation(snap, profileDir, 'S2 userwins: read mutated disk');
  });

  it('S2 declared overlay replacing managed arrays refuses OVERRIDDEN with attribution', async () => {
    const profileDir = makeProfile(home, 'ovr', { entries: [llmRow({ config: userModels() })], bundles: [FIXTURE_BUNDLE_PKG] });
    makeFixtureBundle(profileDir);
    const target = bind('ovr');
    const overlayPath = overlayFile(stringifyYaml([
      { id: 'llm-pi-ai', name: FIXTURE_LLM_NAME, config: modelsConfig({ opencode: [{ id: 'overlay-model' }] }) },
    ]));
    const snap = snapshotTree(profileDir);
    const r = await readManagedConfig(readerOpts({ ...target, declaredOverlays: [overlayPath] }));
    assert.equal(r.ok, false, `expected OVERRIDDEN: ${JSON.stringify(r)}`);
    assert.equal(r.code, 'OVERRIDDEN');
    assert.deepEqual(r.detail.overriddenBy, [{ layer: 'overlay', source: overlayPath }]);
    assert.ok(r.detail.managedRoutes.includes('opencode'));
    assert.equal(r.detail.patchDigest, target.patchDigest);
    assertNoMutation(snap, profileDir, 'S2 overlay override: read mutated disk');
    fs.rmSync(overlayPath, { force: true });
  });

  it('S2 overlay changing only non-managed content warns EFFECTIVE_DIFFERS_FROM_STORED', async () => {
    const profileDir = makeProfile(home, 'ovrnon', { entries: [llmRow({ config: userModels() })], bundles: [FIXTURE_BUNDLE_PKG] });
    makeFixtureBundle(profileDir);
    const target = bind('ovrnon');
    const plain = await readManagedConfig(readerOpts(target));
    assert.equal(plain.ok, true, `expected success: ${JSON.stringify(plain)}`);
    assert.equal(plain.status, 'MATCHED');
    const overlayPath = overlayFile(stringifyYaml([
      {
        id: 'llm-pi-ai',
        name: FIXTURE_LLM_NAME,
        config: { providers: { opencode: { models: [{ id: 'user-model' }], displayName: 'Renamed upstream' } } },
      },
    ]));
    const snap = snapshotTree(profileDir);
    const r = await readManagedConfig(readerOpts({ ...target, declaredOverlays: [overlayPath] }));
    assert.equal(r.ok, true, `expected warning-status success: ${JSON.stringify(r)}`);
    assert.equal(r.status, 'EFFECTIVE_DIFFERS_FROM_STORED');
    assert.deepEqual(r.overriddenBy, [{ layer: 'overlay', source: overlayPath }]);
    assert.deepEqual(r.storedConfig.providers.opencode.models, [{ id: 'user-model' }]);
    assert.equal(r.effectiveConfig.providers.opencode.displayName, 'Renamed upstream');
    assert.equal(r.patchDigest, plain.patchDigest);
    assert.notEqual(r.effectiveDigest, plain.effectiveDigest);
    assertNoMutation(snap, profileDir, 'S2 overlay non-managed: read mutated disk');
    fs.rmSync(overlayPath, { force: true });
  });

  it('S2 overlay masking providers entirely refuses OVERRIDDEN', async () => {
    const profileDir = makeProfile(home, 'ovrmask', { entries: [llmRow({ config: userModels() })], bundles: [FIXTURE_BUNDLE_PKG] });
    makeFixtureBundle(profileDir);
    const target = bind('ovrmask');
    const overlayPath = overlayFile(stringifyYaml([
      { id: 'llm-pi-ai', name: FIXTURE_LLM_NAME, config: { providers: {} } },
    ]));
    const r = await readManagedConfig(readerOpts({ ...target, declaredOverlays: [overlayPath] }));
    assert.equal(r.ok, false, `expected OVERRIDDEN: ${JSON.stringify(r)}`);
    assert.equal(r.code, 'OVERRIDDEN');
    fs.rmSync(overlayPath, { force: true });
  });

  it('S2 declared overlay touching no managed row stays MATCHED without attribution', async () => {
    // An unknown/unrepresented overlay (rows for absent ids, inert rows) is
    // composed with native semantics and changes nothing: MATCHED, empty
    // attribution, stable effective digest. Never absorbed, never refused.
    const profileDir = makeProfile(home, 'ovrinert', { entries: [llmRow({ config: userModels() })], bundles: [FIXTURE_BUNDLE_PKG] });
    makeFixtureBundle(profileDir);
    const target = bind('ovrinert');
    const plain = await readManagedConfig(readerOpts(target));
    assert.equal(plain.ok, true, `expected success: ${JSON.stringify(plain)}`);
    const overlayPath = overlayFile(stringifyYaml([
      { id: 'no-such-entry', name: 'Elsewhere', config: { providers: { opencode: { models: [{ id: 'ghost' }] } } } },
      { insert: [{ id: 'detached-child' }] },
    ]));
    const snap = snapshotTree(profileDir);
    const r = await readManagedConfig(readerOpts({ ...target, declaredOverlays: [overlayPath] }));
    assert.equal(r.ok, true, `expected MATCHED: ${JSON.stringify(r)}`);
    assert.equal(r.status, 'MATCHED');
    assert.deepEqual(r.overriddenBy, []);
    assert.equal(r.effectiveDigest, plain.effectiveDigest);
    assertNoMutation(snap, profileDir, 'S2 inert overlay: read mutated disk');
    fs.rmSync(overlayPath, { force: true });
  });

  it('S2 missing declared overlay file refuses PATCH_UNREADABLE', async () => {
    const profileDir = makeProfile(home, 'ovrmissing', { entries: [llmRow({ config: userModels() })] });
    makeFixtureBundle(profileDir);
    const target = bind('ovrmissing');
    const missing = path.join(home, 'no-such-overlay.yml');
    const snap = snapshotTree(profileDir);
    const r = await readManagedConfig(readerOpts({ ...target, declaredOverlays: [missing] }));
    assert.equal(r.ok, false);
    assert.equal(r.code, 'PATCH_UNREADABLE');
    assertNoMutation(snap, profileDir, 'S2 missing overlay: read mutated disk');
  });

  it('S2 non-absolute overlay declaration refuses PATCH_UNREADABLE (never cwd-resolved)', async () => {
    const profileDir = makeProfile(home, 'ovrrel', { entries: [llmRow({ config: userModels() })] });
    makeFixtureBundle(profileDir);
    const target = bind('ovrrel');
    for (const bad of ['relative/overlay.yml', '', 'C:relative.yml']) {
      const r = await readManagedConfig(readerOpts({ ...target, declaredOverlays: [bad] }));
      assert.equal(r.ok, false, `overlay ${JSON.stringify(bad)}`);
      assert.equal(r.code, 'PATCH_UNREADABLE', `overlay ${JSON.stringify(bad)}`);
    }
  });

  it('S2 unparsable overlay refuses PATCH_PARSE_ERROR; non-sequence overlay refuses PATCH_ROOT_NOT_SEQUENCE', async () => {
    const profileDir = makeProfile(home, 'ovrbad', { entries: [llmRow({ config: userModels() })] });
    makeFixtureBundle(profileDir);
    const target = bind('ovrbad');
    const badParse = overlayFile('- id: [unclosed\n');
    const badRoot = overlayFile('a: 1\n');
    const badRow = overlayFile('- just-a-string\n');
    for (const [p, code] of [[badParse, 'PATCH_PARSE_ERROR'], [badRoot, 'PATCH_ROOT_NOT_SEQUENCE'], [badRow, 'PATCH_PARSE_ERROR']]) {
      const r = await readManagedConfig(readerOpts({ ...target, declaredOverlays: [p] }));
      assert.equal(r.ok, false, p);
      assert.equal(r.code, code, p);
    }
    for (const p of [badParse, badRoot, badRow]) fs.rmSync(p, { force: true });
  });

  it('S2 explicit real scope composes identically (operative nested anchor)', async () => {
    const profileDir = makeProfile(home, 'explicit', { entries: [llmRow({ config: userModels() })], bundles: [FIXTURE_BUNDLE_PKG] });
    makeFixtureBundle(profileDir);
    const target = bind('explicit');
    const snap = snapshotTree(profileDir);
    const viaEvidence = await readManagedConfig(readerOpts(target));
    const viaExplicit = await readManagedConfig(readerOpts(target, { installAnchorDir: resolveRealScope() }));
    assert.equal(viaExplicit.ok, true, `expected success: ${JSON.stringify(viaExplicit)}`);
    assert.equal(viaExplicit.status, 'MATCHED');
    assert.equal(viaExplicit.composition.anchorKind, 'explicit');
    assert.equal(viaExplicit.effectiveDigest, viaEvidence.effectiveDigest);
    assert.deepEqual(viaExplicit.effectiveConfig, viaEvidence.effectiveConfig);
    assertNoMutation(snap, profileDir, 'S2 explicit anchor: read mutated disk');
  });

  it('S2 telemetry posture never disturbs the llm projection', async () => {
    const profileDir = makeProfile(home, 'tele', { entries: [llmRow({ config: userModels() })], bundles: [FIXTURE_BUNDLE_PKG] });
    makeFixtureBundle(profileDir, FIXTURE_BUNDLE_PKG, {
      insertRows: [
        { id: 'llm-pi-ai', name: FIXTURE_LLM_NAME },
        { id: 'session-telemetry-otel', name: '@fixture/telemetry' },
      ],
    });
    const target = bind('tele');
    const snap = snapshotTree(profileDir);
    const off = await readManagedConfig(readerOpts(target, { telemetryDisabledEnv: undefined }));
    const on = await readManagedConfig(readerOpts(target, { telemetryDisabledEnv: '1' }));
    assert.equal(off.ok, true, `telemetry off: ${JSON.stringify(off)}`);
    assert.equal(on.ok, true, `telemetry on: ${JSON.stringify(on)}`);
    assert.equal(off.status, 'MATCHED');
    assert.equal(on.status, 'MATCHED');
    assert.equal(off.effectiveDigest, on.effectiveDigest);
    assertNoMutation(snap, profileDir, 'S2 telemetry: read mutated disk');
  });

  it('S2 name-mismatched user row is inert: OVERRIDDEN plus ADDRESSABILITY_UNVERIFIED', async () => {
    const profileDir = makeProfile(home, 'mismatch', {
      entries: [llmRow({ config: userModels(), name: 'Wrong Name' })],
      bundles: [FIXTURE_BUNDLE_PKG],
    });
    makeFixtureBundle(profileDir);
    const snap = snapshotTree(profileDir);
    const r = await readManagedConfig(readerOpts(bind('mismatch')));
    assert.equal(r.ok, false, `expected OVERRIDDEN: ${JSON.stringify(r)}`);
    assert.equal(r.code, 'OVERRIDDEN');
    assert.deepEqual(r.detail.overriddenBy, []);
    assert.ok((r.detail.warnings ?? []).includes('ADDRESSABILITY_UNVERIFIED'));
    assertNoMutation(snap, profileDir, 'S2 mismatch: read mutated disk');
  });

  it('S2 bundle-less profile leaves the user row inert: OVERRIDDEN plus ADDRESSABILITY_UNVERIFIED', async () => {
    const profileDir = makeProfile(home, 'nobundle', { entries: [llmRow({ config: userModels() })], bundles: [] });
    const snap = snapshotTree(profileDir);
    const r = await readManagedConfig(readerOpts(bind('nobundle')));
    assert.equal(r.ok, false, `expected OVERRIDDEN: ${JSON.stringify(r)}`);
    assert.equal(r.code, 'OVERRIDDEN');
    assert.ok((r.detail.warnings ?? []).includes('ADDRESSABILITY_UNVERIFIED'));
    assertNoMutation(snap, profileDir, 'S2 nobundle: read mutated disk');
  });

  it('S2 unparsable home patch refuses PATCH_PARSE_ERROR with home attribution', async () => {
    const profileDir = makeProfile(home, 'homebad', { entries: [llmRow({ config: userModels() })] });
    makeFixtureBundle(profileDir);
    const target = bind('homebad');
    fs.writeFileSync(path.join(home, 'cordis.patch.yml'), '- id: [unclosed\n', 'utf8');
    const snap = snapshotTree(profileDir);
    const r = await readManagedConfig(readerOpts(target));
    assert.equal(r.ok, false);
    assert.equal(r.code, 'PATCH_PARSE_ERROR');
    assertNoMutation(snap, profileDir, 'S2 bad home: read mutated disk');
  });

  it('S2 failures never leak credential-shaped values', async () => {
    const config = { providers: { opencode: { models: [{ id: 'm1' }], apiKeyEnv: SECRET_MARKERS[0] } } };
    const profileDir = makeProfile(home, 'leak', { entries: [llmRow({ config })], bundles: [FIXTURE_BUNDLE_PKG] });
    makeFixtureBundle(profileDir);
    const target = bind('leak');
    const overlayPath = overlayFile(stringifyYaml([
      { id: 'llm-pi-ai', name: FIXTURE_LLM_NAME, config: modelsConfig({ opencode: [{ id: 'x', note: SECRET_MARKERS[1] }] }) },
    ]));
    const r = await readManagedConfig(readerOpts({ ...target, declaredOverlays: [overlayPath, path.join(home, 'absent.yml')] }));
    assert.equal(r.ok, false);
    assertNoSecrets(r, 'S2 leak refusal');
    const r2 = await readManagedConfig(readerOpts({ ...target, declaredOverlays: [overlayPath] }));
    assert.equal(r2.ok, false);
    assert.equal(r2.code, 'OVERRIDDEN');
    assertNoSecrets(r2, 'S2 leak OVERRIDDEN');
    fs.rmSync(overlayPath, { force: true });
  });
});
