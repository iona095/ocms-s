import { spawn } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve, dirname, delimiter, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { watch } from "node:fs";

const USAGE_REGISTER = "Usage: npm run register -- --profile <name>\n" + "  Register the local checkout into one explicit DSH profile.\n" + "  --profile <name>   required; an existing profile (never created here)";
const TARGET_PREFIX = "ocms-s register: target profile ";
const BACKSLASH = String.fromCharCode(92);
const PROFILE_PATTERN = /^[A-Za-z0-9._-]+$/;
const USAGE_WATCH = "Usage: npm run watch\n" + "  Rebuild dsh/client.js when its inputs change.\n" + "  Accepts no arguments.";
const USAGE_BUILD = "Usage: npm run build\n" + "  Rebuild dsh/client.js from its inputs.\n" + "  Accepts no arguments.";
const USAGE_DEV_TOOLS = "Usage: node scripts/dev-tools.mjs <command>\n" +
  "  build      Rebuild dsh/client.js from its inputs.\n" +
  "  register   Register the local checkout into one explicit DSH profile.\n" +
  "  watch      Rebuild dsh/client.js when its inputs change.\n" +
  "  dev:web    Build, register, and launch the selected DSH profile.";
export const WATCH_DEBOUNCE_MS = 150;
const WATCH_REBUILT_LINE = "ocms-s watch: rebuilt dsh/client.js";
const WATCH_FAILED_LINE = "ocms-s watch: build failed (watching continues)";

export function parseRegisterArgs(argv) {
  if (!Array.isArray(argv) || argv.length === 0) {
    throw new Error(USAGE_REGISTER);
  }
  if (argv[0] !== "--profile") {
    throw new Error("unknown option " + JSON.stringify(argv[0]) + "\n" + USAGE_REGISTER);
  }
  if (argv.length < 2) {
    throw new Error("missing value for --profile\n" + USAGE_REGISTER);
  }
  const value = argv[1];
  if (typeof value !== "string" || value.length === 0 || value.charAt(0) === "-") {
    throw new Error("invalid value for --profile\n" + USAGE_REGISTER);
  }
  if (argv.length > 2) {
    throw new Error("duplicate or unexpected argument " + JSON.stringify(argv[2]) + "\n" + USAGE_REGISTER);
  }
  return { profile: value };
}

export function validateProfileName(name) {
  if (typeof name !== "string" || name.length === 0) {
    throw new Error("profile name must not be empty\n" + USAGE_REGISTER);
  }
  if (name.length > 64 || !PROFILE_PATTERN.test(name)) {
    throw new Error("invalid profile name " + JSON.stringify(name) + "\n" + USAGE_REGISTER);
  }
  if (name.charAt(0) === "-") {
    throw new Error("invalid profile name " + JSON.stringify(name) + "\n" + USAGE_REGISTER);
  }
  if (name.indexOf("/") !== -1 || name.indexOf(BACKSLASH) !== -1) {
    throw new Error("invalid profile name " + JSON.stringify(name) + "\n" + USAGE_REGISTER);
  }
  if (name === "." || name === ".." || name === "node_modules") {
    throw new Error("invalid profile name " + JSON.stringify(name) + "\n" + USAGE_REGISTER);
  }
  if (name.toLowerCase() === "desktop") {
    throw new Error("invalid profile name " + JSON.stringify(name) + "\n" + USAGE_REGISTER);
  }
  return name;
}

export function resolveDshHome(env) {
  const fromEnv = env && typeof env.DSH_HOME === "string" ? env.DSH_HOME : "";
  if (fromEnv.length > 0) {
    return fromEnv;
  }
  return join(homedir(), ".dsh");
}

export function resolveProfileDir(name, dshHome) {
  return join(dshHome, "profiles", name);
}

export async function profileExists(dir) {
  try {
    const st = await stat(join(dir, "package.json"));
    return st.isFile();
  } catch (err) {
    if (err && err.code === "ENOENT") {
      return false;
    }
    throw err;
  }
}

