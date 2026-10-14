// OCMS-S v1.4.7-rc6 §7.2 skew-logic fixtures (contract v1.4.7-rc6 §7.2, item 2).
//
// 1.0.10-alpha.1 accepted, 1.0.10-alpha.2 accepted, 1.0.10-alpha.3 refused
// (INCOMPATIBLE_DSH), through all three paths: admitDependencyPackages, the
// commit path (ProfileAwareCommit -> resolveCommitUtils) and the composition
// path (readManagedConfig -> resolveCompositionUtils). Also refused: a
// range-looking string, a version prefix, and skew on dsh / dsh-app-boot /
// dsh-atomic-write.
//
// Every anchor is manifest-only under os.tmpdir, every call passes an explicit
// installAnchorDir and an explicit empty pathEnv, so no PATH dsh and no real
// ~/.dsh is ever read. No live calls, no network, no package code executed.
import { describe, it, beforeEach, afterEach } from 'node:test';
import path from 'node:path';
import { admitDependencyPackages, resolveProfileTarget } from '../../profile/target-resolver.mjs';
import { readManagedConfig } from '../../profile/config-reader.mjs';
import { ProfileAwareCommit } from '../../profile/commit.mjs';
import {
  assert,
  makeTempHome,
  sandboxDshHome,
  makeAnchor,
  makeProfile,
  bindTarget,
  noChangePlan,
  refusalText,
  assertAdmittedByVersionGate,
  assertRefusedByVersionGate,
  assertSkewRefused,
  INCLUDE_ALPHA_1,
  INCLUDE_ALPHA_2,
  INCLUDE_ALPHA_3,
  INCLUDE_RANGE_LOOKING,
  INCLUDE_PREFIX,
} from './skew-fixtures.mjs';

// 'admit' = the version gate must admit the anchor versions; 'refuse' = the
// version gate must refuse with INCOMPATIBLE_DSH and the named skew detail.
const CASES = [
  {
    id: 'A1',
    label: 'include 1.0.10-alpha.1',
    expect: 'admit',
    include: INCLUDE_ALPHA_1,
    observed: INCLUDE_ALPHA_1,
  },
  {
    id: 'A2',
    label: 'include 1.0.10-alpha.2',
    expect: 'admit',
    include: INCLUDE_ALPHA_2,
    observed: INCLUDE_ALPHA_2,
  },
  {
    id: 'A3',
    label: 'include 1.0.10-alpha.3',
    expect: 'refuse',
    include: INCLUDE_ALPHA_3,
    skew: { pkg: 'cordis-plugin-include', observed: INCLUDE_ALPHA_3 },
  },
  {
    id: 'RANGE',
    label: 'the range-looking ' + INCLUDE_RANGE_LOOKING,
    expect: 'refuse',
    include: INCLUDE_RANGE_LOOKING,
    skew: { pkg: 'cordis-plugin-include', observed: INCLUDE_RANGE_LOOKING },
  },
  {
    id: 'PREFIX',
    label: 'the prefix ' + INCLUDE_PREFIX,
    expect: 'refuse',
    include: INCLUDE_PREFIX,
    skew: { pkg: 'cordis-plugin-include', observed: INCLUDE_PREFIX },
  },
  {
    id: 'DSHSKEW',
    label: 'a skewed dsh baseline 0.9.9',
    expect: 'refuse',
    skew: { pkg: 'dsh', version: '0.9.9', observed: '0.9.9' },
  },
  {
    id: 'APPBOOTSKEW',
    label: 'a skewed dsh-app-boot 8.8.8',
    expect: 'refuse',
    skew: { pkg: 'dsh-app-boot', version: '8.8.8', observed: '8.8.8' },
  },
  {
    id: 'ATOMICSKEW',
    label: 'a skewed dsh-atomic-write 9.9.9',
    expect: 'refuse',
    // The composition path never imports the atomic-write library and its
    // version gate (config-reader.mjs resolveCompositionUtils need map) covers
    // only dsh-app-boot, cordis-plugin-include and dsh, so this skew cannot
    // refuse there. The case is asserted on the two paths that DO gate on it.
    compositionApplicable: false,
    skew: { pkg: 'dsh-atomic-write', version: '9.9.9', observed: '9.9.9' },
  },
];

let home;
let restoreDshHome;
let cleanupHome;
let target;

const anchorFor = (c) => makeAnchor(path.join(home, 'anchor-' + c.id), {
  include: c.expect === 'refuse' && c.include !== undefined ? c.include : (c.include ?? INCLUDE_ALPHA_1),
  skew: c.skew && c.skew.version !== undefined ? { pkg: c.skew.pkg, version: c.skew.version } : null,
});

const viaAdmission = (scope) => admitDependencyPackages({
  profileDirReal: target.profileDirReal,
  installAnchorDir: scope,
  pathEnv: '',
});

