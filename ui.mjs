// OCMS-S v1.3.0 Stage 3 — loopback UI server / API / retained-preview adapter.
// Owns only: CLI parsing, target selection via shared engine semantics,
// loopback lifecycle, template injection, per-process token, Host/Origin
// validation, routing, body parsing, single retained Preview slot,
// Preview/Apply concurrency guards, engine->API translation, safe errors,
// optional browser open, shutdown. No sync business logic lives here.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { buildPlan, commitPlan, fetchSources, defaultSettingsPath, classifySettingsPath, resolveLegacyBinding, legacyBindingsEqual } from './sync.mjs';
import { isDeepStrictEqual } from 'node:util';
import { buildProfilePreview } from './profile/preview-session.mjs';
import { ProfileAwareCommit } from './profile/commit.mjs';
import { formatAttestationText } from './profile/live-attestation.mjs';
import { resolveProfileTarget, sameTarget } from './profile/target-resolver.mjs';
import { readManagedConfig } from './profile/config-reader.mjs';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const HTML_PATH = path.join(MODULE_DIR, 'ui', 'index.html');
const PACKAGE_PATH = path.join(MODULE_DIR, 'package.json');

const BIND_HOST = '127.0.0.1';
const DEFAULT_PORT = 18751;
const MAX_BODY_BYTES = 1024 * 1024;

// v1.4: the frame-ancestors directive is the ONLY embed-mode variable part of
// the policy. Standalone keeps the byte-identical v1.3 policy; embed mode
// carries exactly one normalized loopback origin (never a wildcard).
function buildCsp(frameAncestors) {
  return (
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline'; " +
    "style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data:; " +
    "font-src 'self'; " +
    "connect-src 'self'; " +
    "object-src 'none'; " +
    "base-uri 'none'; " +
    "frame-ancestors " + frameAncestors + "; " +
    "form-action 'self'"
  );
}

const CSP = buildCsp("'none'");

function readPackageVersion() {
  const raw = fs.readFileSync(PACKAGE_PATH, 'utf8');
  const pkg = JSON.parse(raw);
  if (!pkg || typeof pkg.version !== 'string' || !pkg.version) throw new Error('PACKAGE_VERSION_MISSING');
  return pkg.version;
}

