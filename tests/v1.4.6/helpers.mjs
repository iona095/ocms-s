// OCMS-S v1.4.6 test helpers (release gate).
// Freeze anchor for the frozen contract text. No production access.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export { assert } from '../v1.3/helpers.mjs';
export { REPO_ROOT } from '../v1.3/helpers.mjs';
import { REPO_ROOT as ROOT } from '../v1.3/helpers.mjs';

// ---------------------------------------------------------------------------
// Contract freeze anchor (contract v1.4.6 §9).
// ---------------------------------------------------------------------------

export const FROZEN_CONTRACT_FILE = 'OpenCode Model Sync — Simple Script Contract v1.4.6.md';
export const FROZEN_CONTRACT_SHA256 = '2b99068b8980cd2a52419e8533afe4bd16ca7153376df1817a4de2e53fab82b3';
export const FROZEN_CONTRACT_LINES = 153;

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
