// S5 HTTP API — profile Preview/Apply over loopback (P0-R2 8.6/8.8/8.9; P1-A 5 S5).
// T09 (switch invalidation via slot replacement), T10 at API level (stale on
// target-byte change), NO_CHANGE API response, liveActivation on every Apply
// response. Synthetic fixtures only; loopback harness; no live profiles.
import { describe, it, beforeEach, afterEach } from "node:test";
import { assert, makeTempHome, sandboxDshHome, makeProductionHome } from "./helpers.mjs";
import { makeProfile as makeS4Profile, makeFixtureBundle, llmRow as s4Row, appendPatchNewline } from "../profile-commit/helpers.mjs";
import { startTestServer, postJson, authHeaders, fetchFromBodies, validSourceBodies, scratchSettingsFile } from "../v1.3/helpers.mjs";
import { withR2Port } from "./helpers.mjs";
function seedEntries() {
  return [s4Row({ config: { providers: { other: { displayName: "other", models: [] } } } })];
}
describe("S5 profile HTTP API", () => {
  let home; let cleanupHome; let restore;
  beforeEach(() => { restore = sandboxDshHome(); const h = makeTempHome(); home = h.home; cleanupHome = h.cleanup; });
  afterEach(() => { try { cleanupHome(); } catch {} try { restore(); } catch {} });
  it("scratch preview binds identity; apply UPDATED then STALE; re-preview NO_CHANGE", async (t) => {
    const dir = makeS4Profile(home, "httpA", { entries: seedEntries(), bundles: ["@fixture/base"] });
    makeFixtureBundle(dir);
    const file = scratchSettingsFile(t);
    const started = await withR2Port(t, (port) => startTestServer(t, { settingsPath: file, port, fetchFn: fetchFromBodies(validSourceBodies()) }));
    const preview = await postJson(started.port, "/api/preview", { profileName: "httpA", dshHome: home }, authHeaders(started.token));
    assert.equal(preview.json.ok, true);
    assert.equal(preview.json.profile, true);
    assert.equal(preview.json.target.profileName, "httpA");
    assert.equal(preview.json.target.classification, "SCRATCH");
    assert.ok(typeof preview.json.target.patchPathReal === "string");
    assert.equal(preview.json.attestation, null);
    assert.ok(String(preview.json.attestationText).includes("UNATTESTED"));
    assert.equal(preview.json.liveActivation, "UNKNOWN_LIVE_UNVERIFIED");
    const applied = await postJson(started.port, "/api/apply", { previewId: preview.json.previewId, confirmed: true, selection: { profileName: preview.json.target.profileName, declaredOverlays: preview.json.declaredOverlays, attestation: preview.json.attestation } }, authHeaders(started.token));
    assert.equal(applied.json.ok, true);
    assert.equal(applied.json.status, "UPDATED");
    assert.equal(applied.json.liveActivation, "UNKNOWN_LIVE_UNVERIFIED");
    assert.ok(typeof applied.json.backupPath === "string");
    const replay = await postJson(started.port, "/api/apply", { previewId: preview.json.previewId }, authHeaders(started.token));
    assert.equal(replay.json.ok, false);
    assert.equal(replay.json.code, "STALE_PREVIEW");
    const preview2 = await postJson(started.port, "/api/preview", { profileName: "httpA", dshHome: home }, authHeaders(started.token));
    assert.equal(preview2.json.ok, true);
    assert.equal(preview2.json.state, "NO_CHANGE");
    const applied2 = await postJson(started.port, "/api/apply", { previewId: preview2.json.previewId, confirmed: true, selection: { profileName: preview2.json.target.profileName, declaredOverlays: preview2.json.declaredOverlays, attestation: preview2.json.attestation } }, authHeaders(started.token));
    assert.equal(applied2.json.ok, true);
    assert.equal(applied2.json.status, "NO_CHANGE");
    assert.equal(applied2.json.liveActivation, "UNKNOWN_LIVE_UNVERIFIED");
  });
  it("unconfirmed profile Apply refuses with confirmation required", async (t) => {
    const dir = makeS4Profile(home, "httpU", { entries: seedEntries(), bundles: ["@fixture/base"] });
    makeFixtureBundle(dir);
    const file = scratchSettingsFile(t);
    const started = await withR2Port(t, (port) => startTestServer(t, { settingsPath: file, port, fetchFn: fetchFromBodies(validSourceBodies()) }));
    const preview = await postJson(started.port, "/api/preview", { profileName: "httpU", dshHome: home }, authHeaders(started.token));
    assert.equal(preview.json.ok, true);
    const refused = await postJson(started.port, "/api/apply", { previewId: preview.json.previewId }, authHeaders(started.token));
    assert.equal(refused.json.ok, false);
    assert.equal(refused.json.code, "CONFIRMATION_REQUIRED");
  });
  it("target-byte change between Preview and Apply refuses STALE_PREVIEW", async (t) => {
    const dir = makeS4Profile(home, "httpB", { entries: seedEntries(), bundles: ["@fixture/base"] });
    makeFixtureBundle(dir);
    const file = scratchSettingsFile(t);
    const started = await withR2Port(t, (port) => startTestServer(t, { settingsPath: file, port, fetchFn: fetchFromBodies(validSourceBodies()) }));
    const preview = await postJson(started.port, "/api/preview", { profileName: "httpB", dshHome: home }, authHeaders(started.token));
    assert.equal(preview.json.ok, true);
    appendPatchNewline(dir);
    const applied = await postJson(started.port, "/api/apply", { previewId: preview.json.previewId, confirmed: true, selection: { profileName: preview.json.target.profileName, declaredOverlays: preview.json.declaredOverlays, attestation: preview.json.attestation } }, authHeaders(started.token));
    assert.equal(applied.json.ok, false);
    assert.equal(applied.json.code, "STALE_PREVIEW");
  });
  it("production apply without attestation refuses LIVE_OVERLAY_UNKNOWN", async (t) => {
    const prod = makeProductionHome();
    try {
      const dir = makeS4Profile(prod.home, "httpP", { entries: seedEntries(), bundles: ["@fixture/base"] });
      makeFixtureBundle(dir);
      const file = scratchSettingsFile(t);
      const started = await withR2Port(t, (port) => startTestServer(t, { settingsPath: file, port, fetchFn: fetchFromBodies(validSourceBodies()) }));
      const preview = await postJson(started.port, "/api/preview", { profileName: "httpP", dshHome: prod.home }, authHeaders(started.token));
      assert.equal(preview.json.ok, true);
      assert.equal(preview.json.target.classification, "PRODUCTION");
      const applied = await postJson(started.port, "/api/apply", { previewId: preview.json.previewId, confirmed: true, selection: { profileName: preview.json.target.profileName, declaredOverlays: preview.json.declaredOverlays, attestation: preview.json.attestation } }, authHeaders(started.token));
      assert.equal(applied.json.ok, false);
      assert.equal(applied.json.code, "LIVE_OVERLAY_UNKNOWN");
    } finally { try { prod.cleanup(); } catch {} try { prod.restore(); } catch {} }
  });
});
