window.__ModuleLoader__.load({ id: "ocms-s", factory: (require) => {
var module = { exports: {} };
var exports = module.exports;
var React = require("react");
// OCMS-S v1.4 — DSH client half source (contract v1.4 sections 9, 10, 26,
// 49-58). Two faces:
//   - makeModelsView(h, api): the pure, hook-free Models view — unit-tested in
//     Node with a plain element factory; renders one state payload and never
//     issues lifecycle calls on its own.
//   - createOcmsClient({ createElement, useState, useEffect }): the rc.2
//     plugin face — mounts the typed Remote contribution (ctx.remote.$mount)
//     and registers the Models tab into the conversation.view slot.
// The DSH chrome never surfaces settings paths, planner controls, or Preview/
// Apply surfaces: those live inside the embedded OCMS page only (contract 31).
const VIEW_META = Object.freeze({
  slot: 'conversation.view',
  id: 'models',
  label: 'Models',
  order: 30,
});

const STATES = Object.freeze(['OFFLINE', 'STARTING', 'ONLINE', 'STOPPING', 'EXTERNAL', 'ERROR']);

function normalizeStatus(value) {
  if (!value || typeof value !== 'object' || !STATES.includes(value.state)) {
    return { state: 'OFFLINE' };
  }
  const safe = { state: value.state };
  if (typeof value.port === 'number') safe.port = value.port;
  if (typeof value.url === 'string' && value.url.startsWith('http://127.0.0.1:')) safe.url = value.url;
  if (typeof value.message === 'string') {
    const firstLine = safeErrorMessage(value.message);
    if (firstLine !== null) safe.message = firstLine;
  }
  return safe;
}

// Contract 57: never render a full Host stack. Only a short, single-line,
// stack-free message is eligible for display; anything else is dropped.
function safeErrorMessage(message) {
  if (typeof message !== 'string') return null;
  const firstLine = message.split('\n')[0].trim();
  if (firstLine.length === 0 || firstLine.length > 200) return null;
  if (/at .*:\d+|^\s*at\b/i.test(firstLine)) return null;
  return firstLine;
}

function makeModelsView(h, api) {
  return function OcmsModelsView(props = {}) {
    const status = normalizeStatus(props.status ?? null);
    const lifecycle = props.lifecycle ?? api ?? {};
    const state = status.state;

    const children = [];
    children.push(h('div', { style: { display: 'flex', alignItems: 'baseline', gap: '10px', padding: '8px 14px 0' } },
      h('div', { style: { fontSize: '16px', fontWeight: 600 } }, 'OCMS-S'),
      h('div', { style: { fontSize: '12px', opacity: 0.7 } }, 'OpenCode Model Sync'),
    ));

    if (state === 'EXTERNAL') {
      children.push(h('div', { style: { padding: '4px 14px', fontSize: '13px', color: '#a4550f' } },
        status.message ?? ('Port ' + String(status.port ?? '') + ' is already in use by a process not owned by this DSH instance.')));
    } else if (state === 'ERROR') {
      children.push(h('div', { style: { padding: '4px 14px', fontSize: '13px', color: '#b3261e' } },
        'OCMS-S failed.',
        status.message ? h('div', { style: { fontSize: '12px', opacity: 0.8 } }, status.message) : null));
    } else {
      const labels = {
        OFFLINE: 'SERVER OFFLINE',
        STARTING: 'SERVER STARTING',
        ONLINE: 'ONLINE',
        STOPPING: 'SERVER STOPPING',
      };
      children.push(h('div', { style: { padding: '4px 14px', fontSize: '13px', letterSpacing: '0.04em' } }, labels[state]));
    }

    if (state === 'ONLINE' && typeof status.url === 'string') {
      children.push(h('iframe', {
        title: 'OCMS-S Models',
        src: status.url,
        referrerPolicy: 'no-referrer',
        sandbox: 'allow-scripts allow-same-origin',
        style: { flex: '1', width: '100%', border: '1px solid rgba(128,128,128,0.4)', borderRadius: '8px', minHeight: '300px' },
      }));
    }

    const buttonStyle = { padding: '6px 14px', borderRadius: '8px', border: '1px solid rgba(128,128,128,0.5)', cursor: 'pointer', background: 'transparent', color: 'inherit' };
    const startButton = h('button', {
      type: 'button',
      disabled: state === 'STARTING' || state === 'STOPPING' || state === 'ONLINE',
      style: buttonStyle,
      onClick: () => { void Promise.resolve(lifecycle.start && lifecycle.start()).catch(() => {}); },
    }, 'Start Server');
    const stopButton = h('button', {
      type: 'button',
      disabled: state === 'STOPPING',
      style: buttonStyle,
      onClick: () => { void Promise.resolve(lifecycle.stop && lifecycle.stop()).catch(() => {}); },
    }, 'Stop Server');
    const refreshButton = h('button', {
      type: 'button',
      disabled: state === 'STARTING' || state === 'STOPPING',
      style: buttonStyle,
      onClick: () => { void Promise.resolve(lifecycle.refresh && lifecycle.refresh()).catch(() => {}); },
    }, 'Refresh Status');

    const actions = h('div', { style: { display: 'flex', gap: '8px', padding: '8px 14px' } });
    if (state === 'OFFLINE' || state === 'ERROR') {
      children.push(h('div', { style: { display: 'flex', gap: '8px', padding: '8px 14px' } }, startButton, refreshButton));
    } else if (state === 'STARTING') {
      children.push(actions);
    } else if (state === 'ONLINE') {
      children.push(h('div', { style: { display: 'flex', gap: '8px', padding: '8px 14px' } }, stopButton, refreshButton));
    } else if (state === 'STOPPING') {
      children.push(h('div', { style: { display: 'flex', gap: '8px', padding: '8px 14px' } }, stopButton, refreshButton));
    } else if (state === 'EXTERNAL') {
      children.push(h('div', { style: { display: 'flex', gap: '8px', padding: '8px 14px' } }, refreshButton));
    }

    return h('div', { style: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: '0' } }, children);
  };
}

// Strict, dependency-free wire codecs: rc.2 $mount requires codec.mode
// 'strict' with a parse(value) schema. Hand-rolled structural validators keep
// the browser bundle free of extra module requests.
// rc.2 mounted Remote methods resolve to the connection outcome wrapper
// { ok: true, value } | { ok: false, error } — the generated clients unwrap
// it; a hand-built face must do the same.
function unwrapOutcome(outcome, fallbackMessage) {
  if (outcome && typeof outcome === 'object' && 'ok' in outcome) {
    if (outcome.ok === true) return outcome.value;
    const wireError = outcome.error;
    const failure = new Error(wireError && typeof wireError.message === 'string' ? wireError.message : fallbackMessage);
    if (wireError && typeof wireError.code === 'string') failure.code = wireError.code;
    throw failure;
  }
  return outcome;
}

function requireString(value, max) {
  if (typeof value !== 'string' || value.length === 0 || value.length > (max || 256)) {
    throw new TypeError('expected a short string');
  }
  return value;
}

const originCodec = Object.freeze({
  mode: 'strict',
  typeSymbol: 'ocms-s#embedOrigin',
  schema: Object.freeze({
    parse(value) {
      const origin = requireString(value, 200);
      if (!/^https?:\/\/(127\.0\.0\.1|localhost):\d{1,5}$/.test(origin)) {
        throw new TypeError('embedOrigin must be an exact loopback origin');
      }
      return origin;
    },
  }),
});

const statusCodec = Object.freeze({
  mode: 'strict',
  typeSymbol: 'ocms-s#LifecycleStatus',
  schema: Object.freeze({
    parse(value) {
      if (!value || typeof value !== 'object') throw new TypeError('expected a LifecycleStatus object');
      if (!STATES.includes(value.state)) throw new TypeError('unknown lifecycle state');
      const out = { state: value.state };
      if (value.port !== undefined) {
        if (typeof value.port !== 'number') throw new TypeError('port must be a number');
        out.port = value.port;
      }
      const keys = ['url', 'message', 'embedOrigin'];
      for (const key of keys) {
        if (value[key] !== undefined) out[key] = requireString(value[key], 512);
      }
      return out;
    },
  }),
});

const OCMS_REMOTE_CONTRIBUTION = Object.freeze({
  package: 'ocms-s',
  descriptors: Object.freeze([
    Object.freeze({
      id: 'ocms-s#ocms/status',
      service: 'ocmsLifecycleService',
      namespace: 'ocms',
      method: 'status',
      invocation: Object.freeze({ kind: 'direct' }),
      parameters: Object.freeze([]),
      result: statusCodec,
    }),
    Object.freeze({
      id: 'ocms-s#ocms/start',
      service: 'ocmsLifecycleService',
      namespace: 'ocms',
      method: 'start',
      invocation: Object.freeze({ kind: 'direct' }),
      parameters: Object.freeze([
        Object.freeze({ name: 'embedOrigin', wire: 'embedOrigin', source: 'json', codec: originCodec }),
      ]),
      result: statusCodec,
    }),
    Object.freeze({
      id: 'ocms-s#ocms/stop',
      service: 'ocmsLifecycleService',
      namespace: 'ocms',
      method: 'stop',
      invocation: Object.freeze({ kind: 'direct' }),
      parameters: Object.freeze([]),
      result: statusCodec,
    }),
  ]),
});

// The rc.2 plugin face. react arrives through the ModuleLoader factory
// require (baseline implicit external); nothing else is requested.
function createOcmsClient({ createElement: h, useState, useEffect }) {
  const PureView = makeModelsView(h, null);

  function OcmsModels(props) {
    const statusState = useState(null);
    const status = statusState[0];
    const setStatus = statusState[1];
    const lifecycle = props.lifecycle;
    useEffect(() => {
      let alive = true;
      Promise.resolve(lifecycle.refresh && lifecycle.refresh())
        .then((s) => { if (alive) setStatus(normalizeStatus(s)); })
        .catch((err) => {
          if (alive) setStatus({ state: 'ERROR', message: err && typeof err.message === 'string' ? err.message : 'status refresh failed' });
        });
      return function () { alive = false; };
    }, [lifecycle]);
    const face = {
      refresh: async function () {
        const s = normalizeStatus(await lifecycle.refresh());
        setStatus(s);
        return s;
      },
      start: async function () {
        try {
          const s = normalizeStatus(await lifecycle.start());
          setStatus(s);
        } catch (err) {
          setStatus({ state: 'ERROR', message: err && typeof err.message === 'string' ? err.message : undefined });
        }
      },
      stop: async function () {
        try {
          const s = normalizeStatus(await lifecycle.stop());
          setStatus(s);
        } catch (err) {
          try { setStatus(normalizeStatus(await lifecycle.refresh())); } catch (ignored) { /* keep last status */ }
        }
      },
    };
    return PureView(Object.assign({}, props, { status: status || props.status, lifecycle: face }));
  }

  const inject = ['slots', 'remote'];

  async function apply(ctx) {
    // Fail loud on an rc.2 ABI we do not recognize (contract section 34).
    if (!ctx.remote || typeof ctx.remote['$mount'] !== 'function') {
      throw new Error('ocms/incompatible-dsh: the mounted DSH client exposes no typed Remote mount seam');
    }
    const disposeRemote = await ctx.remote['$mount'](OCMS_REMOTE_CONTRIBUTION);
    // The mounted namespace is a runtime-installed service: read it via the
    // strict global store at call time (ctx.get), never through the property
    // proxy, which rejects undeclared reads.
    const remoteNs = () => ctx.get('remote.ocms');
    const lifecycleFace = {
      refresh: async function () { return normalizeStatus(unwrapOutcome(await remoteNs().status(), 'status refresh failed')); },
      start: async function () {
        const origin = String((globalThis.location && globalThis.location.origin) || '');
        return normalizeStatus(unwrapOutcome(await remoteNs().start(origin), 'start failed'));
      },
      stop: async function () { return normalizeStatus(unwrapOutcome(await remoteNs().stop(), 'stop failed')); },
    };
    ctx.slots.inject('conversation.view', function () {
      return ctx.slots.register({
        name: 'conversation.view',
        id: VIEW_META.id,
        order: VIEW_META.order,
        label: VIEW_META.label,
      }, function (props) { return h(OcmsModels, Object.assign({}, props, { lifecycle: lifecycleFace })); });
    });
    return function () { return disposeRemote(); };
  }

  return { inject, apply };
}
var ocmsClient = createOcmsClient({ createElement: React.createElement, useState: React.useState, useEffect: React.useEffect });
module.exports = { inject: ocmsClient.inject, apply: ocmsClient.apply };
return module.exports;
} });
