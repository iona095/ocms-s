// G2 isolation — CORRECTED S6-R3 (F5). Inventory + HOLD, no native DSH boot.
// F5 requires a complete process-level egress boundary active BEFORE process start.
// Selective JS patching, proxy env, post-start inspection are SUPPLEMENTARY ONLY.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
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
function checkContainment() {
  return { contained: false, reason: "no OS-level egress boundary; JS patching is supplementary-only per F5" };
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
        // Amendment A A1: resolve the real ~/.dsh only if it exists. On a clean
        // runner it is absent, so realpathSync would throw before the check runs.
        const liveDotDsh = path.resolve(os.homedir() + "/.dsh");
        let hr = null;
        try {
          hr = fs.realpathSync(liveDotDsh);
        } catch {
          hr = null;
        }
        if (hr !== null) {
          assert.ok(sr !== hr && !sr.startsWith(hr + path.sep), "no traversal into real home");
        } else {
          assert.ok(sr !== liveDotDsh && !sr.startsWith(liveDotDsh + path.sep), "no traversal into real home");
        }
        const guardText = fs.readFileSync(path.resolve("tests/profile-acceptance/net-guard.mjs"), "utf8");
        assert.ok(guardText.includes("S6_NET_DENIED"));
        const cont = checkContainment();
        console.log("ISOLATION_CONTAINMENT contained=" + cont.contained + " reason=" + cont.reason);
        assert.equal(cont.contained, false);
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
        const out = await new Promise((res, rej) => { let s=""; c.stdout.on("data",d=>s+=d); c.stderr.on("data",()=>{}); c.on("close",()=>res(s)); c.on("error",rej); });
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
});
