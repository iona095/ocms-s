// S3 T08 — NO_CHANGE (P0-R2 §9.8).
// All-F0 returns NO_CHANGE without candidate write, backup or mtime change.
import { describe, it, beforeEach, afterEach } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { renderDesiredState } from '../../profile/surgical-render.mjs';
import { assert, desiredSix, modelRecord, buildPatchText } from './helpers.mjs';

describe('S3 T08 — NO_CHANGE', () => {
  it('T08 all-F0 returns NO_CHANGE with no candidate bytes', () => {
    const providers = { 'opencode': { displayName: 'opencode', models: [modelRecord('a')] } };
    const text = buildPatchText({ providersObj: providers, header: '', trailer: '' });
    const patchBytes = Buffer.from(text, 'utf8');
    const storedConfig = { providers };
    const desired = desiredSix({ 'opencode': [modelRecord('a')] });
    const res = renderDesiredState({ patchBytes, storedConfig, desired });
    assert.equal(res.ok, true);
    assert.equal(res.status, 'NO_CHANGE');
    assert.ok(!res.candidateBytes, 'NO_CHANGE must not carry candidate');
    assert.ok(!res.candidateDigest, 'NO_CHANGE must not carry digest');
    for (const r of Object.keys(res.footprint || {})) assert.equal(res.footprint[r], 'F0');
  });
  it('T08 NO_CHANGE performs no disk mutation (mtime preserved)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocms-s3-nochange-'));
    try {
      const providers = { 'opencode': { displayName: 'opencode', models: [] } };
      const text = buildPatchText({ providersObj: providers, header: '', trailer: '' });
      const file = path.join(dir, 'cordis.patch.yml');
      fs.writeFileSync(file, text, 'utf8');
      const before = fs.statSync(file);
      const patchBytes = fs.readFileSync(file);
      const res = renderDesiredState({ patchBytes, storedConfig: { providers }, desired: desiredSix({}) });
      assert.equal(res.status, 'NO_CHANGE');
      // renderer is pure: it must not have written
      const after = fs.statSync(file);
      assert.equal(after.mtimeMs, before.mtimeMs);
      assert.equal(after.size, before.size);
      // no backup sibling created
      assert.deepEqual(fs.readdirSync(dir), ['cordis.patch.yml']);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
  it('T08 absent-route-empty-desired is NO_CHANGE (case D)', () => {
    const providers = {};
    const text = buildPatchText({ providersObj: providers, header: '', trailer: '' });
    const res = renderDesiredState({ patchBytes: Buffer.from(text, 'utf8'), storedConfig: { providers }, desired: desiredSix({}) });
    assert.equal(res.status, 'NO_CHANGE');
  });
});
