// S5 RED — shared live-attestation validator (P0-R2 \u00a78.5; P1-A \u00a75 S5, \u00a78).
// T-IDs: T15-part (grammar), S5 attestation battery. Deterministic offline.
import { describe, it } from 'node:test';
import { assert } from './helpers.mjs';
import { createLiveAttestation, parseLiveStateFlag, isAdmittedProductionAttestation, ATTESTATION_MODES } from '../../profile/live-attestation.mjs';

describe('S5 live-attestation grammar (RED)', () => {
  it('exposes exactly two admission modes; UNATTESTED is refusal, not a mode', () => {
    assert.deepEqual([...ATTESTATION_MODES].sort(), ['EXACT_OVERLAYS', 'NOT_RUNNING']);
  });
  it('T: absent attestation (UNATTESTED default) is not admitted', () => {
    for (const bad of [null, undefined]) {
      const r = isAdmittedProductionAttestation(bad, { profileName: 'web', declaredOverlays: [] });
      assert.equal(r.ok, false); assert.equal(r.code, 'LIVE_OVERLAY_UNKNOWN');
    }
  });
  it('T: unacknowledged control refuses (never inferred)', () => {
    for (const bad of [{ profileName: 'p', mode: 'NOT_RUNNING', overlays: [], origin: 'CLI', acknowledged: false }, { profileName: 'p', mode: 'NOT_RUNNING', overlays: [], origin: 'CLI' }, { profileName: 'p', mode: 'NOT_RUNNING', overlays: [], origin: 'CLI', acknowledged: 1 }]) {
      const r = createLiveAttestation({ ...bad, acknowledgedAt: new Date().toISOString() });
      assert.equal(r.ok, false, JSON.stringify(bad));
    }
  });
  it('T: mode A accepts with empty overlays; rejects contradictory overlay claim', () => {
    const ok = createLiveAttestation({ profileName: 'myprof', mode: 'NOT_RUNNING', overlays: [], origin: 'CLI', acknowledged: true });
    assert.equal(ok.ok, true);
    assert.equal(ok.attestation.mode, 'NOT_RUNNING');
    assert.ok(typeof ok.attestation.acknowledgedAt === 'string');
    const bad = createLiveAttestation({ profileName: 'myprof', mode: 'NOT_RUNNING', overlays: ['C:/x.yml'], origin: 'CLI', acknowledged: true });
    assert.equal(bad.ok, false);
  });
  it('T: mode B requires coherent ordered absolute overlay list', () => {
    const good = createLiveAttestation({ profileName: 'myprof', mode: 'EXACT_OVERLAYS', overlays: ['C:/a.yml', 'C:/b.yml'], origin: 'UI', acknowledged: true });
    assert.equal(good.ok, true);
    assert.deepEqual(good.attestation.overlays, ['C:/a.yml', 'C:/b.yml']);
    for (const badOverlays of [[], [''], ['relative.yml'], ['C:/a.yml', 'C:/a.yml'], ['C:/a.yml', ''], [123]]) {
      const r = createLiveAttestation({ profileName: 'myprof', mode: 'EXACT_OVERLAYS', overlays: badOverlays, origin: 'CLI', acknowledged: true });
      assert.equal(r.ok, false, JSON.stringify(badOverlays));
    }
  });
  it('T: profile-name binding enforced', () => {
    const made = createLiveAttestation({ profileName: 'alpha', mode: 'NOT_RUNNING', overlays: [], origin: 'CLI', acknowledged: true });
    assert.equal(made.ok, true);
    const adm = isAdmittedProductionAttestation(made.attestation, { profileName: 'beta', declaredOverlays: [] });
    assert.equal(adm.ok, false); assert.equal(adm.code, 'LIVE_OVERLAY_UNKNOWN');
    const adm2 = isAdmittedProductionAttestation(made.attestation, { profileName: 'alpha', declaredOverlays: [] });
    assert.equal(adm2.ok, true);
  });
  it('T: mode/overlay coherence vs declaredOverlays', () => {
    const a = createLiveAttestation({ profileName: 'p', mode: 'NOT_RUNNING', overlays: [], origin: 'CLI', acknowledged: true }).attestation;
    assert.equal(isAdmittedProductionAttestation(a, { profileName: 'p', declaredOverlays: ['C:/x.yml'] }).ok, false);
    const b = createLiveAttestation({ profileName: 'p', mode: 'EXACT_OVERLAYS', overlays: ['C:/x.yml'], origin: 'CLI', acknowledged: true }).attestation;
    assert.equal(isAdmittedProductionAttestation(b, { profileName: 'p', declaredOverlays: [] }).ok, false);
    assert.equal(isAdmittedProductionAttestation(b, { profileName: 'p', declaredOverlays: ['C:/other.yml'] }).ok, false);
    // order matters
    const b2 = createLiveAttestation({ profileName: 'p', mode: 'EXACT_OVERLAYS', overlays: ['C:/a.yml', 'C:/b.yml'], origin: 'CLI', acknowledged: true }).attestation;
    assert.equal(isAdmittedProductionAttestation(b2, { profileName: 'p', declaredOverlays: ['C:/b.yml', 'C:/a.yml'] }).ok, false);
    assert.equal(isAdmittedProductionAttestation(b2, { profileName: 'p', declaredOverlays: ['C:/a.yml', 'C:/b.yml'] }).ok, true);
  });
  it('T: CLI grammar not-running | overlays:<list>; malformed refuses', () => {
    assert.equal(parseLiveStateFlag('not-running', { profileName: 'p', origin: 'CLI' }).ok, true);
    const ob = parseLiveStateFlag('overlays:C:/a.yml,C:/b.yml', { profileName: 'p', origin: 'CLI' });
    assert.equal(ob.ok, true); assert.deepEqual(ob.attestation.overlays, ['C:/a.yml', 'C:/b.yml']);
    for (const bad of ['', 'NOT-RUNNING', 'overlays:', 'overlays:relative.yml', 'overlays:C:/a.yml,,C:/b.yml', 'unknown-mode', 'not-running '] ) {
      const r = parseLiveStateFlag(bad, { profileName: 'p', origin: 'CLI' });
      assert.equal(r.ok, false, JSON.stringify(bad));
    }
  });
  it('T: origin distinguished CLI/UI without weakening admission', () => {
    const c = createLiveAttestation({ profileName: 'p', mode: 'NOT_RUNNING', origin: 'CLI', acknowledged: true });
    const u = createLiveAttestation({ profileName: 'p', mode: 'NOT_RUNNING', origin: 'UI', acknowledged: true });
    assert.equal(c.ok, true); assert.equal(u.ok, true);
    assert.equal(c.attestation.origin, 'CLI'); assert.equal(u.attestation.origin, 'UI');
    assert.equal(isAdmittedProductionAttestation(c.attestation, { profileName: 'p', declaredOverlays: [] }).ok, true);
    assert.equal(isAdmittedProductionAttestation(u.attestation, { profileName: 'p', declaredOverlays: [] }).ok, true);
    assert.equal(createLiveAttestation({ profileName: 'p', mode: 'NOT_RUNNING', origin: 'HOST', acknowledged: true }).ok, false);
  });
  it('T: acknowledgment time stable + recorded; malformed time refuses', () => {
    const t0 = new Date().toISOString();
    const r = createLiveAttestation({ profileName: 'p', mode: 'NOT_RUNNING', origin: 'CLI', acknowledged: true, acknowledgedAt: t0 });
    assert.equal(r.ok, true); assert.equal(r.attestation.acknowledgedAt, t0);
    assert.equal(createLiveAttestation({ profileName: 'p', mode: 'NOT_RUNNING', origin: 'CLI', acknowledged: true, acknowledgedAt: 'not-a-time' }).ok, false);
    const gen = createLiveAttestation({ profileName: 'p', mode: 'NOT_RUNNING', origin: 'CLI', acknowledged: true });
    assert.equal(gen.ok, true); assert.ok(!Number.isNaN(Date.parse(gen.attestation.acknowledgedAt)));
  });
  it('T: no third mode may be invented', () => {
    assert.equal(createLiveAttestation({ profileName: 'p', mode: 'MAYBE', overlays: [], origin: 'CLI', acknowledged: true }).ok, false);
    assert.equal(createLiveAttestation({ profileName: 'p', mode: '', overlays: [], origin: 'CLI', acknowledged: true }).ok, false);
  });
});
