// G1-A schema discovery Q4 (deterministic, no DSH boot). File-side vs native definition.
import { describe, it } from "node:test";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { makeS6Root, makeS6Profile } from "./helpers.mjs";
import { makeTempHome, sandboxDshHome } from "../profile-commit/helpers.mjs";
const EDITOR_ABS = "C:/Users/GNV/AppData/Roaming/npm/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-config-editor/lib/index.js";
const LLM_ABS = "C:/Users/GNV/AppData/Roaming/npm/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js";
describe("G1-A schema discovery", () => {
  it("editor package at nested anchor with edit+lock lines", () => {
    assert.ok(fs.existsSync(EDITOR_ABS), "editor index exists");
    const text = fs.readFileSync(EDITOR_ABS, "utf8");
    assert.ok(text.includes("async edit(entry, change)"));
    assert.ok(text.includes('withFileLock(join(this.ownerContext.profileContext.dir, "package.json")'));
    const pkg = JSON.parse(fs.readFileSync("C:/Users/GNV/AppData/Roaming/npm/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-config-editor/package.json", "utf8"));
    assert.equal(pkg.version, "0.2.1-alpha.2");
  });
  it("llm-pi-ai schema surface", () => {
    assert.ok(fs.existsSync(LLM_ABS));
    const pkg = JSON.parse(fs.readFileSync("C:/Users/GNV/AppData/Roaming/npm/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-llm-pi-ai/package.json", "utf8"));
    assert.equal(pkg.version, "0.2.1-alpha.2");
    assert.ok(fs.existsSync("C:/Users/GNV/AppData/Roaming/npm/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/types/config.d.ts"));
    assert.ok(fs.existsSync("C:/Users/GNV/AppData/Roaming/npm/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/types/provider.d.ts"));
  });
  it("file-side corpus agrees with native definition shape (executable vs declaration distinguished)", async () => {
    const { MANAGED_ROUTE_KEYS } = await import("../../profile/config-reader.mjs");
    assert.deepEqual([...MANAGED_ROUTE_KEYS].sort(), ["opencode", "opencode-completions", "opencode-go", "opencode-go-messages", "opencode-go-responses", "opencode-messages"].sort());
    const dts = fs.readFileSync("C:/Users/GNV/AppData/Roaming/npm/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/types/config.d.ts", "utf8");
    assert.ok(dts.includes("PiAiProviderProfile") && dts.includes("apiKeyEnv") && dts.includes("displayName"), "native TS declares provider fields");
    assert.ok(dts.includes("api?") && dts.includes("baseURL?") && dts.includes("models?"), "native TS declares api/baseURL/models");
    const { MANAGED_ROUTES } = await import("../../sync.mjs");
    assert.equal(MANAGED_ROUTES["opencode-go"].api, "openai-completions");
    assert.equal(MANAGED_ROUTES["opencode-go-messages"].api, "anthropic-messages");
    assert.equal(MANAGED_ROUTES["opencode"].api, "openai-responses");
    console.log("SCHEMA file-side six routes pinned; native TS validated as declaration-only (not executable Loader proof).");
  });
});
