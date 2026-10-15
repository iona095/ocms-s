// S5 test helpers — synthetic disposable scratch profiles only.
// Nothing references the real DSH home, real profiles, accounts, or credentials.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { stringify as stringifyYaml } from 'yaml';
import { resolveProfileTarget } from '../../profile/target-resolver.mjs';
import { installStubDshOnAmbientPath } from '../support/dsh-stub-tree.mjs';

// The UI and preview paths fall back to the ambient PATH. Install the stub
// scope when no real DSH is installed so these tests are machine-independent.
installStubDshOnAmbientPath();
export { assert };
let counter = 0;
export function makeTempHome(prefix = 'ocms-s5-') {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), prefix + process.pid + '-' + (counter++) + '-'));
  return { home, cleanup() { fs.rmSync(home, { recursive: true, force: true }); } };
}
export function sandboxDshHome() {
  const saved = process.env.DSH_HOME;
  const sandboxHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ocms-s5-sandbox-' + process.pid + '-' + (counter++) + '-'));
  process.env.DSH_HOME = sandboxHome;
  return () => {
    if (saved === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = saved;
    fs.rmSync(sandboxHome, { recursive: true, force: true });
  };
}
export function llmRow({ config = { providers: {} } } = {}) {
  const row = { id: 'llm-pi-ai', name: '@fixture/dsh-llm-fixture' };
  if (config !== undefined) row.config = config;
  return row;
}
export function makeProfile(home, name, { entries = null } = {}) {
  const profileDir = path.join(home, 'profiles', name);
  fs.mkdirSync(profileDir, { recursive: true });
  fs.writeFileSync(path.join(profileDir, 'package.json'), JSON.stringify({ name, private: true, dsh: { profile: { bundles: [] } }, version: '0.0.0-fixture' }), 'utf8');
  if (entries !== null) fs.writeFileSync(path.join(profileDir, 'cordis.patch.yml'), stringifyYaml(entries), 'utf8');
  return profileDir;
}
export function makeProductionHome(prefix = "ocms-s5-prod-") {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), prefix + process.pid + "-" + (counter++) + "-"));
  const saved = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  return { home, restore() { if (saved === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = saved; }, cleanup() { fs.rmSync(home, { recursive: true, force: true }); } };
}
export function writeTextFile(p, text) {
  fs.writeFileSync(p, text, "utf8");
  return p;
}
export function joinPath(...parts) {
  return path.join(...parts);
}
// R2 reliability: request an OS-assigned ephemeral port for every server. Port 0
// cannot collide with another suite's fixed-port ring. The bounded EADDRINUSE
// retry remains only for the integer-nanosecond case in which the OS reuses a
// just-released ephemeral port before this process binds it.
export async function withR2Port(t, startFn) {
  let last = null;
  for (let i = 0; i < 12; i++) {
    try {
      const started = await startFn(0);
      t.after(async () => { try { await started.close(); } catch {} });
      return started;
    } catch (err) {
      if (err && (err.code === "EADDRINUSE" || String((err && err.message) || "").includes("EADDRINUSE"))) {
        last = err;
        continue;
      }
      throw err;
    }
  }
  throw last ?? new Error('withR2Port exhausted its bounded ephemeral-port retries');
}
export function bindTarget(home, name, extra = {}) {
  const r = resolveProfileTarget({ profileName: name, dshHome: home, pathEnv: process.env.PATH ?? '', ...extra });
  assert.equal(r.ok, true, 'bind failed: ' + JSON.stringify(r).slice(0, 800));
  return r.target;
}
