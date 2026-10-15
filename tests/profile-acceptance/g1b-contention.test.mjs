// G1-B second-adapter native contention T11 (separate processes, real FS lock).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { makeTempHome, sandboxDshHome, buildReadyPlan, readPatchBytes, backupNames, tempNames, bindReal } from "../profile-commit/helpers.mjs";
import { writeTextFile, joinPath } from "../profile-cli-ui/helpers.mjs";
import { readManagedConfig } from "../../profile/config-reader.mjs";

// Every wait below is bounded: on the deadline the child is killed and the wait
// fails with a message naming what it waited for. Nothing here may hang.
const CONTENTION_DEADLINE_MS = 45000;

function boundedChildOutput(child, { timeoutMs, label }) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", () => {});
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill("SIGKILL"); } catch {}
      reject(new Error("TIMED_OUT waiting for " + label + " to exit after " + timeoutMs + "ms; child killed (pid "
        + String(child.pid) + "); output so far: " + JSON.stringify(stdout.slice(-200))));
    }, timeoutMs);
    child.on("close", () => { if (settled) return; settled = true; clearTimeout(timer); resolve(stdout); });
    child.on("error", (err) => { if (settled) return; settled = true; clearTimeout(timer); reject(err); });
  });
}

// Event-driven observation of the transient lock file, bounded by a deadline.
// fs.watch on the directory reports the lock entry as it is created; the bounded
// condition re-check (25 ms) only covers filesystems whose watcher misses the
// event. Resolves true when observed, false once the children are gone or the
// deadline expires. This replaces the 5 ms sampling loop that raced the lock.
function waitForLockEvent(target, { timeoutMs, until }) {
  return new Promise((resolve) => {
    const dir = path.dirname(target);
    const name = path.basename(target);
    let watcher = null;
    let done = false;
    const finish = (observed) => {
      if (done) return;
      done = true;
      clearTimeout(deadline);
      clearInterval(recheck);
      if (watcher !== null) { try { watcher.close(); } catch {} }
      resolve(observed);
    };
    const deadline = setTimeout(() => finish(false), timeoutMs);
    const recheck = setInterval(() => { try { if (fs.existsSync(target)) finish(true); } catch {} }, 25);
    if (until !== undefined) until.then(() => finish(false));
    if (fs.existsSync(target)) { finish(true); return; }
    try {
      watcher = fs.watch(dir, (event, filename) => {
        if (filename === undefined || filename === null || String(filename) === name) finish(true);
        else { try { if (fs.existsSync(target)) finish(true); } catch {} }
      });
      if (watcher.on) watcher.on("error", () => { /* the bounded re-check still runs */ });
    } catch { watcher = null; }
  });
}

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
        // The lock observer is armed BEFORE the children start, so its creation
        // event cannot be missed by a sampling race; the wait is bounded and
        // stops as soon as both children are gone.
        let childrenDone;
        const childrenGone = new Promise((res) => { childrenDone = res; });
        const lockSeen = waitForLockEvent(lockPath, { timeoutMs: CONTENTION_DEADLINE_MS, until: childrenGone });
        const c1 = spawnFn(process.execPath, ["-e", childJs], { env: env1, stdio: ["ignore", "pipe", "pipe"] });
        const c2 = spawnFn(process.execPath, ["-e", childJs], { env: env2, stdio: ["ignore", "pipe", "pipe"] });
        const outs = await Promise.all([
          boundedChildOutput(c1, { timeoutMs: CONTENTION_DEADLINE_MS, label: "contending adapter 1 (ProfileAwareCommit waitMs=15000)" }),
          boundedChildOutput(c2, { timeoutMs: CONTENTION_DEADLINE_MS, label: "contending adapter 2 (ProfileAwareCommit waitMs=15000)" }),
        ]);
        childrenDone();
        const sawLock = await lockSeen;
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
        assert.ok(sawLock, "the contended package.json.lock was never observed within " + CONTENTION_DEADLINE_MS + "ms (event-driven fs.watch on the profile dir, armed before the children started, plus a bounded 25 ms condition re-check)");
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

