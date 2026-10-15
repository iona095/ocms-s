// D09: the commit pins the verified plan by value at entry. A caller-side
// mutation of the same plan object after the call starts cannot change the
// outcome: the commit acts on its entry snapshot (UPDATED here), while a
// mutation made before the call is observed and refused.
import { describe, it, beforeEach, afterEach } from 'node:test';
import { ProfileAwareCommit } from '../../profile/commit.mjs';
import {
  assert,
  makeTempHome,
  sandboxDshHome,
  buildReadyPlan,
} from './helpers.mjs';

describe('D09 — retained plan snapshot isolation', () => {
  let home;
  let restore;
  let cleanupHome;
  beforeEach(() => {
    restore = sandboxDshHome();
    const h = makeTempHome();
    home = h.home;
    cleanupHome = h.cleanup;
  });
  afterEach(() => {
    try { cleanupHome(); } catch {}
    try { restore(); } catch {}
  });

  it('mutating the aliased plan after the call starts changes nothing', async () => {
    const built = await buildReadyPlan({ home });
    const pending = ProfileAwareCommit({ plan: built.plan, waitMs: 8000 });
    built.plan.desired.opencode = 'MUTATED-AFTER-CALL';
    built.plan.status = 'MUTATED';
    const res = await pending;
    assert.equal(res.ok, true, 'entry snapshot pins the verified plan: ' + JSON.stringify(res.code || res.status));
    assert.equal(res.status, 'UPDATED');
  });

  it('mutating the plan before the call is observed and refused', async () => {
    const built = await buildReadyPlan({ home });
    built.plan.desired.opencode = 'MUTATED-BEFORE-CALL';
    const res = await ProfileAwareCommit({ plan: built.plan, waitMs: 8000 });
    assert.equal(res.ok, false);
    assert.ok(['VERIFY_FAILED', 'MEMBERSHIP_MISMATCH'].includes(res.code), 'mutated plan refused, got: ' + res.code);
  });
});
