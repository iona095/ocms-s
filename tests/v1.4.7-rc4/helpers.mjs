// OCMS-S v1.4.7-rc4 test helpers (test-first gate).
// Freeze anchor for the frozen contract text. No production access.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export { assert } from '../v1.3/helpers.mjs';
export { REPO_ROOT } from '../v1.3/helpers.mjs';
import { REPO_ROOT as ROOT } from '../v1.3/helpers.mjs';

// Contract freeze anchor (contract v1.4.7-rc4 Freeze record).

export const FROZEN_CONTRACT_FILE = 'OpenCode Model Sync \u2014 Simple Script Contract v1.4.7-rc4.md';
export const FROZEN_CONTRACT_SHA256 = '988466ebe3e80588bf2075e6874f4fcb2c6f2f9abf3037c49b48a2fafc0c8a43';
export const FROZEN_CONTRACT_LINES = 181;

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

export const AMENDMENT_A_FILE = 'OpenCode Model Sync \u2014 Simple Script Contract v1.4.7-rc4 Amendment A.md';
export const AMENDMENT_A_SHA256 = '86f1b174f25e80b0c21f38adff7916a506bf93fbad9644727e259fa20da71dd4';
export const AMENDMENT_A_LINES = 84;

export function amendmentABytes() {
  return fs.readFileSync(path.join(ROOT, AMENDMENT_A_FILE));
}

// ---------------------------------------------------------------------------
// Amendment B freeze anchor (Amendment B, Freeze record).
// ---------------------------------------------------------------------------

export const AMENDMENT_B_FILE = 'OpenCode Model Sync \u2014 Simple Script Contract v1.4.7-rc4 Amendment B.md';
export const AMENDMENT_B_SHA256 = 'f322dc956fba3d1c8030826773fe92720020e13c60e875078a01eec66b571060';
export const AMENDMENT_B_LINES = 111;

export function amendmentBBytes() {
  return fs.readFileSync(path.join(ROOT, AMENDMENT_B_FILE));
}

// ---------------------------------------------------------------------------
// Amendment C freeze anchor (Amendment C, Freeze record).
// ---------------------------------------------------------------------------

export const AMENDMENT_C_FILE = 'OpenCode Model Sync \u2014 Simple Script Contract v1.4.7-rc4 Amendment C.md';
export const AMENDMENT_C_SHA256 = '60b1181968b5cfa957a81f2c03e397360e011b46b7b40794dfaa7be41de9c83d';
export const AMENDMENT_C_LINES = 56;

export function amendmentCBytes() {
  return fs.readFileSync(path.join(ROOT, AMENDMENT_C_FILE));
}