export async function findDshExecutable(env) {
  const raw = env && typeof env.PATH === "string" ? env.PATH : "";
  if (raw.length === 0) {
    return null;
  }
  // P4: Windows resolves a bare command name through PATHEXT, so an extension
  // this list did not hardcode (.ps1, .com, ...) was invisible and the lookup
  // reported "dsh not found". Try the bare name, then each advertised
  // extension in PATHEXT order.
  const cands = ["dsh"];
  if (process.platform === "win32") {
    const raw2 = env && typeof env.PATHEXT === "string" ? env.PATHEXT : "";
    const advertised = raw2.split(";").map((e) => e.trim()).filter((e) => e.startsWith("."));
    for (const ext of (advertised.length > 0 ? advertised : [".cmd", ".exe", ".bat", ".ps1"])) {
      cands.push("dsh" + ext.toLowerCase());
    }
  }
  const dirs = raw.split(delimiter);
  for (const rawDir of dirs) {
    // A quoted PATH entry keeps its quote characters; joining it verbatim never
    // stats, which looked exactly like "dsh not found".
    const dir = rawDir.trim().replace(/^"([\s\S]*)"$/, "$1");
    if (!dir) {
      continue;
    }
    for (const base of cands) {
      const full = join(dir, base);
      try {
        const st = await stat(full);
        if (st.isFile()) {
          return full;
        }
      } catch {
      }
    }
  }
  return null;
}

export async function readPackageName(repoRoot) {
  try {
    const raw = await readFile(join(repoRoot, "package.json"), "utf8");
    return JSON.parse(raw).name || "";
  } catch {
    return "";
  }
}

function defaultSpawn(file, args, notify, env) {
  return new Promise((done) => {
    const child = spawn(file, args, { stdio: "inherit", shell: false, env: env || process.env });
    if (notify) {
      try { notify(child); } catch { }
    }
    child.on("error", () => done(127));
    child.on("exit", (code) => done(typeof code === "number" ? code : 1));
  });
}

export async function resolveDshLaunch(shimPath, overrides) {
  const lower = String(shimPath).toLowerCase();
  if (lower.endsWith(".exe")) {
    return { file: shimPath, argsPrefix: [], shell: false };
  }
  const readFileFn = (overrides && overrides.readFile) || readFile;
  const statFn = (overrides && overrides.stat) || stat;
  const dir = dirname(shimPath);
  const roots = [join(dir, "node_modules", "@deepseek-ai", "dsh"), join(dir, "..", "@deepseek-ai", "dsh")];
  for (const root of roots) {
    try {
      const pkgRaw = await readFileFn(join(root, "package.json"), "utf8");
      const pkg = JSON.parse(pkgRaw);
      const binField = typeof pkg.bin === "string" ? pkg.bin : (pkg.bin && pkg.bin.dsh);
      if (typeof binField !== "string" || binField.length === 0) {
        continue;
      }
      // P3: the bin field must stay inside the package root. Split on BOTH
      // separators (a '..\\..\\x.js' traversal joined onto the root escapes it on
      // Windows) and reject drive-relative forms too, which isAbsolute alone
      // does not cover.
      const binSegments = binField.split(/[\\/]/);
      const binDrives = /^[A-Za-z]:/.test(binField);
      if (isAbsolute(binField) || binDrives || binSegments.indexOf("..") !== -1) {
        continue;
      }
      const entry = join(root, binField);
      const st = await statFn(entry);
      if (!st.isFile()) {
        continue;
      }
      let nodeFile = process.execPath;
      try {
        const sib = join(dir, "node.exe");
        const nst = await statFn(sib);
        if (nst.isFile()) {
          nodeFile = sib;
        }
      } catch {
      }
      return { file: nodeFile, argsPrefix: [entry], shell: false };
    } catch {
    }
  }
  return null;
}

