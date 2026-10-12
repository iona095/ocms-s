// S2 T02 — ID-based llm-pi-ai discovery (P0-R2 §9.1; P1-A §5 S2).
//
// The entry is found by id at index 0, middle, and last; no fixed index is
// assumed (static assert: no numeric literal locates the entry). Missing and
// duplicate entries refuse; insert-only rows are not ownership candidates but
// retain their collision flag.
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

function entriesWithLlmAt(total, at) {
  const entries = [];
  for (let i = 0; i < total; i++) {
    if (i === at) entries.push(llmRow({ config: { providers: { opencode: { models: [{ id: 'm1' }] } } } }));
    else entries.push(decoyRow(`decoy-${i}`));
  }
  return entries;
}

describe('S2 T02 — ID-based location (P0-R2 §9.1)', () => {
  for (const [label, total, at] of [['beginning', 5, 0], ['middle', 5, 2], ['end', 5, 4], ['end-21', 21, 20]]) {
    it(`T02 finds llm-pi-ai by id at ${label}`, async () => {
      const profileDir = makeProfile(home, `pos-${label}`, { entries: entriesWithLlmAt(total, at), bundles: [FIXTURE_BUNDLE_PKG] });
      makeFixtureBundle(profileDir);
      const snap = snapshotTree(profileDir);
      const r = await readManagedConfig(readerOpts(bind(`pos-${label}`)));
      assert.equal(r.ok, true, `expected success: ${JSON.stringify(r)}`);
      assert.equal(r.llmEntryIndex, at);
      assert.equal(r.documentModel.rows[at].id, 'llm-pi-ai');
      assert.equal(r.status, 'MATCHED');
      assertNoMutation(snap, profileDir, `T02 ${label}: read mutated disk`);
    });
  }

  it('T02 implementation uses no numeric literal to locate the entry', () => {
    const raw = fs.readFileSync(new URL('../../profile/config-reader.mjs', import.meta.url), 'utf8');
    // Gate prose, not comments: step numbers and section references in
    // comments must not trip the scan, so strip them first.
    const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
    assert.ok(!/\b12\b/.test(src), 'fixed-index literal present: index 12 must have no special meaning');
    assert.ok(!/items\[\d+\]/.test(src), 'numeric items[] indexing locates entries');
    assert.ok(!/getIn\(\s*\[\s*\d+/.test(src), 'numeric getIn() indexing locates entries');
  });

  it('T02 missing entry refuses PLUGIN_ENTRY_MISSING', async () => {
    const profileDir = makeProfile(home, 'noentry', { entries: [decoyRow('a'), decoyRow('b')] });
    makeFixtureBundle(profileDir);
    const patchPath = path.join(profileDir, 'cordis.patch.yml');
    // S1 refuses entry-less patches, so transplant a valid binding's identity
    // onto the current bytes: S2 must discover, not trust.
    const donorDir = makeProfile(home, 'donor', { entries: [llmRow(), decoyRow('a')] });
    makeFixtureBundle(donorDir);
    const donor = bind('donor');
    const forged = {
      ...donor,
      profileName: 'noentry',
      profileDirReal: fs.realpathSync(profileDir),
      patchPathReal: fs.realpathSync(patchPath),
      patchDigest: sha256Hex(fs.readFileSync(patchPath)),
    };
    const snap = snapshotTree(profileDir);
    const r = await readManagedConfig(readerOpts(forged));
    assert.equal(r.ok, false);
    assert.equal(r.code, 'PLUGIN_ENTRY_MISSING');
    assertNoMutation(snap, profileDir, 'T02 missing: read mutated disk');
  });

  it('T02 duplicate entries refuse PLUGIN_ENTRY_DUPLICATE', async () => {
    const profileDir = makeProfile(home, 'dup', { entries: [llmRow(), decoyRow('x')] });
    makeFixtureBundle(profileDir);
    const patchPath = path.join(profileDir, 'cordis.patch.yml');
    const target = bind('dup');
    fs.appendFileSync(patchPath, '- id: llm-pi-ai\n  name: Second\n  config: {providers: {}}\n', 'utf8');
    const forged = { ...target, patchDigest: sha256Hex(fs.readFileSync(patchPath)) };
    const snap = snapshotTree(profileDir);
    const r = await readManagedConfig(readerOpts(forged));
    assert.equal(r.ok, false);
    assert.equal(r.code, 'PLUGIN_ENTRY_DUPLICATE');
    assertNoMutation(snap, profileDir, 'T02 duplicate: read mutated disk');
  });

  it('T02 insert-only rows are not ownership candidates', async () => {
    const profileDir = makeProfile(home, 'insertonly', {
      entries: [{ insert: [{ id: 'llm-pi-ai', name: 'Inserted' }] }, decoyRow('x')],
    });
    makeFixtureBundle(profileDir);
    const patchPath = path.join(profileDir, 'cordis.patch.yml');
    // S1 refuses insert-only shapes (no owned row), so transplant a valid
    // binding's identity onto the current bytes: S2 must discover, not trust.
    const probe = makeProfile(home, 'probe', { entries: [llmRow(), decoyRow('x')] });
    makeFixtureBundle(probe);
    const donor = bind('probe');
    const forged = {
      ...donor,
      profileName: 'insertonly',
      profileDirReal: fs.realpathSync(profileDir),
      patchPathReal: fs.realpathSync(patchPath),
      patchDigest: sha256Hex(fs.readFileSync(patchPath)),
    };
    const snap = snapshotTree(profileDir);
    const r = await readManagedConfig(readerOpts(forged));
    assert.equal(r.ok, false);
    assert.equal(r.code, 'PLUGIN_ENTRY_MISSING');
    assertNoMutation(snap, profileDir, 'T02 insert-only: read mutated disk');
  });

  it('T02 insert-row collision retains its warning beside the owned row', async () => {
    // Same-id insert row (S1 flags insert rows whose own id collides; the
    // row is inert for ownership but the collision stays visible).
    const profileDir = makeProfile(home, 'collision', {
      entries: [llmRow({ config: { providers: {} } }), { id: 'llm-pi-ai', insert: [{ id: 'llm-pi-ai-note' }] }, decoyRow('x')],
      bundles: [FIXTURE_BUNDLE_PKG],
    });
    makeFixtureBundle(profileDir);
    const snap = snapshotTree(profileDir);
    const r = await readManagedConfig(readerOpts(bind('collision')));
    assert.equal(r.ok, true, `expected success: ${JSON.stringify(r)}`);
    assert.ok(r.warnings.includes('INSERT_ROW_SAME_ID'), `warnings: ${JSON.stringify(r.warnings)}`);
    assertNoMutation(snap, profileDir, 'T02 collision: read mutated disk');
  });
});
