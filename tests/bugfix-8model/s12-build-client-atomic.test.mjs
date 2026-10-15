// S12 build-client-atomic [Space Bunny]. dsh/build-client.mjs has two defects:
// (a) CODE-VERIFIED: it writes dsh/client.js directly (no temp+rename), so a
// crash mid-write leaves a truncated bundle. Fixed by mechanism (unique
// same-dir temp + rename, temp removed in a finally); the crash itself is not
// inducible hermetically.
// (b) REPRODUCED: the line-anchored import guard fails open on a mid-line
// dynamic import() — the bundle claims to be import-free while carrying one.
// The builder runs in a temp dsh/ root (never the real tree); bounded spawn.
import { describe, it } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { assert } from '../v1.4/helpers.mjs';

const REAL_BUILDER = path.join(process.cwd(), 'dsh', 'build-client.mjs');
function tempRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ocms-s12-'));
  t.after(() => { try { fs.rmSync(root, { recursive: true, force: true }); } catch {} });
  fs.mkdirSync(path.join(root, 'dsh'), { recursive: true });
  fs.copyFileSync(REAL_BUILDER, path.join(root, 'dsh', 'build-client.mjs'));
  return root;
}
function runBuilder(root) {
  return spawnSync(process.execPath, ['dsh/build-client.mjs'], { cwd: root, encoding: 'utf8', timeout: 30000 });
}
const EVIL_SOURCE = "export const A = 1;\nconst lazy = await import('node:fs');\n";

describe('S12 build-client-atomic', () => {
  it('a mid-line dynamic import() fails the build instead of slipping into the bundle', async (t) => {
    const root = tempRoot(t);
    fs.writeFileSync(path.join(root, 'dsh', 'client.mjs'), EVIL_SOURCE, 'utf8');
    const r = runBuilder(root);
    assert.notEqual(r.status, 0, 'mid-line dynamic import must fail the build, got status ' + r.status);
    assert.ok(!fs.existsSync(path.join(root, 'dsh', 'client.js')), 'no bundle is emitted for a tainted source');
  });

  it('a clean build is byte-correct and leaves no temp residue', async (t) => {
    const root = tempRoot(t);
    fs.writeFileSync(path.join(root, 'dsh', 'client.mjs'), 'export const A = 1;\n', 'utf8');
    const r = runBuilder(root);
    assert.equal(r.status, 0, 'clean source builds: ' + r.stderr.slice(0, 200));
    const out = path.join(root, 'dsh', 'client.js');
    assert.ok(fs.existsSync(out), 'bundle emitted');
    const leftovers = fs.readdirSync(path.join(root, 'dsh')).filter((n) => n !== 'client.mjs' && n !== 'client.js' && n !== 'build-client.mjs');
    assert.deepEqual(leftovers, [], 'no temp residue beside the inputs and output: ' + JSON.stringify(leftovers));
    const once = fs.readFileSync(out, 'utf8');
    assert.ok(once.includes('window.__ModuleLoader__.load'), 'ModuleLoader banner present');
    assert.ok(!once.includes('import('), 'no dynamic import in a clean bundle');
  });

  it('a failed build preserves the previous good bundle', async (t) => {
    const root = tempRoot(t);
    fs.writeFileSync(path.join(root, 'dsh', 'client.mjs'), 'export const A = 1;\n', 'utf8');
    assert.equal(runBuilder(root).status, 0, 'baseline clean build');
    const good = fs.readFileSync(path.join(root, 'dsh', 'client.js'), 'utf8');
    fs.writeFileSync(path.join(root, 'dsh', 'client.mjs'), EVIL_SOURCE, 'utf8');
    assert.notEqual(runBuilder(root).status, 0, 'tainted rebuild fails');
    assert.equal(fs.readFileSync(path.join(root, 'dsh', 'client.js'), 'utf8'), good, 'previous bundle untouched by the failed build');
    const leftovers = fs.readdirSync(path.join(root, 'dsh')).filter((n) => n !== 'client.mjs' && n !== 'client.js' && n !== 'build-client.mjs');
    assert.deepEqual(leftovers, [], 'no temp residue after failure: ' + JSON.stringify(leftovers));
  });
});
