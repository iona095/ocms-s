// OCMS-S S2 — Managed configuration reader (P1-A §5 S2).
//
// Read-only consumer of an already admitted S1 target binding. Distinguishes
// the stored user-patch llm-pi-ai configuration from the effective composed
// configuration, attributes later-layer overrides, and reports exact-byte
// versus effective digests. NEVER writes, plans, renders, commits, or backs
// up. No S3–S6 functionality.
//
// Authorities: SPEC_DSH_PROFILE_AWARE_SYNC.md §§4, 6.3, 8.2, 8.4–8.5, 8.8,
// 9.1–9.4, 11.2, 11.6 plus the refusal taxonomy; P1_IMPLEMENTATION_READINESS.md
// §§3–5 (S2). The P0-R2 specification is normative; genuine conflict => HOLD.
//
// Section-6.3 posture: DSH library code is reached only through absolute
// anchors with exact-version admission (strategy A). The three profile
// composition readers plus the patch-list schema dialect are the only DSH
// symbols this module ever resolves, and only by anchored file URL — never
// by bare specifier. Layer-file parsing reuses the admitted schema object
// itself; the merge stays DSH-owned (no competing merge logic here).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { parseDocument, isSeq, isMap, isScalar } from 'yaml';
import {
  validateProfileName,
  admitDependencyPackages,
  EXPECTED_VERSIONS,
  classifyTarget,
  sameTarget,
  anchorNameBesideFile,
} from './target-resolver.mjs';

// Exactly the six managed routes (P0-R2 §9; mirrors sync.mjs
// MANAGED_ROUTE_KEYS — pinned equal by test, never extended here).
export const MANAGED_ROUTE_KEYS = [
  'opencode-go',
  'opencode-go-messages',
  'opencode-go-responses',
  'opencode-completions',
  'opencode-messages',
  'opencode',
];

// S2 refusal universe: frozen codes only (refusal taxonomy plus the S1
// admission family). No new codes are invented in this slice.
export const REFUSAL_CODES = [
  'INVALID_PROFILE_NAME',
  'PROFILE_NOT_INITIALIZED',
  'SYMLINK_ESCAPE',
  'PATCH_UNREADABLE',
  'PATCH_PARSE_ERROR',
  'PATCH_ROOT_NOT_SEQUENCE',
  'PLUGIN_ENTRY_MISSING',
  'PLUGIN_ENTRY_DUPLICATE',
  'NOT_PROFILE_OWNED',
  'STALE_TARGET',
  'SETTINGS_INVALID',
  'OVERRIDDEN',
  'INCOMPATIBLE_DSH',
];

// Success statuses. A differing effective configuration is explanatory
// status only — never commit authorization (S2 grants no write authority).
export const EFFECTIVE_STATUSES = ['MATCHED', 'EFFECTIVE_DIFFERS_FROM_STORED'];

const JS_TAG = 'tag:yaml.org,2002:js';
const STR_TAG = 'tag:yaml.org,2002:str';
const PATCH_FILENAME = 'cordis.patch.yml';
const DIGEST_PATTERN = /^[0-9a-f]{64}$/;

// Retired-bundle pre-check knowledge. Pinned to the exact admitted
// dsh-app-boot version (strategy A makes the set fixed, not guessed); a test
// re-verifies it against the installed source read-only. Profiles listing a
// retired bundle are refused before any load call, because the load call
// itself would normalize the manifest on disk — and a read must not mutate.
const RETIRED_BUNDLE_NAMES = ['@deepseek-ai/dsh-experimental-schedule-bundle'];

function refusal(code, message, detail) {
  const out = { ok: false, code, message };
  if (detail !== undefined) out.detail = detail;
  return out;
}

