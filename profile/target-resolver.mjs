// OCMS-S S1 — Profile target admission (P1-A §5 S1).
//
// Read-only foundation for the standalone profile-aware adapter
// (Architecture C). Resolves an explicitly selected DSH profile to a stable,
// read-only bound target identity suitable for later Preview binding, or a
// stable typed refusal. NEVER writes, creates, or mutates profile targets.
// No planning, no synchronization, no transaction, no Preview slot, no Apply.
//
// Authorities: SPEC_DSH_PROFILE_AWARE_SYNC.md §§4, 6.3, 8.1–8.4, 8.7, 11.6,
// 12; P1_IMPLEMENTATION_READINESS.md §§3–5 (S1). On any genuine normative
// conflict the frozen P0-R2 specification governs (none known; see notes).
//
// Allowed imports (P0-R2 §6.3 file-utility posture, S1-narrow): node builtins
// plus the already-pinned `yaml` package for the structural entry scan. S1
// deliberately imports NO @deepseek-ai package: dependency admission is done
// by read-only manifest inspection (the narrowest seam). The allowlisted
// runtime symbols (withFileLock/writeFileAtomic, composition readers,
// entryListSchema) are first imported in later slices (S2/S4); importing them
// here would widen the seam for no S1 purpose.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { parseDocument } from 'yaml';

// Anchor a row name beside its patch file, mirroring the composition
// pipeline's documented layer admission: absolute and ./ ../-relative names
// become file URLs so rows from one file address identically; every other
// name passes through untouched. Pure path logic; merge behavior stays
// DSH-owned. Shared by S1 binding identity and S2 composition so the two
// never disagree about a row's address.
export function anchorNameBesideFile(name, besideFile) {
  if (typeof name !== 'string' || name.length === 0) return name;
  if (!(path.isAbsolute(name) || name.startsWith('./') || name.startsWith('../'))) return name;
  const base = path.dirname(path.resolve(besideFile));
  return pathToFileURL(path.resolve(base, name)).href;
}

// Pinned dependency versions, as EXACT-MEMBERSHIP SETS: one set per checked
// package, consulted by exact string equality through Set#has. No ranges, no
// prefix or semver matching, no coercion, no wildcard entry. This object is
// the single shared version gate: profile/commit.mjs and
// profile/config-reader.mjs read these same sets, so the three paths can never
// drift apart.
//
// v1.4.7-rc6 §5(a): cordis-plugin-include is admitted at exactly two
// enumerated strings, 1.0.10-alpha.1 (the verified tree) and 1.0.10-alpha.2
// (the tree every new install resolves; metadata-only release, see contract
// §3). Every other version of that package — and every other checked package —
// still refuses INCOMPATIBLE_DSH. The checked package set is unchanged: dsh,
// dsh-atomic-write, dsh-app-boot and cordis-plugin-include only.
export const EXPECTED_VERSIONS = {
  dsh: new Set(['0.2.1-alpha.2']),
  'dsh-atomic-write': new Set(['0.2.1-alpha.2']),
  'dsh-app-boot': new Set(['0.2.1-alpha.2']),
  'cordis-plugin-include': new Set(['1.0.10-alpha.1', '1.0.10-alpha.2']),
};

// Refusal wording for a version outside a package's admitted set. The OBSERVED
// version is always named by the caller; this only renders the admitted set.
function admittedVersionsText(pkg) {
  return [...EXPECTED_VERSIONS[pkg]].join(' or ');
}

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
  'SCRATCH_MODE_PRODUCTION_REFUSED',
  'INCOMPATIBLE_DSH',
];

const UTILITY_PACKAGES = ['dsh-atomic-write', 'dsh-app-boot', 'cordis-plugin-include'];

// DSH name grammar (app-boot resolveProfileDir): reject empty, separators,
// `.`, `..`, `node_modules`. The additions below (length, charset,
// leading-dash, trailing dot/space, reserved device names, non-ASCII) are
// documented fail-closed wrapper narrowings, permitted by P0-R2 §8.1.
const MAX_NAME_LENGTH = 128;
const NAME_CHARSET = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const RESERVED_DEVICE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

function refusal(code, message, detail) {
  const out = { ok: false, code, message };
  if (detail !== undefined) out.detail = detail;
  return out;
}

