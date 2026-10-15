// R2-B4 writer-failure truth. Scratch-only.
import { describe, it, beforeEach, afterEach } from 'node:test';
import path from 'node:path';
import { ProfileAwareCommit } from '../../profile/commit.mjs';
import { assert, makeTempHome, sandboxDshHome, buildReadyPlan, backupNames, readPatchBytes, readBackupBytes, resolvedStubScope } from './helpers.mjs';
const WFA = 'write' + 'FileAtomic';
describe('R2-B4 writer truth', () => {
  let home; let restore; let cleanupHome;
  beforeEach(() => { restore = sandboxDshHome(); const h = makeTempHome(); home = h.home; cleanupHome = h.cleanup; });
  afterEach(() => { try { cleanupHome(); } catch {} try { restore(); } catch {} });
  it('replace-then-throw enters post-write safe-error with observed new digest', async (t) => {
    const built = await buildReadyPlan({ home });
    const before = readPatchBytes(built.profileDir);
    // T2 (owner decision): the subject is the commit's post-write truth (the
    // safe-error code, the preserved backup, the observed digest), all observed
    // through the injected writer. It runs on the stub scope and no longer skips.
    const scope = resolvedStubScope().scope;
    const { pathToFileURL } = await import('node:url');
    const realMod = await import(pathToFileURL(scope + '/dsh-atomic-write/lib/index.mjs').href);
    const realFn = realMod[WFA];
    const res = await ProfileAwareCommit({ plan: built.plan, waitMs: 8000, deps: { [WFA]: async (p, data, opts) => { await realFn(p, data, opts); throw Object.assign(new Error('ambiguous-post-rename'), { code: 'EPERM' }); } } });
    assert.equal(res.ok, false);
    assert.equal(res.code, 'POST_WRITE_VERIFY_FAILED');
    assert.ok(res.backupPath);
    assert.ok(readBackupBytes(res.backupPath).equals(before));
    assert.equal(res.targetDigestObserved, built.plan.candidateDigest);
  });
  it('NEGATIVE CONTROL: a writer that writes nothing then throws is not treated as a successful post-write state', async () => {
    // Proves the post-write branch has teeth: when nothing reached disk, the
    // observed digest must NOT match the candidate digest, so the assertion in
    // the test above would fail rather than silently pass.
    const built = await buildReadyPlan({ home });
    const res = await ProfileAwareCommit({ plan: built.plan, waitMs: 8000, deps: { [WFA]: async () => {
      throw Object.assign(new Error('replace-then-throw-without-writing'), { code: 'EPERM' });
    } } });
    assert.equal(res.ok, false);
    assert.notEqual(
      res.targetDigestObserved,
      built.plan.candidateDigest,
      'a writer that wrote nothing cannot observe the candidate digest on disk',
    );
  });
  it('true pre-rename failure still reports WRITE_FAILED preserved', async () => {
    const built = await buildReadyPlan({ home });
    const before = readPatchBytes(built.profileDir);
    const res = await ProfileAwareCommit({ plan: built.plan, waitMs: 8000, deps: { [WFA]: async () => { throw Object.assign(new Error('pre-rename'), { code: 'EPERM' }); } } });
    assert.equal(res.ok, false); assert.equal(res.code, 'WRITE_FAILED');
    assert.ok(readPatchBytes(built.profileDir).equals(before));
  });
  it('missing target after writer error reports uncertainty, never success', async () => {
    const built = await buildReadyPlan({ home });
    const { readFileSync: rfs, rmSync: rms } = await import('node:fs');
    const res = await ProfileAwareCommit({ plan: built.plan, waitMs: 8000, deps: { [WFA]: async (p, data, opts) => { try { rms(p, { force: true }); } catch {} throw Object.assign(new Error('vanished'), { code: 'EPERM' }); } } });
    assert.equal(res.ok, false);
    assert.equal(res.code, 'POST_WRITE_VERIFY_FAILED');
    assert.ok(res.backupPath);
  });
});