function sha256HexBytes(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

// Deterministic canonical JSON for the effective digest: object keys sorted,
// array order preserved, primitives preserved. Same domain rules as the
// planning bundle digest (sync.mjs canonicalJson): insertion order never
// leaks into the digest, array order always does. Inputs are cycle-free
// YAML data (checked before use); custom tags arrive boxed as plain data and
// are canonicalized structurally, never executed.
function canonicalJson(value) {
  if (value === undefined || value === null) return 'null';
  const t = typeof value;
  if (t === 'boolean' || t === 'string') return JSON.stringify(value);
  // S8 digest-numerics: non-finite numbers digest as distinct bare tokens,
  // never as 'null' (null vs .nan digested identically). Bare tokens cannot
  // collide with quoted strings, 'null', or containers.
  if (t === 'number') {
    if (Number.isFinite(value)) return JSON.stringify(value);
    if (Number.isNaN(value)) return 'NaN';
    return value < 0 ? '-Infinity' : 'Infinity';
  }
  if (t === 'bigint') return JSON.stringify(String(value));
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (t !== 'object') return 'null';
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

function isPlainObject(v) {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function isStringArray(v) {
  if (!Array.isArray(v)) return false;
  for (let i = 0; i < v.length; i++) {
    if (!(i in v) || typeof v[i] !== 'string') return false;
  }
  return true;
}

// Fail-closed cycle scan over parsed data (aliases can self-reference; both
// parsers tolerate them, so the reader checks explicitly).
function hasCycle(v, seen = new Set()) {
  if (v === null || typeof v !== 'object') return false;
  if (seen.has(v)) return true;
  seen.add(v);
  try {
    if (Array.isArray(v)) return v.some((item) => hasCycle(item, seen));
    return Object.keys(v).some((k) => hasCycle(v[k], seen));
  } finally {
    seen.delete(v);
  }
}

function freezeDeep(v, seen = new Set()) {
  if (v === null || typeof v !== 'object' || seen.has(v)) return v;
  seen.add(v);
  if (Array.isArray(v)) v.forEach((item) => freezeDeep(item, seen));
  else for (const k of Object.keys(v)) freezeDeep(v[k], seen);
  return Object.freeze(v);
}

function realpathOrNull(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    return null;
  }
}

function samePath(a, b) {
  const norm = (p) => (process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p));
  return norm(a) === norm(b);
}

// Required S1 identity fields (S2.1). The binding is validated, never
// trusted: attestation stays opaque (admission, never proof) and overlays
// are consumed as declared. Malformed identity fails closed as stale — the
// file truth it claims cannot be established.
function checkBinding(target) {
  if (!isPlainObject(target)) {
    return refusal('STALE_TARGET', 'The supplied target binding is not usable; re-resolve the profile target.', 'binding-invalid');
  }
  const nameCheck = validateProfileName(target.profileName);
  if (!nameCheck.ok) return nameCheck;
  for (const key of ['profileDirReal', 'patchPathReal', 'pluginEntryName', 'dshHomeReal']) {
    if (typeof target[key] !== 'string' || target[key].length === 0 || (key !== 'pluginEntryName' && !path.isAbsolute(target[key]))) {
      return refusal('STALE_TARGET', 'The supplied target binding is not usable; re-resolve the profile target.', 'binding-invalid');
    }
  }
  if (target.classification !== 'SCRATCH' && target.classification !== 'PRODUCTION') {
    return refusal('STALE_TARGET', 'The supplied target binding is not usable; re-resolve the profile target.', 'binding-invalid');
  }
  if (typeof target.patchDigest !== 'string' || !DIGEST_PATTERN.test(target.patchDigest)) {
    return refusal('STALE_TARGET', 'The supplied target binding is not usable; re-resolve the profile target.', 'binding-invalid');
  }
  if (!isStringArray(target.declaredOverlays)) {
    return refusal('STALE_TARGET', 'The supplied target binding is not usable; re-resolve the profile target.', 'binding-invalid');
  }
  if (!Object.hasOwn(target, 'liveAttestation')) {
    return refusal('STALE_TARGET', 'The supplied target binding is not usable; re-resolve the profile target.', 'binding-invalid');
  }
  try {
    if (!sameTarget(target, target)) {
      return refusal('STALE_TARGET', 'The supplied target binding is not usable; re-resolve the profile target.', 'binding-invalid');
    }
  } catch {
    return refusal('STALE_TARGET', 'The supplied target binding is not usable; re-resolve the profile target.', 'binding-invalid');
  }
  return { ok: true };
}

// Parse one patch-list file with the admitted entry-list dialect (the same
// schema object the composition pipeline parses with). Structural rules mirror
// the pipeline's patch-list admission: top-level array, mapping rows.
// Anything else refuses; caught text is never propagated (leak rule).
function parsePatchData(jsYaml, entryListSchema, text, layer, index = null) {
  const tag = (extra = {}) => ({ layer, ...(index === null ? {} : { index }), ...extra });
  let parsed;
  try {
    parsed = jsYaml.load(text, { schema: entryListSchema });
  } catch {
    return refusal('PATCH_PARSE_ERROR', 'A composition layer cannot be parsed; effective truth is not established.', tag());
  }
  if (!Array.isArray(parsed)) {
    return refusal('PATCH_ROOT_NOT_SEQUENCE', 'A composition layer root must be a sequence.', tag());
  }
  for (const row of parsed) {
    if (!isPlainObject(row)) {
      return refusal('PATCH_PARSE_ERROR', 'A composition layer carries a non-mapping row.', tag());
    }
  }
  if (hasCycle(parsed)) {
    return refusal('PATCH_PARSE_ERROR', 'A composition layer carries cyclic aliases.', tag());
  }
  return { ok: true, rows: parsed };
}

// Structural cross-check of the user patch in the editor's own parse posture
// (sequence root, id/insert markers). Must agree with the dialect parse on
// row count, candidate positions, and insert positions; any disagreement
// refuses (a permissive partial parse is never treated as valid).
function scanPatchStructure(text) {
  let doc;
  try {
    doc = parseDocument(text, { customTags: [{ tag: JS_TAG, resolve: (value) => value }] });
  } catch {
    return refusal('PATCH_PARSE_ERROR', 'The profile patch cannot be parsed.', { layer: 'user' });
  }
  if (!doc || (doc.errors && doc.errors.length > 0)) {
    return refusal('PATCH_PARSE_ERROR', 'The profile patch cannot be parsed.', { layer: 'user' });
  }
  if (!isSeq(doc.contents)) {
    return refusal('PATCH_ROOT_NOT_SEQUENCE', 'The profile patch root must be a sequence.', { layer: 'user' });
  }
  const candidates = [];
  const inserts = [];
  doc.contents.items.forEach((item, at) => {
    if (!isMap(item)) return;
    if (item.has('insert')) {
      if (item.get('id') === 'llm-pi-ai') inserts.push(at);
      return;
    }
    const idNode = item.get('id', true);
    if (
      isScalar(idNode)
      && idNode.value === 'llm-pi-ai'
      && (idNode.tag === undefined || idNode.tag === STR_TAG)
    ) {
      candidates.push(at);
    }
  });
  return { ok: true, size: doc.contents.items.length, candidates, inserts };
}

function isCandidateRow(row) {
  return isPlainObject(row) && typeof row.id === 'string' && row.id === 'llm-pi-ai' && !Object.hasOwn(row, 'insert');
}

// Converter for relative row names beside their patch file (mirrors the
// pipeline's documented anchoring so every layer composes identically).
// Every row from one file must anchor alike: insert-directive children AND
// top-level rows, otherwise one logical row splits into two addresses and
// composition addressability breaks. Pure path logic; merge behavior stays
// DSH-owned.
function anchorInsertNames(rows, file) {
  const visit = (entry) => {
    if (!isPlainObject(entry) && !Array.isArray(entry)) return;
    if (!Array.isArray(entry) && typeof entry.name === 'string') {
      entry.name = anchorNameBesideFile(entry.name, file);
    }
    if (!Array.isArray(entry) && entry.group && Array.isArray(entry.config)) entry.config.forEach(visit);
  };
  rows.forEach((row) => {
    visit(row);
    if (Array.isArray(row.insert)) row.insert.forEach(visit);
  });
  return rows;
}

// Editor's row flattening (group children participate by id, like the native
// override lookup). Pure structural walk.
function flattenRows(rows) {
  const out = [];
  for (const row of rows) {
    out.push(row);
    if (row && typeof row === 'object' && row.group && Array.isArray(row.config)) out.push(...flattenRows(row.config));
  }
  return out;
}

function findLlmRow(composed) {
  return flattenRows(composed).find((row) => row !== null && typeof row === 'object' && !Array.isArray(row) && row.id === 'llm-pi-ai') ?? null;
}

function rowConfig(row) {
  if (row === null || !Object.hasOwn(row, 'config')) return undefined;
  return row.config;
}

// Shape validation (P0-R2 §9.4): containers must be mappings when present,
// models must be arrays when present. Absent keys are missing, never
// malformed. Unrelated providers are ignored entirely (never normalized).
function checkProviderShapes(config, scope) {
  const at = (sub) => ({ scope, path: sub });
  if (!isPlainObject(config)) {
    return refusal('SETTINGS_INVALID', 'The llm-pi-ai configuration must be a mapping when present.', at('config'));
  }
  if (!Object.hasOwn(config, 'providers')) return { ok: true };
  const providers = config.providers;
  if (!isPlainObject(providers)) {
    return refusal('SETTINGS_INVALID', 'The llm-pi-ai providers container must be a mapping when present.', at('providers'));
  }
  for (const route of MANAGED_ROUTE_KEYS) {
    if (!Object.hasOwn(providers, route)) continue;
    const provider = providers[route];
    if (!isPlainObject(provider)) {
      return refusal('SETTINGS_INVALID', `Managed route ${route} must be a mapping when present.`, at(`providers.${route}`));
    }
    if (Object.hasOwn(provider, 'models') && !Array.isArray(provider.models)) {
      return refusal('SETTINGS_INVALID', `Managed route ${route} models must be an array when present.`, at(`providers.${route}.models`));
    }
  }
  return { ok: true };
}

// Managed projection: per-route models arrays, with explicit missingness.
// Missing routes/keys stay distinguishable from malformed values (malformed
// is refused before comparison, never coerced here).
function projectManaged(config) {
  const out = {};
  const providers = config !== undefined && isPlainObject(config) && Object.hasOwn(config, 'providers') ? config.providers : undefined;
  for (const route of MANAGED_ROUTE_KEYS) {
    if (
      providers === undefined
      || !Object.hasOwn(providers, route)
      || !isPlainObject(providers[route])
      || !Object.hasOwn(providers[route], 'models')
    ) {
      out[route] = { missing: true };
    } else {
      out[route] = { missing: false, models: providers[route].models };
    }
  }
  return out;
}

function managedSlotEqual(a, b) {
  if (a.missing && b.missing) return true;
  if (a.missing || b.missing) return false;
  return isDeepStrictEqual(a.models, b.models);
}

// Exported for tests: resolves a package entry file, refusing anything that
// escapes the package directory.
export function resolvePackageEntry(pkgDir) {
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
  } catch {
    return null;
  }
  const pick = (node) => {
    if (typeof node === 'string') return node;
    if (Array.isArray(node)) {
      for (const item of node) {
        const hit = pick(item);
        if (hit) return hit;
      }
      return null;
    }
    if (node && typeof node === 'object') {
      return pick(node.import) ?? pick(node.default);
    }
    return null;
  };
  const rel = (manifest.exports && typeof manifest.exports === 'object' && !Array.isArray(manifest.exports)
    ? pick(manifest.exports['.'])
    : pick(manifest.exports)) ?? (typeof manifest.main === 'string' ? manifest.main : null) ?? 'lib/index.js';
  if (typeof rel !== 'string' || rel.length === 0) return null;
  const abs = path.join(pkgDir, rel);
  let real;
  try {
    if (!fs.statSync(abs).isFile()) return null;
    real = fs.realpathSync(abs);
  } catch {
    return null;
  }
  // P3-4: after realpath, refuse an entry that resolves outside the package
  // directory (manifest ../ traversal or an escaping symlink).
  let root;
  try {
    root = fs.realpathSync(pkgDir);
  } catch {
    return null;
  }
  const relToRoot = path.relative(root, real);
  if (relToRoot === '' || relToRoot === '..' || relToRoot.startsWith('..' + path.sep) || path.isAbsolute(relToRoot)) return null;
  return abs;
}

