// OCMS-S v1.4.7-rc2 test helpers (test-first gate).
// Freeze anchor for the frozen contract text. No production access.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export { assert } from '../v1.3/helpers.mjs';
export { REPO_ROOT } from '../v1.3/helpers.mjs';
import { REPO_ROOT as ROOT } from '../v1.3/helpers.mjs';

// Contract freeze anchor (contract v1.4.7-rc2 section 11).

export const FROZEN_CONTRACT_FILE = 'OpenCode Model Sync — Simple Script Contract v1.4.7-rc2.md';
export const FROZEN_CONTRACT_SHA256 = 'fd4d2e186afd721f280ad974f934028377f6802ce1a8620ac1c9968066f760aa';
export const FROZEN_CONTRACT_LINES = 142;

export function frozenContractBytes() {
  return fs.readFileSync(path.join(ROOT, FROZEN_CONTRACT_FILE));
}

// Amendment A freeze anchor (Amendment A, Freeze record).

export const AMENDMENT_A_FILE = 'OpenCode Model Sync — Simple Script Contract v1.4.7-rc2 Amendment A.md';
export const AMENDMENT_A_SHA256 = '22a44036180c86b4ec663b288ec3334afcd918a35ec6952f3cfa1f9ec1a2d5f5';
export const AMENDMENT_A_LINES = 75;

export function amendmentABytes() {
  return fs.readFileSync(path.join(ROOT, AMENDMENT_A_FILE));
}

// ---------------------------------------------------------------------------
// Amendment B freeze anchor (Amendment B, Freeze record).
// ---------------------------------------------------------------------------

export const AMENDMENT_B_FILE = 'OpenCode Model Sync — Simple Script Contract v1.4.7-rc2 Amendment B.md';
export const AMENDMENT_B_SHA256 = 'd91f74aa2c1b34b97cbb7fa1a7a1cc3f3fd1ae417275bb4405519c091a93f9b9';
export const AMENDMENT_B_LINES = 88;

export function amendmentBBytes() {
  return fs.readFileSync(path.join(ROOT, AMENDMENT_B_FILE));
}

export function sha256HexBytes(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

export function countTextLines(bytes) {
  const text = Buffer.isBuffer(bytes) ? bytes.toString('utf8') : String(bytes);
  const parts = text.split('\n');
  return text.endsWith('\n') ? parts.length - 1 : parts.length;
}
