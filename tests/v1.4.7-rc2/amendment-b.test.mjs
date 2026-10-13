// OCMS-S v1.4.7-rc2 Amendment B freeze test (see helpers.mjs amendment anchor).
import { describe, it } from 'node:test';
import {
  assert,
  AMENDMENT_B_FILE,
  AMENDMENT_B_SHA256,
  AMENDMENT_B_LINES,
  amendmentBBytes,
  sha256HexBytes,
  countTextLines,
} from './helpers.mjs';

describe('v1.4.7-rc2 Amendment B', () => {
  it('amendment B freeze anchor is intact', () => {
    const bytes = amendmentBBytes();
    assert.equal(sha256HexBytes(bytes), AMENDMENT_B_SHA256, 'amendment SHA-256 must match the frozen value');
    assert.equal(countTextLines(bytes), AMENDMENT_B_LINES, 'amendment line count must match the frozen value');
    assert.ok(AMENDMENT_B_FILE.length > 0);
  });
});
