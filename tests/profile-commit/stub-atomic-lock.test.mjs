// 0a: the test-only atomic stub must use the sibling lock file, not the target.
// The commit layer passes <profileDir>/package.json as the lock resource. The
// native contract creates <resource>.lock. This regression test owns its temp
// directory, has a bounded wait, and checks both the sibling and target bytes.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { stubDshTree } from '../support/dsh-stub-tree.mjs';

describe('test-only atomic lock uses package.json.lock', () => {
  it('an existing package.json does not block the sibling lock', async (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocms-0a-stub-lock-'));
    t.after(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });
    const lockResource = path.join(dir, 'package.json');
    const sibling = lockResource + '.lock';
    const before = Buffer.from('{"name":"fixture"}', 'utf8');
    fs.writeFileSync(lockResource, before);
    const { scope } = stubDshTree();
    const atomic = await import(pathToFileURL(path.join(scope, 'dsh-atomic-write', 'lib', 'index.mjs')).href);
    const started = Date.now();
    const result = await atomic.withFileLock(lockResource, async () => {
      assert.equal(fs.existsSync(sibling), true, 'the lock file must be the sibling while held');
      assert.deepEqual(fs.readFileSync(lockResource), before, 'the target must be unchanged while locked');
      return 'entered';
    }, { waitMs: 250 });
    assert.equal(result, 'entered');
    assert.ok(Date.now() - started < 2000, 'an uncontended lock must not wait for the timeout');
    assert.equal(fs.existsSync(sibling), false, 'the sibling lock must be released');
    assert.deepEqual(fs.readFileSync(lockResource), before, 'the target must still be unchanged');
  });
});
