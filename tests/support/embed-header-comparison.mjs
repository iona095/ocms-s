// T1: header equivalence for the embed comparison.
//
// The Date header legitimately advances between two sequential HTTP responses,
// so comparing it byte-for-byte is flaky. Excluding it entirely (commit
// 97611d2) fixed the flake by weakening the assertion. This rule keeps the
// comparison: both Date values must be valid HTTP dates that agree within an
// explicit tolerance, and every other header must match exactly.
//
// Throws with the offending header named; returns nothing on success.
export const DEFAULT_DATE_TOLERANCE_MS = 5000;

export function assertHeadersEquivalent(a, b, { toleranceMs = DEFAULT_DATE_TOLERANCE_MS } = {}) {
  const names = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const name of [...names].sort()) {
    const left = Object.hasOwn(a, name) ? a[name] : undefined;
    const right = Object.hasOwn(b, name) ? b[name] : undefined;
    if (Object.hasOwn(a, name) && Object.hasOwn(b, name) && left === right) continue;

    if (name.toLowerCase() === 'date') {
      assertDatesWithinTolerance(left, right, toleranceMs);
      continue;
    }
    throw new Error(
      'header ' + name + ' must not change between standalone and embed mode (' +
      String(left) + ' -> ' + String(right) + ')',
    );
  }
}

function assertDatesWithinTolerance(left, right, toleranceMs) {
  if (left === undefined || right === undefined) {
    throw new Error(
      'header date must appear on both responses (got ' +
      (left === undefined ? 'absent on the first' : 'absent on the second') + ')',
    );
  }
  const a = Date.parse(String(left));
  const b = Date.parse(String(right));
  if (Number.isNaN(a)) throw new Error('header date is not a valid HTTP date on the first response: ' + JSON.stringify(left));
  if (Number.isNaN(b)) throw new Error('header date is not a valid HTTP date on the second response: ' + JSON.stringify(right));
  const delta = Math.abs(a - b);
  if (delta > toleranceMs) {
    throw new Error(
      'header date must agree within ' + toleranceMs + 'ms between standalone and embed mode, got ' +
      delta + 'ms (' + left + ' -> ' + right + ')',
    );
  }
}