function readManifestVersion(manifestPath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (parsed && typeof parsed.version === 'string') return { ok: true, version: parsed.version };
    return { ok: true, version: null };
  } catch (err) {
    return { ok: false, error: err && err.code ? err.code : String((err && err.message) || err) };
  }
}

// Strategy-A utility resolution for composition (read-only). Order: explicit
// scope option (terminal) → the S1 binding's admitted evidence (re-asserted
// from disk, never trusted) → fresh admission over absolute anchors. Every
// version is re-asserted before import; symbols are checked after import.
// Anything short refuses INCOMPATIBLE_DSH — effective truth is never built
// from unverified code.
async function resolveCompositionUtils(target, { installAnchorDir, pathEnv, profileDirReal }) {
  const need = {
    'dsh-app-boot': EXPECTED_VERSIONS['dsh-app-boot'],
    'cordis-plugin-include': EXPECTED_VERSIONS['cordis-plugin-include'],
    dsh: EXPECTED_VERSIONS.dsh,
  };
  const assertScopeVersions = (scopeDir, dshDir) => {
    const versions = {};
    for (const [pkg, want] of Object.entries(need)) {
      const base = pkg === 'dsh' ? dshDir : path.join(scopeDir, pkg);
      const read = readManifestVersion(path.join(base, 'package.json'));
      if (!read.ok || !want.has(read.version)) return null;
      versions[pkg] = read.version;
    }
    return versions;
  };
  let scopeDir = null;
  let dshDir = null;
  let anchorKind = null;
  let versions = null;

  if (installAnchorDir !== null && installAnchorDir !== undefined) {
    const real = realpathOrNull(path.resolve(String(installAnchorDir)));
    if (real === null) {
      return refusal('INCOMPATIBLE_DSH', 'The explicit composition anchor cannot be resolved.', 'explicit-anchor-unresolvable');
    }
    const utilVersions = {};
    let satisfied = true;
    for (const [pkg, want] of Object.entries({ 'dsh-app-boot': need['dsh-app-boot'], 'cordis-plugin-include': need['cordis-plugin-include'] })) {
      const read = readManifestVersion(path.join(real, pkg, 'package.json'));
      if (!read.ok || !want.has(read.version)) satisfied = false;
      else utilVersions[pkg] = read.version;
    }
    // DSH baseline beside the scope (S1 explicit convention) or, for the
    // operative nested install layout, the owning package two levels up —
    // exact versions either way, first match wins, documented order.
    dshDir = null;
    let dshObserved = null;
    const dshCandidates = [path.join(real, 'dsh'), path.join(real, '..', '..')];
    for (const candidate of dshCandidates) {
      const read = readManifestVersion(path.join(candidate, 'package.json'));
      if (!read.ok || !need.dsh.has(read.version)) continue;
      let nameOk = false;
      try {
        nameOk = JSON.parse(fs.readFileSync(path.join(candidate, 'package.json'), 'utf8')).name === '@deepseek-ai/dsh';
      } catch {
        nameOk = false;
      }
      if (nameOk) {
        dshDir = candidate;
        dshObserved = read.version;
        break;
      }
    }
    if (!satisfied || dshDir === null) {
      return refusal('INCOMPATIBLE_DSH', 'The explicit composition anchor does not satisfy the pinned combination.', 'explicit-anchor-unsatisfied');
    }
    // Recorded evidence is what the manifests said, never the expected value.
    versions = { ...utilVersions, dsh: dshObserved };
    scopeDir = real;
    anchorKind = 'explicit';
  } else if (target.dependencyEvidence && isPlainObject(target.dependencyEvidence)) {
    const ev = target.dependencyEvidence;
    const evScope = typeof ev.anchorDir === 'string' ? ev.anchorDir : null;
    const evDsh = ev.dsh && typeof ev.dsh.path === 'string' ? ev.dsh.path : null;
    if (evScope !== null && evDsh !== null) {
      const check = assertScopeVersions(evScope, evDsh);
      if (check !== null) {
        scopeDir = evScope;
        dshDir = evDsh;
        anchorKind = 'binding-evidence';
        versions = check;
      }
    }
  }
  if (scopeDir === null) {
    const admitted = admitDependencyPackages({ profileDirReal, installAnchorDir: null, pathEnv });
    if (!admitted.ok) return admitted;
    scopeDir = admitted.evidence.anchorDir;
    dshDir = admitted.evidence.dsh.path;
    anchorKind = admitted.evidence.anchorKind;
    versions = {
      // Observed versions, read from the manifests the admission just
      // verified — never the expected constants (v1.4.7-rc6 §5(b)).
      'dsh-app-boot': admitted.evidence.versions['dsh-app-boot'],
      'cordis-plugin-include': admitted.evidence.versions['cordis-plugin-include'],
      dsh: admitted.evidence.dshVersion,
    };
  }

  const appBootEntry = resolvePackageEntry(path.join(scopeDir, 'dsh-app-boot'));
  const includeEntry = resolvePackageEntry(path.join(scopeDir, 'cordis-plugin-include'));
  if (appBootEntry === null || includeEntry === null) {
    return refusal('INCOMPATIBLE_DSH', 'The admitted composition libraries cannot be located.', 'util-entry-unresolvable');
  }
  let appBoot;
  try {
    appBoot = await import(pathToFileURL(appBootEntry).href);
  } catch {
    return refusal('INCOMPATIBLE_DSH', 'The admitted composition libraries cannot be loaded.', 'util-import-failed');
  }
  if (
    typeof appBoot.loadProfileDirectory !== 'function'
    || typeof appBoot.readProfilePatches !== 'function'
    || typeof appBoot.composeEntries !== 'function'
  ) {
    return refusal('INCOMPATIBLE_DSH', 'The admitted composition libraries miss required readers.', 'util-symbol-missing');
  }
  let includeLib;
  try {
    includeLib = await import(pathToFileURL(includeEntry).href);
  } catch {
    return refusal('INCOMPATIBLE_DSH', 'The admitted patch-list dialect cannot be loaded.', 'util-import-failed');
  }
  if (!includeLib || typeof includeLib.entryListSchema !== 'object' || includeLib.entryListSchema === null) {
    return refusal('INCOMPATIBLE_DSH', 'The admitted patch-list dialect is unavailable.', 'util-symbol-missing');
  }
  let jsYaml;
  try {
    jsYaml = createRequire(includeEntry)('js-yaml');
  } catch {
    return refusal('INCOMPATIBLE_DSH', 'The admitted YAML dialect parser cannot be loaded.', 'util-import-failed');
  }
  if (!jsYaml || typeof jsYaml.load !== 'function') {
    return refusal('INCOMPATIBLE_DSH', 'The admitted YAML dialect parser is unavailable.', 'util-symbol-missing');
  }
  const installAnchor = path.join(dshDir, 'package.json');
  try {
    if (!fs.statSync(installAnchor).isFile()) {
      return refusal('INCOMPATIBLE_DSH', 'The owning DSH anchor cannot be established.', 'install-anchor-missing');
    }
  } catch {
    return refusal('INCOMPATIBLE_DSH', 'The owning DSH anchor cannot be established.', 'install-anchor-missing');
  }
  return {
    ok: true,
    utils: {
      loadProfileDirectory: appBoot.loadProfileDirectory,
      readProfilePatches: appBoot.readProfilePatches,
      composeEntries: appBoot.composeEntries,
      entryListSchema: includeLib.entryListSchema,
      jsYaml,
    },
    anchor: { kind: anchorKind, scopeDir, installAnchor, versions },
  };
}

