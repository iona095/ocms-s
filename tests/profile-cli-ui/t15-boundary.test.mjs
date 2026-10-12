// S5 T15 privilege boundary
import { describe, it } from "node:test";
import fs from "node:fs";
import { assert } from "./helpers.mjs";
describe("S5 T15 privilege boundary (RED)", () => {
  it("no bare DSH imports; no forbidden runtime symbols", () => {
    for (const rel of ["../../sync.mjs", "../../ui.mjs", "../../profile/live-attestation.mjs", "../../profile/preview-session.mjs", "../../profile/commit.mjs"]) {
      let text = "";
      try { text = fs.readFileSync(new URL(rel, import.meta.url), "utf8"); } catch { continue; }
      const code = text.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
      assert.ok(!/from\s+[\u0027\u0022]@deepseek-ai\//.test(code), rel + " bare DSH import");
      assert.ok(!/import\s*\(\s*[\u0027\u0022]@deepseek-ai\//.test(code), rel + " bare dynamic DSH import");
      for (const sym of ["reconcileProfilePatches", "ConfigEditor", "runExclusive"]) {
        assert.ok(!new RegExp("\\b" + sym + "\\b").test(code), rel + " forbids " + sym);
      }
    }
    const commitText = fs.readFileSync(new URL("../../profile/commit.mjs", import.meta.url), "utf8");
    assert.ok(commitText.includes("withFileLock"));
    assert.ok(commitText.includes("writeFileAtomic"));
  });
  it("no RECONCILE production tokens", () => {
    for (const rel of ["../../profile/commit.mjs", "../../profile/live-attestation.mjs", "../../profile/preview-session.mjs", "../../sync.mjs", "../../ui.mjs"]) {
      let text = "";
      try { text = fs.readFileSync(new URL(rel, import.meta.url), "utf8"); } catch { continue; }
      assert.ok(!text.includes("RECONCILE_OBSERVED"), rel);
      assert.ok(!text.includes("RECONCILE_DEFERRED"), rel);
    }
  });
});
