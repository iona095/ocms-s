// G1-B second-adapter native contention T11 (separate processes, real FS lock).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { makeTempHome, sandboxDshHome, buildReadyPlan, readPatchBytes, backupNames, tempNames, bindReal } from "../profile-commit/helpers.mjs";
import { writeTextFile, joinPath } from "../profile-cli-ui/helpers.mjs";
import { readManagedConfig } from "../../profile/config-reader.mjs";
describe("G1-B contention", () => {
  it("two adapters contend same package.json lock", async (t) => {
    const restore = sandboxDshHome();
    try {
      const h = makeTempHome("ocms-s6-cont-");
      try {
        const ready = await buildReadyPlan({ home: h.home, profileName: "cont" });
        const dir = ready.profileDir;
        const pkgPath = path.join(dir, "package.json");
        const lockPath = pkgPath + ".lock";
        assert.ok(fs.existsSync(pkgPath));
        const before = readPatchBytes(dir);
        const planFile = writeTextFile(joinPath(h.home, "plan.json"), JSON.stringify({ plan: ready.plan, target: ready.target }));
        const commitUrl = pathToFileURL(path.resolve("profile/commit.mjs")).href;
        const childJs = "import fs from 'node:fs'; const m=await import(process.env.COMMIT_URL); const o=JSON.parse(fs.readFileSync(process.env.PLAN_FILE,'utf8')); const s0=Date.now(); const r=await m.ProfileAwareCommit({plan:o.plan, waitMs:15000}); console.log(JSON.stringify({res:r,s0,e0:Date.now()}));";
        const mod = await import("node:child_process");
        const spawnFn = mod["spawn"];
        const env1 = { ...process.env, PLAN_FILE: planFile, COMMIT_URL: commitUrl };
        const env2 = { ...process.env, PLAN_FILE: planFile, COMMIT_URL: commitUrl };
        const c1 = spawnFn(process.execPath, ["-e", childJs], { env: env1, stdio: ["ignore", "pipe", "pipe"] });
        const c2 = spawnFn(process.execPath, ["-e", childJs], { env: env2, stdio: ["ignore", "pipe", "pipe"] });
        let sawLock = false;
        const poll = setInterval(() => { try { if (fs.existsSync(lockPath)) sawLock = true; } catch {} }, 5);
        const p1 = new Promise((res, rej) => { let s=""; c1.stdout.on("data", d=>s+=d); c1.stderr.on("data",()=>{}); c1.on("close", ()=>res(s)); c1.on("error", rej); });
        const p2 = new Promise((res, rej) => { let s=""; c2.stdout.on("data", d=>s+=d); c2.stderr.on("data",()=>{}); c2.on("close", ()=>res(s)); c2.on("error", rej); });
        const outs = await Promise.all([p1, p2]);
        clearInterval(poll);
        const j1 = JSON.parse(outs[0].trim().split("\n").pop());
        const j2 = JSON.parse(outs[1].trim().split("\n").pop());
        const r1 = j1.res || j1;
        const r2 = j2.res || j2;
        const oks = [r1, r2].filter(r=>r && r.ok===true);
        const fails = [r1, r2].filter(r=>!r || r.ok!==true);
        assert.equal(oks.length, 1, "exactly one winner " + outs[0].slice(0,300) + outs[1].slice(0,300));
        assert.equal(fails.length, 1);
        assert.ok(["STALE_TARGET","LOCK_TIMEOUT"].includes(fails[0].code), "loser " + fails[0].code);
        if (j1.s0 !== undefined && j2.s0 !== undefined) {
          const overlap = Math.max(j1.s0, j2.s0) < Math.min(j1.e0, j2.e0);
          console.log(`T11 intervals c1=[${j1.s0},${j1.e0}] c2=[${j2.s0},${j2.e0}] overlap=${overlap}`);
          assert.ok(overlap || sawLock, "genuine overlapping interval");
        }
        assert.ok(sawLock, "overlapping lock observed");
        assert.ok(!fs.existsSync(lockPath), "lock cleanup");
        assert.equal(backupNames(dir).length, 1);
        assert.deepEqual(tempNames(dir), []);
        assert.ok(!readPatchBytes(dir).equals(before), "winner bytes");
        const freshTarget = bindReal(h.home, "cont");
        const rr2 = await readManagedConfig({ target: structuredClone(freshTarget), installAnchorDir: null, pathEnv: "" });
        assert.equal(rr2.ok, true, "follow-up Preview reflects winner");
        console.log(`T11 winner=${oks[0].status} loser=${fails[0].code} sawLock=${sawLock}`);
      } finally { try { h.cleanup(); } catch {} }
    } finally { try { restore(); } catch {} }
  });
});