export async function runRegister(options) {
  const argv = options.argv || [];
  const env = options.env || process.env;
  const repoRoot = options.repoRoot || "";
  const print = options.print || ((msg) => console.log(msg));
  const printError = options.printError || ((msg) => console.error(msg));
  const findDsh = options.findDsh || findDshExecutable;
  const resolveLaunch = options.resolveLaunch || resolveDshLaunch;
  const existsCheck = options.profileExists || profileExists;
  const spawnFn = options.spawnFn || defaultSpawn;
  const onChild = options.onChild || null;
  const isCancelled = options.isCancelled || null;
  const cancelledNow = () => { try { return !!(isCancelled && isCancelled()); } catch { return false; } };
  const cancelRefusal = () => { printError("ocms-s register: cancelled; refusing plugin mutation"); return 1; };
  const getPkgName = options.readPackageName || readPackageName;
  let profile;
  try {
    profile = parseRegisterArgs(argv).profile;
    validateProfileName(profile);
  } catch (err) {
    printError(String((err && err.message) || err));
    return 1;
  }
  print(TARGET_PREFIX + JSON.stringify(profile));
  const pkgName = await getPkgName(repoRoot);
  if (cancelledNow()) { return cancelRefusal(); }
  if (pkgName !== "ocms-s") {
    printError("ocms-s register: unexpected package name for " + repoRoot);
    return 1;
  }
  const dshBin = await findDsh(env);
  if (cancelledNow()) { return cancelRefusal(); }
  if (!dshBin) {
    printError("ocms-s register: dsh executable not found on PATH; install DSH 0.2.1-alpha.2 (no download attempted)");
    return 1;
  }
  const home = resolveDshHome(env);
  const dir = resolveProfileDir(profile, home);
  let present = false;
  try {
    present = await existsCheck(dir);
  } catch (err) {
    printError("ocms-s register: profile check failed for " + JSON.stringify(profile));
    return 1;
  }
  if (cancelledNow()) { return cancelRefusal(); }
  if (!present) {
    printError("ocms-s register: profile " + JSON.stringify(profile) + " does not exist; refusing to create it (existing profiles only)");
    return 1;
  }
  const launch = await resolveLaunch(dshBin);
  if (cancelledNow()) { return cancelRefusal(); }
  if (!launch || launch.shell !== false || typeof launch.file !== "string" || !Array.isArray(launch.argsPrefix)) {
    printError("ocms-s register: dsh launcher is not a safely invocable installation; refusing without shell fallback");
    return 1;
  }
  if (cancelledNow()) { return cancelRefusal(); }
  const notify = onChild ? ((c) => { try { onChild(c); } catch { } }) : undefined;
  const spawned = await spawnFn(launch.file, launch.argsPrefix.concat(["plugin", "--profile", profile, "add", repoRoot]), notify, env);
  return typeof spawned === "number" ? spawned : spawned.code;
}

export function parseBuildArgs(argv) {
  if (!Array.isArray(argv) || argv.length !== 0) {
    throw new Error(USAGE_BUILD);
  }
  return {};
}

export async function runBuild(options) {
  const opts = options || {};
  const repoRoot = opts.repoRoot || "";
  const env = opts.env || process.env;
  const print = opts.print || ((msg) => console.log(msg));
  const printError = opts.printError || ((msg) => console.error(msg));
  const startBuild = opts.startBuild || ((root, _env) => startCanonicalBuild(root, _env || env));
  let argv = opts.argv;
  if (argv === undefined) { argv = []; }
  try {
    parseBuildArgs(argv);
  } catch (err) {
    printError(String((err && err.message) || err));
    return 1;
  }
  let started = null;
  try {
    started = startBuild(repoRoot);
  } catch (err) {
    printError("ocms-s build: " + String((err && err.message) || err));
    return 1;
  }
  let res = null;
  try {
    res = await started.done;
  } catch (err) {
    res = { code: 1, stdout: "", stderr: String((err && err.message) || err) };
  }
  if (!res || typeof res.code !== "number") {
    printError("ocms-s build: builder did not exit cleanly");
    return 1;
  }
  if (res.stdout && res.stdout.trim().length > 0) {
    print(res.stdout.trim());
  }
  if (res.stderr && res.stderr.trim().length > 0) {
    printError(res.stderr.trim());
  }
  return res.code;
}

