// OCMS-S v1.4.6-rc4 P4 — stub/real parity (contract v1.4.6-rc4 §11 test 4).
//
// For each rc2 flat fixture, the rc2 test-only stub anchor
// (tests/v1.4.6-rc2/helpers.mjs makeStubAnchor) and the real DSH anchor
// (tests/profile-reader/helpers.mjs resolveRealScope) give the same reader
// result through the same entry (readManagedConfig): same status and same
// parsed managed config.
//
// Lives with the profile suites (runs in test:profile and the profile CI
// job, never in npm test). Flat fixture shapes only, like the stub itself;
// never a general DSH reimplementation. Needs the pinned real DSH on PATH:
// when it is absent this reports a declared skip naming that capability
// (resolveRealScopeOrSkip), never an uncaught prerequisite error.
import { describe, it, beforeEach, afterEach } from 'node:test';
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
  resolveRealScopeOrSkip,
  FIXTURE_BUNDLE_PKG,
} from '../profile-reader/helpers.mjs';
import { makeStubAnchor } from '../v1.4.6-rc2/helpers.mjs';

let home;
let cleanupHome;
let restoreDshHome;

beforeEach(() => {
  restoreDshHome = sandboxDshHome();
  ({ home, cleanup: cleanupHome } = makeTempHome('ocms-rc4-parity-'));
});

afterEach(() => {
  try { cleanupHome(); } catch {}
  try { restoreDshHome(); } catch {}
});

function userModels() {
  return modelsConfig({ opencode: [{ id: 'user-model' }] });
}

// Flat rc2-style fixtures: one llm-pi-ai candidate row plus one insert
// bundle, no groups (the only shapes the stub implements).
function fixtures() {
  return [
    {
      name: 'matched user models over the insert bundle',
      profile: 'paritymatch',
      entries: 'USERMODELS',
    },
    {
      name: 'dormant llm row over the insert bundle',
      profile: 'paritydormant',
      entries: 'DORMANT',
    },
  ];
}

describe('v1.4.6-rc4 stub/real parity (rc2 fixtures)', () => {
  for (const fixture of fixtures()) {
    it('parity: stub and real agree on ' + fixture.name, async (t) => {
      const entries = fixture.entries === 'USERMODELS' ? [llmRow({ config: userModels() })] : [llmRow()];
      const profileDir = makeProfile(home, fixture.profile, { entries, bundles: [FIXTURE_BUNDLE_PKG] });
      makeFixtureBundle(profileDir);
      const stub = makeStubAnchor(t);
      const realScope = resolveRealScopeOrSkip(t);
      if (realScope === null) return;
      const target = bindReal(home, fixture.profile);
      const viaStub = await readManagedConfig(readerOpts(target, { installAnchorDir: stub.anchor }));
      const viaReal = await readManagedConfig(readerOpts(target, { installAnchorDir: realScope }));
      // Both paths must SUCCEED before their results can be compared. With two
      // failing paths the equality assertions below hold vacuously
      // (ok false === false, undefined status === undefined, undefined config
      // deep-equal undefined) and the parity claim is a false green.
      assert.equal(viaStub.ok, true, 'stub path must succeed before parity can be claimed: ' + JSON.stringify(viaStub).slice(0, 400));
      assert.equal(viaReal.ok, true, 'real path must succeed before parity can be claimed: ' + JSON.stringify(viaReal).slice(0, 400));
      assert.equal(viaStub.ok, viaReal.ok, 'ok differs: stub=' + JSON.stringify(viaStub).slice(0, 300) + ' real=' + JSON.stringify(viaReal).slice(0, 300));
      assert.equal(viaStub.status, viaReal.status, 'status differs: stub=' + viaStub.status + ' real=' + viaReal.status);
      assert.equal(viaStub.status, viaReal.status, 'status differs: stub=' + viaStub.status + ' real=' + viaReal.status);
      assert.deepEqual(viaStub.effectiveConfig, viaReal.effectiveConfig, 'parsed managed config differs');
    });
  }
});
