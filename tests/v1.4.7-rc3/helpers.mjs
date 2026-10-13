// OCMS-S v1.4.7-rc3 test helpers (test-first gate).
// Freeze anchor for the frozen contract text. No production access.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export { assert } from '../v1.3/helpers.mjs';
export { REPO_ROOT } from '../v1.3/helpers.mjs';
import { REPO_ROOT as ROOT } from '../v1.3/helpers.mjs';

// Contract freeze anchor (contract v1.4.7-rc3 Freeze record).

export const FROZEN_CONTRACT_FILE = 'OpenCode Model Sync \u2014 Simple Script Contract v1.4.7-rc3.md';
export const FROZEN_CONTRACT_SHA256 = 'c007671724cb82a984f313fd2b199aa43917c84cfd70ab7ec4f17a421cb89d2d';
export const FROZEN_CONTRACT_LINES = 189;

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

// ---------------------------------------------------------------------------
// Amendment A freeze anchor (Amendment A, Freeze record).
// ---------------------------------------------------------------------------

export const AMENDMENT_A_FILE = 'OpenCode Model Sync \u2014 Simple Script Contract v1.4.7-rc3 Amendment A.md';
export const AMENDMENT_A_SHA256 = 'db6619acb79fb837b8991f5000e8de271bfa65cff42445f676f21f2127480bb8';
export const AMENDMENT_A_LINES = 61;

export function amendmentABytes() {
  return fs.readFileSync(path.join(ROOT, AMENDMENT_A_FILE));
}
