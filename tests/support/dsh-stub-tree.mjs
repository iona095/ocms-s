// A1: test-only stub DSH tree for hosts with no installed DSH.
//
// The profile suites resolve their composition libraries from an install scope
// (admission -> resolveCompositionUtils -> import dsh-app-boot /
// cordis-plugin-include / js-yaml). CI installs the pinned DSH tree; a scrubbed
// or clean machine has nothing on PATH, so every composition test failed with a
// typed INCOMPATIBLE_DSH refusal instead of exercising its own property.
//
// This module builds a COMPLETE stub tree in a temp directory: the four pinned
// manifests, an importable dsh-app-boot with the three composed reader symbols,
// a cordis-plugin-include carrying entryListSchema, js-yaml load reachable from
// that package, and a dsh executable so findDshExecutable() can derive the
// scope. It is a TEST-ONLY STAND-IN (flat fixtures only), never a DSH
// reimplementation, and never installed or vendored into the product.
//
// The real installed DSH is preferred whenever it is present and version-clean:
// callers ask for it first and only fall back to the stub.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
export const STUB_VERSIONS = Object.freeze({
  dsh: '0.2.1-alpha.2',
  'dsh-app-boot': '0.2.1-alpha.2',
  'dsh-atomic-write': '0.2.1-alpha.2',
  'cordis-plugin-include': '1.0.10-alpha.1',
  // The wider installed DSH tree the acceptance suites inspect for versions.
  'cordis-plugin-loader': '1.0.6-alpha.1',
  'cordis-plugin-group': '1.0.5-alpha.1',
  'cordis-plugin-timer': '1.1.7-alpha.1',
  cosmokit: '1.8.6-alpha.1',
  schemastery: '3.18.5-alpha.1',
  'node-addon-require-builtin': '0.1.9',
  'dsh-llm-pi-ai': '0.2.1-alpha.2',
  'dsh-config-editor': '0.2.1-alpha.2',
  cordis: '4.0.5-alpha.1',
});

const STUB_HEADER = '// TEST-ONLY STAND-IN for DSH composition (A1). Flat fixture shapes only.';

let cached = null;