export function validateProfileName(name) {
  if (typeof name !== 'string' || name.length === 0) {
    return refusal('INVALID_PROFILE_NAME', 'A profile name must be supplied explicitly; no default profile exists.', 'profile-name-required');
  }
  if (
    name.length > MAX_NAME_LENGTH ||
    name.includes('/') ||
    name.includes('\\') ||
    name.includes('\0') ||
    name === '.' ||
    name === '..' ||
    name.toLowerCase() === 'node_modules' ||
    !NAME_CHARSET.test(name) ||
    name.startsWith('-') ||
    name.endsWith('.') ||
    name.endsWith(' ') ||
    RESERVED_DEVICE.test(name.replace(/\.[^.]*$/, ''))
  ) {
    return refusal('INVALID_PROFILE_NAME', `Profile name ${JSON.stringify(name)} is not admissible.`, 'profile-name-grammar');
  }
  return { ok: true, name };
}

// Pure classification: PRODUCTION iff the bound target's real path lies under
// the real DSH home. No flag, mode, name, or history influences it (R4). Both
// arguments must be absolute paths; comparison is case-insensitive on win32.
export function classifyTarget(profileDirReal, dshHomeReal) {
  const norm = (p) => {
    let r = path.resolve(p);
    if (process.platform === 'win32') r = r.toLowerCase();
    return r;
  };
  const dir = norm(profileDirReal);
  const home = norm(dshHomeReal);
  const rel = path.relative(home, dir);
  if (rel === '' || rel === '.' || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) return 'SCRATCH';
  return 'PRODUCTION';
}

function isPlainObject(v) {
  if (v === null || typeof v !== 'object') return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

// JSON-like validity for the opaque identity fields: null, strings, finite
// numbers, booleans, and dense acyclic plain objects/arrays thereof.
// Rejected (fail closed, never throwing): functions, symbols, bigints,
// undefined, NaN/non-finite numbers, sparse arrays (holes), class instances
// (incl. Dates), and cyclic structures. Validity is always established
// BEFORE any reference-identity shortcut, so shared references — including
// the same malformed reference on both sides — can never bypass it.
function isJsonLike(v, seen = new Set()) {
  if (v === null) return true;
  const t = typeof v;
  if (t === 'string' || t === 'boolean') return true;
  if (t === 'number') return Number.isFinite(v);
  if (t !== 'object') return false;
  if (seen.has(v)) return false;
  const proto = Object.getPrototypeOf(v);
  if (!Array.isArray(v) && proto !== Object.prototype && proto !== null) return false;
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) {
      if (!(i in v)) return false;
    }
  }
  seen.add(v);
  try {
    if (Array.isArray(v)) return v.every((item) => isJsonLike(item, seen));
    return Object.keys(v).every((k) => isJsonLike(v[k], seen));
  } finally {
    seen.delete(v);
  }
}

// Deterministic structured VALUE equality for the opaque identity fields.
// Validity first (isJsonLike on both sides — rejects functions, Dates, class
// instances, malformed shapes, and cyclic graphs without throwing); then
// order-sensitive array and key-exact object comparison on the validated,
// hence acyclic, values. Reference identity alone never suffices.
function structuredEqual(a, b) {
  if (!isJsonLike(a) || !isJsonLike(b)) return false;
  if (a === null || b === null) return a === b;
  const t = typeof a;
  if (t === 'string' || t === 'number' || t === 'boolean') return a === b;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, i) => structuredEqual(item, b[i]));
  }
  if (Array.isArray(a) || Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => Object.hasOwn(b, k) && structuredEqual(a[k], b[k]));
}

// Overlay-list shape: a dense array of strings. Shape, not grammar — S5 owns
// overlay interpretation; S1 only fixes the comparison domain (ordering is
// significant because overlay application order matters).
function isOverlayList(v) {
  if (!Array.isArray(v)) return false;
  for (let i = 0; i < v.length; i++) {
    if (!(i in v)) return false;
  }
  return v.every((item) => typeof item === 'string');
}

