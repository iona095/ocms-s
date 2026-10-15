// B5: insert-name anchoring must treat every row from one file alike.
// A direct user row and an insert-directive child carrying the same name must
// address identically: anchoring the child but not the direct row splits one
// logical row into two and breaks composition addressability. The
// package-style control (no anchoring anywhere) stays MATCHED; the absolute
// name case must behave identically. Native composition semantics: requires
// the installed DSH tree.
import { describe, it } from 'node:test';
import { readManagedConfig } from '../../profile/config-reader.mjs';
import {
  assert,
  makeTempHome,
  sandboxDshHome,
  llmRow,
  makeProfile,
  makeFixtureBundle,
  bindReal,
  readerOpts,
  snapshotTree,
  assertNoMutation,
  requireRealCompositionOrSkip,
  FIXTURE_LLM_NAME,
  FIXTURE_BUNDLE_PKG,
} from './helpers.mjs';

let home;
let cleanupHome;
let restoreDshHome;

function bind(name) {
  return bindReal(home, name);
}

function modelsB() {
  return { providers: { opencode: { displayName: 'opencode', models: [{ id: 'mB' }] } } };
}

describe('B5 — insert-name anchoring addressability', () => {
  it('package-style names: direct row plus same-name insert child stay MATCHED', async () => {
    restoreDshHome = sandboxDshHome();
    ({ home, cleanup: cleanupHome } = makeTempHome());
    try {
      const profileDir = makeProfile(home, 'b5pkg', {
        entries: [llmRow({ name: FIXTURE_LLM_NAME }), { insert: [{ id: 'llm-pi-ai', name: FIXTURE_LLM_NAME, config: modelsB() }] }],
        bundles: [FIXTURE_BUNDLE_PKG],
      });
      makeFixtureBundle(profileDir, FIXTURE_BUNDLE_PKG, { insertRows: [{ id: 'llm-pi-ai', name: FIXTURE_LLM_NAME }] });
      const snap = snapshotTree(profileDir);
      const r = await readManagedConfig(readerOpts(bind('b5pkg')));
      assert.equal(r.ok, true, 'control must read: ' + JSON.stringify(r.code || r.status));
      assert.equal(r.status, 'MATCHED');
      assert.deepEqual(r.warnings ?? [], []);
      assertNoMutation(snap, profileDir, 'B5 control: read mutated disk');
    } finally {
      cleanupHome();
      restoreDshHome();
    }
  });

  it('absolute names: same logical rows stay MATCHED after anchoring', async (t) => {
    if (!requireRealCompositionOrSkip(t, 'real DSH insert-name anchoring and composition semantics')) return;
    restoreDshHome = sandboxDshHome();
    ({ home, cleanup: cleanupHome } = makeTempHome());
    try {
      const abs = home + '/shared-target';
      const profileDir = makeProfile(home, 'b5abs', {
        entries: [llmRow({ name: abs }), { insert: [{ id: 'llm-pi-ai', name: abs, config: modelsB() }] }],
        bundles: [FIXTURE_BUNDLE_PKG],
      });
      makeFixtureBundle(profileDir, FIXTURE_BUNDLE_PKG, { insertRows: [{ id: 'llm-pi-ai', name: abs }] });
      const snap = snapshotTree(profileDir);
      const r = await readManagedConfig(readerOpts(bind('b5abs')));
      assert.equal(r.ok, true, 'anchored rows must read: ' + JSON.stringify(r.code || r.status));
      assert.equal(r.status, 'MATCHED');
      assert.deepEqual(r.warnings ?? [], []);
      assertNoMutation(snap, profileDir, 'B5 anchored: read mutated disk');
    } finally {
      cleanupHome();
      restoreDshHome();
    }
  });
});