// Build (once per process) the stub prefix and return its paths.
export function stubDshTree() {
  if (cached !== null) return cached;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ocms-a1-stub-'));
  const prefix = path.join(root, 'prefix');
  const scope = path.join(prefix, 'node_modules', '@deepseek-ai');
  for (const [pkg, version] of Object.entries(STUB_VERSIONS)) {
    const dir = path.join(scope, pkg);
    fs.mkdirSync(path.join(dir, 'lib'), { recursive: true });
    const manifest = { name: '@deepseek-ai/' + pkg, version };
    if (pkg === 'dsh-app-boot' || pkg === 'cordis-plugin-include') manifest.main = 'lib/index.mjs';
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(manifest), 'utf8');
  }
  // Some inventory tests resolve the owning DSH manifest two levels above the
  // utility scope; provide the pinned top-level manifest in the stub tree.
  fs.writeFileSync(path.join(prefix, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: STUB_VERSIONS.dsh }), 'utf8');
  const yamlDist = path.join(REPO_ROOT, 'node_modules', 'yaml', 'dist', 'index.js');
  const yamlUrl = pathToFileURL(yamlDist).href;
  fs.writeFileSync(path.join(scope, 'dsh-app-boot', 'lib', 'index.mjs'), [
    STUB_HEADER,
    "import fs from 'node:fs';",
    "import path from 'node:path';",
    "import yamlPkg from '" + yamlUrl + "';",
    'const parseYaml = yamlPkg.parse;',
    'function isObj(v) { return v !== null && typeof v === \'object\' && !Array.isArray(v); }',
    'export function loadProfileDirectory(kind, profileDirReal) {',
    '  let bundles = [];',
    '  try {',
    "    const manifest = JSON.parse(fs.readFileSync(path.join(profileDirReal, 'package.json'), 'utf8'));",
    '    const b = manifest && manifest.dsh && manifest.dsh.profile && manifest.dsh.profile.bundles;',
    '    if (Array.isArray(b)) bundles = b.filter((x) => typeof x === \'string\');',
    '  } catch { bundles = []; }',
    '  const layers = [];',
    '  const skippedBundles = [];',
    '  for (const pkg of bundles) {',
    '    const file = path.join(profileDirReal, \'node_modules\', ...pkg.split(\'/\'), \'cordis.patch.yml\');',
    '    try {',
    "      const rows = parseYaml(fs.readFileSync(file, 'utf8'));",
    "      if (!Array.isArray(rows)) throw new Error('not-array');",
    '      layers.push({ packageName: pkg, patches: rows });',
    '    } catch { skippedBundles.push({ packageName: pkg }); }',
    '  }',
    '  return { layers, skippedBundles };',
    '}',
    'function flatInto(rows, out) {',
    '  for (const row of rows) {',
    '    if (!isObj(row)) { out.push(row); continue; }',
    "    if (Object.hasOwn(row, 'insert') && Array.isArray(row.insert)) { flatInto(row.insert, out); continue; }",
    '    out.push(row);',
    '    if (row.group && Array.isArray(row.config)) flatInto(row.config, out);',
    '  }',
    '}',
    'export function readProfilePatches(kind, context, initial) {',
    '  const base = [];',
    '  for (const layer of (initial.layers || [])) base.push(...layer.patches);',
    '  const overlays = context && Array.isArray(context.overlays) ? context.overlays : [];',
    '  return [...base, ...(initial.patches || []), ...overlays];',
    '}',
    'export function composeEntries(patchesArray) {',
    '  const flat = [];',
    '  flatInto(patchesArray[0] || [], flat);',
    '  const byId = new Map();',
    '  const order = [];',
    '  for (const row of flat) {',
    "    if (!isObj(row) || typeof row.id !== 'string' || Object.hasOwn(row, 'insert')) continue;",
    '    if (!byId.has(row.id)) { byId.set(row.id, {}); order.push(row.id); }',
    '    const cur = byId.get(row.id);',
    '    for (const [k, v] of Object.entries(row)) {',
    "      if (k === 'config' && isObj(cur[k]) && isObj(v)) cur[k] = { ...cur[k], ...v };",
    '      else cur[k] = v;',
    '    }',
    '  }',
    '  return order.map((id) => byId.get(id));',
    '}',
    '',
  ].join(String.fromCharCode(10)), 'utf8');
  fs.writeFileSync(path.join(scope, 'cordis-plugin-include', 'lib', 'index.mjs'),
    STUB_HEADER + String.fromCharCode(10) + 'export const entryListSchema = { parse: (v) => v };' + String.fromCharCode(10), 'utf8');
  // dsh-atomic-write stand-in: the two symbols the commit pipeline imports.
  // A real flock-free lock (exclusive create) plus a temp-write-and-rename,
  // matching the documented contract shape for TEST FIXTURES ONLY.
  fs.writeFileSync(path.join(scope, 'dsh-atomic-write', 'lib', 'index.mjs'), [
    STUB_HEADER,
    "import fs from 'node:fs';",
    "import path from 'node:path';",
    'export async function withFileLock(lockPath, fn, options) {',
    '  const opts = options || {};',
    '  const declaredWait = typeof opts.waitMs === "number" ? opts.waitMs : null;',
    '  // Mirror the native lock contract: the caller-supplied waitMs is the LOCK wait.',
    '  const waitMs = declaredWait === null ? 60000 : declaredWait;',
    '  const actualLockPath = lockPath + ".lock";',
    '  const started = Date.now();',
    '  for (;;) {',
    '    try { fs.writeFileSync(actualLockPath, String(process.pid), { flag: "wx", mode: 0o600 }); break; }',
    '    catch (err) {',
    '      if (err && err.code !== "EEXIST" && err.code !== "EPERM" && err.code !== "EACCES") throw err;',
    '      if (Date.now() - started > waitMs) { const e = new Error("lock timeout"); e.code = "LOCK_TIMEOUT"; throw e; }',
    '      await new Promise((r) => setTimeout(r, 5));',
    '    }',
    '  }',
    '  const release = () => { try { fs.rmSync(actualLockPath, { force: true }); } catch {} };',
    '  process.once("exit", release);',
    '  try { return await fn(); } finally { release(); }',
    '}',
    'export async function writeFileAtomic(target, data) {',
    '  const tmp = String(target) + \'.a1tmp-\' + process.pid + \'-\' + Date.now();',
    '  fs.writeFileSync(tmp, data);',
    '  fs.renameSync(tmp, target);',
    '}',
    '',
  ].join(String.fromCharCode(10)), 'utf8');
  fs.writeFileSync(path.join(scope, 'dsh-atomic-write', 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-atomic-write', version: STUB_VERSIONS['dsh-atomic-write'], main: 'lib/index.mjs' }), 'utf8');
  const jsYamlDir = path.join(scope, 'cordis-plugin-include', 'node_modules', 'js-yaml');
  fs.mkdirSync(jsYamlDir, { recursive: true });
  fs.writeFileSync(path.join(jsYamlDir, 'package.json'), JSON.stringify({ name: 'js-yaml', version: '4.1.0', main: 'index.js' }), 'utf8');
  fs.writeFileSync(path.join(jsYamlDir, 'index.js'),
    'module.exports = { load: (t) => require(' + JSON.stringify(yamlDist) + ').parse(t) };' + String.fromCharCode(10), 'utf8');
  fs.writeFileSync(path.join(prefix, 'dsh.cmd'), '@echo off' + String.fromCharCode(10), 'utf8');
  fs.writeFileSync(path.join(prefix, 'dsh'), '#!/bin/sh' + String.fromCharCode(10), 'utf8');
  cached = { root, prefix, scope };
  return cached;
}

// PATH with the stub prefix first, so findDshExecutable() resolves it.
export function stubDshPathEnv(basePathEnv = process.env.PATH ?? '') {
  const { prefix } = stubDshTree();
  return prefix + path.delimiter + String(basePathEnv);
}

// The ambient PATH plus the stub: used when a test wants the real installed DSH
// preferred but still needs a usable tree when none is installed.
export function withStubDshPath(basePathEnv = process.env.PATH ?? '') {
  const { prefix } = stubDshTree();
  const parts = String(basePathEnv).split(path.delimiter).filter(Boolean);
  if (parts.includes(prefix)) return parts.join(path.delimiter);
  return [...parts, prefix].join(path.delimiter);
}

// Append the stub prefix to the ambient PATH once per process, unless a dsh
// executable is already resolvable there (a real install always wins).
let installed = false;
export function installStubDshOnAmbientPath() {
  if (installed) return false;
  installed = true;
  const key = Object.keys(process.env).find((k) => k.toUpperCase() === 'PATH') || 'PATH';
  const current = process.env[key] || '';
  const { prefix, scope } = stubDshTree();
  const names = process.platform === 'win32' ? ['dsh', 'dsh.cmd', 'dsh.exe', 'dsh.ps1'] : ['dsh'];
  for (const dir of current.split(path.delimiter)) {
    if (!dir) continue;
    for (const name of names) {
      try { if (fs.statSync(path.join(dir, name)).isFile()) return false; } catch { /* keep scanning */ }
    }
  }
  if (fs.existsSync(path.join(scope, 'dsh-app-boot', 'lib', 'index.mjs'))) {
    process.env[key] = current.length > 0 ? current + path.delimiter + prefix : prefix;
  }
  return true;
}

// True when a dsh executable is resolvable on the ambient PATH, i.e. a REAL
// installed tree exists. Tests whose property is about that installed tree use
// this to declare a skip instead of inspecting the stub.
export function realDshInstalledOnPath() {
  const key = Object.keys(process.env).find((k) => k.toUpperCase() === 'PATH') || 'PATH';
  const names = process.platform === 'win32' ? ['dsh', 'dsh.cmd', 'dsh.exe', 'dsh.ps1'] : ['dsh'];
  for (const dir of String(process.env[key] || '').split(path.delimiter)) {
    if (!dir) continue;
    const { prefix } = stubDshTree();
    if (path.resolve(dir) === path.resolve(prefix)) continue;
    for (const name of names) {
      try { if (fs.statSync(path.join(dir, name)).isFile()) return true; } catch { /* keep scanning */ }
    }
  }
  return false;
}

export const REAL_DSH_MISSING = 'pinned DSH 0.2.1-alpha.2 installed tree (no dsh executable on PATH)';

export function stubDshExists() {
  try {
    const { scope } = stubDshTree();
    return fs.existsSync(path.join(scope, 'dsh-app-boot', 'lib', 'index.mjs'));
  } catch {
    return false;
  }
}
