// S2 Q4 — installed dsh-llm-pi-ai schema evidence (P1-A §7 Q4; ticket S2.8).
//
// Read-only inspection of the installed dsh-llm-pi-ai@0.2.1-alpha.2 schema
// source: exact anchor, package version, applicable symbols/paths, expected
// provider/config shape, and incompatibilities with the frozen shape rules.
// The plugin runtime is never imported; installed files are never modified.
// Synthetic fixtures only; no live profile contact.
import { describe, it, beforeEach, afterEach } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { readManagedConfig } from '../../profile/config-reader.mjs';
import {
  assert,
  makeTempHome,
  sandboxDshHome,
  llmRow,
  makeProfile,
  makeFixtureBundle,
  bindReal,
  readerOpts,
  resolveRealScope,
  EXPECTED,
  FIXTURE_BUNDLE_PKG,
} from './helpers.mjs';

let home;
let cleanupHome;
let restoreDshHome;

function bind(name) {
  return bindReal(home, name);
}

beforeEach(() => {
  restoreDshHome = sandboxDshHome();
  ({ home, cleanup: cleanupHome } = makeTempHome());
});

afterEach(() => {
  cleanupHome();
  restoreDshHome();
});

describe('S2 Q4 — installed schema evidence (read-only)', () => {
  it('Q4 schema anchor resolves at the pinned version', () => {
    const scope = resolveRealScope();
    const pkgDir = path.join(scope, 'dsh-llm-pi-ai');
    const manifest = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
    assert.equal(manifest.name, '@deepseek-ai/dsh-llm-pi-ai');
    assert.equal(manifest.version, EXPECTED.dsh);
  });

  it('Q4 config shape: providers mapping with optional models arrays', () => {
    const scope = resolveRealScope();
    const configTypes = fs.readFileSync(path.join(scope, 'dsh-llm-pi-ai', 'lib', 'types', 'config.d.ts'), 'utf8');
    // Applicable symbols/paths (frozen shape expectations trace to these).
    assert.ok(configTypes.includes('PiAiProviderProfile'), 'missing PiAiProviderProfile');
    assert.ok(configTypes.includes('models?: PiAiModelProfile[]'), 'models optionality not documented');
    assert.ok(configTypes.includes('providers:'), 'providers key not documented');
    // Dormant posture blessed by the schema itself: an empty or omitted
    // providers dict mounts with no routes.
    assert.ok(configTypes.includes('dormant'), 'dormant posture not documented');
  });

  it('Q4 absent providers/models stay admitted (schema-compatible dormant)', async () => {
    const profileDir = makeProfile(home, 'q4dormant', {
      entries: [llmRow({ config: { providers: {} } })],
      bundles: [FIXTURE_BUNDLE_PKG],
    });
    makeFixtureBundle(profileDir);
    const r = await readManagedConfig(readerOpts(bind('q4dormant')));
    assert.equal(r.ok, true, `expected success: ${JSON.stringify(r)}`);
    assert.equal(r.status, 'MATCHED');
  });

  it('Q4 incompatibility note: models:null is schema-tolerated but frozen-shape-refused', async () => {
    // Installed zod: `models?: PiAiModelProfile[] | null`. Frozen §9.4
    // (validateExistingProviderShapes): present models must be an array.
    // S2 follows the frozen contract (fail-closed read admission); Loader
    // validity of such values is S6/Q2 territory, never claimed here.
    const profileDir = makeProfile(home, 'q4null', {
      entries: [llmRow({ config: { providers: { opencode: { models: null } } } })],
    });
    makeFixtureBundle(profileDir);
    const r = await readManagedConfig(readerOpts(bind('q4null')));
    assert.equal(r.ok, false);
    assert.equal(r.code, 'SETTINGS_INVALID');
  });
});
