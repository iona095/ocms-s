// OCMS-S S5 — minimal shared profile Preview/binding glue.
// Exists only to eliminate CLI/UI duplication: resolve target, read managed
// config, build the retained plan, and bind full identity plus digests plus
// declared overlays plus live-state attestation text. No lock, no write,
// no refetch, no network. Commit stays profile/commit.mjs.
// Authorities: SPEC P0-R2 8.3/8.5/8.6/8.8, 11.3; P1-A 5 S5.
import crypto from "node:crypto";
import { resolveProfileTarget } from "./target-resolver.mjs";
import { readManagedConfig } from "./config-reader.mjs";
import { buildProfileAwarePlan } from "./plan-builder.mjs";
import { parseLiveStateFlag, formatAttestationText } from "./live-attestation.mjs";
function fail(code, message, detail) {
  const out = { ok: false, code, message, status: "BLOCKED" };
  if (detail !== undefined) out.detail = detail;
  return out;
}
export async function buildProfilePreview(input = {}) {
  const src = input ?? {};
  const profileName = src.profileName;
  const dshHome = src.dshHome;
  const origin = src.origin !== undefined ? src.origin : "CLI";
  const scratchMode = src.scratchMode === true;
  const sources = src.sources;
  const generatedAt = typeof src.generatedAt === "string" ? src.generatedAt : new Date().toISOString();
  const installAnchorDir = src.installAnchorDir !== undefined ? src.installAnchorDir : null;
  const pathEnv = src.pathEnv !== undefined ? src.pathEnv : (process.env.PATH ?? "");
  const telemetryDisabledEnv = src.telemetryDisabledEnv;
  let attestation = null;
  if (Object.hasOwn(src, "liveAttestation") && src.liveAttestation !== undefined) attestation = src.liveAttestation;
  else if (src.liveStateRaw !== undefined && src.liveStateRaw !== null) {
    // Explicit acknowledgment only: a UI caller passing a raw live-state
    // declaration without its acknowledgment control is never inferred.
    if (origin === "UI" && src.acknowledged !== true) return fail("INVALID_ATTESTATION", "Live-state attestation requires explicit acknowledgment; failing closed.", "acknowledgment-required");
    const parsed = parseLiveStateFlag(src.liveStateRaw, { profileName, origin });
    if (!parsed.ok) return fail("INVALID_LIVE_STATE", "The --live-state value is malformed.", parsed.detail || "live-state-malformed");
    attestation = parsed.attestation;
  }
  let declaredOverlays = src.declaredOverlays;
  if (declaredOverlays === undefined) {
    if (attestation !== null && attestation !== undefined && attestation.mode === "EXACT_OVERLAYS") declaredOverlays = [...attestation.overlays];
    else declaredOverlays = [];
  }
  if (!Array.isArray(declaredOverlays)) return fail("VERIFY_FAILED", "Declared overlays must be a list.", "declaredOverlays-malformed");
  // R2 B5: empty comma-separated entries are refused here, never filtered.
  // Absolute-path coherence stays with the shared attestation validator and
  // the commit-time composition check; this gate only rejects vacuous items.
  for (const entry of declaredOverlays) {
    if (typeof entry !== "string" || entry.length === 0) {
      return fail("INVALID_OVERLAYS", "Declared overlay entries must be non-empty strings; empty comma-separated items refuse.", "declaredOverlays-empty");
    }
  }
  let resolved = null;
  try {
    resolved = resolveProfileTarget({ profileName, dshHome, scratchMode, declaredOverlays, liveAttestation: attestation, installAnchorDir, pathEnv });
  } catch {
    return fail("VERIFY_FAILED", "Target resolution failed.", "reresolve-threw");
  }
  if (!resolved || resolved.ok !== true) {
    const code = resolved && typeof resolved.code === "string" ? resolved.code : "VERIFY_FAILED";
    const message = resolved && typeof resolved.message === "string" ? resolved.message : "Target resolution failed.";
    const out = { ok: false, code, message, status: "BLOCKED" };
    if (resolved && resolved.detail !== undefined) { try { out.detail = structuredClone(resolved.detail); } catch { out.detail = "uncloneable-detail"; } }
    return out;
  }
  const target = resolved.target;
  let readerResult = null;
  try {
    readerResult = await readManagedConfig({ target: structuredClone(target), installAnchorDir, pathEnv, telemetryDisabledEnv });
  } catch {
    return fail("VERIFY_FAILED", "Configuration read failed.", "reader-threw");
  }
  if (!readerResult || readerResult.ok !== true) {
    const code = readerResult && typeof readerResult.code === "string" ? readerResult.code : "VERIFY_FAILED";
    const message = readerResult && typeof readerResult.message === "string" ? readerResult.message : "Configuration read failed.";
    const out = { ok: false, code, message, status: "BLOCKED" };
    if (readerResult && readerResult.detail !== undefined) { try { out.detail = structuredClone(readerResult.detail); } catch { out.detail = "uncloneable-detail"; } }
    try { out.target = structuredClone(target); } catch {}
    return out;
  }
  let plan = null;
  try {
    plan = buildProfileAwarePlan({ target: structuredClone(target), readerResult, sources, generatedAt });
  } catch {
    return fail("VERIFY_FAILED", "Planning failed.", "plan-threw");
  }
  if (!plan || plan.ok !== true) {
    const code = plan && typeof plan.code === "string" ? plan.code : "VERIFY_FAILED";
    const message = plan && typeof plan.message === "string" ? plan.message : "Planning failed.";
    const out = { ok: false, code, message, status: "BLOCKED" };
    if (plan && plan.detail !== undefined) { try { out.detail = structuredClone(plan.detail); } catch { out.detail = "uncloneable-detail"; } }
    try { out.target = structuredClone(target); } catch {}
    return out;
  }
  let previewId = "";
  try { previewId = crypto.randomBytes(32).toString("hex"); } catch { return fail("VERIFY_FAILED", "Preview identity failed.", "previewId-failed"); }
  let attestationText = "";
  try { attestationText = formatAttestationText(attestation); } catch { attestationText = ""; }
  let preview = null;
  try {
    preview = {
      previewId,
      generatedAt: plan.generatedAt || generatedAt,
      status: plan.status,
      target: structuredClone(plan.target || target),
      patchDigest: plan.patchDigest,
      sourceSnapshotDigest: plan.sourceSnapshotDigest,
      desired: plan.desired !== undefined ? structuredClone(plan.desired) : undefined,
      candidateDigest: plan.candidateDigest,
      storedDigest: plan.patchDigest,
      effectiveDigest: plan.effectiveDigest,
      declaredOverlays: structuredClone(declaredOverlays),
      attestation: attestation === null ? null : structuredClone(attestation),
      attestationText,
      origin,
      plan: structuredClone(plan),
    };
  } catch {
    return fail("VERIFY_FAILED", "Preview assembly failed.", "preview-uncloneable");
  }
  return { ok: true, preview };
}
