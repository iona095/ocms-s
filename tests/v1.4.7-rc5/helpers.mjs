// OCMS-S v1.4.7-rc5 test helpers (test-first gate).
// Freeze anchor for the frozen contract text. No production access.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export { assert } from '../v1.3/helpers.mjs';
export { REPO_ROOT } from '../v1.3/helpers.mjs';
import { REPO_ROOT as ROOT } from '../v1.3/helpers.mjs';

// Contract freeze anchor (contract v1.4.7-rc5 Freeze record).

export const FROZEN_CONTRACT_FILE = 'OpenCode Model Sync \u2014 Simple Script Contract v1.4.7-rc5.md';
export const FROZEN_CONTRACT_SHA256 = '66f11fdcbfafd2445642ed1a9652771a699a4d98f1b8930b44fe85381d0245c1';
export const FROZEN_CONTRACT_LINES = 130;

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

export const AMENDMENT_A_FILE = 'OpenCode Model Sync \u2014 Simple Script Contract v1.4.7-rc5 Amendment A.md';
export const AMENDMENT_A_SHA256 = '3c2e143bfaa0e2cb0f4f90dee33700015efb172e92b86900fda2a9c7b18d3208';
export const AMENDMENT_A_LINES = 46;

export function amendmentABytes() {
  return fs.readFileSync(path.join(ROOT, AMENDMENT_A_FILE));
}
