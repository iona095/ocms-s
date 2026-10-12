// R4-B1 RED->GREEN — enforce confirmed:true (ticket section 2).
// Profile Apply admission must require the exact boolean confirmed === true.
// Disposable TEMP fixtures only; mock every source request; offline.
import { describe, it, beforeEach, afterEach } from "node:test";
import { assert, makeTempHome, sandboxDshHome, withR2Port } from "./helpers.mjs";
import { makeProfile as makeS4Profile, makeFixtureBundle, llmRow as s4Row, backupNames, readPatchBytes } from "../profile-commit/helpers.mjs";
import { startTestServer, postJson, authHeaders, fetchFromBodies, validSourceBodies, scratchSettingsFile } from "../v1.3/helpers.mjs";
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
  assert.equal(preview.json.ok, true, JSON.stringify(preview.json).slice(0, 500));
  return { started, preview: preview.json, dir };
}
describe("R4-B1 confirmation gate", () => {
  let home; let cleanupHome; let restore;
  beforeEach(() => { restore = sandboxDshHome(); const h = makeTempHome(); home = h.home; cleanupHome = h.cleanup; });
  afterEach(() => { try { cleanupHome(); } catch {} try { restore(); } catch {} });
  it("READY preview + confirmed:false refuses CONFIRMATION_REQUIRED zero write", async (t) => {
    const { started, preview, dir } = await previewProfile(t, home, "r4cFalse");
    const before = readPatchBytes(dir);
    const res = await postJson(started.port, "/api/apply", { previewId: preview.previewId, confirmed: false, selection: selectionFor(preview) }, authHeaders(started.token));
    assert.equal(res.json.ok, false, JSON.stringify(res.json).slice(0, 500));
    assert.equal(res.json.code, "CONFIRMATION_REQUIRED");
    assert.ok(readPatchBytes(dir).equals(before), "zero write required");
    assert.deepEqual(backupNames(dir), []);
  });
  it("confirmed:null refuses", async (t) => {
    const { started, preview, dir } = await previewProfile(t, home, "r4cNull");
    const before = readPatchBytes(dir);
    const res = await postJson(started.port, "/api/apply", { previewId: preview.previewId, confirmed: null, selection: selectionFor(preview) }, authHeaders(started.token));
    assert.equal(res.json.ok, false, JSON.stringify(res.json).slice(0, 500));
    assert.equal(res.json.code, "CONFIRMATION_REQUIRED");
    assert.ok(readPatchBytes(dir).equals(before));
    assert.deepEqual(backupNames(dir), []);
  });
  it("confirmed:0 refuses", async (t) => {
    const { started, preview, dir } = await previewProfile(t, home, "r4cZero");
    const before = readPatchBytes(dir);
    const res = await postJson(started.port, "/api/apply", { previewId: preview.previewId, confirmed: 0, selection: selectionFor(preview) }, authHeaders(started.token));
    assert.equal(res.json.ok, false, JSON.stringify(res.json).slice(0, 500));
    assert.equal(res.json.code, "CONFIRMATION_REQUIRED");
    assert.ok(readPatchBytes(dir).equals(before));
    assert.deepEqual(backupNames(dir), []);
  });
  it('confirmed:"true" refuses', async (t) => {
    const { started, preview, dir } = await previewProfile(t, home, "r4cStr");
    const before = readPatchBytes(dir);
    const res = await postJson(started.port, "/api/apply", { previewId: preview.previewId, confirmed: "true", selection: selectionFor(preview) }, authHeaders(started.token));
    assert.equal(res.json.ok, false, JSON.stringify(res.json).slice(0, 500));
    assert.equal(res.json.code, "CONFIRMATION_REQUIRED");
    assert.ok(readPatchBytes(dir).equals(before));
    assert.deepEqual(backupNames(dir), []);
  });
  it("missing confirmation refuses", async (t) => {
    const { started, preview, dir } = await previewProfile(t, home, "r4cMissing");
    const before = readPatchBytes(dir);
    const res = await postJson(started.port, "/api/apply", { previewId: preview.previewId, selection: selectionFor(preview) }, authHeaders(started.token));
    assert.equal(res.json.ok, false, JSON.stringify(res.json).slice(0, 500));
    assert.equal(res.json.code, "CONFIRMATION_REQUIRED");
    assert.ok(readPatchBytes(dir).equals(before));
    assert.deepEqual(backupNames(dir), []);
  });
  it("matching confirmed:true still succeeds UPDATED", async (t) => {
    const { started, preview } = await previewProfile(t, home, "r4cTrue");
    const res = await postJson(started.port, "/api/apply", { previewId: preview.previewId, confirmed: true, selection: selectionFor(preview) }, authHeaders(started.token));
    assert.equal(res.json.ok, true, JSON.stringify(res.json).slice(0, 600));
    assert.equal(res.json.status, "UPDATED");
  });
  it("NO_CHANGE obeys same gate", async (t) => {
    const { started, preview, dir } = await previewProfile(t, home, "r4cNoChange");
    const first = await postJson(started.port, "/api/apply", { previewId: preview.previewId, confirmed: true, selection: selectionFor(preview) }, authHeaders(started.token));
    assert.equal(first.json.ok, true, JSON.stringify(first.json).slice(0, 500));
    assert.equal(first.json.status, "UPDATED");
    const preview2 = await postJson(started.port, "/api/preview", { profileName: "r4cNoChange", dshHome: home }, authHeaders(started.token));
    assert.equal(preview2.json.ok, true);
    assert.equal(preview2.json.state, "NO_CHANGE");
    const before = readPatchBytes(dir);
    const refused = await postJson(started.port, "/api/apply", { previewId: preview2.json.previewId, confirmed: false, selection: selectionFor(preview2.json) }, authHeaders(started.token));
    assert.equal(refused.json.ok, false, JSON.stringify(refused.json).slice(0, 500));
    assert.equal(refused.json.code, "CONFIRMATION_REQUIRED");
    assert.ok(readPatchBytes(dir).equals(before));
    const admitted = await postJson(started.port, "/api/apply", { previewId: preview2.json.previewId, confirmed: true, selection: selectionFor(preview2.json) }, authHeaders(started.token));
    assert.equal(admitted.json.ok, true, JSON.stringify(admitted.json).slice(0, 500));
    assert.equal(admitted.json.status, "NO_CHANGE");
  });
});
