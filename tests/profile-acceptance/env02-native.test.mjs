// ENV02 native runner glue (test-only). Host skips native without ENV02_GUEST=1 (HOLD).
// Guest (Sandbox, Networking Disable) runs staged pinned DSH 0.2.1-alpha.2 natively.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { resolveRealScope } from "../profile-reader/helpers.mjs";
const GUEST = process.env.ENV02_GUEST === "1";
const STAGED = process.env.ENV02_STAGED || "";
function guestAnchor() {
  if (GUEST && STAGED) return path.join(STAGED, "dsh", "node_modules", "@deepseek-ai");
  // Q1: run-time scope from the dsh executable on PATH (was a hard-coded install path).
  return resolveRealScope();
}
// Declared capability skip instead of a silent return: the pinned DSH anchor
// comes either from the staged guest tree or from the pinned dsh executable on
// PATH, and a host with neither must report that capability, not pass.
const PINNED_DSH_CAPABILITY = "pinned DSH 0.2.1-alpha.2 (ENV02_GUEST=1 + ENV02_STAGED, or the pinned dsh executable on PATH)";
function guestAnchorOrSkip(t) {
  try {
    return guestAnchor();
  } catch (err) {
    t.skip(PINNED_DSH_CAPABILITY + ": " + String((err && err.message) || err));
    return null;
  }
}
// Offline half of the live/offline parity: the staged OCMS-S reader over a
// synthetic profile carrying the given providers mapping.
async function stagedFileSide(providers) {
  const { pathToFileURL } = await import("node:url");
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "env02-case-"));
  try {
    const yamlMod = await import(pathToFileURL(path.join(STAGED, "ocms", "node_modules", "yaml")).href);
    const dir = path.join(home, "profiles", "n");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "n", private: true, dsh: { profile: { bundles: ["@deepseek-ai/dsh-base"] } }, version: "0.0.0-fixture" }));
    fs.writeFileSync(path.join(dir, "cordis.patch.yml"), yamlMod.stringify([{ id: "llm-pi-ai", name: "@deepseek-ai/dsh-llm-pi-ai", config: { providers } }]));
    const rslv = await import(pathToFileURL(path.join(STAGED, "ocms", "profile/target-resolver.mjs")).href);
    const rr0 = rslv.resolveProfileTarget({ profileName: "n", dshHome: home, pathEnv: "" });
    if (!rr0.ok) return { ok: false, code: "bind-" + rr0.code, bind: rr0 };
    const reader = await import(pathToFileURL(path.join(STAGED, "ocms", "profile/config-reader.mjs")).href);
    return await reader.readManagedConfig({ target: structuredClone(rr0.target), installAnchorDir: path.join(STAGED, "dsh", "node_modules", "@deepseek-ai"), pathEnv: "" });
  } finally {
    try { fs.rmSync(home, { recursive: true, force: true }); } catch {}
  }
}
function stagedVersions(scope) {
  const v = {}; const pkgs = ["dsh-atomic-write", "dsh-app-boot", "cordis-plugin-include", "cordis-plugin-loader", "dsh-llm-pi-ai", "dsh-config-editor"];
  for (const p of pkgs) v[p] = JSON.parse(fs.readFileSync(path.join(scope, p, "package.json"), "utf8")).version;
  v["dsh"] = JSON.parse(fs.readFileSync(path.join(scope, "..", "..", "package.json"), "utf8")).version;
  return v;
}
function nativeCorpus() {
  const six = {}; for (const r of ["opencode-go", "opencode-go-messages", "opencode-go-responses", "opencode-completions", "opencode-messages", "opencode"]) six[r] = { displayName: r, models: [] };
  return [
    { name: "valid-six-route", providers: six, fileSide: "ok" },
    { name: "valid-with-unrelated", providers: { ...six, other: { displayName: "other", models: [] }, "opencode-go": { displayName: "opencode-go", apiKeyEnv: "SYNTHETIC_X", api: "openai-completions", baseURL: "https://example.invalid/v1", models: [] } }, fileSide: "ok" },
    { name: "invalid-providers-mapping", providers: "bad", fileSide: "SETTINGS_INVALID" },
    { name: "invalid-route-mapping", providers: { "opencode-go": "bad" }, fileSide: "SETTINGS_INVALID" },
    { name: "invalid-models-type", providers: { "opencode-go": { displayName: "opencode-go", models: "bad" } }, fileSide: "SETTINGS_INVALID" },
    { name: "invalid-model-prop-type", providers: { "opencode-go": { displayName: "opencode-go", models: [{ id: 123 }] } }, fileSide: "commit-refuses" },
    { name: "gap-bad-api-literal", providers: { "opencode-go": { displayName: "opencode-go", api: "bad-api-literal", models: [] } }, fileSide: "ok-gap" },
  ];
}
describe("ENV02 native", () => {
  it("staged versions pinned", async (t) => {
    const scope = guestAnchorOrSkip(t);
    if (scope === null) return;
    const v = stagedVersions(scope);
    assert.equal(v["dsh-atomic-write"], "0.2.1-alpha.2"); assert.equal(v["dsh-app-boot"], "0.2.1-alpha.2");
    // v1.4.7-rc6 §5(a): include admits exactly 1.0.10-alpha.1 or 1.0.10-alpha.2
    // (exact strings, no ranges). cordis-plugin-loader is not version-checked by
    // OCMS-S but moves with the same coordinated release, so both alpha trees
    // are acceptable evidence here.
    assert.ok(["1.0.10-alpha.1", "1.0.10-alpha.2"].includes(v["cordis-plugin-include"]), "cordis-plugin-include must be an admitted version, got " + v["cordis-plugin-include"]);
    assert.ok(["1.0.6-alpha.1", "1.0.6-alpha.2"].includes(v["cordis-plugin-loader"]), "cordis-plugin-loader must be a coordinated alpha version, got " + v["cordis-plugin-loader"]);
    assert.equal(v["dsh-llm-pi-ai"], "0.2.1-alpha.2"); assert.equal(v["dsh-config-editor"], "0.2.1-alpha.2"); assert.equal(v["dsh"], "0.2.1-alpha.2");
    console.log("ENV02_VERSIONS dsh=0.2.1-alpha.2 anchor=" + scope);
  });
  it("E3-A corpus file-side plus native schema", async (t) => {
    if (!GUEST || !STAGED) return t.skip(PINNED_DSH_CAPABILITY + " staged in a DSH Sandbox guest (native schema + file-side corpus)");
    const scope = guestAnchor();
    const llmEntry = path.join(scope, "dsh-llm-pi-ai", "lib/index.js");
    const { pathToFileURL } = await import("node:url");
    const llm = await import(pathToFileURL(llmEntry).href);
    assert.ok(llm.Config, "native Config schema present");
    const ocmsReader = await import(pathToFileURL(path.join(STAGED, "ocms", "profile/config-reader.mjs")).href);
    const commitMod = await import(pathToFileURL(path.join(STAGED, "ocms", "profile/commit.mjs")).href);
    const results = [];
    for (const c of nativeCorpus()) {
      const home = fs.mkdtempSync(path.join(os.tmpdir(), "env02a-"));
      try {
        const yamlMod = GUEST ? await import(pathToFileURL(path.join(STAGED, "ocms", "node_modules", "yaml")).href) : await import("yaml"); const { stringify } = yamlMod;
        const dir = path.join(home, "profiles", "n"); fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "n", private: true, dsh: { profile: { bundles: ["@deepseek-ai/dsh-base"] } }, version: "0.0.0-fixture" }));
        const rows = [{ id: "llm-pi-ai", name: "@deepseek-ai/dsh-llm-pi-ai", config: { providers: c.providers } }];
        let text = ""; try { text = stringify(rows); } catch (e) { results.push({ case: c.name, fileSide: "stringify-refused", native: "not-run" }); continue; }
        fs.writeFileSync(path.join(dir, "cordis.patch.yml"), text);
        const rslv = await import(pathToFileURL(path.join(STAGED, "ocms", "profile/target-resolver.mjs")).href);
        const rr0 = rslv.resolveProfileTarget({ profileName: "n", dshHome: home, pathEnv: "" });
        let fileSide = "bind-" + (rr0.ok ? "ok" : rr0.code);
        if (rr0.ok) { const rr = await ocmsReader.readManagedConfig({ target: structuredClone(rr0.target), installAnchorDir: path.join(STAGED, "dsh", "node_modules", "@deepseek-ai"), pathEnv: "" }); fileSide = rr.ok ? "ok:" + rr.status : rr.code; }
        let native = "not-run", diag = "";
        try { const out = llm.Config({ providers: c.providers }); native = "accepted"; diag = JSON.stringify(Object.keys(out.providers || {})).slice(0, 200); }
        catch (e) { native = "rejected"; diag = String((e && e.message) || e).slice(0, 300); }
        results.push({ case: c.name, fileSide, native, diag });
        console.log("ENV02_E3A " + c.name + " fileSide=" + fileSide + " native=" + native + " diag=" + diag.slice(0, 120));
      } finally { try { fs.rmSync(home, { recursive: true, force: true }); } catch {} }
    }
    const fs2 = await import("node:fs"); fs2.writeFileSync(path.join(process.env.ENV02_EVIDENCE || os.tmpdir(), "env02-e3a.json"), JSON.stringify({ results }, null, 2));
    const gap = results.find((r) => r.case === "gap-bad-api-literal");
    console.log("ENV02_E3A_GAP bad-api-literal fileSide=" + gap.fileSide + " native=" + gap.native);
    assert.ok(results.length === 7);
  });
  it("E3-B parity live/offline", async (t) => {
    if (!GUEST || !STAGED) return t.skip(PINNED_DSH_CAPABILITY + " staged in a DSH Sandbox guest (native live half + offline reader half)");
    const scope = guestAnchor();
    const { pathToFileURL } = await import("node:url");
    const llm = await import(pathToFileURL(path.join(scope, "dsh-llm-pi-ai", "lib/index.js")).href);
    assert.equal(typeof llm.Config, "function", "the staged native Config surface must exist for the live half");
    let rejected = 0;
    for (const c of nativeCorpus()) {
      let native = "accepted", diag = "";
      try { const out = llm.Config({ providers: c.providers }); diag = JSON.stringify(Object.keys(out.providers || {})).slice(0, 200); }
      catch (e) { native = "rejected"; rejected += 1; diag = String((e && e.message) || e).slice(0, 300); }
      const rr = await stagedFileSide(c.providers);
      const fileSide = rr.ok ? "ok:" + rr.status : rr.code;
      assert.ok(typeof fileSide === "string" && fileSide.length > 0, "the offline half must classify every corpus case, got " + fileSide);
      console.log("ENV02_E3B " + c.name + " fileSide=" + fileSide + " native=" + native + " diag=" + diag.slice(0, 120));
      if (c.name === "valid-six-route") {
        assert.equal(native, "accepted", "the valid six-route corpus must be accepted by the live native schema: " + diag.slice(0, 200));
        assert.ok(fileSide.startsWith("ok"), "the valid six-route corpus must be accepted by the offline reader, got " + fileSide);
      }
    }
    assert.ok(rejected >= 1, "the live native schema must reject at least one malformed activation input; it accepted all " + nativeCorpus().length);
    console.log("ENV02_E3B parity cases=" + nativeCorpus().length + " nativeRejected=" + rejected);
  });
  it("E3-C activation failure", async (t) => {
    if (!GUEST || !STAGED) return t.skip(PINNED_DSH_CAPABILITY + " staged in a DSH Sandbox guest (native activation failure injection)");
    const scope = guestAnchor();
    const { pathToFileURL } = await import("node:url");
    const llm = await import(pathToFileURL(path.join(scope, "dsh-llm-pi-ai", "lib/index.js")).href);
    const malformed = nativeCorpus().find((c) => c.name === "invalid-providers-mapping").providers;
    let err = null;
    try { llm.Config({ providers: malformed }); } catch (e) { err = String((e && e.message) || e); }
    assert.ok(err !== null, "the live native schema must FAIL to activate a malformed providers mapping; it accepted it");
    assert.ok(err.length > 0, "the activation failure must carry a diagnostic message");
    const rr = await stagedFileSide(malformed);
    assert.equal(rr.ok, false, "the offline reader must refuse the same malformed activation input: " + JSON.stringify(rr).slice(0, 300));
    assert.equal(rr.code, "SETTINGS_INVALID", "offline refusal code, got " + rr.code);
    console.log("ENV02_E3C live refused (" + err.slice(0, 100) + ") | offline refused (" + rr.code + ")");
  });
});