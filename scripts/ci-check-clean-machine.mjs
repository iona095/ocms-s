// CI1: the "Prove clean-machine condition" gate used by .github/workflows/ci.yml.
//
// Extracted from the workflow so its logic is provable off-Actions: the gate
// failed on windows-latest because it required HOME, which Windows runners do
// not set. HOME is a POSIX variable; on Windows the profile anchor is
// USERPROFILE, alongside APPDATA and LOCALAPPDATA.
//
// The exported function takes every dependency as an argument (environment,
// platform, path predicates) so a test can drive it with fakes and assert both
// the passing and the failing outcomes. Running this file directly performs
// the real check and exits non-zero with the first failure named.
import path from 'node:path';
import process from 'node:process';
import { existsSync } from 'node:fs';

// Profile variables that must exist on this platform before the suites may run.
// Windows runners set USERPROFILE/APPDATA/LOCALAPPDATA and not HOME; POSIX
// runners are the mirror image.
export function requiredProfileVars(platform) {
  return platform === 'win32'
    ? ['USERPROFILE', 'APPDATA', 'LOCALAPPDATA']
    : ['HOME'];
}

export function checkCleanMachine({
  env = process.env,
  platform = process.platform,
  exists = existsSync,
  hasCommand = defaultHasCommand,
  pathList = null,
} = {}) {
  const failures = [];

  // 1. No real DSH home in the profile anchor.
  const anchor = platform === 'win32' ? env.USERPROFILE : env.HOME;
  if (anchor && exists(path.join(anchor, '.dsh'))) {
    failures.push("runner has a real .dsh in " + anchor + "; tests must be hermetic");
  }

  // 2. No dsh executable on PATH.
  const where = hasCommand('dsh', { env, platform, pathList });
  if (where) {
    failures.push("runner has dsh on PATH (" + where + "); tests must be hermetic");
  }

  // 3. DSH_HOME must be unset so the suites derive a temp home.
  if (env.DSH_HOME && String(env.DSH_HOME).trim() !== '') {
    failures.push("runner has DSH_HOME set ('" + env.DSH_HOME + "'); the suites must derive a temp home, not inherit one");
  }

  // 4. Required profile variables present for this platform.
  const missing = requiredProfileVars(platform).filter(
    (name) => env[name] === undefined || String(env[name]).trim() === '',
  );
  if (missing.length > 0) {
    failures.push(
      'required temp-profile variable(s) not set: ' + missing.join(', ') +
      '; the suites cannot redirect the user profile',
    );
  }

  return { ok: failures.length === 0, failures };
}

function defaultHasCommand(name, { env, platform }) {
  const raw = env.PATH || env.Path || '';
  if (raw.length === 0) return null;
  const sep = platform === 'win32' ? ';' : ':';
  const exts = platform === 'win32'
    ? (env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';')
    : [''];
  for (const dir of raw.split(sep)) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = path.join(dir.trim().replace(/^"([\s\S]*)"$/, '$1'), name + ext.toLowerCase());
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

// Direct invocation: perform the real check.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\//, ''))) {
  const result = checkCleanMachine();
  if (result.ok) {
    console.log(
      'clean-machine condition holds: no real .dsh, no dsh on PATH, DSH_HOME unset, ' +
      requiredProfileVars(process.platform).join('/') + ' present',
    );
  } else {
    for (const failure of result.failures) {
      console.error('clean-machine condition FAILED: ' + failure);
    }
    process.exitCode = 1;
  }
}
