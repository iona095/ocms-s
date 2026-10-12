// OCMS-S S3 — Thin planning wrapper (P1-A section 5 S3, SPEC section 11.3).
//
// Reuses sync.mjs public pure functions verbatim where the public interface
// permits: planDesired, checkMembership, diffDesired, MANAGED_ROUTES,
// MANAGED_ROUTE_KEYS and buildNewConfig object-level semantics (applied to
// the located entry config object). Private sync helpers (canonicalJson,
// sha256Hex, planningSourceBundle, validateSourceBundle internals) are NOT
// imported; the two tiny pure adaptations below (canonicalJsonLocal,
// shaHexLocal, planningSourceBundleLocal, validateSourcesLocal) are bounded
// re-implementations of the same deterministic semantics, documented here.
// No lock, no write, no refetch, no network. Pure in-memory planning plus
// byte-surgical rendering via surgical-render.mjs.
import crypto from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { planDesired, checkMembership, diffDesired, MANAGED_ROUTES, MANAGED_ROUTE_KEYS, buildNewConfig } from '../sync.mjs';
import { renderDesiredState } from './surgical-render.mjs';
import { sameTarget } from './target-resolver.mjs';
import { parseDocument, isSeq, isMap, isScalar } from 'yaml';

function shaHexLocal(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function canonicalJsonLocal(value) {
  if (value === undefined || value === null) return 'null';
  const t = typeof value;
  if (t === 'boolean' || t === 'string') return JSON.stringify(value);
  if (t === 'number') return Number.isFinite(value) ? JSON.stringify(value) : 'null';
  if (t === 'bigint') return JSON.stringify(String(value));
  if (Array.isArray(value)) return '[' + value.map(canonicalJsonLocal).join(',') + ']';
  if (t !== 'object') return 'null';
  const keys = Object.keys(value).sort();
  return '{' + keys.map(function (k) { return JSON.stringify(k) + ':' + canonicalJsonLocal(value[k]); }).join(',') + '}';
}

function projectPlanningSources(sources) {
  return {
    rosters: {
      go: sources && sources.rosters ? sources.rosters.go : undefined,
      zen: sources && sources.rosters ? sources.rosters.zen : undefined,
    },
    catalog: {
      go: sources && sources.catalog ? sources.catalog.go : undefined,
      zen: sources && sources.catalog ? sources.catalog.zen : undefined,
    },
    docs: {
      go: sources && sources.docs ? sources.docs.go : undefined,
      zen: sources && sources.docs ? sources.docs.zen : undefined,
    },
  };
}

function planningSourceBundleLocal(sources) {
  return projectPlanningSources(sources);
}

const DIGEST_PATTERN = /^[0-9a-f]{64}$/;
const EFFECTIVE_STATUSES = ['MATCHED', 'EFFECTIVE_DIFFERS_FROM_STORED'];

function isMappingLocal(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

function validateSourcesLocal(sources) {
  if (!isMappingLocal(sources)) throw new Error('SOURCE_INVALID: source bundle must be a mapping');
  const rosters = sources.rosters;
  if (!isMappingLocal(rosters)) throw new Error('SOURCE_INVALID: rosters must be a mapping');
  for (const gw of ['go', 'zen']) {
    if (!Object.hasOwn(rosters, gw) || !Array.isArray(rosters[gw]) || rosters[gw].length === 0) throw new Error('SOURCE_INVALID: ' + gw + ' roster is missing or empty');
    const ids = rosters[gw];
    if (ids.some(function (id) { return typeof id !== 'string' || !id; }) || new Set(ids).size !== ids.length) throw new Error('SOURCE_INVALID: ' + gw + ' roster is malformed');
  }
  if (!isMappingLocal(sources.catalog)) throw new Error('SOURCE_INVALID: catalog is missing');
  for (const gw of ['go', 'zen']) {
    if (!Object.hasOwn(sources.catalog, gw) || !isMappingLocal(sources.catalog[gw]) || !isMappingLocal(sources.catalog[gw].models) || Object.keys(sources.catalog[gw].models).length === 0) throw new Error('SOURCE_INVALID: catalog ' + gw + '.models is missing or empty');
  }
  if (!isMappingLocal(sources.docs)) throw new Error('SOURCE_INVALID: docs are missing');
  for (const gw of ['go', 'zen']) {
    if (!Object.hasOwn(sources.docs, gw) || !isMappingLocal(sources.docs[gw])) throw new Error('SOURCE_INVALID: docs ' + gw + ' map is missing');
  }
}

function validateReaderBinding(callerTarget, readerResult, origBytes, actualDigest) {
  try {
    if (!readerResult || typeof readerResult !== 'object' || Array.isArray(readerResult)) return refusal('VERIFY_FAILED', 'Reader result is required.', 'reader-missing');
    if (readerResult.ok === false) {
      const code = typeof readerResult.code === 'string' && readerResult.code ? readerResult.code : 'VERIFY_FAILED';
      const message = typeof readerResult.message === 'string' && readerResult.message ? readerResult.message : 'Reader refused planning.';
      const out = { ok: false, code, message, status: 'BLOCKED' };
      if (readerResult.detail !== undefined) { try { out.detail = structuredClone(readerResult.detail); } catch { out.detail = 'uncloneable-detail'; } }
      return out;
    }
    if (readerResult.ok !== true) return refusal('VERIFY_FAILED', 'Reader result is not an accepted success.', 'reader-status-invalid');
    if (!EFFECTIVE_STATUSES.includes(readerResult.status)) return refusal('VERIFY_FAILED', 'Reader status is not an accepted success status.', 'reader-status-invalid');
    if (!callerTarget || typeof callerTarget !== 'object' || Array.isArray(callerTarget)) return refusal('PATCH_PARSE_ERROR', 'Target binding is required.', 'target-missing');
    if (!readerResult.target || typeof readerResult.target !== 'object' || Array.isArray(readerResult.target)) return refusal('STALE_TARGET', 'The supplied target binding is not usable; re-resolve the profile target.', 'binding-invalid');
    let callerSnap = null;
    let readerSnap = null;
    try { callerSnap = structuredClone(callerTarget); } catch { return refusal('STALE_TARGET', 'The supplied target binding is not usable; re-resolve the profile target.', 'binding-invalid'); }
    try { readerSnap = structuredClone(readerResult.target); } catch { return refusal('STALE_TARGET', 'The supplied target binding is not usable; re-resolve the profile target.', 'binding-invalid'); }
    let same = false;
    try { same = sameTarget(callerSnap, readerSnap); } catch { same = false; }
    if (!same) return refusal('STALE_TARGET', 'The bound target identity does not match the reader binding; re-resolve the profile target.', 'target-mismatch');
    const readerDigest = readerResult.patchDigest;
    if (typeof readerDigest !== 'string' || !DIGEST_PATTERN.test(readerDigest)) return refusal('VERIFY_FAILED', 'Reader patch digest is missing or malformed.', 'patch-digest-malformed');
    if (readerDigest !== actualDigest) return refusal('VERIFY_FAILED', 'Patch digest does not match patch bytes.', { expected: readerDigest, observed: actualDigest });
    const targetDigest = callerSnap.patchDigest;
    if (typeof targetDigest !== 'string' || !DIGEST_PATTERN.test(targetDigest)) return refusal('STALE_TARGET', 'The bound patch digest is missing or malformed; re-resolve the profile target.', 'binding-invalid');
    if (targetDigest !== actualDigest || targetDigest !== readerDigest) return refusal('STALE_TARGET', 'The target bytes changed since binding; re-Preview against current file truth.', { cause: 'patch-digest-mismatch', expected: targetDigest, observed: actualDigest });
    const idx = readerResult.llmEntryIndex;
    if (typeof idx !== 'number' || !Number.isInteger(idx) || idx < 0) return refusal('STALE_TARGET', 'The bound entry index is not usable; re-resolve the profile target.', 'binding-invalid');
    let entryName = 'llm-pi-ai';
    try {
      const text = origBytes.toString('utf8');
      const doc = parseDocument(text, { customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: function (v) { return v; } }] });
      if (!doc || (doc.errors && doc.errors.length > 0)) return refusal('PATCH_PARSE_ERROR', 'The profile patch cannot be parsed.', 'parse-error');
      if (!isSeq(doc.contents)) return refusal('PATCH_ROOT_NOT_SEQUENCE', 'The profile patch root must be a sequence.', 'root-not-sequence');
      const cands = [];
      const items = doc.contents.items;
      for (let at = 0; at < items.length; at++) {
        const item = items[at];
        if (!isMap(item)) continue;
        if (item.has('insert')) continue;
        const idNode = item.get('id', true);
        const isId = idNode && typeof idNode === 'object' && typeof idNode.value === 'string' && idNode.value === 'llm-pi-ai' && (idNode.tag === undefined || idNode.tag === 'tag:yaml.org,2002:str');
        if (isId) cands.push(at);
      }
      if (cands.length === 0) return refusal('PLUGIN_ENTRY_MISSING', 'No llm-pi-ai entry exists in the profile patch.', 'entry-missing');
      if (cands.length > 1) return refusal('PLUGIN_ENTRY_DUPLICATE', 'More than one llm-pi-ai entry exists; refusing rather than picking.', 'duplicate');
      if (cands[0] !== idx) return refusal('STALE_TARGET', 'The bound entry index does not match the user patch entry; re-resolve the profile target.', 'entry-index-mismatch');
      const entryNode = items[cands[0]];
      let n = null;
      try { n = entryNode.get('name'); } catch { n = null; }
      if (typeof n === 'string' && n.length > 0) entryName = n; else entryName = 'llm-pi-ai';
    } catch (e) {
      if (e && typeof e === 'object' && e.ok === false && typeof e.code === 'string') return e;
      return refusal('STALE_TARGET', 'The supplied target binding is not usable; re-resolve the profile target.', 'binding-invalid');
    }
    if (typeof callerSnap.pluginEntryName !== 'string' || callerSnap.pluginEntryName !== entryName) return refusal('STALE_TARGET', 'The bound entry name does not match the user patch entry; re-resolve the profile target.', 'entry-name-mismatch');
    if (typeof readerSnap.pluginEntryName !== 'string' || readerSnap.pluginEntryName !== entryName) return refusal('STALE_TARGET', 'The bound entry name does not match the user patch entry; re-resolve the profile target.', 'entry-name-mismatch');
    return { ok: true, targetSnapshot: callerSnap, readerStatus: readerResult.status, effectiveDigest: readerResult.effectiveDigest };
  } catch {
    return refusal('STALE_TARGET', 'The supplied target binding is not usable; re-resolve the profile target.', 'binding-invalid');
  }
}

