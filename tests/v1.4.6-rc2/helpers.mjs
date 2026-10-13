// OCMS-S v1.4.6-rc2 test helpers (test-first gate).
// Freeze anchor for the frozen contract text plus shared stub helpers.
// No production access: scratch settings only, no live network.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export { assert } from '../v1.3/helpers.mjs';
export { REPO_ROOT, scratchSettingsFile, emptyCurrent, catRecord, validSources } from '../v1.3/helpers.mjs';
import { REPO_ROOT as ROOT } from '../v1.3/helpers.mjs';

// ---------------------------------------------------------------------------
// Contract freeze anchor (contract v1.4.6-rc2 §15).
// ---------------------------------------------------------------------------

export const FROZEN_CONTRACT_FILE = 'OpenCode Model Sync \u2014 Simple Script Contract v1.4.6-rc2.md';
export const FROZEN_CONTRACT_SHA256 = '00204930eb1a12a4250a9eaeecd2828ac1fb83b17ffba8b2772c6d81dd56484a';
export const FROZEN_CONTRACT_LINES = 227;

export function frozenContractBytes() {
  return fs.readFileSync(path.join(ROOT, FROZEN_CONTRACT_FILE));
}

export function sha256HexBytes(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

export function countTextLines(bytes) {
  const text = Buffer.isBuffer(bytes) ? bytes.toString('utf8') : String(bytes);
  const parts = text.split('\n');
  return text.endsWith('\n') ? parts.length - 1 : parts.length;
}
// ---------------------------------------------------------------------------
// Hermetic DSH composition stub anchor (contract v1.4.6-rc3 H3).
//
// TEST-ONLY STAND-IN for DSH composition. Valid for FLAT FIXTURE SHAPES
// ONLY (one llm-pi-ai candidate row plus insert bundles, no groups). It is
// scaffolding for machines with no DSH install; it must never grow
// into a general DSH reimplementation.
//
// Pinned versions COPIED from profile/config-reader.mjs EXPECTED_VERSIONS
// (dsh 0.2.1-alpha.2, dsh-atomic-write 0.2.1-alpha.2,
// dsh-app-boot 0.2.1-alpha.2, cordis-plugin-include 1.0.10-alpha.1).
// The stub satisfies exactly what the product checks: manifest versions,
// package entries resolvable by the product resolvePackageEntry rules, and
// the imported symbols loadProfileDirectory / readProfilePatches /
// composeEntries / entryListSchema / js-yaml load. YAML parsing delegates
// to the repo's own yaml dependency (no new packages).
// ---------------------------------------------------------------------------
import os from 'node:os';
import { pathToFileURL } from 'node:url';

const STUB_VERSIONS = Object.freeze({
  dsh: '0.2.1-alpha.2',
  'dsh-atomic-write': '0.2.1-alpha.2',
  'dsh-app-boot': '0.2.1-alpha.2',
  'cordis-plugin-include': '1.0.10-alpha.1',
});

const STUB_HEADER = '// TEST-ONLY STAND-IN for DSH composition (v1.4.6-rc3 H3). Flat fixture shapes only.\n';

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

export function makeStubAnchor(t) {
  const anchor = fs.mkdtempSync(path.join(os.tmpdir(), 'ocms-rc3-anchor-'));
  t.after(() => {
    try { fs.rmSync(anchor, { recursive: true, force: true }); } catch { /* best effort */ }
  });
  const yamlDist = path.join(ROOT, 'node_modules', 'yaml', 'dist', 'index.js');
  for (const pkg of ['dsh-atomic-write', 'dsh-app-boot', 'cordis-plugin-include']) {
    fs.mkdirSync(path.join(anchor, pkg), { recursive: true });
  }
  writeJson(path.join(anchor, 'dsh-atomic-write', 'package.json'), { name: '@deepseek-ai/dsh-atomic-write', version: STUB_VERSIONS['dsh-atomic-write'] });
  writeJson(path.join(anchor, 'dsh-app-boot', 'package.json'), { name: '@deepseek-ai/dsh-app-boot', version: STUB_VERSIONS['dsh-app-boot'], main: 'lib/index.mjs' });
  writeJson(path.join(anchor, 'cordis-plugin-include', 'package.json'), { name: '@deepseek-ai/cordis-plugin-include', version: STUB_VERSIONS['cordis-plugin-include'], main: 'lib/index.mjs' });
  fs.mkdirSync(path.join(anchor, 'dsh-app-boot', 'lib'), { recursive: true });
  fs.mkdirSync(path.join(anchor, 'cordis-plugin-include', 'lib'), { recursive: true });
  const yamlUrl = pathToFileURL(yamlDist).href;
  fs.writeFileSync(
    path.join(anchor, 'dsh-app-boot', 'lib', 'index.mjs'),
    STUB_HEADER +
      "import fs from 'node:fs';\n" +
      "import path from 'node:path';\n" +
      "import yamlPkg from '" + yamlUrl + "';\n" +
      "const parseYaml = yamlPkg.parse;\n" +
      "function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }\n" +
      "export function loadProfileDirectory(kind, profileDirReal, installAnchor, opts) {\n" +
      "  let bundles = [];\n" +
      "  try {\n" +
      "    const manifest = JSON.parse(fs.readFileSync(path.join(profileDirReal, 'package.json'), 'utf8'));\n" +
      "    const b = manifest && manifest.dsh && manifest.dsh.profile && manifest.dsh.profile.bundles;\n" +
      "    if (Array.isArray(b)) bundles = b.filter((x) => typeof x === 'string');\n" +
      "  } catch { bundles = []; }\n" +
      "  const layers = [];\n" +
      "  const skippedBundles = [];\n" +
      "  for (const pkg of bundles) {\n" +
      "    const file = path.join(profileDirReal, 'node_modules', ...pkg.split('/'), 'cordis.patch.yml');\n" +
      "    try {\n" +
      "      const rows = parseYaml(fs.readFileSync(file, 'utf8'));\n" +
      "      if (!Array.isArray(rows)) throw new Error('not-array');\n" +
      "      layers.push({ packageName: pkg, patches: rows });\n" +
      "    } catch { skippedBundles.push({ packageName: pkg }); }\n" +
      "  }\n" +
      "  return { layers, skippedBundles };\n" +
      "}\n" +
      "function flatInto(rows, out) {\n" +
      "  for (const row of rows) {\n" +
      "    if (!isObj(row)) { out.push(row); continue; }\n" +
      "    if (Object.hasOwn(row, 'insert') && Array.isArray(row.insert)) { flatInto(row.insert, out); continue; }\n" +
      "    out.push(row);\n" +
      "    if (row.group && Array.isArray(row.config)) flatInto(row.config, out);\n" +
      "  }\n" +
      "}\n" +
      "export function readProfilePatches(kind, context, initial) {\n" +
      "  const base = [];\n" +
      "  for (const layer of (initial.layers || [])) base.push(...layer.patches);\n" +
      "  return [...base, ...(initial.patches || [])];\n" +
      "}\n" +
      "export function composeEntries(patchesArray, onWarn) {\n" +
      "  const flat = [];\n" +
      "  flatInto(patchesArray[0] || [], flat);\n" +
      "  const byId = new Map();\n" +
      "  const order = [];\n" +
      "  for (const row of flat) {\n" +
      "    if (!isObj(row) || typeof row.id !== 'string' || Object.hasOwn(row, 'insert')) continue;\n" +
      "    if (!byId.has(row.id)) { byId.set(row.id, {}); order.push(row.id); }\n" +
      "    const cur = byId.get(row.id);\n" +
      "    for (const [k, v] of Object.entries(row)) {\n" +
      "      if (k === 'config' && isObj(cur[k]) && isObj(v)) cur[k] = { ...cur[k], ...v };\n" +
      "      else cur[k] = v;\n" +
      "    }\n" +
      "  }\n" +
      "  return order.map((id) => byId.get(id));\n" +
      "}\n",
    'utf8',
  );
  const jsYamlDir = path.join(anchor, 'node_modules', 'js-yaml');
  fs.mkdirSync(jsYamlDir, { recursive: true });
  writeJson(path.join(jsYamlDir, 'package.json'), { name: 'js-yaml', version: '4.1.0-stub' });
  fs.writeFileSync(
    path.join(jsYamlDir, 'index.js'),
    STUB_HEADER +
      "const { parse } = require(" + JSON.stringify(yamlDist) + ");\n" +
      "module.exports = { load: (text) => parse(text) };\n",
    'utf8',
  );
  fs.writeFileSync(path.join(anchor, 'cordis-plugin-include', 'lib', 'index.mjs'), STUB_HEADER + 'export const entryListSchema = { name: \'ocms-stub-entry-list\' };\n', 'utf8');
  fs.mkdirSync(path.join(anchor, 'dsh'), { recursive: true });
  writeJson(path.join(anchor, 'dsh', 'package.json'), { name: '@deepseek-ai/dsh', version: STUB_VERSIONS.dsh });
  return { anchor, yamlDist };
}

export function sandboxPathWithoutDsh() {
  const saved = process.env.PATH;
  const delimiter = path.delimiter;
  const kept = String(saved ?? '').split(delimiter).filter((entry) => {
    if (!entry) return false;
    for (const name of ['dsh', 'dsh.cmd', 'dsh.exe', 'dsh.ps1']) {
      try {
        if (fs.statSync(path.join(entry, name)).isFile()) return false;
      } catch { /* absent — keep */ }
    }
    return true;
  });
  process.env.PATH = kept.join(delimiter);
  return () => {
    if (saved === undefined) delete process.env.PATH;
    else process.env.PATH = saved;
  };
}

