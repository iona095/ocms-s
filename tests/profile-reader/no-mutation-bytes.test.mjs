// P2-4 RED: assertNoMutation must compare file bytes (sha256), not just the
// file set, size and mtime. A same-size rewrite with a restored mtime must be
// caught. Synthetic temp dir only.
import { describe, it } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { snapshotTree, assertNoMutation } from './helpers.mjs';

function makeTree() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocms-p24-'));
  fs.writeFileSync(path.join(dir, 'cordis.patch.yml'), '- id: aaaa\n', 'utf8');
  return dir;
}

describe('P2-4 assertNoMutation compares file bytes', () => {
  it('catches a same-size byte change with a restored mtime', () => {
    const dir = makeTree();
    try {
      const file = path.join(dir, 'cordis.patch.yml');
      // Pin mtime to a fixed instant before AND after the rewrite, so the
      // old set/size/mtime comparison is evaded deterministically regardless
      // of filesystem timestamp granularity.
      const pinned = new Date('2026-01-02T03:04:05.000Z');
      fs.utimesSync(file, pinned, pinned);
      const snap = snapshotTree(dir);
      fs.writeFileSync(file, '- id: bbbb\n', 'utf8');
      fs.utimesSync(file, pinned, pinned);
      const before = snap.get(file);
      const now = fs.lstatSync(file);
      assert.equal(now.size, before.size, 'fixture precondition: same size');
      assert.equal(now.mtimeMs, before.mtimeMs, 'fixture precondition: old check evaded');
      assert.throws(() => assertNoMutation(snap, dir, 'P2-4'), /byte/i, 'same-size same-mtime rewrite must be caught');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('passes an untouched tree', () => {
    const dir = makeTree();
    try {
      const snap = snapshotTree(dir);
      assertNoMutation(snap, dir, 'P2-4 control');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
