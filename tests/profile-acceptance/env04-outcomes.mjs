// ENV04-R1 loader outcome contract (P2-1).
//
// Pure helpers with no test-runner import and no side effects, so the
// classification contract is pinnable by host-runnable unit tests without the
// guest harness. The guest fiber test imports these instead of carrying its
// own copies.
const SIX = [
  'opencode-go',
  'opencode-go-messages',
  'opencode-go-responses',
  'opencode-completions',
  'opencode-messages',
  'opencode',
];

export function env04SixRoutes() {
  return [...SIX];
}

// 1 = file/native agreement on a valid case, 2 = agreement on a rejection,
// 3 = native rejects what the file side tolerates, 0 = unclassified.
export function env04Classify(fileOutcome, nativeOutcome) {
  const f = fileOutcome;
  const n = nativeOutcome;
  if (f === 'ok' && n === 'accepted') return 1;
  if ((f === 'SETTINGS_INVALID' || f === 'commit-refuses') && n === 'rejected') return 2;
  if ((f === 'ok' || f === 'ok-gap') && n === 'rejected') return 3;
  return 0;
}

export function env04NormalizeFile(raw) {
  let fn = raw;
  if (typeof fn === 'string' && fn.startsWith('ok:')) fn = 'ok';
  if (fn === 'commit-refuses-deep') fn = 'commit-refuses';
  return fn;
}

export function env04NormalizeNative(raw) {
  if (raw === 'accepted-deps-missing') return 'accepted';
  return raw;
}

export function env04FileRejects(normalizedFile) {
  return normalizedFile !== 'ok' && normalizedFile !== 'ok-gap';
}

// Outcomes that must fail the test loudly instead of being recorded with an
// unclassified 0: file-side rejection against native acceptance, and native
// harness/timeout failures. Returns a reason string, or null when the outcome
// may proceed to classification.
export function env04MustFail(normalizedFile, normalizedNative) {
  if (normalizedNative === 'failed-harness' || normalizedNative === 'failed-timeout') {
    return 'native-' + normalizedNative;
  }
  if (normalizedNative === 'accepted' && env04FileRejects(normalizedFile)) {
    return 'file-rejects-native-accepts';
  }
  return null;
}

// exp: the classification the designed file/native pair must produce.
// The gap case documents a real divergence: the file side tolerates a bad api
// literal (ok-gap) while the native plugin is expected to reject it.
export function env04Corpus() {
  const blank = {};
  for (const r of SIX) blank[r] = { displayName: r, models: [] };
  const withProviders = (providers) => ({ providers });
  return [
    { name: 'valid-six-route', ...withProviders({ ...blank }), fileExp: 'ok', exp: 1 },
    { name: 'valid-with-unrelated', ...withProviders({ ...blank, other: { displayName: 'other', models: [] } }), fileExp: 'ok', exp: 1 },
    { name: 'invalid-providers-mapping', ...withProviders('bad'), fileExp: 'SETTINGS_INVALID', exp: 2 },
    { name: 'invalid-route-mapping', ...withProviders({ 'opencode-go': 'bad' }), fileExp: 'SETTINGS_INVALID', exp: 2 },
    { name: 'invalid-models-type', ...withProviders({ 'opencode-go': { displayName: 'opencode-go', models: 'bad' } }), fileExp: 'SETTINGS_INVALID', exp: 2 },
    { name: 'invalid-model-prop-type', ...withProviders({ 'opencode-go': { displayName: 'opencode-go', models: [{ id: 123 }] } }), fileExp: 'commit-refuses', exp: 2 },
    { name: 'gap-bad-api-literal', ...withProviders({ 'opencode-go': { displayName: 'opencode-go', api: 'bad-api-literal', models: [] } }), fileExp: 'ok-gap', exp: 3 },
  ];
}
