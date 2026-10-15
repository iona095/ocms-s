// S2 test helpers — synthetic disposable profiles only.
//
// Every fixture lives under os.tmpdir() (fresh mkdtemp per test) and is
// removed afterwards. Nothing here may reference the real DSH home, the real
// web profile, accounts, credentials, or model gateways.
//
// Composition tests resolve DSH *library code* from the real installed DSH
// (read-only import, exact-version asserted) while composing synthetic
// fixture profiles only. The real DSH home is never contacted: DSH_HOME is
// sandboxed per file and every composition context points at fixture homes.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { stringify as stringifyYaml } from 'yaml';
import { installStubDshOnAmbientPath, realDshInstalledOnPath, stubDshTree, withStubDshPath } from '../support/dsh-stub-tree.mjs';

// A1: make a composition scope discoverable on the AMBIENT PATH: some product
// paths (ProfileAwareCommit, the UI server) fall back to process.env.PATH when no
// explicit anchor is supplied, which made every commit/UI test depend on a
// globally installed DSH. A real install always wins; otherwise the stub prefix
// is appended so the suite runs on any machine.
installStubDshOnAmbientPath();
import { findDshExecutable, resolveProfileTarget } from '../../profile/target-resolver.mjs';

export { assert };

// Pinned versions. `include` is the baseline every synthetic anchor writes
// (still admitted); `includeAdmitted` is the exact-membership set a real
// install may resolve to since v1.4.7-rc6 §5(a) — exactly 1.0.10-alpha.1 or
// 1.0.10-alpha.2, no ranges, no prefix or semver matching.
export const EXPECTED = {
  atomicWrite: '0.2.1-alpha.2',
  appBoot: '0.2.1-alpha.2',
  include: '1.0.10-alpha.1',
  includeAdmitted: ['1.0.10-alpha.1', '1.0.10-alpha.2'],
  dsh: '0.2.1-alpha.2',
};

// Fixture plugin identity. Bundle mounts use the bundle-style name; user rows
// use the same name so native name-matching applies them (a mismatched name
// is compositionally inert — see the addressability tests).
export const FIXTURE_LLM_NAME = '@fixture/dsh-llm-fixture';
export const FIXTURE_BUNDLE_PKG = '@fixture/base';

// Synthetic credential-shaped markers. Real secrets must never appear in
// fixtures; leak tests scan every refusal/warning payload for these.
export const SECRET_MARKERS = [
  'SYNTHETIC_FAKE_KEY_alpha bravo 001',
  'SYNTHETIC_FAKE_TOKEN_charlie delta 002',
  'SYNTHETIC_FAKE_SECRET_echo foxtrot 003',
];

let counter = 0;

