// S1 static scope/import boundary (P0-R2 §6.3, P1-A §5 S1 forbidden sets).
//
// Reads profile/target-resolver.mjs as text and asserts the S1 seam stays
// narrow: node builtins + yaml only; no Loader/HMR/Cordis/ConfigEditor; no
// write APIs; no fixed entry index; no S2–S6 authority (no Preview slot, no
// Apply/commit). Also asserts the S1 tests themselves never reference the
// real home or web profile.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const IMPL = path.join(REPO_ROOT, 'profile', 'target-resolver.mjs');
const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));

describe('S1 static boundary', () => {
  it('RED-S1-STATIC-EXPORTS exposes only the S1 seam', async () => {
    const mod = await import(`file://${IMPL}`);
    const names = Object.keys(mod).sort();
    assert.deepEqual(names, [
      'EXPECTED_VERSIONS',
      'REFUSAL_CODES',
      'admitDependencyPackages',
      'classifyTarget',
      'findDshExecutable',
      'resolveProfileTarget',
      'sameTarget',
      'validateProfileName',
    ]);
  });

  it('RED-S1-STATIC-IMPORTS allows only node builtins + yaml (no DSH/Loader/HMR imports)', () => {
    const src = fs.readFileSync(IMPL, 'utf8');
    const specifiers = [];
    for (const m of src.matchAll(/^\s*import\s+[^;]*?\bfrom\s+['"]([^'"]+)['"]/gm)) specifiers.push(m[1]);
    for (const m of src.matchAll(/(?:require|import)\s*\(\s*['"]([^'"]+)['"]/g)) specifiers.push(m[1]);
    assert.ok(specifiers.length > 0, 'no imports found');
    for (const s of specifiers) {
      const allowed = s.startsWith('node:') || s.startsWith('./') || s.startsWith('../') || s === 'yaml';
      assert.equal(allowed, true, `forbidden import specifier: ${s}`);
    }
    const code = src.split('\n').map((line) => line.split('//')[0]).join('\n');
    for (const ident of ['ConfigEditor', 'reconcileProfilePatches', 'withFileLock', 'writeFileAtomic', 'loadProfileDirectory', 'readProfilePatches', 'composeEntries', 'entryListSchema', 'runExclusive', 'previewId', 'commitPlan', 'buildPlan']) {
      assert.equal(new RegExp(`\\b${ident}\\b`).test(code), false, `S2/S4/native symbol present: ${ident}`);
    }
  });

  it('RED-S1-STATIC-NOWRITE forbids filesystem mutation APIs in the resolver', () => {
    const src = fs.readFileSync(IMPL, 'utf8');
    for (const bad of ['writeFileSync', 'appendFileSync', 'renameSync', 'mkdirSync', 'rmSync', 'copyFileSync', 'mkdtemp', 'unlinkSync', 'rmdirSync']) {
      assert.equal(src.includes(bad), false, `write API present: ${bad}`);
    }
  });

  it('RED-S1-STATIC-NOINDEX forbids fixed numeric entry lookup', () => {
    const src = fs.readFileSync(IMPL, 'utf8');
    assert.equal(/\[\s*12\s*\]/.test(src), false, 'numeric index 12 present');
    assert.equal(/\.at\s*\(\s*12/.test(src), false, '.at(12 present');
    assert.ok(/\bid\s*(===|!==)\s*'llm-pi-ai'/.test(src), 'id-based scan missing');
  });

  it('RED-S1-STATIC-TEST-HYGIENE tests never reference the real home or web profile', () => {
    const files = fs.readdirSync(TEST_DIR).filter((f) => f.endsWith('.mjs'));
    assert.ok(files.length >= 3);
    // Fragments are joined so this scanner never matches its own source text.
    const bad = [
      ['profiles', '/', 'web'],
      ['profiles', '\\', 'web'],
      ['USER', 'PROFILE'],
      ['os.', 'homedir'],
      ['settings', '.yaml'],
      ['.', 'dsh', '\\settings'],
      ['OPENCODE_', 'GO_API_KEY'],
      ['OPENCODE_', 'API_KEY'],
    ].map((parts) => parts.join(''));
    for (const f of files) {
      if (f === 'boundary.test.mjs') continue; // self-scan would match the fragments above
      const src = fs.readFileSync(path.join(TEST_DIR, f), 'utf8');
      for (const needle of bad) {
        assert.equal(src.includes(needle), false, `${f} references production surface: ${needle}`);
      }
    }
  });

  it('RED-S1-STATIC-REFUSALS documents every returned code in REFUSAL_CODES', async () => {
    const mod = await import(`file://${IMPL}`);
    for (const code of ['INVALID_PROFILE_NAME', 'PROFILE_NOT_INITIALIZED', 'SYMLINK_ESCAPE', 'PATCH_UNREADABLE', 'PATCH_PARSE_ERROR', 'PATCH_ROOT_NOT_SEQUENCE', 'PLUGIN_ENTRY_MISSING', 'PLUGIN_ENTRY_DUPLICATE', 'NOT_PROFILE_OWNED', 'SCRATCH_MODE_PRODUCTION_REFUSED', 'INCOMPATIBLE_DSH']) {
      assert.ok(mod.REFUSAL_CODES.includes(code), `code not listed: ${code}`);
    }
  });
});
