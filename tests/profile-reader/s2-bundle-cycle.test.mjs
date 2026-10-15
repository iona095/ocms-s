// S2 (Space Bunny #7) — GUARD, NOT REPRODUCIBLE as a RangeError. The hypothesis
// was that a cyclic YAML alias in a BUNDLE layer reaches the canonical digest
// (which recursed without a visited set) and rejects readManagedConfig with a
// RangeError instead of a typed refusal, because hasCycle() covers only the
// user, home and overlay layers.
//
// Probe evidence (this is the verdict, not a defect):
//   1. The parser half IS real — the yaml library accepts a recursive alias
//      with zero document errors and yields a genuinely cyclic object
//      (v[0].self.inner === v[0].self).
//   2. The reader half is NOT reachable — bundle rows are produced by the
//      native loadProfileDirectory, which refuses a cyclic bundle patch before
//      the reader composes it. readManagedConfig returns a typed refusal
//      PATCH_UNREADABLE, never a throw.
// So this file pins the contract that actually holds: the reader NEVER throws
// and ALWAYS refuses a cyclic bundle alias. No product code changed.
import { describe, it, beforeEach, afterEach } from 'node:test';
import { readManagedConfig } from '../../profile/config-reader.mjs';
import {
  assert,
  makeTempHome,
  sandboxDshHome,
  makeProfile,
  makeFixtureBundle,
  bindReal,
  readerOpts,
  requireRealCompositionOrSkip,
  llmRow,
} from './helpers.mjs';

const NL = String.fromCharCode(10);

// A recursive alias: 'inner' is the same node as its own parent.
const CYCLIC_PATCH = [
  '- id: llm-pi-ai',
  '  name: @fixture/dsh-llm-fixture',
  '  self: &loop',
  '    inner: *loop',
  '',
].join(NL);

describe('S2 — a cyclic alias in a bundle layer', () => {
  let home;
  let cleanupHome;
  let restoreDshHome;

  beforeEach(() => {
    restoreDshHome = sandboxDshHome();
    ({ home, cleanup: cleanupHome } = makeTempHome('ocms-s2cycle-'));
  });
  afterEach(() => {
    try { cleanupHome(); } catch { /* best effort */ }
    try { restoreDshHome(); } catch { /* best effort */ }
  });

  it('refuses with a typed code instead of throwing', async (t) => {
    if (!requireRealCompositionOrSkip(t, 'real DSH bundle-layer composition semantics')) return;
    const profileDir = makeProfile(home, 's2cycle', {
      entries: [llmRow()],
      bundles: ['@fixture/base'],
    });
    makeFixtureBundle(profileDir, '@fixture/base', { rawPatch: CYCLIC_PATCH });
    const target = bindReal(home, 's2cycle');

    let thrown = null;
    let result = null;
    try {
      result = await readManagedConfig(readerOpts(target));
    } catch (err) {
      thrown = err;
    }

    assert.equal(
      thrown,
      null,
      'the reader must not throw on a cyclic bundle alias, got: ' +
        (thrown ? String((thrown && thrown.name) || '') + ': ' + String((thrown && thrown.message) || thrown).slice(0, 160) : ''),
    );
    assert.equal(result.ok, false, 'a cyclic bundle alias is refused, not accepted');
    assert.equal(
      typeof result.code,
      'string',
      'the refusal carries a typed code, got: ' + JSON.stringify(result.code) + ' status=' + JSON.stringify(result.status),
    );
    assert.match(String(result.code), /^(PATCH_|STORAGE_|SETTINGS_|VERIFY_)/, 'the code is a typed refusal, not a crash');
    assert.notEqual(result.status, 'MATCHED', 'the reader is not in a verified-truth state');
    assert.equal(String(result.message).includes('RangeError'), false, 'no stack-overflow text leaks into the refusal');
  });
});
