// P4 (report C16; Space Bunny/MiMo): PATH lookup must cope with quoted PATH
// entries and with the extensions Windows actually resolves through PATHEXT.
// Both call sites used a fixed candidate list and joined the raw entry, so a
// quoted entry kept its quote characters and a PATHEXT-only extension was never
// tried. Real temp dirs only; no dsh install, no network, no child process.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findDshExecutable as findInResolver } from '../../profile/target-resolver.mjs';
import { findDshExecutable as findInDevTools } from '../../scripts/dev-tools.mjs';

let root;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ocms-p4-path-'));
});
afterEach(() => {
  try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* best effort */ }
});

function dirWithSpace(name) {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function place(dir, fileName) {
  fs.writeFileSync(path.join(dir, fileName), 'stub', 'utf8');
  return path.join(dir, fileName);
}

describe('P4 — PATH lookup: quoted entries and PATHEXT', () => {
  it('CONTROL: an unquoted entry resolves an ordinary dsh.cmd', async () => {
    const dir = dirWithSpace('plain');
    const expected = place(dir, 'dsh.cmd');
    assert.equal(await findInResolver({ pathEnv: dir }), fs.realpathSync(expected));
    assert.equal(await findInDevTools({ PATH: dir }), expected);
  });

  it('DEFECT: a quoted PATH entry resolves the shim inside it', async () => {
    const dir = dirWithSpace('quoted entry');
    const expected = place(dir, 'dsh.cmd');
    const quoted = '"' + dir + '"';
    const viaResolver = await findInResolver({ pathEnv: quoted });
    const viaDevTools = await findInDevTools({ PATH: quoted });
    assert.ok(viaResolver, 'target-resolver must find a shim in a quoted PATH entry');
    assert.equal(viaResolver, fs.realpathSync(expected));
    assert.ok(viaDevTools, 'dev-tools must find a shim in a quoted PATH entry');
    assert.equal(viaDevTools, expected);
  });

  it('DEFECT: honors PATHEXT for an extension the fixed list omits (resolver, .bat)', async () => {
    // .BAT is a default Windows PATHEXT entry and is absent from the resolver's
    // hardcoded list, so before the fix it was never tried.
    const dir = dirWithSpace('batext');
    const expected = place(dir, 'dsh.bat');
    const found = await findInResolver({ pathEnv: dir, pathext: '.COM;.EXE;.BAT;.CMD' });
    assert.ok(found, 'a PATHEXT-advertised extension must be tried');
    assert.equal(found, fs.realpathSync(expected));
  });

  it('DEFECT: honors PATHEXT for an extension the fixed list omits (dev-tools, .ps1)', async () => {
    const dir = dirWithSpace('psext2');
    const expected = place(dir, 'dsh.ps1');
    const found = await findInDevTools({ PATH: dir, PATHEXT: '.COM;.EXE;.BAT;.CMD;.PS1' });
    assert.ok(found, 'a PATHEXT-advertised extension must be tried');
    assert.equal(found, expected);
  });

  it('still does not invent an extension PATHEXT does not advertise', async () => {
    const dir = dirWithSpace('noext');
    place(dir, 'dsh.weird');
    const found = await findInDevTools({ PATH: dir, PATHEXT: '.COM;.EXE' });
    assert.equal(found, null, 'an unadvertised extension must not be resolved');
  });

  it('an empty or whitespace-only entry is skipped, not joined', async () => {
    const dir = dirWithSpace('after-empty');
    const expected = place(dir, 'dsh.cmd');
    const p = [';;', '   ', dir].join(path.delimiter);
    assert.equal(await findInDevTools({ PATH: p }), expected);
    assert.equal(await findInResolver({ pathEnv: p }), fs.realpathSync(expected));
  });
});
