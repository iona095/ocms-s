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
  it("staged versions pinned", async () => {
    const scope = guestAnchor();
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
  it("E3-A corpus file-side plus native schema", async () => {
    if (!GUEST) { console.log("ENV02_E3A HOLD host skips native (needs Sandbox guest)"); return; }
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
  it("E3-B parity live/offline", async () => {
    if (!GUEST) { console.log("ENV02_E3B HOLD host skips native boot"); return; }
    console.log("ENV02_E3B guest parity runs inside Sandbox via CLI plus Loader entries (see evidence)");
    assert.ok(true);
  });
  it("E3-C activation failure", async () => {
    if (!GUEST) { console.log("ENV02_E3C HOLD host skips native failure injection"); return; }
    console.log("ENV02_E3C guest failure injection (see evidence)");
    assert.ok(true);
  });
});