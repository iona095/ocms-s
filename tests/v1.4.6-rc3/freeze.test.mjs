// OCMS-S v1.4.6-rc3 freeze test (see helpers.mjs freeze anchor).
// Additional rc3 tests arrive after "go" per the gate order.
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

describe('v1.4.6-rc3 hermetic npm test', () => {
  it('1. contract v1.4.6-rc3 freeze anchor is intact', () => {
    const bytes = frozenContractBytes();
    assert.equal(sha256HexBytes(bytes), FROZEN_CONTRACT_SHA256, 'contract SHA-256 must match the frozen value');
    assert.equal(countTextLines(bytes), FROZEN_CONTRACT_LINES, 'contract line count must match the frozen value');
    assert.ok(FROZEN_CONTRACT_FILE.length > 0);
  });
});
