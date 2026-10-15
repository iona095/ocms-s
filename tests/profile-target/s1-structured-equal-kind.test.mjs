// S1 (F5, DeepSeek): structured equality must compare KIND before value.
// The comparison fell through to Object.keys() whenever the left side was an
// object, so structuredEqual({}, "") was true and a stored attestation of {}
// compared EQUAL to a freshly read "" — a drifted identity passing sameTarget.
// Exercised through the public sameTarget surface; pure, no filesystem.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sameTarget } from '../../profile/target-resolver.mjs';

function target(extra) {
  return {
    profileName: 'scratch1',
    pluginEntryName: '@fixture/dsh-llm-fixture',
    classification: 'SCRATCH',
    patchDigest: 'a'.repeat(64),
    profileDirReal: '/tmp/ocms-s1/profiles/scratch1',
    patchPathReal: '/tmp/ocms-s1/profiles/scratch1/package.json',
    dshHomeReal: '/tmp/ocms-s1/.dsh',
    declaredOverlays: [],
    liveAttestation: {},
    ...(extra || {}),
  };
}

describe('S1 — structured equality compares kind before value', () => {
  it('CONTROL: identical attestations are equal, and any real difference is not', () => {
    assert.equal(sameTarget(target(), target()), true, 'unchanged identity is equal');
    assert.equal(sameTarget(target({ liveAttestation: { a: 1 } }), target()), false, 'a real difference is not equal');
    assert.equal(sameTarget(target({ declaredOverlays: ['x'] }), target()), false, 'overlay list difference is not equal');
  });

  it('DEFECT: an object attestation never equals a scalar one', () => {
    for (const scalar of ['', 'x', 0, 1, false, true]) {
      assert.equal(
        sameTarget(target({ liveAttestation: {} }), target({ liveAttestation: scalar })),
        false,
        'an empty-object attestation must not equal the scalar ' + JSON.stringify(scalar),
      );
    }
  });

  it('DEFECT: a scalar attestation never equals an object one', () => {
    assert.equal(
      sameTarget(target({ liveAttestation: '' }), target({ liveAttestation: {} })),
      false,
      'a scalar attestation must not equal an empty object',
    );
  });

  it('DEFECT: an array never equals an object or a scalar', () => {
    for (const other of [{}, '', 0]) {
      assert.equal(
        sameTarget(target({ liveAttestation: [] }), target({ liveAttestation: other })),
        false,
        'an array attestation must not equal ' + JSON.stringify(other),
      );
    }
  });

  it('DEFECT: nested kind differences are caught too', () => {
    assert.equal(sameTarget(target({ liveAttestation: { a: {} } }), target({ liveAttestation: { a: '' } })), false);
    assert.equal(sameTarget(target({ liveAttestation: { a: [] } }), target({ liveAttestation: { a: {} } })), false);
    assert.equal(sameTarget(target({ liveAttestation: { a: 1 } }), target({ liveAttestation: { a: '1' } })), false);
  });

  it('an empty object still equals an empty object', () => {
    assert.equal(sameTarget(target({ liveAttestation: {} }), target({ liveAttestation: {} })), true);
    assert.equal(sameTarget(target({ declaredOverlays: [] }), target({ declaredOverlays: [] })), true);
  });
});
