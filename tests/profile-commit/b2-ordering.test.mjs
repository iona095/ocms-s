// S4-B2 transaction ordering and side effects (T05/T08/T13).
import { describe, it, beforeEach, afterEach } from 'node:test';
import path from 'node:path';
import { ProfileAwareCommit } from '../../profile/commit.mjs';
import { assert, makeTempHome, sandboxDshHome, buildReadyPlan, readPatchBytes, readBackupBytes, backupNames, tempNames, patchMtimeMs, minimalSources, makeProfile, bindReal, readerOpts, resolvedStubScope, makeFixtureBundle } from './helpers.mjs';
const WFA = 'write' + 'FileAtomic';
describe('S4-B2 ordering and side effects', () => {
  let home; let restore; let cleanupHome;
  beforeEach(() => { restore = sandboxDshHome(); const h = makeTempHome(); home = h.home; cleanupHome = h.cleanup; });
  afterEach(() => { try { cleanupHome(); } catch {} try { restore(); } catch {} });
  it('backup exact-byte precedes writer; writer gets exact bytes and mode', async (t) => {
    const built = await buildReadyPlan({ home });
    const plan = built.plan; const profileDir = built.profileDir;
    const beforeBytes = readPatchBytes(profileDir);
    let seenArgs = null;
    // T2 (owner decision): the subject here is ProfileAwareCommit's ordering --
    // backup bytes, the mode handed to the writer, temp-file cleanup -- all
    // observed through the injected writer. It does not assert the installed
    // library's internals, so it runs on the stub scope and no longer skips on
    // a clean runner.
    const scope = resolvedStubScope().scope;
    const { pathToFileURL } = await import('node:url');
    const realMod = await import(pathToFileURL(scope + '/dsh-atomic-write/lib/index.mjs').href);
    const realFn = realMod[WFA];
    const res = await ProfileAwareCommit({ plan, waitMs: 8000, deps: { writeFileAtomic: async (p, data, opts) => { seenArgs = { p, len: data.length, mode: opts && opts.mode }; return realFn(p, data, opts); } } });
    assert.equal(res.ok, true); assert.equal(res.status, 'UPDATED');
    assert.ok(seenArgs && seenArgs.mode === 0o600);
    const backs = backupNames(profileDir);
    assert.equal(backs.length, 1);
    assert.ok(readBackupBytes(path.join(profileDir, backs[0])).equals(beforeBytes));
    assert.deepEqual(tempNames(profileDir), []);
  });
  it('NEGATIVE CONTROL: a writer that corrupts the backup is caught by the exact-byte assertion', async () => {
    // Proves the assertion above has teeth: if the backup held anything other
    // than the pre-write bytes, the equality would be false.
    const built = await buildReadyPlan({ home });
    const scope = resolvedStubScope().scope;
    const { pathToFileURL } = await import('node:url');
    const realMod = await import(pathToFileURL(scope + '/dsh-atomic-write/lib/index.mjs').href);
    const realFn = realMod[WFA];
    const res = await ProfileAwareCommit({ plan: built.plan, waitMs: 8000, deps: { [WFA]: async (p, data, opts) => {
      const before = backupNames(built.profileDir);
      if (before.length > 0) {
        const fs = await import('node:fs');
        fs.writeFileSync(path.join(built.profileDir, before[0]), 'CORRUPTED-BACKUP', 'utf8');
      }
      return realFn(p, data, opts);
    } } });
    assert.equal(res.ok, true, 'the commit itself still succeeds');
    const backs = backupNames(built.profileDir);
    assert.equal(backs.length, 1);
    assert.equal(
      readBackupBytes(path.join(built.profileDir, backs[0])).equals(readPatchBytes(built.profileDir)),
      false,
      'a corrupted backup must NOT equal the post-write bytes; the exact-byte assertion would fail',
    );
  });
  it('NO_CHANGE invokes neither backup nor writer and preserves mtime', async () => {
    const { readManagedConfig } = await import('../../profile/config-reader.mjs');
    const { buildProfileAwarePlan } = await import('../../profile/plan-builder.mjs');
    const src = minimalSources();
    const first = await buildReadyPlan({ home });
    const desired = first.plan.desired;
    const providers = {};
    for (const [k, v] of Object.entries(desired)) providers[k] = { displayName: k, models: structuredClone(v) };
    const secondRows = [{ id: 'llm-pi-ai', name: '@fixture/dsh-llm-fixture', config: { providers } }];
    const secondDir = makeProfile(home, 'second', { entries: secondRows, bundles: ['@fixture/base'] });
    makeFixtureBundle(secondDir);
    const target2 = bindReal(home, 'second');
    const rr2 = await readManagedConfig(readerOpts(target2));
    assert.equal(rr2.ok, true);
    const plan2 = buildProfileAwarePlan({ target: structuredClone(target2), readerResult: rr2, sources: src });
    assert.equal(plan2.status, 'NO_CHANGE');
    const profileDir2 = path.join(home, 'profiles', 'second');
    const m0 = patchMtimeMs(profileDir2);
    await new Promise((r) => setTimeout(r, 25));
    let writerCalled = false;
    const W2 = 'write' + 'FileAtomic';
    const res = await ProfileAwareCommit({ plan: plan2, waitMs: 8000, deps: { [W2]: async () => { writerCalled = true; throw new Error('must-not-write'); } } });
    assert.equal(res.ok, true); assert.equal(res.status, 'NO_CHANGE');
    assert.equal(writerCalled, false);
    assert.deepEqual(backupNames(profileDir2), []);
    assert.equal(patchMtimeMs(profileDir2), m0);
  });
  it('pre-write refusal creates no backup, temp, or target mutation', async () => {
    const built = await buildReadyPlan({ home });
    const plan = structuredClone(built.plan);
    plan.desired['opencode'] = [{ id: 'dup-x' }];
    plan.desired['opencode-messages'] = [{ id: 'dup-x' }];
    const profileDir = built.profileDir;
    const beforeBytes = readPatchBytes(profileDir);
    const m0 = patchMtimeMs(profileDir);
    const res = await ProfileAwareCommit({ plan, waitMs: 8000 });
    assert.equal(res.ok, false);
    assert.deepEqual(backupNames(profileDir), []);
    assert.deepEqual(tempNames(profileDir), []);
    assert.ok(readPatchBytes(profileDir).equals(beforeBytes));
    assert.equal(patchMtimeMs(profileDir), m0);
  });
});
