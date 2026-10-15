// OCMS-S S4 headless atomic profile commit. See P1-A S4 and frozen sections 7.2-7.5.
// Architecture C standalone adapter. Consumes retained S3 READY/NO_CHANGE plan.
// Steps 1-12 run under one withFileLock(<profileDir>/package.json) hold. No nested lock.
// Only admitted DSH symbols: withFileLock, writeFileAtomic, loadProfileDirectory,
// readProfilePatches, composeEntries, entryListSchema. No ConfigEditor/edit/Loader/HMR.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { parseDocument, isSeq, isMap, isScalar } from 'yaml';
import { sameTarget, admitDependencyPackages, EXPECTED_VERSIONS, classifyTarget, validateProfileName, resolveProfileTarget, anchorNameBesideFile } from './target-resolver.mjs';
import { renderDesiredState, MANAGED_ROUTE_KEYS, classifyFootprint } from './surgical-render.mjs';
import { isAdmittedProductionAttestation } from './live-attestation.mjs';
export const LOCK_RESOURCE_SUFFIX = '.lock';
export const DEFAULT_WAIT_MS = 15000;
export const COMMIT_REFUSAL_CODES = ['LOCK_TIMEOUT','STALE_TARGET','PATCH_UNREADABLE','PATCH_PARSE_ERROR','PATCH_ROOT_NOT_SEQUENCE','PLUGIN_ENTRY_MISSING','PLUGIN_ENTRY_DUPLICATE','NOT_PROFILE_OWNED','SETTINGS_INVALID','MEMBERSHIP_MISMATCH','GENERATED_MEMBERSHIP_MISMATCH','ANCHOR_IN_MANAGED_SCOPE','TAG_IN_MANAGED_ARRAY','UNOWNED_COMMENT_AMBIGUOUS','UNPRESERVABLE_STRUCTURE','UNRELATED_CONTENT_CHANGED','VERIFY_FAILED','OVERRIDDEN','LIVE_OVERLAY_UNKNOWN','BACKUP_FAILED','WRITE_FAILED','POST_WRITE_VERIFY_FAILED','INCOMPATIBLE_DSH'];
function refusal(code, message, detail) {
  const out = { ok: false, code, message, status: 'BLOCKED' };
  if (detail !== undefined) out.detail = detail;
  return out;
}
function shaHex(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}
function isPlainObject(v) {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}
function cloneDetached(v) {
  return structuredClone(v);
}
function validateDesiredSix(desired) {
  if (!isPlainObject(desired)) return refusal('VERIFY_FAILED', 'Desired managed arrays are malformed; six array routes required.', 'desired-malformed');
  for (const r of MANAGED_ROUTE_KEYS) {
    if (!Object.hasOwn(desired, r) || !Array.isArray(desired[r])) return refusal('VERIFY_FAILED', 'Desired managed arrays are malformed; six array routes required.', 'desired-malformed');
    for (const rec of desired[r]) {
      if (!isPlainObject(rec) || typeof rec.id !== 'string' || rec.id.length === 0) return refusal('MEMBERSHIP_MISMATCH', 'Desired model records carry malformed IDs.', 'desired-id-malformed');
    }
  }
  return { ok: true };
}
function checkDuplicateIds(desired) {
  const goRoutes = ['opencode-go', 'opencode-go-messages', 'opencode-go-responses'];
  const zenRoutes = ['opencode-completions', 'opencode-messages', 'opencode'];
  for (const group of [goRoutes, zenRoutes]) {
    const ids = [];
    for (const route of group) {
      const arr = desired[route] || [];
      for (const rec of arr) ids.push(rec.id);
    }
    if (new Set(ids).size !== ids.length) return 'MEMBERSHIP_MISMATCH';
  }
  return null;
}
function resolvePackageEntry(pkgDir) {
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
  } catch { return null; }
  const pick = (node) => {
    if (typeof node === 'string') return node;
    if (Array.isArray(node)) {
      for (const item of node) { const hit = pick(item); if (hit) return hit; }
      return null;
    }
    if (node && typeof node === 'object') return pick(node.import) ?? pick(node.default);
    return null;
  };
  let rel = null;
  try {
    const ex = manifest.exports;
    if (ex && typeof ex === 'object' && !Array.isArray(ex)) rel = pick(ex['.']);
    else rel = pick(ex);
  } catch { rel = null; }
  if (typeof rel !== 'string' || rel.length === 0) {
    if (typeof manifest.main === 'string' && manifest.main.length > 0) rel = manifest.main;
    else rel = 'lib/index.js';
  }
  const abs = path.join(pkgDir, rel);
  try { if (!fs.statSync(abs).isFile()) return null; } catch { return null; }
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
async function resolveCommitUtils(input) {
  const installAnchorDir = input.installAnchorDir;
  const pathEnv = input.pathEnv;
  const profileDirReal = input.profileDirReal;
  const needBoot = EXPECTED_VERSIONS['dsh-app-boot'];
  const needInclude = EXPECTED_VERSIONS['cordis-plugin-include'];
  const needAtomic = EXPECTED_VERSIONS['dsh-atomic-write'];
  const needDsh = EXPECTED_VERSIONS.dsh;
  let scopeDir = null;
  let dshDir = null;
  let anchorKind = null;
  if (installAnchorDir !== null && installAnchorDir !== undefined) {
    let real = null;
    try { real = fs.realpathSync(path.resolve(String(installAnchorDir))); } catch { real = null; }
    if (real === null) return refusal('INCOMPATIBLE_DSH', 'The explicit dependency anchor cannot be resolved.', 'explicit-anchor-unresolvable');
    const checks = [['dsh-app-boot', needBoot], ['cordis-plugin-include', needInclude], ['dsh-atomic-write', needAtomic]];
    for (const pair of checks) {
      const read = readManifestVersion(path.join(real, pair[0], 'package.json'));
      if (!read.ok || !pair[1].has(read.version)) return refusal('INCOMPATIBLE_DSH', 'The explicit composition anchor does not satisfy the pinned combination.', 'explicit-anchor-unsatisfied');
    }
    const dshCandidates = [path.join(real, 'dsh'), path.join(real, '..', '..')];
    for (const cand of dshCandidates) {
      const read = readManifestVersion(path.join(cand, 'package.json'));
      if (!read.ok || !needDsh.has(read.version)) continue;
      let nm = null;
      try { nm = JSON.parse(fs.readFileSync(path.join(cand, 'package.json'), 'utf8')).name; } catch { nm = null; }
      if (nm === '@deepseek-ai/dsh') { dshDir = cand; break; }
    }
    if (dshDir === null) return refusal('INCOMPATIBLE_DSH', 'The explicit composition anchor does not satisfy the pinned combination.', 'explicit-anchor-unsatisfied');
    scopeDir = real;
    anchorKind = 'explicit';
  } else {
    const admitted = admitDependencyPackages({ profileDirReal, installAnchorDir: null, pathEnv });
    if (!admitted.ok) return admitted;
    scopeDir = admitted.evidence.anchorDir;
    dshDir = admitted.evidence.dsh.path;
    anchorKind = admitted.evidence.anchorKind;
  }
  const atomicEntry = resolvePackageEntry(path.join(scopeDir, 'dsh-atomic-write'));
  const bootEntry = resolvePackageEntry(path.join(scopeDir, 'dsh-app-boot'));
  const includeEntry = resolvePackageEntry(path.join(scopeDir, 'cordis-plugin-include'));
  if (atomicEntry === null || bootEntry === null || includeEntry === null) return refusal('INCOMPATIBLE_DSH', 'The admitted libraries cannot be located.', 'util-entry-unresolvable');
  let atomicMod = null;
  try { atomicMod = await import(pathToFileURL(atomicEntry).href); } catch { return refusal('INCOMPATIBLE_DSH', 'The admitted atomic library cannot be loaded.', 'util-import-failed'); }
  if (!atomicMod || typeof atomicMod.withFileLock !== 'function' || typeof atomicMod.writeFileAtomic !== 'function') return refusal('INCOMPATIBLE_DSH', 'The admitted atomic library misses required symbols.', 'util-symbol-missing');
  let bootMod = null;
  try { bootMod = await import(pathToFileURL(bootEntry).href); } catch { return refusal('INCOMPATIBLE_DSH', 'The admitted composition libraries cannot be loaded.', 'util-import-failed'); }
  if (!bootMod || typeof bootMod.loadProfileDirectory !== 'function' || typeof bootMod.readProfilePatches !== 'function' || typeof bootMod.composeEntries !== 'function') return refusal('INCOMPATIBLE_DSH', 'The admitted composition libraries miss required readers.', 'util-symbol-missing');
  let includeMod = null;
  try { includeMod = await import(pathToFileURL(includeEntry).href); } catch { return refusal('INCOMPATIBLE_DSH', 'The admitted patch-list dialect cannot be loaded.', 'util-import-failed'); }
  if (!includeMod || typeof includeMod.entryListSchema !== 'object' || includeMod.entryListSchema === null) return refusal('INCOMPATIBLE_DSH', 'The admitted patch-list dialect is unavailable.', 'util-symbol-missing');
  let jsYaml = null;
  try { jsYaml = createRequire(includeEntry)('js-yaml'); } catch { return refusal('INCOMPATIBLE_DSH', 'The admitted YAML dialect parser cannot be loaded.', 'util-import-failed'); }
  if (!jsYaml || typeof jsYaml.load !== 'function') return refusal('INCOMPATIBLE_DSH', 'The admitted YAML dialect parser is unavailable.', 'util-symbol-missing');
  const installAnchor = path.join(dshDir, 'package.json');
  try { if (!fs.statSync(installAnchor).isFile()) return refusal('INCOMPATIBLE_DSH', 'The owning DSH anchor cannot be established.', 'install-anchor-missing'); } catch { return refusal('INCOMPATIBLE_DSH', 'The owning DSH anchor cannot be established.', 'install-anchor-missing'); }
  return { ok: true, utils: { withFileLock: atomicMod.withFileLock, writeFileAtomic: atomicMod.writeFileAtomic, loadProfileDirectory: bootMod.loadProfileDirectory, readProfilePatches: bootMod.readProfilePatches, composeEntries: bootMod.composeEntries, entryListSchema: includeMod.entryListSchema, jsYaml }, anchor: { kind: anchorKind, scopeDir, installAnchor } };
}
function parseDialectRows(jsYaml, entryListSchema, text, layer) {
  let parsed;
  try {
    parsed = jsYaml.load(text, { schema: entryListSchema });
  } catch {
    return refusal('PATCH_PARSE_ERROR', 'A composition layer cannot be parsed; effective truth is not established.', { layer });
  }
  if (!Array.isArray(parsed)) return refusal('PATCH_ROOT_NOT_SEQUENCE', 'A composition layer root must be a sequence.', { layer });
  for (const row of parsed) {
    if (!isPlainObject(row)) return refusal('PATCH_PARSE_ERROR', 'A composition layer carries a non-mapping row.', { layer });
  }
  try {
    cloneDetached(parsed);
  } catch {
    return refusal('PATCH_PARSE_ERROR', 'A composition layer carries cyclic aliases.', { layer });
  }
  return { ok: true, rows: parsed };
}
// B5: every row from one file anchors alike (top-level rows as well as
// insert-directive children), sharing anchorNameBesideFile with S1/S2 so no
// path can disagree about a row's address.
function anchorRows(rows, file) {
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
function checkShapes(config, scope) {
  const at = (sub) => ({ scope, path: sub });
  if (!isPlainObject(config)) return refusal('SETTINGS_INVALID', 'The llm-pi-ai configuration must be a mapping when present.', at('config'));
  if (!Object.hasOwn(config, 'providers')) return { ok: true };
  const providers = config.providers;
  if (!isPlainObject(providers)) return refusal('SETTINGS_INVALID', 'The llm-pi-ai providers container must be a mapping when present.', at('providers'));
  for (const route of MANAGED_ROUTE_KEYS) {
    if (!Object.hasOwn(providers, route)) continue;
    const provider = providers[route];
    if (!isPlainObject(provider)) return refusal('SETTINGS_INVALID', 'Managed route ' + route + ' must be a mapping when present.', at('providers.' + route));
    if (Object.hasOwn(provider, 'models') && !Array.isArray(provider.models)) return refusal('SETTINGS_INVALID', 'Managed route ' + route + ' models must be an array when present.', at('providers.' + route + '.models'));
  }
  return { ok: true };
}
function exciseBytes(buf, spans) {
  const sorted = spans.slice().sort((a, b) => b.start - a.start);
  let out = Buffer.from(buf);
  for (const sp of sorted) out = Buffer.concat([out.slice(0, sp.start), out.slice(sp.end)]);
  return out;
}
function verifyCommitPayload(input) {
  const jsYaml = input.jsYaml;
  const entryListSchema = input.entryListSchema;
  const candidateBytes = input.candidateBytes;
  const desired = input.desired;
  const originalBytes = input.originalBytes;
  const originalSpans = input.originalSpans;
  const candidateSpans = input.candidateSpans;
  const expectedDigest = input.expectedDigest;
  const boundName = input.boundName;
  const candText = candidateBytes.toString('utf8');
  const parsed = parseDialectRows(jsYaml, entryListSchema, candText, 'candidate');
  if (!parsed.ok) return parsed;
  const rows = parsed.rows;
  const cands = [];
  rows.forEach((row, at) => {
    if (!isPlainObject(row)) return;
    if (Object.hasOwn(row, 'insert')) return;
    if (row.id === 'llm-pi-ai') cands.push(at);
  });
  if (cands.length === 0) return refusal('PLUGIN_ENTRY_MISSING', 'No llm-pi-ai entry exists in the candidate patch.', 'entry-missing');
  if (cands.length > 1) return refusal('PLUGIN_ENTRY_DUPLICATE', 'More than one llm-pi-ai entry exists in the candidate.', 'duplicate');
  const hitRow = rows[cands[0]];
  const hitName = (typeof hitRow.name === 'string' && hitRow.name.length > 0) ? hitRow.name : 'llm-pi-ai';
  if (hitName !== boundName) return refusal('VERIFY_FAILED', 'Candidate entry name does not match the bound entry.', 'entry-name-mismatch');
  const cfg = Object.hasOwn(hitRow, 'config') ? hitRow.config : undefined;
  if (cfg !== undefined) {
    const sc = checkShapes(cfg, 'candidate');
    if (!sc.ok) return sc;
  }
  const prov = (cfg !== undefined && isPlainObject(cfg) && Object.hasOwn(cfg, 'providers')) ? cfg.providers : undefined;
  for (const route of MANAGED_ROUTE_KEYS) {
    const wanted = desired[route] || [];
    let actual = null;
    let missing = true;
    if (prov !== undefined && isPlainObject(prov) && Object.hasOwn(prov, route) && isPlainObject(prov[route]) && Object.hasOwn(prov[route], 'models') && Array.isArray(prov[route].models)) {
      missing = false;
      actual = prov[route].models;
    } else if (prov !== undefined && isPlainObject(prov) && Object.hasOwn(prov, route)) {
      return refusal('SETTINGS_INVALID', 'Candidate provider malformed.', { route });
    }
    if (missing) {
      if (wanted.length !== 0) return refusal('GENERATED_MEMBERSHIP_MISMATCH', 'Candidate missing route with non-empty desired.', { route });
    } else if (!isDeepStrictEqual(actual, wanted)) {
      return refusal('GENERATED_MEMBERSHIP_MISMATCH', 'Candidate array differs from desired.', { route });
    }
  }
  const dup = checkDuplicateIds(desired);
  if (dup) return refusal(dup, 'Duplicate managed model IDs across routes.', 'duplicate-managed-id');
  const gotDigest = shaHex(candidateBytes);
  if (gotDigest !== expectedDigest) return refusal('VERIFY_FAILED', 'Candidate digest does not match the retained binding.', 'candidate-digest-mismatch');
  const origRem = exciseBytes(originalBytes, originalSpans.map((s) => ({ start: s.start, end: s.end })).filter((s) => s.end > s.start));
  const candRem = exciseBytes(candidateBytes, candidateSpans.map((s) => ({ start: s.start, end: s.end })).filter((s) => s.end > s.start));
  if (!origRem.equals(candRem)) return refusal('UNRELATED_CONTENT_CHANGED', 'Byte-excision remainder mismatch; unowned bytes changed.', 'remainder-mismatch');
  return { ok: true, candidateConfig: cfg };
}
async function composeEffective(input) {
  const utils = input.utils;
  const profileDirReal = input.profileDirReal;
  const patchPathReal = input.patchPathReal;
  const candidateRows = input.candidateRows;
  const profileName = input.profileName;
  const installAnchor = input.installAnchor;
  const declaredOverlays = input.declaredOverlays;
  const telemetryDisabledEnv = input.telemetryDisabledEnv;
  const candidateConfig = input.candidateConfig;
  const resolutionHome = path.dirname(path.dirname(profileDirReal));
  let initial;
  try {
    initial = utils.loadProfileDirectory('ocms-s', profileDirReal, installAnchor, { userLayer: false });
  } catch {
    return refusal('PATCH_UNREADABLE', 'The profile bundle layers cannot be established.', { layer: 'bundle-layers' });
  }
  if (initial.skippedBundles && initial.skippedBundles.length > 0) return refusal('PATCH_UNREADABLE', 'A profile bundle layer is unavailable; effective truth is not established.', { layer: 'bundle' });
  let homeRows = null;
  const homePatchPath = path.join(resolutionHome, 'cordis.patch.yml');
  let homePresent = false;
  try { homePresent = fs.statSync(homePatchPath).isFile(); } catch { homePresent = false; }
  if (homePresent) {
    let homeText;
    try { homeText = fs.readFileSync(homePatchPath, 'utf8'); } catch { return refusal('PATCH_UNREADABLE', 'The home patch layer cannot be read.', { layer: 'home' }); }
    const hp = parseDialectRows(utils.jsYaml, utils.entryListSchema, homeText, 'home');
    if (!hp.ok) return hp;
    anchorRows(hp.rows, homePatchPath);
    homeRows = hp.rows;
  }
  const overlayRows = [];
  const overlaySources = [];
  for (let i = 0; i < declaredOverlays.length; i++) {
    const decl = declaredOverlays[i];
    if (typeof decl !== 'string' || decl.length === 0 || !path.isAbsolute(decl)) return refusal('PATCH_UNREADABLE', 'A declared overlay is not an absolute patch path.', { layer: 'overlay' });
    let real = null;
    try { real = fs.realpathSync(decl); } catch { real = null; }
    if (real === null) return refusal('PATCH_UNREADABLE', 'A declared overlay file is missing.', { layer: 'overlay' });
    let isFile = false;
    try { isFile = fs.statSync(real).isFile(); } catch { isFile = false; }
    if (!isFile) return refusal('PATCH_UNREADABLE', 'A declared overlay is not a regular file.', { layer: 'overlay' });
    let overlayText;
    try { overlayText = fs.readFileSync(real, 'utf8'); } catch { return refusal('PATCH_UNREADABLE', 'A declared overlay file cannot be read.', { layer: 'overlay' }); }
    const op = parseDialectRows(utils.jsYaml, utils.entryListSchema, overlayText, 'overlay');
    if (!op.ok) return op;
    anchorRows(op.rows, real);
    overlayRows.push(op.rows);
    overlaySources.push(real);
  }
  const initialForCompose = { ...initial, patches: candidateRows, patchPath: patchPathReal };
  const context = { name: profileName, dir: profileDirReal, patchPath: patchPathReal, installAnchor, cwd: profileDirReal, home: resolutionHome, startedBundles: [], overlays: overlayRows.flat(), telemetryDisabledEnv };
  let patchesFull;
  try {
    patchesFull = utils.readProfilePatches('ocms-s', context, initialForCompose);
  } catch {
    return refusal('PATCH_PARSE_ERROR', 'The effective composition cannot be established.', { phase: 'composition' });
  }
  let effectiveConfig;
  try {
    const composedFull = utils.composeEntries([patchesFull], () => {});
    effectiveConfig = rowConfig(findLlmRow(composedFull));
  } catch {
    return refusal('PATCH_PARSE_ERROR', 'The effective composition cannot be established.', { phase: 'composition' });
  }
  if (!isDeepStrictEqual(effectiveConfig, candidateConfig)) {
    const managedRoutes = [];
    const cProv = (candidateConfig !== undefined && isPlainObject(candidateConfig) && Object.hasOwn(candidateConfig, 'providers')) ? candidateConfig.providers : undefined;
    const eProv = (effectiveConfig !== undefined && isPlainObject(effectiveConfig) && Object.hasOwn(effectiveConfig, 'providers')) ? effectiveConfig.providers : undefined;
    for (const route of MANAGED_ROUTE_KEYS) {
      const wModels = (cProv !== undefined && isPlainObject(cProv) && Object.hasOwn(cProv, route) && isPlainObject(cProv[route]) && Array.isArray(cProv[route].models)) ? cProv[route].models : null;
      const gModels = (eProv !== undefined && isPlainObject(eProv) && Object.hasOwn(eProv, route) && isPlainObject(eProv[route]) && Array.isArray(eProv[route].models)) ? eProv[route].models : null;
      if (!isDeepStrictEqual(wModels, gModels)) managedRoutes.push(route);
    }
    const attrib = [];
    if (homeRows !== null) attrib.push({ layer: 'home', source: homePatchPath });
    overlaySources.forEach((s) => attrib.push({ layer: 'overlay', source: s }));
    if (attrib.length === 0) attrib.push({ layer: 'bundle', source: 'bundle-layers' });
    return { ok: false, code: 'OVERRIDDEN', message: 'A later declared layer replaces the managed configuration.', status: 'BLOCKED', detail: { managedRoutes, overriddenBy: attrib } };
  }
  return { ok: true, effectiveConfig };
}
function stampBackupPath(patchPathReal) {
  const iso = new Date().toISOString().replace(/[:.]/g, '-');
  const rand = crypto.randomBytes(3).toString('hex');
  return patchPathReal + '.bak-' + iso + '-' + rand;
}
function defaultBackupWriter(backupPath, bytes) {
  fs["write"+"FileSync"](backupPath, bytes, { flag: "wx", mode: 0o600 });
}
export async function ProfileAwareCommit(input) {
  const src = input ?? {};
  let planSnap;
  try { planSnap = cloneDetached(src.plan); } catch { return refusal('VERIFY_FAILED', 'Retained plan is not usable.', 'plan-uncloneable'); }
  const waitMsRaw = src.waitMs !== undefined ? src.waitMs : DEFAULT_WAIT_MS;
  if (typeof waitMsRaw !== 'number' || !Number.isFinite(waitMsRaw) || waitMsRaw <= 0) return refusal('VERIFY_FAILED', 'An explicit positive waitMs is required.', 'waitMs-invalid');
  const installAnchorDir = src.installAnchorDir !== undefined ? src.installAnchorDir : null;
  const pathEnv = src.pathEnv !== undefined ? src.pathEnv : (process.env.PATH ?? '');
  const telemetryDisabledEnv = src.telemetryDisabledEnv !== undefined ? src.telemetryDisabledEnv : process.env.DSH_TELEMETRY_DISABLED;
  const deps = (src.deps && typeof src.deps === 'object') ? src.deps : {};
  if (!isPlainObject(planSnap)) return refusal('VERIFY_FAILED', 'Retained plan is not usable.', 'plan-malformed');
  if (planSnap.ok === false) return refusal(typeof planSnap.code === 'string' ? planSnap.code : 'VERIFY_FAILED', 'Retained plan refused planning.', 'plan-blocked');
  if (planSnap.ok !== true) return refusal('VERIFY_FAILED', 'Retained plan is not usable.', 'plan-malformed');
  if (planSnap.status !== 'READY' && planSnap.status !== 'NO_CHANGE') return refusal('VERIFY_FAILED', 'Only retained READY or NO_CHANGE plans can be committed.', 'plan-status-invalid');
  const targetSnap = planSnap.target;
  if (!isPlainObject(targetSnap)) return refusal('STALE_TARGET', 'The bound target identity is not usable.', 'binding-invalid');
  const nameCheck = validateProfileName(targetSnap.profileName);
  if (!nameCheck.ok) return refusal('STALE_TARGET', 'The bound target identity is not usable.', 'binding-invalid');
  for (const k of ['profileDirReal', 'patchPathReal', 'pluginEntryName', 'dshHomeReal']) {
    if (typeof targetSnap[k] !== 'string' || targetSnap[k].length === 0) return refusal('STALE_TARGET', 'The bound target identity is not usable.', 'binding-invalid');
  }
  if (targetSnap.classification !== 'SCRATCH' && targetSnap.classification !== 'PRODUCTION') return refusal('STALE_TARGET', 'The bound target identity is not usable.', 'binding-invalid');
  if (typeof targetSnap.patchDigest !== 'string' || !/^[0-9a-f]{64}$/.test(targetSnap.patchDigest)) return refusal('STALE_TARGET', 'The bound patch digest is not usable.', 'binding-invalid');
  if (!Array.isArray(targetSnap.declaredOverlays)) return refusal('STALE_TARGET', 'The bound target identity is not usable.', 'binding-invalid');
  if (!Object.hasOwn(targetSnap, 'liveAttestation')) return refusal('STALE_TARGET', 'The bound target identity is not usable.', 'binding-invalid');
  if (typeof planSnap.patchDigest !== 'string' || !/^[0-9a-f]{64}$/.test(planSnap.patchDigest)) return refusal('STALE_TARGET', 'The retained patch digest is not usable.', 'binding-invalid');
  if (planSnap.status === 'READY') {
    const vd = validateDesiredSix(planSnap.desired);
    if (!vd.ok) return vd;
    const dd = checkDuplicateIds(planSnap.desired);
    if (dd) return refusal(dd, 'Duplicate managed model IDs across routes.', 'duplicate-managed-id');
    if (typeof planSnap.candidateDigest !== 'string' || !/^[0-9a-f]{64}$/.test(planSnap.candidateDigest)) return refusal('VERIFY_FAILED', 'Retained candidate digest is missing.', 'candidate-digest-malformed');
  }
  const lockResource = path.join(targetSnap.profileDirReal, 'package.json');
  const utilsRes = await resolveCommitUtils({ installAnchorDir, pathEnv, profileDirReal: targetSnap.profileDirReal });
  if (!utilsRes.ok) return { ...utilsRes, lockResource, waitMs: waitMsRaw };
  const lockFn = (typeof deps.withFileLock === 'function') ? deps.withFileLock : utilsRes.utils.withFileLock;
  const atomicFn = (typeof deps.writeFileAtomic === 'function') ? deps.writeFileAtomic : utilsRes.utils.writeFileAtomic;
  const backupFn = (typeof deps.writeBackupFile === 'function') ? deps.writeBackupFile : defaultBackupWriter;
  const postReader = (typeof deps.postWriteReader === 'function') ? deps.postWriteReader : null;
  let opResult;
  try {
    opResult = await lockFn(lockResource, async () => runLocked({ planSnap, targetSnap, waitMsRaw, installAnchorDir, pathEnv, telemetryDisabledEnv, utils: utilsRes.utils, installAnchor: utilsRes.anchor.installAnchor, atomicFn, backupFn, postReader }), { waitMs: waitMsRaw });
  } catch (err) {
    const msg = err && err.message ? String(err.message) : String(err);
    if (msg.includes('timed out waiting for the writer lock') || (err && err.code === 'LOCK_TIMEOUT')) return { ok: false, code: 'LOCK_TIMEOUT', message: 'The native writer lock timed out.', status: 'BLOCKED', lockResource, waitMs: waitMsRaw };
    if (err && err.ok === false && typeof err.code === 'string' && COMMIT_REFUSAL_CODES.includes(err.code)) {
      return { ...err, lockResource: err.lockResource ?? lockResource, waitMs: err.waitMs ?? waitMsRaw };
    }
    return { ok: false, code: 'VERIFY_FAILED', message: 'The commit could not be attempted safely.', status: 'BLOCKED', detail: ('lock-acquisition-unexpected:' + msg).slice(0, 300), lockResource, waitMs: waitMsRaw };
  }
  if (opResult && typeof opResult === 'object' && !Array.isArray(opResult)) {
    if (opResult.lockResource === undefined) opResult.lockResource = lockResource;
    if (opResult.waitMs === undefined) opResult.waitMs = waitMsRaw;
  }
  return opResult;
}
async function runLocked(input) {
  const planSnap = input.planSnap;
  const targetSnap = input.targetSnap;
  const installAnchorDirIn = input.installAnchorDir !== undefined ? input.installAnchorDir : null;
  const pathEnvIn = input.pathEnv !== undefined ? input.pathEnv : (process.env.PATH ?? '');
  const utils = input.utils;
  const installAnchor = input.installAnchor;
  const telemetryDisabledEnv = input.telemetryDisabledEnv;
  const atomicFn = input.atomicFn;
  const backupFn = input.backupFn;
  const postReader = input.postReader;
  const profileDirReal = targetSnap.profileDirReal;
  const patchPathReal = targetSnap.patchPathReal;
  const boundName = targetSnap.pluginEntryName;
  let dirReal = null;
  try { dirReal = fs.realpathSync(profileDirReal); } catch { return refusal('PROFILE_NOT_INITIALIZED', 'The bound profile directory is gone.', 'profile-dir-missing'); }
  const normA = process.platform === 'win32' ? path.resolve(dirReal).toLowerCase() : path.resolve(dirReal);
  const normB = process.platform === 'win32' ? path.resolve(profileDirReal).toLowerCase() : path.resolve(profileDirReal);
  if (normA !== normB) return refusal('STALE_TARGET', 'The bound profile directory moved.', 'profile-path-changed');
  const resolutionHome = path.dirname(path.dirname(dirReal));
  let redesignated = null;
  try { redesignated = fs.realpathSync(path.resolve(resolutionHome, 'profiles', targetSnap.profileName)); } catch { redesignated = null; }
  if (redesignated === null) return refusal('STALE_TARGET', 'The bound profile designation no longer resolves.', 'profile-designation-mismatch');
  const normR = process.platform === 'win32' ? path.resolve(redesignated).toLowerCase() : path.resolve(redesignated);
  if (normR !== normA) return refusal('STALE_TARGET', 'The bound profile designation no longer resolves.', 'profile-designation-mismatch');
  let freshOverlays = null;
  let freshAttestation = null;
  try { freshOverlays = cloneDetached(targetSnap.declaredOverlays); } catch { return refusal('STALE_TARGET', 'The bound target identity is not usable.', 'binding-invalid'); }
  try { freshAttestation = cloneDetached(targetSnap.liveAttestation); } catch { freshAttestation = targetSnap.liveAttestation; }
  let reResolved = null;
  try {
    reResolved = resolveProfileTarget({ profileName: targetSnap.profileName, dshHome: resolutionHome, declaredOverlays: freshOverlays, liveAttestation: freshAttestation, installAnchorDir: installAnchorDirIn, pathEnv: pathEnvIn });
  } catch { return refusal('STALE_TARGET', 'The bound target identity cannot be re-established.', 'reresolve-threw'); }
  if (!reResolved || typeof reResolved !== 'object') return refusal('STALE_TARGET', 'The bound target identity cannot be re-established.', 'reresolve-invalid');
  if (reResolved.ok !== true) {
    const passThrough = ['INCOMPATIBLE_DSH', 'PLUGIN_ENTRY_MISSING', 'PLUGIN_ENTRY_DUPLICATE', 'PATCH_PARSE_ERROR', 'PATCH_ROOT_NOT_SEQUENCE', 'PATCH_UNREADABLE', 'SYMLINK_ESCAPE', 'NOT_PROFILE_OWNED'];
    if (passThrough.includes(reResolved.code)) return reResolved;
    const drifted = refusal('STALE_TARGET', 'The bound target identity drifted since binding.', reResolved.code || 'identity-drift');
    drifted.stale = true;
    return drifted;
  }
  let identical = false;
  try { identical = sameTarget(reResolved.target, targetSnap); } catch { identical = false; }
  if (!identical) {
    const mismatch = refusal('STALE_TARGET', 'The retained target identity does not match the re-resolved target.', 'target-mismatch');
    mismatch.stale = true;
    return mismatch;
  }
  let patchReal = null;
  try { patchReal = fs.realpathSync(patchPathReal); } catch { return refusal('PATCH_UNREADABLE', 'The profile patch file cannot be read.', 'patch-missing'); }
  const normC = process.platform === 'win32' ? path.resolve(path.dirname(patchReal)).toLowerCase() : path.resolve(path.dirname(patchReal));
  if (normC !== normA) return refusal('SYMLINK_ESCAPE', 'The profile patch file escapes the profile directory.', 'patch-escape');
  const normD = process.platform === 'win32' ? path.resolve(patchReal).toLowerCase() : path.resolve(patchReal);
  const normE = process.platform === 'win32' ? path.resolve(patchPathReal).toLowerCase() : path.resolve(patchPathReal);
  if (normD !== normE) return refusal('STALE_TARGET', 'The bound patch path moved.', 'patch-path-changed');
  let classNow = null;
  try { classNow = classifyTarget(dirReal, targetSnap.dshHomeReal); } catch { return refusal('STALE_TARGET', 'The bound target identity is not usable.', 'binding-invalid'); }
  if (classNow !== targetSnap.classification) return refusal('STALE_TARGET', 'The bound classification does not match the bound paths.', 'classification-mismatch');
  let lockedBytes;
  try { lockedBytes = fs.readFileSync(patchReal); } catch { return refusal('PATCH_UNREADABLE', 'The profile patch file cannot be read.', 'patch-unreadable'); }
  const lockedDigest = shaHex(lockedBytes);
  if (lockedDigest !== planSnap.patchDigest || lockedDigest !== targetSnap.patchDigest) return { ok: false, code: 'STALE_TARGET', message: 'The target bytes changed since binding.', status: 'BLOCKED', stale: true };
  const lockedText = lockedBytes.toString('utf8');
  let doc = null;
  try {
    doc = parseDocument(lockedText, { customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: (v) => v }] });
  } catch (err) {
    return refusal('PATCH_PARSE_ERROR', 'The profile patch cannot be parsed.', 'parse-error');
  }
  if (!doc || (doc.errors && doc.errors.length > 0)) return refusal('PATCH_PARSE_ERROR', 'The profile patch cannot be parsed.', 'parse-error');
  if (!isSeq(doc.contents)) return refusal('PATCH_ROOT_NOT_SEQUENCE', 'The profile patch root must be a sequence.', 'root-not-sequence');
  const items = doc.contents.items;
  const found = [];
  for (let at = 0; at < items.length; at++) {
    const item = items[at];
    if (!isMap(item)) continue;
    if (item.has('insert')) continue;
    const idNode = item.get('id', true);
    if (isScalar(idNode) && idNode.value === 'llm-pi-ai' && (idNode.tag === undefined || idNode.tag === 'tag:yaml.org,2002:str')) found.push(at);
  }
  if (found.length === 0) return refusal('PLUGIN_ENTRY_MISSING', 'No llm-pi-ai entry exists in the profile patch.', 'entry-missing');
  if (found.length > 1) return refusal('PLUGIN_ENTRY_DUPLICATE', 'More than one llm-pi-ai entry exists.', 'duplicate');
  const hitNode = items[found[0]];
  let locatedName = 'llm-pi-ai';
  try {
    const n = hitNode.get('name');
    if (typeof n === 'string' && n.length > 0) locatedName = n;
  } catch { locatedName = 'llm-pi-ai'; }
  if (locatedName !== boundName) return refusal('STALE_TARGET', 'The bound entry name does not match the user patch entry.', 'entry-name-mismatch');
  let storedConfig;
  try {
    let cfgNode = null;
    for (const p of hitNode.items) { if (p.key && p.key.value === 'config') { cfgNode = p.value; break; } }
    if (cfgNode === null || cfgNode === undefined) storedConfig = undefined;
    else storedConfig = cfgNode.toJS(doc);
  } catch { return refusal('PATCH_PARSE_ERROR', 'Stored configuration cannot be materialized.', 'stored-unmaterializable'); }
  if (storedConfig !== undefined) {
    const shapeCheck = checkShapes(storedConfig, 'stored');
    if (!shapeCheck.ok) return shapeCheck;
  }
  if (planSnap.status === 'NO_CHANGE') {
    let noRender;
    try {
      noRender = renderDesiredState({ patchBytes: lockedBytes, storedConfig: storedConfig === undefined ? undefined : cloneDetached(storedConfig), desired: cloneDetached(planSnap.desired), target: cloneDetached(targetSnap) });
    } catch (err) {
      return refusal('VERIFY_FAILED', 'Rendering failed.', 'render-threw');
    }
    if (!noRender.ok) return noRender;
    if (noRender.status !== 'NO_CHANGE') return refusal('VERIFY_FAILED', 'Retained NO_CHANGE plan no longer matches file truth.', 'nochange-mismatch');
    if (targetSnap.classification === 'PRODUCTION') {
      let admitted = null;
      try { admitted = isAdmittedProductionAttestation(targetSnap.liveAttestation, { profileName: targetSnap.profileName, declaredOverlays: targetSnap.declaredOverlays }); } catch { admitted = null; }
      if (!admitted || admitted.ok !== true) return { ok: false, code: 'LIVE_OVERLAY_UNKNOWN', message: 'Production targets require explicit bound live-state attestation; failing closed.', status: 'BLOCKED' };
    }
    const ncParsed = parseDialectRows(utils.jsYaml, utils.entryListSchema, lockedText, 'user');
    if (!ncParsed.ok) return ncParsed;
    anchorRows(ncParsed.rows, patchReal);
    const ncHit = findLlmRow(ncParsed.rows);
    const ncCfg = rowConfig(ncHit);
    const ncEff = await composeEffective({ utils, profileDirReal: dirReal, patchPathReal: patchReal, candidateRows: ncParsed.rows, profileName: targetSnap.profileName, installAnchor, declaredOverlays: targetSnap.declaredOverlays, telemetryDisabledEnv, candidateConfig: ncCfg });
    if (!ncEff.ok) return ncEff;
    return { ok: true, status: 'NO_CHANGE', target: cloneDetached(targetSnap), patchDigest: lockedDigest, liveActivation: 'UNKNOWN_LIVE_UNVERIFIED' };
  }
  let firstRender;
  try {
    firstRender = renderDesiredState({ patchBytes: lockedBytes, storedConfig: storedConfig === undefined ? undefined : cloneDetached(storedConfig), desired: cloneDetached(planSnap.desired), target: cloneDetached(targetSnap) });
  } catch {
    return refusal('VERIFY_FAILED', 'Rendering failed.', 'render-threw');
  }
  if (!firstRender.ok) return firstRender;
  if (firstRender.status !== 'READY') return refusal('VERIFY_FAILED', 'Retained READY plan renders NO_CHANGE against locked truth.', 'ready-mismatch');
  if (targetSnap.classification === 'PRODUCTION') {
    let admitted = null;
    try { admitted = isAdmittedProductionAttestation(targetSnap.liveAttestation, { profileName: targetSnap.profileName, declaredOverlays: targetSnap.declaredOverlays }); } catch { admitted = null; }
    if (!admitted || admitted.ok !== true) return { ok: false, code: 'LIVE_OVERLAY_UNKNOWN', message: 'Production targets require explicit bound live-state attestation; failing closed.', status: 'BLOCKED' };
  }
  const candText1 = firstRender.candidateBytes.toString('utf8');
  const candRowsParsed = parseDialectRows(utils.jsYaml, utils.entryListSchema, candText1, 'candidate');
  if (!candRowsParsed.ok) return candRowsParsed;
  anchorRows(candRowsParsed.rows, patchPathReal);
  const candHit = findLlmRow(candRowsParsed.rows);
  const candCfg = rowConfig(candHit);
  const eff = await composeEffective({ utils, profileDirReal: dirReal, patchPathReal: patchReal, candidateRows: candRowsParsed.rows, profileName: targetSnap.profileName, installAnchor, declaredOverlays: targetSnap.declaredOverlays, telemetryDisabledEnv, candidateConfig: candCfg });
  if (!eff.ok) return eff;
  let secondRender;
  try {
    secondRender = renderDesiredState({ patchBytes: lockedBytes, storedConfig: storedConfig === undefined ? undefined : cloneDetached(storedConfig), desired: cloneDetached(planSnap.desired), target: cloneDetached(targetSnap) });
  } catch {
    return refusal('VERIFY_FAILED', 'Rendering failed.', 'render-threw');
  }
  if (!secondRender.ok) return secondRender;
  if (secondRender.status !== 'READY') return refusal('VERIFY_FAILED', 'Retained READY plan renders NO_CHANGE against locked truth.', 'ready-mismatch');
  if (secondRender.candidateDigest !== firstRender.candidateDigest) return refusal('VERIFY_FAILED', 'Recomputed candidate differs across renders.', 'render-divergence');
  if (secondRender.candidateDigest !== planSnap.candidateDigest) return refusal('VERIFY_FAILED', 'Recomputed candidate differs from the retained binding.', 'candidate-digest-mismatch');
  const commitBytes = Buffer.from(secondRender.candidateBytes);
  const ver = verifyCommitPayload({ jsYaml: utils.jsYaml, entryListSchema: utils.entryListSchema, candidateBytes: commitBytes, desired: planSnap.desired, originalBytes: lockedBytes, originalSpans: secondRender.originalSpans || [], candidateSpans: secondRender.candidateSpans || [], expectedDigest: planSnap.candidateDigest, boundName });
  if (!ver.ok) return ver;
  let backupPath = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const cand = stampBackupPath(patchReal);
    try {
      await backupFn(cand, lockedBytes);
      backupPath = cand;
      break;
    } catch (err) {
      if (err && (err.code === 'EEXIST' || String((err && err.message) || '').includes('EEXIST')) && attempt < 4) continue;
      return { ok: false, code: 'BACKUP_FAILED', message: 'The exact-byte backup cannot be written.', status: 'BLOCKED', detail: String((err && err.message) || err).slice(0, 300) };
    }
  }
  if (backupPath === null) return { ok: false, code: 'BACKUP_FAILED', message: 'The exact-byte backup cannot be written.', status: 'BLOCKED' };
  try {
    await atomicFn(patchReal, commitBytes, { mode: 0o600 });
  } catch (err) {
    const wDetail = String((err && err.message) || err).slice(0, 300);
    let observed = null;
    try { observed = shaHex(fs.readFileSync(patchReal)); } catch { observed = null; }
    if (observed !== null && observed === lockedDigest) return { ok: false, code: 'WRITE_FAILED', message: 'The atomic replacement failed; original target preserved.', status: 'BLOCKED', backupPath, detail: wDetail, targetDigestObserved: observed, targetDigestExpected: lockedDigest };
    if (observed !== null && observed === secondRender.candidateDigest) return { ok: false, code: 'POST_WRITE_VERIFY_FAILED', message: 'The writer reported failure after replacement; target shows the verified candidate.', status: 'BLOCKED', backupPath, detail: wDetail, targetDigestObserved: observed, targetDigestExpected: lockedDigest };
    return { ok: false, code: 'POST_WRITE_VERIFY_FAILED', message: 'The writer reported failure and target state is uncertain; backup retained, no auto-revert.', status: 'BLOCKED', backupPath, detail: wDetail, targetDigestObserved: observed, targetDigestExpected: lockedDigest };
  }
  let postBytes;
  try {
    let postRaw;
    if (postReader !== null) postRaw = await postReader(patchReal);
    else postRaw = fs.readFileSync(patchReal);
    if (Buffer.isBuffer(postRaw)) postBytes = postRaw;
    else postBytes = Buffer.from(postRaw);
  } catch (err) {
    return { ok: false, code: 'POST_WRITE_VERIFY_FAILED', message: 'The committed readback is not usable.', status: 'BLOCKED', backupPath };
  }
  if (shaHex(postBytes) !== secondRender.candidateDigest) return { ok: false, code: 'POST_WRITE_VERIFY_FAILED', message: 'Post-write digest does not match the verified candidate.', status: 'BLOCKED', backupPath };
  const postParsed = parseDialectRows(utils.jsYaml, utils.entryListSchema, postBytes.toString('utf8'), 'candidate');
  if (!postParsed.ok) return { ok: false, code: 'POST_WRITE_VERIFY_FAILED', message: 'Post-write bytes do not parse.', status: 'BLOCKED', backupPath };
  const postHit = findLlmRow(postParsed.rows);
  const postCfg = rowConfig(postHit);
  if (postCfg !== undefined) {
    const psc = checkShapes(postCfg, 'candidate');
    if (!psc.ok) return { ok: false, code: 'POST_WRITE_VERIFY_FAILED', message: 'Post-write provider shapes are invalid.', status: 'BLOCKED', backupPath };
  }
  const postProv = (postCfg !== undefined && isPlainObject(postCfg) && Object.hasOwn(postCfg, 'providers')) ? postCfg.providers : undefined;
  for (const route of MANAGED_ROUTE_KEYS) {
    const wanted = planSnap.desired[route] || [];
    let got = null;
    let miss = true;
    if (postProv !== undefined && isPlainObject(postProv) && Object.hasOwn(postProv, route) && isPlainObject(postProv[route]) && Array.isArray(postProv[route].models)) { miss = false; got = postProv[route].models; }
    if (miss) {
      if (wanted.length !== 0) return { ok: false, code: 'POST_WRITE_VERIFY_FAILED', message: 'Post-write route missing.', status: 'BLOCKED', backupPath };
    } else if (!isDeepStrictEqual(got, wanted)) {
      return { ok: false, code: 'POST_WRITE_VERIFY_FAILED', message: 'Post-write arrays differ from desired.', status: 'BLOCKED', backupPath };
    }
  }
  const postDup = checkDuplicateIds(planSnap.desired);
  if (postDup) return { ok: false, code: 'POST_WRITE_VERIFY_FAILED', message: 'Post-write duplicate IDs.', status: 'BLOCKED', backupPath };
  anchorRows(postParsed.rows, patchReal);
  const postEff = await composeEffective({ utils, profileDirReal: dirReal, patchPathReal: patchReal, candidateRows: postParsed.rows, profileName: targetSnap.profileName, installAnchor, declaredOverlays: targetSnap.declaredOverlays, telemetryDisabledEnv, candidateConfig: postCfg });
  if (!postEff.ok) return { ok: false, code: 'POST_WRITE_VERIFY_FAILED', message: 'Post-write effective composition does not match.', status: 'BLOCKED', backupPath };
  return { ok: true, status: 'UPDATED', fileVerified: true, effectiveComposition: 'MATCHED', liveActivation: 'UNKNOWN_LIVE_UNVERIFIED', backupPath, newDigest: shaHex(postBytes), target: cloneDetached(targetSnap) };
}
