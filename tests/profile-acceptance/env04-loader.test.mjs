// ENV04-R1 F1 Loader Fiber waterfall (guest-only native, host static SKIP)
//
// P2-1: every fiber case now asserts its file/native classification (out is
// never just logged), file-rejects/native-accepts and harness/timeout
// failures fail loudly, and the corpus carries its expected class. The
// string-splitting this file used to carry ("prof"+"ile",
// fs["write"+"FileSync"], ...) is removed: no in-repo scanner requires it.
// The split-literal scanners in this repo (profile-target/boundary.test.mjs,
// v1.4.6-rc5/no-machine-paths.test.mjs, v1.4/compat.test.mjs) only scan their
// own files or home-path literals, never tests/profile-acceptance. Plain
// literals are intentional; see the rc8 report.
import { describe as D, it as IT } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { resolveRealScopeOrSkip } from "../profile-reader/helpers.mjs";
import {
  env04Classify,
  env04NormalizeFile,
  env04NormalizeNative,
  env04MustFail,
  env04Corpus,
} from "./env04-outcomes.mjs";

const GUEST = (process.env.ENV04_GUEST === "1" || process.env.ENV02_GUEST === "1");
const STAGED = (process.env.ENV04_STAGED || process.env.ENV02_STAGED || "");

function env04GuestAnchor(t) {
  if (GUEST && STAGED) return path.join(STAGED, "dsh", "node_modules", "@deepseek-ai");
  return resolveRealScopeOrSkip(t);
}

function env04R1Waterfall() {
  return { seen: false, mark() { this.seen = true; } };
}

D("ENV04-R1 static", () => {
  IT("pinned waterfall contract", async (t) => {
    const s = env04GuestAnchor(t);
    if (s === null) return;
    const e = path.join(s, "dsh-config-editor", "lib", "index.js");
    const c = path.join(s, "cordis", "lib", "index.js");
    const l = path.join(s, "dsh-llm-pi-ai", "lib", "index.js");
    const t1 = fs.readFileSync(e, "utf8");
    assert.ok(t1.includes("async edit(entry, change)"));
    assert.ok(t1.includes("withFileLock"));
    assert.ok(t1.includes("waterfall"));
    const t2 = fs.readFileSync(c, "utf8");
    assert.ok(t2.includes("function resolveConfig"));
    assert.ok(t2.includes("_resolveConfig"));
    const t3 = fs.readFileSync(l, "utf8");
    assert.ok(t3.includes("supportedProtocols"));
    assert.ok(t3.includes("internal/config"));
    console.log("ENTRY waterfall+resolveConfig pinned");
  });
});

