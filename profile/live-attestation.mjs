// OCMS-S S5 — shared strict production live-state attestation grammar/validator.
// Authorities: SPEC P0-R2 8.5 (two admission modes, UNATTESTED default refusal),
// 7.2 step 7, 8.6/8.8-8.9, 12 (LIVE_OVERLAY_UNKNOWN); P1-A 5 S5 + 8 (attestation UX).
// Exactly two admission modes: NOT_RUNNING and EXACT_OVERLAYS. UNATTESTED
// (null/undefined) is the default refusal state, not a third mode.
// Explicit acknowledgment only; never inferred. Profile-name bound. Stable
// recorded acknowledgment time. CLI/UI origin distinguished for reporting
// without weakening admission.
import path from "node:path";
import { validateProfileName } from "./target-resolver.mjs";
export const ATTESTATION_MODES = ["NOT_RUNNING", "EXACT_OVERLAYS"];
export const ATTESTATION_ORIGINS = ["CLI", "UI"];
function fail(detail) {
  return { ok: false, code: "INVALID_ATTESTATION", message: "The live-state attestation is malformed, contradictory, incomplete, or unacknowledged.", detail };
}
function isPlainObject(v) {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
  const p = Object.getPrototypeOf(v);
  return p === Object.prototype || p === null;
}
function checkOverlaysForMode(mode, overlays) {
  if (mode === "NOT_RUNNING") {
    if (overlays === undefined) return { ok: true, value: [] };
    if (!Array.isArray(overlays)) return { ok: false, detail: "mode-a-overlays-malformed" };
    if (overlays.length !== 0) return { ok: false, detail: "mode-a-contradictory-overlays" };
    return { ok: true, value: [] };
  }
  if (mode === "EXACT_OVERLAYS") {
    if (!Array.isArray(overlays)) return { ok: false, detail: "mode-b-overlays-malformed" };
    if (overlays.length === 0) return { ok: false, detail: "mode-b-overlays-empty" };
    const seen = new Set();
    for (const entry of overlays) {
      if (typeof entry !== "string" || entry.length === 0) return { ok: false, detail: "mode-b-overlay-not-string" };
      if (entry.includes("\0")) return { ok: false, detail: "mode-b-overlay-nul" };
      if (entry !== entry.trim()) return { ok: false, detail: "mode-b-overlay-whitespace" };
      if (!path.isAbsolute(entry)) return { ok: false, detail: "mode-b-overlay-not-absolute" };
      if (seen.has(entry)) return { ok: false, detail: "mode-b-overlay-duplicate" };
      seen.add(entry);
    }
    return { ok: true, value: [...overlays] };
  }
  return { ok: false, detail: "mode-unknown" };
}
export function createLiveAttestation(input = {}) {
  const src = input ?? {};
  const { profileName, mode, overlays, origin, acknowledged, acknowledgedAt } = src;
  if (acknowledged !== true) return fail("acknowledgment-required");
  if (typeof origin !== "string" || !ATTESTATION_ORIGINS.includes(origin)) return fail("origin-invalid");
  if (typeof mode !== "string" || !ATTESTATION_MODES.includes(mode)) return fail("mode-invalid");
  let nameOk = null;
  try { nameOk = validateProfileName(profileName); } catch { return fail("profileName-invalid"); }
  if (!nameOk || nameOk.ok !== true) return fail("profileName-invalid");
  const boundName = nameOk.name;
  const oc = checkOverlaysForMode(mode, overlays);
  if (!oc.ok) return fail(oc.detail);
  let stamp = acknowledgedAt;
  if (stamp === undefined || stamp === null) stamp = new Date().toISOString();
  if (typeof stamp !== "string" || Number.isNaN(Date.parse(stamp))) return fail("acknowledgedAt-invalid");
  return { ok: true, attestation: { mode, profileName: boundName, overlays: oc.value, origin, acknowledged: true, acknowledgedAt: stamp } };
}
export function parseLiveStateFlag(raw, opts = {}) {
  const profileName = opts.profileName;
  const origin = opts.origin !== undefined ? opts.origin : "CLI";
  if (typeof raw !== "string" || raw.length === 0) return fail("live-state-malformed");
  if (raw === "not-running") return createLiveAttestation({ profileName, mode: "NOT_RUNNING", overlays: [], origin, acknowledged: true });
  const prefix = "overlays:";
  if (raw.startsWith(prefix)) {
    const listPart = raw.slice(prefix.length);
    if (listPart.length === 0) return fail("live-state-malformed");
    const parts = listPart.split(",");
    const items = parts.map((s) => s.trim());
    for (const item of items) if (item.length === 0) return fail("live-state-malformed");
    for (const item of parts) if (item !== item.trim()) return fail("live-state-malformed");
    return createLiveAttestation({ profileName, mode: "EXACT_OVERLAYS", overlays: items, origin, acknowledged: true });
  }
  return fail("live-state-malformed");
}
export function isAdmittedProductionAttestation(attestation, opts = {}) {
  const refused = (detail) => ({ ok: false, code: "LIVE_OVERLAY_UNKNOWN", message: "Production targets require explicit bound live-state attestation; failing closed.", detail });
  if (attestation === null || attestation === undefined) return refused("unattested");
  if (!isPlainObject(attestation)) return refused("attestation-malformed");
  const expectedName = opts.profileName;
  const declared = opts.declaredOverlays;
  if (typeof expectedName !== "string" || expectedName.length === 0) return refused("profileName-missing");
  if (!Array.isArray(declared)) return refused("declaredOverlays-malformed");
  const recheck = createLiveAttestation({
    profileName: attestation.profileName,
    mode: attestation.mode,
    overlays: attestation.overlays,
    origin: attestation.origin,
    acknowledged: attestation.acknowledged,
    acknowledgedAt: attestation.acknowledgedAt,
  });
  if (!recheck.ok) return refused(recheck.detail || "attestation-invalid");
  const clean = recheck.attestation;
  if (clean.profileName !== expectedName) return refused("profileName-mismatch");
  if (clean.mode === "NOT_RUNNING") {
    if (declared.length !== 0) return refused("mode-a-declared-mismatch");
    return { ok: true };
  }
  if (clean.mode === "EXACT_OVERLAYS") {
    if (declared.length !== clean.overlays.length) return refused("mode-b-declared-mismatch");
    for (let i = 0; i < declared.length; i++) if (declared[i] !== clean.overlays[i]) return refused("mode-b-declared-mismatch");
    return { ok: true };
  }
  return refused("mode-unknown");
}
export function formatAttestationText(attestation) {
  if (!isPlainObject(attestation)) return "LIVE_STATE UNATTESTED — production Apply refused (LIVE_OVERLAY_UNKNOWN).";
  if (attestation.mode === "NOT_RUNNING") return "LIVE_STATE NOT_RUNNING profile=" + JSON.stringify(attestation.profileName) + " origin=" + attestation.origin + " acknowledgedAt=" + attestation.acknowledgedAt + " — operator declares no running DSH owns this profile.";
  if (attestation.mode === "EXACT_OVERLAYS") return "LIVE_STATE EXACT_OVERLAYS profile=" + JSON.stringify(attestation.profileName) + " origin=" + attestation.origin + " acknowledgedAt=" + attestation.acknowledgedAt + " overlays[" + attestation.overlays.length + "]=" + attestation.overlays.map((o) => JSON.stringify(o)).join(",") + " — operator declares the running owner uses exactly these overlays and no others.";
  return "LIVE_STATE UNATTESTED — production Apply refused (LIVE_OVERLAY_UNKNOWN).";
}
