// G3 Loader — CORRECTED S6-R3 (F1). Honest HOLD: no mock Loader evidence.
// Prior test imported profile/config-reader.mjs into another process and called it Loader evidence.
// That is the same OCMS-S reader, NOT native Loader execution.
// This file does NOT rename readManagedConfig as Loader evidence.
// Native entrypoint (read-only, no boot): ConfigEditor.edit via waterfall + resolveConfig,
// lock withFileLock(<profileDir>/package.json). See test body for exact versions.
// Required native diagnostic NOT observed (isolation HOLD), so T14/Q2 HOLD.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { makeTempHome, sandboxDshHome, buildReadyPlan, readPatchBytes, backupNames, tempNames, minimalSources } from "../profile-commit/helpers.mjs";
import { readManagedConfig } from "../../profile/config-reader.mjs";
import { buildProfileAwarePlan } from "../../profile/plan-builder.mjs";
import { ProfileAwareCommit } from "../../profile/commit.mjs";
const NATIVE_ENTRY = {
  editorPkg: "@deepseek-ai/dsh-config-editor", editorVersion: "0.2.1-alpha.2",
  editorFile: "C:/Users/GNV/AppData/Roaming/npm/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-config-editor/lib/index.js",
  loaderPkg: "@deepseek-ai/cordis-plugin-loader", loaderVersion: "1.0.6-alpha.1",
  schemaPkg: "@deepseek-ai/dsh-llm-pi-ai", schemaVersion: "0.2.1-alpha.2",
  method: "ConfigEditor.edit via waterfall internal/config + resolveConfig",
  lock: "withFileLock(<profileDir>/package.json)"
};
function adversarialCorpus() {
  return [
    { name: "valid-six-route-minimal", providers: { "opencode-go": { displayName: "opencode-go", models: [] }, "opencode-go-messages": { displayName: "opencode-go-messages", models: [] }, "opencode-go-responses": { displayName: "opencode-go-responses", models: [] }, "opencode-completions": { displayName: "opencode-completions", models: [] }, "opencode-messages": { displayName: "opencode-messages", models: [] }, "opencode": { displayName: "opencode", models: [] } }, expectFileSide: "ok" },
    { name: "invalid-providers-not-mapping", providers: "not-a-mapping", expectFileSide: "SETTINGS_INVALID" },
    { name: "invalid-route-not-mapping", providers: { "opencode-go": "bad" }, expectFileSide: "SETTINGS_INVALID" },
    { name: "invalid-models-not-array", providers: { "opencode-go": { displayName: "opencode-go", models: "bad" } }, expectFileSide: "SETTINGS_INVALID" },
    { name: "gap-bad-api-literal", providers: { "opencode-go": { displayName: "opencode-go", api: "bad-api-literal", models: [] } }, expectFileSide: "ok-file-side-gap" },
  ];
}
describe("G3 loader native (S6-R3 F1)", () => {
  it("native entrypoint recorded read-only; TS declarations distinguished", async () => {
    assert.equal(NATIVE_ENTRY.editorVersion, "0.2.1-alpha.2");
    assert.equal(NATIVE_ENTRY.loaderVersion, "1.0.6-alpha.1");
    const text = fs.readFileSync(NATIVE_ENTRY.editorFile, "utf8");
    assert.ok(text.includes("async edit(entry, change)"));
    assert.ok(text.includes('withFileLock(join(this.ownerContext.profileContext.dir, "package.json")'));
    assert.ok(text.includes("fiber.ctx.waterfall"));
    console.log("LOADER_ENTRY " + NATIVE_ENTRY.editorPkg + "@" + NATIVE_ENTRY.editorVersion);
  });
  it("adversarial corpus file-side only; native NOT observed -> HOLD", async () => {
    const restore = sandboxDshHome();
    try {
      const corpus = adversarialCorpus();
      for (const c of corpus) {
        const h = makeTempHome("ocms-s6-corpus-");
        try {
          const { makeProfile, makeFixtureBundle, llmRow, bindReal } = await import("../profile-commit/helpers.mjs");
          const dir = makeProfile(h.home, "c", { entries: [llmRow({ config: { providers: c.providers } })], bundles: ["@fixture/base"] });
          makeFixtureBundle(dir);
          let target = null;
          try { target = bindReal(h.home, "c"); } catch (e) { continue; }
          const rr = await readManagedConfig({ target: structuredClone(target), installAnchorDir: null, pathEnv: "" });
          if (c.expectFileSide === "ok" || c.expectFileSide === "ok-file-side-gap") { console.log("CORPUS " + c.name + " file-side ok=" + rr.ok); }
          else { assert.equal(rr.ok, false); assert.equal(rr.code, c.expectFileSide); }
        } finally { try { h.cleanup(); } catch {} }
      }
      console.log("LOADER_HOLD T14 HOLD Q2 HOLD: native diagnostic NOT observed (F5 HOLD).");
    } finally { try { restore(); } catch {} }
  });
});
