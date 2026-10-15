// CI2: the clean-environment vehicle must be able to run a named npm script.
// It hardcoded ['test', ...args], so 'npm run test:profile' could not be
// executed by the repo's own vehicle at all; every clean-env test:profile
// number had to be produced by a hand-rolled scrub instead.
//
// Red first: parseNpmArgs is asserted on the argument shapes that used to be
// impossible, plus negative controls so the parser cannot be loosened into
// passing anything through.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseNpmArgs } from '../../tests/support/clean-env-run.mjs';

describe('CI2 — clean-env vehicle takes an npm script name', () => {
  it('DEFAULT is unchanged: no arguments still runs npm test', () => {
    assert.deepEqual(parseNpmArgs([]), ['test']);
    assert.deepEqual(parseNpmArgs(['--']), ['test']);
  });

  it('reproduces the old default: trailing arguments still append to npm test', () => {
    assert.deepEqual(parseNpmArgs(['--', 'extra1', 'extra2']), ['test', 'extra1', 'extra2']);
  });

  it('runs a named script: test:profile becomes run test:profile', () => {
    assert.deepEqual(parseNpmArgs(['test:profile']), ['run', 'test:profile']);
    assert.deepEqual(parseNpmArgs(['test']), ['test'], 'plain "test" keeps npm test');
    assert.deepEqual(parseNpmArgs(['test:coverage']), ['run', 'test:coverage']);
    assert.deepEqual(
      parseNpmArgs(['--', 'test:profile']),
      ['test', 'test:profile'],
      '-- keeps its legacy meaning: append to npm test, never take a script name',
    );
  });

  it('NEGATIVE CONTROL: a flag or unknown shape is not treated as a script name', () => {
    for (const bad of ['--verbose', '-w', '   ']) {
      const parsed = parseNpmArgs([bad]);
      assert.deepEqual(
        parsed,
        ['test', bad],
        JSON.stringify(bad) + ' must stay an argument to npm test, never a script name; got: ' + JSON.stringify(parsed),
      );
    }
    assert.deepEqual(parseNpmArgs([]), ['test'], 'no argument is still npm test');
    assert.deepEqual(
      parseNpmArgs(['']),
      ['test', ''],
      'an empty argument is appended exactly as the pre-CI2 vehicle appended it',
    );
  });

  it('NEGATIVE CONTROL: only the first bare word is the script name', () => {
    assert.deepEqual(parseNpmArgs(['test:profile', 'second']), ['run', 'test:profile', 'second']);
  });

  it('NEGATIVE CONTROL: an argument after -- is not mistaken for a script name', () => {
    assert.deepEqual(parseNpmArgs(['--', '--watch']), ['test', '--watch']);
  });
});
