// R2 B2/B3 RED — server-side operator-state binding + mandatory confirmation.
// Profile Apply must carry previewId + confirmed:true + current selection;
// any drift versus the retained Preview or fresh disk truth refuses
// STALE_PREVIEW with zero writes and no commit invocation. HTTP loopback,
// disposable TEMP fixtures only.
import { describe, it, beforeEach, afterEach } from "node:test";
import { assert, makeTempHome, sandboxDshHome, makeProductionHome } from "./helpers.mjs";
import { makeProfile as makeS4Profile, makeFixtureBundle, llmRow as s4Row, backupNames, readPatchBytes, writeHomePatchText } from "../profile-commit/helpers.mjs";
import { stringify as stringifyYaml } from "yaml";
import { startTestServer, postJson, authHeaders, fetchFromBodies, validSourceBodies, scratchSettingsFile } from "../v1.3/helpers.mjs";
import { withR2Port } from "./helpers.mjs";
function seedEntries() {
  return [s4Row({ config: { providers: { other: { displayName: "other", models: [] } } } })];
}
function selectionFor(preview, over = {}) {
  const att = preview.attestation;
  const sel = {
    profileName: preview.target.profileName,
    declaredOverlays: [...preview.declaredOverlays],
    attestation: att === null ? null : structuredClone(att),
  };
  if (att !== null && att !== undefined) {
    sel.liveState = att.mode === "NOT_RUNNING" ? "not-running" : "overlays:" + att.overlays.join(",");
    sel.acknowledged = true;
  }
  return { ...sel, ...over };
}
async function previewProfile(t, home, name) {
  const dir = makeS4Profile(home, name, { entries: seedEntries(), bundles: ["@fixture/base"] });
  makeFixtureBundle(dir);
  const file = scratchSettingsFile(t);
  const started = await withR2Port(t, (port) => startTestServer(t, { settingsPath: file, port, fetchFn: fetchFromBodies(validSourceBodies()) }));
  const preview = await postJson(started.port, "/api/preview", { profileName: name, dshHome: home }, authHeaders(started.token));
  assert.equal(preview.json.ok, true, JSON.stringify(preview.json).slice(0, 400));
  return { started, preview: preview.json, dir };
}
describe("R2 B2/B3 apply binding (RED)", () => {
  let home; let cleanupHome; let restore;
  beforeEach(() => { restore = sandboxDshHome(); const h = makeTempHome(); home = h.home; cleanupHome = h.cleanup; });
  afterEach(() => { try { cleanupHome(); } catch {} try { restore(); } catch {} });
  it("5: previewId alone refuses (confirmation required)", async (t) => {
    const { started, preview } = await previewProfile(t, home, "r2b5");
    const res = await postJson(started.port, "/api/apply", { previewId: preview.previewId }, authHeaders(started.token));
    assert.equal(res.json.ok, false);
    assert.ok(res.json.code === "CONFIRMATION_REQUIRED" || res.json.code === "BAD_REQUEST");
  });
  it("6: changed profile in selection refuses STALE with zero writes", async (t) => {
    const { started, preview, dir } = await previewProfile(t, home, "r2b6");
    const before = readPatchBytes(dir);
    const res = await postJson(started.port, "/api/apply", {
      previewId: preview.previewId,
      confirmed: true,
      selection: selectionFor(preview, { profileName: "someone-else" }),
    }, authHeaders(started.token));
    assert.equal(res.json.ok, false);
    assert.equal(res.json.code, "STALE_PREVIEW");
    assert.ok(readPatchBytes(dir).equals(before));
    assert.deepEqual(backupNames(dir), []);
  });
  it("7: changed overlays refuse STALE", async (t) => {
    const { started, preview, dir } = await previewProfile(t, home, "r2b7");
    const before = readPatchBytes(dir);
    const res = await postJson(started.port, "/api/apply", {
      previewId: preview.previewId,
      confirmed: true,
      selection: selectionFor(preview, { declaredOverlays: ["C:/drifted.yml"] }),
    }, authHeaders(started.token));
    assert.equal(res.json.ok, false);
    assert.equal(res.json.code, "STALE_PREVIEW");
    assert.ok(readPatchBytes(dir).equals(before));
    assert.deepEqual(backupNames(dir), []);
  });
  it("7b: later home-layer effective drift refuses STALE", async (t) => {
    const { started, preview, dir } = await previewProfile(t, home, "r2b7b");
    const before = readPatchBytes(dir);
    writeHomePatchText(home, stringifyYaml([{ id: "llm-pi-ai", name: "Home", config: { providers: { "opencode-go": { displayName: "opencode-go", models: [{ id: "home-evil" }] } } } }]));
    const res = await postJson(started.port, "/api/apply", {
      previewId: preview.previewId,
      confirmed: true,
      selection: selectionFor(preview),
    }, authHeaders(started.token));
    assert.equal(res.json.ok, false);
    assert.equal(res.json.code, "STALE_PREVIEW");
    assert.ok(readPatchBytes(dir).equals(before));
    assert.deepEqual(backupNames(dir), []);
  });
  it("8: changed attestation payload refuses STALE", async (t) => {
    const { started, preview, dir } = await previewProfile(t, home, "r2b8");
    const forged = { mode: "NOT_RUNNING", profileName: preview.target.profileName, overlays: [], origin: "UI", acknowledged: true, acknowledgedAt: "2001-01-01T00:00:00.000Z" };
    const before = readPatchBytes(dir);
    const res = await postJson(started.port, "/api/apply", {
      previewId: preview.previewId,
      confirmed: true,
      selection: selectionFor(preview, { attestation: forged, liveState: "not-running", acknowledged: true }),
    }, authHeaders(started.token));
    assert.equal(res.json.ok, false);
    assert.equal(res.json.code, "STALE_PREVIEW");
    assert.ok(readPatchBytes(dir).equals(before));
    assert.deepEqual(backupNames(dir), []);
  });
  it("9b: production mode-A attested selection admits with liveActivation", async (t) => {
    const prod = makeProductionHome();
    try {
      const dir = makeS4Profile(prod.home, "r2b9b", { entries: [s4Row({ config: { providers: { other: { displayName: "other", models: [] } } } })], bundles: ["@fixture/base"] });
      makeFixtureBundle(dir);
      const file = scratchSettingsFile(t);
      const started = await withR2Port(t, (port) => startTestServer(t, { settingsPath: file, port, fetchFn: fetchFromBodies(validSourceBodies()) }));
      const preview = await postJson(started.port, "/api/preview", { profileName: "r2b9b", dshHome: prod.home, liveState: "not-running", acknowledged: true }, authHeaders(started.token));
      assert.equal(preview.json.ok, true, JSON.stringify(preview.json).slice(0, 400));
      assert.equal(preview.json.target.classification, "PRODUCTION");
      assert.equal(preview.json.attestation.mode, "NOT_RUNNING");
      const res = await postJson(started.port, "/api/apply", {
        previewId: preview.json.previewId,
        confirmed: true,
        selection: selectionFor(preview.json),
      }, authHeaders(started.token));
      assert.equal(res.json.ok, true, JSON.stringify(res.json).slice(0, 600));
      assert.equal(res.json.status, "UPDATED");
      assert.equal(res.json.liveActivation, "UNKNOWN_LIVE_UNVERIFIED");
      assert.ok(String(res.json.attestationText).includes("NOT_RUNNING"));
    } finally { try { prod.cleanup(); } catch {} try { prod.restore(); } catch {} }
  });
  it("9: matching selection admits on scratch", async (t) => {
    const { started, preview } = await previewProfile(t, home, "r2b9");
    const res = await postJson(started.port, "/api/apply", {
      previewId: preview.previewId,
      confirmed: true,
      selection: selectionFor(preview),
    }, authHeaders(started.token));
    assert.equal(res.json.ok, true, JSON.stringify(res.json).slice(0, 500));
    assert.equal(res.json.status, "UPDATED");
    assert.equal(res.json.liveActivation, "UNKNOWN_LIVE_UNVERIFIED");
  });
});