function loadTemplate() {
  const html = fs.readFileSync(HTML_PATH, 'utf8');
  if (!html.includes('__OCMS_TOKEN__') || !html.includes('__OCMS_VERSION__')) {
    throw new Error('HTML_TEMPLATE_PLACEHOLDER_MISSING');
  }
  return html;
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

function sortByGatewayId(items) {
  return [...items].sort((a, b) => {
    if (a.gateway !== b.gateway) return a.gateway < b.gateway ? -1 : 1;
    if (a.id !== b.id) return a.id < b.id ? -1 : 1;
    return 0;
  });
}

function splitKey(key) {
  const s = String(key);
  const i = s.indexOf('/');
  if (i < 0) return { gateway: s, id: '' };
  return { gateway: s.slice(0, i), id: s.slice(i + 1) };
}

function translateChanges(changes) {
  const src = changes || {};
  const added = Array.isArray(src.added) ? src.added.map((e) => {
    const { gateway, id } = splitKey(e.key);
    return { gateway, id, route: e.route };
  }) : [];
  const removed = Array.isArray(src.removed) ? src.removed.map((e) => {
    const { gateway, id } = splitKey(e.key);
    return { gateway, id, route: e.route };
  }) : [];
  const moved = Array.isArray(src.moved) ? src.moved.map((e) => {
    const { gateway, id } = splitKey(e.key);
    return { gateway, id, from: e.from, to: e.to, oldRoute: e.from, newRoute: e.to };
  }) : [];
  const metadataChanged = Array.isArray(src.metadataChanged) ? src.metadataChanged.map((e) => {
    const { gateway, id } = splitKey(e.key);
    return { gateway, id, route: e.route };
  }) : [];
  return { added, removed, moved, metadataChanged };
}

function tokenMatches(provided, expected) {
  try {
    if (typeof provided !== 'string') return false;
    const a = crypto.createHash('sha256').update(provided, 'utf8').digest();
    const b = crypto.createHash('sha256').update(expected, 'utf8').digest();
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function hostAllowed(req, boundPort) {
  try {
    const raw = req.rawHeaders || [];
    let count = 0;
    for (let i = 0; i < raw.length; i += 2) {
      if (String(raw[i]).toLowerCase() === 'host') count += 1;
    }
    if (count !== 1) return false;
    const value = req.headers.host;
    if (typeof value !== 'string') return false;
    const lower = value.toLowerCase();
    return lower === ('127.0.0.1:' + boundPort) || lower === ('localhost:' + boundPort);
  } catch {
    return false;
  }
}

function originAllowed(req, boundPort) {
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  if (typeof origin !== 'string') return false;
  return origin === ('http://127.0.0.1:' + boundPort) || origin === ('http://localhost:' + boundPort);
}

function applySecurityHeaders(res) {
  res.setHeader('content-security-policy', typeof res.ocmsCsp === 'string' ? res.ocmsCsp : CSP);
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('referrer-policy', 'no-referrer');
  res.setHeader('cache-control', 'no-store');
}

function sendJson(res, status, obj) {
  applySecurityHeaders(res);
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(body);
}

function refusal(res, status, code, message) {
  sendJson(res, status, { ok: false, code, message });
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let failed = false;
    req.on('data', (c) => {
      if (failed) return;
      total += c.length;
      if (total > limit) {
        failed = true;
        reject(new Error('BODY_TOO_LARGE'));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (failed) return;
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', (err) => {
      if (!failed) {
        failed = true;
        reject(err);
      }
    });
  });
}

function listBackups(dir) {
  try {
    return fs.readdirSync(dir).filter((n) => n.startsWith('settings.yaml.bak-')).sort();
  } catch {
    return [];
  }
}

function defaultOpenBrowser(url) {
  try {
    if (process.platform === 'win32') {
      const child = spawn('cmd', ['/c', 'start', '""', url], { detached: true, stdio: 'ignore', shell: false });
      if (child && typeof child.unref === 'function') child.unref();
    } else if (process.platform === 'darwin') {
      const child = spawn('open', [url], { detached: true, stdio: 'ignore', shell: false });
      if (child && typeof child.unref === 'function') child.unref();
    } else {
      const child = spawn('xdg-open', [url], { detached: true, stdio: 'ignore', shell: false });
      if (child && typeof child.unref === 'function') child.unref();
    }
  } catch {
    // best effort only
  }
}

function knownSourceError(err) {
  const msg = err && typeof err.message === 'string' ? err.message : String(err);
  return /^(FETCH_FAILED|ROSTER_INVALID|CATALOG_INVALID|DOCS_INVALID|SOURCE_INVALID|SETTINGS_INVALID)/.test(msg) ? msg : null;
}

export async function startServer(options = {}) {
  const { settingsPath, port, fetchFn, openBrowser, embedOrigin } = options;
  // S5 additive: optional server-bound profile defaults. Absent means legacy
  // settings.yaml behavior exactly (T18). Per-request profile fields override.
  const serverProfileName = typeof options.profileName === 'string' && options.profileName.length > 0 ? options.profileName : null;
  // NOTE (S5-R2 B2): there is intentionally no server-default live-state.
  // Attestation is always per-Preview explicit; a startup --live-state flag
  // is accepted for CLI parity but never substituted into a Preview.
  const serverScratchMode = options.scratchMode === true;
  const serverDshHome = options.dshHome !== undefined ? options.dshHome : undefined;
  const serverInstallAnchorDir = options.installAnchorDir !== undefined ? options.installAnchorDir : undefined;
  // S5-R3 B2: explicit legacy admission. Without an explicitly supplied
  // settings path there is no legacy target: the default production
  // settings.yaml is never implicitly bound, Previewed or Applied.
  const explicitLegacySettings = settingsPath !== undefined;
  const resolvedTarget = explicitLegacySettings ? path.resolve(String(settingsPath)) : null;
  const resolvedDefault = path.resolve(defaultSettingsPath());
  const production = resolvedTarget !== null && resolvedTarget.toLowerCase() === resolvedDefault.toLowerCase();
  const displayPath = resolvedTarget;

  let boundPort = port;
  if (boundPort === undefined) boundPort = DEFAULT_PORT;
  if (typeof boundPort !== 'number' || !Number.isInteger(boundPort) || boundPort < 1 || boundPort > 65535) {
    throw new Error('INVALID_PORT');
  }
  const fetchImpl = fetchFn !== undefined ? fetchFn : globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('FETCH_IMPL_MISSING');

  // Embed mode (v1.4): a validated exact parent origin widens only who may
  // frame the page. Standalone stays unframeable (frame-ancestors 'none').
  const serverCsp = embedOrigin !== undefined ? buildCsp(parseEmbedOrigin(embedOrigin)) : CSP;

  const template = loadTemplate();
  const version = readPackageVersion();
  const token = crypto.randomBytes(32).toString('hex');
  const page = template.split('__OCMS_TOKEN__').join(token).split('__OCMS_VERSION__').join(version);

  let activePreview = null;
  let previewBusy = false;
  let applyBusy = false;

  const targetInfo = () => ({ displayPath, production });

  function statePayload() {
    if (serverProfileName === null && !(activePreview && activePreview.kind === 'profile')) {
      return {
        ok: true,
        target: targetInfo(),
        hasPreview: activePreview !== null,
        previewState: activePreview ? activePreview.state : null,
        generatedAt: activePreview ? activePreview.generatedAt : null,
      };
    }
    // S5-R2 B6: minimal unauthenticated state. Detailed profile identity
    // (patch paths, digests) and attestation text stay behind the
    // authenticated Preview/Apply boundary; only the selected name shows.
    const profileView = activePreview && activePreview.kind === 'profile'
      ? { name: activePreview.preview.target.profileName }
      : { name: serverProfileName };
    return {
      ok: true,
      target: targetInfo(),
      hasPreview: activePreview !== null,
      previewState: activePreview ? activePreview.state : null,
      generatedAt: activePreview ? activePreview.generatedAt : null,
      profile: profileView,
    };
  }

  // S5-R2 B2: the operator selection echoed at Apply must cohere with the
  // retained attestation. UNATTESTED previews admit no live-state echo and
  // no acknowledgment; attested previews require the same mode echoed back
  // with an explicit acknowledgment (overlay item lists are compared
  // separately against the retained ordered declared overlays).
  function attestationMatchesSelection(attestation, sel) {
    const s = sel && typeof sel === 'object' ? sel : {};
    if (attestation === null || attestation === undefined) {
      const mode = s.liveState;
      if (mode !== undefined && mode !== null && mode !== 'unattested' && mode !== '') {
        return { ok: false, detail: 'unattested-selection-mismatch' };
      }
      if (s.acknowledged === true) return { ok: false, detail: 'unattested-ack-mismatch' };
      return { ok: true };
    }
    if (attestation.mode === 'NOT_RUNNING') {
      if (s.liveState !== 'not-running') return { ok: false, detail: 'mode-mismatch' };
      if (s.acknowledged !== true) return { ok: false, detail: 'acknowledgment-mismatch' };
      return { ok: true };
    }
    if (attestation.mode === 'EXACT_OVERLAYS') {
      if (typeof s.liveState !== 'string' || !s.liveState.startsWith('overlays:')) {
        return { ok: false, detail: 'mode-mismatch' };
      }
      const items = s.liveState.slice('overlays:'.length).split(',');
      const declared = Array.isArray(s.declaredOverlays) ? s.declaredOverlays : null;
      if (declared === null || items.length !== declared.length) return { ok: false, detail: 'overlay-list-mismatch' };
      for (let i = 0; i < items.length; i++) {
        if (items[i] !== declared[i]) return { ok: false, detail: 'overlay-list-mismatch' };
      }
      if (s.acknowledged !== true) return { ok: false, detail: 'acknowledgment-mismatch' };
      return { ok: true };
    }
    return { ok: false, detail: 'mode-unknown' };
  }

  // S5-R2 B2: server-authoritative Apply admission. Compares the echoed
  // selection against the retained Preview AND against freshly re-resolved
  // disk truth (never a retained duplicate of itself). Any drift refuses
  // STALE_PREVIEW with zero writes and no commit invocation. S4 in-lock
  // validation stays unchanged downstream.
  async function verifyProfileApplySelection(retained, selection) {
    const stale = (detail) => ({
      ok: false, code: 'STALE_PREVIEW',
      message: 'The operator selection changed since Preview; run Refresh Preview to build a new one.',
      detail,
    });
    if (!selection || typeof selection !== 'object' || Array.isArray(selection)) {
      return { ok: false, code: 'BAD_REQUEST', message: 'Malformed selection binding.' };
    }
    const preview = retained.preview;
    const rt = preview.target;
    if (typeof selection.profileName !== 'string' || !Array.isArray(selection.declaredOverlays) || !Object.hasOwn(selection, 'attestation')) {
      return { ok: false, code: 'BAD_REQUEST', message: 'Malformed selection binding.' };
    }
    if (selection.profileName !== rt.profileName) return stale('profileName-mismatch');
    if (selection.declaredOverlays.length !== preview.declaredOverlays.length) return stale('overlays-mismatch');
    for (let i = 0; i < selection.declaredOverlays.length; i++) {
      if (selection.declaredOverlays[i] !== preview.declaredOverlays[i]) return stale('overlays-mismatch');
    }
    let attestEqual = false;
    try {
      attestEqual = isDeepStrictEqual(selection.attestation ?? null, preview.attestation ?? null);
    } catch {
      attestEqual = false;
    }
    if (!attestEqual) return stale('attestation-mismatch');
    const coh = attestationMatchesSelection(preview.attestation, selection);
    if (!coh.ok) return stale(coh.detail);
    const resolutionHome = path.dirname(path.dirname(rt.profileDirReal));
    let fresh = null;
    try {
      fresh = resolveProfileTarget({
        profileName: selection.profileName,
        dshHome: resolutionHome,
        declaredOverlays: [...selection.declaredOverlays],
        liveAttestation: selection.attestation === null ? null : structuredClone(selection.attestation),
        installAnchorDir: serverInstallAnchorDir !== undefined ? serverInstallAnchorDir : null,
        pathEnv: process.env.PATH ?? '',
      });
    } catch {
      return stale('reresolve-threw');
    }
    if (!fresh || fresh.ok !== true) return stale('reresolve-refused:' + ((fresh && fresh.code) || 'unknown'));
    let identical = false;
    try {
      identical = sameTarget(fresh.target, rt);
    } catch {
      identical = false;
    }
    if (!identical) return stale('target-mismatch');
    let reader = null;
    try {
      reader = await readManagedConfig({
        target: structuredClone(fresh.target),
        installAnchorDir: serverInstallAnchorDir !== undefined ? serverInstallAnchorDir : null,
        pathEnv: process.env.PATH ?? '',
      });
    } catch {
      return stale('reader-threw');
    }
    if (!reader || reader.ok !== true) return stale('reader-refused:' + ((reader && reader.code) || 'unknown'));
    const retainedEff = retained.plan && typeof retained.plan.effectiveDigest === 'string'
      ? retained.plan.effectiveDigest
      : preview.effectiveDigest;
    if (typeof reader.effectiveDigest === 'string' && typeof retainedEff === 'string' && reader.effectiveDigest !== retainedEff) {
      return stale('effective-mismatch');
    }
    return { ok: true };
  }

  function profilePreviewPayload(preview) {
    return {
      ok: true,
      state: preview.status,
      profile: true,
      target: {
        profileName: preview.target.profileName,
        profileDirReal: preview.target.profileDirReal,
        patchPathReal: preview.target.patchPathReal,
        pluginEntryName: preview.target.pluginEntryName,
        classification: preview.target.classification,
      },
      storedDigest: preview.storedDigest !== undefined ? preview.storedDigest : preview.patchDigest,
      effectiveDigest: preview.effectiveDigest !== undefined ? preview.effectiveDigest : null,
      sourceSnapshotDigest: preview.sourceSnapshotDigest !== undefined ? preview.sourceSnapshotDigest : null,
      declaredOverlays: Array.isArray(preview.declaredOverlays) ? [...preview.declaredOverlays] : [],
      attestation: preview.attestation,
      attestationText: preview.attestationText,
      liveActivation: 'UNKNOWN_LIVE_UNVERIFIED',
      previewId: preview.previewId,
      generatedAt: preview.generatedAt,
    };
  }

  function previewResponsePayload(retained) {
    const plan = retained.plan;
    const changes = translateChanges(plan.changes);
    const preserved = sortByGatewayId(Array.isArray(plan.preservedUnresolved) ? plan.preservedUnresolved.map((e) => ({ ...e })) : []);
    const skipped = sortByGatewayId(Array.isArray(plan.skippedUnresolved) ? plan.skippedUnresolved.map((e) => ({ ...e })) : []);
    const unsupported = sortByGatewayId(Array.isArray(plan.unsupportedSkipped) ? plan.unsupportedSkipped.map((e) => ({ ...e })) : []);
    const fallback = sortByGatewayId(Array.isArray(plan.fallbackResolved) ? plan.fallbackResolved.map((e) => ({ ...e })) : []);
    let sources;
    if (retained.sourcesSummary) {
      sources = retained.sourcesSummary;
    } else {
      sources = { goRoster: { ok: false, count: 0 }, zenRoster: { ok: false, count: 0 }, catalog: { ok: false }, goDocs: { ok: false }, zenDocs: { ok: false } };
    }
    const body = {
      ok: true,
      state: retained.state,
      target: targetInfo(),
      sources,
      changes,
      preservedUnresolved: preserved,
      skippedUnresolved: skipped,
      unsupportedSkipped: unsupported,
      fallbackResolved: fallback,
      endpointBaseDrift: Array.isArray(plan.endpointBaseDrift) ? plan.endpointBaseDrift.map((e) => ({ ...e })) : [],
      previewId: retained.previewId,
      generatedAt: retained.generatedAt,
    };
    if (retained.state === 'BLOCKED') {
      body.blockedReasons = Array.isArray(plan.blockedReasons) ? plan.blockedReasons.map((e) => ({ reason: String(e.reason) })) : [];
    }
    return body;
  }

  async function handleProfilePreview(res, body, wantProfile) {
    if (previewBusy || applyBusy) {
      refusal(res, 409, 'PREVIEW_BUSY', 'Preview build already in progress.');
      return;
    }
    previewBusy = true;
    try {
      let sources;
      try {
        sources = await fetchSources(fetchImpl);
      } catch (err) {
        refusal(res, 500, 'ERROR', 'Source fetch failed; no Preview retained.');
        return;
      }
      let liveAttestation = null;
      let liveStateRaw;
      if (body.attestation !== undefined && body.attestation !== null) {
        if (typeof body.attestation !== 'object' || Array.isArray(body.attestation)) {
          refusal(res, 400, 'BAD_REQUEST', 'Malformed attestation object.');
          return;
        }
        liveAttestation = body.attestation;
      } else if (typeof body.liveState === 'string' || typeof body.liveStateRaw === 'string') {
        const raw = typeof body.liveState === 'string' ? body.liveState : body.liveStateRaw;
        if (body.acknowledged !== true) {
          sendJson(res, 400, { ok: false, code: 'INVALID_ATTESTATION', message: 'Live-state attestation requires explicit acknowledgment; failing closed.' });
          return;
        }
        liveStateRaw = raw;
      }
      const scratchMode = body.scratchMode === true ? true : serverScratchMode;
      const declared = Array.isArray(body.declaredOverlays) ? body.declaredOverlays : (Array.isArray(body.overlays) ? body.overlays : undefined);
      const args = {
        profileName: wantProfile,
        dshHome: body.dshHome !== undefined ? body.dshHome : serverDshHome,
        origin: 'UI',
        acknowledged: body.acknowledged === true,
        scratchMode,
        sources,
        installAnchorDir: serverInstallAnchorDir,
      };
      if (declared !== undefined) args.declaredOverlays = declared;
      if (liveAttestation !== null) args.liveAttestation = liveAttestation;
      else if (liveStateRaw !== undefined) args.liveStateRaw = liveStateRaw;
      else args.liveAttestation = null;
      let built;
      try {
        built = await buildProfilePreview(args);
      } catch (err) {
        refusal(res, 500, 'ERROR', 'Unexpected internal error.');
        return;
      }
      if (!built || built.ok !== true) {
        const code = built && typeof built.code === 'string' ? built.code : 'ERROR';
        const message = built && typeof built.message === 'string' ? built.message : 'Unexpected internal error.';
        const status = (code === 'INVALID_LIVE_STATE' || code === 'INVALID_PROFILE_NAME' || code === 'INVALID_OVERLAYS' || code === 'VERIFY_FAILED') ? 400 : 409;
        sendJson(res, status, { ok: false, code, message });
        return;
      }
      const preview = built.preview;
      activePreview = {
        kind: 'profile',
        previewId: preview.previewId,
        targetPath: preview.target.patchPathReal,
        production: preview.target.classification === 'PRODUCTION',
        state: preview.status,
        generatedAt: preview.generatedAt,
        preview,
        plan: preview.plan,
      };
      sendJson(res, 200, profilePreviewPayload(preview));
      return;
    } finally {
      previewBusy = false;
    }
  }

  async function handlePreview(req, res, parsed) {
    // S5 additive: profile-aware Preview. Legacy settings.yaml path below is
    // byte-for-byte behavior preserved when no profile is selected (T18).
    try {
      const body = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
      const bodyProfile = typeof body.profileName === 'string' && body.profileName.length > 0
        ? body.profileName
        : (typeof body.profile === 'string' && body.profile.length > 0 ? body.profile : null);
      // S5-R2 B4: on a profile-mode server an unselected picker must refuse;
      // the server default is never silently substituted into a Preview.
      // (Legacy-mode servers keep the frozen empty-body behavior.)
      const wantProfile = bodyProfile;
      if (wantProfile === null && serverProfileName !== null) {
        sendJson(res, 400, { ok: false, code: 'PROFILE_REQUIRED', message: 'No profile is selected; an explicit profile selection is required on this server.' });
        return;
      }
      if (wantProfile !== null) {
        await handleProfilePreview(res, body, wantProfile);
        return;
      }
    } catch (err) {
      try { refusal(res, 500, 'ERROR', 'Unexpected internal error.'); } catch {}
      return;
    }
    // S5-R3 B2: legacy admission happens here, before any source fetch.
    // Only an explicitly supplied, real-path SCRATCH-classified settings
    // target may enter the frozen legacy transaction.
    if (resolvedTarget === null) {
      sendJson(res, 400, { ok: false, code: 'PROFILE_REQUIRED', message: 'No legacy target is bound and no profile was selected; supply an explicit profile selection or start the server with an explicit scratch settings target.' });
      return;
    }
    const legacyBinding = resolveLegacyBinding(resolvedTarget, serverDshHome);
    if (!legacyBinding.ok) {
      sendJson(res, 400, { ok: false, code: 'SETTINGS_UNREADABLE', message: 'The bound settings target cannot be resolved.' });
      return;
    }
    if (legacyBinding.classification !== 'SCRATCH') {
      sendJson(res, 409, { ok: false, code: 'PRODUCTION_SETTINGS_REFUSED', message: 'Production-classified settings targets refuse.' });
      return;
    }
    if (previewBusy || applyBusy) {
      refusal(res, 409, 'PREVIEW_BUSY', 'Preview build already in progress.');
      return;
    }
    previewBusy = true;
    try {
      let sources;
      try {
        sources = await fetchSources(fetchImpl);
      } catch (err) {
        const known = knownSourceError(err);
        if (known) {
          const previewId = crypto.randomBytes(32).toString('hex');
          const generatedAt = new Date().toISOString();
          const blockedPlan = {
            state: 'BLOCKED',
            desired: null,
            dispositions: [],
            changes: { added: [], removed: [], moved: [], metadataChanged: [] },
            preservedUnresolved: [],
            skippedUnresolved: [],
            unsupportedSkipped: [],
            fallbackResolved: [],
            endpointBaseDrift: [],
            settingsPath: resolvedTarget,
            settingsDigest: null,
            sourceSnapshotDigest: null,
            generatedAt,
            blockedReasons: [{ reason: known }],
          };
          const retained = {
            previewId,
            targetPath: resolvedTarget,
            production,
            legacyBinding: { canonicalTarget: legacyBinding.canonicalTarget, homeReal: legacyBinding.homeReal, classification: legacyBinding.classification },
            settingsDigest: null,
            sourceSnapshotDigest: null,
            state: 'BLOCKED',
            generatedAt,
            plan: deepFreeze(structuredClone(blockedPlan)),
            sourcesSummary: { goRoster: { ok: false, count: 0 }, zenRoster: { ok: false, count: 0 }, catalog: { ok: false }, goDocs: { ok: false }, zenDocs: { ok: false } },
          };
          activePreview = retained;
          sendJson(res, 200, previewResponsePayload(retained));
          return;
        }
        refusal(res, 500, 'ERROR', 'Unexpected internal error.');
        return;
      }
      let plan;
      try {
        plan = buildPlan({ settingsPath: resolvedTarget, sources });
      } catch (err) {
        refusal(res, 500, 'ERROR', 'Unexpected internal error.');
        return;
      }
      const previewId = crypto.randomBytes(32).toString('hex');
      const generatedAt = (plan && typeof plan.generatedAt === 'string') ? plan.generatedAt : new Date().toISOString();
      const sourcesSummary = {
        goRoster: { ok: true, count: Array.isArray(sources.rosters.go) ? sources.rosters.go.length : 0 },
        zenRoster: { ok: true, count: Array.isArray(sources.rosters.zen) ? sources.rosters.zen.length : 0 },
        catalog: { ok: true },
        goDocs: { ok: true },
        zenDocs: { ok: true },
      };
      const retained = {
        previewId,
        targetPath: resolvedTarget,
        production,
        legacyBinding: { canonicalTarget: legacyBinding.canonicalTarget, homeReal: legacyBinding.homeReal, classification: legacyBinding.classification },
        settingsDigest: plan.settingsDigest !== undefined ? plan.settingsDigest : null,
        sourceSnapshotDigest: plan.sourceSnapshotDigest !== undefined ? plan.sourceSnapshotDigest : null,
        state: plan.state,
        generatedAt,
        plan: deepFreeze(structuredClone(plan)),
        sourcesSummary,
      };
      activePreview = retained;
      sendJson(res, 200, previewResponsePayload(retained));
    } catch (err) {
      try { refusal(res, 500, 'ERROR', 'Unexpected internal error.'); } catch { try { res.end(); } catch {} }
    } finally {
      previewBusy = false;
    }
  }

  async function handleProfileApply(res, parsed) {
    const keys = Object.keys(parsed);
    const previewId = parsed.previewId;
    const hasSchema = typeof previewId === 'string' && keys.length === 3 && keys.includes('previewId') && keys.includes('confirmed') && keys.includes('selection');
    if (!hasSchema) {
      if (typeof previewId !== 'string') {
        refusal(res, 400, 'BAD_REQUEST', 'Malformed request.');
        return;
      }
      sendJson(res, 400, { ok: false, code: 'CONFIRMATION_REQUIRED', message: 'Profile Apply requires confirmed:true with the current operator selection following the displayed Preview.' });
      return;
    }
    if (parsed.confirmed !== true) {
      sendJson(res, 400, { ok: false, code: 'CONFIRMATION_REQUIRED', message: 'Profile Apply requires confirmed:true with the current operator selection following the displayed Preview.' });
      return;
    }
    if (applyBusy) {
      refusal(res, 409, 'APPLY_BUSY', 'Apply already in progress.');
      return;
    }
    if (previewBusy) {
      refusal(res, 409, 'PREVIEW_BUSY', 'Preview build already in progress.');
      return;
    }
    if (!activePreview || previewId !== activePreview.previewId) {
      refusal(res, 409, 'STALE_PREVIEW', 'Preview is stale. Run Refresh Preview to build a new one.');
      return;
    }
    if (activePreview.state !== 'READY' && activePreview.state !== 'NO_CHANGE') {
      refusal(res, 409, 'PREVIEW_NOT_READY', 'Preview is not ready for Apply.');
      return;
    }
    let binding = null;
    try {
      binding = await verifyProfileApplySelection(activePreview, parsed.selection);
    } catch {
      binding = null;
    }
    if (!binding || binding.ok !== true) {
      const code = binding && typeof binding.code === 'string' ? binding.code : 'STALE_PREVIEW';
      if (code === 'STALE_PREVIEW') {
        activePreview = null;
        refusal(res, 409, 'STALE_PREVIEW', 'Preview is stale. Run Refresh Preview to build a new one.');
        return;
      }
      refusal(res, 400, 'BAD_REQUEST', 'Malformed request.');
      return;
    }
    applyBusy = true;
    try {
      let outcome;
      try {
        outcome = await ProfileAwareCommit({ plan: activePreview.plan, waitMs: 15000 });
      } catch (err) {
        refusal(res, 500, 'ERROR', 'Unexpected internal error.');
        return;
      }
      if (outcome && outcome.stale === true) {
        activePreview = null;
        refusal(res, 409, 'STALE_PREVIEW', 'Preview is stale. Run Refresh Preview to build a new one.');
        return;
      }
      if (!outcome || outcome.ok !== true) {
        const code = outcome && typeof outcome.code === 'string' ? outcome.code : 'ERROR';
        const message = outcome && typeof outcome.message === 'string' ? outcome.message : 'Unexpected internal error.';
        if (code === 'STALE_TARGET') activePreview = null;
        const status = code === 'ERROR' ? 500 : 409;
        sendJson(res, status, { ok: false, code, message });
        return;
      }
      const target = outcome.target || activePreview.preview.target;
      const body = {
        ok: true,
        status: outcome.status,
        profile: true,
        target: {
          profileName: target.profileName,
          profileDirReal: target.profileDirReal,
          patchPathReal: target.patchPathReal,
          pluginEntryName: target.pluginEntryName,
          classification: target.classification,
        },
        liveActivation: outcome.liveActivation || 'UNKNOWN_LIVE_UNVERIFIED',
      };
      if (outcome.status === 'UPDATED') {
        body.fileVerified = outcome.fileVerified === true;
        body.effectiveComposition = outcome.effectiveComposition || 'MATCHED';
        if (outcome.backupPath !== undefined) body.backupPath = outcome.backupPath;
        if (outcome.newDigest !== undefined) body.newDigest = outcome.newDigest;
      } else {
        if (outcome.patchDigest !== undefined) body.patchDigest = outcome.patchDigest;
      }
      try {
        body.attestationText = formatAttestationText(activePreview.preview.attestation);
      } catch {}
      activePreview = null;
      sendJson(res, 200, body);
      return;
    } finally {
      applyBusy = false;
    }
  }

  async function handleApply(req, res, parsed) {
    // S5 additive: profile-bound retained Previews commit through the shared
    // ProfileAwareCommit (same function the CLI uses, T15). Legacy previews
    // keep the exact v1.3 transaction below (T18).
    if (activePreview && activePreview.kind === 'profile') {
      await handleProfileApply(res, parsed);
      return;
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      refusal(res, 400, 'BAD_REQUEST', 'Malformed request.');
      return;
    }
    const keys = Object.keys(parsed);
    if (keys.length !== 1 || keys[0] !== 'previewId' || typeof parsed.previewId !== 'string') {
      refusal(res, 400, 'BAD_REQUEST', 'Malformed request.');
      return;
    }
    const previewId = parsed.previewId;
    if (applyBusy) {
      refusal(res, 409, 'APPLY_BUSY', 'Apply already in progress.');
      return;
    }
    if (previewBusy) {
      refusal(res, 409, 'PREVIEW_BUSY', 'Preview build already in progress.');
      return;
    }
    if (!activePreview || previewId !== activePreview.previewId) {
      refusal(res, 409, 'STALE_PREVIEW', 'Preview is stale. Run Refresh Preview to build a new one.');
      return;
    }
    if (activePreview.state !== 'READY') {
      refusal(res, 409, 'PREVIEW_NOT_READY', 'Preview is not ready for Apply.');
      return;
    }
    const boundLegacy = activePreview.legacyBinding || null;
    const freshLegacy = resolveLegacyBinding(resolvedTarget, serverDshHome);
    if (!freshLegacy.ok) {
      activePreview = null;
      sendJson(res, 400, { ok: false, code: 'SETTINGS_UNREADABLE', message: 'The bound settings target cannot be resolved.' });
      return;
    }
    if (freshLegacy.classification !== 'SCRATCH') {
      activePreview = null;
      sendJson(res, 409, { ok: false, code: 'PRODUCTION_SETTINGS_REFUSED', message: 'Production-classified settings targets refuse.' });
      return;
    }
    if (!boundLegacy || !legacyBindingsEqual(boundLegacy, freshLegacy)) {
      activePreview = null;
      refusal(res, 409, 'STALE_PREVIEW', 'Preview is stale. Run Refresh Preview to build a new one.');
      return;
    }
    applyBusy = true;
    try {
      const dir = path.dirname(resolvedTarget);
      const before = new Set(listBackups(dir));
      let outcome;
      try {
        outcome = commitPlan(activePreview.plan);
      } catch (err) {
        refusal(res, 500, 'ERROR', 'Unexpected internal error.');
        return;
      }
      if (outcome && outcome.stale === true) {
        activePreview = null;
        refusal(res, 409, 'STALE_PREVIEW', 'Preview is stale. Run Refresh Preview to build a new one.');
        return;
      }
      if (!outcome || outcome.result !== 'UPDATED') {
        refusal(res, 500, 'ERROR', 'Unexpected internal error.');
        return;
      }
      activePreview = null;
      const after = listBackups(dir);
      const fresh = after.filter((n) => !before.has(n));
      let backupPath = null;
      if (fresh.length > 0) backupPath = path.join(dir, fresh[fresh.length - 1]);
      else if (after.length > 0) backupPath = path.join(dir, after[after.length - 1]);
      else backupPath = resolvedTarget + '.bak';
      sendJson(res, 200, { ok: true, status: 'UPDATED', backupPath, target: targetInfo() });
    } finally {
      applyBusy = false;
    }
  }

  const server = http.createServer((req, res) => {
    (async () => {
      res.ocmsCsp = serverCsp;
      let pathname = '/';
      try {
        const u = new URL(req.url || '/', 'http://127.0.0.1');
        pathname = u.pathname;
      } catch {
        refusal(res, 404, 'NOT_FOUND', 'Not found.');
        return;
      }
      const method = req.method || 'GET';
      const bound = server.address() && typeof server.address() === 'object' ? server.address().port : boundPort;
      if (!hostAllowed(req, bound)) {
        refusal(res, 403, 'BAD_HOST', 'Unexpected Host header.');
        return;
      }
      const isKnown = pathname === '/' || pathname === '/api/state' || pathname === '/api/preview' || pathname === '/api/apply';
      if (!isKnown) {
        refusal(res, 404, 'NOT_FOUND', 'Not found.');
        return;
      }
      if (pathname === '/' && method !== 'GET') {
        refusal(res, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed.');
        return;
      }
      if (pathname === '/api/state' && method !== 'GET') {
        refusal(res, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed.');
        return;
      }
      if ((pathname === '/api/preview' || pathname === '/api/apply') && method !== 'POST') {
        refusal(res, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed.');
        return;
      }
      if (pathname === '/') {
        applySecurityHeaders(res);
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(page);
        return;
      }
      if (pathname === '/api/state') {
        sendJson(res, 200, statePayload());
        return;
      }
      if (!originAllowed(req, bound)) {
        refusal(res, 403, 'BAD_ORIGIN', 'Unexpected Origin.');
        return;
      }
      if (!tokenMatches(req.headers['x-ocms-token'], token)) {
        refusal(res, 403, 'BAD_TOKEN', 'Missing or invalid authorization token.');
        return;
      }
      let raw = '';
      try {
        raw = await readBody(req, MAX_BODY_BYTES);
      } catch (err) {
        refusal(res, 400, 'BAD_REQUEST', 'Malformed request.');
        return;
      }
      let parsed;
      if (!raw || raw.length === 0) {
        parsed = {};
      } else {
        try {
          parsed = JSON.parse(raw);
        } catch {
          refusal(res, 400, 'BAD_REQUEST', 'Malformed request.');
          return;
        }
      }
      if (pathname === '/api/preview') {
        if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
          await handlePreview(req, res, parsed);
          return;
        }
        refusal(res, 400, 'BAD_REQUEST', 'Malformed request.');
        return;
      }
      if (pathname === '/api/apply') {
        await handleApply(req, res, parsed);
        return;
      }
      refusal(res, 404, 'NOT_FOUND', 'Not found.');
    })().catch(() => {
      try { refusal(res, 500, 'ERROR', 'Unexpected internal error.'); } catch { try { res.end(); } catch {} }
    });
  });

  const sockets = new Set();
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  await new Promise((resolve, reject) => {
    const onError = (err) => {
      server.removeListener('listening', onListen);
      reject(err);
    };
    const onListen = () => {
      server.removeListener('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListen);
    server.listen(boundPort, BIND_HOST);
  });

  const actual = server.address() && typeof server.address() === 'object' ? server.address().port : boundPort;
  const url = 'http://' + BIND_HOST + ':' + actual + '/';
  try {
    console.log('OCMS-S v' + version + ' listening on ' + url);
    console.log('target: ' + (displayPath === null ? 'no legacy target bound' : displayPath + ' (' + (production ? 'PRODUCTION' : 'SCRATCH') + ')'));
  } catch {}
  if (openBrowser) {
    try {
      if (typeof openBrowser === 'function') await openBrowser(url);
      else defaultOpenBrowser(url);
    } catch {}
  }

  async function close() {
    for (const socket of [...sockets]) {
      try { socket.destroy(); } catch {}
    }
    await new Promise((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }

  function address() {
    return server.address();
  }

  return { server, port: actual, token, close, address };
}

function printUsage() {
  try {
    console.error('Usage: node ui.mjs [--settings=<path>] [--port=<port>] [--no-open] [--embed-origin=<origin>] [--profile=<name>] [--live-state=<not-running|overlays:<paths>>] [--scratch]');
  } catch {}
}

// v1.4 embed-origin validator (contract sections 27/64): URL semantics, strict
// scheme/host/port/path/query/fragment checks, normalized origin out. Any
// malformed, non-loopback, suffix-confused, or decorated value is rejected.
export function parseEmbedOrigin(raw) {
  if (typeof raw !== 'string' || raw.length === 0) throw new Error('INVALID_EMBED_ORIGIN');
  if (/\s/.test(raw)) throw new Error('INVALID_EMBED_ORIGIN');
  if (raw === '*' || raw === "'none'") throw new Error('INVALID_EMBED_ORIGIN');
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('INVALID_EMBED_ORIGIN');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('INVALID_EMBED_ORIGIN');
  if (url.username !== '' || url.password !== '') throw new Error('INVALID_EMBED_ORIGIN');
  const host = url.hostname.toLowerCase();
  if (host !== '127.0.0.1' && host !== 'localhost') throw new Error('INVALID_EMBED_ORIGIN');
  if (!/^\d+$/.test(url.port)) throw new Error('INVALID_EMBED_ORIGIN');
  const port = Number(url.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('INVALID_EMBED_ORIGIN');
  if (url.pathname !== '/' && url.pathname !== '') throw new Error('INVALID_EMBED_ORIGIN');
  if (url.search !== '' || url.hash !== '') throw new Error('INVALID_EMBED_ORIGIN');
  return url.protocol + '//' + host + ':' + String(port);
}

export function parseCliArgs(argv) {
  // argv is the flag list proper (node/script entries already removed).
  // S5 additive: --profile / --live-state / --scratch alongside the legacy
  // surface. Legacy flags and refusals are unchanged.
  let settings;
  let settingsCount = 0;
  let profile;
  let profileCount = 0;
  let liveState;
  let liveCount = 0;
  let scratch = false;
  let scratchCount = 0;
  let port;
  let portCount = 0;
  let noOpen = false;
  let embedOrigin;
  let embedCount = 0;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--no-open') {
      noOpen = true;
      continue;
    }
    if (arg.startsWith('--port=')) {
      portCount += 1;
      if (portCount > 1) throw new Error('DUPLICATE_PORT');
      const raw = arg.slice('--port='.length);
      if (!/^\d+$/.test(raw)) throw new Error('INVALID_PORT');
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 1 || n > 65535) throw new Error('INVALID_PORT');
      port = n;
      continue;
    }
    if (arg === '--port' || arg.startsWith('--port')) throw new Error('INVALID_PORT');
    if (arg.startsWith('--settings=')) {
      settingsCount += 1;
      if (settingsCount > 1) throw new Error('DUPLICATE_SETTINGS');
      const raw = arg.slice('--settings='.length);
      if (!raw) throw new Error('INVALID_SETTINGS');
      settings = raw;
      continue;
    }
    if (arg === '--settings' || arg.startsWith('--settings')) throw new Error('INVALID_SETTINGS');
    if (arg === '--profile') {
      profileCount += 1;
      if (profileCount > 1) throw new Error('DUPLICATE_PROFILE');
      const next = argv[i + 1];
      if (next === undefined || (typeof next === 'string' && next.startsWith('--'))) throw new Error('INVALID_PROFILE');
      if (typeof next !== 'string' || next.length === 0) throw new Error('INVALID_PROFILE');
      profile = next;
      i += 1;
      continue;
    }
    if (arg.startsWith('--profile=')) {
      profileCount += 1;
      if (profileCount > 1) throw new Error('DUPLICATE_PROFILE');
      const raw = arg.slice('--profile='.length);
      if (!raw) throw new Error('INVALID_PROFILE');
      profile = raw;
      continue;
    }
    if (arg.startsWith('--profile')) throw new Error('INVALID_PROFILE');
    if (arg === '--live-state') {
      liveCount += 1;
      if (liveCount > 1) throw new Error('DUPLICATE_LIVE_STATE');
      const next = argv[i + 1];
      if (next === undefined || (typeof next === 'string' && next.startsWith('--'))) throw new Error('INVALID_LIVE_STATE');
      if (typeof next !== 'string' || next.length === 0) throw new Error('INVALID_LIVE_STATE');
      liveState = next;
      i += 1;
      continue;
    }
    if (arg.startsWith('--live-state=')) {
      liveCount += 1;
      if (liveCount > 1) throw new Error('DUPLICATE_LIVE_STATE');
      const raw = arg.slice('--live-state='.length);
      if (!raw) throw new Error('INVALID_LIVE_STATE');
      liveState = raw;
      continue;
    }
    if (arg.startsWith('--live-state')) throw new Error('INVALID_LIVE_STATE');
    if (arg === '--scratch') {
      scratchCount += 1;
      if (scratchCount > 1) throw new Error('DUPLICATE_SCRATCH');
      scratch = true;
      continue;
    }
    if (arg.startsWith('--scratch')) throw new Error('INVALID_SCRATCH');
    if (arg.startsWith('--embed-origin=')) {
      embedCount += 1;
      if (embedCount > 1) throw new Error('DUPLICATE_EMBED_ORIGIN');
      embedOrigin = parseEmbedOrigin(arg.slice('--embed-origin='.length));
      continue;
    }
    if (arg.startsWith('--embed-origin')) throw new Error('INVALID_EMBED_ORIGIN');
    throw new Error('UNKNOWN_FLAG: ' + arg);
  }
  return { settings, port, noOpen, embedOrigin, profile, liveState, scratch };
}

async function cliMain() {
  let parsed;
  try {
    parsed = parseCliArgs(process.argv.slice(2));
  } catch (err) {
    printUsage();
    process.exitCode = 1;
    return;
  }
  // S5-R3 B2: settingsPath stays undefined unless explicitly supplied, so
  // the server never implicitly binds the default production settings.yaml.
  // Legacy Preview/Apply without an admitted target refuse server-side;
  // the Host-managed child therefore still starts (readiness probes pass)
  // while no implicit production route exists.
  const settingsPath = parsed.settings;
  const listenPort = parsed.port !== undefined ? parsed.port : DEFAULT_PORT;
  try {
    await startServer({ settingsPath, port: listenPort, fetchFn: globalThis.fetch, openBrowser: parsed.noOpen ? false : true, embedOrigin: parsed.embedOrigin, profileName: parsed.profile, scratchMode: parsed.scratch === true });
  } catch (err) {
    try { console.error(String((err && err.message) || err)); } catch {}
    process.exitCode = 1;
  }
}

const invokedAsMain =
  typeof process !== 'undefined' &&
  process.argv &&
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedAsMain) {
  cliMain();
}
