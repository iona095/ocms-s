// S3 refusal-taxonomy [GLM L13/L19; DeepSeek F14]. Scratch-only: every fixture is a
// synthetic profile under os.tmpdir(); DSH_HOME is sandboxed per test.
import { describe, it, beforeEach, afterEach } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { ProfileAwareCommit, COMMIT_REFUSAL_CODES } from '../../profile/commit.mjs';
import { assert, makeTempHome, sandboxDshHome, buildReadyPlan } from '../profile-commit/helpers.mjs';

describe('S3 refusal taxonomy: one code per vanished-profile condition', () => {
  let home; let restore; let cleanupHome;
  beforeEach(() => { restore = sandboxDshHome(); const h = makeTempHome('ocms-s3-'); home = h.home; cleanupHome = h.cleanup; });
  afterEach(() => { try { cleanupHome(); } catch {} try { restore(); } catch {} });

  it('COMMIT_REFUSAL_CODES lists every code commit.mjs returns as a refusal', () => {
    for (const code of ['PROFILE_NOT_INITIALIZED', 'SYMLINK_ESCAPE']) {
      assert.ok(COMMIT_REFUSAL_CODES.includes(code), code + ' must be a declared commit refusal code');
    }
  });

  // RESIDUAL (not S3): a whole-directory removal is caught later, at render, and
  // surfaces as VERIFY_FAILED. S3 only asserts that it is a BLOCKED, non-stale refusal.
  it('profile directory removed after planning: BLOCKED refusal, never a stale re-bind', async () => {
    const built = await buildReadyPlan({ home });
    fs.rmSync(built.profileDir, { recursive: true, force: true });
    const res = await ProfileAwareCommit({ plan: built.plan, waitMs: 8000 });
    assert.equal(res.ok, false);
    assert.equal(res.status, 'BLOCKED');
    assert.notEqual(res.stale, true);
    assert.notEqual(res.code, 'STALE_TARGET');
  });

  it('manifest removed after planning: same single code PROFILE_NOT_INITIALIZED, BLOCKED, not stale', async () => {
    const built = await buildReadyPlan({ home });
    fs.rmSync(path.join(built.profileDir, 'package.json'), { force: true });
    const res = await ProfileAwareCommit({ plan: built.plan, waitMs: 8000 });
    assert.equal(res.ok, false);
    assert.equal(res.code, 'PROFILE_NOT_INITIALIZED');
    assert.equal(res.status, 'BLOCKED');
    assert.notEqual(res.stale, true);
  });
});
