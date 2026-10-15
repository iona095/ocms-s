// T1: the embed comparison must not simply skip the Date header (that was
// 97611d2's exemption, which narrowed an existing assertion). It must instead
// require both Date values to be VALID HTTP dates that agree within a small
// tolerance, while every other header is still compared byte-for-byte.
//
// The comparison rule lives in tests/support/embed-header-comparison.mjs so it
// is provable here, including the negative controls.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { assertHeadersEquivalent } from '../support/embed-header-comparison.mjs';

// Monotonic clock stand-in: two sequential responses a second apart are fine.
const T0 = Date.parse('Thu, 15 Oct 2026 10:15:52 GMT');
const dateAt = (ms) => new Date(ms).toUTCString();

describe('T1 — embed header comparison with a Date tolerance', () => {
  it('POSITIVE CONTROL: identical non-date headers pass', () => {
    assertHeadersEquivalent(
      { 'content-length': '12', 'x-custom': 'v' },
      { 'content-length': '12', 'x-custom': 'v' },
      { toleranceMs: 5000 },
    );
  });

  it('POSITIVE CONTROL: two Date values inside the tolerance pass', () => {
    assertHeadersEquivalent(
      { date: dateAt(T0), 'content-length': '12' },
      { date: dateAt(T0 + 1000), 'content-length': '12' },
      { toleranceMs: 5000 },
    );
  });

  it('TOLERANCE IS BOUNDED: a Date beyond the tolerance fails', () => {
    assert.throws(
      () => assertHeadersEquivalent(
        { date: dateAt(T0), 'content-length': '12' },
        { date: dateAt(T0 + 60000), 'content-length': '12' },
        { toleranceMs: 5000 },
      ),
      /date/i,
      'a Date a minute apart must fail a 5s tolerance',
    );
  });

  it('TOLERANCE IS BOUNDED: an unparsable Date fails', () => {
    for (const bad of ['', 'not-a-date', '0']) {
      assert.throws(
        () => assertHeadersEquivalent({ date: bad }, { date: dateAt(T0) }, { toleranceMs: 5000 }),
        /date/i,
        JSON.stringify(bad) + ' is not a valid HTTP date and must fail',
      );
    }
  });

  it('NEGATIVE CONTROL: a differing framing header still fails', () => {
    assert.throws(
      () => assertHeadersEquivalent(
        { 'content-security-policy': "default-src 'self'", 'x-frame-options': 'DENY' },
        { 'content-security-policy': "default-src 'self'", 'x-frame-options': 'SAMEORIGIN' },
        { toleranceMs: 5000 },
      ),
      /x-frame-options/,
      'the framing header difference must still be caught',
    );
  });

  it('NEGATIVE CONTROL: an added or removed non-date header still fails', () => {
    assert.throws(
      () => assertHeadersEquivalent({ 'x-a': '1' }, { 'x-a': '1', 'x-b': '2' }, { toleranceMs: 5000 }),
      /x-b/,
    );
    assert.throws(
      () => assertHeadersEquivalent({ 'x-a': '1', 'x-b': '2' }, { 'x-a': '1' }, { toleranceMs: 5000 }),
      /x-b/,
    );
  });

  it('a header present on only one side is named in the failure', () => {
    let message = '';
    try {
      assertHeadersEquivalent({ 'x-only': '1' }, {}, { toleranceMs: 5000 });
    } catch (err) {
      message = String((err && err.message) || err);
    }
    assert.match(message, /x-only/, 'the failing header is named, got: ' + message);
  });

  it('date is compared even when only one side carries it', () => {
    assert.throws(
      () => assertHeadersEquivalent({ date: dateAt(T0) }, {}, { toleranceMs: 5000 }),
      /date/i,
      'a Date on one side only is a difference',
    );
  });
});
