// C05: legacy --settings missing file and non-YAML content.
// A missing file prints the verdict plus usage and exits 2; non-YAML content
// prints the verdict with the refusal code (never a stack) and exits 1.
// Nothing is written in either case.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SYNC_PATH = path.join(REPO_ROOT, 'sync.mjs');
const CHILD_TIMEOUT_MS = 30000;
const NL = String.fromCharCode(10);

function makeChildEnv() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ocms-c05-'));
  const home = path.join(root, 'home');
  fs.mkdirSync(path.join(home, '.dsh'), { recursive: true });
  const env = { ...process.env };
  env.USERPROFILE = home;
  env.HOME = home;
  env.APPDATA = path.join(home, 'AppData', 'Roaming');
  env.LOCALAPPDATA = path.join(home, 'AppData', 'Local');
  env.DSH_HOME = path.join(home, '.dsh');
  return { root, home, env, cleanup() { fs.rmSync(root, { recursive: true, force: true }); } };
}

function runCli(env, args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SYNC_PATH, ...args], { cwd: REPO_ROOT, env, shell: false });
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timer = null;
    const finish = (code, note) => {
      if (settled) return;
      settled = true;
      if (timer !== null) clearTimeout(timer);
      resolve({ code, stdout, stderr, note });
    };
    timer = setTimeout(() => {
      try { child.kill(); } catch {}
      finish(null, 'TIMED OUT after ' + CHILD_TIMEOUT_MS + ' ms');
    }, CHILD_TIMEOUT_MS);
    child.stdout.on('data', (d) => { stdout += String(d); });
    child.stderr.on('data', (d) => { stderr += String(d); });
    child.on('error', (err) => finish(null, 'spawn failed: ' + String(err && err.message)));
    child.on('close', (code) => finish(code, null));
    child.stdin.end();
  });
}

function finalLine(stdout) {
  const lines = stdout.split(NL).map((line) => line.trim()).filter((line) => line.length > 0);
  return lines.length === 0 ? null : lines[lines.length - 1];
}

describe('C05 — missing and non-YAML settings', () => {
  it('a missing settings file prints verdict plus usage and exits 2', async () => {
    const childEnv = makeChildEnv();
    try {
      const missing = path.join(childEnv.root, 'no-such-settings.yaml');
      const outcome = await runCli(childEnv.env, ['--settings=' + missing]);
      assert.equal(outcome.note, null, 'child must terminate: ' + String(outcome.note));
      assert.equal(outcome.code, 2, 'missing file exits 2; stdout:' + NL + outcome.stdout + NL + 'stderr:' + NL + outcome.stderr);
      assert.ok(/NOT WRITTEN/.test(outcome.stdout), 'verdict printed');
      assert.ok(/Usage:/.test(outcome.stdout), 'usage printed');
      assert.doesNotMatch(outcome.stdout + outcome.stderr, /\n\s+at |stack trace/i, 'no stack leaks');
    } finally {
      childEnv.cleanup();
    }
  });

  it('non-YAML settings print the verdict with the refusal code and exit 1', async () => {
    const childEnv = makeChildEnv();
    try {
      const bad = path.join(childEnv.root, 'bad.yaml');
      fs.writeFileSync(bad, '- id: [unclosed\n  bad: : :\n', 'utf8');
      const before = fs.readFileSync(bad);
      const outcome = await runCli(childEnv.env, ['--settings=' + bad]);
      assert.equal(outcome.note, null, 'child must terminate: ' + String(outcome.note));
      assert.equal(outcome.code, 1, 'non-YAML exits 1; stdout:' + NL + outcome.stdout + NL + 'stderr:' + NL + outcome.stderr);
      assert.ok(/NOT WRITTEN/.test(outcome.stdout), 'verdict printed');
      assert.ok(/SETTINGS_INVALID|SETTINGS_UNREADABLE/.test(outcome.stdout), 'refusal code printed');
      assert.doesNotMatch(outcome.stdout + outcome.stderr, /\n\s+at |stack trace/i, 'no stack leaks');
      assert.deepEqual(fs.readFileSync(bad), before, 'refusal writes nothing');
    } finally {
      childEnv.cleanup();
    }
  });
});
