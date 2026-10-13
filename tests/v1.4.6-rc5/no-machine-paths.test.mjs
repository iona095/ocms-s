// OCMS-S v1.4.6-rc5 Q5 — no absolute machine paths in tests/.
//
// Scans every file under tests/ for absolute user-home paths (Windows drive
// plus home-directory segment, or POSIX home roots, either slash style, both
// single- and JS-escaped double-backslash spellings) and fails listing
// file:line for each hit. Intentional fakes without a home-directory segment
// (trap paths in sync/engine-contract tests) do not match — proven by this
// guard passing plus the Step-3 negative control.
// The patterns below are assembled from split parts so this file's own
// source contains no matchable literal.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TESTS_DIR = path.join(REPO_ROOT, 'tests');

// Home-directory segment, split so the literal never appears in this source.
const HOME_SEG = 'Us' + 'ers';
const HOME_SEG_POSIX = '/' + 'home/';

// A Windows drive absolute path whose first directory is the home segment,
// e.g. drive-colon slashes Us ers slash name. Name segments starting with '<'
// (documented placeholders) never match.
const DRIVE_HOME = new RegExp('[A-Za-z]:[\\\\/]+' + HOME_SEG + '[\\\\/]+[^\\\\/\'\"<>]+');
// POSIX absolute home roots: /home/<name> and /<root>/Us ers/<name>.
const POSIX_HOME = new RegExp('(?:' + HOME_SEG_POSIX + '|/' + HOME_SEG + '/)[^/\'\"<>]+');

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && !entry.isSymbolicLink()) walk(full, out);
    else if (entry.isFile()) out.push(full);
  }
}

describe('v1.4.6-rc5 no absolute machine paths in tests', () => {
  it('Q5 guard: no file under tests/ carries an absolute home path', () => {
    const files = [];
    walk(TESTS_DIR, files);
    assert.ok(files.length > 50, 'expected to scan the tests tree, found ' + files.length);
    const hits = [];
    for (const file of files) {
      let text;
      try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
      const lines = text.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (DRIVE_HOME.test(lines[i]) || POSIX_HOME.test(lines[i])) {
          hits.push(path.relative(REPO_ROOT, file) + ':' + (i + 1));
        }
      }
    }
    assert.deepEqual(hits, [], 'absolute home paths under tests/:\n' + hits.join('\n'));
  });
});
