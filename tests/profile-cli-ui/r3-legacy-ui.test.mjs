// R3-B2 RED — explicit UI legacy target admission (R3 ticket section 3).
// A server launched without an explicit profile or settings target must
// never implicitly Preview/Apply default production settings.yaml; explicit
// legacy paths are admitted only after SCRATCH classification. Loopback +
// disposable TEMP fixtures only.
import { describe, it, beforeEach, afterEach } from "node:test";
import { assert, makeTempHome, sandboxDshHome, makeProductionHome, writeTextFile, joinPath, withR2Port } from "./helpers.mjs";
import { makeProfile as makeS4Profile, makeFixtureBundle, llmRow as s4Row } from "../profile-commit/helpers.mjs";
import { startTestServer, postJson, authHeaders, fetchFromBodies, validSourceBodies, scratchSettingsFile, getJson } from "../v1.3/helpers.mjs";
import { defaultSettingsPath } from "../../sync.mjs";
describe("R3-B2 legacy admission (RED)", () => {
  let home; let cleanupHome; let restore;
  beforeEach(() => { restore = sandboxDshHome(); const h = makeTempHome(); home = h.home; cleanupHome = h.cleanup; });
  afterEach(() => { try { cleanupHome(); } catch {} try { restore(); } catch {} });
  it("no explicit target + empty picker refuses before fetch", async (t) => {
    const ui = await import("../../ui.mjs");
    let calls = 0;
    const inner = fetchFromBodies(validSourceBodies());
    const started = await withR2Port(t, (port) => ui.startServer({ port, fetchFn: async (...a) => { calls += 1; return inner(...a); }, openBrowser: false }));
    const res = await postJson(started.port, "/api/preview", {}, authHeaders(started.token));
    assert.equal(res.json.ok, false);
    assert.equal(res.json.code, "PROFILE_REQUIRED");
    assert.equal(calls, 0);
  });
  it("bare server state never names the default real settings path", async (t) => {
    const ui = await import("../../ui.mjs");
    const started = await withR2Port(t, (port) => ui.startServer({ port, fetchFn: fetchFromBodies(validSourceBodies()), openBrowser: false }));
    const state = await getJson(started.port, "/api/state");
    assert.equal(state.json.ok, true);
    assert.equal(state.json.target.displayPath, null);
    assert.ok(state.json.target.displayPath !== defaultSettingsPath());
  });
  it("explicit production settings path refuses before fetch", async (t) => {
    const prod = makeProductionHome();
    try {
      const p = writeTextFile(joinPath(prod.home, "settings.yaml"), "llm-pi-ai:\n  providers: {}\n");
      const ui = await import("../../ui.mjs");
      let calls = 0;
      const inner = fetchFromBodies(validSourceBodies());
      const started = await withR2Port(t, (port) => ui.startServer({ settingsPath: p, port, fetchFn: async (...a) => { calls += 1; return inner(...a); }, openBrowser: false }));
      const res = await postJson(started.port, "/api/preview", {}, authHeaders(started.token));
      assert.equal(res.json.ok, false);
      assert.equal(res.json.code, "PRODUCTION_SETTINGS_REFUSED");
      assert.equal(calls, 0);
    } finally { try { prod.cleanup(); } catch {} try { prod.restore(); } catch {} }
  });
  it("explicit scratch settings retains Preview/Apply lifecycle", async (t) => {
    const file = scratchSettingsFile(t);
    const started = await withR2Port(t, (port) => startTestServer(t, { settingsPath: file, port, fetchFn: fetchFromBodies(validSourceBodies()) }));
    const preview = await postJson(started.port, "/api/preview", {}, authHeaders(started.token));
    assert.equal(preview.json.ok, true);
    assert.equal(preview.json.profile, undefined);
    const applied = await postJson(started.port, "/api/apply", { previewId: preview.json.previewId }, authHeaders(started.token));
    assert.equal(applied.json.ok, true);
    assert.equal(applied.json.status, "UPDATED");
  });
  it("profile selection works on a targetless server", async (t) => {
    const dir = makeS4Profile(home, "r3prof", { entries: [s4Row({ config: { providers: { other: { displayName: "other", models: [] } } } })], bundles: ["@fixture/base"] });
    makeFixtureBundle(dir);
    const ui = await import("../../ui.mjs");
    const started = await withR2Port(t, (port) => ui.startServer({ port, fetchFn: fetchFromBodies(validSourceBodies()), openBrowser: false }));
    const preview = await postJson(started.port, "/api/preview", { profileName: "r3prof", dshHome: home }, authHeaders(started.token));
    assert.equal(preview.json.ok, true);
    assert.equal(preview.json.profile, true);
    assert.equal(preview.json.target.profileName, "r3prof");
  });
  it("token protection still guards preview on an admitted server", async (t) => {
    const file = scratchSettingsFile(t);
    const started = await withR2Port(t, (port) => startTestServer(t, { settingsPath: file, port, fetchFn: fetchFromBodies(validSourceBodies()) }));
    const res = await postJson(started.port, "/api/preview", {}, {});
    assert.equal(res.json.ok, false);
    assert.equal(res.json.code, "BAD_TOKEN");
  });
});