// Safe snapshot of caller-supplied opaque identity inputs at bind time: plain
// containers are deep-cloned (memoized, so shared/cyclic graphs terminate)
// so later caller mutation cannot alter the bound identity. Non-plain leaves
// (functions, Dates, class instances) are kept by reference — comparisons
// involving them always fail closed, so the reference can never preserve a
// stale identity. No attestation grammar is interpreted (S5 concern).
function snapshotValue(v, seen = new Map()) {
  if (v === null || typeof v !== 'object') return v;
  if (seen.has(v)) return seen.get(v);
  if (Array.isArray(v)) {
    // Preserve holes exactly: a sparse input snapshots sparse (never
    // laundered into dense), so malformed shapes stay malformed at compare.
    const out = new Array(v.length);
    seen.set(v, out);
    for (let i = 0; i < v.length; i++) {
      if (i in v) out[i] = snapshotValue(v[i], seen);
    }
    return out;
  }
  const proto = Object.getPrototypeOf(v);
  if (proto !== Object.prototype && proto !== null) return v;
  const out = {};
  seen.set(v, out);
  for (const k of Object.keys(v)) out[k] = snapshotValue(v[k], seen);
  return out;
}

// Complete retained-Preview identity comparison (P0-R2 §8.3): ALL seven
// bound fields plus the patch digest and the classification-home anchor.
// Missing, malformed, or non-comparable inputs fail closed (false), never
// compare equal accidentally. No attestation interpretation (S5 concern).
const IDENTITY_SCALARS = ['profileName', 'pluginEntryName', 'classification', 'patchDigest'];

export function sameTarget(a, b) {
  if (!isPlainObject(a) || !isPlainObject(b)) return false;
  for (const k of [...IDENTITY_SCALARS, 'profileDirReal', 'patchPathReal', 'dshHomeReal', 'declaredOverlays', 'liveAttestation']) {
    if (!Object.hasOwn(a, k) || !Object.hasOwn(b, k)) return false;
  }
  for (const k of IDENTITY_SCALARS) {
    if (typeof a[k] !== 'string' || typeof b[k] !== 'string' || a[k] !== b[k]) return false;
  }
  const eqPath = (x, y) => {
    if (typeof x !== 'string' || typeof y !== 'string') return false;
    return process.platform === 'win32' ? x.toLowerCase() === y.toLowerCase() : x === y;
  };
  if (!eqPath(a.profileDirReal, b.profileDirReal)) return false;
  if (!eqPath(a.patchPathReal, b.patchPathReal)) return false;
  if (!eqPath(a.dshHomeReal, b.dshHomeReal)) return false;
  if (!isOverlayList(a.declaredOverlays) || !isOverlayList(b.declaredOverlays)) return false;
  if (!structuredEqual(a.declaredOverlays, b.declaredOverlays)) return false;
  if (!structuredEqual(a.liveAttestation, b.liveAttestation)) return false;
  return true;
}

function realpathOrNull(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    return null;
  }
}

function isWithinDir(candidateReal, dirReal) {
  const norm = (p) => (process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p));
  const rel = path.relative(norm(dirReal), norm(candidateReal));
  return rel !== '' && rel !== '.' && rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}

// Locate the dsh executable via PATH lookup (SPEC.md §DX-2 posture: PATH
// lookup exactly, no bunx/npx fallback). Returns an absolute path or null.
export function findDshExecutable({ pathEnv = process.env.PATH ?? '' } = {}) {
  const bins = process.platform === 'win32' ? ['dsh', 'dsh.cmd', 'dsh.exe', 'dsh.ps1'] : ['dsh'];
  for (const dir of String(pathEnv).split(path.delimiter)) {
    if (!dir) continue;
    for (const bin of bins) {
      const candidate = path.join(dir, bin);
      try {
        const st = fs.statSync(candidate);
        if (st.isFile()) return fs.realpathSync(candidate);
      } catch {
        // Absent or unreadable entry — continue scanning.
      }
    }
  }
  return null;
}

function readManifestVersion(manifestPath) {
  try {
    const raw = fs.readFileSync(manifestPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.version === 'string') return { ok: true, version: parsed.version };
    return { ok: true, version: null };
  } catch (err) {
    return { ok: false, error: err && err.code ? err.code : String((err && err.message) || err) };
  }
}

