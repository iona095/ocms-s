window.__ModuleLoader__.load({ id: "ocms-s", factory: (require) => {
var module = { exports: {} };
var exports = module.exports;
var React = require("react");
// OCMS-S v1.4 — DSH client half source (contract v1.4 sections 9, 10, 26,
// 49-58). Two faces:
//   - makeModelsView(h, api): the pure, hook-free Models view — unit-tested in
//     Node with a plain element factory; renders one state payload and never
//     issues lifecycle calls on its own.
//   - createOcmsClient({ createElement, useState, useEffect }): the DSH
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

// The Models tab renders its own release version so an operator can confirm
// which build is actually loaded. This is a literal, not an import: dsh/client.mjs
// must stay import-free (dsh/build-client.mjs enforces it), so package.json
// remains the release single source of truth and
// tests/v1.4/client-view.test.mjs pins the two together as a drift guard.
const PLUGIN_VERSION = '1.4.7-rc8';

const STATES = Object.freeze(['OFFLINE', 'STARTING', 'ONLINE', 'STOPPING', 'EXTERNAL', 'ERROR']);

function normalizeStatus(value) {
  if (!value || typeof value !== 'object' || !STATES.includes(value.state)) {
    return { state: 'OFFLINE' };
  }
  const safe = { state: value.state };
  if (typeof value.port === 'number') safe.port = value.port;
  // K3: a string prefix check accepts userinfo-smuggled URLs such as
  // 'http://127.0.0.1:@evil.example/'. Parse and compare the origin, and
  // reject any credentials; an untrusted url is dropped (no iframe).
  if (typeof value.url === 'string' && value.url.startsWith('http://127.0.0.1:')) {
    try {
      const parsed = new URL(value.url);
      if (parsed.protocol === 'http:' && parsed.hostname === '127.0.0.1' && parsed.port !== '' && !parsed.username && !parsed.password) {
        safe.url = value.url;
      }
    } catch { /* unparseable url is dropped */ }
  }
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
      h('div', { style: { fontSize: '11px', opacity: 0.6, marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' } },
        'v' + PLUGIN_VERSION),
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
      // K1: never an empty action bar — Refresh (disabled while STARTING)
      // stays visible so the operator can re-poll without remounting.
      children.push(h('div', { style: { display: 'flex', gap: '8px', padding: '8px 14px' } }, refreshButton));
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

// Strict, dependency-free wire codecs: DSH 0.2.1-alpha.2 mount admission
// requires codec.mode 'strict' with a create() schema factory returning a
// parse(value) schema. Hand-rolled structural validators keep the browser
// bundle free of extra module requests.
// Mounted Remote methods resolve to the connection outcome wrapper
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

const originSchema = Object.freeze({
  parse(value) {
    const origin = requireString(value, 200);
    if (!/^https?:\/\/(127\.0\.0\.1|localhost):\d{1,5}$/.test(origin)) {
      throw new TypeError('embedOrigin must be an exact loopback origin');
    }
    return origin;
  },
});

const originCodec = Object.freeze({
  mode: 'strict',
  typeSymbol: 'ocms-s#embedOrigin',
  create() {
    return originSchema;
  },
});

const statusSchema = Object.freeze({
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
});

const statusCodec = Object.freeze({
  mode: 'strict',
  typeSymbol: 'ocms-s#LifecycleStatus',
  create() {
    return statusSchema;
  },
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

// The DSH plugin face. react arrives through the ModuleLoader factory
// require (implicit external seed word); nothing else is requested.
function createOcmsClient({ createElement: h, useState, useEffect, useRef }) {
  const PureView = makeModelsView(h, null);

  function OcmsModels(props) {
    const statusState = useState(null);
    const status = statusState[0];
    const setStatus = statusState[1];
    const lifecycle = props.lifecycle;
    // K2: sequence guard — concurrent face operations each take a number; only
    // the latest started operation may write status. A slow refresh that
    // settles after a fresh Stop is dropped instead of resurrecting ONLINE
    // with an iframe on a dead port.
    // K7: the generation must survive re-renders — K2 kept it in the render
    // closure, which React re-executes from zero. A host-provided useRef
    // persists it across renders; without one the render-local counter keeps
    // mount-scope ordering only.
    const seqRef = typeof useRef === 'function' ? useRef(0) : null;
    let seq = 0;
    const take = () => {
      if (seqRef !== null) { seqRef.current += 1; return seqRef.current; }
      seq += 1;
      return seq;
    };
    const current = (my) => (seqRef !== null ? my === seqRef.current : my === seq);
    useEffect(() => {
      let alive = true;
      const my = take();
      Promise.resolve(lifecycle.refresh && lifecycle.refresh())
        .then((s) => { if (alive && current(my)) setStatus(normalizeStatus(s)); })
        .catch((err) => {
          if (alive && current(my)) setStatus({ state: 'ERROR', message: err && typeof err.message === 'string' ? err.message : 'status refresh failed' });
        });
      return function () { alive = false; };
    }, [lifecycle]);
    const face = {
      refresh: async function () {
        const my = take();
        const s = normalizeStatus(await lifecycle.refresh());
        if (current(my)) setStatus(s);
        return s;
      },
      start: async function () {
        const my = take();
        try {
          const s = normalizeStatus(await lifecycle.start());
          if (current(my)) setStatus(s);
        } catch (err) {
          if (!current(my)) return;
          // K1: a busy/port-in-use rejection describes current server state,
          // not a client failure — refresh it instead of showing ERROR.
          const code = err && typeof err.code === 'string' ? err.code : null;
          if (code === 'ocms/busy' || code === 'ocms/port-in-use') {
            try { if (current(my)) setStatus(normalizeStatus(await lifecycle.refresh())); return; } catch { /* fall through to ERROR */ }
          }
          if (current(my)) setStatus({ state: 'ERROR', message: err && typeof err.message === 'string' ? err.message : undefined });
        }
      },
      stop: async function () {
        const my = take();
        try {
          const s = normalizeStatus(await lifecycle.stop());
          if (current(my)) setStatus(s);
        } catch (err) {
          if (!current(my)) return;
          // K1: Stop shows ERROR like Start does; the refresh attempt stays
          // as a fallback, but its failure must not swallow the Stop failure.
          try { if (current(my)) setStatus(normalizeStatus(await lifecycle.refresh())); } catch (ignored) {
            if (current(my)) setStatus({ state: 'ERROR', message: err && typeof err.message === 'string' ? err.message : 'stop failed' });
          }
        }
      },
    };
    return PureView(Object.assign({}, props, { status: status || props.status, lifecycle: face }));
  }

  const inject = ['slots', 'remote'];

  async function apply(ctx) {
    // Fail loud on a DSH client ABI we do not recognize (contract section 34).
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
    // K5: the inject/register handles were dropped on the floor, so disposal
    // released only the remote mount and leaked the slot registration.
    const slotDisposers = [];
    const disposeInject = ctx.slots.inject('conversation.view', function () {
      const unregister = ctx.slots.register({
        name: 'conversation.view',
        id: VIEW_META.id,
        order: VIEW_META.order,
        label: VIEW_META.label,
      }, function (props) { return h(OcmsModels, Object.assign({}, props, { lifecycle: lifecycleFace })); });
      if (typeof unregister === 'function') slotDisposers.push(unregister);
      return unregister;
    });
    return function () {
      for (const disposeSlot of slotDisposers.splice(0)) {
        try { disposeSlot(); } catch { /* best effort */ }
      }
      if (typeof disposeInject === 'function') {
        try { disposeInject(); } catch { /* best effort */ }
      }
      return disposeRemote();
    };
  }

  return { inject, apply };
}
var ocmsClient = createOcmsClient({ createElement: React.createElement, useState: React.useState, useEffect: React.useEffect, useRef: React.useRef });
module.exports = { inject: ocmsClient.inject, apply: ocmsClient.apply };
return module.exports;
} });