export function parseWatchArgs(argv) {
  if (!Array.isArray(argv) || argv.length !== 0) {
    throw new Error(USAGE_WATCH);
  }
  return {};
}

export function startCanonicalBuild(repoRoot, env) {
  const script = join(repoRoot, "dsh", "build-client.mjs");
  const child = spawn(process.execPath, [script], { cwd: repoRoot, stdio: ["ignore", "pipe", "pipe"], shell: false, env: env || process.env });
  const done = new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (err) => resolve({ code: 127, stdout, stderr: stderr + String(err) }));
    child.on("exit", (code) => resolve({ code: typeof code === "number" ? code : 1, stdout, stderr }));
  });
  return { child, done };
}

export function runWatch(options) {
  const opts = options || {};
  const repoRoot = opts.repoRoot || "";
  const print = opts.print || ((msg) => console.log(msg));
  const printError = opts.printError || ((msg) => console.error(msg));
  const startBuild = opts.startBuild || startCanonicalBuild;
  const watchFile = opts.watchFile || ((path, listener) => watch(path, listener));
  const debounceMs = opts.debounceMs !== undefined ? opts.debounceMs : WATCH_DEBOUNCE_MS;
  const onReady = opts.onReady || null;
  const state = { watchers: [], timer: null, busy: false, queued: false, shuttingDown: false, activeChild: null, settled: false, finalCode: 0, fatal: false, fatalCode: 0 };  const signaledKids = [];
  let resolveMain = null;
  const main = new Promise((resolve) => { resolveMain = resolve; });
  function signalOwned() {
    const current = state.activeChild;
    if (current && signaledKids.indexOf(current) === -1) {
      signaledKids.push(current);
      try { current.kill(); } catch { }
    }
  }
  function onWatcherError(err) {
    if (state.settled) { return; }
    state.fatal = true;
    state.fatalCode = 1;
    state.shuttingDown = true;
    state.queued = false;
    clearTimer();
    try { printError("ocms-s watch: watcher failed: " + String((err && err.message) || err)); } catch { }
    signalOwned();
    closeWatchers();
    if (!state.busy) { finish(1); }
  }
  function clearTimer() {
    if (state.timer !== null) {
      clearTimeout(state.timer);
      state.timer = null;
    }
  }
  function closeWatchers() {
    for (const w of state.watchers) {
      try { w.close(); } catch { }
    }
    state.watchers = [];
  }
  function finish(code) {
    if (state.settled) { return; }
    state.settled = true;
    state.finalCode = code;
    closeWatchers();
    clearTimer();
    resolveMain(code);
  }
  async function stop() {
    if (state.settled) { return state.finalCode; }
    state.shuttingDown = true;
    clearTimer();
    state.queued = false;
    closeWatchers();
    signalOwned();
    if (!state.busy) {
      finish(0);
      return state.finalCode;
    }
    await main;
    return state.finalCode;
  }
  function onEvent() {
    if (state.shuttingDown || state.settled) { return; }
    clearTimer();
    state.timer = setTimeout(requestRebuild, debounceMs);
  }
  function requestRebuild() {
    state.timer = null;
    if (state.shuttingDown || state.settled) { return; }
    if (state.busy) {
      state.queued = true;
      return;
    }
    void startRebuild();
  }
  function beginBuild() {
    try {
      return startBuild(repoRoot);
    } catch (err) {
      return { child: null, done: Promise.resolve({ code: 1, stdout: "", stderr: String((err && err.message) || err) }) };
    }
  }
  async function startRebuild() {
    state.busy = true;
    const started = beginBuild();
    state.activeChild = started.child || null;
    let res = null;
    try {
      res = await started.done;
    } catch (err) {
      res = { code: 1, stdout: "", stderr: String((err && err.message) || err) };
    } finally {
      state.activeChild = null;
      state.busy = false;
    }
    if (!res || typeof res.code !== "number") {
      res = { code: 1, stdout: "", stderr: "ocms-s watch: builder returned no exit code" };
    }
    if (res.code === 0) {
      print(WATCH_REBUILT_LINE);
    } else {
      const out = String((res.stdout || "") + (res.stderr || ""));
      if (out.length > 0) { printError(out); }
      printError(WATCH_FAILED_LINE);
    }
    if (state.settled) { return; }
    if (state.fatal) { finish(state.fatalCode); return; }
    if (state.shuttingDown) {
      finish(0);
      return;
    }
    if (state.queued) {
      state.queued = false;
      void startRebuild();
    }
  }
  async function flow() {
    let argv = opts.argv;
    if (argv === undefined) { argv = []; }
    try {
      parseWatchArgs(argv);
    } catch (err) {
      printError(String((err && err.message) || err));
      finish(1);
      return;
    }
    state.busy = true;
    const started = beginBuild();
    state.activeChild = started.child || null;
    let res = null;
    try {
      res = await started.done;
    } catch (err) {
      res = { code: 1, stdout: "", stderr: String((err && err.message) || err) };
    } finally {
      state.activeChild = null;
      state.busy = false;
    }
    if (state.settled) { return; }
    if (state.fatal) { finish(state.fatalCode); return; }
    if (state.shuttingDown) {
      finish(0);
      return;
    }
    if (!res || res.code !== 0) {
      const out = String(((res && res.stdout) || "") + ((res && res.stderr) || ""));
      if (out.length > 0) { printError(out); }
      finish(res && typeof res.code === "number" ? res.code : 1);
      return;
    }
    if (res.stdout && res.stdout.trim().length > 0) {
      print(res.stdout.trim());
    }
    const inputs = [join(repoRoot, "dsh", "client.mjs"), join(repoRoot, "dsh", "build-client.mjs")];
    try {
      for (const input of inputs) {
        const created = watchFile(input, onEvent);
        if (created && typeof created.on === "function") {
          created.on("error", onWatcherError);
        }
        state.watchers.push(created);
      }
    } catch (err) {
      printError("ocms-s watch: watcher setup failed: " + String((err && err.message) || err));
      finish(1);
      return;
    }
    if (onReady) {
      try { onReady(); } catch { }
    }
  }
  main.stop = stop;
  flow().catch((err) => {
    try { printError(String((err && err.message) || err)); } catch { }
    finish(1);
  });
  return main;
}

