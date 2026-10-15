// Packaging manifest guard (C01).
//
// The published tarball must carry every module reachable from the package's
// shipped entry points. This test computes the relative-import closure of the
// entry points declared in package.json (exports plus the files the DSH bundle
// loads), asserts every reachable path is covered by the "files" whitelist, then
// packs the repository into a temp directory, verifies every reachable path is a
// member of the produced tarball, and imports the shipped entry points from the
// unpacked archive.
//
// Everything runs in a caller-owned OS temp directory. npm pack does not reach
// the registry, so no network access is required and no production path or
// installed DSH tree is touched. The pack step is bounded; when the Node
// installation's npm-cli.js cannot be located, the tarball case declares an
// explicit skip naming the missing capability instead of passing silently.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';

const NL = String.fromCharCode(10);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));

// Entry points that ship: the exports map plus the files the DSH bundle loads.
const ENTRY_POINTS = [
  MANIFEST.exports['.'],
  MANIFEST.exports['./client'],
  MANIFEST.main,
  './dsh/lifecycle.mjs',
  // ui.mjs is located at runtime (new URL('../ui.mjs', import.meta.url) in
  // dsh/host.mjs), so it is named here explicitly rather than found by the walker.
  './ui.mjs',
  './ui/index.html',
].filter((v) => typeof v === 'string').map((v) => stripDotSlash(v));

function stripDotSlash(value) {
  return value.startsWith('./') ? value.slice(2) : value;
}

function absOf(rel) {
  return path.join(REPO_ROOT, ...rel.split('/'));
}

function isFile(p) {
  try { return fs.statSync(p).isFile(); } catch { return false; }
}

function isDirectory(p) {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

// Resolve a relative specifier the way Node does for the shipped tree:
// exact file, then extension probing, then directory index.
function resolveRelative(fromRel, spec) {
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), spec));
  const candidates = [base, base + '.mjs', base + '.js', base + '.cjs', base + '.json',
    path.posix.join(base, 'index.mjs'), path.posix.join(base, 'index.js')];
  for (const candidate of candidates) if (isFile(absOf(candidate))) return candidate;
  return null;
}

// Relative-path literals embedded in a shipped module. Rather than a
// JS-grammar regex, this scans quote-delimited spans and keeps those that
// start with ./ or ../ and contain no whitespace; each candidate is then
// resolved against the real tree, so a comment mentioning a path resolves
// to the same file the import would.
const BS = String.fromCharCode(92);
const QUOTES = [String.fromCharCode(39), String.fromCharCode(34), String.fromCharCode(96)];

export function embeddedRelativePaths(text) {
  const out = [];
  for (let i = 0; i < text.length; i += 1) {
    if (!QUOTES.includes(text[i])) continue;
    const quote = text[i];
    let j = i + 1;
    let value = '';
    while (j < text.length && text[j] !== quote && text[j] !== String.fromCharCode(10)) {
      value += text[j];
      j += 1;
    }
    if (value.startsWith('./') || value.startsWith('../')) out.push(value);
    i = j;
  }
  return out;
}

// Transitive closure of relative imports, starting at the entry points.
export function importClosure() {
  const seen = new Map();
  const queue = [...ENTRY_POINTS];
  while (queue.length > 0) {
    const rel = queue.shift();
    if (seen.has(rel)) continue;
    const abs = absOf(rel);
    if (!isFile(abs)) { seen.set(rel, { missing: true, edges: [] }); continue; }
    const edges = [];
    if (rel.endsWith('.mjs') || rel.endsWith('.js') || rel.endsWith('.cjs')) {
      const text = fs.readFileSync(abs, 'utf8');
      for (const spec of embeddedRelativePaths(text)) {
        const target = resolveRelative(rel, spec);
        if (target === null) edges.push({ spec, resolved: null });
        else if (!edges.some((e) => e.resolved === target)) edges.push({ spec, resolved: target });
      }
    }
    seen.set(rel, { missing: false, edges });
    for (const e of edges) if (e.resolved !== null) queue.push(e.resolved);
  }
  return seen;
}

// npm "files" entry -> does it cover the repository-relative path?
export function manifestCovers(rel) {
  const files = Array.isArray(MANIFEST.files) ? MANIFEST.files : [];
  for (const raw of files) {
    let entry = stripDotSlash(String(raw).split(BS + BS).join('/'));
    while (entry.endsWith('/')) entry = entry.slice(0, -1);
    if (entry === '') continue;
    if (rel === entry) return true;
    if (rel.startsWith(entry + '/')) return true;
    if (entry.includes('*')) {
      const pattern = '^' + entry
        .replace(RE_GLOB_CHARS, BS + BS + '$&')
        .replace(RE_DOUBLESTAR, BS + 'u0000')
        .replace(RE_STAR, '[^/]*')
        .replace(RE_NUL_TOKEN, '.*') + '$';
      if (new RegExp(pattern).test(rel)) return true;
    }
  }
  return false;
}

function run(command, args, options) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { shell: false, ...options });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill(); } catch { /* best effort */ }
      resolve({ code: null, stdout, stderr: stderr + ' TIMED OUT waiting for ' + command });
    }, options.timeoutMs || 120000);
    child.stdout.on('data', (d) => { stdout += String(d); });
    child.stderr.on('data', (d) => { stderr += String(d); });
    child.on('error', (err) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      resolve({ code: null, stdout, stderr: stderr + ' ' + String(err && err.message) });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      resolve({ code, stdout, stderr });
    });
  });
}

