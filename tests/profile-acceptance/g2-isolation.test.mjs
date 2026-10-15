// G2 isolation — CORRECTED S6-R3 (F5). Inventory + HOLD, no native DSH boot.
// F5 requires a complete process-level egress boundary active BEFORE process start.
// Selective JS patching, proxy env, post-start inspection are SUPPLEMENTARY ONLY.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { pathToFileURL } from "node:url";
import { makeTempHome, sandboxDshHome } from "../profile-commit/helpers.mjs";
import { makeS6Profile } from "./helpers.mjs";
function inventoryScratchGraph(home, profileName) {
  const dir = makeS6Profile(home, profileName, { entries: [{ id: "llm-pi-ai", name: "@fixture/dsh-llm-fixture", config: { providers: {} } }], bundles: ["@fixture/base"] });
  const files = fs.readdirSync(dir).sort();
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
  const patchText = fs.readFileSync(path.join(dir, "cordis.patch.yml"), "utf8");
  const bundlePkg = JSON.parse(fs.readFileSync(path.join(dir, "node_modules", "@fixture", "base", "package.json"), "utf8"));
  return { dir, files, bundles: pkg.dsh.profile.bundles, patchBytes: Buffer.byteLength(patchText, "utf8"), bundleName: bundlePkg.name };
}
// Real path containment, no constant: is scratchReal the same as, or inside,
// liveReal? Both are resolved by the caller, and the reason carries the two
// paths actually compared so a failure is diagnosable.
function isInside(child, parent) {
  const rel = path.relative(parent, child);
  return rel === "" || (rel !== ".." && !rel.startsWith(".." + path.sep) && !path.isAbsolute(rel));
}
function checkContainment({ scratchReal, liveReal }) {
  const contained = isInside(scratchReal, liveReal);
  return {
    contained,
    scratchReal,
    liveReal,
    reason: contained
      ? "scratch home is inside the live DSH home"
      : "scratch home is outside the live DSH home",
  };
}
describe("G2 isolation boundary (S6-R3 F5)", () => {
  it("scratch graph inventoried; containment absent -> ISOLATION_HOLD, no boot", async (t) => {
    const restore = sandboxDshHome();
    try {
      const h = makeTempHome("ocms-s6-iso-");
      try {
        const home = h.home;
        const inv = inventoryScratchGraph(home, "iso");
        console.log("ISOLATION_GRAPH files=" + inv.files.join(","));
        const sr = fs.realpathSync(path.resolve(home));
        // The environment's live DSH home is a temp stand-in created here and
        // passed in explicitly: this check never reads or resolves the real
        // ~/.dsh, so a clean runner (no real home) is not a special case.
        const liveHome = makeTempHome("ocms-s6-live-");
        let hr;
        try {
          hr = fs.realpathSync(path.resolve(liveHome.home));
        } finally {
          t.after(() => { try { liveHome.cleanup(); } catch {} });
        }
        const guardText = fs.readFileSync(path.resolve("tests/profile-acceptance/net-guard.mjs"), "utf8");
        assert.ok(guardText.includes("S6_NET_DENIED"));
        const cont = checkContainment({ scratchReal: sr, liveReal: hr });
        console.log("ISOLATION_CONTAINMENT contained=" + cont.contained + " reason=" + cont.reason);
        assert.equal(cont.contained, false, "the scratch fixture home must not sit inside the live DSH home: " + JSON.stringify({ scratch: sr, live: hr, reason: cont.reason }));
        const server = http.createServer((req, res) => { res.writeHead(200); res.end("loopback-ok"); });
        await new Promise((res) => server.listen(0, "127.0.0.1", res));
        const port = server.address().port;
        t.after(() => { try { server.close(); } catch {} });
        const guardUrl = pathToFileURL(path.resolve("tests/profile-acceptance/net-guard.mjs")).href;
        const mod = await import("node:child_process");
        const procFn = mod["spawn"];
        const childJs = "import('" + guardUrl + "').then(async()=>{ const r1=await fetch('http://127.0.0.1:" + port + "/'); const t1=await r1.text(); let denied=false; try { await fetch('http://example.invalid/'); } catch(e){ denied=/S6_NET_DENIED/.test(String(e&&e.message)); } console.log(JSON.stringify({loop:t1,denied})); });";
        const env = { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT, TEMP: process.env.TEMP, TMP: process.env.TMP, DSH_HOME: home };
        const c = procFn(process.execPath, ["--import", guardUrl, "-e", childJs], { env, stdio: ["ignore", "pipe", "pipe"] });
        const pid = c.pid;
        assert.ok(typeof pid === "number" && pid > 0);
        // Bounded wait: a guard that fails to deny example.invalid would leave
        // this child fetching for minutes. On the deadline the child is killed
        // and the wait fails with the bounded message below.
        const out = await new Promise((res, rej) => {
          let s = ""; c.stdout.on("data", (d) => s += d); c.stderr.on("data", () => {});
          const deadline = setTimeout(() => {
            try { c.kill("SIGKILL"); } catch {}
            rej(new Error("TIMED_OUT waiting for the guarded child to exit after 20000ms (loopback fetch + denied fetch)"));
          }, 20000);
          c.on("close", () => { clearTimeout(deadline); res(s); });
          c.on("error", (err) => { clearTimeout(deadline); rej(err); });
        });
        assert.equal(c.exitCode, 0);
        const j = JSON.parse(out.trim().split("\n").pop());
        assert.equal(j.loop, "loopback-ok");
        assert.equal(j.denied, true);
        console.log("ISOLATION_NEGATIVE loopback=PASS supplementaryDeny=PASS (supplementary-only)");
        assert.ok(!("OPENCODE_GO_API_KEY" in env));
        console.log("ISOLATION_HOLD: containment NOT established. STOP before native boot. No PASS.");
      } finally { try { h.cleanup(); } catch {} }
    } finally { try { restore(); } catch {} }
  });

  // Negative control for the containment oracle: with explicit inputs it must
  // report BOTH outcomes, so the assertion above cannot be vacuous.
  it("negative control: the containment oracle separates inside from outside", () => {
    const live = makeTempHome("ocms-s6-live-ctl-");
    try {
      const hr = fs.realpathSync(path.resolve(live.home));
      const inside = fs.mkdtempSync(path.join(hr, "profiles-nested-"));
      try {
        const nested = checkContainment({ scratchReal: fs.realpathSync(path.resolve(inside)), liveReal: hr });
        assert.equal(nested.contained, true, "a fixture inside the live home must be reported as contained: " + nested.reason);
        assert.equal(checkContainment({ scratchReal: hr, liveReal: hr }).contained, true, "the live home itself is contained");
        const sibling = checkContainment({ scratchReal: path.join(hr, "..", "ocms-s6-sibling-fixture"), liveReal: hr });
        assert.equal(sibling.contained, false, "a sibling path must not be reported as contained: " + sibling.reason);
      } finally {
        fs.rmSync(inside, { recursive: true, force: true });
      }
    } finally {
      live.cleanup();
    }
  });
});
