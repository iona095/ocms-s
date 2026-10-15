// R2 B5 - browser invalidation runs the real inline client script in a VM.
import { describe, it } from "node:test";
import fs from "node:fs";
import vm from "node:vm";
import { assert } from "./helpers.mjs";
function stubElement(id) {
  const listeners = {};
  const el = {
    id, value: "", checked: false, textContent: "", disabled: true,
    dataset: {}, open: false,
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    querySelector() { return stubElement(id + ":q"); },
    replaceChildren() {}, append() {},
    showModal() { el.open = true; },
    close() { el.open = false; const cbs = listeners.close || []; for (const fn of cbs) fn(); },
    fire(type, ev) { for (const fn of (listeners[type] || [])) fn(ev || {}); },
  };
  return el;
}
function runClientScript(routes) {
  const html = fs.readFileSync(new URL("../../ui/index.html", import.meta.url), "utf8");
  const start = html.indexOf("<script>");
  const end = html.indexOf("</scr" + "ipt>");
  assert.ok(start !== -1 && end !== -1, "inline client script found");
  const src = html.slice(start + 8, end);
  const els = {};
  const radios = [{ value: "unattested", checked: true }, { value: "not-running", checked: false }, { value: "overlays", checked: false }];
  const calls = [];
  const context = {
    console,
    document: {
      getElementById: (id) => (els[id] = els[id] || stubElement(id)),
      querySelector: (sel) => {
        if (String(sel).indexOf("live-state") !== -1) return radios.find((r) => r.checked) || null;
        return stubElement("q" + sel);
      },
      body: { dataset: {}, setAttribute() {}, removeAttribute() {} },
      createElement: (tag) => stubElement("el-" + tag),
    },
    fetch: async (url, opts) => {
      const body = opts && opts.body ? JSON.parse(opts.body) : null;
      calls.push({ url, body });
      return { ok: true, status: 200, json: async () => routes(url, body) };
    },
  };
  vm.createContext(context);
  vm.runInContext(src, context, { filename: "client.mjs" });
  const tick = async (n) => { const k = n || 8; for (let i = 0; i < k; i++) await new Promise((r) => setImmediate(r)); };
  return { els, radios, calls, tick };
}
function profilePreview(id) {
  return {
    ok: true, profile: true, state: "READY", previewId: id,
    target: { profileName: "web", profileDirReal: "C:/h/profiles/web", patchPathReal: "C:/h/profiles/web/cordis.patch.yml", pluginEntryName: "llm-pi-ai", classification: "SCRATCH" },
    attestation: null, attestationText: "UNATTESTED",
    changes: { added: [], removed: [], moved: [], metadataChanged: [] },
    preservedUnresolved: [], skippedUnresolved: [], unsupportedSkipped: [], fallbackResolved: [],
    endpointBaseDrift: [],
    sources: { goRoster: { ok: true, count: 0 }, zenRoster: { ok: true, count: 0 }, catalog: { ok: true }, goDocs: { ok: true }, zenDocs: { ok: true } },
    routeCounts: {},
  };
}
describe("R2 B5 browser invalidation", () => {
  it("10: editing profile selection after Preview invalidates and closes confirm", async () => {
    const h = runClientScript((url) => {
      if (url === "/api/state") return { ok: true, target: { displayPath: "x", production: false } };
      if (url === "/api/preview") return profilePreview("p1");
      return { ok: true, status: "UPDATED", profile: true, liveActivation: "UNKNOWN_LIVE_UNVERIFIED" };
    });
    await h.tick();
    h.els["profile-picker"].value = "web";
    h.els["refresh-btn"].fire("click");
    await h.tick();
    assert.equal(h.els["state-badge"].textContent, "READY");
    h.els["apply-btn"].fire("click");
    assert.equal(h.els["confirm-dialog"].open, true);
    h.els["profile-picker"].value = "other";
    h.els["profile-picker"].fire("input");
    assert.equal(h.els["confirm-dialog"].open, false);
    assert.equal(h.els["state-badge"].textContent, "IDLE");
    assert.ok(String(h.els["status"].textContent).toLowerCase().includes("preview"));
    h.els["apply-btn"].fire("click");
    assert.equal(h.els["confirm-dialog"].open, false);
  });
  it("10b: overlay edits invalidate; apply echoes current selection", async () => {
    const h = runClientScript((url) => {
      if (url === "/api/state") return { ok: true, target: { displayPath: "x", production: false } };
      if (url === "/api/preview") return profilePreview("p2");
      return { ok: true, status: "UPDATED", profile: true, liveActivation: "UNKNOWN_LIVE_UNVERIFIED" };
    });
    await h.tick();
    h.els["profile-picker"].value = "web";
    h.els["refresh-btn"].fire("click");
    await h.tick();
    assert.equal(h.els["state-badge"].textContent, "READY");
    h.els["overlays-input"].value = "C:/x.yml";
    h.els["overlays-input"].fire("input");
    assert.equal(h.els["state-badge"].textContent, "IDLE");
    h.els["overlays-input"].value = "";
    h.els["refresh-btn"].fire("click");
    await h.tick();
    assert.equal(h.els["state-badge"].textContent, "READY");
    h.els["overlays-input"].value = "C:/drift.yml";
    h.els["apply-btn"].fire("click");
    assert.equal(h.els["confirm-dialog"].open, true);
    h.els["confirm-apply"].fire("click");
    await h.tick();
    const outs = h.calls.filter((c) => c.url === "/api/apply");
    assert.ok(outs.length > 0, "apply posted");
    const sent = outs[outs.length - 1].body;
    assert.equal(sent.confirmed, true);
    assert.deepEqual(sent.selection.declaredOverlays, ["C:/drift.yml"]);
    assert.equal(sent.selection.attestation, null);
  });
  it("13b: empty overlay entries refuse client-side without preview fetch", async () => {
    const h = runClientScript((url) => {
      if (url === "/api/state") return { ok: true, target: { displayPath: "x", production: false } };
      return profilePreview("p3");
    });
    await h.tick();
    const before = h.calls.length;
    h.els["profile-picker"].value = "web";
    h.els["overlays-input"].value = "C:/a.yml,,C:/b.yml";
    h.els["refresh-btn"].fire("click");
    await h.tick();
    assert.equal(h.calls.filter((c) => c.url === "/api/preview").length, 0);
    assert.equal(h.calls.length, before);
    const note = String(h.els["status"].textContent).toLowerCase();
    assert.ok(note.includes("overlay") || note.includes("empty"));
  });
  it("P3-1: selection change during Preview flight drops the stale response", async () => {
    let releasePreview;
    const gate = new Promise((res) => { releasePreview = res; });
    const h = runClientScript((url) => {
      if (url === "/api/state") return { ok: true, target: { displayPath: "x", production: false } };
      if (url === "/api/preview") return gate.then(() => profilePreview("p-stale"));
      return { ok: true, status: "UPDATED", profile: true, liveActivation: "UNKNOWN_LIVE_UNVERIFIED" };
    });
    await h.tick();
    h.els["profile-picker"].value = "web";
    h.els["refresh-btn"].fire("click");
    await h.tick(2);
    assert.equal(h.calls.filter((c) => c.url === "/api/preview").length, 1);
    h.els["profile-picker"].value = "other";
    h.els["profile-picker"].fire("input");
    releasePreview();
    await h.tick(12);
    assert.notEqual(h.els["state-badge"].textContent, "READY", "a stale in-flight Preview must not install READY");
    const note = String(h.els["status"].textContent).toLowerCase();
    assert.ok(note.includes("stale") || note.includes("drop") || note.includes("changed"), "the drop must be announced: " + note);
    h.els["apply-btn"].fire("click");
    assert.equal(h.els["confirm-dialog"].open, false, "no confirm may open on a dropped preview");
  });
});
