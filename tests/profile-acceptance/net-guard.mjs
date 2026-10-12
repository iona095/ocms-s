// S6 net guard (harness-only, active before DSH load via --import). Allows loopback, denies non-loopback.
function isLoopbackHost(h) { if (!h) return false; const s = String(h).toLowerCase(); if (s === "localhost" || s === "127.0.0.1" || s === "::1" || s === "::ffff:127.0.0.1") return true; if (s.startsWith("127.")) return true; return false; }
function hostOf(url) { try { return new URL(String(url)).hostname; } catch { return ""; } }
const origFetch = globalThis.fetch;
if (typeof origFetch === "function") { globalThis.fetch = async (url, opts) => { if (!isLoopbackHost(hostOf(url))) throw new Error("S6_NET_DENIED: non-loopback fetch blocked " + hostOf(url)); return origFetch(url, opts); }; }
export function installNetGuard() { return { active: true }; }

import http from "node:http";
import https from "node:https";
import net from "node:net";
function denyHost(h) { if (!isLoopbackHost(h)) throw new Error("S6_NET_DENIED: non-loopback blocked " + h); }
try { const ofReq = http.request; http.request = function (u, o, cb) { const h = typeof u === "string" ? hostOf(u) : (u && u.hostname) || ""; if (h) denyHost(h); return ofReq.call(this, u, o, cb); }; } catch {}
try { const ofGet = http.get; http.get = function (u, o, cb) { const h = typeof u === "string" ? hostOf(u) : (u && u.hostname) || ""; if (h) denyHost(h); return ofGet.call(this, u, o, cb); }; } catch {}
try { const ofConn = net.connect; net.connect = function (...a) { let h = ""; if (typeof a[0] === "string") h = a[0]; else if (a[0] && typeof a[0] === "object") h = a[0].host || ""; if (h) denyHost(h); return ofConn.apply(this, a); }; } catch {}

