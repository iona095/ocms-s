// S3b retained-preview-after-vanish [follow-up to S3]. Verdict NOT REPRODUCIBLE through
// the HTTP API: verify re-resolves and re-reads before commit, so a vanished profile is
// refused STALE_PREVIEW and the retained slot is cleared. This guard pins that behavior.
// Synthetic scratch profiles only; every home and DSH_HOME is under os.tmpdir().
import { describe, it, beforeEach, afterEach } from "node:test";
import fs from "node:fs";
import path from "node:path";
import { assert, makeTempHome, sandboxDshHome, withR2Port } from "../profile-cli-ui/helpers.mjs";
import { makeProfile as makeS4Profile, makeFixtureBundle, llmRow as s4Row } from "../profile-commit/helpers.mjs";
import { startTestServer, postJson, authHeaders, fetchFromBodies, validSourceBodies, scratchSettingsFile } from "../v1.3/helpers.mjs";
const seed = () => [s4Row({ config: { providers: { other: { displayName: "other", models: [] } } } })];
describe("S3b retained preview after vanish (guard)", () => {
  let home; let cleanupHome; let restore;
  beforeEach(() => { restore = sandboxDshHome(); const h = makeTempHome(); home = h.home; cleanupHome = h.cleanup; });
  afterEach(() => { try { cleanupHome(); } catch {} try { restore(); } catch {} });
  for (const mode of ["manifest", "directory"]) {
    it("vanished profile (" + mode + "): Apply refuses STALE_PREVIEW and clears the retained Preview", async (t) => {
      const dir = makeS4Profile(home, "vanish", { entries: seed(), bundles: ["@fixture/base"] });
      makeFixtureBundle(dir);
      const file = scratchSettingsFile(t);
      const started = await withR2Port(t, (port) => startTestServer(t, { settingsPath: file, port, fetchFn: fetchFromBodies(validSourceBodies()) }));
      const p = await postJson(started.port, "/api/preview", { profileName: "vanish", dshHome: home }, authHeaders(started.token));
      assert.equal(p.json.ok, true);
      if (mode === "manifest") fs.rmSync(path.join(dir, "package.json"), { force: true });
      else fs.rmSync(dir, { recursive: true, force: true });
      const sel = { profileName: p.json.target.profileName, declaredOverlays: p.json.declaredOverlays, attestation: p.json.attestation };
      const a = await postJson(started.port, "/api/apply", { previewId: p.json.previewId, confirmed: true, selection: sel }, authHeaders(started.token));
      assert.equal(a.json.ok, false);
      assert.equal(a.json.code, "STALE_PREVIEW");
      const replay = await postJson(started.port, "/api/apply", { previewId: p.json.previewId }, authHeaders(started.token));
      assert.equal(replay.json.code, "STALE_PREVIEW", "retained slot must be cleared after the refusal");
    });
  }
});