function homePatchStat(homePatchPath) {
  try {
    const st = fs.statSync(homePatchPath);
    if (!st.isFile()) return { present: true, usable: false };
    return { present: true, usable: true, size: st.size, mtimeMs: st.mtimeMs };
  } catch (err) {
    if (err && err.code === 'ENOENT') return { present: false, usable: false };
    return { present: true, usable: false };
  }
}

// Main S2 entry: read-only managed-configuration inspection over an
// explicitly supplied S1 binding. Resolves nothing implicitly; mutates
// nothing; grants no write authority.
export async function readManagedConfig(options = {}) {
  let {
    target = null,
    installAnchorDir = null,
    pathEnv = process.env.PATH ?? '',
    telemetryDisabledEnv = process.env.DSH_TELEMETRY_DISABLED,
  } = options ?? {};

  // 1. Binding validation (S1 identity contract, attestation opaque).
  const bindingCheck = checkBinding(target);
  if (!bindingCheck.ok) return bindingCheck;

  // Bounded snapshot: validated values are cloned at entry so later caller
  // changes cannot alter the bound view and the returned view stays detached.
  try {
    target = structuredClone(target);
  } catch {
    return refusal('STALE_TARGET', 'The supplied target binding is not usable; re-resolve the profile target.', 'binding-invalid');
  }

  // 2. Live re-resolution: real paths plus the classification anchor must
  // still hold, and the patch must sit directly inside the profile.
  const homeReal = realpathOrNull(target.dshHomeReal);
  if (homeReal === null) {
    return refusal('STALE_TARGET', 'The bound classification anchor is gone; re-resolve the profile target.', 'home-anchor-missing');
  }
  const profileDirReal = realpathOrNull(target.profileDirReal);
  if (profileDirReal === null) {
    return refusal('PROFILE_NOT_INITIALIZED', 'The bound profile directory is gone.', 'profile-dir-missing');
  }
  if (!samePath(profileDirReal, target.profileDirReal)) {
    return refusal('STALE_TARGET', 'The bound profile directory moved; re-Preview against current file truth.', 'profile-path-changed');
  }
  const patchPathReal = realpathOrNull(target.patchPathReal);
  if (patchPathReal === null) {
    return refusal('PATCH_UNREADABLE', 'The profile patch file cannot be read.', { layer: 'user', cause: 'patch-missing' });
  }
  if (!samePath(path.dirname(patchPathReal), profileDirReal)) {
    return refusal('SYMLINK_ESCAPE', 'The profile patch file escapes the profile directory.', 'patch-escape');
  }
  if (!samePath(patchPathReal, target.patchPathReal)) {
    return refusal('STALE_TARGET', 'The bound patch path moved; re-Preview against current file truth.', 'patch-path-changed');
  }
  const resolutionHome = path.dirname(path.dirname(profileDirReal));
  // Designation check: the bound name must still designate the bound
  // directory through the S1 construction (<home>/profiles/<name>). If an
  // intermediate is (or became) a reparse point, the grandparent above is
  // not the home S1 scanned — and no other home can be assumed. Refuse
  // rather than compose against a guessed home layer set.
  const redesignated = realpathOrNull(path.resolve(resolutionHome, 'profiles', target.profileName));
  if (redesignated === null || !samePath(redesignated, profileDirReal)) {
    return refusal('STALE_TARGET', 'The bound profile designation no longer resolves; re-resolve the profile target.', 'profile-designation-mismatch');
  }

  // 3. Exact source bytes and stale-target protection (SHA-256 over bytes,
  // never over a reconstructed representation).
  let patchBytes;
  try {
    patchBytes = fs.readFileSync(patchPathReal);
  } catch {
    return refusal('PATCH_UNREADABLE', 'The profile patch file cannot be read.', { layer: 'user', cause: 'patch-unreadable' });
  }
  const patchDigest = sha256HexBytes(patchBytes);
  if (patchDigest !== target.patchDigest) {
    return refusal('STALE_TARGET', 'The target bytes changed since binding; re-Preview against current file truth.', {
      cause: 'patch-digest-mismatch',
      expected: target.patchDigest,
      observed: patchDigest,
    });
  }
  let expectedClassification;
  try {
    expectedClassification = classifyTarget(profileDirReal, target.dshHomeReal);
  } catch {
    return refusal('STALE_TARGET', 'The supplied target binding is not usable; re-resolve the profile target.', 'binding-invalid');
  }
  if (target.classification !== expectedClassification) {
    return refusal('STALE_TARGET', 'The bound classification does not match the bound paths; re-resolve the profile target.', 'classification-mismatch');
  }
  const patchText = patchBytes.toString('utf8');

  // 4. Manifest pre-checks: bundle list shape plus the pinned retired-bundle
  // refusal (the load call below would otherwise normalize the manifest —
  // a read must never do that).
  let manifestBundles;
  try {
    const manifestRaw = fs.readFileSync(path.join(profileDirReal, 'package.json'), 'utf8');
    const manifest = JSON.parse(manifestRaw);
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
      return refusal('PROFILE_NOT_INITIALIZED', 'The profile manifest is not usable.', 'manifest-malformed');
    }
    manifestBundles = manifest.dsh && manifest.dsh.profile && manifest.dsh.profile.bundles !== undefined
      ? manifest.dsh.profile.bundles
      : [];
  } catch {
    return refusal('PROFILE_NOT_INITIALIZED', 'The profile manifest cannot be established.', 'manifest-unusable');
  }
  if (!Array.isArray(manifestBundles) || manifestBundles.some((b) => typeof b !== 'string')) {
    return refusal('PROFILE_NOT_INITIALIZED', 'The profile bundle list is not usable.', 'manifest-bundles-malformed');
  }
  const retired = manifestBundles.filter((b) => RETIRED_BUNDLE_NAMES.includes(b));
  if (retired.length > 0) {
    return refusal('PROFILE_NOT_INITIALIZED', 'The profile lists a retired bundle; read-only composition cannot proceed.', {
      cause: 'retired-bundle-listed',
      packages: [...retired],
    });
  }

  // 5. Composition utilities (exact-version, absolute anchors only).
  const resolved = await resolveCompositionUtils(target, { installAnchorDir, pathEnv, profileDirReal });
  if (!resolved.ok) return resolved;
  const { loadProfileDirectory, readProfilePatches, composeEntries, entryListSchema, jsYaml } = resolved.utils;

  // 6. User-patch parses: strict dialect data plus the editor-posture
  // structural scan; the two must agree on shape and positions.
  const dataParse = parsePatchData(jsYaml, entryListSchema, patchText, 'user');
  if (!dataParse.ok) return dataParse;
  const structScan = scanPatchStructure(patchText);
  if (!structScan.ok) return structScan;
  const dataCandidates = [];
  const dataInserts = [];
  dataParse.rows.forEach((row, at) => {
    if (!isPlainObject(row)) return;
    if (Object.hasOwn(row, 'insert')) {
      if (row.id === 'llm-pi-ai') dataInserts.push(at);
      return;
    }
    if (isCandidateRow(row)) dataCandidates.push(at);
  });
  if (
    dataParse.rows.length !== structScan.size
    || !isDeepStrictEqual(dataCandidates, structScan.candidates)
    || !isDeepStrictEqual(dataInserts, structScan.inserts)
  ) {
    return refusal('PATCH_PARSE_ERROR', 'The profile patch parses disagree; effective truth is not established.', {
      layer: 'user',
      cause: 'parse-disagreement',
    });
  }
  if (dataCandidates.length > 1) {
    return refusal('PLUGIN_ENTRY_DUPLICATE', 'More than one llm-pi-ai entry exists; refusing rather than picking.', 'same-file-duplicate');
  }
  // Snapshot the parsed document BEFORE insert-name anchoring: documentModel
  // mirrors the patch as parsed, while the anchored rows below serve
  // composition only. Bytes, document, and composition views stay separate.
  const documentRows = structuredClone(dataParse.rows);
  // Insert-name anchoring matches the pipeline's own layer admission so the
  // verified rows compose identically downstream (pure path logic only).
  anchorInsertNames(dataParse.rows, patchPathReal);
  const llmEntryIndex = dataCandidates.length === 1 ? dataCandidates[0] : -1;
  const storedRow = llmEntryIndex >= 0 ? dataParse.rows[llmEntryIndex] : null;
  const storedConfig = storedRow !== null && Object.hasOwn(storedRow, 'config') ? storedRow.config : undefined;
  const warnings = [];
  if (dataInserts.length > 0) warnings.push('INSERT_ROW_SAME_ID');
  if (storedConfig !== undefined) {
    const shapeCheck = checkProviderShapes(storedConfig, 'stored');
    if (!shapeCheck.ok) return shapeCheck;
  }
  if (storedRow !== null && target.pluginEntryName !== ((typeof storedRow.name === 'string' && storedRow.name.length > 0) ? storedRow.name : 'llm-pi-ai')) {
    return refusal('STALE_TARGET', 'The bound entry name does not match the user patch entry; re-resolve the profile target.', 'entry-name-mismatch');
  }

  // 7. Home layer pre-read (the pipeline re-reads it internally; existence
  // plus stat are re-checked after composition to catch transients).
  const homePatchPath = path.join(resolutionHome, PATCH_FILENAME);
  const homeBefore = homePatchStat(homePatchPath);
  let homeRows = null;
  if (homeBefore.present) {
    if (!homeBefore.usable) {
      return refusal('PATCH_UNREADABLE', 'The home patch layer cannot be read.', { layer: 'home', cause: 'home-not-regular-file' });
    }
    let homeText;
    try {
      homeText = fs.readFileSync(homePatchPath, 'utf8');
    } catch {
      return refusal('PATCH_UNREADABLE', 'The home patch layer cannot be read.', { layer: 'home', cause: 'home-unreadable' });
    }
    const homeParse = parsePatchData(jsYaml, entryListSchema, homeText, 'home');
    if (!homeParse.ok) return homeParse;
    anchorInsertNames(homeParse.rows, homePatchPath);
    homeRows = homeParse.rows;
  }

  // 8. Declared launcher overlays: absolute paths only (never resolved
  // against the working directory), parsed with the same dialect, insert
  // names anchored beside their file like the pipeline does.
  const overlayRows = [];
  const overlaySources = [];
  for (let i = 0; i < target.declaredOverlays.length; i++) {
    const decl = target.declaredOverlays[i];
    if (typeof decl !== 'string' || decl.length === 0 || !path.isAbsolute(decl)) {
      return refusal('PATCH_UNREADABLE', 'A declared overlay is not an absolute patch path.', {
        layer: 'overlay',
        index: i,
        cause: 'overlay-not-absolute',
      });
    }
    const real = realpathOrNull(decl);
    if (real === null) {
      return refusal('PATCH_UNREADABLE', 'A declared overlay file is missing.', { layer: 'overlay', index: i, cause: 'overlay-missing' });
    }
    let statOk = false;
    try {
      statOk = fs.statSync(real).isFile();
    } catch {
      statOk = false;
    }
    if (!statOk) {
      return refusal('PATCH_UNREADABLE', 'A declared overlay is not a regular file.', { layer: 'overlay', index: i, cause: 'overlay-not-regular-file' });
    }
    let overlayText;
    try {
      overlayText = fs.readFileSync(real, 'utf8');
    } catch {
      return refusal('PATCH_UNREADABLE', 'A declared overlay file cannot be read.', { layer: 'overlay', index: i, cause: 'overlay-unreadable' });
    }
    const overlayParse = parsePatchData(jsYaml, entryListSchema, overlayText, 'overlay', i);
    if (!overlayParse.ok) {
      if (overlayParse.code === 'PATCH_ROOT_NOT_SEQUENCE') {
        return refusal('PATCH_ROOT_NOT_SEQUENCE', 'A declared overlay root must be a sequence.', { layer: 'overlay', index: i });
      }
      return overlayParse;
    }
    anchorInsertNames(overlayParse.rows, real);
    overlayRows.push(overlayParse.rows);
    overlaySources.push(real);
  }

  // 9. Bundle layers (user layer skipped here: the verified rows above ARE
  // the user layer — one read, no second-read skew). Skipped bundles refuse:
  // an omitted applicable layer must never read as verified truth.
  let initial;
  try {
    initial = loadProfileDirectory('ocms-s', profileDirReal, resolved.anchor.installAnchor, { userLayer: false });
  } catch {
    return refusal('PATCH_UNREADABLE', 'The profile bundle layers cannot be established.', {
      layer: 'bundle-layers',
      cause: 'bundle-load-failed',
    });
  }
  if (initial.skippedBundles && initial.skippedBundles.length > 0) {
    return refusal('PATCH_UNREADABLE', 'A profile bundle layer is unavailable; effective truth is not established.', {
      layer: 'bundle',
      cause: 'bundle-layer-unavailable',
      packages: initial.skippedBundles.map((s) => s.packageName),
    });
  }
  const baseRows = initial.layers.flatMap((layer) => layer.patches);

  // 10. Full composition in the normative order (bundles, user, home,
  // declared overlays, telemetry posture) through the admitted pipeline.
  const initialForCompose = { ...initial, patches: dataParse.rows, patchPath: patchPathReal };
  const context = {
    name: target.profileName,
    dir: profileDirReal,
    patchPath: patchPathReal,
    installAnchor: resolved.anchor.installAnchor,
    cwd: profileDirReal,
    home: resolutionHome,
    startedBundles: [],
    overlays: overlayRows.flat(),
    telemetryDisabledEnv,
  };
  let patchesFull;
  try {
    patchesFull = readProfilePatches('ocms-s', context, initialForCompose);
  } catch {
    return refusal('PATCH_PARSE_ERROR', 'The effective composition cannot be established.', {
      phase: 'composition',
      cause: 'composition-failed',
    });
  }
  const homeAfter = homePatchStat(homePatchPath);
  if (
    homeBefore.present !== homeAfter.present
    || (homeBefore.present && (!homeAfter.usable || homeAfter.size !== homeBefore.size || homeAfter.mtimeMs !== homeBefore.mtimeMs))
  ) {
    return refusal('PATCH_UNREADABLE', 'The home patch layer changed during the read.', { layer: 'home', cause: 'home-changed-during-read' });
  }

  // 11. Incremental attribution prefixes plus the authoritative full
  // composition; the two must agree on the llm projection (structured
  // semantics throughout — never YAML text equality). Bundle layers compose
  // one at a time so the exact supplying layer is attributed, never guessed.
  const prefixes = [];
  {
    let acc = [];
    for (const layer of initial.layers) {
      acc = [...acc, ...layer.patches];
      prefixes.push({ kind: 'bundle', source: layer.packageName, rows: [...acc] });
    }
  }
  const userIdx = prefixes.length;
  prefixes.push({ kind: 'user', rows: [...baseRows, ...dataParse.rows] });
  if (homeRows !== null) prefixes.push({ kind: 'home', source: homePatchPath, rows: [...baseRows, ...dataParse.rows, ...homeRows] });
  overlayRows.forEach((rows, i) => {
    prefixes.push({ kind: 'overlay', source: overlaySources[i], rows: [...baseRows, ...dataParse.rows, ...(homeRows ?? []), ...overlayRows.slice(0, i + 1).flat()] });
  });
  const prefixConfigs = [];
  try {
    for (const prefix of prefixes) {
      const composed = composeEntries([prefix.rows], () => {});
      prefixConfigs.push(rowConfig(findLlmRow(composed)));
    }
  } catch {
    return refusal('PATCH_PARSE_ERROR', 'The effective composition cannot be established.', {
      phase: 'composition',
      cause: 'composition-failed',
    });
  }
  let effectiveConfig;
  try {
    const composedFull = composeEntries([patchesFull], () => {});
    effectiveConfig = rowConfig(findLlmRow(composedFull));
  } catch {
    return refusal('PATCH_PARSE_ERROR', 'The effective composition cannot be established.', {
      phase: 'composition',
      cause: 'composition-failed',
    });
  }
  if (!isDeepStrictEqual(prefixConfigs[prefixConfigs.length - 1], effectiveConfig)) {
    return refusal('PATCH_PARSE_ERROR', 'The effective composition cannot be established.', {
      phase: 'composition',
      cause: 'composition-divergence',
    });
  }

  // 12. Addressability: a stored configuration the user layer never applied
  // (no base row, name mismatch) is warned, never absorbed silently.
  if (storedConfig !== undefined && !isDeepStrictEqual(prefixConfigs[userIdx], storedConfig)) {
    warnings.push('ADDRESSABILITY_UNVERIFIED');
  }

  // 13. Outer-layer-only definitions are not profile-owned (S1 mirrors this
  // at admission for the home case; the reader establishes it generally).
  const suppliedBy = [];
  // P2-3: layer 0 is compared against no config, not against itself, so a
  // first non-user layer that supplies the effective config is attributed.
  let previous = undefined;
  const layerOf = (at) => {
    if (prefixes[at].kind === 'user') return null;
    return { layer: prefixes[at].kind, source: prefixes[at].source ?? prefixes[at].kind };
  };
  for (let at = 0; at < prefixes.length; at++) {
    if (at > 0 || prefixes[at].kind !== 'user') {
      if (!isDeepStrictEqual(prefixConfigs[at], previous)) {
        const entry = layerOf(at);
        if (entry !== null) suppliedBy.push(entry);
      }
    }
    previous = prefixConfigs[at];
  }
  if (storedConfig === undefined && effectiveConfig !== undefined) {
    const effectiveFrom = suppliedBy.length > 0 ? suppliedBy[suppliedBy.length - 1] : null;
    return refusal('NOT_PROFILE_OWNED', 'The only llm-pi-ai definitions come from outside the profile user patch.', {
      source: effectiveFrom === null ? 'unknown' : effectiveFrom.layer,
      suppliers: [...suppliedBy],
      effectiveFrom,
    });
  }
  if (storedRow === null) {
    return refusal('PLUGIN_ENTRY_MISSING', 'No llm-pi-ai entry exists in the profile patch.', 'entry-missing');
  }

  // 14. Effective shape validation, then the managed comparison.
  if (effectiveConfig !== undefined) {
    const effectiveCheck = checkProviderShapes(effectiveConfig, 'effective');
    if (!effectiveCheck.ok) return effectiveCheck;
  }
  const storedManaged = projectManaged(storedConfig);
  const effectiveManaged = projectManaged(effectiveConfig);
  const managedRoutes = MANAGED_ROUTE_KEYS.filter((route) => !managedSlotEqual(storedManaged[route], effectiveManaged[route]));
  const effectiveDigest = sha256HexBytes(Buffer.from(canonicalJson(effectiveConfig), 'utf8'));

  if (managedRoutes.length > 0) {
    return refusal('OVERRIDDEN', 'A later declared layer replaces the managed configuration.', {
      patchDigest,
      effectiveDigest,
      overriddenBy: suppliedBy,
      managedRoutes,
      ...(warnings.length > 0 ? { warnings: [...warnings] } : {}),
    });
  }

  const status = isDeepStrictEqual(storedConfig, effectiveConfig) ? 'MATCHED' : 'EFFECTIVE_DIFFERS_FROM_STORED';
  return {
    ok: true,
    status,
    target,
    patchBytes,
    patchDigest,
    documentModel: freezeDeep({ root: 'sequence', size: documentRows.length, rows: documentRows }),
    llmEntryIndex,
    storedConfig: storedConfig === undefined ? undefined : freezeDeep(structuredClone(storedConfig)),
    effectiveConfig: effectiveConfig === undefined ? undefined : freezeDeep(structuredClone(effectiveConfig)),
    effectiveDigest,
    overriddenBy: suppliedBy,
    warnings,
    composition: {
      anchorKind: resolved.anchor.kind,
      scopeDir: resolved.anchor.scopeDir,
      installAnchor: resolved.anchor.installAnchor,
      versions: { ...resolved.anchor.versions },
    },
  };
}
