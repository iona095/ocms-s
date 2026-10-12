// R2 B1 RED — executable CLI dispatch (frozen P0-R2 + R2 ticket B1).
// Bare invocation must never enter the legacy write flow; --profile drives
// S1-S3 preview + confirmed ProfileAwareCommit only; production --settings
// refuses; --profile+--settings conflicts refuse. Mock fetch, injected
// confirmation, disposable TEMP fixtures only.
import { describe, it, beforeEach, afterEach } from "node:test";
import { assert, makeTempHome, sandboxDshHome, makeProductionHome, writeTextFile, joinPath } from "./helpers.mjs";
import { makeProfile as makeS4Profile, makeFixtureBundle, llmRow as s4Row, backupNames, readPatchBytes } from "../profile-commit/helpers.mjs";
import { dispatchSyncCli, classifySettingsPath, runProfileSync } from "../../sync.mjs";
import fs from "node:fs";
import { fetchFromBodies, validSourceBodies } from "../v1.3/helpers.mjs";
function seedEntries() {
  return [s4Row({ config: { providers: { other: { displayName: "other", models: [] } } } })];
}
describe("R2 B1 CLI dispatch (RED)", () => {
  let home; let cleanupHome; let restore;
  beforeEach(() => { restore = sandboxDshHome(); const h = makeTempHome(); home = h.home; cleanupHome = h.cleanup; });
  afterEach(() => { try { cleanupHome(); } catch {} try { restore(); } catch {} });
  it("1: bare invocation refuses without fetch or write", async () => {
    let fetchCalls = 0;
    const res = await dispatchSyncCli([], { fetchFn: async () => { fetchCalls += 1; throw new Error("MUST_NOT_FETCH"); } });
    assert.equal(res.ok, false);
    assert.equal(res.code, "PROFILE_REQUIRED");
    assert.equal(fetchCalls, 0);
  });
  it("2: profile path without confirmation refuses with zero side effects", async () => {
    const dir = makeS4Profile(home, "r2cli", { entries: seedEntries(), bundles: ["@fixture/base"] });
    makeFixtureBundle(dir);
    const before = readPatchBytes(dir);
    const res = await dispatchSyncCli(["--profile", "r2cli"], {
      fetchFn: fetchFromBodies(validSourceBodies()),
      confirmFn: async () => false,
      dshHome: home,
    });
    assert.equal(res.ok, false);
    assert.equal(res.code, "CONFIRMATION_DECLINED");
    assert.ok(readPatchBytes(dir).equals(before));
    assert.deepEqual(backupNames(dir), []);
  });
  it("2b: profile path with confirmation commits once via fetch-once retained plan", async () => {
    const dir = makeS4Profile(home, "r2cliYes", { entries: seedEntries(), bundles: ["@fixture/base"] });
    makeFixtureBundle(dir);
    let fetchCalls = 0;
    const inner = fetchFromBodies(validSourceBodies());
    const res = await dispatchSyncCli(["--profile", "r2cliYes"], {
      fetchFn: async (...a) => { fetchCalls += 1; return inner(...a); },
      confirmFn: async () => true,
      dshHome: home,
    });
    assert.equal(res.ok, true, JSON.stringify(res).slice(0, 600));
    assert.equal(res.status, "UPDATED");
    assert.equal(res.liveActivation, "UNKNOWN_LIVE_UNVERIFIED");
    assert.equal(fetchCalls, 5);
    const baks = backupNames(dir);
    assert.equal(baks.length, 1);
    assert.ok(baks[0].startsWith("cordis.patch.yml.bak-"));
  });
  it("3: production --settings refuses before fetch", async () => {
    const prod = makeProductionHome();
    try {
      const p = writeTextFile(joinPath(prod.home, "settings.yaml"), "llm-pi-ai:\n  providers: {}\n");
      let fetchCalls = 0;
      const res = await dispatchSyncCli(["--settings", p], {
        fetchFn: async () => { fetchCalls += 1; throw new Error("MUST_NOT_FETCH"); },
      });
      assert.equal(res.ok, false);
      assert.ok(res.code === "PRODUCTION_SETTINGS_REFUSED" || res.code === "SCRATCH_MODE_PRODUCTION_REFUSED");
      assert.equal(fetchCalls, 0);
    } finally { try { prod.cleanup(); } catch {} try { prod.restore(); } catch {} }
  });
  it("4: --profile + --settings together refuse", async () => {
    const res = await dispatchSyncCli(["--profile", "a", "--settings", "/tmp/x.yaml"], {
      fetchFn: async () => { throw new Error("MUST_NOT_FETCH"); },
    });
    assert.equal(res.ok, false);
    assert.equal(res.code, "CONFLICTING_TARGETS");
  });
  it("CLI and UI commit profiles through the identical shared function", async () => {
    const syncSrc = fs.readFileSync(new URL("../../sync.mjs", import.meta.url), "utf8");
    const uiSrc = fs.readFileSync(new URL("../../ui.mjs", import.meta.url), "utf8");
    assert.ok(syncSrc.includes("ProfileAwareCommit"), "CLI profile path must use ProfileAwareCommit");
    assert.ok(uiSrc.includes("ProfileAwareCommit"), "UI profile path must use ProfileAwareCommit");
    const { ProfileAwareCommit } = await import("../../profile/commit.mjs");
    assert.equal(typeof runProfileSync, "function");
    assert.equal(typeof ProfileAwareCommit, "function");
  });
  it("classifySettingsPath distinguishes production from scratch", async () => {
    const prod = makeProductionHome();
    try {
      const pp = writeTextFile(joinPath(prod.home, "s.yaml"), "x: 1\n");
      assert.equal(classifySettingsPath(pp), "PRODUCTION");
      const sp = writeTextFile(joinPath(home, "s.yaml"), "x: 1\n");
      assert.equal(classifySettingsPath(sp), "SCRATCH");
    } finally { try { prod.cleanup(); } catch {} try { prod.restore(); } catch {} }
  });
});
