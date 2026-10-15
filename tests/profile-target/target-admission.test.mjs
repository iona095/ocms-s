// S1 RED→GREEN: profile target admission (P1-A §5 S1; P0-R2 §§8.1–8.4, 8.7).
//
// Covers T03 (missing/duplicate/non-owned entry), T09 (target identity facts),
// T17 (production/scratch classification) plus S1-specific negatives. All
// fixtures are disposable synthetic profiles under os.tmpdir(); no test reads
// or writes the real web profile, real home, accounts, or gateways.
//
// RED record: created before profile/target-resolver.mjs existed; initial run
// fails with MODULE_NOT_FOUND for every case below.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  makeTempHome,
  makeProfile,
  makeAnchor,
  makeFakeNpmRoot,
  makeProfileScope,
  PINNED_SCOPE,
  EXPECTED,
  standardEntries,
  llmRow,
  decoyRow,
  snapshotTree,
  assertNoMutation,
} from './helpers.mjs';
import {
  validateProfileName,
  classifyTarget,
  sameTarget,
  resolveProfileTarget,
} from '../../profile/target-resolver.mjs';

let home;
let cleanupHome;
let anchor;
let fakeRoot;
let savedDshHome;
let sandboxHome;

function opts(extra = {}) {
  // pathEnv defaults to empty so the real PATH never participates unless a
  // test explicitly injects a fixture PATH (hermetic; see DEP-PATH-ANCHOR).
  // An explicit anchor plus a satisfying PATH anchor is ambiguous by design.
  return { profileName: 'scratch1', dshHome: home, installAnchorDir: anchor, pathEnv: '', ...extra };
}

function validProfile(name = 'scratch1', entries = standardEntries()) {
  return makeProfile(home, name, { entries });
}

beforeEach(() => {
  ({ home, cleanup: cleanupHome } = makeTempHome());
  anchor = makeAnchor(fs.mkdtempSync(path.join(os.tmpdir(), 'ocms-s1-anchor-')));
  fakeRoot = null;
  // Sandbox the classification truth anchor (DSH's own env-override input):
  // no test ever derives the real home, so no test can contact it.
  savedDshHome = process.env.DSH_HOME;
  sandboxHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ocms-s1-sandbox-home-'));
  process.env.DSH_HOME = sandboxHome;
});

afterEach(() => {
  if (savedDshHome === undefined) delete process.env.DSH_HOME;
  else process.env.DSH_HOME = savedDshHome;
  fs.rmSync(sandboxHome, { recursive: true, force: true });
  cleanupHome();
  if (fakeRoot) fs.rmSync(fakeRoot, { recursive: true, force: true });
});

describe('S1 T17 — explicit profile-name admission (P0-R2 §8.1)', () => {
  for (const bad of [undefined, null, '', 42, {}, []]) {
    it(`RED-S1-NAME-REQUIRED rejects ${JSON.stringify(bad)}`, () => {
      const r = bad === undefined
        ? resolveProfileTarget({ dshHome: home, installAnchorDir: anchor })
        : resolveProfileTarget(opts({ profileName: bad }));
      assert.equal(r.ok, false);
      assert.equal(r.code, 'INVALID_PROFILE_NAME');
    });
  }

  for (const bad of ['a/b', 'a\\b', '. Spatial', 'a b', 'a:b', 'a*b', '-lead', 'trail.', 'trail ', 'CON', 'com1', 'NUL', '.']) {
    it(`RED-S1-NAME-GRAMMAR rejects ${JSON.stringify(bad)}`, () => {
      assert.equal(validateProfileName(bad).ok, false);
      assert.equal(validateProfileName(bad).code, 'INVALID_PROFILE_NAME');
      assert.equal(resolveProfileTarget(opts({ profileName: bad })).code, 'INVALID_PROFILE_NAME');
    });
  }

  for (const bad of ['.', '..', 'node_modules', 'NODE_MODULES']) {
    it(`RED-S1-NAME-RESERVED rejects ${JSON.stringify(bad)}`, () => {
      assert.equal(validateProfileName(bad).code, 'INVALID_PROFILE_NAME');
    });
  }

  it('RED-S1-NAME-SEPARATOR rejects slash/backslash/dotdot', () => {
    for (const bad of ['x/y', 'x\\y', '..', '../x']) {
      assert.equal(validateProfileName(bad).ok, false, bad);
    }
  });

  it('RED-S1-NAME-OK accepts ordinary names incl. dots/dashes/underscores', () => {
    for (const good of ['web', 'scratch1', 'my.profile-2_x']) {
      assert.equal(validateProfileName(good).ok, true, good);
    }
  });

  it('RED-S1-NAME-LENGTH rejects overlong names (documented fail-closed narrowing)', () => {
    assert.equal(validateProfileName('a'.repeat(129)).code, 'INVALID_PROFILE_NAME');
    assert.equal(validateProfileName('a'.repeat(128)).ok, true);
  });
});