const USAGE_DEVWEB = "Usage: npm run dev:web -- --profile <name>\n" + "  Build, register, and launch the selected DSH profile.\n" + "  --profile <name>   required; an existing profile (never created here)";
const DEVWEB_TARGET_PREFIX = "ocms-s dev:web: target profile ";
const DEVWEB_SIGINT_CODE = 130;
const DEVWEB_SIGTERM_CODE = 143;

export function parseDevWebArgs(argv) {
  if (!Array.isArray(argv) || argv.length === 0) {
    throw new Error(USAGE_DEVWEB);
  }
  if (argv[0] !== "--profile") {
    throw new Error("unknown option " + JSON.stringify(argv[0]) + "\n" + USAGE_DEVWEB);
  }
  if (argv.length < 2) {
    throw new Error("missing value for --profile\n" + USAGE_DEVWEB);
  }
  const value = argv[1];
  if (typeof value !== "string" || value.length === 0 || value.charAt(0) === "-") {
    throw new Error("invalid value for --profile\n" + USAGE_DEVWEB);
  }
  if (argv.length > 2) {
    throw new Error("duplicate or unexpected argument " + JSON.stringify(argv[2]) + "\n" + USAGE_DEVWEB);
  }
  return { profile: value };
}

export function startForeground(file, args, cwd, env) {
  const child = spawn(file, args, { stdio: "inherit", shell: false, detached: false, cwd: cwd || undefined, env: env || process.env });
  const done = new Promise((resolve) => {
    child.on("error", (err) => resolve({ code: 127, stderr: String(err) }));
    child.on("exit", (code, signal) => {
      if (typeof code === "number") { resolve({ code }); }
      else { resolve({ code: null, signal: signal || "unknown" }); }
    });
  });
  return { child, done };
}

