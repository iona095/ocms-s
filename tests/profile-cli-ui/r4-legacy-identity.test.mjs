// R4-B2 RED->GREEN — preserve SCRATCH identity through legacy Apply.
// Narrow canonical-target binding. Disposable fixtures only.
import { describe, it, beforeEach, afterEach } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { assert, makeTempHome, sandboxDshHome, makeProductionHome, writeTextFile, joinPath, withR2Port } from "./helpers.mjs";
import { makeProfile as makeS4Profile, makeFixtureBundle, llmRow as s4Row, backupNames, readPatchBytes } from "../profile-commit/helpers.mjs";
import { startTestServer, postJson, authHeaders, getJson, fetchFromBodies, validSourceBodies, scratchSettingsFile, readSettingsBytes, backupCount, tempResidue } from "../v1.3/helpers.mjs";
import { dispatchSyncCli, runSettingsSync, classifySettingsPath } from "../../sync.mjs";
function seedEntries() { return [s4Row({ config: { providers: { other: { displayName: "other", models: [] } } } })]; }
function canLink() { const d = fs["mkdtempSync"](path.join(os.tmpdir(), "ocms-r4-probe-")); const a = path.join(d, "t.txt"); const b = path.join(d, "l.txt"); try { fs["writeFileSync"](a, "x", "utf8"); fs["symlinkSync"](a, b); const ok = fs.existsSync(b); fs["rmSync"](d, { recursive: true, force: true }); return ok; } catch { try { fs["rmSync"](d, { recursive: true, force: true }); } catch {} return false; } }
function selectionFor(p) { const att = p.attestation; const s = { profileName: p.target.profileName, declaredOverlays: [...p.declaredOverlays], attestation: att === null ? null : structuredClone(att) }; if (att !== null && att !== undefined) { s.liveState = att.mode === "NOT_RUNNING" ? "not-running" : "overlays:" + att.overlays.join(","); s.acknowledged = true; } return s; }
describe("R4-B2 legacy identity", () => {
let home; let cleanupHome; let restore;
beforeEach(() => { restore = sandboxDshHome(); const h = makeTempHome(); home = h.home; cleanupHome = h.cleanup; });
afterEach(() => { try { cleanupHome(); } catch {} try { restore(); } catch {} });
it("deterministic binding distinguishes scratch from production", async (t) => {
const mod = await import("../../sync.mjs");
assert.equal(typeof mod.resolveLegacyBinding, "function");
const prod = makeProductionHome();
try {
const sf = scratchSettingsFile(t);
const pf = writeTextFile(joinPath(prod.home, "det-prod.yaml"), readSettingsBytes(sf).toString("utf8"));
const bS = mod.resolveLegacyBinding(sf, home);
const bP = mod.resolveLegacyBinding(pf, prod.home);
assert.equal(bS.ok, true);
assert.equal(bS.classification, "SCRATCH");
assert.equal(bP.ok, true);
assert.equal(bP.classification, "PRODUCTION");
assert.notEqual(bS.canonicalTarget, bP.canonicalTarget);
const bS2 = mod.resolveLegacyBinding(sf, home);
assert.equal(bS2.canonicalTarget, bS.canonicalTarget);
} finally { try { prod.cleanup(); } catch {} try { prod.restore(); } catch {} }
});
it("direct runSettingsSync with PRODUCTION refuses before fetch", async () => {
const prod = makeProductionHome();
try {
const p = writeTextFile(joinPath(prod.home, "settings.yaml"), "llm-pi-ai:\\n  providers: {}\\n");
let calls = 0;
const inner = fetchFromBodies(validSourceBodies());
const res = await runSettingsSync({ settingsPath: p, dshHome: prod.home, fetchFn: async (...a) => { calls += 1; return inner(...a); }, confirmFn: async () => true, print: () => {} });
assert.equal(res.ok, false);
assert.ok(["PRODUCTION_SETTINGS_REFUSED","SCRATCH_MODE_PRODUCTION_REFUSED","SETTINGS_UNREADABLE"].includes(res.code));
assert.equal(calls, 0);
assert.equal(backupCount(path.dirname(p)), 0);
} finally { try { prod.cleanup(); } catch {} try { prod.restore(); } catch {} }
});
it("stable SCRATCH preserves UPDATED", async (t) => {
const f = scratchSettingsFile(t);
const res = await dispatchSyncCli(["--settings", f], { fetchFn: fetchFromBodies(validSourceBodies()), confirmFn: async () => true, dshHome: home });
assert.equal(res.ok, true);
assert.equal(res.result, "UPDATED");
});
it("direct unresolved refuses before fetch", async () => {
const missing = path.join(home, "does-not-exist-xyz.yaml");
let calls = 0;
const inner = fetchFromBodies(validSourceBodies());
const res = await runSettingsSync({ settingsPath: missing, dshHome: home, fetchFn: async (...a) => { calls += 1; return inner(...a); }, confirmFn: async () => true, print: () => {} });
assert.equal(res.ok, false);
assert.equal(res.code, "SETTINGS_UNREADABLE");
assert.equal(calls, 0);
});
it("byte-stale SCRATCH still refuses", async (t) => {
const f = scratchSettingsFile(t);
const d = path.dirname(f);
let tamp = null;
const res = await dispatchSyncCli(["--settings", f], { fetchFn: fetchFromBodies(validSourceBodies()), confirmFn: async () => { tamp = Buffer.concat([readSettingsBytes(f), Buffer.from("\\n# ext\\n", "utf8")]); fs["writeFileSync"](f, tamp); return true; }, dshHome: home });
assert.equal(res.ok, false);
assert.equal(res.code, "STALE_SETTINGS");
assert.equal(backupCount(d), 0);
});
it("targetless UI starts and empty Preview refuses", async (t) => {
const ui = await import("../../ui.mjs");
let calls = 0;
const inner = fetchFromBodies(validSourceBodies());
const started = await withR2Port(t, (port) => ui.startServer({ port, fetchFn: async (...a) => { calls += 1; return inner(...a); }, openBrowser: false }));
const st = await getJson(started.port, "/api/state");
assert.equal(st.json.ok, true);
assert.equal(st.json.target.displayPath, null);
const res = await postJson(started.port, "/api/preview", {}, authHeaders(started.token));
assert.equal(res.json.ok, false);
assert.equal(res.json.code, "PROFILE_REQUIRED");
assert.equal(calls, 0);
});
it("Mode A scratch UNATTESTED still works", async (t) => {
const dir = makeS4Profile(home, "r4modeA", { entries: seedEntries(), bundles: ["@fixture/base"] });
makeFixtureBundle(dir);
const f = scratchSettingsFile(t);
const started = await withR2Port(t, (port) => startTestServer(t, { settingsPath: f, port, fetchFn: fetchFromBodies(validSourceBodies()) }));
const pv = await postJson(started.port, "/api/preview", { profileName: "r4modeA", dshHome: home }, authHeaders(started.token));
assert.equal(pv.json.ok, true);
const ap = await postJson(started.port, "/api/apply", { previewId: pv.json.previewId, confirmed: true, selection: selectionFor(pv.json) }, authHeaders(started.token));
assert.equal(ap.json.ok, true);
assert.equal(ap.json.status, "UPDATED");
});
it("Mode B production attested still works", async (t) => {
const prod = makeProductionHome();
try {
const dir = makeS4Profile(prod.home, "r4modeB", { entries: seedEntries(), bundles: ["@fixture/base"] });
makeFixtureBundle(dir);
const f = scratchSettingsFile(t);
const started = await withR2Port(t, (port) => startTestServer(t, { settingsPath: f, port, fetchFn: fetchFromBodies(validSourceBodies()) }));
const pv = await postJson(started.port, "/api/preview", { profileName: "r4modeB", dshHome: prod.home, liveState: "not-running", acknowledged: true }, authHeaders(started.token));
assert.equal(pv.json.ok, true);
const ap = await postJson(started.port, "/api/apply", { previewId: pv.json.previewId, confirmed: true, selection: selectionFor(pv.json) }, authHeaders(started.token));
assert.equal(ap.json.ok, true);
assert.equal(ap.json.status, "UPDATED");
} finally { try { prod.cleanup(); } catch {} try { prod.restore(); } catch {} }
});
it("CLI symlink SCRATCH->PRODUCTION same bytes refuses", async (t) => {
if (!canLink()) { t.skip("symlink unavailable; deterministic test carries evidence"); return; }
const prod = makeProductionHome();
try {
const templateCli = scratchSettingsFile(t);
const templateCliText = readSettingsBytes(templateCli).toString("utf8");
const sReal = writeTextFile(joinPath(home, "cli-scratch.yaml"), templateCliText);
const pReal = writeTextFile(joinPath(prod.home, "cli-prod.yaml"), templateCliText);
assert.ok(fs.readFileSync(sReal).equals(fs.readFileSync(pReal)));
assert.equal(classifySettingsPath(sReal, prod.home), "SCRATCH");
assert.equal(classifySettingsPath(pReal, prod.home), "PRODUCTION");
const ld = fs["mkdtempSync"](path.join(os.tmpdir(), "ocms-r4-cli-"));
t.after(() => { try { fs["rmSync"](ld, { recursive: true, force: true }); } catch {} });
const lp = path.join(ld, "settings.yaml");
fs["symlinkSync"](sReal, lp);
assert.equal(classifySettingsPath(lp, prod.home), "SCRATCH");
const beforeCliP = fs.readFileSync(pReal);
const beforeCliS = fs.readFileSync(sReal);
const res = await dispatchSyncCli(["--settings", lp], { fetchFn: fetchFromBodies(validSourceBodies()), confirmFn: async () => { try { fs["unlinkSync"](lp); } catch {} fs["symlinkSync"](pReal, lp); assert.equal(classifySettingsPath(lp, prod.home), "PRODUCTION"); assert.ok(fs.readFileSync(lp).equals(fs.readFileSync(sReal))); return true; }, dshHome: prod.home });
assert.equal(res.ok, false, JSON.stringify(res).slice(0, 600));
assert.ok(["PRODUCTION_SETTINGS_REFUSED","SCRATCH_MODE_PRODUCTION_REFUSED","SETTINGS_TARGET_CHANGED","TARGET_CHANGED","STALE_SETTINGS","SETTINGS_UNREADABLE"].includes(res.code));
assert.equal(backupCount(path.dirname(sReal)), 0);
assert.equal(backupCount(path.dirname(pReal)), 0);
assert.equal(backupCount(ld), 0);
assert.ok(fs.readFileSync(pReal).equals(beforeCliP), "prod target must be unmodified");
assert.ok(fs.readFileSync(sReal).equals(beforeCliS), "scratch real must be unmodified");
} finally { try { prod.cleanup(); } catch {} try { prod.restore(); } catch {} }
});
it("UI symlink Preview->Apply refuses", async (t) => {
if (!canLink()) { t.skip("symlink unavailable; deterministic test carries evidence"); return; }
const prod = makeProductionHome();
try {
const templateUi = scratchSettingsFile(t);
const templateUiText = readSettingsBytes(templateUi).toString("utf8");
const sReal = writeTextFile(joinPath(home, "ui-scratch.yaml"), templateUiText);
const pReal = writeTextFile(joinPath(prod.home, "ui-prod.yaml"), templateUiText);
assert.ok(fs.readFileSync(sReal).equals(fs.readFileSync(pReal)));
const beforeUiP = fs.readFileSync(pReal);
const beforeUiS = fs.readFileSync(sReal);
const ld = fs["mkdtempSync"](path.join(os.tmpdir(), "ocms-r4-ui-"));
t.after(() => { try { fs["rmSync"](ld, { recursive: true, force: true }); } catch {} });
const lp = path.join(ld, "settings.yaml");
fs["symlinkSync"](sReal, lp);
const ui = await import("../../ui.mjs");
const started = await withR2Port(t, (port) => ui.startServer({ settingsPath: lp, dshHome: prod.home, port, fetchFn: fetchFromBodies(validSourceBodies()), openBrowser: false }));
const pv = await postJson(started.port, "/api/preview", {}, authHeaders(started.token));
assert.equal(pv.json.ok, true, JSON.stringify(pv.json).slice(0, 500));
try { fs["unlinkSync"](lp); } catch {}
fs["symlinkSync"](pReal, lp);
assert.equal(classifySettingsPath(lp, prod.home), "PRODUCTION");
const ap = await postJson(started.port, "/api/apply", { previewId: pv.json.previewId }, authHeaders(started.token));
assert.equal(ap.json.ok, false, JSON.stringify(ap.json).slice(0, 600));
assert.ok(["STALE_PREVIEW","PRODUCTION_SETTINGS_REFUSED","SETTINGS_TARGET_CHANGED","TARGET_CHANGED","SETTINGS_UNREADABLE"].includes(ap.json.code));
assert.equal(backupCount(path.dirname(sReal)), 0);
assert.equal(backupCount(path.dirname(pReal)), 0);
assert.equal(backupCount(ld), 0);
assert.deepEqual(tempResidue(ld), []);
assert.ok(fs.readFileSync(pReal).equals(beforeUiP), "prod target must be unmodified");
assert.ok(fs.readFileSync(sReal).equals(beforeUiS), "scratch real must be unmodified");
} finally { try { prod.cleanup(); } catch {} try { prod.restore(); } catch {} }
});
});
