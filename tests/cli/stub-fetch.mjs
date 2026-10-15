// Test-only network stub injected into the spawned sync.mjs with
// NODE_OPTIONS=--import. Reads its five source bodies from OCMS_STUB_FIXTURE
// and never reaches the network. OCMS_STUB_MODE=fail makes every request throw.
import fs from 'node:fs';

const fixture = JSON.parse(fs.readFileSync(process.env.OCMS_STUB_FIXTURE, 'utf8'));

globalThis.fetch = async (url) => {
  if (process.env.OCMS_STUB_MODE === 'fail') throw new Error('STUBBED_NETWORK_FAILURE');
  const key = Object.keys(fixture.urls).find((k) => fixture.urls[k] === String(url));
  if (key === undefined) throw new Error('STUB_HAS_NO_BODY_FOR ' + String(url));
  return { ok: true, status: 200, text: async () => fixture.bodies[key] };
};