function defaultRegisterStage(args) {
  const done = (async () => {
    const code = await runRegister({
      argv: ["--profile", args.profile],
      env: args.env,
      repoRoot: args.repoRoot,
      print: args.print,
      printError: args.printError,
      ...(args.registerDeps || {}),
      onChild: (c) => { try { args.track(c); } catch { } },
      isCancelled: args.isCancelled || null,
    });
    return { code };
  })();
  return { done };
}

export function runDevWeb(options) {
  const opts = options || {};
  const env = opts.env || process.env;
  const repoRoot = opts.repoRoot || "";
  const print = opts.print || ((msg) => console.log(msg));
  const printError = opts.printError || ((msg) => console.error(msg));
  const startBuild = opts.startBuild || ((root, _env) => startCanonicalBuild(root, _env || env));
  const registerStage = opts.registerStage || defaultRegisterStage;
  const findDsh = opts.findDsh || findDshExecutable;
  const resolveLaunch = opts.resolveLaunch || resolveDshLaunch;
  const startLaunch = opts.startLaunch || ((file, args) => startForeground(file, args, repoRoot, env));
  const state = { shuttingDown: false, cancelled: false, cancelSignal: "", activeChild: null, signaled: [], settled: false, finalCode: 0 };
  let resolveMain = null;
  const main = new Promise((resolve) => { resolveMain = resolve; });
  function cancelCode() {
    return state.cancelSignal === "SIGTERM" ? DEVWEB_SIGTERM_CODE : DEVWEB_SIGINT_CODE;
  }
  function track(child) {
    if (!child || state.settled) { return; }
    state.activeChild = child;
    if (state.shuttingDown && state.signaled.indexOf(child) === -1) {
      state.signaled.push(child);
      try { child.kill(); } catch { }
    }
  }
  function signalOwned() {
    const current = state.activeChild;
    if (current && state.signaled.indexOf(current) === -1) {
      state.signaled.push(current);
      try { current.kill(); } catch { }
    }
  }
  function finish(code) {
    if (state.settled) { return; }
    state.settled = true;
    state.finalCode = code;
    resolveMain(code);
  }
  async function shutdown(signalName) {
    if (state.settled) { return state.finalCode; }
    if (state.shuttingDown) { await main; return state.finalCode; }
    state.shuttingDown = true;
    state.cancelled = true;
    state.cancelSignal = signalName || "SIGINT";
    signalOwned();
    await main;
    return state.finalCode;
  }
  function beginBuild() {
    try {
      return startBuild(repoRoot);
    } catch (err) {
      return { child: null, done: Promise.resolve({ code: 1, stdout: "", stderr: String((err && err.message) || err) }) };
    }
  }
  async function flow() {
    let profile;
    try {
      profile = parseDevWebArgs(opts.argv === undefined ? [] : opts.argv).profile;
      validateProfileName(profile);
    } catch (err) {
      printError(String((err && err.message) || err));
      finish(1);
      return;
    }
    print(DEVWEB_TARGET_PREFIX + JSON.stringify(profile));
    const built = beginBuild();
    state.activeChild = built.child || null;
    let buildRes = null;
    try {
      buildRes = await built.done;
    } catch (err) {
      buildRes = { code: 1, stdout: "", stderr: String((err && err.message) || err) };
    } finally {
      state.activeChild = null;
    }
    if (state.cancelled) { finish(cancelCode()); return; }
    if (!buildRes || buildRes.code !== 0) {
      const out = String(((buildRes && buildRes.stdout) || "") + ((buildRes && buildRes.stderr) || ""));
      if (out.length > 0) { printError(out); }
      finish(buildRes && typeof buildRes.code === "number" ? buildRes.code : 1);
      return;
    }
    if (buildRes.stdout && buildRes.stdout.trim().length > 0) {
      print(buildRes.stdout.trim());
    }
    const reg = registerStage({ profile, env, repoRoot, print, printError, track, registerDeps: opts.registerDeps || {}, isCancelled: () => state.cancelled });
    let regRes = null;
    try {
      regRes = await reg.done;
    } catch (err) {
      regRes = { code: 1 };
    } finally {
      state.activeChild = null;
    }
    if (state.cancelled) { finish(cancelCode()); return; }
    if (!regRes || regRes.code !== 0) {
      finish(regRes && typeof regRes.code === "number" ? regRes.code : 1);
      return;
    }
    const shim = await findDsh(env);
    if (!shim) {
      printError("ocms-s dev:web: dsh executable not found on PATH; install DSH 0.2.1-alpha.2 (no download attempted)");
      finish(1);
      return;
    }
    const launch = await resolveLaunch(shim);
    if (!launch || launch.shell !== false || typeof launch.file !== "string" || !Array.isArray(launch.argsPrefix)) {
      printError("ocms-s dev:web: dsh launcher is not a safely invocable installation; refusing without shell fallback");
      finish(1);
      return;
    }
    if (state.cancelled) { finish(cancelCode()); return; }
    const started = startLaunch(launch.file, launch.argsPrefix.concat(["--profile", profile, "--no-open"]));
    state.activeChild = started.child || null;
    let webRes = null;
    try {
      webRes = await started.done;
    } catch (err) {
      webRes = { code: 1 };
    } finally {
      state.activeChild = null;
    }
    if (state.cancelled) { finish(cancelCode()); return; }
    if (!webRes || typeof webRes.code !== "number") {
      printError("ocms-s dev:web: child terminated by " + String((webRes && webRes.signal) || "signal"));
      finish(1);
      return;
    }
    finish(webRes.code);
  }
  main.shutdown = shutdown;
  flow().catch((err) => {
    try { printError(String((err && err.message) || err)); } catch { }
    finish(1);
  });
  return main;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
const invokedAsMain = invokedPath === fileURLToPath(import.meta.url);
if (invokedAsMain) {
  const cliArgs = process.argv.slice(2);
  const sub = cliArgs[0];
  if (sub === "build") {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const code = await runBuild({ argv: cliArgs.slice(1), env: process.env, repoRoot: root });
    process.exitCode = code;
  } else if (sub === "register") {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const code = await runRegister({ argv: cliArgs.slice(1), env: process.env, repoRoot: root });
    process.exitCode = code;
  } else if (sub === "watch") {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const handle = runWatch({ argv: cliArgs.slice(1), repoRoot: root });
    const onWatchSignal = () => { void handle.stop(); };
    process.on("SIGINT", onWatchSignal);
    process.on("SIGTERM", onWatchSignal);
    const watchCode = await handle;
    process.removeListener("SIGINT", onWatchSignal);
    process.removeListener("SIGTERM", onWatchSignal);
    process.exitCode = watchCode;
  } else if (sub === "dev:web") {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const handle = runDevWeb({ argv: cliArgs.slice(1), env: process.env, repoRoot: root });
    const onDevSigInt = () => { void handle.shutdown("SIGINT"); };
    const onDevSigTerm = () => { void handle.shutdown("SIGTERM"); };
    process.on("SIGINT", onDevSigInt);
    process.on("SIGTERM", onDevSigTerm);
    const devCode = await handle;
    process.removeListener("SIGINT", onDevSigInt);
    process.removeListener("SIGTERM", onDevSigTerm);
    process.exitCode = devCode;
  } else {
    console.error("ocms-s dev-tools: unknown subcommand " + JSON.stringify(sub || "") + "\n" + USAGE_DEV_TOOLS);
    process.exitCode = 1;
  }
}
