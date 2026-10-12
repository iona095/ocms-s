// S2 T10-support β€” digest identity (P0-R2 Β§8.6; P1-A Β§5 S2).
//
// patchDigest is SHA-256 over exact patch bytes (whitespace-only edits change
// it); effectiveDigest is deterministic over the canonical effective config
// (formatting-only edits leave it unchanged). Stored/effective digests are
// separate; exact bytes and parsed semantics never conflate.
import { describe, it, beforeEach, afterEach } from 'node:test';
import fs from 'node:fs';
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

function userConfig() {
  return modelsConfig({ opencode: [{ id: 'm1', name: 'M' }], 'opencode-go': [] });
}

describe('S2 digest identity (T10 support)', () => {
  it('T10 whitespace-only edit changes patchDigest (stale on the old binding)', async () => {
    const profileDir = makeProfile(home, 'ws', { bundles: [FIXTURE_BUNDLE_PKG], entries: [llmRow({ config: userConfig() })] });
    makeFixtureBundle(profileDir);
    const patchPath = path.join(profileDir, 'cordis.patch.yml');
    const target = bind('ws');
    const before = await readManagedConfig(readerOpts(target));
    assert.equal(before.ok, true, `expected success: ${JSON.stringify(before)}`);
    fs.appendFileSync(patchPath, '# trailing comment (parse-equivalent)\n', 'utf8');
    const snap = snapshotTree(profileDir);
    const stale = await readManagedConfig(readerOpts(target));
    assert.equal(stale.ok, false);
    assert.equal(stale.code, 'STALE_TARGET');
    assert.equal(stale.detail.cause, 'patch-digest-mismatch');
    const after = await readManagedConfig(readerOpts({ ...target, patchDigest: sha256Hex(fs.readFileSync(patchPath)) }));
    assert.equal(after.ok, true, `expected success: ${JSON.stringify(after)}`);
    assert.notEqual(after.patchDigest, before.patchDigest);
    assert.equal(after.effectiveDigest, before.effectiveDigest);
    assert.equal(after.status, 'MATCHED');
    assertNoMutation(snap, profileDir, 'T10 whitespace: read mutated disk');
  });

  it('T10 key reorder and quote-style changes keep effectiveDigest stable', async () => {
    const rawA = [
      '- id: llm-pi-ai',
      "  name: '@fixture/dsh-llm-fixture'",
      '  config:',
      '    providers:',
      '      opencode:',
      '        displayName: Op',
      '        models:',
      "          - id: 'm1'",
      '',
    ].join('\n');
    const rawB = [
      '- id: llm-pi-ai',
      '  name: "@fixture/dsh-llm-fixture"',
      '  config: {providers: {opencode: {models: [{id: m1}], displayName: Op}}}',
      '',
    ].join('\n');
    const dirA = makeProfile(home, 'fmtA', { bundles: [FIXTURE_BUNDLE_PKG], entries: null });
    makeFixtureBundle(dirA);
    fs.writeFileSync(path.join(dirA, 'cordis.patch.yml'), rawA, 'utf8');
    const dirB = makeProfile(home, 'fmtB', { bundles: [FIXTURE_BUNDLE_PKG], entries: null });
    makeFixtureBundle(dirB);
    fs.writeFileSync(path.join(dirB, 'cordis.patch.yml'), rawB, 'utf8');
    const snapA = snapshotTree(dirA);
    const snapB = snapshotTree(dirB);
    const a = await readManagedConfig(readerOpts(bind('fmtA')));
    const b = await readManagedConfig(readerOpts(bind('fmtB')));
    assert.equal(a.ok, true, `A: ${JSON.stringify(a)}`);
    assert.equal(b.ok, true, `B: ${JSON.stringify(b)}`);
    assert.notEqual(a.patchDigest, b.patchDigest);
    assert.equal(a.effectiveDigest, b.effectiveDigest);
    assert.deepEqual(a.effectiveConfig, b.effectiveConfig);
    assertNoMutation(snapA, dirA, 'T10 fmtA: read mutated disk');
    assertNoMutation(snapB, dirB, 'T10 fmtB: read mutated disk');
  });

  it('T10 same stored patch with changed effective config keeps patchDigest, moves effectiveDigest', async () => {
    const profileDir = makeProfile(home, 'effmove', { bundles: [FIXTURE_BUNDLE_PKG], entries: [llmRow({ config: userConfig() })] });
    makeFixtureBundle(profileDir);
    const target = bind('effmove');
    const plain = await readManagedConfig(readerOpts(target));
    assert.equal(plain.ok, true, `expected success: ${JSON.stringify(plain)}`);
    assert.equal(plain.status, 'MATCHED');
    const overlayPath = path.join(home, 'move-overlay.yml');
    fs.writeFileSync(
      overlayPath,
      '- id: llm-pi-ai\n'
        + `  name: '@fixture/dsh-llm-fixture'\n`
        + '  config:\n    providers:\n      opencode:\n        models:\n          - id: intruder\n',
      'utf8',
    );
    const snap = snapshotTree(profileDir);
    const moved = await readManagedConfig(readerOpts({ ...target, declaredOverlays: [overlayPath] }));
    assert.equal(moved.ok, false, `expected OVERRIDDEN: ${JSON.stringify(moved)}`);
    assert.equal(moved.code, 'OVERRIDDEN');
    assert.equal(moved.detail.patchDigest, plain.patchDigest);
    assert.notEqual(moved.detail.effectiveDigest, plain.effectiveDigest);
    assertNoMutation(snap, profileDir, 'T10 effmove: read mutated disk');
    fs.rmSync(overlayPath, { force: true });
  });

  it('T10 effectiveDigest is deterministic across repeated reads', async () => {
    const profileDir = makeProfile(home, 'det', { bundles: [FIXTURE_BUNDLE_PKG], entries: [llmRow({ config: userConfig() })] });
    makeFixtureBundle(profileDir);
    const target = bind('det');
    const first = await readManagedConfig(readerOpts(target));
    const second = await readManagedConfig(readerOpts(target));
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(first.effectiveDigest, second.effectiveDigest);
    assert.equal(first.patchDigest, second.patchDigest);
  });
});
