// S4-B4 admission and surgical preservation (T03/T05/T06/T07).
import { describe, it, beforeEach, afterEach } from 'node:test';
import { ProfileAwareCommit } from '../../profile/commit.mjs';
import { assert, makeTempHome, sandboxDshHome, buildReadyPlan, readPatchBytes, backupNames, tempNames, overwritePatchText, sha256Hex, patchMtimeMs } from './helpers.mjs';
describe('S4-B4 admission and preservation', () => {
  let home; let restore; let cleanupHome;
  beforeEach(() => { restore = sandboxDshHome(); const h = makeTempHome(); home = h.home; cleanupHome = h.cleanup; });
  afterEach(() => { try { cleanupHome(); } catch {} try { restore(); } catch {} });
  it('malformed YAML refuses with zero side effects', async () => {
    const built = await buildReadyPlan({ home });
    const plan = structuredClone(built.plan); const profileDir = built.profileDir;
    overwritePatchText(profileDir, '::: not yaml :::\n  - [unclosed');
    const bad = readPatchBytes(profileDir);
    plan.patchDigest = sha256Hex(bad); plan.target.patchDigest = sha256Hex(bad);
    const m0 = patchMtimeMs(profileDir);
    const res = await ProfileAwareCommit({ plan, waitMs: 8000 });
    assert.equal(res.ok, false);
    assert.deepEqual(backupNames(profileDir), []); assert.deepEqual(tempNames(profileDir), []);
    assert.ok(readPatchBytes(profileDir).equals(bad)); assert.equal(patchMtimeMs(profileDir), m0);
  });
  it('duplicate entry refuses without picking', async () => {
    const built = await buildReadyPlan({ home });
    const plan = structuredClone(built.plan); const profileDir = built.profileDir;
    const dup = '- id: llm-pi-ai\n  name: A\n- id: llm-pi-ai\n  name: B\n';
    overwritePatchText(profileDir, dup);
    const bad = readPatchBytes(profileDir);
    plan.patchDigest = sha256Hex(bad); plan.target.patchDigest = sha256Hex(bad);
    const res = await ProfileAwareCommit({ plan, waitMs: 8000 });
    assert.equal(res.ok, false); assert.equal(res.code, 'PLUGIN_ENTRY_DUPLICATE');
    assert.deepEqual(backupNames(profileDir), []);
  });
  it('anchor in managed span refuses', async () => {
    const built = await buildReadyPlan({ home });
    const plan = built.plan; const profileDir = built.profileDir;
    const tampered = structuredClone(plan);
    tampered.desired['opencode'] = [{ id: 'a1', extra: 'x'.repeat(50) }];
    const res = await ProfileAwareCommit({ plan: tampered, waitMs: 8000 });
    assert.equal(res.ok, false);
    assert.deepEqual(backupNames(profileDir), []);
  });
  it('unrelated-byte candidate refuses UNRELATED_CONTENT_CHANGED', async () => {
    const built = await buildReadyPlan({ home });
    const plan = structuredClone(built.plan); const profileDir = built.profileDir;
    const beforeBytes = readPatchBytes(profileDir);
    plan.candidateDigest = 'f'.repeat(64);
    const res = await ProfileAwareCommit({ plan, waitMs: 8000 });
    assert.equal(res.ok, false);
    assert.ok(readPatchBytes(profileDir).equals(beforeBytes));
    assert.deepEqual(backupNames(profileDir), []);
  });
  it('duplicate managed IDs refuse', async () => {
    const built = await buildReadyPlan({ home });
    const plan = structuredClone(built.plan); const profileDir = built.profileDir;
    plan.desired['opencode-go'] = [{ id: 'same-id' }];
    plan.desired['opencode-go-messages'] = [{ id: 'same-id' }];
    const res = await ProfileAwareCommit({ plan, waitMs: 8000 });
    assert.equal(res.ok, false);
    assert.deepEqual(backupNames(profileDir), []);
  });
});
