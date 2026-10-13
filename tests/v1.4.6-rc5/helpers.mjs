// OCMS-S v1.4.6-rc5 test helpers (test-first gate).
// Freeze anchor for the frozen contract text. No production access.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export { assert } from '../v1.3/helpers.mjs';
export { REPO_ROOT } from '../v1.3/helpers.mjs';
import { REPO_ROOT as ROOT } from '../v1.3/helpers.mjs';

// ---------------------------------------------------------------------------
// Contract freeze anchor (contract v1.4.6-rc5 §16).
// ---------------------------------------------------------------------------

export const FROZEN_CONTRACT_FILE = 'OpenCode Model Sync — Simple Script Contract v1.4.6-rc5.md';
export const FROZEN_CONTRACT_SHA256 = 'ea05bda17a85bf1ade98d8655b59ba733f03d0d235352d19da8e91c20556de69';
export const FROZEN_CONTRACT_LINES = 255;

export function frozenContractBytes() {
  return fs.readFileSync(path.join(ROOT, FROZEN_CONTRACT_FILE));
}

// ---------------------------------------------------------------------------
// Amendment A freeze anchor (Amendment A, Freeze record).
// ---------------------------------------------------------------------------

export const AMENDMENT_A_FILE = 'OpenCode Model Sync — Simple Script Contract v1.4.6-rc5 Amendment A.md';
export const AMENDMENT_A_SHA256 = 'acc840231bda004bf3abd2e61a3da8c859f447f75a0431aa1660f501e26ec5cf';
export const AMENDMENT_A_LINES = 59;

export function amendmentABytes() {
  return fs.readFileSync(path.join(ROOT, AMENDMENT_A_FILE));
}

export function sha256HexBytes(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

export function countTextLines(bytes) {
  const text = Buffer.isBuffer(bytes) ? bytes.toString('utf8') : String(bytes);
  const parts = text.split('\n');
  return text.endsWith('\n') ? parts.length - 1 : parts.length;
}
