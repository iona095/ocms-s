// S14 empty-providers-f2: FALSE POSITIVE — not a defect. F2 route creation
// into an empty providers map refuses UNPRESERVABLE_STRUCTURE, and SPEC
// (9.15 unsafe-structure refusals, 9.16 construction rules) mandates exactly
// that: 'an F1-add/F2 insertion has no reference column to derive indentation
// from (empty or absent maps with no block-style sibling keys)... Never infer
// formatting; refuse.' Changing it to invent indentation would violate the
// spec, so: guard test only, NO product change. The guard is load-bearing as
// a tripwire (any splice-instead-of-refuse breaks it). Scratch-only fixtures.
import { describe, it, beforeEach, afterEach } from 'node:test';
import { assert, makeTempHome, sandboxDshHome, makeProfile, makeFixtureBundle, bindReal, readerOpts, minimalSources } from '../profile-commit/helpers.mjs';
import { readManagedConfig } from '../../profile/config-reader.mjs';
import { buildProfileAwarePlan } from '../../profile/plan-builder.mjs';

describe('S14 empty-providers-f2 refuses per SPEC (guard)', () => {
  let home; let restore; let cleanupHome;
  beforeEach(() => { restore = sandboxDshHome(); const h = makeTempHome('ocms-s14-'); home = h.home; cleanupHome = h.cleanup; });
  afterEach(() => { try { cleanupHome(); } catch {} try { restore(); } catch {} });

  it('F2 into an empty providers map refuses UNPRESERVABLE_STRUCTURE, BLOCKED, zero writes', async () => {
    const dir = makeProfile(home, 's14', { entries: [{ id: 'llm-pi-ai', name: '@fixture/x', config: { providers: {} } }], bundles: ['@fixture/base'] });
    makeFixtureBundle(dir);
    const target = bindReal(home, 's14');
    const readerResult = await readManagedConfig(readerOpts(target));
    assert.equal(readerResult.ok, true, 'reader admits the empty map: ' + JSON.stringify(readerResult).slice(0, 200));
    const plan = buildProfileAwarePlan({ target: structuredClone(target), readerResult, sources: minimalSources() });
    assert.equal(plan.ok, false, 'F2 refuses: ' + JSON.stringify(plan).slice(0, 200));
    assert.equal(plan.code, 'UNPRESERVABLE_STRUCTURE', 'exact spec refusal code');
    assert.equal(plan.status, 'BLOCKED', 'fail-closed, never a partial write');
  });
});
