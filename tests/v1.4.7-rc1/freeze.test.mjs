// OCMS-S v1.4.7-rc1 freeze test (see helpers.mjs freeze anchor).
import { describe, it } from 'node:test';
import {
  assert,
  FROZEN_CONTRACT_FILE,
  FROZEN_CONTRACT_SHA256,
  FROZEN_CONTRACT_LINES,
  frozenContractBytes,
  sha256HexBytes,
  countTextLines,
} from './helpers.mjs';

describe('v1.4.7-rc1 go docs move and fail-closed base', () => {
  it('1. contract v1.4.7-rc1 freeze anchor is intact', () => {
    const bytes = frozenContractBytes();
    assert.equal(sha256HexBytes(bytes), FROZEN_CONTRACT_SHA256, 'contract SHA-256 must match the frozen value');
    assert.equal(countTextLines(bytes), FROZEN_CONTRACT_LINES, 'contract line count must match the frozen value');
    assert.ok(FROZEN_CONTRACT_FILE.length > 0);
  });
});
