// P3-4 RED: a package manifest entry that resolves outside its package
// directory (../ traversal, hostile exports map, or an escaping symlink)
// must be refused. Synthetic temp dirs only; no DSH, no network.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolvePackageEntry as readerEntry } from '../../profile/config-reader.mjs';
import { resolvePackageEntry as commitEntry } from '../../profile/commit.mjs';

const RESOLVERS = { reader: readerEntry, commit: commitEntry };

function makePackage(manifest, files = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ocms-p34-'));
  const pkgDir = path.join(root, 'pkg');
  fs.mkdirSync(pkgDir, { recursive: true });
  fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify(manifest), 'utf8');
  for (const [rel, text] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, text, 'utf8');
  }
  return { root, pkgDir };
}

describe('P3-4 package-entry containment', () => {
  for (const [label, resolvePackageEntry] of Object.entries(RESOLVERS)) {
    it(label + ': ../ traversal outside the package is refused', () => {
      const { root, pkgDir } = makePackage({ name: 'evil', main: '../outside.js' }, { 'outside.js': 'evil' });
      try {
        assert.equal(resolvePackageEntry(pkgDir), null);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    it(label + ': hostile exports map is refused', () => {
      const { root, pkgDir } = makePackage({ name: 'evil', exports: { '.': '../outside.js' } }, { 'outside.js': 'evil' });
      try {
        assert.equal(resolvePackageEntry(pkgDir), null);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    it(label + ': symlink inside the package pointing outside is refused', () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ocms-p34-'));
      try {
        const pkgDir = path.join(root, 'pkg');
        fs.mkdirSync(pkgDir, { recursive: true });
        fs.writeFileSync(path.join(root, 'outside-real.js'), 'real', 'utf8');
        fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({ name: 'linky', main: './link.js' }), 'utf8');
        fs.symlinkSync(path.join(root, 'outside-real.js'), path.join(pkgDir, 'link.js'), 'file');
        assert.equal(resolvePackageEntry(pkgDir), null);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    it(label + ': control: an inside entry still resolves', () => {
      const { root, pkgDir } = makePackage({ name: 'good', main: './lib/index.js' }, { 'pkg/lib/index.js': 'good' });
      try {
        const got = resolvePackageEntry(pkgDir);
        assert.equal(got, path.join(pkgDir, 'lib', 'index.js'));
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });
  }
});