describe('S1 T17 — home/profile path admission (P0-R2 §8.1–8.2)', () => {
  it('RED-S1-PATH-MISSING-DIR refuses uninitialized profile and creates nothing', () => {
    const r = resolveProfileTarget(opts({ profileName: 'ghost' }));
    assert.equal(r.ok, false);
    assert.equal(r.code, 'PROFILE_NOT_INITIALIZED');
    assert.equal(fs.existsSync(path.join(home, 'profiles', 'ghost')), false);
  });

  it('RED-S1-PATH-MISSING-MANIFEST refuses profile dir without package.json', () => {
    fs.mkdirSync(path.join(home, 'profiles', 'bare'), { recursive: true });
    const r = resolveProfileTarget(opts({ profileName: 'bare' }));
    assert.equal(r.ok, false);
    assert.equal(r.code, 'PROFILE_NOT_INITIALIZED');
  });

  it('RED-S1-PATH-BAD-MANIFEST refuses unparseable package.json', () => {
    makeProfile(home, 'badman', { manifest: 'invalid-json', entries: standardEntries() });
    assert.equal(resolveProfileTarget(opts({ profileName: 'badman' })).code, 'PROFILE_NOT_INITIALIZED');
  });

  it('RED-S1-PATH-MISSING-PATCH refuses initialized profile without cordis.patch.yml', () => {
    makeProfile(home, 'nopatch', { entries: null });
    const r = resolveProfileTarget(opts({ profileName: 'nopatch' }));
    assert.equal(r.ok, false);
    assert.equal(r.code, 'PATCH_UNREADABLE');
  });

  it('RED-S1-PATH-JUNCTION-ESCAPE refuses profile dir escaping the home', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'ocms-s1-outside-'));
    try {
      makeProfile(outside, 'real', { entries: standardEntries() });
      fs.mkdirSync(path.join(home, 'profiles'), { recursive: true });
      fs.symlinkSync(path.join(outside, 'profiles', 'real'), path.join(home, 'profiles', 'evil'), 'junction');
      const r = resolveProfileTarget(opts({ profileName: 'evil' }));
      assert.equal(r.ok, false);
      assert.equal(r.code, 'SYMLINK_ESCAPE');
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it('RED-S1-PATH-FILE-SYMLINK refuses patch file symlinked outside the profile', { todo: process.platform !== 'win32' ? false : undefined }, (t) => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'ocms-s1-outside-'));
    try {
      const target = path.join(outside, 'evil-patch.yml');
      fs.writeFileSync(target, '- id: llm-pi-ai\n', 'utf8');
      const dir = makeProfile(home, 'linked', { entries: standardEntries() });
      fs.rmSync(path.join(dir, 'cordis.patch.yml'));
      const linkPath = path.join(dir, 'cordis.patch.yml');
      try {
        fs.symlinkSync(target, linkPath, 'file');
      } catch (err) {
        if (err && (err.code === 'EPERM' || err.code === 'EACCES')) {
          // Declared skip, never a silent pass: the escape assertion below is
          // the property under test and it cannot run without symlink privilege.
          return t.skip('symlink creation requires Windows developer mode (file symlink refused with ' + err.code + ')');
        }
        throw err;
      }
      assert.ok(fs.lstatSync(linkPath).isSymbolicLink(), 'fixture precondition: the patch path must be a real file symlink');
      const r = resolveProfileTarget(opts({ profileName: 'linked' }));
      assert.equal(r.ok, false, 'a patch file symlinked outside the profile must be refused: ' + JSON.stringify(r).slice(0, 300));
      assert.equal(r.code, 'SYMLINK_ESCAPE');
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe('S1 T17 — production/scratch classification (P0-R2 §8.7, R4)', () => {
  it('RED-S1-CLASS-PURE production iff under home (synthetic paths, no fs)', () => {
    const h = path.resolve('/synthetic/home');
    assert.equal(classifyTarget(path.join(h, 'profiles', 'web'), h), 'PRODUCTION');
    assert.equal(classifyTarget(path.resolve('/elsewhere/fixture'), h), 'SCRATCH');
    assert.equal(classifyTarget(h, h), 'SCRATCH');
  });

  it('RED-S1-CLASS-SCRATCH admits fixture profile outside the truth home', () => {
    validProfile();
    const r = resolveProfileTarget(opts());
    assert.equal(r.ok, true);
    assert.equal(r.target.classification, 'SCRATCH');
    assert.equal(r.target.profileName, 'scratch1');
  });

  it('RED-S1-CLASS-PRODUCTION fixture under the truth home stays PRODUCTION with --scratch refused', () => {
    // Simulate "the real home is this fixture" through DSH's own env-override
    // input (no caller-controlled classification flag exists anywhere).
    process.env.DSH_HOME = home;
    validProfile();
    const prod = resolveProfileTarget(opts({ scratchMode: false }));
    assert.equal(prod.ok, true);
    assert.equal(prod.target.classification, 'PRODUCTION');
    const refused = resolveProfileTarget(opts({ scratchMode: true }));
    assert.equal(refused.ok, false);
    assert.equal(refused.code, 'SCRATCH_MODE_PRODUCTION_REFUSED');
  });

  it('RED-S1-CLASS-NO-DOWNGRADE scratch flag never reclassifies production', () => {
    process.env.DSH_HOME = home;
    validProfile();
    const r = resolveProfileTarget(opts({ scratchMode: true }));
    assert.equal(r.ok, false);
    assert.equal(r.code, 'SCRATCH_MODE_PRODUCTION_REFUSED');
    assert.ok(!('classification' in r) || r.classification !== 'SCRATCH');
  });
});

describe('S1 T03 — entry identity admission (P0-R2 §8.4)', () => {
  it('RED-S1-ENTRY-OK finds llm-pi-ai by id with full identity bound', () => {
    validProfile();
    const snap = snapshotTree(home);
    const r = resolveProfileTarget(opts());
    assert.equal(r.ok, true);
    assert.equal(r.target.pluginEntryName, 'LLM Pi AI');
    assert.ok(r.target.profileDirReal);
    assert.ok(r.target.patchPathReal);
    assert.ok(r.target.patchDigest);
    assert.deepEqual(r.target.declaredOverlays, []);
    assert.equal(r.target.liveAttestation, null);
    assertNoMutation(snap, home, 'resolve is read-only');
  });

  it('RED-S1-ENTRY-INDEX-AGNOSTIC finds entry at 0/middle/last, never index 12', () => {
    const mk = (entries) => {
      const dir = makeProfile(home, 'pos', { entries });
      return resolveProfileTarget(opts({ profileName: 'pos' }));
    };
    const d = decoyRow('zz');
    assert.equal(mk([llmRow(), d, d]).ok, true);
    fs.rmSync(path.join(home, 'profiles', 'pos'), { recursive: true, force: true });
    assert.equal(mk([d, d, llmRow()]).ok, true);
    fs.rmSync(path.join(home, 'profiles', 'pos'), { recursive: true, force: true });
    assert.equal(mk([d, llmRow(), d]).ok, true);
    fs.rmSync(path.join(home, 'profiles', 'pos'), { recursive: true, force: true });
    const many = Array.from({ length: 14 }, (_, i) => decoyRow(`pad-${i}`));
    many.splice(12, 0, decoyRow('at-twelve'));
    many.push(llmRow());
    const r = mk(many);
    assert.equal(r.ok, true);
    assert.equal(r.target.pluginEntryName, 'LLM Pi AI');
  });

  it('RED-S1-ENTRY-MISSING refuses zero candidates', () => {
    makeProfile(home, 'noentry', { entries: [decoyRow('a'), decoyRow('b')] });
    const r = resolveProfileTarget(opts({ profileName: 'noentry' }));
    assert.equal(r.ok, false);
    assert.equal(r.code, 'PLUGIN_ENTRY_MISSING');
  });

  it('RED-S1-ENTRY-DUPLICATE refuses two rows in the same file', () => {
    makeProfile(home, 'dup', { entries: [llmRow(), decoyRow('x'), llmRow()] });
    const r = resolveProfileTarget(opts({ profileName: 'dup' }));
    assert.equal(r.ok, false);
    assert.equal(r.code, 'PLUGIN_ENTRY_DUPLICATE');
  });

  it('RED-S1-ENTRY-DUPLICATE-ACROSS-LAYERS refuses user+home rows', () => {
    makeProfile(home, 'dupx', { entries: [llmRow()], homePatch: [llmRow()] });
    const r = resolveProfileTarget(opts({ profileName: 'dupx' }));
    assert.equal(r.ok, false);
    assert.equal(r.code, 'PLUGIN_ENTRY_DUPLICATE');
  });

  it('RED-S1-ENTRY-INSERT-ONLY refuses (insert rows are not candidates)', () => {
    makeProfile(home, 'inso', { entries: [llmRow({ insert: true })] });
    assert.equal(resolveProfileTarget(opts({ profileName: 'inso' })).code, 'PLUGIN_ENTRY_MISSING');
  });

  it('RED-S1-ENTRY-INSERT-FLAG admits candidate but flags the collision', () => {
    makeProfile(home, 'insf', { entries: [llmRow(), llmRow({ insert: true })] });
    const r = resolveProfileTarget(opts({ profileName: 'insf' }));
    assert.equal(r.ok, true);
    assert.ok(r.target.warnings.includes('INSERT_ROW_SAME_ID'));
  });

  it('RED-S1-ENTRY-NOT-OWNED refuses home-only definitions', () => {
    makeProfile(home, 'owned', { entries: [decoyRow('a')], homePatch: [llmRow()] });
    const r = resolveProfileTarget(opts({ profileName: 'owned' }));
    assert.equal(r.ok, false);
    assert.equal(r.code, 'NOT_PROFILE_OWNED');
  });

  it('RED-S1-ENTRY-NOT-OWNED refuses non-mapping user config (fail-closed narrowing)', () => {
    makeProfile(home, 'scalar', { entries: [llmRow({ config: 'scalar' })] });
    assert.equal(resolveProfileTarget(opts({ profileName: 'scalar' })).code, 'NOT_PROFILE_OWNED');
  });

  it('RED-S1-ENTRY-MALFORMED-YAML refuses without writing', () => {
    makeProfile(home, 'badyaml', { entries: { raw: '- id: [unclosed\n  bad: : :\n' } });
    const snap = snapshotTree(home);
    const r = resolveProfileTarget(opts({ profileName: 'badyaml' }));
    assert.equal(r.ok, false);
    assert.ok(['PATCH_PARSE_ERROR', 'PATCH_UNREADABLE'].includes(r.code));
    assertNoMutation(snap, home, 'parse refusal is read-only');
  });

  it('RED-S1-ENTRY-MAPPING-ROOT refuses non-sequence root', () => {
    makeProfile(home, 'maproot', { entries: { raw: 'llm-pi-ai:\n  providers: {}\n' } });
    assert.equal(resolveProfileTarget(opts({ profileName: 'maproot' })).code, 'PATCH_ROOT_NOT_SEQUENCE');
  });
});

describe('S1 T09 — target identity facts (P0-R2 §8.3/8.6-part)', () => {
  it('RED-S1-ID-BINDING carries all seven future Preview fields', () => {
    validProfile();
    const r = resolveProfileTarget(opts({ declaredOverlays: ['x.yml'], liveAttestation: 'mode-a' }));
    assert.equal(r.ok, true);
    for (const k of ['profileName', 'profileDirReal', 'patchPathReal', 'pluginEntryName', 'classification', 'declaredOverlays', 'liveAttestation']) {
      assert.ok(k in r.target, `missing ${k}`);
    }
    assert.deepEqual(r.target.declaredOverlays, ['x.yml']);
    assert.equal(r.target.liveAttestation, 'mode-a');
  });

  it('RED-S1-ID-SWITCH same profile re-resolves equal; other profile differs', () => {
    validProfile('aaa');
    validProfile('bbb');
    const a1 = resolveProfileTarget(opts({ profileName: 'aaa' })).target;
    const a2 = resolveProfileTarget(opts({ profileName: 'aaa' })).target;
    const b = resolveProfileTarget(opts({ profileName: 'bbb' })).target;
    assert.equal(sameTarget(a1, a2), true);
    assert.equal(sameTarget(a1, b), false);
  });

  it('RED-S1-ID-DIGEST byte change alters the bound digest', () => {
    validProfile();
    const before = resolveProfileTarget(opts()).target.patchDigest;
    fs.appendFileSync(path.join(home, 'profiles', 'scratch1', 'cordis.patch.yml'), '# touch\n', 'utf8');
    const after = resolveProfileTarget(opts()).target.patchDigest;
    assert.notEqual(before, after);
  });
});

describe('S1 dependency admission — strategy A (P0-R2 §11.6)', () => {
  it('RED-S1-DEP-OK admits exact pinned combination from explicit anchor', () => {
    validProfile();
    const r = resolveProfileTarget(opts());
    assert.equal(r.ok, true);
    assert.equal(r.target.dependencyEvidence.versions['dsh-atomic-write'], '0.2.1-alpha.2');
    assert.equal(r.target.dependencyEvidence.versions['dsh-app-boot'], '0.2.1-alpha.2');
    assert.equal(r.target.dependencyEvidence.versions['cordis-plugin-include'], '1.0.10-alpha.1');
    assert.equal(r.target.dependencyEvidence.dshVersion, '0.2.1-alpha.2');
  });

  it('RED-S1-DEP-PATH-ANCHOR resolves via fixture PATH without explicit anchor', () => {
    validProfile();
    fakeRoot = makeFakeNpmRoot(os.tmpdir());
    const exeDir = fakeRoot;
    const r = resolveProfileTarget({
      profileName: 'scratch1',
      dshHome: home,
      pathEnv: `${exeDir}${path.delimiter}${process.env.PATH ?? ''}`,
    });
    assert.equal(r.ok, true);
    assert.ok(r.target.dependencyEvidence.exePath);
  });

  it('RED-S1-DEP-SKEW refuses wrong utility version, never substitutes', () => {
    validProfile();
    const skew = makeAnchor(fs.mkdtempSync(path.join(os.tmpdir(), 'ocms-s1-skew-')), {
      skew: { pkg: 'dsh-atomic-write', version: '9.9.9' },
    });
    const r = resolveProfileTarget(opts({ installAnchorDir: skew }));
    assert.equal(r.ok, false);
    assert.equal(r.code, 'INCOMPATIBLE_DSH');
    assert.match(r.detail ?? '', /version-skew/);
  });

  it('RED-S1-DEP-MISSING refuses absent utility package', () => {
    validProfile();
    const thin = makeAnchor(fs.mkdtempSync(path.join(os.tmpdir(), 'ocms-s1-thin-')), { drop: 'dsh-app-boot' });
    const r = resolveProfileTarget(opts({ installAnchorDir: thin }));
    assert.equal(r.code, 'INCOMPATIBLE_DSH');
    assert.match(r.detail ?? '', /package-missing/);
  });

  it('RED-S1-DEP-DSH-VERSION refuses unsupported dsh baseline', () => {
    validProfile();
    const odd = makeAnchor(fs.mkdtempSync(path.join(os.tmpdir(), 'ocms-s1-odd-')), { dshVersion: '0.9.9' });
    const r = resolveProfileTarget(opts({ installAnchorDir: odd }));
    assert.equal(r.code, 'INCOMPATIBLE_DSH');
    assert.match(r.detail ?? '', /dsh is 0\.9\.9/);
  });

  it('RED-S1-DEP-NO-ANCHOR refuses when nothing resolves', () => {
    validProfile();
    const r = resolveProfileTarget({ profileName: 'scratch1', dshHome: home, pathEnv: '' });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'INCOMPATIBLE_DSH');
    assert.match(r.detail ?? '', /anchor-unresolved/);
  });

  it('RED-S1-DEP-AMBIGUOUS refuses explicit anchor disagreeing with PATH anchor', () => {
    validProfile();
    fakeRoot = makeFakeNpmRoot(os.tmpdir());
    const r = resolveProfileTarget({
      profileName: 'scratch1',
      dshHome: home,
      installAnchorDir: anchor,
      pathEnv: `${fakeRoot}${path.delimiter}`,
    });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'INCOMPATIBLE_DSH');
    assert.match(r.detail ?? '', /ambiguous/i);
  });

  it('RED-S1-DEP-IMPLICIT-ATTEMPT undefined profile never falls back to a default', () => {
    validProfile();
    const r = resolveProfileTarget({ dshHome: home, installAnchorDir: anchor });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'INVALID_PROFILE_NAME');
  });
});

