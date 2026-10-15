// C1 worker: one controlled legacy committer. Barrier-synced with its peer, it
// builds and commits a READY plan every round with alternating shared model
// sets, then reports outcome tallies. No network, no real home.
import { workerData, parentPort } from 'node:worker_threads';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
const { repoRoot, settingsPath, rounds } = workerData;
const sync = await import(pathToFileURL(repoRoot + '/sync.mjs').href);
const { validSources, catRecord } = await import(pathToFileURL(repoRoot + '/tests/v1.3/helpers.mjs').href);
const flag = new Int32Array(workerData.sab);
function sourcesFor(id) {
  const s = validSources();
  s.rosters = { go: ['model-a', id], zen: ['model-z'] };
  s.catalog.go.models[id] = catRecord({ id, name: id, provider: { npm: '@ai-sdk/openai-compatible' } });
  s.docs.go[id] = 'https://opencode.ai/zen/go/v1/chat/completions';
  return s;
}
const tally = { updated: 0, refused: [], notReady: 0, tempAnomaly: 0, barrierTimeout: 0 };
for (let k = 0; k < rounds; k++) {
  Atomics.add(flag, 0, 1);
  Atomics.notify(flag, 0, 1);
  const need = 2 * (k + 1);
  const deadline = Date.now() + 10000;
  while (Atomics.load(flag, 0) < need && Date.now() < deadline) {
    Atomics.wait(flag, 0, Atomics.load(flag, 0), 100);
  }
  if (Atomics.load(flag, 0) < need) { tally.barrierTimeout += 1; break; }
  const id = 'race-w' + (k % 2);
  let plan;
  try {
    plan = sync.buildPlan({ settingsPath, sources: sourcesFor(id) });
  } catch (e) { tally.refused.push('buildPlan threw: ' + String((e && e.message) || e)); continue; }
  if (!plan || plan.state !== 'READY') { tally.notReady += 1; continue; }
  let res;
  try {
    res = sync.commitPlan(plan);
  } catch (e) { tally.refused.push('commitPlan threw: ' + String((e && e.message) || e)); continue; }
  if (res && res.result === 'UPDATED') { tally.updated += 1; continue; }
  const rsn = ((res && res.unresolved) || []).map((u) => (u && u.reason) || String(u)).join('; ');
  tally.refused.push(rsn);
  // Temp-aliasing anomaly only: the commit's OWN temp went missing (stolen by a
  // peer's rename). Destination-contention EPERM on unique temps is file-level
  // racing outside this ticket's fix scope and is counted in refused, not here.
  if (/ENOENT/i.test(rsn) && /\.tmp/.test(rsn)) tally.tempAnomaly += 1;
}
parentPort.postMessage({ t: 'done', tally });