// Strategy-A admission over absolute anchors only (P0-R2 §11.6):
// explicit installAnchorDir (scope dir) → target profile node_modules →
// PATH-derived install anchor (top-level scope, then dsh-nested scope).
// First base satisfying ALL THREE utility packages at exact versions wins;
// the dsh baseline version is asserted from the install scope (explicit or
// PATH-derived), never inferred. Never installs, vendors, or substitutes.
export function admitDependencyPackages({ profileDirReal, installAnchorDir = null, pathEnv = process.env.PATH ?? '' } = {}) {
  // Full-scope inspection: EVERY package manifest in the scope is examined so
  // a higher-priority scope can never silently fall through on a concealed
  // defect. Outcomes: 'absent' (no manifest present at all — may fall
  // through), 'valid' (complete pinned combination), 'partial' (some
  // manifests absent, none present-but-wrong — may fall through), 'refuse'
  // (any present version skew or any present-but-unverifiable manifest —
  // MUST refuse before any lower-priority scope is considered, and scopes
  // are never combined).
  const inspectScope = (scopeDir) => {
    const missing = [];
    const skewed = [];
    const malformed = [];
    const found = {};
    let anyPresent = false;
    for (const pkg of UTILITY_PACKAGES) {
      const manifest = path.join(scopeDir, pkg, 'package.json');
      const read = readManifestVersion(manifest);
      if (!read.ok) {
        if (read.error === 'ENOENT') missing.push(pkg);
        else {
          anyPresent = true;
          malformed.push(pkg);
        }
        continue;
      }
      anyPresent = true;
      if (typeof read.version !== 'string') malformed.push(pkg);
      else if (!EXPECTED_VERSIONS[pkg].has(read.version)) skewed.push({ pkg, observed: read.version });
      else found[pkg] = { path: path.join(scopeDir, pkg), version: read.version };
    }
    if (!anyPresent) return { status: 'absent' };
    if (malformed.length > 0) {
      return { status: 'refuse', detail: `unverifiable-manifest: ${malformed.join(', ')}` };
    }
    if (skewed.length > 0) {
      return {
        status: 'refuse',
        detail: skewed.map(({ pkg, observed }) => `version-skew: ${pkg} is ${observed}, expected ${admittedVersionsText(pkg)}`).join('; '),
      };
    }
    if (missing.length > 0) return { status: 'partial', missing };
    return { status: 'valid', found };
  };

  let explicitScope = null;
  if (installAnchorDir !== null && installAnchorDir !== undefined) {
    const real = realpathOrNull(path.resolve(String(installAnchorDir)));
    if (real === null) {
      return refusal('INCOMPATIBLE_DSH', 'The explicit dependency anchor cannot be resolved.', 'explicit-anchor-unresolvable');
    }
    explicitScope = real;
  }

  const exePath = findDshExecutable({ pathEnv });
  let derivedScopes = [];
  if (exePath !== null) {
    const npmRoot = path.dirname(exePath);
    derivedScopes = [
      path.join(npmRoot, 'node_modules', '@deepseek-ai'),
      path.join(npmRoot, 'node_modules', '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai'),
    ];
  }

  // Ambiguity: the explicit anchor and the PATH-derived anchor are two
  // sources for the SAME logical (install) anchor. If both fully satisfy with
  // different real locations the caller must disambiguate. (Profile-scope vs
  // install-scope both satisfying is NOT ambiguous: the specified order wins.)
  if (explicitScope !== null && derivedScopes.length > 0) {
    const explicitValid = inspectScope(explicitScope).status === 'valid';
    for (const derived of derivedScopes) {
      const derivedValid = inspectScope(derived).status === 'valid';
      if (explicitValid && derivedValid) {
        const norm = (p) => (process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p));
        if (norm(explicitScope) !== norm(realpathOrNull(derived) ?? derived)) {
          return refusal(
            'INCOMPATIBLE_DSH',
            'Two fully-satisfying install anchors disagree; pass exactly one.',
            'ambiguous-anchor: explicit install anchor and PATH-derived install anchor resolve to different locations',
          );
        }
      }
    }
  }

  const candidates = [];
  if (explicitScope !== null) candidates.push({ kind: 'explicit', scope: explicitScope, terminal: true });
  if (typeof profileDirReal === 'string') {
    candidates.push({ kind: 'profile', scope: path.join(profileDirReal, 'node_modules', '@deepseek-ai'), terminal: false });
  }
  derivedScopes.forEach((scope, i) => candidates.push({ kind: i === 0 ? 'install' : 'install-nested', scope, terminal: false }));

  let winner = null;
  for (const c of candidates) {
    const insp = inspectScope(c.scope);
    if (insp.status === 'valid') {
      winner = { kind: c.kind, scope: c.scope, found: insp.found };
      break;
    }
    // A present defect (skew or unverifiable manifest) refuses immediately:
    // a higher-priority scope is never bypassed by a lower-priority one, and
    // package sets are never combined across scopes (winner-take-all below).
    if (insp.status === 'refuse') {
      return refusal(
        'INCOMPATIBLE_DSH',
        c.terminal
          ? 'The explicit dependency anchor does not satisfy the pinned combination.'
          : 'A higher-priority dependency scope carries an incompatible package; refusing rather than substituting.',
        insp.detail,
      );
    }
    // 'absent' and 'partial' scopes fall through to the next anchor — except
    // an explicit anchor, which is caller-pinned and therefore terminal.
    if (c.terminal) {
      return refusal(
        'INCOMPATIBLE_DSH',
        'The explicit dependency anchor does not satisfy the pinned combination.',
        insp.status === 'partial' ? `package-missing: ${insp.missing.join(', ')}` : 'package-missing',
      );
    }
  }
  if (winner === null) {
    return refusal(
      'INCOMPATIBLE_DSH',
      'No absolute anchor provides the pinned DSH utility combination.',
      derivedScopes.length === 0 && explicitScope === null ? 'anchor-unresolved' : 'package-missing',
    );
  }

  // dsh baseline from the install scope (explicit preferred, else derived).
  const installScope = explicitScope !== null
    ? explicitScope
    : derivedScopes.map((s) => realpathOrNull(s) ?? s).find((s) => {
      const read = readManifestVersion(path.join(s, 'dsh', 'package.json'));
      return read.ok;
    });
  const dshManifest = installScope !== undefined && installScope !== null
    ? path.join(installScope, 'dsh', 'package.json')
    : null;
  const dshRead = dshManifest !== null ? readManifestVersion(dshManifest) : { ok: false, error: 'anchor-unresolved' };
  if (!dshRead.ok || !EXPECTED_VERSIONS.dsh.has(dshRead.version)) {
    return refusal(
      'INCOMPATIBLE_DSH',
      'The installed dsh baseline version cannot be established exactly.',
      !dshRead.ok ? 'dsh-version-unverifiable' : `version-skew: dsh is ${dshRead.version}, expected ${admittedVersionsText('dsh')}`,
    );
  }

  const packages = {};
  for (const pkg of UTILITY_PACKAGES) {
    packages[pkg] = { path: winner.found[pkg].path, version: winner.found[pkg].version };
  }
  return {
    ok: true,
    evidence: {
      anchorKind: winner.kind,
      anchorDir: winner.scope,
      packages,
      versions: Object.fromEntries(UTILITY_PACKAGES.map((p) => [p, packages[p].version])),
      dsh: { path: path.join(installScope, 'dsh'), version: dshRead.version },
      dshVersion: dshRead.version,
      exePath,
    },
  };
}

