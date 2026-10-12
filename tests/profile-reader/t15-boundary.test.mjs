// S2 T15-support β€” static import allowlist and read-only boundary
// (P0-R2 Β§6.3; P1-A Β§Β§5, 12 gate 4).
//
// The reader module imports DSH code only through absolute-anchor dynamic
// resolution of the exact allowlisted symbols; no Loader/HMR/service,
// transaction, write, planning, or network surface may appear. Behavioral
// gates prove version/symbol admission fails closed.
import { describe, it, beforeEach, afterEach } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { resolveProfileTarget } from '../../profile/target-resolver.mjs';
import {
  readManagedConfig,
  MANAGED_ROUTE_KEYS,
  REFUSAL_CODES,
  EFFECTIVE_STATUSES,
} from '../../profile/config-reader.mjs';
import {
  assert,
  makeTempHome,
  sandboxDshHome,
  llmRow,
  makeProfile,
  makeAnchor,
  makeFixtureBundle,
  bindReal,
  readerOpts,
  resolveRealScope,
  EXPECTED,
  FIXTURE_BUNDLE_PKG,
} from './helpers.mjs';

let home;
let cleanupHome;
let anchor;
let restoreDshHome;

function bind(name, anchorDir) {
  const r = resolveProfileTarget({ profileName: name, dshHome: home, installAnchorDir: anchorDir, pathEnv: '' });
  assert.equal(r.ok, true, `S1 bind failed: ${JSON.stringify(r)}`);
  return r.target;
}

// Success-path S2 calls need real importable utilities: bind S1 over the
// real PATH so the binding evidence points at the installed DSH.
function bindComposition(name) {
  return bindReal(home, name);
}

const SRC = fs.readFileSync(new URL('../../profile/config-reader.mjs', import.meta.url), 'utf8');

function bindAnchor(name, anchorDir) {
  const r = resolveProfileTarget({ profileName: name, dshHome: home, installAnchorDir: anchorDir, pathEnv: '' });
  assert.equal(r.ok, true, `S1 bind failed: ${JSON.stringify(r)}`);
  return r.target;
}

beforeEach(() => {
  restoreDshHome = sandboxDshHome();
  ({ home, cleanup: cleanupHome } = makeTempHome());
  anchor = makeAnchor(fs.mkdtempSync(path.join(home, 'anchor-')));
});

afterEach(() => {
  cleanupHome();
  fs.rmSync(anchor, { recursive: true, force: true });
  restoreDshHome();
});

