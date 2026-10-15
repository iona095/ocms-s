// 0c: resolveRealScopeOrSkip must mean the REAL installed DSH.
// A missing executable is a declared skip. A present-but-skewed executable must
// fail loudly. The test-only stub scope is available separately through
// resolveRealScope, but must never satisfy a helper whose callers execute or
// inspect the real tree.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EXPECTED, resolveInstalledScope, resolveRealScope, resolveRealScopeOrSkip, stubInstallScope } from './helpers.mjs';

function tempDir(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });
  return dir;
}

function skewedScope(dir) {
  const prefix = path.join(dir, 'prefix');
  const scope = path.join(prefix, 'node_modules', '@deepseek-ai');
  fs.mkdirSync(scope, { recursive: true });
  const versions = {
    'dsh-app-boot': EXPECTED.appBoot,
    'cordis-plugin-include': EXPECTED.includeAdmitted[0],
    'dsh-atomic-write': '9.9.9-test-skew'
  };
  for (const [pkg, version] of Object.entries(versions)) {
    const pkgDir = path.join(scope, pkg);
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({ name: '@deepseek-ai/' + pkg, version }), 'utf8');
  }
  fs.writeFileSync(path.join(prefix, process.platform === 'win32' ? 'dsh.cmd' : 'dsh'), '', 'utf8');
  return prefix;
}

function withPathEnv(value, fn) {
  const saved = Object.entries(process.env).filter(([key]) => key.toLowerCase() === 'path');
  for (const [key] of saved) delete process.env[key];
  process.env.PATH = value;
  try {
    return fn();
  } finally {
    for (const [key] of Object.keys(process.env).filter((key) => key.toLowerCase() === 'path')) delete process.env[key];
    for (const [key, previous] of saved) process.env[key] = previous;
  }
}

describe('real installed scope is never silently replaced by the stub', () => {
  it('a missing executable becomes a declared skip', async (t) => {
    const empty = tempDir(t, 'ocms-0c-missing-');
    assert.throws(() => resolveInstalledScope({ pathEnv: empty }), /no dsh executable on PATH/);
    let skipped = null;
    const fake = { skip(message) { skipped = message; } };
    withPathEnv(empty, () => {
      assert.equal(process.env.PATH, empty);
      assert.equal(resolveRealScopeOrSkip(fake), null);
    });
    assert.match(skipped, /pinned DSH/);
    assert.match(skipped, /no dsh executable on PATH/);
  });

  it('a skewed install fails instead of skipping', async (t) => {
    const dir = tempDir(t, 'ocms-0c-skewed-');
    const prefix = skewedScope(dir);
    const fake = { skip(message) { throw Object.assign(new Error('must not skip a skewed install'), { cause: message }); } };
    withPathEnv(prefix, () => {
      assert.throws(() => resolveInstalledScope({ pathEnv: process.env.PATH }), /no exact-version utility scope/);
      assert.throws(() => resolveRealScopeOrSkip(fake), /no exact-version utility scope/);
    });
  });

  it('the stub remains available to tests that do not need a real install', async (t) => {
    const empty = tempDir(t, 'ocms-0c-stub-');
    assert.equal(resolveRealScope({ pathEnv: empty }), stubInstallScope());
  });
});
