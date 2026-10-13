// OCMS-S v1.4.6-rc3 test helpers (test-first gate).
// Freeze anchor for the frozen contract text. No production access.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export { assert } from '../v1.3/helpers.mjs';
export { REPO_ROOT } from '../v1.3/helpers.mjs';
import { REPO_ROOT as ROOT } from '../v1.3/helpers.mjs';

// ---------------------------------------------------------------------------
// Contract freeze anchor (contract v1.4.6-rc3 §15).
// ---------------------------------------------------------------------------

export const FROZEN_CONTRACT_FILE = 'OpenCode Model Sync \u2014 Simple Script Contract v1.4.6-rc3.md';
export const FROZEN_CONTRACT_SHA256 = 'd31553f23681bb8372ff01a7fefc999d9ea4f4e74a2ac327551a98d4c42399cb';
export const FROZEN_CONTRACT_LINES = 238;

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