describe('S1-R1 B1 — version-skew fallback refusal (strategy A precedence)', () => {
  function pathResolve(extra = {}) {
    return resolveProfileTarget({ profileName: 'scratch1', dshHome: home, pathEnv: fakeRoot, ...extra });
  }

  it('B1-01 profile-local skew is not bypassed by a valid install set', () => {
    const dir = validProfile();
    makeProfileScope(dir, { ...PINNED_SCOPE, 'dsh-atomic-write': '9.9.9' });
    fakeRoot = makeFakeNpmRoot(os.tmpdir());
    const r = pathResolve();
    assert.equal(r.ok, false);
    assert.equal(r.code, 'INCOMPATIBLE_DSH');
    assert.match(r.detail ?? '', /version-skew: dsh-atomic-write is 9\.9\.9/);
  });

  it('B1-02 early missing package does not conceal a later skew', () => {
    const dir = validProfile();
    makeProfileScope(dir, { 'dsh-atomic-write': null, 'dsh-app-boot': '8.8.8', 'cordis-plugin-include': EXPECTED.include });
    fakeRoot = makeFakeNpmRoot(os.tmpdir());
    const r = pathResolve();
    assert.equal(r.ok, false);
    assert.equal(r.code, 'INCOMPATIBLE_DSH');
    assert.match(r.detail ?? '', /version-skew: dsh-app-boot is 8\.8\.8/);
  });

  it('B1-03 entirely absent profile scope falls through to install', () => {
    validProfile();
    fakeRoot = makeFakeNpmRoot(os.tmpdir());
    const r = pathResolve();
    assert.equal(r.ok, true);
    assert.equal(r.target.dependencyEvidence.anchorKind, 'install');
  });

  it('B1-04 complete pinned profile scope wins by precedence', () => {
    const dir = validProfile();
    makeProfileScope(dir, { ...PINNED_SCOPE });
    fakeRoot = makeFakeNpmRoot(os.tmpdir());
    const r = pathResolve();
    assert.equal(r.ok, true);
    assert.equal(r.target.dependencyEvidence.anchorKind, 'profile');
    assert.equal(r.target.dependencyEvidence.dshVersion, EXPECTED.dsh);
  });

  it('B1-05 explicit-anchor skew refuses despite a valid PATH anchor', () => {
    validProfile();
    fakeRoot = makeFakeNpmRoot(os.tmpdir());
    const skew = makeAnchor(fs.mkdtempSync(path.join(os.tmpdir(), 'ocms-s1-b1-05-')), {
      skew: { pkg: 'dsh-app-boot', version: '7.7.7' },
    });
    const r = resolveProfileTarget({ profileName: 'scratch1', dshHome: home, installAnchorDir: skew, pathEnv: fakeRoot });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'INCOMPATIBLE_DSH');
    assert.match(r.detail ?? '', /version-skew: dsh-app-boot is 7\.7\.7/);
  });

  it('B1-06 explicit/PATH ambiguity still refuses when a profile scope also satisfies', () => {
    const dir = validProfile();
    makeProfileScope(dir, { ...PINNED_SCOPE });
    fakeRoot = makeFakeNpmRoot(os.tmpdir());
    const r = resolveProfileTarget({
      profileName: 'scratch1',
      dshHome: home,
      installAnchorDir: anchor,
      pathEnv: `${fakeRoot}${path.delimiter}`,
    });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'INCOMPATIBLE_DSH');
    assert.match(r.detail ?? '', /ambiguous/i);
  });

  it('B1-07 malformed manifest in a higher-priority scope refuses fail-closed', () => {
    const dir = validProfile();
    makeProfileScope(dir, { 'dsh-atomic-write': 'MALFORMED', 'dsh-app-boot': EXPECTED.appBoot, 'cordis-plugin-include': EXPECTED.include });
    fakeRoot = makeFakeNpmRoot(os.tmpdir());
    const r = pathResolve();
    assert.equal(r.ok, false);
    assert.equal(r.code, 'INCOMPATIBLE_DSH');
    assert.match(r.detail ?? '', /unverifiable-manifest: dsh-atomic-write/);
  });

  it('B1-08 admitted packages never mix scopes', () => {
    const dir = validProfile();
    makeProfileScope(dir, { 'dsh-atomic-write': EXPECTED.atomicWrite, 'dsh-app-boot': null, 'cordis-plugin-include': null });
    fakeRoot = makeFakeNpmRoot(os.tmpdir());
    const r = pathResolve();
    assert.equal(r.ok, true);
    const ev = r.target.dependencyEvidence;
    const norm = (p) => (process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p));
    for (const pkg of ['dsh-atomic-write', 'dsh-app-boot', 'cordis-plugin-include']) {
      assert.ok(norm(ev.packages[pkg].path).startsWith(norm(ev.anchorDir) + path.sep), `${pkg} admitted from outside ${ev.anchorDir}`);
    }
  });

  it('B1-09 evidence refers only to admitted packages; refusals carry none', () => {
    const dir = validProfile();
    makeProfileScope(dir, { ...PINNED_SCOPE });
    fakeRoot = makeFakeNpmRoot(os.tmpdir());
    const good = pathResolve();
    assert.equal(good.ok, true);
    assert.deepEqual(Object.keys(good.target.dependencyEvidence.packages).sort(), ['cordis-plugin-include', 'dsh-app-boot', 'dsh-atomic-write']);
    assert.deepEqual(good.target.dependencyEvidence.versions, { ...PINNED_SCOPE });
    makeProfileScope(dir, { ...PINNED_SCOPE, 'cordis-plugin-include': '0.0.0' });
    const bad = pathResolve();
    assert.equal(bad.ok, false);
    assert.equal(bad.code, 'INCOMPATIBLE_DSH');
    assert.equal('target' in bad, false);
    assert.equal('evidence' in bad, false);
  });
});

