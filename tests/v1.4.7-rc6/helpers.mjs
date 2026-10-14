// OCMS-S v1.4.7-rc6 test helpers (test-first gate).
// Freeze anchor for the frozen contract text. No production access.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export { assert } from '../v1.3/helpers.mjs';
export { REPO_ROOT } from '../v1.3/helpers.mjs';
import { REPO_ROOT as ROOT } from '../v1.3/helpers.mjs';

// Contract freeze anchor (contract v1.4.7-rc6 Freeze record).

export const FROZEN_CONTRACT_FILE = 'OpenCode Model Sync \u2014 Simple Script Contract v1.4.7-rc6.md';
export const FROZEN_CONTRACT_SHA256 = '0d9244d8c89e452baaa5c1d6fdad72c67fefd718414691279b8da25a2dc7c634';
export const FROZEN_CONTRACT_LINES = 97;

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
// Amendment A freeze anchor (v1.4.7-rc6 Amendment A, Freeze record).
// Amendment A amends exactly one test constant (the alpha.1/alpha.2 pair in
// tests/profile-acceptance/env04-staging.test.mjs) and records the pair already
// accepted in tests/profile-acceptance/env02-native.test.mjs. No product change.
// ---------------------------------------------------------------------------

export const AMENDMENT_A_FILE = 'OpenCode Model Sync \u2014 Simple Script Contract v1.4.7-rc6 Amendment A.md';
export const AMENDMENT_A_SHA256 = 'faed7acc2883209256f1ef91c13b131dccb90697afc1bfb005569b1d25cfc593';
export const AMENDMENT_A_LINES = 78;

export function amendmentABytes() {
  return fs.readFileSync(path.join(ROOT, AMENDMENT_A_FILE));
}
