// G1-C Windows timing Q5 — CORRECTED S6-R3 (F3).
// Representative ~5000-line 21-entry patch IS the target patch (not a side string).
// File-side only (no DSH boot): admitted DSH library readers + OCMS-S plan/render
// + native withFileLock/writeFileAtomic via the pinned anchor. Native Loader/HMR
// activation is NOT measured here (isolation HOLD — see G2).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { buildLargePatchText, makeTempHome, sandboxDshHome, makeProfile, makeFixtureBundle, bindReal, readerOpts, minimalSources, buildReadyPlan, readPatchBytes, backupNames, tempNames, patchMtimeMs, resolveRealScopeOrSkip } from "../profile-commit/helpers.mjs";
import { readManagedConfig } from "../../profile/config-reader.mjs";
import { buildProfileAwarePlan } from "../../profile/plan-builder.mjs";
import { ProfileAwareCommit, DEFAULT_WAIT_MS } from "../../profile/commit.mjs";
function quantile(a, q) { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; }
function stats(samples) { const s = [...samples].sort((a, b) => a - b); return { n: s.length, raw: s.map((v) => Number(v.toFixed(2))), median: quantile(s, 0.5), p95: quantile(s, 0.95), max: s[s.length - 1] }; }
function fmt(st) { return "n=" + st.n + " median=" + st.median.toFixed(2) + "ms p95=" + st.p95.toFixed(2) + "ms max=" + st.max.toFixed(2) + "ms"; }
describe("G1-C timing Q5 — large patch IN target (S6-R3 F3 correction)", () => {
  it("representative 21-entry ~5000-line patch is the measured target", async (t) => {
    const restore = sandboxDshHome();
    try {
      const h = makeTempHome("ocms-s6-timing-");
      try {
        let text = buildLargePatchText({ entries: 21 });
        if (text.includes("providers: {}")) text = text.replace("providers: {}", "providers:\n      other:\n        displayName: other\n        models: []");
        const lines = text.split("\n").length;
        const bytes = Buffer.byteLength(text, "utf8");
        console.log("TIMING_FIXTURE lines=" + lines + " bytes=" + bytes);
        assert.ok(lines >= 4000, "representative lines " + lines);
        assert.ok(bytes > 100000, "representative bytes " + bytes);
        const dir0 = makeProfile(h.home, "timing", { entries: [{ id: "llm-pi-ai", name: "@fixture/dsh-llm-fixture", config: { providers: {} } }], bundles: ["@fixture/base"] });
        makeFixtureBundle(dir0);
        fs.writeFileSync(path.join(dir0, "cordis.patch.yml"), text, "utf8");
        const target = bindReal(h.home, "timing");
        const dir = path.join(h.home, "profiles", "timing");
        const onDisk = readPatchBytes(dir).toString("utf8");
        assert.equal(onDisk.split("\n").length, lines, "target patch IS the large fixture");
        assert.ok(onDisk.includes("decoy-19"), "21 entries present");
        const readSamples = [];
        let rr0 = null;
        for (let i = 0; i < 30; i++) {
          const s0 = performance.now();
          const rr = await readManagedConfig({ target: structuredClone(target), installAnchorDir: null, pathEnv: "" });
          const s1 = performance.now();
          assert.equal(rr.ok, true, "read must succeed: " + JSON.stringify(rr).slice(0, 400));
          if (i === 0) rr0 = rr;
          readSamples.push(s1 - s0);
        }
        const rs = stats(readSamples);
        console.log("TIMING_READ_RESOLVE " + fmt(rs));
        const planSamples = [];
        let plan0 = null;
        for (let i = 0; i < 20; i++) {
          const s0 = performance.now();
          const plan = buildProfileAwarePlan({ target: structuredClone(target), readerResult: structuredClone(rr0), sources: minimalSources() });
          const s1 = performance.now();
          if (!plan.ok) console.log("PLAN_FAIL " + JSON.stringify(plan).slice(0, 1200));
          assert.equal(plan.ok, true, "plan must succeed");
          if (i === 0) plan0 = plan;
          planSamples.push(s1 - s0);
        }
        const ps = stats(planSamples);
        console.log("TIMING_PLAN_RENDER_VERIFY " + fmt(ps));
        assert.equal(plan0.status, "READY");
        const scope = resolveRealScopeOrSkip(t);
        if (scope === null) return;
        const atomicEntry = path.join(scope, "dsh-atomic-write", "lib", "index.js");
        const { pathToFileURL } = await import("node:url");
        const atomicMod = await import(pathToFileURL(atomicEntry).href);
        const lockSamples = [];
        const lockResource = path.join(dir, "package.json");
        for (let i = 0; i < 20; i++) {
          const s0 = performance.now();
          await atomicMod.withFileLock(lockResource, async () => {}, { waitMs: 15000 });
          const s1 = performance.now();
          lockSamples.push(s1 - s0);
        }
        const ls = stats(lockSamples);
        console.log("TIMING_LOCK_ACQUIRE_UNCONTENDED " + fmt(ls));
        assert.ok(!fs.existsSync(lockResource + ".lock"), "lock released");
        const commitSamples = [];
        for (let i = 0; i < 5; i++) {
          const hh = makeTempHome("ocms-s6-tcommit-");
          try {
            const d2 = makeProfile(hh.home, "tc" + i, { entries: [{ id: "llm-pi-ai", name: "@fixture/dsh-llm-fixture", config: { providers: {} } }], bundles: ["@fixture/base"] });
            makeFixtureBundle(d2);
            fs.writeFileSync(path.join(d2, "cordis.patch.yml"), text, "utf8");
            const tgt2 = bindReal(hh.home, "tc" + i);
            const rr2 = await readManagedConfig({ target: structuredClone(tgt2), installAnchorDir: null, pathEnv: "" });
            assert.equal(rr2.ok, true);
            const plan2 = buildProfileAwarePlan({ target: structuredClone(tgt2), readerResult: rr2, sources: minimalSources() });
            assert.equal(plan2.ok, true);
            const s0 = performance.now();
            const res = await ProfileAwareCommit({ plan: plan2, waitMs: 15000 });
            const s1 = performance.now();
            assert.equal(res.ok, true, "commit must succeed: " + JSON.stringify(res).slice(0, 500));
            assert.equal(res.status, "UPDATED");
            assert.equal(res.liveActivation, "UNKNOWN_LIVE_UNVERIFIED");
            commitSamples.push(s1 - s0);
            assert.equal(backupNames(path.join(hh.home, "profiles", "tc" + i)).length, 1);
            assert.deepEqual(tempNames(path.join(hh.home, "profiles", "tc" + i)), []);
          } finally { try { hh.cleanup(); } catch {} }
        }
        const cs = stats(commitSamples);
        console.log("TIMING_LOCKHOLD_WRITE_VERIFY " + fmt(cs));
        const ch = makeTempHome("ocms-s6-tcont-");
        try {
          const dc = makeProfile(ch.home, "cont", { entries: [{ id: "llm-pi-ai", name: "@fixture/dsh-llm-fixture", config: { providers: {} } }], bundles: ["@fixture/base"] });
          makeFixtureBundle(dc);
          fs.writeFileSync(path.join(dc, "cordis.patch.yml"), text, "utf8");
          const tgtc = bindReal(ch.home, "cont");
          const rrc = await readManagedConfig({ target: structuredClone(tgtc), installAnchorDir: null, pathEnv: "" });
          const planc = buildProfileAwarePlan({ target: structuredClone(tgtc), readerResult: rrc, sources: minimalSources() });
          assert.equal(planc.ok, true);
          const dirC = path.join(ch.home, "profiles", "cont");
          const beforeC = readPatchBytes(dirC);
          const r1 = await ProfileAwareCommit({ plan: structuredClone(planc), waitMs: 15000 });
          assert.equal(r1.ok, true);
          const r2 = await ProfileAwareCommit({ plan: structuredClone(planc), waitMs: 15000 });
          assert.equal(r2.ok, false);
          assert.equal(r2.code, "STALE_TARGET");
          assert.ok(!readPatchBytes(dirC).equals(beforeC));
          console.log("TIMING_CONTENDED winner=UPDATED loser=STALE_TARGET");
        } finally { try { ch.cleanup(); } catch {} }
        console.log("TIMING_DEFAULT_WAIT_MS=" + DEFAULT_WAIT_MS + " CLI_UI_EXPLICIT_WAIT_MS=15000");
        console.log("TIMING_COMPARISON read_max=" + rs.max.toFixed(2) + "ms plan_max=" + ps.max.toFixed(2) + "ms lockAcquire_max=" + ls.max.toFixed(2) + "ms commit_max=" + cs.max.toFixed(2) + "ms vs waitMs=15000ms");
        console.log("TIMING_NOTE read-only latency is NOT lock-hold evidence; lock-hold is commit_max which includes backup+write+post-verify under the native lock. No timeout change made (Q5 evidence only).");
        assert.ok(rs.max < 15000 && ps.max < 15000 && cs.max < 15000, "all file-side phases within 15000ms; native-boot activation UNMEASURED (HOLD)");
      } finally { try { h.cleanup(); } catch {} }
    } finally { try { restore(); } catch {} }
  });
});