describe('S2 static import allowlist (T15 support)', () => {
  it('T15 no bare-specifier DSH imports (absolute anchors only)', () => {
    assert.ok(!/from\s+['"]@deepseek-ai\//.test(SRC), 'bare DSH import found');
    assert.ok(!/import\(\s*['"]@deepseek-ai\//.test(SRC), 'bare DSH dynamic import found');
  });

  it('T15 no forbidden runtime symbols anywhere in the module', () => {
    for (const sym of [
      'reconcileProfilePatches',
      'ConfigEditor',
      'withFileLock',
      'writeFileAtomic',
      'runExclusive',
      'HMR',
      'Loader',
      'previewId',
      'activePreview',
      'ProfileAwareCommit',
      'commitPlan',
      'buildPlan',
      'child_process',
    ]) {
      assert.ok(!new RegExp(`\\b${sym}\\b`).test(SRC), `forbidden symbol present: ${sym}`);
    }
  });

  it('T15 no filesystem write surface in the module', () => {
    for (const sym of [
      'writeFile', 'appendFile', 'copyFile', 'mkdir', 'rmdir', 'unlink',
      'rename', 'symlink', 'link', 'chmod', 'chown', 'utimes', 'truncate',
      'createWriteStream', 'fs/promises', 'mkdtemp',
    ]) {
      assert.ok(!new RegExp(`\\b${sym}\\b`).test(SRC), `write surface present: ${sym}`);
    }
  });

  it('T15 no code execution, network, or model-probe surface in the module', () => {
    for (const sym of ['eval', 'Function', 'child_process', 'fetch', 'http', 'probe', 'roster', 'catalog']) {
      assert.ok(!new RegExp(`\\b${sym}\\b`).test(SRC), `execution/network surface present: ${sym}`);
    }
  });

  it('T15 exported contract surface is exact', () => {
    assert.equal(typeof readManagedConfig, 'function');
    assert.deepEqual([...MANAGED_ROUTE_KEYS], [
      'opencode-go', 'opencode-go-messages', 'opencode-go-responses',
      'opencode-completions', 'opencode-messages', 'opencode',
    ]);
    assert.ok(REFUSAL_CODES.includes('OVERRIDDEN'));
    assert.ok(REFUSAL_CODES.includes('STALE_TARGET'));
    assert.ok(REFUSAL_CODES.includes('SETTINGS_INVALID'));
    assert.ok(!REFUSAL_CODES.includes('NOT_IMPLEMENTED'));
    assert.deepEqual([...EFFECTIVE_STATUSES], ['MATCHED', 'EFFECTIVE_DIFFERS_FROM_STORED']);
  });

  it('T15 success results expose no write operations', async () => {
    const profileDir = makeProfile(home, 'noop', { entries: [llmRow()], bundles: [FIXTURE_BUNDLE_PKG] });
    makeFixtureBundle(profileDir);
    const r = await readManagedConfig(readerOpts(bindComposition('noop')));
    assert.equal(r.ok, true, `expected success: ${JSON.stringify(r)}`);
    for (const key of Object.keys(r)) {
      assert.ok(!/write|commit|apply|preview|backup|render|splice/i.test(key), `write-ish key: ${key}`);
    }
  });
});

describe('S2 dependency admission fails closed (T15 behavioral)', () => {
  function codeAnchor(opts) {
    const dir = fs.mkdtempSync(path.join(home, 'code-anchor-'));
    const scope = path.join(dir, '@deepseek-ai');
    const pkgs = {
      'dsh-atomic-write': EXPECTED.atomicWrite,
      'dsh-app-boot': EXPECTED.appBoot,
      'cordis-plugin-include': EXPECTED.include,
      dsh: EXPECTED.dsh,
    };
    for (const [pkg, version] of Object.entries(pkgs)) {
      const pkgDir = path.join(scope, pkg);
      fs.mkdirSync(pkgDir, { recursive: true });
      fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({ name: `@deepseek-ai/${pkg}`, version }), 'utf8');
    }
    if (opts && opts.stubLib) {
      const libDir = path.join(scope, opts.stubLib, 'lib');
      fs.mkdirSync(libDir, { recursive: true });
      fs.writeFileSync(path.join(libDir, 'index.js'), 'export const nothingHere = 1;\n', 'utf8');
    }
    return { dir, scope };
  }

  it('T15 manifest-only anchor refuses INCOMPATIBLE_DSH (no code to import)', async () => {
    const profileDir = makeProfile(home, 'noimpl', { entries: [llmRow()] });
    makeFixtureBundle(profileDir);
    const target = bindAnchor('noimpl', anchor);
    const r = await readManagedConfig({ target, installAnchorDir: anchor, pathEnv: '', telemetryDisabledEnv: undefined });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'INCOMPATIBLE_DSH');
  });

  it('T15 skewed utility version refuses INCOMPATIBLE_DSH', async () => {
    const skewed = makeAnchor(fs.mkdtempSync(path.join(home, 'skew-')), { skew: { pkg: 'dsh-app-boot', version: '9.9.9' } });
    const profileDir = makeProfile(home, 'skewed', { entries: [llmRow()] });
    makeFixtureBundle(profileDir);
    const target = bindAnchor('skewed', anchor);
    const r = await readManagedConfig({ target, installAnchorDir: skewed, pathEnv: '', telemetryDisabledEnv: undefined });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'INCOMPATIBLE_DSH');
    fs.rmSync(path.dirname(skewed), { recursive: true, force: true });
  });

  it('T15 anchor whose library misses allowlisted symbols refuses INCOMPATIBLE_DSH', async () => {
    const { dir, scope } = codeAnchor({ stubLib: 'dsh-app-boot' });
    // All manifests satisfy; the app-boot library exports nothing usable.
    const incLib = path.join(scope, 'cordis-plugin-include', 'lib');
    fs.mkdirSync(incLib, { recursive: true });
    fs.writeFileSync(path.join(incLib, 'index.js'), 'export const entryListSchema = {};\n', 'utf8');
    const profileDir = makeProfile(home, 'stubbed', { entries: [llmRow()] });
    makeFixtureBundle(profileDir);
    const target = bindAnchor('stubbed', anchor);
    const r = await readManagedConfig({ target, installAnchorDir: scope, pathEnv: '', telemetryDisabledEnv: undefined });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'INCOMPATIBLE_DSH');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('T15 unresolvable anchor refuses INCOMPATIBLE_DSH', async () => {
    const profileDir = makeProfile(home, 'noanchor', { entries: [llmRow()] });
    makeFixtureBundle(profileDir);
    const target = bindAnchor('noanchor', anchor);
    const empty = fs.mkdtempSync(path.join(home, 'empty-anchor-'));
    const r = await readManagedConfig({ target, installAnchorDir: path.join(empty, '@deepseek-ai'), pathEnv: '', telemetryDisabledEnv: undefined });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'INCOMPATIBLE_DSH');
    fs.rmSync(empty, { recursive: true, force: true });
  });

  it('T15 retired-bundle pin matches the admitted installed source (read-only)', () => {
    // The reader refuses retired-bundle listings before any load call
    // because the loader would normalize the manifest on disk. That pin is
    // version-scoped: if the installed source names a different retired set,
    // this fails loudly instead of refusing the wrong profiles.
    const scope = resolveRealScope();
    const src = fs.readFileSync(
      path.join(scope, 'dsh-app-boot', 'lib', 'index.js'),
      'utf8',
    );
    const m = src.match(/const RETIRED_BUNDLES = new Set\(\[([^\]]*)\]\);/);
    assert.ok(m, 'retired-bundle declaration not found in admitted source');
    const names = [...m[1].matchAll(/"([^"]+)"/g)].map((hit) => hit[1]).sort();
    assert.deepEqual(names, ['@deepseek-ai/dsh-experimental-schedule-bundle']);
  });
});