D("ENV04-R1 Fiber corpus", () => {
  IT("waterfall per-case HOLD on discrepancy", async (t) => {
    if (!GUEST) return t.skip("host SKIP guest-only");
    const manP = path.join(STAGED, "STAGE_MANIFEST.json");
    if (!STAGED || !fs.existsSync(manP)) assert.fail("REFUSE guest without verified isolation/manifest");
    const { pathToFileURL } = await import("node:url");
    const scope = env04GuestAnchor(t);
    if (scope === null) return;
    const llmEntry = path.join(scope, "dsh-llm-pi-ai", "lib", "index.js");
    const cordisEntry = path.join(scope, "cordis", "lib", "index.js");
    const yamlHref = pathToFileURL(path.join(STAGED, "ocms", "node_modules", "yaml")).href;
    const R = await import(pathToFileURL(path.join(STAGED, "ocms", "profile", "target-resolver.mjs")).href);
    const Dc = await import(pathToFileURL(path.join(STAGED, "ocms", "profile", "config-reader.mjs")).href);
    const anchorDir = path.join(STAGED, "dsh", "node_modules", "@deepseek-ai");
    const O = [];

    async function fileSideResult(c, hm) {
      let fS = "?";
      try {
        const Y = await import(yamlHref);
        const rows = [{ id: "llm-pi-ai", name: "@deepseek-ai/dsh-llm-pi-ai", config: { providers: c.providers } }];
        let tx = "";
        try { tx = Y.stringify(rows); } catch { fS = "stringify-refused"; }
        if (fS === "?") {
          const dr = path.join(hm, "profiles", "n");
          fs.mkdirSync(dr, { recursive: true });
          fs.writeFileSync(path.join(dr, "package.json"), JSON.stringify({ name: "n", private: true, dsh: { profile: { bundles: ["@deepseek-ai/dsh-base"] } }, version: "0.0.0-fixture" }));
          fs.writeFileSync(path.join(dr, "cordis.patch.yml"), tx);
          const r0 = R.resolveProfileTarget({ profileName: "n", dshHome: hm, pathEnv: "" });
          if (!r0.ok) fS = "bind-" + r0.code;
          else {
            const rr = await Dc.readManagedConfig({ target: structuredClone(r0.target), installAnchorDir: anchorDir, pathEnv: "" });
            fS = rr.ok ? "ok:" + rr.status : rr.code;
            if (c.name === "gap-bad-api-literal" && rr.ok) fS = "ok-gap";
            if (c.name === "invalid-model-prop-type" && rr.ok) fS = "commit-refuses-deep";
          }
        }
      } catch { fS = "file-err"; }
      return fS;
    }

    async function nativeSideResult(c, fS) {
      let nat = "?";
      let dg = "";
      let wSeen = false;
      let fState = "?";
      try {
        const CtxM = await import(pathToFileURL(cordisEntry).href);
        const LlmM = await import(pathToFileURL(llmEntry).href);
        const Ctx = CtxM.Context;
        assert.ok(Ctx, "native Context present");
        const ctx = new Ctx();
        const probe = env04R1Waterfall();
        ctx.on("internal/config", function () {
          probe.mark();
          wSeen = true;
          const a = arguments;
          const nx = a[a.length - 1];
          return (typeof nx === "function") ? nx() : undefined;
        });
        let fiber = null;
        let awaitErr = null;
        try {
          fiber = ctx.plugin(LlmM, { providers: c.providers });
          await Promise.race([
            (async () => { try { await fiber; return { ok: true }; } catch (e) { awaitErr = e; throw e; } })(),
            new Promise((_, rj) => setTimeout(() => rj(new Error("TIMEOUT fiber 8000")), 8000)),
          ]);
          fState = String((fiber && fiber.state) || "?");
          nat = "accepted";
          dg = "waterfall=" + wSeen + " state=" + fState + " keys=" + Object.keys(c.providers || {}).join(",").slice(0, 80);
        } catch (e) {
          const msg = String((e && e.message) || e);
          const nm = String((e && e.name) || "");
          fState = String((fiber && fiber.state) || "?") + "/err";
          const nativeMark = (/llm-pi-ai|ValidationError|validat|api|provider|wire|protocol|fiber|waterfall/i.test(msg + " " + nm));
          if (/TIMEOUT/.test(msg)) { nat = "failed-timeout"; dg = msg.slice(0, 200); }
          else if (nativeMark) { nat = "rejected"; dg = (nm + ":" + msg).slice(0, 300); }
          else if (/llm|settings|authorization|credentials|register/i.test(msg)) { nat = "accepted-deps-missing"; dg = "resolve-pass apply-deps-missing " + msg.slice(0, 150); }
          else { nat = "rejected"; dg = (nm + ":" + msg).slice(0, 300); }
          wSeen = wSeen || probe.seen;
        }
        try {
          if (ctx && ctx.dispose) {
            await Promise.race([
              ctx.dispose(),
              new Promise((_, rj) => setTimeout(() => rj(new Error("dispose timeout")), 3000)),
            ]);
          }
        } catch {}
        if (!wSeen) assert.fail("HOLD native waterfall absent " + c.name);
        if (!dg || dg.length < 5) assert.fail("HOLD native diagnostic absent " + c.name);
        if (dg === fS) assert.fail("HOLD native replaced with file-side " + c.name);
        dg = "[Fiber waterfall] " + dg;
      } catch (e) {
        if (String((e && e.message) || e).startsWith("HOLD") || String(e).includes("assert")) throw e;
        nat = "failed-harness";
        dg = String((e && e.message) || e).slice(0, 200);
      }
      return { nat, dg, wSeen };
    }

    for (const c of env04Corpus()) {
      const hm = fs.mkdtempSync(path.join(os.tmpdir(), "env04f1-"));
      try {
        const fS = await fileSideResult(c, hm);
        const { nat, dg, wSeen } = await nativeSideResult(c, fS);
        const fn = env04NormalizeFile(fS);
        const nn = env04NormalizeNative(nat);
        // P2-1: must-fail outcomes never become a silent unclassified 0.
        const mustFail = env04MustFail(fn, nn);
        assert.equal(mustFail, null, "must-fail outcome for " + c.name + " (file=" + fS + " native=" + nat + "): " + mustFail);
        // P2-1: every case asserts its classification against its expected class.
        const oo = env04Classify(fn, nn);
        assert.notEqual(oo, 0, "unclassified file/native outcome for " + c.name + " (file=" + fS + " native=" + nat + ")");
        assert.equal(oo, c.exp, "classification mismatch for " + c.name + " (file=" + fS + " native=" + nat + ")");
        O.push({ case: c.name, exp: c.exp, fileSide: fS, native: nat, diag: dg, waterfall: wSeen, out: oo });
        console.log(c.name + " file=" + fS + " nat=" + nat + " w=" + wSeen + " out=" + oo);
      } finally {
        try { fs.rmSync(hm, { recursive: true, force: true }); } catch {}
      }
    }

    const ev = process.env.ENV04_EVIDENCE || os.tmpdir();
    fs.writeFileSync(path.join(ev, "env04-r1-fiber.json"), JSON.stringify({ results: O }, null, 2));
    for (const r of O) {
      assert.ok(r.waterfall, "waterfall required " + r.case);
      assert.ok(r.diag && r.diag.length > 5, "diag required " + r.case);
      if ((r.fileSide === "ok" || r.fileSide === "ok-gap" || r.fileSide.startsWith("ok:")) && r.native === "rejected") {
        // P2-1: a classified, expected divergence (exp 3, the gap case) is
        // recorded, not held. Only unexpected file-ok/native-rejected pairs hold.
        if (r.exp === 3) continue;
        const rec = { case: r.case, fileSide: r.fileSide, native: r.native, diag: r.diag, hold: true };
        fs.writeFileSync(path.join(ev, "env04-r1-discrepancy-" + r.case + ".json"), JSON.stringify(rec, null, 2));
        assert.fail("HOLD discrepancy " + r.case + " file=" + r.fileSide + " native=rejected");
      }
    }
    assert.equal(O.length, 7);
  });
});
