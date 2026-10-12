// R3-B1 RED — explicit settings CLI safety (R3 ticket section 2).
// A SCRATCH --settings target must Preview (existing buildPlan) + display +
// obtain affirmative confirmation before the retained plan may reach the
// existing commitPlan. No refetch/replan at Apply; byte-stale refuses via
// the original legacy stale protection. Mock fetch, injected confirmation,
// disposable TEMP fixtures only.
import { describe, it, beforeEach, afterEach } from "node:test";
import path from "node:path";
import { assert, makeTempHome, sandboxDshHome, makeProductionHome, writeTextFile, joinPath } from "./helpers.mjs";
import { dispatchSyncCli } from "../../sync.mjs";
import { fetchFromBodies, validSourceBodies, scratchSettingsFile, readSettingsBytes, backupCount, tempResidue } from "../v1.3/helpers.mjs";
function fetchCounter() {
  let calls = 0;
  const inner = fetchFromBodies(validSourceBodies());
  return { count: () => calls, fn: async (...a) => { calls += 1; return inner(...a); } };
}
describe("R3-B1 settings CLI (RED)", () => {
  let home; let cleanupHome; let restore;
  beforeEach(() => { restore = sandboxDshHome(); const h = makeTempHome(); home = h.home; cleanupHome = h.cleanup; });
  afterEach(() => { try { cleanupHome(); } catch {} try { restore(); } catch {} });
  it("unconfirmed scratch settings creates no backup, temp or write", async (t) => {
    const file = scratchSettingsFile(t);
    const dir = path.dirname(file);
    const before = readSettingsBytes(file);
    const fc = fetchCounter();
    const res = await dispatchSyncCli(["--settings", file], { fetchFn: fc.fn, confirmFn: async () => false });
    assert.equal(res.ok, false);
    assert.equal(res.code, "CONFIRMATION_DECLINED");
    assert.equal(fc.count(), 5);
    assert.equal(backupCount(dir), 0);
    assert.deepEqual(tempResidue(dir), []);
    assert.ok(readSettingsBytes(file).equals(before));
  });
  it("declined confirmation creates no write", async (t) => {
    const file = scratchSettingsFile(t);
    const dir = path.dirname(file);
    const before = readSettingsBytes(file);
    const res = await dispatchSyncCli(["--settings", file], {
      fetchFn: fetchFromBodies(validSourceBodies()),
      confirmFn: async () => "n",
    });
    assert.equal(res.ok, false);
    assert.equal(res.code, "CONFIRMATION_DECLINED");
    assert.equal(backupCount(dir), 0);
    assert.ok(readSettingsBytes(file).equals(before));
  });
  it("affirmative confirmation commits the retained plan once", async (t) => {
    const file = scratchSettingsFile(t);
    const dir = path.dirname(file);
    const before = readSettingsBytes(file);
    const fc = fetchCounter();
    const res = await dispatchSyncCli(["--settings", file], { fetchFn: fc.fn, confirmFn: async () => true });
    assert.equal(res.ok, true, JSON.stringify(res).slice(0, 500));
    assert.equal(res.result, "UPDATED");
    assert.equal(fc.count(), 5);
    assert.equal(backupCount(dir), 1);
    assert.deepEqual(tempResidue(dir), []);
    assert.ok(!readSettingsBytes(file).equals(before));
  });
  it("second run is NO_CHANGE with no additional backup", async (t) => {
    const file = scratchSettingsFile(t);
    const dir = path.dirname(file);
    const fc = fetchCounter();
    const first = await dispatchSyncCli(["--settings", file], { fetchFn: fc.fn, confirmFn: async () => true });
    assert.equal(first.ok, true);
    assert.equal(first.result, "UPDATED");
    const second = await dispatchSyncCli(["--settings", file], { fetchFn: fc.fn, confirmFn: async () => true });
    assert.equal(second.ok, true, JSON.stringify(second).slice(0, 400));
    assert.equal(second.result, "NO_CHANGE");
    assert.equal(fc.count(), 10);
    assert.equal(backupCount(dir), 1);
  });
  it("unknown flag with settings refuses before fetch", async (t) => {
    const file = scratchSettingsFile(t);
    const fc = fetchCounter();
    const res = await dispatchSyncCli(["--settings", file, "--bogus"], { fetchFn: fc.fn, confirmFn: async () => true });
    assert.equal(res.ok, false);
    assert.equal(res.code, "UNKNOWN_FLAG");
    assert.equal(fc.count(), 0);
  });
  it("duplicate settings flags refuse before fetch", async (t) => {
    const file = scratchSettingsFile(t);
    const fc = fetchCounter();
    const res = await dispatchSyncCli(["--settings=" + file, "--settings=" + file], { fetchFn: fc.fn, confirmFn: async () => true });
    assert.equal(res.ok, false);
    assert.equal(res.code, "DUPLICATE_SETTINGS");
    assert.equal(fc.count(), 0);
  });
  it("production settings remains refused before fetch", async (t) => {
    const prod = makeProductionHome();
    try {
      const p = writeTextFile(joinPath(prod.home, "settings.yaml"), "llm-pi-ai:\n  providers: {}\n");
      const fc = fetchCounter();
      const res = await dispatchSyncCli(["--settings", p], { fetchFn: fc.fn, confirmFn: async () => true });
      assert.equal(res.ok, false);
      assert.equal(res.code, "PRODUCTION_SETTINGS_REFUSED");
      assert.equal(fc.count(), 0);
    } finally { try { prod.cleanup(); } catch {} try { prod.restore(); } catch {} }
  });
  it("byte-stale target refuses with legacy stale protection", async (t) => {
    const file = scratchSettingsFile(t);
    const dir = path.dirname(file);
    let tampered = null;
    const fc = fetchCounter();
    const res = await dispatchSyncCli(["--settings", file], {
      fetchFn: fc.fn,
      confirmFn: async () => {
        tampered = Buffer.concat([readSettingsBytes(file), Buffer.from("\n# external edit\n", "utf8")]);
        writeTextFile(file, tampered.toString("utf8"));
        return true;
      },
    });
    assert.equal(res.ok, false);
    assert.equal(res.code, "STALE_SETTINGS");
    assert.ok(readSettingsBytes(file).equals(tampered));
    assert.equal(backupCount(dir), 0);
  });
});