describe('S1-R1 B2 — complete target identity comparison (P0-R2 §8.3)', () => {
  function boundTarget(overrides = {}) {
    validProfile();
    const r = resolveProfileTarget(opts());
    assert.equal(r.ok, true);
    return { ...r.target, ...overrides };
  }

  it('B2-01 changed pluginEntryName compares false', () => {
    const t = boundTarget();
    assert.equal(sameTarget(t, { ...t, pluginEntryName: `${t.pluginEntryName} X` }), false);
  });

  it('B2-02 changed overlay list compares false', () => {
    const t = boundTarget();
    assert.equal(sameTarget(t, { ...t, declaredOverlays: ['x.yml'] }), false);
  });

  it('B2-03 changed overlay ordering compares false', () => {
    const t = boundTarget();
    const a = { ...t, declaredOverlays: ['a.yml', 'b.yml'] };
    const b = { ...t, declaredOverlays: ['b.yml', 'a.yml'] };
    assert.equal(sameTarget(a, b), false);
  });

  it('B2-04 changed attestation mode compares false', () => {
    const t = boundTarget();
    assert.equal(sameTarget(t, { ...t, liveAttestation: 'mode-b' }), false);
    assert.equal(sameTarget({ ...t, liveAttestation: 'mode-a' }, { ...t, liveAttestation: null }), false);
  });

  it('B2-05 changed attestation payload compares false', () => {
    const t = boundTarget();
    const a = { ...t, liveAttestation: { mode: 'b', overlays: ['x.yml'] } };
    const b = { ...t, liveAttestation: { mode: 'b', overlays: ['y.yml'] } };
    assert.equal(sameTarget(a, b), false);
  });

  it('B2-06 separately constructed equivalent objects compare true', () => {
    const t = boundTarget({ declaredOverlays: ['a.yml'], liveAttestation: { mode: 'b', overlays: [] } });
    const clone = JSON.parse(JSON.stringify(t));
    assert.equal(sameTarget(t, clone), true);
  });

  it('B2-07 changed classification-home anchor compares false', () => {
    const t = boundTarget();
    const anchorValue = 'dshHomeReal' in t ? `${t.dshHomeReal}-changed` : 'synthetic-anchor';
    assert.ok('dshHomeReal' in t, 'target binds the classification-home anchor');
    assert.equal(sameTarget(t, { ...t, dshHomeReal: anchorValue }), false);
  });

  it('B2-08 changed patchDigest compares false', () => {
    const t = boundTarget();
    assert.equal(sameTarget(t, { ...t, patchDigest: '0'.repeat(64) }), false);
  });

  it('B2-09 changed profileName or paths compare false', () => {
    const t = boundTarget();
    assert.equal(sameTarget(t, { ...t, profileName: 'other' }), false);
    assert.equal(sameTarget(t, { ...t, patchPathReal: `${t.patchPathReal}.bak` }), false);
    assert.equal(sameTarget(t, { ...t, classification: t.classification === 'SCRATCH' ? 'PRODUCTION' : 'SCRATCH' }), false);
  });

  it('B2-10 Windows path case behavior stays consistent', () => {
    const t = boundTarget();
    const cased = { ...t, profileDirReal: t.profileDirReal.toUpperCase(), patchPathReal: t.patchPathReal.toUpperCase() };
    assert.equal(sameTarget(t, cased), process.platform === 'win32');
    assert.equal(sameTarget(t, { ...t }), true);
  });

  it('B2-11 missing/malformed identity data never compares true', () => {
    const t = boundTarget();
    for (const bad of [null, undefined, 'x', 42, [], {}, { profileName: 'a' }, { ...t, declaredOverlays: 'not-an-array' }, { ...t, liveAttestation: () => 0 }, { ...t, pluginEntryName: undefined }]) {
      assert.equal(sameTarget(t, bad), false, `expected false for ${String(typeof bad)}`);
      assert.equal(sameTarget(bad, t), false, `expected false (mirrored) for ${String(typeof bad)}`);
    }
    assert.equal(sameTarget({}, {}), false);
  });
});

