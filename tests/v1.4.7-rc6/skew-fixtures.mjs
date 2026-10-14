// OCMS-S v1.4.7-rc6 §7.2 skew-logic fixtures (contract v1.4.7-rc6 §7.2).
//
// Manifest-only dependency anchors under os.tmpdir(). Nothing here reads or
// writes the real DSH home, never resolves a PATH dsh (every caller passes an
// explicit empty pathEnv), never imports DSH package code and never touches the
// network. Anchors carry package.json files ONLY and no library code, so an
// admitted include version cannot reach real DSH code from a fixture: the call
// then stops at library-entry resolution instead.
//
// Path coverage (contract §7.2): the same anchor set is driven through
// admitDependencyPackages, the commit path (ProfileAwareCommit ->
// resolveCommitUtils) and the composition path (readManagedConfig ->
// resolveCompositionUtils).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { stringify as stringifyYaml } from 'yaml';
import { resolveProfileTarget } from '../../profile/target-resolver.mjs';

export { assert };

// Versions out of scope for this gate: only the dsh baseline and the two
// utility packages other than include keep today's pinned constants.
export const PINNED = {
  dsh: '0.2.1-alpha.2',
  'dsh-app-boot': '0.2.1-alpha.2',
  'dsh-atomic-write': '0.2.1-alpha.2',
  'cordis-plugin-include': '1.0.10-alpha.1',
};

export const INCLUDE_ALPHA_1 = '1.0.10-alpha.1';
export const INCLUDE_ALPHA_2 = '1.0.10-alpha.2';
export const INCLUDE_ALPHA_3 = '1.0.10-alpha.3';
export const INCLUDE_RANGE_LOOKING = '~1.0.10-alpha.1';
export const INCLUDE_PREFIX = '1.0.10-alpha.2x';

export const DSH_SKEW = { pkg: 'dsh', version: '0.9.9' };
export const APP_BOOT_SKEW = { pkg: 'dsh-app-boot', version: '8.8.8' };
export const ATOMIC_WRITE_SKEW = { pkg: 'dsh-atomic-write', version: '9.9.9' };

export const FIXTURE_LLM_NAME = '@fixture/dsh-llm-fixture';
export const FIXTURE_BUNDLE_PKG = '@fixture/base';

// Pinned refusal details. The explicit-anchor version gate reports
// 'explicit-anchor-unsatisfied' when a manifest version is not admitted; a
// version that IS admitted runs on and then stops at library-entry resolution,
// because a manifest-only anchor has no code to import.
export const VERSION_GATE_REFUSAL = 'explicit-anchor-unsatisfied';
export const NO_LIBRARY_CODE_REFUSAL = 'util-entry-unresolvable';

let counter = 0;

export function makeTempHome(prefix = 'ocms-rc6-') {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), prefix + process.pid + '-' + (counter++) + '-'));
  return {
    home,
    cleanup() {
      fs.rmSync(home, { recursive: true, force: true });
    },
  };
}