export function makeTempHome(prefix = 'ocms-s2-') {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}${process.pid}-${counter++}-`));
  return {
    home,
    cleanup() {
      fs.rmSync(home, { recursive: true, force: true });
    },
  };
}

// DSH_HOME sandbox: S1 classification derives the truth anchor from the live
// environment, so every file building S1 bindings must sandbox it.
export function sandboxDshHome() {
  const saved = process.env.DSH_HOME;
  const sandboxHome = fs.mkdtempSync(path.join(os.tmpdir(), `ocms-s2-sandbox-${process.pid}-${counter++}-`));
  process.env.DSH_HOME = sandboxHome;
  return () => {
    if (saved === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = saved;
    fs.rmSync(sandboxHome, { recursive: true, force: true });
  };
}

export function sha256Hex(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

export function decoyRow(id) {
  return { id, name: `Decoy ${id}`, config: { marker: true } };
}

// A user-owned llm-pi-ai row. config: object | 'absent' (dormant, no key) |
// 'scalar' (malformed) | 'null' (explicit null).
export function llmRow({ config = 'empty-providers', name = FIXTURE_LLM_NAME, insert = false } = {}) {
  const row = { id: 'llm-pi-ai' };
  if (name !== null) row.name = name;
  if (insert) row.insert = 'after';
  if (config === 'absent') { /* no config key: dormant-but-owned */ } else if (config === 'scalar') row.config = 'not-a-mapping';
  else if (config === 'null') row.config = null;
  else if (config === 'empty-providers') row.config = { providers: {} };
  else if (typeof config === 'object' && config !== null) row.config = config;
  else row.config = config;
  return row;
}

export function modelsConfig(routeModels) {
  const providers = {};
  for (const [route, models] of Object.entries(routeModels)) {
    providers[route] = { displayName: route, models };
  }
  return { providers };
}

export function writePatchYaml(profileDir, entries) {
  const patchPath = path.join(profileDir, 'cordis.patch.yml');
  fs.writeFileSync(patchPath, stringifyYaml(entries), 'utf8');
  return patchPath;
}

export function writePatchRaw(profileDir, text) {
  const patchPath = path.join(profileDir, 'cordis.patch.yml');
  fs.writeFileSync(patchPath, text, 'utf8');
  return patchPath;
}

// Build home/profiles/<name>/ with manifest + patch. bundles lists fixture
// bundle package names (created via makeFixtureBundle). homeRows/homeRaw
// write the home-level patch (<home>/cordis.patch.yml).
export function makeProfile(
  home,
  name,
  { manifest = true, bundles = [], entries = null, homePatch = null } = {},
) {
  const profileDir = path.join(home, 'profiles', name);
  fs.mkdirSync(profileDir, { recursive: true });
  const manifestBody = manifest === true
    ? { name, private: true, dsh: { profile: { bundles: [...bundles] } }, version: '0.0.0-fixture' }
    : manifest;
  if (manifestBody === false) { /* no manifest */ } else if (manifestBody === 'invalid-json') {
    fs.writeFileSync(path.join(profileDir, 'package.json'), '{ not json', 'utf8');
  } else {
    fs.writeFileSync(path.join(profileDir, 'package.json'), JSON.stringify(manifestBody), 'utf8');
  }
  if (entries !== null) {
    if (Array.isArray(entries)) writePatchYaml(profileDir, entries);
    else fs.writeFileSync(path.join(profileDir, 'cordis.patch.yml'), entries.raw, 'utf8');
  }
  if (homePatch !== null) {
    const text = Array.isArray(homePatch) ? stringifyYaml(homePatch) : homePatch.raw;
    fs.writeFileSync(path.join(home, 'cordis.patch.yml'), text, 'utf8');
  }
  return profileDir;
}

// Fixture bundle package under <profileDir>/node_modules/<pkg>/ exposing an
// insert patch (default: dormant llm-pi-ai mount + one decoy, mirroring the
// dsh-base dormant-mount posture). Returns the package dir.
export function makeFixtureBundle(profileDir, pkg = FIXTURE_BUNDLE_PKG, { insertRows = null, rawPatch = null } = {}) {
  const pkgDir = path.join(profileDir, 'node_modules', ...pkg.split('/'));
  fs.mkdirSync(pkgDir, { recursive: true });
  fs.writeFileSync(
    path.join(pkgDir, 'package.json'),
    JSON.stringify({ name: pkg, version: '0.0.0-fixture', dsh: { bundle: { patch: './cordis.patch.yml' } } }),
    'utf8',
  );
  const rows = insertRows ?? [
    { id: 'llm-pi-ai', name: FIXTURE_LLM_NAME },
    { id: `${pkg}-marker`, name: `${pkg}/marker` },
  ];
  fs.writeFileSync(
    path.join(pkgDir, 'cordis.patch.yml'),
    rawPatch ?? stringifyYaml([{ insert: rows }]),
    'utf8',
  );
  return pkgDir;
}

// Fixture dependency anchor with manifests only (S1 admission): <dir>/@deepseek-ai/<pkg>/package.json.
export function makeAnchor(dir, { skew = null, drop = null, dshVersion = EXPECTED.dsh } = {}) {
  const scope = path.join(dir, '@deepseek-ai');
  const pkgs = {
    'dsh-atomic-write': EXPECTED.atomicWrite,
    'dsh-app-boot': EXPECTED.appBoot,
    'cordis-plugin-include': EXPECTED.include,
    dsh: dshVersion,
  };
  for (const [pkg, version] of Object.entries(pkgs)) {
    if (pkg === drop) continue;
    const v = skew && skew.pkg === pkg ? skew.version : version;
    const pkgDir = path.join(scope, pkg);
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(
      path.join(pkgDir, 'package.json'),
      JSON.stringify({ name: `@deepseek-ai/${pkg}`, version: v }),
      'utf8',
    );
  }
  return scope;
}

// Resolve the REAL installed DSH nested utility scope
// (<npmRoot>/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai) via the
// specified PATH-executable mechanism, version-asserted. Read-only library
// code only; never profile data. resolveRealScope still throws when the
// prerequisite is absent; tests whose property genuinely NEEDS the installed
// DSH call resolveRealScopeOrSkip(t) so a clean runner reports a declared skip
// naming the missing capability instead of an uncaught prerequisite error.
export function resolveInstalledScope({ pathEnv = process.env.PATH ?? '' } = {}) {
  const exePath = findDshExecutable({ pathEnv });
  if (exePath === null) {
    throw new Error('S2 fixture prerequisite missing: no dsh executable on PATH; cannot derive the install anchor.');
  }
  const npmRoot = path.dirname(exePath);
  const candidates = [
    path.join(npmRoot, 'node_modules', '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai'),
    path.join(npmRoot, 'node_modules', '@deepseek-ai'),
  ];
  const problems = [];
  for (const scope of candidates) {
    const versions = {};
    let usable = true;
    for (const [pkg, want] of Object.entries({
      'dsh-app-boot': [EXPECTED.appBoot],
      'cordis-plugin-include': EXPECTED.includeAdmitted,
      'dsh-atomic-write': [EXPECTED.atomicWrite],
    })) {
      try {
        const manifest = JSON.parse(fs.readFileSync(path.join(scope, pkg, 'package.json'), 'utf8'));
        versions[pkg] = manifest.version;
        if (!want.includes(manifest.version)) {
          usable = false;
          problems.push(`${scope}: ${pkg} is ${manifest.version}, want ${want.join(' or ')}`);
        }
      } catch (err) {
        usable = false;
        problems.push(`${scope}: ${pkg} unreadable (${err && err.code ? err.code : err})`);
      }
    }
    if (usable) return scope;
  }
  throw new Error(`S2 fixture prerequisite missing: no exact-version utility scope. ${problems.join('; ')}`);
}

// Declared-skip variant: returns the pinned installed scope, or calls
// t.skip('<missing capability>') and returns null. Callers must return
// immediately when it returns null (never fall through and assert on null).
export function resolveRealScopeOrSkip(t, label = 'pinned DSH 0.2.1-alpha.2 installed on PATH (resolveRealScope)') {
  try {
    return resolveRealScope();
  } catch (err) {
    t.skip(label + ': ' + String((err && err.message) || err));
    return null;
  }
}

// A1: the profile suites need a composition install scope. CI has the pinned DSH
// installed and this resolves to it. With no dsh executable on PATH the suite
// falls back to the test-only stub tree (tests/support/dsh-stub-tree.mjs) so the
// test exercises its own property instead of failing on the environment. An
// INSTALLED but version-skewed tree still throws loudly: skew is a real signal.
export function resolveRealScope(options = {}) {
  const pathEnv = options.pathEnv !== undefined ? options.pathEnv : (process.env.PATH ?? '');
  try {
    return resolveInstalledScope({ pathEnv });
  } catch (err) {
    if (!/no dsh executable on PATH/.test(String((err && err.message) || err))) throw err;
    return stubInstallScope();
  }
}

// The stub scope directory used by the fallback above.
export function stubInstallScope() {
  const { scope } = stubDshTree();
  return scope;
}

export function realDshPackageDir(scope = resolveRealScope()) {
  return path.join(scope, 'dsh');
}

// S1 binding over the real PATH (fresh strategy-A admission against the
// installed DSH). Needed whenever the test reaches S2 composition: the
// binding's dependency evidence then points at real, importable library
// code (exact versions asserted). Requires the pinned DSH on PATH — an
// environment prerequisite; failures are loud, never silent.
// A1: binds over the ambient PATH (the real installed DSH is preferred). With no
// installed dsh the stub prefix is appended, so admission still resolves an
// exact-version composition scope and the test's own property is exercised.
// The stub scope for this process (memoised through the shared helper).
export function resolvedStubScope() {
  return stubDshTree();
}

export function bindReal(home, name, extra = {}) {
  // With a real installed DSH the ambient PATH resolves it. With none, bind
  // against the stub scope explicitly so the binding's dependency evidence and
  // every later re-resolution (reader, plan-builder, commit) are deterministic
  // and machine-independent.
  const stub = resolvedStubScope();
  const anchored = Object.hasOwn(extra, 'installAnchorDir') || realDshInstalledOnPath()
    ? extra
    : { ...extra, installAnchorDir: stub.scope };
  const pathEnv = withStubDshPath(process.env.PATH ?? '');
  const r = resolveProfileTarget({ profileName: name, dshHome: home, pathEnv, ...anchored });
  assert.equal(r.ok, true, `S1 real-PATH bind failed: ${JSON.stringify(r)}`);
  return r.target;
}

// Standard reader options for composition tests: evidence-driven anchors
// (the binding's admitted installation, re-asserted), hermetic PATH, and an
// explicitly unset telemetry switch (never the ambient environment).
// Pass installAnchorDir explicitly only to pin a scope (fixture anchors
// exercise INCOMPATIBLE_DSH paths).
export function readerOpts(target, extra = {}) {
  return {
    target,
    installAnchorDir: null,
    pathEnv: '',
    telemetryDisabledEnv: '',
    ...extra,
  };
}

export function assertNoSecrets(value, label) {
  const text = JSON.stringify(value);
  for (const marker of SECRET_MARKERS) {
    assert.ok(!text.includes(marker), `${label}: secret marker leaked: ${JSON.stringify(marker)}`);
  }
}

export function snapshotTree(dir) {
  const out = new Map();
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory() && !e.isSymbolicLink()) walk(p);
      else if (e.isFile() || e.isSymbolicLink()) {
        const st = fs.lstatSync(p);
        out.set(p, { size: st.size, mtimeMs: st.mtimeMs, isLink: e.isSymbolicLink() });
      }
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return out;
}

export function assertNoMutation(snapBefore, dir, label) {
  const after = snapshotTree(dir);
  assert.equal(after.size, snapBefore.size, `${label}: file set changed`);
  for (const [p, v] of snapBefore) {
    const a = after.get(p);
    assert.ok(a, `${label}: missing after: ${p}`);
    assert.equal(a.size, v.size, `${label}: size changed: ${p}`);
    assert.equal(a.mtimeMs, v.mtimeMs, `${label}: mtime changed: ${p}`);
  }
}