describe('S1-R2 B2 — reference-bypass and snapshot correction', () => {
  function boundTarget(overrides = {}) {
    validProfile();
    const r = resolveProfileTarget(opts());
    assert.equal(r.ok, true);
    return { ...r.target, ...overrides };
  }

  it('R2-01 same Date reference compares false', () => {
    const t = boundTarget();
    const d = new Date('2026-01-02T03:04:05.000Z');
    assert.equal(sameTarget({ ...t, liveAttestation: d }, { ...t, liveAttestation: d }), false);
  });

  it('R2-02 same function reference compares false', () => {
    const t = boundTarget();
    const fn = () => 0;
    assert.equal(sameTarget({ ...t, liveAttestation: fn }, { ...t, liveAttestation: fn }), false);
    assert.equal(sameTarget({ ...t, declaredOverlays: [fn] }, { ...t, declaredOverlays: [fn] }), false);
  });

  it('R2-03 same malformed overlay value compares false', () => {
    const t = boundTarget();
    const bad = 'not-an-array';
    assert.equal(sameTarget({ ...t, declaredOverlays: bad }, { ...t, declaredOverlays: bad }), false);
    const shared = ['a.yml', 42];
    assert.equal(sameTarget({ ...t, declaredOverlays: shared }, { ...t, declaredOverlays: shared }), false);
  });

  it('R2-04 cyclic values compare false without throwing', () => {
    const t = boundTarget();
    const mkCyclic = () => {
      const v = { mode: 'b' };
      v.self = v;
      return v;
    };
    const a = { ...t, liveAttestation: mkCyclic() };
    const b = { ...t, liveAttestation: mkCyclic() };
    assert.doesNotThrow(() => sameTarget(a, b));
    assert.equal(sameTarget(a, b), false);
    assert.doesNotThrow(() => sameTarget(a, { ...t, liveAttestation: { mode: 'b' } }));
    assert.equal(sameTarget(a, { ...t, liveAttestation: { mode: 'b' } }), false);
  });

  it('R2-05 caller mutating original overlays leaves bound identity unchanged', () => {
    validProfile();
    const ov = ['a.yml'];
    const r = resolveProfileTarget(opts({ declaredOverlays: ov }));
    assert.equal(r.ok, true);
    ov.push('b.yml');
    assert.deepEqual(r.target.declaredOverlays, ['a.yml']);
  });

  it('R2-06 caller mutating original attestation leaves bound identity unchanged', () => {
    validProfile();
    const at = { mode: 'b', overlays: ['x.yml'] };
    const r = resolveProfileTarget(opts({ liveAttestation: at }));
    assert.equal(r.ok, true);
    at.overlays.push('y.yml');
    at.mode = 'z';
    assert.deepEqual(r.target.liveAttestation, { mode: 'b', overlays: ['x.yml'] });
  });

  it('R2-07 independently constructed valid values compare true', () => {
    validProfile('r2a');
    validProfile('r2b');
    const a = resolveProfileTarget(opts({ profileName: 'r2a', declaredOverlays: ['a.yml'], liveAttestation: { mode: 'b', overlays: [] } }));
    const b = resolveProfileTarget(opts({ profileName: 'r2b', declaredOverlays: ['a.yml'], liveAttestation: { mode: 'b', overlays: [] } }));
    assert.equal(a.ok, true);
    assert.equal(b.ok, true);
    assert.equal(sameTarget(a.target, a.target), true);
    const t = boundTarget({ declaredOverlays: ['a.yml'], liveAttestation: { mode: 'b', overlays: [] } });
    assert.equal(sameTarget(t, JSON.parse(JSON.stringify(t))), true);
  });
});