// DSH_HOME sandbox: S1 classification derives the truth anchor from the live
// environment, so it is redirected at a throwaway home and restored afterwards.
export function sandboxDshHome() {
  const saved = process.env.DSH_HOME;
  const sandboxHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ocms-rc6-sandbox-' + process.pid + '-' + (counter++) + '-'));
  process.env.DSH_HOME = sandboxHome;
  return () => {
    if (saved === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = saved;
    fs.rmSync(sandboxHome, { recursive: true, force: true });
  };
}

export function escapeRe(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Manifest-only anchor: <root>/@deepseek-ai/<pkg>/package.json. No library
// code is written, so nothing here can be imported or executed.
export function makeAnchor(root, { include = INCLUDE_ALPHA_1, skew = null, dshVersion = PINNED.dsh } = {}) {
  const scope = path.join(root, '@deepseek-ai');
  const pkgs = {
    'dsh-atomic-write': PINNED['dsh-atomic-write'],
    'dsh-app-boot': PINNED['dsh-app-boot'],
    'cordis-plugin-include': include,
    dsh: dshVersion,
  };
  for (const [pkg, version] of Object.entries(pkgs)) {
    const effective = skew !== null && skew.pkg === pkg ? skew.version : version;
    const pkgDir = path.join(scope, pkg);
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(
      path.join(pkgDir, 'package.json'),
      JSON.stringify({ name: '@deepseek-ai/' + pkg, version: effective }, null, 2) + '\n',
      'utf8',
    );
  }
  return scope;
}

// Synthetic profile: manifest + a single user-owned llm-pi-ai row + a fixture
// bundle. Profile DATA only; no DSH library code.
export function makeProfile(home, name, { bundles = [FIXTURE_BUNDLE_PKG] } = {}) {
  const profileDir = path.join(home, 'profiles', name);
  fs.mkdirSync(profileDir, { recursive: true });
  fs.writeFileSync(
    path.join(profileDir, 'package.json'),
    JSON.stringify({ name, private: true, dsh: { profile: { bundles: [...bundles] } }, version: '0.0.0-fixture' }, null, 2) + '\n',
    'utf8',
  );
  fs.writeFileSync(
    path.join(profileDir, 'cordis.patch.yml'),
    stringifyYaml([{ id: 'llm-pi-ai', name: FIXTURE_LLM_NAME, config: { providers: {} } }]),
    'utf8',
  );
  return profileDir;
}

export function bindTarget(home, name, anchorScope) {
  const r = resolveProfileTarget({ profileName: name, dshHome: home, installAnchorDir: anchorScope, pathEnv: '' });
  assert.equal(r.ok, true, 'S1 bind failed: ' + JSON.stringify(r).slice(0, 600));
  return r.target;
}

// Minimal retained NO_CHANGE plan: enough shape to reach resolveCommitUtils,
// which is the seam under test. No candidate content, no write surface.
export function noChangePlan(target) {
  return { ok: true, status: 'NO_CHANGE', target: structuredClone(target), patchDigest: target.patchDigest };
}

export function refusalText(result) {
  return String(result && result.code) + (result && result.detail !== undefined ? ' detail=' + JSON.stringify(result.detail) : '');
}

// admitDependencyPackages reports version skew by naming the package and the
// observed manifest version.
export function assertAdmittedByVersionGate(result, label) {
  assert.equal(result.ok, false, label + ': expected the manifest-only anchor to stop at library-entry resolution after the version gate admitted the version');
  assert.equal(result.code, 'INCOMPATIBLE_DSH', label + ': refusal code (' + refusalText(result) + ')');
  assert.notEqual(result.detail, VERSION_GATE_REFUSAL, label + ': the explicit-anchor version gate refused; the version was not admitted');
  assert.equal(result.detail, NO_LIBRARY_CODE_REFUSAL, label + ': expected the refusal to come from library-entry resolution (' + refusalText(result) + ')');
}

export function assertRefusedByVersionGate(result, label) {
  assert.equal(result.ok, false, label + ': must refuse');
  assert.equal(result.code, 'INCOMPATIBLE_DSH', label + ': refusal code (' + refusalText(result) + ')');
  assert.equal(result.detail, VERSION_GATE_REFUSAL, label + ': the explicit-anchor version gate must refuse (' + refusalText(result) + ')');
}

export function assertSkewRefused(result, pkg, observed, label) {
  assert.equal(result.ok, false, label + ': must refuse');
  assert.equal(result.code, 'INCOMPATIBLE_DSH', label + ': refusal code (' + refusalText(result) + ')');
  assert.match(String(result.detail ?? ''), /version-skew/, label + ': refusal must be a version-skew refusal (' + refusalText(result) + ')');
  assert.match(
    String(result.detail ?? ''),
    new RegExp(escapeRe(pkg) + ' is ' + escapeRe(observed)),
    label + ': refusal must name ' + pkg + ' at the observed ' + observed + ' (' + refusalText(result) + ')',
  );
}
