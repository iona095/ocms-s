// P3 (report C16; GLM L4; Space Bunny): the package 'bin' field must not be
// able to escape the package root. The check split only on '/', so a
// backslash traversal ('..\\..\\x.js') was accepted and joined onto the root.
// Pure test: fs is injected, no dsh install, no network, no child process.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { resolveDshLaunch } from '../../scripts/dev-tools.mjs';

const SHIM = path.join('C:\\npm-global', 'dsh.cmd');
const ROOT = path.join('C:\\npm-global', 'node_modules', '@deepseek-ai', 'dsh');

function fakeFs(binField) {
  const pkg = JSON.stringify({ name: '@deepseek-ai/dsh', bin: binField });
  return {
    readFile: async (p) => (String(p).endsWith('package.json') ? pkg : ''),
    stat: async () => ({ isFile: () => true }),
  };
}

async function resolve(binField) {
  return resolveDshLaunch(SHIM, fakeFs(binField));
}

describe('P3 — dev-tools bin field cannot escape the package root', () => {
  it('CONTROL: refuses a forward-slash traversal (already refused before the fix)', async () => {
    for (const bin of ['../x.js', '..', '../../x.js', 'a/../../x.js', 'bin/../../../x.js']) {
      const res = await resolve(bin);
      assert.equal(res, null, bin + ' must be refused');
    }
  });

  it('DEFECT: refuses a BACKSLASH traversal', async () => {
    for (const bin of ['..\\..\\x.js', '..\\x.js', 'bin\\..\\..\\x.js', 'a\\..\\..\\x.js']) {
      const res = await resolve(bin);
      assert.equal(res, null, bin + ' must be refused (backslash traversal escapes the package root)');
    }
  });

  it('refuses mixed and repeated separators', async () => {
    for (const bin of ['..\\../x.js', '../..\\x.js', '..\\..//x.js', '.. /..\\x.js'.replace(' ', '')]) {
      const res = await resolve(bin);
      assert.equal(res, null, bin + ' must be refused');
    }
  });

  it('refuses drive-relative and drive-absolute bin fields', async () => {
    for (const bin of ['C:x.js', 'C:\\x.js', 'd:..\\..\\x.js', '\\\\server\\share\\x.js']) {
      const res = await resolve(bin);
      assert.equal(res, null, bin + ' must be refused');
    }
  });

  it('refuses an absolute POSIX bin field', async () => {
    const res = await resolve('/etc/x.js');
    assert.equal(res, null, 'a POSIX absolute bin field must be refused');
  });

  it('still accepts an ordinary in-package bin and resolves it under the root', async () => {
    const res = await resolve('bin/dsh.js');
    assert.ok(res && res.file, 'an ordinary bin resolves');
    assert.equal(res.argsPrefix.length, 1);
    const entry = res.argsPrefix[0];
    const rel = path.relative(ROOT, entry);
    assert.ok(
      !rel.startsWith('..') && !path.isAbsolute(rel),
      'the accepted entry stays under the package root, got: ' + entry,
    );
  });

  it('still accepts a nested ordinary bin', async () => {
    const res = await resolve('dist/cli.js');
    assert.ok(res && res.file, 'a nested ordinary bin resolves');
  });
});
