// OCMS-S v1.4.6-rc4 test helpers (test-first gate).
// Freeze anchor for the frozen contract text. No production access.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export { assert } from '../v1.3/helpers.mjs';
export { REPO_ROOT } from '../v1.3/helpers.mjs';
import { REPO_ROOT as ROOT } from '../v1.3/helpers.mjs';

// ---------------------------------------------------------------------------
// Contract freeze anchor (contract v1.4.6-rc4 §15).
// ---------------------------------------------------------------------------

export const FROZEN_CONTRACT_FILE = 'OpenCode Model Sync — Simple Script Contract v1.4.6-rc4.md';
export const FROZEN_CONTRACT_SHA256 = 'bdf79b620f5b69fe575c6abb2206a13191488cb1112a7ffd7609f42613ad2c63';
export const FROZEN_CONTRACT_LINES = 245;

export function frozenContractBytes() {
  return fs.readFileSync(path.join(ROOT, FROZEN_CONTRACT_FILE));
}

export function sha256HexBytes(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

// ---------------------------------------------------------------------------
// Amendment A freeze anchor (Amendment A, Freeze record).
// ---------------------------------------------------------------------------

export const AMENDMENT_A_FILE = 'OpenCode Model Sync — Simple Script Contract v1.4.6-rc4 Amendment A.md';
export const AMENDMENT_A_SHA256 = '38706d72f5a8b2e2e73cd2908a5fcad7bf300346a546a65b379dfe734b77c2b7';
export const AMENDMENT_A_LINES = 66;

export function amendmentABytes() {
  return fs.readFileSync(path.join(ROOT, AMENDMENT_A_FILE));
}

export function countTextLines(bytes) {
  const text = Buffer.isBuffer(bytes) ? bytes.toString('utf8') : String(bytes);
  const parts = text.split('\n');
  return text.endsWith('\n') ? parts.length - 1 : parts.length;
}
