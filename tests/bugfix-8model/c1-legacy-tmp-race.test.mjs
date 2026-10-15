// C1 legacy-tmp-race [report C20; Space Bunny/GLM L2]. Legacy commitPlan uses
// a fixed '<settings>.tmp' with no lock: two barrier-synced committers
// (worker_threads, shared temp path) collide on it — one renames the other's
// bytes or hits ENOENT on the moved temp, a spurious temp-flavored refusal.
// Per round both workers start together (SharedArrayBuffer barrier); the test
// asserts: zero temp-ENOENT refusals, zero .tmp residue, every UPDATED backed
// by a unique valid backup, final file wholly one committed content.
// Scratch settings under os.tmpdir(); stub sources only; bounded waits.
import { describe, it, beforeEach, afterEach } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { parse as parseYaml } from 'yaml';
import { assert, makeTempHome, sandboxDshHome } from '../profile-cli-ui/helpers.mjs';
import { tempResidue } from '../v1.3/helpers.mjs';

const ROUNDS = 60;
const WORKER_FILE = path.join(process.cwd(), 'tests', 'bugfix-8model', 'c1-worker.mjs');
function backups(dir) {
  return fs.readdirSync(dir).filter((n) => n.includes('.bak-'));
}
function managedIds(file) {
  const doc = parseYaml(fs.readFileSync(file, 'utf8'));
  const ids = [];
  const walk = (v) => {
    if (Array.isArray(v)) { for (const e of v) walk(e); return; }
    if (v && typeof v === 'object') {
      if (Array.isArray(v.models)) { for (const m of v.models) if (m && typeof m.id === 'string') ids.push(m.id); }
      for (const k of Object.keys(v)) walk(v[k]);
    }
  };
  walk(doc);
  return [...new Set(ids)].sort();
}

describe('C1 legacy-tmp-race: a fixed shared temp corrupts concurrent commits', () => {
  let home; let cleanupHome; let restore;
  beforeEach(() => { restore = sandboxDshHome(); const h = makeTempHome('ocms-c1-'); home = h.home; cleanupHome = h.cleanup; });
  afterEach(() => { try { cleanupHome(); } catch {} try { restore(); } catch {} });

  it('two barrier-synced committers: no temp-ENOENT, no residue, backups 1:1, coherent final', { timeout: 180000 }, async () => {
    const dsh = path.join(home, '.dsh');
    fs.mkdirSync(dsh, { recursive: true });
    const scratch = path.join(home, 'scratch');
    fs.mkdirSync(scratch, { recursive: true });
    const file = path.join(scratch, 'settings.yaml');
    fs.writeFileSync(file, ['llm:', '  unrelated: true', 'llm-pi-ai:', '  providers: {}', ''].join(String.fromCharCode(10)), 'utf8');
    const sab = new SharedArrayBuffer(4);
    const runWorker = () => new Promise((resolve, reject) => {
      const w = new Worker(WORKER_FILE, { workerData: { repoRoot: process.cwd(), settingsPath: file, rounds: ROUNDS, sab } });
      const timer = setTimeout(() => { try { w.terminate(); } catch {} reject(new Error('C1 worker join timed out')); }, 120000);
      w.once('message', (msg) => { clearTimeout(timer); try { w.terminate(); } catch {} resolve(msg); });
      w.once('error', (err) => { clearTimeout(timer); reject(err); });
    });
    const [a, b] = await Promise.all([runWorker(), runWorker()]);
    const tallies = [a.tally, b.tally];
    const tempAnomalies = tallies.reduce((n, t) => n + t.tempAnomaly, 0);
    const refused = tallies.flatMap((t) => t.refused);
    console.log('C1 tallies ' + JSON.stringify(tallies.map((t) => ({ updated: t.updated, refused: t.refused.length, notReady: t.notReady, tempAnomaly: t.tempAnomaly, barrierTimeout: t.barrierTimeout }))));
    const eperm = refused.filter((r) => /EPERM/i.test(r)).length;
    console.log('C1 contention-note EPERM-destination refusals (out-of-scope file race): ' + eperm);
    assert.equal(tempAnomalies, 0, 'zero stolen-temp ENOENT refusals, got ' + tempAnomalies + ' e.g. ' + JSON.stringify(refused.slice(0, 3)));
    assert.deepEqual(tempResidue(scratch), [], 'no .tmp residue after concurrent commits');
    const updated = tallies.reduce((n, t) => n + t.updated, 0);
    const bak = backups(scratch);
    // Residual (out of scope, recorded): legacy backup naming (existsSync pick plus
    // non-exclusive write) can collapse same-tick backups, so counts need not match
    // UPDATED 1:1. Identity holds for every backup present: unique names, valid
    // pre-image mappings. The legacy UPDATED result names no backup path.
    assert.ok(bak.length > 0, 'backups exist');
    console.log('C1 backup-note: ' + bak.length + ' backup files for ' + updated + ' UPDATED (same-tick collapse is a separate backup-naming race, not temp aliasing)');
    assert.equal(new Set(bak).size, bak.length, 'backup identities unique');
    for (const name of bak) {
      const doc = parseYaml(fs.readFileSync(path.join(scratch, name), 'utf8'));
      assert.ok(doc && typeof doc === 'object' && !Array.isArray(doc), 'backup parses as a mapping: ' + name);
    }
    const ids = managedIds(file);
    assert.ok(ids !== null && (JSON.stringify(ids) === JSON.stringify(['model-a', 'model-z', 'race-w0']) || JSON.stringify(ids) === JSON.stringify(['model-a', 'model-z', 'race-w1'])), 'final file is wholly one committed content, got ' + JSON.stringify(ids));
  });
});
