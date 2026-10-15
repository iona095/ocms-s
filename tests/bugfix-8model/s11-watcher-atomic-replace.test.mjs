// S11 watcher-atomic-replace [report C29; Space Bunny #20]. Verdict NOT REPRODUCIBLE
// on Windows (Node v24.15.0): Node's file watch fires on a rename-over AND
// survives it (probe output: builds reach 3 after two atomic saves), so the
// silent-watch-death described (POSIX inode semantics) does not occur here.
// Per rules: guard test only, NO product change (a directory-watch rework
// would churn ~10 coupled watch tests for an unreproduced defect).
// Guard pins the Windows behavior with a real fs.watch: two consecutive
// atomic rename-overs must each rebuild (builds 1->2->3 within bounds).
import { describe, it } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { assert } from '../v1.4/helpers.mjs';

const DEVTOOLS = path.join(process.cwd(), 'scripts', 'dev-tools.mjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, timeout) {
  const start = Date.now();
  for (;;) {
    let ok = false;
    try { ok = await fn(); } catch { ok = false; }
    if (ok) return true;
    if (Date.now() - start > timeout) return false;
    await sleep(25);
  }
}
function atomicWrite(target, text) {
  const tmp = target + '.s11tmp-' + process.pid;
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, target);
}

describe('S11 watcher-atomic-replace', () => {
  it('an atomic rename-over rebuilds, and the watch survives it', { timeout: 60000 }, async (t) => {
    const mod = await import(pathToFileURL(DEVTOOLS).href);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ocms-s11-'));
    t.after(() => { try { fs.rmSync(root, { recursive: true, force: true }); } catch {} });
    fs.mkdirSync(path.join(root, 'dsh'), { recursive: true });
    fs.writeFileSync(path.join(root, 'dsh', 'build-client.mjs'), 'export {};\n', 'utf8');
    fs.writeFileSync(path.join(root, 'dsh', 'client.mjs'), 'export const MARK = 1;\n', 'utf8');
    let builds = 0;
    const h = mod.runWatch({
      argv: [], repoRoot: root, print: () => {}, printError: () => {},
      startBuild: () => { builds += 1; return { child: null, done: Promise.resolve({ code: 0, stdout: '', stderr: '' }) }; },
      debounceMs: 20,
    });
    try {
      assert.ok(await waitFor(() => Promise.resolve(builds >= 1), 3000), 'initial build ran');
      atomicWrite(path.join(root, 'dsh', 'client.mjs'), 'export const MARK = 2;\n');
      assert.ok(await waitFor(() => Promise.resolve(builds >= 2), 3000), 'rename-over triggers a rebuild');
      atomicWrite(path.join(root, 'dsh', 'client.mjs'), 'export const MARK = 3;\n');
      assert.ok(await waitFor(() => Promise.resolve(builds >= 3), 3000), 'the watch survives the rename-over');
    } finally {
      await h.stop();
      await sleep(50);
    }
  });
});