function clone(v) { return structuredClone(v); }

function refusal(code, message, detail) {
  const out = { ok: false, code, message, status: 'BLOCKED' };
  if (detail !== undefined) out.detail = detail;
  return out;
}

export function buildProfileAwarePlan(input) {
  input = input || {};
  const target = input.target || null;
  const readerResult = input.readerResult || null;
  const sources = input.sources || null;
  const generatedAt = input.generatedAt || new Date().toISOString();
  if (!readerResult || typeof readerResult !== 'object' || Array.isArray(readerResult)) return refusal('PATCH_PARSE_ERROR', 'Reader result is required.', 'reader-missing');
  if (readerResult.ok === false) {
    const rcode = typeof readerResult.code === 'string' && readerResult.code ? readerResult.code : 'VERIFY_FAILED';
    const rmsg = typeof readerResult.message === 'string' && readerResult.message ? readerResult.message : 'Reader refused planning.';
    const rout = { ok: false, code: rcode, message: rmsg, status: 'BLOCKED' };
    if (readerResult.detail !== undefined) { try { rout.detail = structuredClone(readerResult.detail); } catch { rout.detail = 'uncloneable-detail'; } }
    return rout;
  }
  if (!target || typeof target !== 'object' || Array.isArray(target)) return refusal('PATCH_PARSE_ERROR', 'Target binding is required.', 'target-missing');
  const patchBytes = readerResult.patchBytes;
  const storedConfig = readerResult.storedConfig;
  if (!patchBytes || (!(patchBytes instanceof Uint8Array) && !Buffer.isBuffer(patchBytes) && typeof patchBytes !== 'string')) return refusal('PATCH_PARSE_ERROR', 'Reader patch bytes are required.', 'patch-missing');
  let origBytes = null;
  try {
    if (typeof patchBytes === 'string') origBytes = Buffer.from(patchBytes, 'utf8');
    else origBytes = Buffer.from(patchBytes);
  } catch { return refusal('PATCH_PARSE_ERROR', 'Reader patch bytes are required.', 'patch-missing'); }
  let actualDigest = null;
  try { actualDigest = shaHexLocal(origBytes); } catch { return refusal('VERIFY_FAILED', 'Patch digest does not match patch bytes.', 'digest-failed'); }
  const binding = validateReaderBinding(target, readerResult, origBytes, actualDigest);
  if (!binding.ok) return binding;
  let targetSnapshot = null;
  try { targetSnapshot = structuredClone(binding.targetSnapshot); } catch { return refusal('STALE_TARGET', 'The supplied target binding is not usable; re-resolve the profile target.', 'binding-invalid'); }
  const readerStatus = binding.readerStatus;
  let effectiveDigestSnap = null;
  try { effectiveDigestSnap = binding.effectiveDigest === undefined ? undefined : structuredClone(binding.effectiveDigest); } catch { effectiveDigestSnap = null; }
  let readerWarningsSnap = [];
  try { readerWarningsSnap = readerResult.warnings === undefined ? [] : structuredClone(readerResult.warnings || []); } catch { readerWarningsSnap = []; }
  try { validateSourcesLocal(sources); }
  catch (e) { return refusal('VERIFY_FAILED', 'Source bundle is invalid.', String((e && e.message) || e)); }
  const sourceSnapshotDigest = shaHexLocal(canonicalJsonLocal(planningSourceBundleLocal(sources)));
  let current = null;
  if (storedConfig === undefined) current = {};
  else if (storedConfig === null) return refusal('SETTINGS_INVALID', 'Stored configuration is malformed.', { path: 'config' });
  else if (typeof storedConfig !== 'object' || Array.isArray(storedConfig)) return refusal('SETTINGS_INVALID', 'Stored configuration must be a mapping when present.', { path: 'config' });
  else {
    try { current = { 'llm-pi-ai': clone(storedConfig) }; } catch (e) { return refusal('SETTINGS_INVALID', 'Stored configuration is malformed.', { path: 'config' }); }
  }
  let plan = null;
  try {
    plan = planDesired({ rosters: sources.rosters, catalog: sources.catalog, docs: sources.docs, current });
  } catch (e) { return refusal('VERIFY_FAILED', 'Planning failed.', String((e && e.message) || e)); }
  if (!plan.ok) {
    const reasons = (plan.unresolved || []).map(function (r) { return r.reason || r.code || String(r); });
    return refusal('VERIFY_FAILED', 'Planning is blocked.', { reasons });
  }
  const dispositions = plan.dispositions || [];
  const skipped = { go: [], zen: [] };
  for (const entry of dispositions) {
    if ((entry.disposition === 'SKIPPED_UNRESOLVED' || entry.disposition === 'SKIPPED_UNSUPPORTED_PROTOCOL') && (entry.gateway === 'go' || entry.gateway === 'zen')) {
      skipped[entry.gateway].push(entry.id);
    }
  }
  try { checkMembership(plan.desired, sources.rosters, skipped); }
  catch (e) { return refusal('MEMBERSHIP_MISMATCH', 'Desired membership is invalid.', String((e && e.message) || e)); }
  let changes = null;
  try { changes = diffDesired(plan.desired, plan.priors); }
  catch (e) { return refusal('VERIFY_FAILED', 'Diff failed.', String((e && e.message) || e)); }
  // Object-level semantics check via buildNewConfig (verbatim reuse): apply to synthetic settings shape and assert round-trip.
  try {
    const candidateObj = buildNewConfig(current, plan.desired);
    if (!candidateObj || typeof candidateObj !== 'object') throw new Error('buildNewConfig returned non-mapping');
  } catch (e) { return refusal('VERIFY_FAILED', 'Object-level build failed.', String((e && e.message) || e)); }
  let desired = null;
  try { desired = clone(plan.desired); } catch (e) { return refusal('VERIFY_FAILED', 'Diff failed.', String((e && e.message) || e)); }
  let storedSnap = undefined;
  try { storedSnap = storedConfig === undefined ? undefined : clone(storedConfig); } catch (e) { return refusal('VERIFY_FAILED', 'Stored configuration is malformed.', String((e && e.message) || e)); }
  let render = null;
  try {
    let desiredForRender = null;
    try { desiredForRender = clone(desired); } catch { return refusal('VERIFY_FAILED', 'Rendering failed.', 'desired-uncloneable'); }
    render = renderDesiredState({ patchBytes: origBytes, storedConfig: storedSnap, desired: desiredForRender, target: clone(targetSnapshot) });
  } catch (e) { return refusal('VERIFY_FAILED', 'Rendering failed.', String((e && e.message) || e)); }
  if (!render.ok) return render;
  let combinedWarnings = [];
  try {
    const rw = Array.isArray(readerWarningsSnap) ? readerWarningsSnap : [];
    const ww = Array.isArray(render.warnings) ? render.warnings : [];
    combinedWarnings = clone([...rw, ...ww]);
  } catch { try { combinedWarnings = clone(render.warnings || []); } catch { combinedWarnings = []; } }
  if (render.status === 'NO_CHANGE') {
    try {
      return { ok: true, status: 'NO_CHANGE', desired: clone(desired), footprint: clone(render.footprint), changes: clone(changes), dispositions: clone(dispositions), patchDigest: actualDigest, sourceSnapshotDigest, generatedAt, target: clone(targetSnapshot), warnings: clone(combinedWarnings), verification: clone(render.verification || {}), readerStatus, effectiveDigest: effectiveDigestSnap };
    } catch (e) { return refusal('VERIFY_FAILED', 'Result assembly failed.', String((e && e.message) || e)); }
  }
  try {
    return { ok: true, status: 'READY', desired: clone(desired), footprint: clone(render.footprint), changes: clone(changes), dispositions: clone(dispositions), patchDigest: actualDigest, sourceSnapshotDigest, generatedAt, target: clone(targetSnapshot), warnings: clone(combinedWarnings), candidateBytes: Buffer.from(render.candidateBytes), candidateText: render.candidateText, candidateDigest: render.candidateDigest, originalSpans: clone(render.originalSpans || []), candidateSpans: clone(render.candidateSpans || []), verification: clone(render.verification || {}), readerStatus, effectiveDigest: effectiveDigestSnap };
  } catch (e) { return refusal('VERIFY_FAILED', 'Result assembly failed.', String((e && e.message) || e)); }
}

export const __reuse = { planDesired, checkMembership, diffDesired };