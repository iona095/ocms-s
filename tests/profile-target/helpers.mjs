// S1 test helpers — synthetic disposable profiles only.
//
// Every fixture lives under os.tmpdir() (fresh mkdtemp per test) and is
// removed afterwards. Nothing here may reference the real DSH home, the real
// web profile, accounts, credentials, or model gateways. Tests that need a
// dependency anchor build a fixture anchor; the real install is never used.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { stringify as stringifyYaml } from 'yaml';

export { assert };

export const EXPECTED = {
  atomicWrite: '0.2.1-alpha.2',
  appBoot: '0.2.1-alpha.2',
  include: '1.0.10-alpha.1',
  dsh: '0.2.1-alpha.2',
};

let counter = 0;

export function makeTempHome(prefix = 'ocms-s1-') {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}${process.pid}-${counter++}-`));
  return {
    home,
    cleanup() {
      fs.rmSync(home, { recursive: true, force: true });
    },
  };
}

export function llmRow({ config = 'empty', name = 'LLM Pi AI', insert = false } = {}) {
  const row = { id: 'llm-pi-ai' };
  if (name !== null) row.name = name;
  if (insert) row.insert = 'after';
  if (config === 'empty') row.config = { providers: {} };
  else if (config === 'scalar') row.config = 'not-a-mapping';
  else if (config === 'absent') { /* no config key */ }
  else if (typeof config === 'object' && config !== null) row.config = config;
  return row;
}

export function decoyRow(id) {
  return { id, name: `Decoy ${id}`, config: { marker: true } };
}

export function writePatch(profileDir, entries) {
  const patchPath = path.join(profileDir, 'cordis.patch.yml');
  fs.writeFileSync(patchPath, stringifyYaml(entries), 'utf8');
  return patchPath;
}

// Build home/profiles/<name>/ with manifest + patch. Options:
//   manifest: true | false | 'invalid-json' | object ( inducted package.json )
//   entries: array (serialized) | { raw: string } | null (no patch file)
//   homePatch: array | { raw: string } | null
export function makeProfile(home, name, { manifest = true, entries = null, homePatch = null } = {}) {
  const profileDir = path.join(home, 'profiles', name);
  fs.mkdirSync(profileDir, { recursive: true });
  if (manifest === true) {
    fs.writeFileSync(
      path.join(profileDir, 'package.json'),
      JSON.stringify({ name, private: true, dsh: { profile: { bundles: [] } }, version: '0.0.0-fixture' }),
      'utf8',
    );
  } else if (manifest === 'invalid-json') {
    fs.writeFileSync(path.join(profileDir, 'package.json'), '{ not json', 'utf8');
  } else if (manifest !== false) {
    fs.writeFileSync(path.join(profileDir, 'package.json'), JSON.stringify(manifest), 'utf8');
  }
  if (entries !== null) {
    if (Array.isArray(entries)) writePatch(profileDir, entries);
    else fs.writeFileSync(path.join(profileDir, 'cordis.patch.yml'), entries.raw, 'utf8');
  }
  if (homePatch !== null) {
    const text = Array.isArray(homePatch) ? stringifyYaml(homePatch) : homePatch.raw;
    fs.writeFileSync(path.join(home, 'cordis.patch.yml'), text, 'utf8');
  }
  return profileDir;
}

export function standardEntries() {
  return [decoyRow('other-plugin'), llmRow(), decoyRow('third-plugin')];
}

// Fixture dependency anchor: <anchorDir>/@deepseek-ai/<pkg>/package.json
// with pinned versions. Overrides pin one package version (skew test) or drop
// one package (missing test). includeDsh controls the dsh manifest.
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

// Fake npm root exposing a dsh shim on a fixture PATH: <root>/dsh.cmd plus
// <root>/node_modules/@deepseek-ai/... package manifests.
export function makeFakeNpmRoot(base, anchorOpts = {}) {
  const root = fs.mkdtempSync(path.join(base, 'npmroot-'));
  fs.writeFileSync(path.join(root, 'dsh.cmd'), '@echo off\r\n', 'utf8');
  makeAnchor(path.join(root, 'node_modules'), anchorOpts);
  return root;
}

// spec: { [pkgShortName]: version-string | null(absent) | 'MALFORMED' }
export function makeProfileScope(profileDir, spec) {
  const scope = path.join(profileDir, 'node_modules', '@deepseek-ai');
  for (const [pkg, v] of Object.entries(spec)) {
    if (v === null || v === undefined) continue;
    const pkgDir = path.join(scope, pkg);
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(
      path.join(pkgDir, 'package.json'),
      v === 'MALFORMED' ? '{ bad json' : JSON.stringify({ name: `@deepseek-ai/${pkg}`, version: v }),
      'utf8',
    );
  }
  return scope;
}

export const PINNED_SCOPE = {
  'dsh-atomic-write': EXPECTED.atomicWrite,
  'dsh-app-boot': EXPECTED.appBoot,
  'cordis-plugin-include': EXPECTED.include,
};

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
  walk(dir);
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
