// S5 RED — CLI profile grammar (P0-R2 \u00a78.1/8.5/8.7; P1-A \u00a75 S5). T09/T15/T17 parts. Deterministic offline.
import { describe, it } from 'node:test';
import { assert } from './helpers.mjs';
import { parseProfileCliArgs } from '../../sync.mjs';

describe('S5 CLI grammar (RED)', () => {
  it('requires explicit --profile; no default or fallback', () => {
    assert.throws(() => parseProfileCliArgs([]), /PROFILE/);
    assert.throws(() => parseProfileCliArgs(['--scratch']), /PROFILE/);
    const ok = parseProfileCliArgs(['--profile', 'alpha']);
    assert.equal(ok.profile, 'alpha');
    assert.equal(ok.scratch, false);
    assert.equal(ok.liveStateRaw, undefined);
  });
  it('accepts --profile=<name> and --live-state forms; --scratch restriction flag', () => {
    const a = parseProfileCliArgs(['--profile=beta', '--live-state=not-running']);
    assert.equal(a.profile, 'beta'); assert.equal(a.liveStateRaw, 'not-running');
    const b = parseProfileCliArgs(['--profile', 'beta', '--live-state', 'overlays:C:/a.yml']);
    assert.equal(b.liveStateRaw, 'overlays:C:/a.yml');
    const c = parseProfileCliArgs(['--profile', 'beta', '--scratch']);
    assert.equal(c.scratch, true);
  });
  it('duplicate/invalid/unknown flags refuse', () => {
    assert.throws(() => parseProfileCliArgs(['--profile', 'a', '--profile', 'b']), /DUPLICATE/);
    assert.throws(() => parseProfileCliArgs(['--profile=a', '--profile=b']), /DUPLICATE/);
    assert.throws(() => parseProfileCliArgs(['--profile', 'a', '--live-state=not-running', '--live-state=not-running']), /DUPLICATE/);
    assert.throws(() => parseProfileCliArgs(['--profile', 'a', '--scratch', '--scratch']), /DUPLICATE/);
    assert.throws(() => parseProfileCliArgs(['--profile', 'a', '--bogus']), /UNKNOWN/);
    assert.throws(() => parseProfileCliArgs(['--profile']), /PROFILE/);
    assert.throws(() => parseProfileCliArgs(['--profile', '']), /PROFILE/);
    assert.throws(() => parseProfileCliArgs(['--profile', 'a', '--settings']), /SETTINGS/);
    assert.throws(() => parseProfileCliArgs(['--profile', 'a', '--settings=x', '--settings=y']), /DUPLICATE/);
  });
  it('retains --settings as scratch-only escape hatch (parsed, not reclassified)', () => {
    const r = parseProfileCliArgs(['--profile', 'a', '--settings=C:/tmp/scratch.yaml']);
    assert.equal(r.settings, 'C:/tmp/scratch.yaml');
  });
});
