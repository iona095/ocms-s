// S2 T01 — sequence-root admission (P0-R2 §9.1, §13 T01; P1-A §5 S2).
//
// Mapping/scalar/empty roots refuse PATCH_ROOT_NOT_SEQUENCE; a realistic
// 21-entry sequence fixture is accepted. All fixtures synthetic under
// os.tmpdir(); the real DSH home is never contacted (DSH_HOME sandboxed).
//
// RED record: written before profile/config-reader.mjs behavior exists; the
// scaffold answers NOT_IMPLEMENTED so every behavioral case below fails on
// a concrete contract mismatch.
import { describe, it, beforeEach, afterEach } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { readManagedConfig } from '../../profile/config-reader.mjs';
import {
  assert,
  makeTempHome,
  sandboxDshHome,
  sha256Hex,
  decoyRow,
  llmRow,
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

describe('S2 T01 — patch root must be a sequence (P0-R2 §9.1)', () => {
  for (const [label, raw] of [
    ['mapping-root', 'llm-pi-ai:\n  config: {}\n'],
    ['scalar-root', 'just a scalar\n'],
    ['empty-file', ''],
    ['null-doc', 'null\n'],
    ['number-doc', '42\n'],
  ]) {
    it(`T01 refuses ${label} with PATCH_ROOT_NOT_SEQUENCE`, async () => {
      const profileDir = makeProfile(home, 'rootcase', { entries: [decoyRow('x'), llmRow()] });
      makeFixtureBundle(profileDir);
      const patchPath = path.join(profileDir, 'cordis.patch.yml');
      const target = bind('rootcase');
      fs.writeFileSync(patchPath, raw, 'utf8');
      const forged = { ...target, patchDigest: sha256Hex(fs.readFileSync(patchPath)) };
      const snap = snapshotTree(profileDir);
      const r = await readManagedConfig(readerOpts(forged));
      assert.equal(r.ok, false);
      assert.equal(r.code, 'PATCH_ROOT_NOT_SEQUENCE');
      assertNoMutation(snap, profileDir, `T01 ${label}: read mutated disk`);
    });
  }

  it('T01 accepts a realistic 21-entry sequence fixture', async () => {
    const entries = [llmRow({ config: { providers: { opencode: { models: [{ id: 'm1' }] } } } })];
    for (let i = 0; i < 20; i++) entries.push(decoyRow(`decoy-${i}`));
    assert.equal(entries.length, 21);
    const profileDir = makeProfile(home, 'big', { entries, bundles: [FIXTURE_BUNDLE_PKG] });
    makeFixtureBundle(profileDir);
    const snap = snapshotTree(profileDir);
    const r = await readManagedConfig(readerOpts(bind('big')));
    assert.equal(r.ok, true, `expected success: ${JSON.stringify(r)}`);
    assert.equal(r.documentModel.root, 'sequence');
    assert.equal(r.documentModel.size, 21);
    assert.equal(r.llmEntryIndex, 0);
    assert.equal(r.status, 'MATCHED');
    assert.deepEqual(r.effectiveConfig, r.storedConfig);
    assert.equal(r.patchDigest, sha256Hex(fs.readFileSync(path.join(profileDir, 'cordis.patch.yml'))));
    assertNoMutation(snap, profileDir, 'T01 21-entry: read mutated disk');
  });

  it('T01 success reports exact patch bytes and their digest', async () => {
    const profileDir = makeProfile(home, 'bytes', { entries: [llmRow(), decoyRow('x')], bundles: [FIXTURE_BUNDLE_PKG] });
    makeFixtureBundle(profileDir);
    const patchPath = path.join(profileDir, 'cordis.patch.yml');
    const r = await readManagedConfig(readerOpts(bind('bytes')));
    assert.equal(r.ok, true, `expected success: ${JSON.stringify(r)}`);
    assert.ok(Buffer.isBuffer(r.patchBytes));
    assert.deepEqual(r.patchBytes, fs.readFileSync(patchPath));
    assert.equal(r.patchDigest, sha256Hex(r.patchBytes));
  });
});
