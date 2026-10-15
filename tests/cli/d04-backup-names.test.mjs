// D04: two backups in the same timestamp tick must not share a path.
// Same stamp twice yields two distinct paths; writing both preserves both
// byte streams (backup count = 2, no overwrite).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { legacyBackupPath } from '../../sync.mjs';

describe('D04 — backup name uniqueness', () => {
  it('the same stamp yields distinct backup paths and both files survive', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ocms-d04-'));
    try {
      const target = path.join(root, 'settings.yaml');
      fs.writeFileSync(target, 'first', 'utf8');
      const stamp = 'tick';
      const first = legacyBackupPath(target, stamp);
      fs.writeFileSync(first, 'first-bytes', 'utf8');
      const second = legacyBackupPath(target, stamp);
      assert.notEqual(second, first, 'second backup must not reuse the first path');
      fs.writeFileSync(second, 'second-bytes', 'utf8');
      const backups = fs.readdirSync(root).filter((name) => name.includes('.bak-'));
      assert.equal(backups.length, 2, 'backup count = 2, nothing overwritten');
      assert.equal(fs.readFileSync(first, 'utf8'), 'first-bytes');
      assert.equal(fs.readFileSync(second, 'utf8'), 'second-bytes');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('a fresh stamp keeps the plain unstamped-suffix name', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ocms-d04-'));
    try {
      const target = path.join(root, 'settings.yaml');
      const p = legacyBackupPath(target, 'tick');
      assert.equal(p, target + '.bak-tick');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
