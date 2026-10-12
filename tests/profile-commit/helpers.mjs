// S4 test helpers — synthetic disposable scratch profiles only (P1-A S4).
// Every fixture lives under os.tmpdir() (fresh mkdtemp per test) and is removed afterwards.
// Nothing here references the real DSH home, real profiles, accounts, credentials, or gateways.
// Composition resolves DSH library code read-only from the installed exact-version scope;
// profile DATA is always synthetic. DSH_HOME is sandboxed per helper where classification matters.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { stringify as stringifyYaml } from 'yaml';
import { findDshExecutable, resolveProfileTarget } from '../../profile/target-resolver.mjs';
export { assert };
export const EXPECTED = { atomicWrite: '0.2.1-alpha.2', appBoot: '0.2.1-alpha.2', include: '1.0.10-alpha.1', dsh: '0.2.1-alpha.2' };
export const FIXTURE_LLM_NAME = '@fixture/dsh-llm-fixture';
export const SECRET_MARKERS = ['SYNTHETIC_FAKE_KEY_alpha bravo 001','SYNTHETIC_FAKE_TOKEN_charlie delta 002','SYNTHETIC_FAKE_SECRET_echo foxtrot 003'];
let counter = 0;
export function makeTempHome(prefix = 'ocms-s4-') {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), prefix + process.pid + '-' + (counter++) + '-'));
  return { home, cleanup() { fs.rmSync(home, { recursive: true, force: true }); } };
}
export function sandboxDshHome() {
  const saved = process.env.DSH_HOME;
  const sandboxHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ocms-s4-sandbox-' + process.pid + '-' + (counter++) + '-'));
  process.env.DSH_HOME = sandboxHome;
  return () => {
    if (saved === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = saved;
    fs.rmSync(sandboxHome, { recursive: true, force: true });
  };
}
export function sha256Hex(data) { return crypto.createHash('sha256').update(data).digest('hex'); }
export function llmRow({ config = 'empty-providers', name = FIXTURE_LLM_NAME } = {}) {
  const row = { id: 'llm-pi-ai' };
  if (name !== null) row.name = name;
  if (config === 'absent') {} else if (config === 'empty-providers') row.config = { providers: {} };
  else if (typeof config === 'object' && config !== null) row.config = config;
  else row.config = config;
  return row;
}
export function modelsConfig(routeModels) {
  const providers = {};
  for (const [route, models] of Object.entries(routeModels)) providers[route] = { displayName: route, models };
  return { providers };
}
export function makeProfile(home, name, { manifest = true, bundles = [], entries = null, homePatch = null } = {}) {
  const profileDir = path.join(home, 'profiles', name);
  fs.mkdirSync(profileDir, { recursive: true });
  const manifestBody = manifest === true ? { name, private: true, dsh: { profile: { bundles: [...bundles] } }, version: '0.0.0-fixture' } : manifest;
  if (manifestBody !== false) {
    if (manifestBody === 'invalid-json') fs.writeFileSync(path.join(profileDir, 'package.json'), '{ not json', 'utf8');
    else fs.writeFileSync(path.join(profileDir, 'package.json'), JSON.stringify(manifestBody), 'utf8');
  }
  if (entries !== null) {
    if (Array.isArray(entries)) fs.writeFileSync(path.join(profileDir, 'cordis.patch.yml'), stringifyYaml(entries), 'utf8');
    else fs.writeFileSync(path.join(profileDir, 'cordis.patch.yml'), entries.raw, 'utf8');
  }
  if (homePatch !== null) {
    const text = Array.isArray(homePatch) ? stringifyYaml(homePatch) : homePatch.raw;
    fs.writeFileSync(path.join(home, 'cordis.patch.yml'), text, 'utf8');
  }
  return profileDir;
}
export function resolveRealScope({ pathEnv = process.env.PATH ?? '' } = {}) {
  const exePath = findDshExecutable({ pathEnv });
  if (exePath === null) throw new Error('S4 fixture prerequisite missing: no dsh executable on PATH.');
  const npmRoot = path.dirname(exePath);
  const candidates = [path.join(npmRoot, 'node_modules', '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai'), path.join(npmRoot, 'node_modules', '@deepseek-ai')];
  const problems = [];
  for (const scope of candidates) {
    let usable = true;
    for (const [pkg, want] of Object.entries({ 'dsh-app-boot': EXPECTED.appBoot, 'cordis-plugin-include': EXPECTED.include, 'dsh-atomic-write': EXPECTED.atomicWrite })) {
      try {
        const m = JSON.parse(fs.readFileSync(path.join(scope, pkg, 'package.json'), 'utf8'));
        if (m.version !== want) { usable = false; problems.push(scope + ': ' + pkg + ' is ' + m.version); }
      } catch (err) { usable = false; problems.push(scope + ': ' + pkg + ' unreadable'); }
    }
    if (usable) return scope;
  }
  throw new Error('S4 fixture prerequisite missing: no exact-version scope. ' + problems.join('; '));
}
export function bindReal(home, name, extra = {}) {
  const r = resolveProfileTarget({ profileName: name, dshHome: home, pathEnv: process.env.PATH ?? '', ...extra });
  assert.equal(r.ok, true, 'S1 real-PATH bind failed: ' + JSON.stringify(r).slice(0, 800));
  return r.target;
}
export function readerOpts(target, extra = {}) {
  return { target, installAnchorDir: null, pathEnv: '', telemetryDisabledEnv: undefined, ...extra };
}
export function minimalSources({ goIds = ['go-a'], zenIds = ['zen-b'] } = {}) {
  const goModels = {};
  for (const id of goIds) goModels[id] = { id, name: 'Go ' + id, limit: { context: 64000, output: 4096 }, modalities: { input: ['text'] }, reasoning: true, provider: { npm: '@ai-sdk/openai-compatible' } };
  const zenModels = {};
  for (const id of zenIds) zenModels[id] = { id, name: 'Zen ' + id, limit: { context: 128000, output: 8192 }, modalities: { input: ['text'] }, reasoning: true, provider: { npm: '@ai-sdk/anthropic' } };
  return { rosters: { go: [...goIds], zen: [...zenIds] }, catalog: { go: { models: goModels }, zen: { models: zenModels } }, docs: { go: {}, zen: {} } };
}
export async function buildReadyPlan({ home, profileName = 's4fix', entries = null, sources = null } = {}) {
  const { readManagedConfig } = await import('../../profile/config-reader.mjs');
  const { buildProfileAwarePlan } = await import('../../profile/plan-builder.mjs');
  const rows = entries ?? [llmRow({ config: { providers: { other: { displayName: 'other', models: [] } } } })];
  const profileDir0 = makeProfile(home, profileName, { entries: rows, bundles: ['@fixture/base'] });
  makeFixtureBundle(profileDir0);
  const target = bindReal(home, profileName);
  const readerResult = await readManagedConfig(readerOpts(target));
  assert.equal(readerResult.ok, true, 'reader must succeed: ' + JSON.stringify(readerResult).slice(0, 600));
  const src = sources ?? minimalSources();
  const plan = buildProfileAwarePlan({ target: structuredClone(target), readerResult, sources: src });
  assert.equal(plan.ok, true, 'plan must succeed: ' + JSON.stringify(plan).slice(0, 600));
  return { target, readerResult, plan, profileDir: path.join(home, 'profiles', profileName) };
}
export function overwritePatchText(profileDir, text) { fs.writeFileSync(path.join(profileDir, 'cordis.patch.yml'), text, 'utf8'); }
export function appendPatchNewline(profileDir) { const p = path.join(profileDir, 'cordis.patch.yml'); fs.appendFileSync(p, '\n', 'utf8'); return fs.readFileSync(p, 'utf8'); }
export function holdPackageLock(profileDir) { const p = path.join(profileDir, 'package.json.lock'); fs.writeFileSync(p, String(process.pid) + '\n', { flag: 'wx', mode: 0o600 }); return p; }
export function releaseLock(lockPath) { try { fs.rmSync(lockPath, { force: true }); } catch {} }
export function readPatchText(profileDir) { return fs.readFileSync(path.join(profileDir, 'cordis.patch.yml'), 'utf8'); }
export function readPatchBytes(profileDir) { return fs.readFileSync(path.join(profileDir, 'cordis.patch.yml')); }
export function listProfileFiles(profileDir) { return fs.readdirSync(profileDir); }
export function backupNames(profileDir) { return fs.readdirSync(profileDir).filter((f) => f.startsWith('cordis.patch.yml.bak-')); }
export function tempNames(profileDir) { return fs.readdirSync(profileDir).filter((f) => f.endsWith('.tmp')); }
export function patchLockPresent(profileDir) { return fs.existsSync(path.join(profileDir, 'cordis.patch.yml.lock')); }
export function packageLockPresent(profileDir) { return fs.existsSync(path.join(profileDir, 'package.json.lock')); }
export function patchStat(profileDir) { return fs.statSync(path.join(profileDir, 'cordis.patch.yml')); }
export function readBackupBytes(backupPath) { return fs.readFileSync(backupPath); }
export function makeOrphanTemp(profileDir) { const p = path.join(profileDir, 'cordis.patch.yml.abc123.tmp'); fs.writeFileSync(p, 'orphan', 'utf8'); return p; }
export function writeHomePatchText(home, text) { fs.writeFileSync(path.join(home, 'cordis.patch.yml'), text, 'utf8'); }
export function writeOverlayText(dir, name, text) { fs.mkdirSync(dir, { recursive: true }); const p = path.join(dir, name); fs.writeFileSync(p, text, 'utf8'); return p; }
export function patchMtimeMs(profileDir) { return fs.statSync(path.join(profileDir, 'cordis.patch.yml')).mtimeMs; }
export function makeFixtureBundle(profileDir, pkg = '@fixture/base') {
  const pkgDir = path.join(profileDir, 'node_modules', ...pkg.split('/'));
  fs.mkdirSync(pkgDir, { recursive: true });
  fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({ name: pkg, version: '0.0.0-fixture', dsh: { bundle: { patch: './cordis.patch.yml' } } }), 'utf8');
  const rows = [{ id: 'llm-pi-ai', name: FIXTURE_LLM_NAME }, { id: pkg + '-marker', name: pkg + '/marker' }];
  fs.writeFileSync(path.join(pkgDir, 'cordis.patch.yml'), stringifyYaml([{ insert: rows }]), 'utf8');
  return pkgDir;
}
export function buildLargePatchText({ entries = 21, linesPerEntry = 230 } = {}) {
  const rows = [];
  rows.push({ id: 'llm-pi-ai', name: FIXTURE_LLM_NAME, config: { providers: {} } });
  for (let i = 0; i < entries - 1; i++) {
    const filler = 'x'.repeat(180);
    rows.push({ id: 'decoy-' + i, name: 'Decoy ' + i, config: { marker: true, filler, seq: Array.from({ length: 8 }, (_, k) => 'pad-' + i + '-' + k + '-' + filler.slice(0, 40)) } });
  }
  let text = '# large synthetic fixture header\n' + stringifyYaml(rows);
  while (text.split('\n').length < 5000) text += '# pad line ' + text.length + ' ' + 'y'.repeat(120) + '\n';
  return text;
}