// Locate an npm CLI entry without assuming a machine-specific install layout.
export function findNpmCli() {
  const nodeDir = path.dirname(process.execPath);
  const candidates = [
    path.join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(nodeDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(nodeDir, '..', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ];
  for (const c of candidates) if (isFile(c)) return c;
  return null;
}

// Tar string field: bytes up to the first NUL.
function nulField(header, from, to) {
  return header.subarray(from, to).toString('utf8').split(String.fromCharCode(0))[0];
}

// Minimal ustar reader: iterates every regular-file member.
function eachTarballMember(tgzPath, visit) {
  const buf = zlib.gunzipSync(fs.readFileSync(tgzPath));
  let offset = 0;
  while (offset + 512 <= buf.length) {
    const header = buf.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) break;
    const name = header.subarray(0, 100).toString('utf8').split(String.fromCharCode(0))[0];
    const prefix = header.subarray(345, 500).toString('utf8').split(String.fromCharCode(0))[0];
    const sizeField = nulField(header, 124, 136).trim();
    const size = parseInt(sizeField, 8) || 0;
    const full = stripDotSlash(prefix ? prefix + '/' + name : name);
    visit(full, buf.subarray(offset + 512, offset + 512 + size), size);
    offset += 512 + Math.ceil(size / 512) * 512;
  }
}

describe('packaging manifest (C01)', () => {
  it('T1: every module reachable from the shipped entry points is in the files whitelist', () => {
    const closure = importClosure();
    assert.ok(closure.size >= 10, 'closure walker resolved only ' + closure.size + ' paths');
    const unresolved = [...closure.entries()].filter(([, v]) => v.missing).map(([k]) => k);
    assert.deepEqual(unresolved, [], 'closure contains unresolvable paths');
    const uncovered = [...closure.keys()].filter((rel) => !manifestCovers(rel) && !rel.endsWith('.html'));
    assert.deepEqual(uncovered, [], 'reachable modules missing from package.json files whitelist:' + NL + uncovered.join(NL));
  });

  it('T2: the packed tarball carries the closure and its entry points import from the unpacked archive', async (t) => {
    const npmCli = findNpmCli();
    if (npmCli === null) {
      t.skip('capability missing: npm-cli.js not found next to this Node installation');
      return;
    }
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ocms-pack-'));
    try {
      const packDest = path.join(tempRoot, 'packed');
      fs.mkdirSync(packDest, { recursive: true });
      const packed = await run(process.execPath, [npmCli, 'pack', '--pack-destination', packDest, '--json'], {
        cwd: REPO_ROOT,
        env: { ...process.env, npm_config_audit: 'false', npm_config_fund: 'false', npm_config_offline: 'true' },
        timeoutMs: 180000,
      });
      assert.equal(packed.code, 0, 'npm pack failed: ' + packed.stderr.slice(0, 800));
      const tgz = fs.readdirSync(packDest).filter((n) => n.endsWith('.tgz'));
      assert.equal(tgz.length, 1, 'expected exactly one tarball, got ' + JSON.stringify(tgz));
      const tgzPath = path.join(packDest, tgz[0]);

      const members = new Map();
      eachTarballMember(tgzPath, (full, bytes) => { members.set(full, bytes); });
      const prefix = 'package/';
      const closure = importClosure();
      const absent = [...closure.keys()].filter((rel) => !members.has(prefix + rel));
      assert.deepEqual(absent, [], 'tarball is missing reachable modules:' + NL + absent.join(NL));

      const unpacked = path.join(tempRoot, 'unpacked');
      fs.mkdirSync(unpacked, { recursive: true });
      let written = 0;
      for (const [member, bytes] of members) {
        if (!member.startsWith(prefix)) continue;
        const rel = member.slice(prefix.length);
        if (rel === '' || rel.endsWith('/')) continue;
        const dest = path.join(unpacked, ...rel.split('/'));
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, bytes);
        written += 1;
      }
      assert.ok(written >= 8, 'expected a non-trivial tarball, unpacked only ' + written + ' files');
      // A tarball install resolves its declared dependencies from the installed
      // tree; the repository node_modules stands in for that.
      fs.symlinkSync(path.join(REPO_ROOT, 'node_modules'), path.join(unpacked, 'node_modules'), 'junction');

      const nodeEntry = MANIFEST.exports['.'];
      const browserEntry = MANIFEST.exports['./client'];
      assert.equal(typeof nodeEntry, 'string', 'manifest must declare a Node entry point');
      assert.equal(typeof browserEntry, 'string', 'manifest must declare the web client entry point');
      for (const entry of [nodeEntry, browserEntry]) {
        const target = path.join(unpacked, ...stripDotSlash(entry).split('/'));
        assert.ok(fs.existsSync(target), 'entry point missing from the tarball: ' + entry);
      }
      // The Node entry must actually link and load from the unpacked archive.
      await import(pathToFileURL(path.join(unpacked, ...stripDotSlash(nodeEntry).split('/'))).href);
      // The web client is a DOM bundle and cannot be imported under Node; its
      // bytes must still be valid JavaScript.
      const checked = await run(process.execPath, ['--check', path.join(unpacked, ...stripDotSlash(browserEntry).split('/'))], {
        cwd: unpacked,
        env: { ...process.env },
        timeoutMs: 30000,
      });
      assert.equal(checked.code, 0, 'shipped client entry is not valid JavaScript: ' + checked.stderr.slice(0, 400));
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});