describe('S1-R3 B2 — malformed-input validation (dense finite JSON-like only)', () => {
  function boundTarget(overrides = {}) {
    validProfile();
    const r = resolveProfileTarget(opts());
    assert.equal(r.ok, true);
    return { ...r.target, ...overrides };
  }

  function sparse2() {
    const s = ['a.yml'];
    s.length = 2;
    return s;
  }

  it('R3-01 sparse overlay vs populated compares false', () => {
    const t = boundTarget();
    assert.equal(sameTarget({ ...t, declaredOverlays: sparse2() }, { ...t, declaredOverlays: ['a.yml', 'b.yml'] }), false);
  });

  it('R3-02 two sparse overlays compare false', () => {
    const t = boundTarget();
    assert.equal(sameTarget({ ...t, declaredOverlays: sparse2() }, { ...t, declaredOverlays: sparse2() }), false);
  });

  it('R3-03 attestation with Infinity compares false', () => {
    const t = boundTarget();
    const a = { ...t, liveAttestation: { limit: Infinity } };
    const b = { ...t, liveAttestation: { limit: Infinity } };
    assert.equal(sameTarget(a, b), false);
    assert.equal(sameTarget(a, a), false);
  });

  it('R3-04 attestation with NaN compares false', () => {
    const t = boundTarget();
    const a = { ...t, liveAttestation: { ratio: NaN } };
    const b = { ...t, liveAttestation: { ratio: NaN } };
    assert.equal(sameTarget(a, b), false);
    assert.equal(sameTarget(t, a), false);
  });

  it('R3-05 same malformed reference compares false', () => {
    const t = boundTarget();
    const bad = { list: sparse2(), when: new Date('2026-01-02T03:04:05.000Z') };
    assert.equal(sameTarget({ ...t, liveAttestation: bad }, { ...t, liveAttestation: bad }), false);
  });

  it('R3-06 valid independently built values compare true', () => {
    const t = boundTarget();
    const a = { ...t, declaredOverlays: ['a.yml', 'b.yml'], liveAttestation: { mode: 'b', count: 3, flag: true, nested: { list: [1, 'x', null] } } };
    const b = JSON.parse(JSON.stringify(a));
    assert.equal(sameTarget(a, b), true);
    assert.equal(sameTarget(a, a), true);
  });
});
