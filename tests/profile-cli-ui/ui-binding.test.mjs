// S5 RED — UI profile binding (P0-R2 8.3/8.5/8.6/8.8/8.9; P1-A 5 S5). T09/T10/T17 + attestation UX. Loopback harness, synthetic fixtures.
import { describe, it, beforeEach, afterEach } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { assert, makeTempHome, sandboxDshHome, makeProfile, llmRow } from "./helpers.mjs";

describe("S5 UI profile binding (RED)", () => {
  let home; let cleanupHome; let restore;
  beforeEach(() => { restore = sandboxDshHome(); const h = makeTempHome(); home = h.home; cleanupHome = h.cleanup; });
  afterEach(() => { try { cleanupHome(); } catch {} try { restore(); } catch {} });
  it("parseCliArgs accepts profile flags alongside legacy flags", async () => {
    const ui = await import("../../ui.mjs");
    const p = ui.parseCliArgs(["--profile=myprof", "--live-state=not-running", "--scratch", "--no-open"]);
    assert.equal(p.profile, "myprof"); assert.equal(p.liveState, "not-running"); assert.equal(p.scratch, true);
    assert.throws(() => ui.parseCliArgs(["--profile=a", "--profile=b"]), /DUPLICATE/);
    assert.throws(() => ui.parseCliArgs(["--profile=a", "--live-state=x", "--live-state=y"]), /DUPLICATE/);
  });
  it("profile preview binds full identity; switch changes binding", async () => {
    const ps = await import("../../profile/preview-session.mjs");
    assert.ok(typeof ps.buildProfilePreview === "function");
    makeProfile(home, "profA", { entries: [llmRow({ config: { providers: { other: { displayName: "other", models: [] } } } })] });
    makeProfile(home, "profB", { entries: [llmRow({ config: { providers: { other: { displayName: "other", models: [] } } } })] });
    const goModels = { "go-a": { id: "go-a", name: "Go go-a", limit: { context: 64000, output: 4096 }, modalities: { input: ["text"] }, reasoning: true, provider: { npm: "@ai-sdk/openai-compatible" } } };
    const zenModels = { "zen-b": { id: "zen-b", name: "Zen zen-b", limit: { context: 128000, output: 8192 }, modalities: { input: ["text"] }, reasoning: true, provider: { npm: "@ai-sdk/anthropic" } } };
    const sources = { rosters: { go: ["go-a"], zen: ["zen-b"] }, catalog: { go: { models: goModels }, zen: { models: zenModels } }, docs: { go: {}, zen: {} } };
    const r1 = await ps.buildProfilePreview({ profileName: "profA", dshHome: home, sources, liveStateRaw: undefined, origin: "UI", acknowledged: false });
    assert.equal(r1.ok, true, JSON.stringify(r1).slice(0, 500));
    assert.equal(r1.preview.target.profileName, "profA");
    assert.ok(/^[0-9a-f]{64}$/.test(r1.preview.target.patchDigest));
    assert.equal(r1.preview.attestation, null);
    const r2 = await ps.buildProfilePreview({ profileName: "profB", dshHome: home, sources, liveStateRaw: undefined, origin: "UI", acknowledged: false });
    assert.equal(r2.ok, true);
    assert.notEqual(r1.preview.previewId, r2.preview.previewId);
    assert.notEqual(r1.preview.target.patchPathReal, r2.preview.target.patchPathReal);
  });
  it("ui index exposes picker plus UNATTESTED-default control plus confirmation redisplay", async () => {
    const html = fs.readFileSync(new URL("../../ui/index.html", import.meta.url), "utf8");
    assert.ok(html.includes("profile-picker") || html.includes("profilepicker"), "profile picker missing");
    assert.ok(html.toLowerCase().includes("live-state") || html.toLowerCase().includes("attest"), "attestation control missing");
    assert.ok(html.includes("UNATTESTED"), "UNATTESTED default marker missing");
    assert.ok(html.toLowerCase().includes("confirm") && (html.toLowerCase().includes("attest") || html.toLowerCase().includes("live-state")), "confirmation redisplay missing");
  });
});
