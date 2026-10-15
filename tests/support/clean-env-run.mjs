// OCMS-S v1.4.6-rc3 clean-environment reproduction vehicle (contract \u00a711 test 2).
// Runs the release suite the way a clean CI runner sees it: a fresh temp
// USERPROFILE/HOME (so os.homedir() has no .dsh), no DSH_HOME, and a PATH
// with every dsh-bearing entry removed. No product code is touched.
// Node builtins only; no new dependencies.
//
// Usage: node tests/support/clean-env-run.mjs [<npm-script> [-- args...]]
//   no argument  -> npm test                      (unchanged default)
//   test:profile  -> npm run test:profile          (CI2: any named script)
//   -- extra args -> appended, exactly as before
// Exit code: the suite's exit code, or 1 when the run itself is invalid
// (npm missing after the scrub, or a .dsh tree created in the scrubbed home),
// or non-zero on vehicle timeout (process tree killed).
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DSH_BIN_NAMES = ['dsh', 'dsh.cmd', 'dsh.exe', 'dsh.ps1'];
const VEHICLE_TIMEOUT_MS = 14 * 60 * 1000;
const isWin = process.platform === 'win32';

function dirHoldsDsh(dir) {
  if (!dir) return false;
  for (const name of DSH_BIN_NAMES) {
    try {
      if (fs.statSync(path.join(dir, name)).isFile()) return true;
    } catch {
      // Absent or unreadable \u2014 not a dsh-bearing entry.
    }
  }
  return false;
}

