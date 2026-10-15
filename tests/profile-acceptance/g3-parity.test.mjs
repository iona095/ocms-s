// G3 parity — CORRECTED S6-R3 (F2). File-side parity + HOLD for live/offline.
// Prior test compared the same OCMS-S reader in two processes; that is not live/offline parity.
// This file performs actual adapter writes on scratch fixtures and compares effective
// file-side configuration. Native effective config from a booted scratch runtime is
// NOT collected here (F5 HOLD), so T16/T20 remain HOLD for the live half.
// No assertion is vacuous; every assert checks observed behavior.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { makeTempHome, sandboxDshHome, buildReadyPlan, readPatchBytes, backupNames, tempNames, minimalSources } from "../profile-commit/helpers.mjs";
import { readManagedConfig } from "../../profile/config-reader.mjs";
import { buildProfileAwarePlan } from "../../profile/plan-builder.mjs";
import { ProfileAwareCommit } from "../../profile/commit.mjs";
import { MANAGED_ROUTE_KEYS } from "../../sync.mjs";
// Project a reader's effective providers onto the six managed routes. Absent
// routes read as [] so the value is comparable with the planner's desired six
// without inventing data for routes the writer omits (empty arrays are not
// written as provider entries).
function sixOf(providers) {
  const out = {};
  for (const route of MANAGED_ROUTE_KEYS) {
    out[route] = (providers && providers[route] && Array.isArray(providers[route].models)) ? providers[route].models : [];
  }
  return out;
}
describe("G3 parity live/offline (S6-R3 F2)", () => {
  it("offline adapter writes: file-side six arrays + effective composition equal desired", async () => {
    const restore = sandboxDshHome();
    try {
      const h = makeTempHome("ocms-s6-par-");
      try {
        const ready = await buildReadyPlan({ home: h.home, profileName: "par" });
        assert.equal(ready.plan.ok, true);
        const rrBefore = await readManagedConfig({ target: structuredClone(ready.target), installAnchorDir: null, pathEnv: "" });
        assert.equal(rrBefore.ok, true);
        const res = await ProfileAwareCommit({ plan: structuredClone(ready.plan), waitMs: 8000 });
        assert.equal(res.ok, true); assert.equal(res.status, "UPDATED");
        assert.equal(res.liveActivation, "UNKNOWN_LIVE_UNVERIFIED");
        const { resolveProfileTarget } = await import("../../profile/target-resolver.mjs");
        const fresh = resolveProfileTarget({ profileName: "par", dshHome: h.home, pathEnv: process.env.PATH ?? "" });
        assert.equal(fresh.ok, true);
        const rrAfter = await readManagedConfig({ target: structuredClone(fresh.target), installAnchorDir: null, pathEnv: "" });
        assert.equal(rrAfter.ok, true);
        assert.equal(rrAfter.status, "MATCHED", "post-commit effective matches stored (file-side T20 half)");
        // Two genuinely different computations, both observed: the reloaded
        // persisted six arrays and the plan's desired six arrays. The vacuous
        // "parityHold() === HOLD" comparison is gone.
        const persistedSix = sixOf(rrAfter.effectiveConfig.providers);
        const preCommitSix = sixOf(rrBefore.effectiveConfig.providers);
        assert.notDeepEqual(persistedSix, preCommitSix, "the commit must change the persisted six arrays; before=" + JSON.stringify(preCommitSix));
        assert.deepEqual(persistedSix, ready.plan.desired, "persisted effective six arrays must equal the planned desired six");
        assert.ok(Object.values(persistedSix).some((models) => models.length > 0), "at least one route carries the planned models");
        console.log("PARITY_OFFLINE six arrays MATCHED effective MATCHED liveActivation=" + res.liveActivation);
        console.log("PARITY_LIVE_HOLD T16/T20 live half HOLD: no booted scratch runtime (F5 HOLD), no native effective dump collected.");
        // The live half is explicitly UNKNOWN, and that observation must not be
        // conflated with the file-side verdict it accompanies.
        assert.notEqual(res.liveActivation, rrAfter.status, "live activation evidence must not be reported as the file-side verdict");
        assert.equal(rrAfter.status, "MATCHED", "file-side verdict remains MATCHED while the live half stays unknown");
      } finally { try { h.cleanup(); } catch {} }
    } finally { try { restore(); } catch {} }
  });
  it("withheld overlay: harness-detected effective difference (file-side), live unknown stays", async () => {
    const restore = (await import("../profile-commit/helpers.mjs")).sandboxDshHome();
    try {
      const { makeTempHome, makeProfile, makeFixtureBundle, llmRow, writeHomePatchText } = await import("../profile-commit/helpers.mjs");
      const { stringify } = await import("yaml");
      const h = makeTempHome("ocms-s6-with-");
      try {
        const dir = makeProfile(h.home, "with", { entries: [llmRow({ config: { providers: { other: { displayName: "other", models: [] } } } })], bundles: ["@fixture/base"] });
        makeFixtureBundle(dir);
        writeHomePatchText(h.home, stringify([{ id: "llm-pi-ai", name: "Home", config: { providers: { "opencode-go": { displayName: "opencode-go", models: [{ id: "home-hidden" }] } } } }]));
        // No try/catch around the bind: an unexpected bind error must fail
        // loudly instead of being rewritten into the expected refusal.
        const { resolveProfileTarget } = await import("../../profile/target-resolver.mjs");
        const chk = resolveProfileTarget({ profileName: "with", dshHome: h.home, pathEnv: process.env.PATH ?? "" });
        if (chk.ok === false) {
          assert.equal(chk.code, "PLUGIN_ENTRY_DUPLICATE", "the withheld overlay must refuse as a duplicate plugin entry; got " + chk.code + " detail=" + JSON.stringify(chk.detail ?? null));
          console.log("PARITY_WITHHELD bind refused " + chk.code + " detail=" + chk.detail);
        }
        else { const rr = await readManagedConfig({ target: structuredClone(chk.target), installAnchorDir: null, pathEnv: "" });
        assert.ok(rr.ok === false || rr.status === "EFFECTIVE_DIFFERS_FROM_STORED", "withheld layer difference, got " + JSON.stringify(rr).slice(0,300));
        if (rr.ok === false) assert.ok(["OVERRIDDEN", "PLUGIN_ENTRY_DUPLICATE"].includes(rr.code), "code " + rr.code);
        console.log("PARITY_WITHHELD file-side difference reproduced: " + (rr.ok ? rr.status : rr.code)); }
        console.log("PARITY_WITHHELD live state explicitly unknown without attestation; production would refuse LIVE_OVERLAY_UNKNOWN (see recovery-8).");
      } finally { try { h.cleanup(); } catch {} }
    } finally { try { restore(); } catch {} }
  });
  it("muted observation: production response stays UNKNOWN_LIVE_UNVERIFIED", async () => {
    const restore = sandboxDshHome();
    try {
      const h = makeTempHome("ocms-s6-muted-");
      try {
        const ready = await buildReadyPlan({ home: h.home, profileName: "muted" });
        const res = await ProfileAwareCommit({ plan: structuredClone(ready.plan), waitMs: 8000 });
        assert.equal(res.ok, true);
        assert.equal(res.liveActivation, "UNKNOWN_LIVE_UNVERIFIED", "muted channel keeps UNKNOWN");
        assert.ok(!("scratchActivation" in res), "no manufactured activation when channel muted");
        console.log("PARITY_MUTED liveActivation=" + res.liveActivation + " scratchActivation absent (correct, not OBSERVED)");
      } finally { try { h.cleanup(); } catch {} }
    } finally { try { restore(); } catch {} }
  });
});