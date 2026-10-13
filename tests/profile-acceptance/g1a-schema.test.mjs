// G1-A schema discovery Q4 (deterministic, no DSH boot). File-side vs native definition.
import { describe, it } from "node:test";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { makeS6Root, makeS6Profile } from "./helpers.mjs";
import { makeTempHome, sandboxDshHome } from "../profile-commit/helpers.mjs";
import { resolveRealScope } from "../profile-reader/helpers.mjs";
// Q1: every install path below is derived at run time from the dsh executable
// on PATH (was hard-coded to the developer install).
function dshScope() { return resolveRealScope(); }
function editorIndex() { return path.join(dshScope(), "dsh-config-editor", "lib", "index.js"); }
function llmPackageDir() { return path.join(dshScope(), "dsh-llm-pi-ai"); }
describe("G1-A schema discovery", () => {
  it("editor package at nested anchor with edit+lock lines", () => {
    assert.ok(fs.existsSync(editorIndex()), "editor index exists");
    const text = fs.readFileSync(editorIndex(), "utf8");
    assert.ok(text.includes("async edit(entry, change)"));
    assert.ok(text.includes('withFileLock(join(this.ownerContext.profileContext.dir, "package.json")'));
    const pkg = JSON.parse(fs.readFileSync(path.join(dshScope(), "dsh-config-editor", "package.json"), "utf8"));
    assert.equal(pkg.version, "0.2.1-alpha.2");
  });
  it("llm-pi-ai schema surface", () => {
    assert.ok(fs.existsSync(llmPackageDir()));
    const pkg = JSON.parse(fs.readFileSync(path.join(llmPackageDir(), "package.json"), "utf8"));
    assert.equal(pkg.version, "0.2.1-alpha.2");
    assert.ok(fs.existsSync(path.join(llmPackageDir(), "lib", "types", "config.d.ts")));
    assert.ok(fs.existsSync(path.join(llmPackageDir(), "lib", "types", "provider.d.ts")));
  });
  it("file-side corpus agrees with native definition shape (executable vs declaration distinguished)", async () => {
    const { MANAGED_ROUTE_KEYS } = await import("../../profile/config-reader.mjs");
    assert.deepEqual([...MANAGED_ROUTE_KEYS].sort(), ["opencode", "opencode-completions", "opencode-go", "opencode-go-messages", "opencode-go-responses", "opencode-messages"].sort());
    const dts = fs.readFileSync(path.join(llmPackageDir(), "lib", "types", "config.d.ts"), "utf8");
    assert.ok(dts.includes("PiAiProviderProfile") && dts.includes("apiKeyEnv") && dts.includes("displayName"), "native TS declares provider fields");
    assert.ok(dts.includes("api?") && dts.includes("baseURL?") && dts.includes("models?"), "native TS declares api/baseURL/models");
    const { MANAGED_ROUTES } = await import("../../sync.mjs");
    assert.equal(MANAGED_ROUTES["opencode-go"].api, "openai-completions");
    assert.equal(MANAGED_ROUTES["opencode-go-messages"].api, "anthropic-messages");
    assert.equal(MANAGED_ROUTES["opencode"].api, "openai-responses");
    console.log("SCHEMA file-side six routes pinned; native TS validated as declaration-only (not executable Loader proof).");
  });
});
