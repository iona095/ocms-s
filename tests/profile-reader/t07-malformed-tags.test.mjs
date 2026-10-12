// S2 T07 — malformed YAML and tag-dialect refusal (P0-R2 §9.13; P1-A §5 S2).
//
// Unparsable YAML, unresolvable/unsupported tags (inside AND outside the
// managed entry), duplicate keys, cyclic aliases, and non-mapping rows all
// refuse without writing. Tags are data, never code.
import { describe, it, beforeEach, afterEach } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { readManagedConfig } from '../../profile/config-reader.mjs';
import {
  assert,
  makeTempHome,
  sandboxDshHome,
  sha256Hex,
  decoyRow,
  llmRow,
  makeProfile,
  makeFixtureBundle,
  bindReal,
  readerOpts,
  snapshotTree,
  assertNoMutation,
  assertNoSecrets,
} from './helpers.mjs';

let home;
let cleanupHome;
let restoreDshHome;

function bindValid(name, entries) {
  const profileDir = makeProfile(home, name, { entries });
  makeFixtureBundle(profileDir);
  return { profileDir, target: bindReal(home, name) };
}

beforeEach(() => {
  restoreDshHome = sandboxDshHome();
  ({ home, cleanup: cleanupHome } = makeTempHome());
});

afterEach(() => {
  cleanupHome();
  restoreDshHome();
});

// Bind on valid bytes, then swap in hostile bytes with a re-issued digest:
// S2 discovers current bytes; S1 would refuse these shapes at admission.
function hostile(name, raw) {
  const { profileDir, target } = bindValid(name, [llmRow(), decoyRow('x')]);
  const patchPath = path.join(profileDir, 'cordis.patch.yml');
  fs.writeFileSync(patchPath, raw, 'utf8');
  return { profileDir, forged: { ...target, patchDigest: sha256Hex(fs.readFileSync(patchPath)) } };
}

describe('S2 T07 — malformed YAML and tag refusal', () => {
  for (const [label, raw] of [
    ['unparsable', '- id: [unclosed\n  bad: : :\n'],
    ['tab-indent', '- id: a\n\tbad: 1\n'],
    ['dup-keys', '- id: llm-pi-ai\n  id: llm-pi-ai\n'],
  ]) {
    it(`T07 ${label} refuses PATCH_PARSE_ERROR without writing`, async () => {
      const { profileDir, forged } = hostile(`mal-${label}`, raw);
      const snap = snapshotTree(profileDir);
      const r = await readManagedConfig(readerOpts(forged));
      assert.equal(r.ok, false);
      assert.equal(r.code, 'PATCH_PARSE_ERROR');
      assertNoMutation(snap, profileDir, `T07 ${label}: read mutated disk`);
    });
  }

  for (const [label, raw] of [
    ['unknown-tag-inside-entry', '- id: llm-pi-ai\n  name: X\n  config: !foo {providers: {}}\n'],
    ['unknown-tag-outside-entry', '- id: other\n  config: !foo {a: 1}\n- id: llm-pi-ai\n  config: {providers: {}}\n'],
    ['unknown-tag-on-models', '- id: llm-pi-ai\n  config:\n    providers:\n      opencode: !foo {models: []}\n'],
    ['js-tag-on-mapping', '- id: llm-pi-ai\n  config: !!js {providers: {}}\n'],
    ['scalar-row', '- just-a-string\n- id: llm-pi-ai\n  config: {providers: {}}\n'],
    ['null-row', '-\n- id: llm-pi-ai\n  config: {providers: {}}\n'],
    ['array-row', '- [a, b]\n- id: llm-pi-ai\n  config: {providers: {}}\n'],
  ]) {
    it(`T07 ${label} refuses without writing`, async () => {
      const { profileDir, forged } = hostile(`tag-${label}`, raw);
      // llm row needs the fixture name for composition; raw rows here omit
      // names (absent names apply) except where the tag itself must fail.
      const snap = snapshotTree(profileDir);
      const r = await readManagedConfig(readerOpts(forged));
      assert.equal(r.ok, false, `expected refusal: ${JSON.stringify(r)}`);
      assert.ok(['PATCH_PARSE_ERROR', 'PATCH_ROOT_NOT_SEQUENCE'].includes(r.code), `code: ${r.code}`);
      assertNoMutation(snap, profileDir, `T07 ${label}: read mutated disk`);
    });
  }

  it('T07 unknown tags refuse even when outside the managed entry (never silently dropped)', async () => {
    const { profileDir, forged } = hostile(
      'tag-outside',
      '- id: unrelated\n  config:\n    keep: !custom-tag value\n- id: llm-pi-ai\n  config: {providers: {}}\n',
    );
    const r = await readManagedConfig(readerOpts(forged));
    assert.equal(r.ok, false);
    assert.equal(r.code, 'PATCH_PARSE_ERROR');
  });

  it('T07 cyclic aliases refuse PATCH_PARSE_ERROR', async () => {
    const { profileDir, forged } = hostile(
      'cyclic',
      '- &a {id: llm-pi-ai, self: *a, config: {providers: {}}}\n',
    );
    const snap = snapshotTree(profileDir);
    const r = await readManagedConfig(readerOpts(forged));
    assert.equal(r.ok, false);
    assert.equal(r.code, 'PATCH_PARSE_ERROR');
    assertNoMutation(snap, profileDir, 'T07 cyclic: read mutated disk');
  });

  it('T07 tag-shaped payloads never execute and never leak into refusals', async () => {
    const { profileDir, forged } = hostile(
      'tagexec',
      '- id: llm-pi-ai\n  config: !explode {providers: {}, note: SYNTHETIC_FAKE_KEY_alpha bravo 001}\n',
    );
    const r = await readManagedConfig(readerOpts(forged));
    assert.equal(r.ok, false);
    assert.equal(r.code, 'PATCH_PARSE_ERROR');
    assertNoSecrets(r, 'T07 tagexec refusal');
  });

  it('T07 js-tagged id is not an ownership candidate', async () => {
    // `id: !!js "llm-pi-ai"` boxes to an object in the composition dialect:
    // it must not count as the owned row.
    const { profileDir, forged } = hostile(
      'jsid',
      '- id: !!js "llm-pi-ai"\n  config: {providers: {}}\n- id: other\n  config: {}\n',
    );
    const r = await readManagedConfig(readerOpts(forged));
    assert.equal(r.ok, false);
    assert.equal(r.code, 'PLUGIN_ENTRY_MISSING');
  });
});