// Deterministic npm entry point: npm-cli.js resolved from the running Node,
// never via a PATH lookup that could pick a different command.
function findNpmCli() {
  const execDir = path.dirname(process.execPath);
  const candidates = [
    path.join(execDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(execDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(execDir, 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(execDir, '..', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ];
  for (const raw of candidates) {
    const c = path.normalize(raw);
    try {
      if (fs.statSync(c).isFile()) return c;
    } catch {
      // Absent \u2014 try the next layout.
    }
  }
  return null;
}

// CI2: translate the vehicle's argv into npm arguments.
//   [] | ['--']                        -> ['test']                 (unchanged)
//   ['--', 'a', 'b']                    -> ['test', 'a', 'b']       (unchanged)
//   ['test:profile']                    -> ['run', 'test:profile']  (new)
//   ['--', 'x']                         -> ['test', 'x']  ('--' still means
//                                          'append to npm test')
//   ['test:profile', 'x']               -> ['run', 'test:profile', 'x']
// A leading flag is never a script name: only a bare word without a leading
// '-' is accepted, so the parser cannot be loosened into passing junk through.
export function parseNpmArgs(argv) {
  const rest = Array.isArray(argv) ? argv.slice() : [];
  // A leading '--' keeps its documented legacy meaning: everything after it is
  // appended to 'npm test', so the script name is never taken from there.
  if (rest.length > 0 && rest[0] === '--') return ['test', ...rest.slice(1)];
  const first = rest.length > 0 ? rest[0] : null;
  const isScriptName = typeof first === 'string'
    && first.length > 0
    && first.trim() === first
    && first[0] !== '-'
    && /^[A-Za-z][A-Za-z0-9:._-]*$/.test(first);
  if (!isScriptName) return ['test', ...rest];
  const name = rest.shift();
  if (name === 'test') return ['test', ...rest];
  return ['run', name, ...rest];
}

function killTree(pid) {
  if (pid === undefined || pid === null) return;
  if (isWin) {
    try {
      spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
    } catch {
      // Best effort; the timeout path still exits non-zero below.
    }
  } else {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      try { process.kill(pid, 'SIGKILL'); } catch { /* already exited */ }
    }
  }
}

async function main() {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const scrubHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ocms-clean-home-'));
  const sub = (...parts) => {
    const d = path.join(scrubHome, ...parts);
    fs.mkdirSync(d, { recursive: true });
    return d;
  };
  // Fresh home folders inside the temp home (never the real home).
  const freshAppData = sub('AppData', 'Roaming');
  const freshLocalAppData = sub('AppData', 'Local');
  const freshXdgConfig = sub('.config');
  const freshXdgCache = sub('.cache');
  const freshXdgData = sub('.local', 'share');
  const freshXdgState = sub('.local', 'state');

  // PATH value read case-insensitively (Windows exposes Path, not PATH).
  const preEnv = { ...process.env };
  const pathKeys = Object.keys(preEnv).filter((k) => k.toLowerCase() === 'path');
  const rawPath = pathKeys.map((k) => preEnv[k]).find((v) => v) || '';
  const delimiter = path.delimiter;
  const allEntries = String(rawPath ?? '').split(delimiter).filter((entry) => entry);
  const keptPath = allEntries.filter((entry) => entry && !dirHoldsDsh(entry));
  const removed = allEntries.filter((entry) => entry && dirHoldsDsh(entry));

  // Build the child env: replace PATH case-insensitively with exactly one key.
  const env = { ...process.env };
  for (const k of Object.keys(env)) {
    if (k.toLowerCase() === 'path') delete env[k];
  }
  // Case-insensitive DSH_HOME removal (Windows env keys are case-insensitive).
  for (const k of Object.keys(env)) {
    if (k.toLowerCase() === 'dsh_home') delete env[k];
  }
  env.USERPROFILE = scrubHome;
  env.HOME = scrubHome;
  env.APPDATA = freshAppData;
  env.LOCALAPPDATA = freshLocalAppData;
  // XDG homes live inside the temp home too (used on POSIX; harmless on Windows).
  env.XDG_CONFIG_HOME = freshXdgConfig;
  env.XDG_CACHE_HOME = freshXdgCache;
  env.XDG_DATA_HOME = freshXdgData;
  env.XDG_STATE_HOME = freshXdgState;
  if (isWin) {
    env.HOMEDRIVE = path.parse(scrubHome).root.replace(/\\$/, '');
    env.HOMEPATH = scrubHome.slice(String(env.HOMEDRIVE).length);
  }
  env[isWin ? 'Path' : 'PATH'] = keptPath.join(delimiter);

  console.log('[clean-env] scrubbed HOME/USERPROFILE: ' + scrubHome);
  console.log('[clean-env] fresh APPDATA: ' + freshAppData);
  console.log('[clean-env] fresh LOCALAPPDATA: ' + freshLocalAppData);
  console.log('[clean-env] node ' + process.version + ' (' + process.execPath + ')');
  console.log('[clean-env] removed ' + removed.length + ' dsh-bearing PATH entr' + (removed.length === 1 ? 'y' : 'ies') + (removed.length > 0 ? ': ' + removed.join(delimiter) : ''));
  if (fs.existsSync(path.join(scrubHome, '.dsh'))) {
    console.error('[clean-env] REFUSED: scrubbed home already holds a .dsh tree');
    process.exitCode = 1;
    return;
  }
  const npmCli = findNpmCli();
  if (npmCli === null) {
    console.error('[clean-env] REFUSED: npm-cli.js was not found next to the running node (' + process.execPath + '); refusing rather than running a different command');
    process.exitCode = 1;
    return;
  }
  console.log('[clean-env] npm entry: ' + npmCli + ' via ' + process.execPath);
  // CI2: the npm script name is selectable. The default ('npm test') is
  // unchanged; a bare script name such as 'test:profile' becomes
  // ['run', 'test:profile']; anything after '--' is appended as before.
  const npmArgs = parseNpmArgs(process.argv.slice(2));
  console.log('[clean-env] command: ' + JSON.stringify(process.execPath) + ' ' + JSON.stringify(npmCli) + ' ' + npmArgs.map((a) => JSON.stringify(a)).join(' '));

  const child = spawn(process.execPath, [npmCli, ...npmArgs], {
    cwd: repoRoot,
    env,
    stdio: 'inherit',
    detached: !isWin,
  });

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    killTree(child.pid);
  }, VEHICLE_TIMEOUT_MS);

  const exit = await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', (code, signal) => resolve({ code, signal }));
  }).catch((err) => ({ error: err }));
  clearTimeout(timer);

  if (exit && exit.error) {
    console.error('[clean-env] suite run failed: ' + String((exit.error && exit.error.message) || exit.error));
    process.exitCode = 1;
    try { fs.rmSync(scrubHome, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {}
    return;
  }
  const status = exit.code;
  const signal = exit.signal;
  if (timedOut) {
    console.error('[clean-env] FAIL: suite did not finish within the vehicle timeout of ' + Math.round(VEHICLE_TIMEOUT_MS / 1000) + 's; process tree killed');
    process.exitCode = 1;
    try { fs.rmSync(scrubHome, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {}
    return;
  }
  if (status !== 0 && status !== null) {
    console.log('[clean-env] suite exited ' + status + (signal ? ' (signal ' + signal + ')' : '') + ' (RED proves the hermetic defect; GREEN is the gate)');
  } else if (signal) {
    console.log('[clean-env] suite exited via signal ' + signal + ' (RED proves the hermetic defect; GREEN is the gate)');
  }
  let dshCheckFailed = false;
  try {
    if (fs.existsSync(path.join(scrubHome, '.dsh'))) {
      console.error('[clean-env] FAIL: the suite created a .dsh tree inside the scrubbed home; tests must not touch a real home');
      dshCheckFailed = true;
    }
  } catch (err) {
    console.error('[clean-env] FAIL: could not verify the scrubbed home stayed clean: ' + String((err && err.message) || err));
    dshCheckFailed = true;
  }
  if (!dshCheckFailed) {
    console.log('[clean-env] scrubbed home holds no .dsh tree (no real-home writes)');
  }
  // Delete the temp home afterwards (after the .dsh check).
  try {
    fs.rmSync(scrubHome, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    console.log('[clean-env] removed scrubbed home: ' + scrubHome);
  } catch (err) {
    console.error('[clean-env] WARNING: could not remove scrubbed home ' + scrubHome + ': ' + String((err && err.message) || err));
  }
  if (dshCheckFailed) {
    process.exitCode = 1;
    return;
  }
  if (status === null) {
    console.error('[clean-env] FAIL: suite did not finish within the vehicle timeout of ' + Math.round(VEHICLE_TIMEOUT_MS / 1000) + 's');
    process.exitCode = 1;
    return;
  }
  process.exitCode = status;
}

await main();
