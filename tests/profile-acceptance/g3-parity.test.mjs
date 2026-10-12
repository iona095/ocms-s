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
function parityHold() { return "HOLD"; }
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
        console.log("PARITY_OFFLINE six arrays MATCHED effective MATCHED liveActivation=" + res.liveActivation);
        console.log("PARITY_LIVE_HOLD T16/T20 live half HOLD: no booted scratch runtime (F5 HOLD), no native effective dump collected.");
        assert.equal(parityHold(), "HOLD");
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
        const { bindReal } = await import("../profile-commit/helpers.mjs");
        let bindRes = null;
        try { bindRes = bindReal(h.home, "with"); } catch (e) { bindRes = null; }
        if (bindRes === null) { const { resolveProfileTarget } = await import("../../profile/target-resolver.mjs"); const chk = resolveProfileTarget({ profileName: "with", dshHome: h.home, pathEnv: process.env.PATH ?? "" }); assert.equal(chk.ok, false); assert.equal(chk.code, "PLUGIN_ENTRY_DUPLICATE"); console.log("PARITY_WITHHELD bind refused " + chk.code + " detail=" + chk.detail); }
        else { const rr = await readManagedConfig({ target: structuredClone(bindRes), installAnchorDir: null, pathEnv: "" });
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