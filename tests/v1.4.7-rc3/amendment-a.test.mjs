// OCMS-S v1.4.7-rc3 Amendment A freeze test (see helpers.mjs amendment anchor).
import { describe, it } from 'node:test';
import {
  assert,
  AMENDMENT_A_FILE,
  AMENDMENT_A_SHA256,
  AMENDMENT_A_LINES,
  amendmentABytes,
  sha256HexBytes,
  countTextLines,
} from './helpers.mjs';

describe('v1.4.7-rc3 Amendment A', () => {
  it('amendment A freeze anchor is intact', () => {
    const bytes = amendmentABytes();
    assert.equal(sha256HexBytes(bytes), AMENDMENT_A_SHA256, 'amendment SHA-256 must match the frozen value');
    assert.equal(countTextLines(bytes), AMENDMENT_A_LINES, 'amendment line count must match the frozen value');
    assert.ok(AMENDMENT_A_FILE.length > 0);
  });
});
