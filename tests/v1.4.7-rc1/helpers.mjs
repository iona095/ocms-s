// OCMS-S v1.4.7-rc1 test helpers (test-first gate).
// Freeze anchor for the frozen contract text. No production access.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export { assert } from '../v1.3/helpers.mjs';
export { REPO_ROOT } from '../v1.3/helpers.mjs';
import { REPO_ROOT as ROOT } from '../v1.3/helpers.mjs';

// Contract freeze anchor (contract v1.4.7-rc1 section 11).

export const FROZEN_CONTRACT_FILE = 'OpenCode Model Sync — Simple Script Contract v1.4.7-rc1.md';
export const FROZEN_CONTRACT_SHA256 = 'ea1d3481dba5fc190f0694ef9da6b2bd2a48feb504708b53cf36755d06c4a856';
export const FROZEN_CONTRACT_LINES = 140;

// ---------------------------------------------------------------------------
// Captured 2026-10-13 docs pages (read-only fixtures for G4). Stored raw bytes;
// source URL, capture date and SHA-256 recorded here. No live fetch in tests.
// ---------------------------------------------------------------------------

export const FIXTURE_META = Object.freeze({
  go: Object.freeze({
    url: 'https://opencode.ai/v2/docs/console/go/',
    captured: '2026-10-13',
    sha256: '0587eb164d4d4c7a40a1bbffbfe3a69664ebec4784d2b03387712fb2cb6cd75a',
    rows: 32,
  }),
  zen: Object.freeze({
    url: 'https://opencode.ai/v2/docs/console/models/',
    captured: '2026-10-13',
    sha256: '49cda0e6cfb6f575fa22bef455de8009def072a594b84ef1ba36ca20970dba1d',
    rows: 89,
  }),
});

const FIXTURE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

export function goDocsHtml() {
  return fs.readFileSync(path.join(FIXTURE_DIR, 'go-docs-20261013.html'), 'utf8');
}

export function zenDocsHtml() {
  return fs.readFileSync(path.join(FIXTURE_DIR, 'zen-docs-20261013.html'), 'utf8');
}

export function frozenContractBytes() {
  return fs.readFileSync(path.join(ROOT, FROZEN_CONTRACT_FILE));
}

// ---------------------------------------------------------------------------
// Amendment A freeze anchor (Amendment A, Freeze record).
// ---------------------------------------------------------------------------

export const AMENDMENT_A_FILE = 'OpenCode Model Sync — Simple Script Contract v1.4.7-rc1 Amendment A.md';
export const AMENDMENT_A_SHA256 = 'd7f700bbea4dd7ffa3eea351cab9f6ce746f1068ad49bf3c62bac807fb820e50';
export const AMENDMENT_A_LINES = 79;

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
