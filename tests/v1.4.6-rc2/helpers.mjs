// OCMS-S v1.4.6-rc2 test helpers (test-first gate).
// Freeze anchor for the frozen contract text plus shared stub helpers.
// No production access: scratch settings only, no live network.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export { assert } from '../v1.3/helpers.mjs';
export { REPO_ROOT, scratchSettingsFile, emptyCurrent, catRecord, validSources } from '../v1.3/helpers.mjs';
import { REPO_ROOT as ROOT } from '../v1.3/helpers.mjs';

// ---------------------------------------------------------------------------
// Contract freeze anchor (contract v1.4.6-rc2 §15).
// ---------------------------------------------------------------------------

export const FROZEN_CONTRACT_FILE = 'OpenCode Model Sync \u2014 Simple Script Contract v1.4.6-rc2.md';
export const FROZEN_CONTRACT_SHA256 = '00204930eb1a12a4250a9eaeecd2828ac1fb83b17ffba8b2772c6d81dd56484a';
export const FROZEN_CONTRACT_LINES = 227;

export function frozenContractBytes() {
  return fs.readFileSync(path.join(ROOT, FROZEN_CONTRACT_FILE));
}

export function sha256HexBytes(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

export function countTextLines(bytes) {
  const text = Buffer.isBuffer(bytes) ? bytes.toString('utf8') : String(bytes);
  const parts = text.split('\n');
  return text.endsWith('\n') ? parts.length - 1 : parts.length;
}
