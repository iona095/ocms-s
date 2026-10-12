// R2 B4/B6 RED — legacy-default closure + minimal unauthenticated state.
// A profile-mode server must refuse unselected ({} ) previews instead of
// silently reaching default-settings behavior; /api/state without a token
// must not disclose profile patch paths or attestation text. Loopback +
// disposable TEMP fixtures only.
import { describe, it, beforeEach, afterEach } from "node:test";
import { assert, makeTempHome, sandboxDshHome } from "./helpers.mjs";
import { makeProfile as makeS4Profile, makeFixtureBundle, llmRow as s4Row } from "../profile-commit/helpers.mjs";
import { startTestServer, postJson, authHeaders, fetchFromBodies, validSourceBodies, scratchSettingsFile, getJson } from "../v1.3/helpers.mjs";
import { withR2Port } from "./helpers.mjs";
function seedEntries() {
  return [s4Row({ config: { providers: { other: { displayName: "other", models: [] } } } })];
}
describe("R2 B4/B6 boundaries (RED)", () => {
  let home; let cleanupHome; let restore;
  beforeEach(() => { restore = sandboxDshHome(); const h = makeTempHome(); home = h.home; cleanupHome = h.cleanup; });
  afterEach(() => { try { cleanupHome(); } catch {} try { restore(); } catch {} });
  it("11: profile-mode server refuses unselected preview", async (t) => {
    const file = scratchSettingsFile(t);
    const ui = await import("../../ui.mjs");
    const started = await withR2Port(t, (port) => ui.startServer({ settingsPath: file, port, fetchFn: fetchFromBodies(validSourceBodies()), openBrowser: false, profileName: "mustSelect" }));
    t.after(async () => { try { await started.close(); } catch {} });
    const res = await postJson(started.port, "/api/preview", {}, authHeaders(started.token));
    assert.equal(res.json.ok, false);
    assert.ok(res.json.code === "PROFILE_REQUIRED" || res.json.code === "SELECTION_REQUIRED");
  });
  it("11b: legacy-mode empty preview still reaches legacy flow", async (t) => {
    const file = scratchSettingsFile(t);
    const started = await withR2Port(t, (port) => startTestServer(t, { settingsPath: file, port, fetchFn: fetchFromBodies(validSourceBodies()) }));
    const res = await postJson(started.port, "/api/preview", {}, authHeaders(started.token));
    assert.equal(res.json.ok, true);
    assert.equal(res.json.profile, undefined);
  });
  it("12: unauthenticated state discloses no patch path or attestation", async (t) => {
    const dir = makeS4Profile(home, "r2b12", { entries: seedEntries(), bundles: ["@fixture/base"] });
    makeFixtureBundle(dir);
    const file = scratchSettingsFile(t);
    const started = await withR2Port(t, (port) => startTestServer(t, { settingsPath: file, port, fetchFn: fetchFromBodies(validSourceBodies()) }));
    const preview = await postJson(started.port, "/api/preview", { profileName: "r2b12", dshHome: home }, authHeaders(started.token));
    assert.equal(preview.json.ok, true);
    const state = await getJson(started.port, "/api/state");
    const raw = JSON.stringify(state.json);
    assert.ok(!raw.includes("attestationText"), "state leaks attestation text");
    assert.ok(!raw.includes("patchPathReal") && !raw.includes("cordis.patch"), "state leaks profile patch path");
  });
  it("13: empty comma-separated overlay entries refuse", async (t) => {
    const dir = makeS4Profile(home, "r2b13", { entries: seedEntries(), bundles: ["@fixture/base"] });
    makeFixtureBundle(dir);
    const file = scratchSettingsFile(t);
    const started = await withR2Port(t, (port) => startTestServer(t, { settingsPath: file, port, fetchFn: fetchFromBodies(validSourceBodies()) }));
    const res = await postJson(started.port, "/api/preview", { profileName: "r2b13", dshHome: home, declaredOverlays: ["C:/a.yml", "", "C:/b.yml"] }, authHeaders(started.token));
    assert.equal(res.json.ok, false);
  });
});
