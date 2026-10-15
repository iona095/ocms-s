// P2-1 RED: every ENV04 loader fiber case must assert its classification,
// and file-rejects/native-accepts plus harness/timeout failures must fail.
//
// Part 1 pins the outcome contract on plain host-runnable helpers (no guest
// harness needed). Part 2 guards the guest test itself: the per-case
// classification it computes must be asserted, never just logged.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env04Classify, env04MustFail, env04Corpus } from './env04-outcomes.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

describe('ENV04 loader outcome contract (P2-1)', () => {
  it('documents the agreement/divergence classes', () => {
    assert.equal(env04Classify('ok', 'accepted'), 1);
    assert.equal(env04Classify('SETTINGS_INVALID', 'rejected'), 2);
    assert.equal(env04Classify('commit-refuses', 'rejected'), 2);
    assert.equal(env04Classify('ok', 'rejected'), 3);
    assert.equal(env04Classify('ok-gap', 'rejected'), 3);
  });

  it('leaves no reachable failure outcome unclassified-silently: must-fail predicate fires', () => {
    assert.equal(env04MustFail('SETTINGS_INVALID', 'accepted'), 'file-rejects-native-accepts');
    assert.equal(env04MustFail('commit-refuses', 'accepted'), 'file-rejects-native-accepts');
    assert.equal(env04MustFail('bind-SYMLINK_ESCAPE', 'accepted'), 'file-rejects-native-accepts');
    assert.equal(env04MustFail('ok', 'failed-timeout'), 'native-failed-timeout');
    assert.equal(env04MustFail('ok-gap', 'failed-harness'), 'native-failed-harness');
    assert.equal(env04MustFail('ok', 'accepted'), null);
    assert.equal(env04MustFail('ok', 'rejected'), null);
    assert.equal(env04MustFail('SETTINGS_INVALID', 'rejected'), null);
  });

  it('every corpus case carries an expected nonzero class for its designed outcome', () => {
    const designedNative = { 1: 'accepted', 2: 'rejected', 3: 'rejected' };
    for (const c of env04Corpus()) {
      assert.ok([1, 2, 3].includes(c.exp), c.name + ' needs an expected class');
      assert.equal(env04Classify(c.fileExp, designedNative[c.exp]), c.exp, c.name + ' designed outcome must classify as expected');
    }
  });

  it('the guest fiber test asserts every computed classification (not just logs it)', () => {
    const src = fs.readFileSync(path.join(HERE, 'env04-loader.test.mjs'), 'utf8');
    assert.ok(src.includes('c.exp'), 'per-case expected class must be referenced');
    assert.ok(src.includes('assert.notEqual') && src.includes(', 0,'), 'unclassified outcomes must be rejected');
    assert.ok(src.includes('env04MustFail'), 'must-fail outcomes must be enforced');
  });
});