const viaCommit = (scope) => ProfileAwareCommit({
  plan: noChangePlan(target),
  installAnchorDir: scope,
  pathEnv: '',
  waitMs: 8000,
  telemetryDisabledEnv: undefined,
});

const viaComposition = (scope) => readManagedConfig({
  target,
  installAnchorDir: scope,
  pathEnv: '',
  telemetryDisabledEnv: undefined,
});

beforeEach(() => {
  restoreDshHome = sandboxDshHome();
  ({ home, cleanup: cleanupHome } = makeTempHome());
  // The binding itself is always taken over a clean alpha.1 anchor, so a case
  // anchor carrying skew is the only thing the path under test ever reads.
  const bound = makeAnchor(path.join(home, 'anchor-bound'), { include: INCLUDE_ALPHA_1 });
  makeProfile(home, 'rc6fix');
  target = bindTarget(home, 'rc6fix', bound);
});

afterEach(() => {
  try { cleanupHome(); } catch { /* best effort */ }
  try { restoreDshHome(); } catch { /* best effort */ }
});

describe('v1.4.7-rc6 §7.2 skew logic — admitDependencyPackages', () => {
  for (const c of CASES) {
    it('RC6-SKEW-ADMIT-' + c.id + ' admission ' + (c.expect === 'admit' ? 'admits ' : 'refuses ') + c.label, () => {
      const r = viaAdmission(anchorFor(c));
      if (c.expect === 'admit') {
        assert.equal(r.ok, true, 'expected admission (' + refusalText(r) + ')');
        assert.equal(r.code, undefined, 'an admitted anchor carries no refusal code');
      } else {
        assertSkewRefused(r, c.skew.pkg, c.skew.observed, 'RC6-SKEW-ADMIT-' + c.id);
      }
    });
  }

  it('RC6-EVIDENCE-A2 admission evidence records the observed alpha.2 include version', () => {
    const scope = anchorFor({ id: 'EVIDENCE-A2', include: INCLUDE_ALPHA_2 });
    const admitted = viaAdmission(scope);
    assert.equal(admitted.ok, true, 'alpha.2 must be admitted (' + refusalText(admitted) + ')');
    assert.equal(
      admitted.evidence.versions['cordis-plugin-include'],
      INCLUDE_ALPHA_2,
      'evidence must report the OBSERVED manifest version, never the expected constant',
    );
    assert.equal(admitted.evidence.dshVersion, '0.2.1-alpha.2');

    makeProfile(home, 'rc6ev');
    const bound = resolveProfileTarget({ profileName: 'rc6ev', dshHome: home, installAnchorDir: scope, pathEnv: '' });
    assert.equal(bound.ok, true, 'binding over the alpha.2 anchor must succeed (' + refusalText(bound) + ')');
    assert.equal(
      bound.target.dependencyEvidence.versions['cordis-plugin-include'],
      INCLUDE_ALPHA_2,
      'bound dependency evidence must report the OBSERVED alpha.2 version',
    );
  });

  it('RC6-EVIDENCE-A1 admission evidence records the observed alpha.1 include version', () => {
    const scope = anchorFor({ id: 'EVIDENCE-A1', include: INCLUDE_ALPHA_1 });
    const admitted = viaAdmission(scope);
    assert.equal(admitted.ok, true, 'expected admission (' + refusalText(admitted) + ')');
    assert.equal(admitted.evidence.versions['cordis-plugin-include'], INCLUDE_ALPHA_1);
    assert.equal(admitted.evidence.dshVersion, '0.2.1-alpha.2');
  });
});

describe('v1.4.7-rc6 §7.2 skew logic — commit path (resolveCommitUtils)', () => {
  for (const c of CASES) {
    it('RC6-SKEW-COMMIT-' + c.id + ' commit path ' + (c.expect === 'admit' ? 'admits ' : 'refuses ') + c.label, async () => {
      const r = await viaCommit(anchorFor(c));
      const label = 'RC6-SKEW-COMMIT-' + c.id;
      if (c.expect === 'admit') {
        assertAdmittedByVersionGate(r, label);
      } else {
        assertRefusedByVersionGate(r, label);
      }
    });
  }
});

describe('v1.4.7-rc6 §7.2 skew logic — composition path (resolveCompositionUtils)', () => {
  for (const c of CASES) {
    if (c.compositionApplicable === false) continue;
    it('RC6-SKEW-COMPOSE-' + c.id + ' composition path ' + (c.expect === 'admit' ? 'admits ' : 'refuses ') + c.label, async () => {
      const r = await viaComposition(anchorFor(c));
      const label = 'RC6-SKEW-COMPOSE-' + c.id;
      if (c.expect === 'admit') {
        assertAdmittedByVersionGate(r, label);
      } else {
        assertRefusedByVersionGate(r, label);
      }
    });
  }
});
