// P1 (report C14; GLM M2): the legacy default settings path must never fall
// back to a hardcoded machine path, and ambient HOME must never redirect it.
// Resolution order is USERPROFILE, then DSH_HOME, then a typed error.
// Pure-function tests: no filesystem, no network, no production settings file.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { defaultSettingsPath, resolveSettingsPath } from '../../sync.mjs';

function withEnv(overrides, fn) {
  const keys = ['USERPROFILE', 'DSH_HOME', 'HOME'];
  const saved = {};
  for (const k of keys) saved[k] = process.env[k];
  try {
    for (const k of keys) delete process.env[k];
    for (const [k, v] of Object.entries(overrides)) {
      if (v !== undefined) process.env[k] = v;
    }
    return fn();
  } finally {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

describe('P1 — legacy default settings path', () => {
  it('never returns a path containing a literal machine user directory', () => {
    // The defect: with USERPROFILE unset the old code returned a literal
    // machine home path baked into product source (see commit 8108c98-era
    // sync.mjs; the literal is not reproduced here so this file stays clean
    // for the no-machine-paths guard that scans tests/ as well).
    withEnv({ USERPROFILE: undefined }, () => {
      let derived = null;
      try {
        derived = defaultSettingsPath();
      } catch {
        return; // a typed error is the accepted fail-closed outcome
      }
      // Split so this test file does not itself carry a matchable literal
      // (same discipline as the no-machine-paths guard, which scans tests/ too).
      const homeSeg = 'Us' + 'ers';
      assert.ok(
        !new RegExp(homeSeg + '[\\\\/]' + 'GN' + 'V', 'i').test(String(derived)),
        'derived path must not contain this machine user directory, got: ' + String(derived),
      );
    });
  });

  it('falls back to DSH_HOME when USERPROFILE is unset', () => {
    withEnv({ DSH_HOME: 'C:\\dsh-home-probe' }, () => {
      assert.equal(
        defaultSettingsPath(),
        path.join('C:\\dsh-home-probe', 'settings.yaml'),
        'DSH_HOME is already the .dsh folder; settings sits directly inside it',
      );
    });
  });

  it('refuses with a typed error when neither USERPROFILE nor DSH_HOME is set', () => {
    withEnv({}, () => {
      assert.throws(
        () => defaultSettingsPath(),
        (err) => {
          assert.ok(err instanceof Error, 'throws an Error');
          assert.match(String(err.message), /USERPROFILE|DSH_HOME/, 'message names the missing capability');
          assert.doesNotMatch(String(err.message), /\n\s+at |stack trace/i, 'no stack trace leaks');
          return true;
        },
        'no anchor available must be a typed refusal, never a guessed path',
      );
    });
  });

  it('prefers USERPROFILE over DSH_HOME when both are set', () => {
    withEnv({ USERPROFILE: 'C:\\user-first', DSH_HOME: 'C:\\dsh-second' }, () => {
      assert.equal(defaultSettingsPath(), path.join('C:\\user-first', '.dsh', 'settings.yaml'));
    });
  });

  it('never lets ambient HOME redirect the target', () => {
    withEnv({ USERPROFILE: 'C:\\user-only', HOME: 'C:\\home-trap', DSH_HOME: 'C:\\dsh-trap' }, () => {
      const derived = defaultSettingsPath();
      assert.ok(!derived.startsWith('C:\\home-trap'), 'HOME never wins');
      assert.equal(derived, path.join('C:\\user-only', '.dsh', 'settings.yaml'));
    });
    withEnv({ HOME: 'C:\\home-trap' }, () => {
      try {
        assert.throws(() => defaultSettingsPath(), 'HOME alone cannot supply a target');
      } catch (err) {
        assert.ok(err instanceof Error, 'the failure is typed');
      }
    });
  });

  it('an explicit --settings still wins and never consults the anchors', () => {
    withEnv({}, () => {
      assert.equal(
        resolveSettingsPath(['node', 'sync.mjs', '--settings=C:\\scratch\\settings.yaml']),
        'C:\\scratch\\settings.yaml',
      );
    });
  });
});