// Narrow structural scan of ONE patch file: parse (with the editor's !!js
// tolerance posture — unknown tags must not abort the scan at this layer;
// hard parse errors refuse), assert a sequence root, and count ID-matching
// rows. Returns row descriptors; deeper composition/provider validation is
// S2's concern (boundary documented in P1-A §5 S1).
function scanPatchFile(patchPath) {
  let bytes;
  try {
    bytes = fs.readFileSync(patchPath);
  } catch (err) {
    return refusal('PATCH_UNREADABLE', 'The profile patch file cannot be read.', err && err.code ? err.code : String((err && err.message) || err));
  }
  let doc;
  try {
    doc = parseDocument(bytes.toString('utf8'), { uniqueKeys: false });
  } catch (err) {
    return refusal('PATCH_PARSE_ERROR', 'The profile patch file cannot be parsed.', String((err && err.message) || err));
  }
  if (!doc || (doc.errors && doc.errors.length > 0)) {
    return refusal('PATCH_PARSE_ERROR', 'The profile patch file cannot be parsed.', doc && doc.errors ? String(doc.errors[0].message || doc.errors[0]) : 'parse-error');
  }
  const root = doc.toJS({ mapAsMap: false });
  if (!Array.isArray(root)) {
    return refusal('PATCH_ROOT_NOT_SEQUENCE', 'The profile patch root must be a sequence.', typeof root);
  }
  const candidates = [];
  let insertCollision = false;
  for (const item of root) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    if (item.id !== 'llm-pi-ai') continue;
    if (Object.hasOwn(item, 'insert')) {
      insertCollision = true;
      continue;
    }
    candidates.push(item);
  }
  return {
    ok: true, bytes, candidates, insertCollision,
    digest: crypto.createHash('sha256').update(bytes).digest('hex'),
  };
}

