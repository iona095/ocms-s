// S5 S4 amendment part1
import { describe, it, beforeEach, afterEach } from "node:test";
import { assert, buildReadyPlan, backupNames, tempNames, readPatchBytes, patchMtimeMs, minimalSources } from "./helpers.mjs";
import { makeProductionHome, makeProfile as makeS5Profile, llmRow as s5Row } from "../profile-cli-ui/helpers.mjs";
import { makeTempHome, sandboxDshHome, makeProfile as makeS4Profile, makeFixtureBundle, llmRow as s4Row, writeOverlayText } from "./helpers.mjs";
import { stringify as stringifyYaml } from "yaml";
import { ProfileAwareCommit } from "../../profile/commit.mjs";
describe("S5 commit admission", () => {
  let home; let restore; let cleanupHome;
  beforeEach(() => { restore = sandboxDshHome(); const h = makeTempHome(); home = h.home; cleanupHome = h.cleanup; });
  afterEach(() => { try { cleanupHome(); } catch {} try { restore(); } catch {} });
  it("scratch commits", async () => {
    const built = await buildReadyPlan({ home });
    const res = await ProfileAwareCommit({ plan: structuredClone(built.plan), waitMs: 8000 });
    assert.equal(res.ok, true);
    assert.equal(res.liveActivation, "UNKNOWN_LIVE_UNVERIFIED");
  });
  it("production without attestation refuses", async () => {
    const prod = makeProductionHome();
    try {
      makeFixtureBundle(makeS4Profile(prod.home, "prodA", { entries: [s4Row({ config: { providers: { other: { displayName: "other", models: [] } } } })], bundles: ["@fixture/base"] }));
      const { readManagedConfig } = await import("../../profile/config-reader.mjs");
      const { buildProfileAwarePlan } = await import("../../profile/plan-builder.mjs");
      const { resolveProfileTarget } = await import("../../profile/target-resolver.mjs");
      const rr = resolveProfileTarget({ profileName: "prodA", dshHome: prod.home, pathEnv: process.env.PATH ?? "" });
      assert.equal(rr.ok, true, JSON.stringify(rr).slice(0, 600));
      assert.equal(rr.target.classification, "PRODUCTION");
      const readerResult = await readManagedConfig({ target: structuredClone(rr.target), installAnchorDir: null, pathEnv: "" });
      assert.equal(readerResult.ok, true);
      const plan = buildProfileAwarePlan({ target: structuredClone(rr.target), readerResult, sources: minimalSources() });
      assert.equal(plan.ok, true, JSON.stringify(plan).slice(0, 600));
      const dir = prod.home + "/profiles/prodA";
      const { readPatchBytes: rpb, patchMtimeMs: mtime, backupNames: bn, tempNames: tn } = await import("./helpers.mjs");
      const { default: path } = await import("node:path");
      void path;
      const before = rpb(dir);
      const m0 = mtime(dir);
      const res = await ProfileAwareCommit({ plan: structuredClone(plan), waitMs: 8000 });
      assert.equal(res.ok, false);
      assert.equal(res.code, "LIVE_OVERLAY_UNKNOWN");
      assert.deepEqual(bn(dir), []);
      assert.deepEqual(tn(dir), []);
      assert.ok(rpb(dir).equals(before));
      assert.equal(mtime(dir), m0);
    } finally { try { prod.cleanup(); } catch {} try { prod.restore(); } catch {} }
  });
  it("production with mode-A admits and NO_CHANGE carries liveActivation", async () => {
    const la = await import("../../profile/live-attestation.mjs");
    const prod = makeProductionHome();
    try {
      makeFixtureBundle(makeS4Profile(prod.home, "prodB", { entries: [s4Row({ config: { providers: { other: { displayName: "other", models: [] } } } })], bundles: ["@fixture/base"] }));
      const { readManagedConfig } = await import("../../profile/config-reader.mjs");
      const { buildProfileAwarePlan } = await import("../../profile/plan-builder.mjs");
      const { resolveProfileTarget } = await import("../../profile/target-resolver.mjs");
      const rr = resolveProfileTarget({ profileName: "prodB", dshHome: prod.home, pathEnv: process.env.PATH ?? "" });
      assert.equal(rr.ok, true);
      const made = la.createLiveAttestation({ profileName: "prodB", mode: "NOT_RUNNING", origin: "CLI", acknowledged: true });
      assert.equal(made.ok, true);
      const target = structuredClone(rr.target);
      target.liveAttestation = made.attestation;
      target.declaredOverlays = [];
      const readerResult = await readManagedConfig({ target: structuredClone(target), installAnchorDir: null, pathEnv: "" });
      assert.equal(readerResult.ok, true);
      const plan = buildProfileAwarePlan({ target: structuredClone(target), readerResult, sources: minimalSources() });
      assert.equal(plan.ok, true);
      const res = await ProfileAwareCommit({ plan: structuredClone(plan), waitMs: 8000 });
      assert.equal(res.ok, true, JSON.stringify(res).slice(0, 800));
      assert.equal(res.liveActivation, "UNKNOWN_LIVE_UNVERIFIED");
      const rrFresh = resolveProfileTarget({ profileName: "prodB", dshHome: prod.home, pathEnv: process.env.PATH ?? "", declaredOverlays: [], liveAttestation: structuredClone(made.attestation) });
      assert.equal(rrFresh.ok, true, JSON.stringify(rrFresh).slice(0, 500));
      const target2 = structuredClone(rrFresh.target);
      const reader2 = await readManagedConfig({ target: structuredClone(target2), installAnchorDir: null, pathEnv: "" });
      assert.equal(reader2.ok, true);
      const plan2 = buildProfileAwarePlan({ target: structuredClone(target2), readerResult: reader2, sources: minimalSources() });
      assert.equal(plan2.ok, true);
      assert.equal(plan2.status, "NO_CHANGE");
      const res2 = await ProfileAwareCommit({ plan: plan2, waitMs: 8000 });
      assert.equal(res2.ok, true, JSON.stringify(res2).slice(0, 800));
      assert.equal(res2.status, "NO_CHANGE");
      assert.equal(res2.liveActivation, "UNKNOWN_LIVE_UNVERIFIED");
    } finally { try { prod.cleanup(); } catch {} try { prod.restore(); } catch {} }
  });
  it("production with mode-B exact-overlays admits end to end", async () => {
    const la = await import("../../profile/live-attestation.mjs");
    const prod = makeProductionHome();
    try {
      makeFixtureBundle(makeS4Profile(prod.home, "prodD", { entries: [s4Row({ config: { providers: { other: { displayName: "other", models: [] } } } })], bundles: ["@fixture/base"] }));
      const overPath = writeOverlayText(prod.home, "owner-overlay.yml", stringifyYaml([{ id: "unrelated-plugin", name: "Unrelated" }]));
      const { readManagedConfig } = await import("../../profile/config-reader.mjs");
      const { buildProfileAwarePlan } = await import("../../profile/plan-builder.mjs");
      const { resolveProfileTarget } = await import("../../profile/target-resolver.mjs");
      const made = la.createLiveAttestation({ profileName: "prodD", mode: "EXACT_OVERLAYS", overlays: [overPath], origin: "CLI", acknowledged: true });
      assert.equal(made.ok, true);
      const rr = resolveProfileTarget({ profileName: "prodD", dshHome: prod.home, pathEnv: process.env.PATH ?? "", declaredOverlays: [overPath], liveAttestation: structuredClone(made.attestation) });
      assert.equal(rr.ok, true, JSON.stringify(rr).slice(0, 500));
      assert.equal(rr.target.classification, "PRODUCTION");
      const readerResult = await readManagedConfig({ target: structuredClone(rr.target), installAnchorDir: null, pathEnv: "" });
      assert.equal(readerResult.ok, true, JSON.stringify(readerResult).slice(0, 500));
      const plan = buildProfileAwarePlan({ target: structuredClone(rr.target), readerResult, sources: minimalSources() });
      assert.equal(plan.ok, true, JSON.stringify(plan).slice(0, 600));
      const res = await ProfileAwareCommit({ plan: structuredClone(plan), waitMs: 8000 });
      assert.equal(res.ok, true, JSON.stringify(res).slice(0, 800));
      assert.equal(res.status, "UPDATED");
      assert.equal(res.liveActivation, "UNKNOWN_LIVE_UNVERIFIED");
    } finally { try { prod.cleanup(); } catch {} try { prod.restore(); } catch {} }
  });
  it("production with contradictory attestation refuses", async () => {
    const la = await import("../../profile/live-attestation.mjs");
    const prod = makeProductionHome();
    try {
      makeFixtureBundle(makeS4Profile(prod.home, "prodC", { entries: [s4Row({ config: { providers: { other: { displayName: "other", models: [] } } } })], bundles: ["@fixture/base"] }));
      const { readManagedConfig } = await import("../../profile/config-reader.mjs");
      const { buildProfileAwarePlan } = await import("../../profile/plan-builder.mjs");
      const { resolveProfileTarget } = await import("../../profile/target-resolver.mjs");
      const rr = resolveProfileTarget({ profileName: "prodC", dshHome: prod.home, pathEnv: process.env.PATH ?? "" });
      assert.equal(rr.ok, true);
      const made = la.createLiveAttestation({ profileName: "other-profile", mode: "NOT_RUNNING", origin: "CLI", acknowledged: true });
      assert.equal(made.ok, true);
      const target = structuredClone(rr.target);
      target.liveAttestation = made.attestation;
      target.declaredOverlays = [];
      const readerResult = await readManagedConfig({ target: structuredClone(target), installAnchorDir: null, pathEnv: "" });
      assert.equal(readerResult.ok, true);
      const plan = buildProfileAwarePlan({ target: structuredClone(target), readerResult, sources: minimalSources() });
      assert.equal(plan.ok, true);
      const dir = prod.home + "/profiles/prodC";
      const res = await ProfileAwareCommit({ plan: structuredClone(plan), waitMs: 8000 });
      assert.equal(res.ok, false);
      assert.equal(res.code, "LIVE_OVERLAY_UNKNOWN");
      assert.deepEqual(backupNames(dir), []);
    } finally { try { prod.cleanup(); } catch {} try { prod.restore(); } catch {} }
  });
});
