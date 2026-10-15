// OCMS-S NB1 test helpers: captured 2026-10-15 docs fixtures (read-only).
// No live network. Scratch settings only.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const FIXTURE_META = Object.freeze({
  go: Object.freeze({
    url: 'https://opencode.ai/v2/docs/console/go/',
    captured: '2026-10-15',
    sha256: '7e8319ac71f8ae185fea626707f843a7019375ee0ca3df0a4a5b04733d1324d3',
    rows: 32,
  }),
  zen: Object.freeze({
    url: 'https://opencode.ai/v2/docs/console/models/',
    captured: '2026-10-15',
    sha256: '8928a1494a6aa6db5a251c2778d4d58e04306c7dce2cf2563f0ad0182da330e0',
    rows: 88,
  }),
});

const FIXTURE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

export function goDocsHtml() {
  return fs.readFileSync(path.join(FIXTURE_DIR, 'go-docs-20261015.html'), 'utf8');
}

export function zenDocsHtml() {
  return fs.readFileSync(path.join(FIXTURE_DIR, 'zen-docs-20261015.html'), 'utf8');
}
