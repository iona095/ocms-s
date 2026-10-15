// CI1 follow-up: coverage for the invocation guard itself -- the only CI1 logic
// with no test, and the piece that decides whether the hermeticity check runs
// at all. compliance-bitch found it comparing new URL(import.meta.url).pathname
// (percent-encoded) against argv[1], so a checkout path containing a space made
// the guard never match and the gate silently exited 0 having checked nothing.
//
// These are process-level tests: they run the real script from a directory whose
// name contains a space, and import it as a module to prove the negative.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'ci-check-clean-machine.mjs');

function runScript(extraEnv) {
  // A clean-shaped env with a deliberately failing condition (DSH_HOME set),
  // so a RUNNING gate must exit 1 and a SILENTLY-SKIPPED gate exits 0.
  const env = { ...process.env, ...extraEnv };
  delete env.HOME;
  return spawnSync(process.execPath, [SCRIPT], { cwd: REPO_ROOT, env, encoding: 'utf8', timeout: 60000 });
}

describe('CI1 — the invocation guard runs the check, from any path', () => {
  it('invoked directly from a path CONTAINING A SPACE it still runs and fails', (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocms-ci1 space '));
    t.after(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } });
    const copy = path.join(dir, 'ci-check.mjs');
    fs.copyFileSync(SCRIPT, copy);
    assert.ok(copy.includes(' '), 'the copy really lives under a path containing a space');

    const res = spawnSync(process.execPath, [copy], {
      cwd: REPO_ROOT,
      env: { ...process.env, DSH_HOME: 'SENTINEL-MUST-FAIL' },
      encoding: 'utf8',
      timeout: 60000,
    });
    assert.equal(res.status, 1, 'a space in the path must not silently skip the gate (stderr: ' + String(res.stderr).slice(0, 200) + ')');
    assert.match(String(res.stderr), /DSH_HOME/, 'the failure is reported, not swallowed');
  });

  it('invoked directly from a space-free path it runs and fails', (t) => {
    const res = runScript({ DSH_HOME: 'SENTINEL-MUST-FAIL' });
    assert.equal(res.status, 1, 'the gate runs and fails when DSH_HOME is set');
    assert.match(String(res.stderr), /DSH_HOME/);
  });

  it('NEGATIVE CONTROL: importing the module as a library must NOT run the check', () => {
    const scriptUrl = 'file:///' + SCRIPT.replace(/\\/g, '/');
    const res = spawnSync(process.execPath, ['--input-type=module', '-e', 'await import(' + JSON.stringify(scriptUrl) + ');'], {
      cwd: REPO_ROOT,
      env: { ...process.env, DSH_HOME: 'SENTINEL-MUST-FAIL' },
      encoding: 'utf8',
      timeout: 60000,
    });
    assert.equal(res.status, 0, 'importing must not execute the gate');
    assert.doesNotMatch(String(res.stderr), /DSH_HOME/, 'importing must not report a gate failure');
  });

  it('a passing environment exits 0 and says so', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ocms-ci1-pass-'));
    const env = { ...process.env, USERPROFILE: home, APPDATA: home, LOCALAPPDATA: home, PATH: home };
    delete env.DSH_HOME;
    delete env.HOME;
    try {
      const res = spawnSync(process.execPath, [SCRIPT], {
        cwd: REPO_ROOT,
        env,
        encoding: 'utf8',
        timeout: 60000,
      });
      assert.equal(res.status, 0, 'a hermetic env passes: ' + String(res.stderr).slice(0, 200));
      assert.match(String(res.stdout), /clean-machine condition holds/);
    } finally {
      try { fs.rmSync(home, { recursive: true, force: true }); } catch { /* best effort */ }
    }
  });
});
