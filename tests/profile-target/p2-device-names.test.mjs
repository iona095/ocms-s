// P2 (report C15; GLM L16): a Windows reserved device name must be refused even
// when the reserved word is only the FIRST dot-separated segment. The existing
// check stripped only the LAST extension, so con.x.y, nul.a.b and com1.a.b
// slipped through. Pure function: no filesystem, no host dependency.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateProfileName } from '../../profile/target-resolver.mjs';

const RESERVED_STEMS = [
  'con', 'prn', 'aux', 'nul',
  'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9',
];

describe('P2 — Windows reserved device names as a profile name', () => {
  it('refuses a reserved stem followed by one extension (control)', () => {
    for (const stem of RESERVED_STEMS) {
      const name = stem + '.txt';
      const res = validateProfileName(name);
      assert.equal(res.code, 'INVALID_PROFILE_NAME', stem + '.txt must be refused');
    }
  });

  it('refuses a reserved stem followed by TWO or more extensions (the defect)', () => {
    for (const stem of RESERVED_STEMS) {
      for (const name of [stem + '.x.y', stem + '.a.b', stem + '.v1.json']) {
        const res = validateProfileName(name);
        assert.equal(
          res.code,
          'INVALID_PROFILE_NAME',
          name + ' must be refused: the reserved stem is the part before the FIRST dot',
        );
      }
    }
  });

  it('refuses the reserved stem in any case, with a trailing dot or space', () => {
    for (const name of ['CON.x.y', 'Nul.a.b', 'CoM1.a.b', 'con.x.', 'con.x ']) {
      const res = validateProfileName(name);
      assert.equal(res.code, 'INVALID_PROFILE_NAME', name + ' must be refused');
    }
  });

  it('still admits ordinary names that merely start with similar text', () => {
    for (const name of ['console', 'com0', 'lpt0', 'com10', 'null', 'auxiliary', 'candy', 'profile1', 'web.v2']) {
      const res = validateProfileName(name);
      assert.equal(res.ok, true, name + ' must stay admissible, got: ' + res.code);
    }
  });

  it('a dotted name whose first segment is not reserved is admitted', () => {
    for (const name of ['web.prod', 'scratch.local', 'a.b.c']) {
      const res = validateProfileName(name);
      assert.equal(res.ok, true, name + ' must stay admissible, got: ' + res.code);
    }
  });
});