function defaultDshHome() {
  if (process.env.DSH_HOME) return process.env.DSH_HOME;
  return path.join(os.homedir(), '.dsh');
}

// Main S1 entry: explicit profile selection → path admission → dependency
// admission → classification → narrow entry-identity admission. Read-only:
// the only filesystem operations are reads, stats, and realpath.
export function resolveProfileTarget(options = {}) {
  const {
    profileName,
    dshHome,
    scratchMode = false,
    declaredOverlays = [],
    liveAttestation = null,
    installAnchorDir = null,
    pathEnv = process.env.PATH ?? '',
  } = options ?? {};

  // 1. Explicit profile selection (no default, no fallback).
  const nameCheck = validateProfileName(profileName);
  if (!nameCheck.ok) return nameCheck;

  // 2. DSH home resolution (explicit in tests; env/default otherwise).
  const homeInput = dshHome !== undefined && dshHome !== null ? String(dshHome) : defaultDshHome();
  const homeReal = realpathOrNull(path.resolve(homeInput));
  if (homeReal === null) {
    return refusal('PROFILE_NOT_INITIALIZED', 'The DSH home directory cannot be resolved.', 'dsh-home-missing');
  }

  // 3. Profile directory containment (real paths; symlink/junction escapes refuse).
  const profileDirReal = realpathOrNull(path.resolve(homeReal, 'profiles', nameCheck.name));
  if (profileDirReal === null) {
    return refusal('PROFILE_NOT_INITIALIZED', `Profile ${JSON.stringify(nameCheck.name)} is not initialized (no profile directory).`, 'profile-dir-missing');
  }
  if (!isWithinDir(profileDirReal, homeReal)) {
    return refusal('SYMLINK_ESCAPE', 'The resolved profile directory escapes the DSH home.', 'profile-dir-escape');
  }

  // 4. Initialized-profile admission: an existing package.json that parses to
  // an object. Never created (no write API is even imported).
  let manifestRaw;
  try {
    manifestRaw = fs.readFileSync(path.join(profileDirReal, 'package.json'), 'utf8');
  } catch (err) {
    return refusal('PROFILE_NOT_INITIALIZED', `Profile ${JSON.stringify(nameCheck.name)} is not initialized (no package.json).`, err && err.code ? err.code : 'manifest-missing');
  }
  try {
    const manifest = JSON.parse(manifestRaw);
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
      return refusal('PROFILE_NOT_INITIALIZED', 'The profile manifest is not an initialized profile manifest.', 'manifest-malformed');
    }
  } catch {
    return refusal('PROFILE_NOT_INITIALIZED', 'The profile manifest cannot be parsed.', 'manifest-unparseable');
  }

  // 5. Strategy-A dependency admission (manifest inspection only; no imports).
  const deps = admitDependencyPackages({ profileDirReal, installAnchorDir, pathEnv });
  if (!deps.ok) return deps;

  // 6. Classification (real-path containment ONLY, R4) + scratch restriction.
  // The classification anchor is ALWAYS the true DSH home (the DSH_HOME env
  // override or the OS home default, resolved at bind time) — never the
  // caller-supplied resolution home. A harness resolving fixtures inside an
  // injected home therefore classifies them SCRATCH (fail-safe direction);
  // only a target genuinely under the true home classifies PRODUCTION. No
  // flag, mode, name, or history influences the derivation; --scratch style
  // restriction is enforced here, never as reclassification.
  const truthHomeReal = realpathOrNull(path.resolve(defaultDshHome())) ?? homeReal;
  const classification = classifyTarget(profileDirReal, truthHomeReal);
  if (scratchMode === true && classification === 'PRODUCTION') {
    return refusal(
      'SCRATCH_MODE_PRODUCTION_REFUSED',
      'Scratch mode narrows admission: production targets are refused, never reclassified.',
      'scratch-mode-production-refused',
    );
  }

  // 7. Patch path admission. The patch path is derived, never caller-supplied;
  // a patch symlink (or any reparse) resolving outside the profile refuses.
  const patchPath = path.join(profileDirReal, 'cordis.patch.yml');
  let patchLstat = null;
  try {
    patchLstat = fs.lstatSync(patchPath);
  } catch (err) {
    return refusal('PATCH_UNREADABLE', 'The profile patch file is absent.', err && err.code ? err.code : 'patch-missing');
  }
  if (!patchLstat.isFile() && !patchLstat.isSymbolicLink()) {
    return refusal('PATCH_UNREADABLE', 'The profile patch path is not a regular file.', 'patch-not-regular-file');
  }
  const patchPathReal = realpathOrNull(patchPath);
  if (patchPathReal === null) {
    return refusal('SYMLINK_ESCAPE', 'The profile patch path cannot be resolved unambiguously.', 'patch-realpath-failed');
  }
  const normPath = (p) => (process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p));
  if (normPath(path.dirname(patchPathReal)) !== normPath(profileDirReal)) {
    return refusal('SYMLINK_ESCAPE', 'The profile patch file escapes the profile directory.', 'patch-escape');
  }

  // 8. Narrow identity scan of the user patch (+ home-patch row counting for
  // the user+home duplicate rule). Bundle-layer enumeration, effective
  // composition, and OVERRIDDEN attribution are S2's concern.
  const scan = scanPatchFile(patchPathReal);
  if (!scan.ok) return scan;

  let homeCandidates = 0;
  let homeHasConfig = false;
  const homePatchPath = path.join(homeReal, 'cordis.patch.yml');
  if (fs.existsSync(homePatchPath)) {
    const homeScan = scanPatchFile(homePatchPath);
    if (homeScan.ok) {
      homeCandidates = homeScan.candidates.length;
      homeHasConfig = homeScan.candidates.some((c) => Object.hasOwn(c, 'config'));
    }
    // An unreadable/unparseable home patch does not fail user-patch identity
    // admission here; S2 composition surfaces it. (Documented boundary.)
  }

  if (scan.candidates.length === 0) {
    if (homeHasConfig) {
      return refusal('NOT_PROFILE_OWNED', 'The only llm-pi-ai definitions come from outside the profile user patch; OCMS-S writes only the user layer.', 'home-layer-only');
    }
    return refusal('PLUGIN_ENTRY_MISSING', 'No llm-pi-ai entry exists in the profile patch; row creation is profile management, out of scope.', 'entry-missing');
  }
  if (scan.candidates.length + homeCandidates > 1) {
    return refusal(
      'PLUGIN_ENTRY_DUPLICATE',
      'More than one llm-pi-ai candidate exists; refusing rather than picking first/last.',
      homeCandidates > 0 ? 'user-home-duplicate' : 'same-file-duplicate',
    );
  }

  // 9. Narrow ownership admission on the single user-layer row.
  const entry = scan.candidates[0];
  if (Object.hasOwn(entry, 'config') && (entry.config === null || typeof entry.config !== 'object' || Array.isArray(entry.config))) {
    return refusal('NOT_PROFILE_OWNED', 'The user-layer llm-pi-ai entry cannot carry provider definitions.', 'user-config-not-mapping');
  }
  // Absent `config` = dormant-but-owned user row (bundle mounts dormant with
  // no config; P0-R2 §2.4/§4 B). Admitted; S2 validates provider shapes.

  const warnings = [];
  if (scan.insertCollision) warnings.push('INSERT_ROW_SAME_ID');

  return {
    ok: true,
    target: {
      profileName: nameCheck.name,
      profileDirReal,
      patchPathReal,
      pluginEntryName: anchorNameBesideFile(typeof entry.name === 'string' && entry.name.length > 0 ? entry.name : 'llm-pi-ai', patchPathReal),
      classification,
      dshHomeReal: truthHomeReal, // classification authority anchor; part of the bound identity.
      declaredOverlays: snapshotValue(declaredOverlays), // bound snapshot; later caller mutation cannot alter it. Opaque in S1; interpretation belongs to S5.
      liveAttestation: snapshotValue(liveAttestation), // bound snapshot; see above.
      patchDigest: scan.digest,
      patchBytesLength: scan.bytes.length,
      warnings,
      dependencyEvidence: deps.evidence,
    },
  };
}
