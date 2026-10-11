import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execSync, spawnSync } from "node:child_process";
import { readFile, writeFile, mkdir, mkdtemp, rm, chmod, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const CANONICAL_BUILD = "node dsh/build-client.mjs";

function runNpmBuild(cwd) {
  return execSync("npm run build", { cwd, stdio: "pipe", encoding: "utf8", timeout: 90000 });
}

describe("DX-1 deterministic cross-platform build", () => {
  it("package exposes canonical build command", async () => {
    const raw = await readFile(join(ROOT, "package.json"), "utf8");
    const pkg = JSON.parse(raw);
    assert.equal(pkg.scripts && pkg.scripts.build, CANONICAL_BUILD, "scripts.build must be exactly the canonical builder");
  });

  it("build command is exactly the direct canonical invocation (structural safety)", async () => {
    const pkg = JSON.parse(await readFile(join(ROOT, "package.json"), "utf8"));
    const cmd = pkg.scripts && pkg.scripts.build;
    assert.equal(cmd, CANONICAL_BUILD, "build must equal canonical command");
    assert.ok(!cmd.includes("--profile"), "build must not mention profile");
    assert.ok(!cmd.includes("dsh ") && !cmd.includes("plugin"), "build must not invoke dsh");
    assert.ok(!cmd.includes("settings"), "build must not reference settings");
    assert.ok(!cmd.includes("&&") && !cmd.includes(";") && !cmd.includes("|"), "build must be a single direct invocation");
  });

  it("npm build succeeds and is deterministic", { timeout: 120000 }, async () => {
    const target = join(ROOT, "dsh", "client.js");
    const before = await readFile(target);
    runNpmBuild(ROOT);
    const after1 = await readFile(target);
    runNpmBuild(ROOT);
    const after2 = await readFile(target);
    assert.ok(after1.equals(after2), "repeated builds must be byte-identical");
    assert.ok(before.equals(after1), "build from unchanged input must match committed output");
  });

  it("failure propagates non-zero on invalid builder input (isolated fixture)", { timeout: 120000 }, async () => {
    const pkg = JSON.parse(await readFile(join(ROOT, "package.json"), "utf8"));
    const buildCmd = pkg.scripts && pkg.scripts.build;
    assert.equal(buildCmd, CANONICAL_BUILD, "fixture uses the SAME scripts.build value");
    const tmp = await mkdtemp(join(tmpdir(), "ocms-dx1-"));
    try {
      await mkdir(join(tmp, "dsh"), { recursive: true });
      const builder = await readFile(join(ROOT, "dsh", "build-client.mjs"), "utf8");
      await writeFile(join(tmp, "dsh", "build-client.mjs"), builder, "utf8");
      await writeFile(join(tmp, "dsh", "client.mjs"), "import foo from " + JSON.stringify("bar") + ";" + "\n" + "const x = 1;" + "\n", "utf8");
      const fixturePkg = { name: "ocms-dx1-fixture", private: true, type: "module", scripts: { build: buildCmd } };
      await writeFile(join(tmp, "package.json"), JSON.stringify(fixturePkg, null, 2) + "\n", "utf8");
      let failed = false;
      try {
        runNpmBuild(tmp);
      } catch (err) {
        failed = true;
        assert.ok(err.status !== 0 && err.status !== undefined, "npm build must exit non-zero");
      }
      assert.ok(failed, "invalid builder input must make npm run build fail");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

describe("DX-2 explicit-profile local registration", () => {
  const DEVTOOLS = join(ROOT, "scripts", "dev-tools.mjs");
  const CANONICAL_REGISTER = "node scripts/dev-tools.mjs register";
  const BS = String.fromCharCode(92);
  const TARGET_PREFIX = "ocms-s register: target profile ";
  function runCli(args, envExtra) {
    const env = Object.assign({}, process.env, envExtra);
    return spawnSync(process.execPath, [DEVTOOLS].concat(args), { env, encoding: "utf8", timeout: 60000 });
  }
  async function makeHome() {
    return await mkdtemp(join(tmpdir(), "ocms-dx2-"));
  }
  async function makeProfile(home, name) {
    const dir = join(home, "profiles", name);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "package.json"), JSON.stringify({ name: "dsh-profile-" + name, private: true }) + "\n", "utf8");
    return dir;
  }
  async function dirAbsent(p) {
    try { await stat(p); return false; } catch { return true; }
  }
  async function makeFakeBin() {
    const bin = await mkdtemp(join(tmpdir(), "ocms-dx2bin-"));
    const log = join(bin, "argv.log");
    const pkgDir = join(bin, "node_modules", "@deepseek-ai", "dsh");
    await mkdir(join(pkgDir, "lib"), { recursive: true });
    const src = "const fs = require(" + JSON.stringify("node:fs") + ");\n"
      + "const out = process.env[" + JSON.stringify("OCMS_FAKE_DSH_LOG") + "];\n"
      + "const code = Number(process.env[" + JSON.stringify("OCMS_FAKE_DSH_EXIT") + "] || " + JSON.stringify("0") + ");\n"
      + "fs.appendFileSync(out, JSON.stringify(process.argv.slice(2)) + " + JSON.stringify("\n") + ");\n"
      + "process.exit(code);\n";
    await writeFile(join(pkgDir, "lib", "bin.js"), src, "utf8");
    const fakePkg = { name: "@deepseek-ai/dsh", version: "0.0.0-test", bin: { dsh: "lib/bin.js" } };
    await writeFile(join(pkgDir, "package.json"), JSON.stringify(fakePkg, null, 2) + "\n", "utf8");
    await writeFile(join(bin, "dsh.cmd"), "@echo off\nrem fake npm shim\n", "utf8");
    await writeFile(join(bin, "dsh"), "#!/bin/sh\n# fake shim\n", "utf8");
    try { await chmod(join(bin, "dsh"), 0o755); } catch { }
    return { bin, log };
  }
  function binFirst(bin) {
    const sep = process.platform === "win32" ? ";" : ":";
    return bin + sep + process.env.PATH;
  }
  it("package exposes canonical register command", async () => {
    const pkg = JSON.parse(await readFile(join(ROOT, "package.json"), "utf8"));
    assert.equal(pkg.scripts && pkg.scripts.register, CANONICAL_REGISTER, "scripts.register must be exactly the shared CLI");
  });
  it("missing profile fails before any DSH invocation", { timeout: 120000 }, async () => {
    const home = await makeHome();
    try {
      let failed = false;
      try {
        execSync("npm run register", { cwd: ROOT, env: Object.assign({}, process.env, { DSH_HOME: home }), stdio: "pipe", encoding: "utf8", timeout: 60000 });
      } catch (err) {
        failed = true;
        const out = String((err.stdout || "") + (err.stderr || ""));
        assert.ok(out.includes("--profile"), "usage must name the mandatory flag");
      }
      assert.ok(failed, "npm run register without profile must fail");
      assert.ok(await dirAbsent(join(home, "profiles")), "no profile directory may be created");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
  it("missing profile value fails", async () => {
    const home = await makeHome();
    try {
      const a = runCli(["register", "--profile"], { DSH_HOME: home });
      assert.notEqual(a.status, 0, "bare flag must fail");
      assert.ok(String(a.stdout + a.stderr).includes("--profile"), "usage on bare flag");
      const b = runCli(["register", "--profile", "--other"], { DSH_HOME: home });
      assert.notEqual(b.status, 0, "option-like value must fail");
      assert.ok(String(b.stdout + b.stderr).includes("--profile"), "usage on option-like value");
      assert.ok(await dirAbsent(join(home, "profiles")), "no profile directory may be created");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
  it("malformed profile names are rejected", async () => {
    const mod = await import(pathToFileURL(DEVTOOLS).href);
    const bad = ["", "-web", ".", "..", "node_modules", "a/b", "a" + BS + "b", "desktop", "DESKTOP", "Desktop", "has space", "semi;colon", "star*star"];
    for (const name of bad) {
      assert.throws(() => mod.validateProfileName(name), Error, "must reject " + JSON.stringify(name));
    }
    assert.throws(() => mod.validateProfileName("x".repeat(65)), Error, "must reject overlong names");
    assert.equal(mod.validateProfileName("dev-ocms"), "dev-ocms", "valid name passes through unchanged");
  });
  it("malformed profile fails at the CLI before mutation", async () => {
    const home = await makeHome();
    try {
      const r = runCli(["register", "--profile", "-web"], { DSH_HOME: home });
      assert.notEqual(r.status, 0, "leading-dash profile must fail");
      assert.ok(String(r.stdout + r.stderr).includes("--profile"), "usage on malformed profile");
      assert.ok(await dirAbsent(join(home, "profiles")), "no profile directory may be created");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
  it("explicit target preserved exactly", async () => {
    const mod = await import(pathToFileURL(DEVTOOLS).href);
    assert.equal(mod.parseRegisterArgs(["--profile", "dev-ocms"]).profile, "dev-ocms", "exact profile preserved");
    assert.throws(() => mod.parseRegisterArgs([]), Error, "missing args rejected");
    assert.throws(() => mod.parseRegisterArgs(["--unknown"]), Error, "unknown option rejected");
    assert.throws(() => mod.parseRegisterArgs(["--profile", "a", "--profile", "b"]), Error, "duplicate flag rejected");
    assert.throws(() => mod.parseRegisterArgs(["--profile=a"]), Error, "equals form rejected");
  });
  it("DSH unavailable fails safely", async () => {
    const home = await makeHome();
    const emptyBin = await mkdtemp(join(tmpdir(), "ocms-dx2empty-"));
    try {
      await makeProfile(home, "dev-ocms");
      const r = runCli(["register", "--profile", "dev-ocms"], { DSH_HOME: home, PATH: emptyBin });
      assert.notEqual(r.status, 0, "missing DSH must fail");
      const out = String(r.stdout + r.stderr);
      assert.ok(out.toLowerCase().includes("dsh"), "error names DSH");
      assert.ok(out.toLowerCase().includes("not found"), "error reports unavailability");
      assert.ok(out.includes("dev-ocms"), "target printed even when DSH is missing");
    } finally {
      await rm(home, { recursive: true, force: true });
      await rm(emptyBin, { recursive: true, force: true });
    }
  });
  it("nonexistent profile fails before plugin add", async () => {
    const home = await makeHome();
    try {
      const r = runCli(["register", "--profile", "nope-missing-1"], { DSH_HOME: home });
      assert.notEqual(r.status, 0, "missing profile must fail");
      const out = String(r.stdout + r.stderr);
      assert.ok(out.includes("nope-missing-1"), "error names the profile");
      assert.ok(out.toLowerCase().includes("does not exist"), "clear not-found error");
      assert.ok(await dirAbsent(join(home, "profiles", "nope-missing-1")), "profile directory remains nonexistent");
      assert.ok(!out.includes("initialized profile"), "DSH auto-init must not have run");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
  it("exact mutation argv uses absolute repo root", { timeout: 60000 }, async () => {
    const home = await makeHome();
    const fake = await makeFakeBin();
    try {
      await makeProfile(home, "dev-ocms");
      const env = { DSH_HOME: home, PATH: binFirst(fake.bin), OCMS_FAKE_DSH_LOG: fake.log };
      const r = runCli(["register", "--profile", "dev-ocms"], env);
      assert.equal(r.status, 0, "happy path exits zero: " + String(r.stdout + r.stderr).slice(0, 500));
      const lines = (await readFile(fake.log, "utf8")).trim().split("\n");
      assert.equal(lines.length, 1, "exactly one DSH invocation");
      const argv = JSON.parse(lines[0]);
      assert.deepEqual(argv, ["plugin", "--profile", "dev-ocms", "add", ROOT], "exact frozen argv");
      assert.ok(argv[4] !== "." && argv[4].includes("ocms-s"), "absolute repo root, not relative");
    } finally {
      await rm(home, { recursive: true, force: true });
      await rm(fake.bin, { recursive: true, force: true });
    }
  });
  it("selected target printed before mutation", { timeout: 60000 }, async () => {
    const mod = await import(pathToFileURL(DEVTOOLS).href);
    const events = [];
    const code = await mod.runRegister({
      argv: ["--profile", "dev-ocms"],
      env: process.env,
      repoRoot: ROOT,
      print: (msg) => events.push("print:" + msg),
      findDsh: async () => "fake-dsh",
      resolveLaunch: async () => ({ file: "fake-dsh", argsPrefix: [], shell: false }),
      profileExists: async () => true,
      spawnFn: async () => { events.push("spawn"); return 0; },
      readPackageName: () => "ocms-s"
    });
    assert.equal(code, 0, "injected run succeeds");
    assert.equal(events.length, 2, "print then single spawn");
    assert.ok(events[0].startsWith("print:") && events[0].includes("dev-ocms"), "target disclosed first");
    assert.equal(events[1], "spawn", "mutation second");
    const home = await makeHome();
    const fake = await makeFakeBin();
    try {
      await makeProfile(home, "dev-ocms");
      const r = runCli(["register", "--profile", "dev-ocms"], { DSH_HOME: home, PATH: binFirst(fake.bin), OCMS_FAKE_DSH_LOG: fake.log });
      assert.equal(r.status, 0, "cli happy path exits zero");
      assert.ok(String(r.stdout).includes(TARGET_PREFIX + JSON.stringify("dev-ocms")), "stdout carries the target line");
    } finally {
      await rm(home, { recursive: true, force: true });
      await rm(fake.bin, { recursive: true, force: true });
    }
  });
  it("underlying DSH failure propagates", { timeout: 60000 }, async () => {
    const home = await makeHome();
    const fake = await makeFakeBin();
    try {
      await makeProfile(home, "dev-ocms");
      const r = runCli(["register", "--profile", "dev-ocms"], { DSH_HOME: home, PATH: binFirst(fake.bin), OCMS_FAKE_DSH_LOG: fake.log, OCMS_FAKE_DSH_EXIT: "3" });
      assert.equal(r.status, 3, "exit code propagates exactly");
    } finally {
      await rm(home, { recursive: true, force: true });
      await rm(fake.bin, { recursive: true, force: true });
    }
  });
  it("no implicit web", { timeout: 60000 }, async () => {
    const home = await makeHome();
    const fake = await makeFakeBin();
    try {
      const r = runCli(["register"], { DSH_HOME: home, PATH: binFirst(fake.bin), OCMS_FAKE_DSH_LOG: fake.log });
      assert.notEqual(r.status, 0, "missing profile fails");
      assert.ok(await dirAbsent(fake.log), "no DSH invocation without explicit profile");
      assert.ok(await dirAbsent(join(home, "profiles")), "no profile created");
    } finally {
      await rm(home, { recursive: true, force: true });
      await rm(fake.bin, { recursive: true, force: true });
    }
    const src = await readFile(DEVTOOLS, "utf8");
    assert.ok(!src.includes("web"), "implementation carries no default");
  });
  it("metacharacter repo root arrives as one literal argument", { timeout: 120000 }, async () => {
    const trap = "OCMS_DX2_SENTINEL";
    const nasty = "OCMS & Test (1) %" + trap + "%";
    const base = await mkdtemp(join(tmpdir(), "ocms-dx2m-"));
    const metaRoot = join(base, nasty, "ocms-s");
    const sentinelDir = join(base, "cwd");
    const sentinelPath = join(sentinelDir, "dx2-sentinel.txt");
    await mkdir(join(metaRoot, "scripts"), { recursive: true });
    await mkdir(sentinelDir, { recursive: true });
    await writeFile(join(metaRoot, "scripts", "dev-tools.mjs"), await readFile(DEVTOOLS, "utf8"), "utf8");
    await writeFile(join(metaRoot, "package.json"), JSON.stringify({ name: "ocms-s", private: true }) + "\n", "utf8");
    const home = await makeHome();
    const fake = await makeFakeBin();
    try {
      await makeProfile(home, "dev-ocms");
      const copyCli = join(metaRoot, "scripts", "dev-tools.mjs");
      const env = Object.assign({}, process.env, { DSH_HOME: home, PATH: binFirst(fake.bin), OCMS_FAKE_DSH_LOG: fake.log });
      env[trap] = "EXPANDED";
      const r = spawnSync(process.execPath, [copyCli, "register", "--profile", "dev-ocms"], { cwd: sentinelDir, env, encoding: "utf8", timeout: 60000 });
      assert.equal(r.status, 0, "metachar checkout registers: " + String(r.stdout + r.stderr).slice(0, 800));
      assert.ok(String(r.stdout).includes("dev-ocms"), "target printed");
      const lines = (await readFile(fake.log, "utf8")).trim().split("\n");
      assert.equal(lines.length, 1, "exactly one DSH invocation");
      assert.deepEqual(JSON.parse(lines[0]), ["plugin", "--profile", "dev-ocms", "add", metaRoot], "repo root is one literal argv value");
      assert.ok(await dirAbsent(sentinelPath), "no shell fragment may execute");
    } finally {
      await rm(base, { recursive: true, force: true });
      await rm(home, { recursive: true, force: true });
      await rm(fake.bin, { recursive: true, force: true });
    }
  });
  it("launcher resolves shim without shell", async () => {
    const mod = await import(pathToFileURL(DEVTOOLS).href);
    const fake = await makeFakeBin();
    try {
      const shim = join(fake.bin, process.platform === "win32" ? "dsh.cmd" : "dsh");
      const launch = await mod.resolveDshLaunch(shim);
      assert.ok(launch, "shim resolves");
      assert.equal(launch.shell, false, "never shell:true");
      assert.ok(!launch.file.toLowerCase().endsWith(".cmd"), "does not execute the shim itself");
      assert.equal(launch.argsPrefix.length, 1, "single entry prefix");
      const exePath = join(fake.bin, "tool.exe");
      assert.deepEqual(await mod.resolveDshLaunch(exePath), { file: exePath, argsPrefix: [], shell: false }, "native executable direct");
    } finally {
      await rm(fake.bin, { recursive: true, force: true });
    }
  });
  it("unresolvable shim fails closed", async () => {
    const mod = await import(pathToFileURL(DEVTOOLS).href);
    const lonely = await mkdtemp(join(tmpdir(), "ocms-dx2l-"));
    try {
      await writeFile(join(lonely, "dsh.cmd"), "@echo off\n", "utf8");
      assert.equal(await mod.resolveDshLaunch(join(lonely, "dsh.cmd")), null, "no metadata means no launch");
      const events = [];
      const code = await mod.runRegister({
        argv: ["--profile", "dev-ocms"],
        env: process.env,
        repoRoot: ROOT,
        print: (msg) => events.push("print:" + msg),
        findDsh: async () => join(lonely, "dsh.cmd"),
        resolveLaunch: async () => null,
        profileExists: async () => true,
        spawnFn: async () => { events.push("spawn"); return 0; },
        readPackageName: () => "ocms-s"
      });
      assert.notEqual(code, 0, "fails closed");
      assert.ok(!events.includes("spawn"), "no spawn without safe launch");
    } finally {
      await rm(lonely, { recursive: true, force: true });
    }
  });
});

  it("package exposes watch command", async () => {
    const CANONICAL_WATCH = "node scripts/dev-tools.mjs watch";
    const pkg = JSON.parse(await readFile(join(ROOT, "package.json"), "utf8"));
    assert.equal(pkg.scripts && pkg.scripts.watch, CANONICAL_WATCH, "scripts.watch must be exactly the shared CLI");
  });

describe("DX-3 cross-platform watch and rebuild", () => {
  const DEVTOOLS = join(ROOT, "scripts", "dev-tools.mjs");
  const REBUILT_LINE = "ocms-s watch: rebuilt dsh/client.js";
  const FAILED_LINE = "ocms-s watch: build failed (watching continues)";
  async function makeWatchFixture() {
    const root = await mkdtemp(join(tmpdir(), "ocms-dx3-"));
    await mkdir(join(root, "dsh"), { recursive: true });
    const builderSrc = await readFile(join(ROOT, "dsh", "build-client.mjs"), "utf8");
    await writeFile(join(root, "dsh", "build-client.mjs"), builderSrc, "utf8");
    await writeFile(join(root, "dsh", "client.mjs"), "export const MARK = 1;\n", "utf8");
    return root;
  }
  async function waitFor(fn, timeout) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      let ok = false;
      try { ok = await fn(); } catch { ok = false; }
      if (ok) { return true; }
      await new Promise((r) => setTimeout(r, 25));
    }
    try { return await fn(); } catch { return false; }
  }
  async function settled(ms) {
    await new Promise((r) => setTimeout(r, ms));
  }
  function stubWatch() {
    const rec = { paths: [], listeners: [], closed: 0 };
    const fn = (p, l) => { rec.paths.push(p); rec.listeners.push(l); return { close() { rec.closed += 1; } }; };
    return { rec, fn };
  }
  function deferredBuilder() {
    const rec = { count: 0, max: 0, active: 0, releases: [] };
    const fn = () => {
      rec.count += 1;
      rec.active += 1;
      if (rec.active > rec.max) { rec.max = rec.active; }
      let rel = null;
      const done = new Promise((r) => { rel = r; });
      rec.releases.push((res) => { rec.active -= 1; rel(res); });
      const child = { killed: 0, kill() { this.killed += 1; return true; } };
      return { child, done };
    };
    return { rec, fn };
  }
  function okBuilder() {
    return () => ({ child: null, done: Promise.resolve({ code: 0, stdout: "", stderr: "" }) });
  }
  it("watch rejects forwarded arguments", async () => {
    const mod = await import(pathToFileURL(DEVTOOLS).href);
    for (const extra of [["--profile", "dev-ocms"], ["--anything"]]) {
      let builds = 0;
      let watches = 0;
      let usage = "";
      const h = mod.runWatch({ argv: extra, repoRoot: ROOT, print: () => {}, printError: (m) => { usage += m; }, startBuild: () => { builds += 1; return { child: null, done: Promise.resolve({ code: 0, stdout: "", stderr: "" }) }; }, watchFile: () => { watches += 1; return { close() {} }; } });
      const code = await h;
      assert.notEqual(code, 0, "extra argv must fail");
      assert.ok(usage.includes("Usage"), "usage on extra argv");
      assert.equal(builds, 0, "zero builds on rejected argv");
      assert.equal(watches, 0, "zero watchers on rejected argv");
    }
  });
  it("watch CLI rejects profile forwarding", async () => {
    const r = spawnSync(process.execPath, [DEVTOOLS, "watch", "--profile", "dev-ocms"], { encoding: "utf8", timeout: 60000 });
    assert.notEqual(r.status, 0, "profile forwarding must fail");
    assert.ok(String(r.stdout + r.stderr).includes("Usage"), "usage on profile forwarding");
    assert.ok(!String(r.stdout + r.stderr).includes("unknown subcommand"), "must reach the watch parser");
  });
  it("initial build runs exactly once before watchers", async () => {
    const mod = await import(pathToFileURL(DEVTOOLS).href);
    const events = [];
    let ready = false;
    const h = mod.runWatch({ argv: [], repoRoot: "/fake/root", print: () => {}, printError: () => {}, startBuild: () => { events.push("build"); return { child: null, done: Promise.resolve({ code: 0, stdout: "", stderr: "" }) }; }, watchFile: (p) => { events.push("watch:" + p); return { close() {} }; }, onReady: () => { ready = true; } });
    assert.ok(await waitFor(async () => ready, 2000), "watch becomes ready");
    assert.deepEqual(events, ["build", "watch:" + join("/fake/root", "dsh", "client.mjs"), "watch:" + join("/fake/root", "dsh", "build-client.mjs")], "one build then two watchers");
    assert.equal(await h.stop(), 0, "clean stop");
  });
  it("initial build failure is fatal", async () => {
    const mod = await import(pathToFileURL(DEVTOOLS).href);
    let watches = 0;
    let failure = "";
    const h = mod.runWatch({ argv: [], repoRoot: "/fake/root", print: () => {}, printError: (m) => { failure += m; }, startBuild: () => ({ child: null, done: Promise.resolve({ code: 3, stdout: "", stderr: "builder exploded" }) }), watchFile: () => { watches += 1; return { close() {} }; } });
    assert.equal(await h, 3, "initial failure code surfaces");
    assert.equal(watches, 0, "no watcher created");
    assert.ok(failure.includes("builder exploded"), "builder output surfaced");
  });
  it("exact watched input set", async () => {
    const mod = await import(pathToFileURL(DEVTOOLS).href);
    assert.equal(mod.WATCH_DEBOUNCE_MS, 150, "frozen trailing debounce");
    const seen = [];
    let ready = false;
    const h = mod.runWatch({ argv: [], repoRoot: ROOT, print: () => {}, printError: () => {}, startBuild: () => ({ child: null, done: Promise.resolve({ code: 0, stdout: "", stderr: "" }) }), watchFile: (p) => { seen.push(p); return { close() {} }; }, onReady: () => { ready = true; } });
    assert.ok(await waitFor(async () => ready, 2000), "ready");
    assert.deepEqual(seen, [join(ROOT, "dsh", "client.mjs"), join(ROOT, "dsh", "build-client.mjs")], "only the two inputs");
    assert.ok(!seen.includes(join(ROOT, "dsh", "client.js")), "output never watched");
    await h.stop();
  });
  it("relevant source change triggers rebuild", { timeout: 60000 }, async () => {
    const mod = await import(pathToFileURL(DEVTOOLS).href);
    const root = await makeWatchFixture();
    const prints = [];
    let builds = 0;
    const real = mod.startCanonicalBuild;
    const h = mod.runWatch({ argv: [], repoRoot: root, print: (m) => prints.push(m), printError: () => {}, startBuild: (r) => { builds += 1; return real(r); } });
    try {
      await settled(400);
      assert.equal(builds, 1, "initial build ran");
      await writeFile(join(root, "dsh", "client.mjs"), "export const MARK = 2;\n", "utf8");
      assert.ok(await waitFor(() => Promise.resolve(prints.includes(REBUILT_LINE)), 2000), "rebuild within bound");
      assert.equal(builds, 2, "exactly one rebuild");
    } finally {
      await h.stop();
      await settled(50);
      await rm(root, { recursive: true, force: true });
    }
  });
  it("builder-source change triggers rebuild", { timeout: 60000 }, async () => {
    const mod = await import(pathToFileURL(DEVTOOLS).href);
    const root = await makeWatchFixture();
    const prints = [];
    const real = mod.startCanonicalBuild;
    const h = mod.runWatch({ argv: [], repoRoot: root, print: (m) => prints.push(m), printError: () => {}, startBuild: (r) => real(r) });
    try {
      await settled(400);
      const builderPath = join(root, "dsh", "build-client.mjs");
      await writeFile(builderPath, (await readFile(builderPath, "utf8")) + "\n// touch\n", "utf8");
      assert.ok(await waitFor(() => Promise.resolve(prints.includes(REBUILT_LINE)), 2000), "builder edit rebuilds");
    } finally {
      await h.stop();
      await settled(50);
      await rm(root, { recursive: true, force: true });
    }
  });
  it("output write does not trigger", { timeout: 60000 }, async () => {
    const mod = await import(pathToFileURL(DEVTOOLS).href);
    const root = await makeWatchFixture();
    const prints = [];
    let builds = 0;
    const real = mod.startCanonicalBuild;
    const h = mod.runWatch({ argv: [], repoRoot: root, print: (m) => prints.push(m), printError: () => {}, startBuild: (r) => { builds += 1; return real(r); } });
    try {
      await settled(400);
      await writeFile(join(root, "dsh", "client.js"), (await readFile(join(root, "dsh", "client.js"), "utf8")) + "\n// out\n", "utf8");
      await settled(500);
      assert.equal(builds, 1, "no rebuild for output write");
      assert.ok(!prints.includes(REBUILT_LINE), "no rebuild line");
    } finally {
      await h.stop();
      await settled(50);
      await rm(root, { recursive: true, force: true });
    }
  });
  it("unrelated file does not trigger", { timeout: 60000 }, async () => {
    const mod = await import(pathToFileURL(DEVTOOLS).href);
    const root = await makeWatchFixture();
    let builds = 0;
    const real = mod.startCanonicalBuild;
    const h = mod.runWatch({ argv: [], repoRoot: root, print: () => {}, printError: () => {}, startBuild: (r) => { builds += 1; return real(r); } });
    try {
      await settled(400);
      await writeFile(join(root, "other.txt"), "hello\n", "utf8");
      await settled(500);
      assert.equal(builds, 1, "no rebuild for unrelated file");
    } finally {
      await h.stop();
      await settled(50);
      await rm(root, { recursive: true, force: true });
    }
  });
  it("burst collapses to one rebuild", { timeout: 60000 }, async () => {
    const mod = await import(pathToFileURL(DEVTOOLS).href);
    const root = await makeWatchFixture();
    let builds = 0;
    const real = mod.startCanonicalBuild;
    const h = mod.runWatch({ argv: [], repoRoot: root, print: () => {}, printError: () => {}, startBuild: (r) => { builds += 1; return real(r); } });
    try {
      await settled(400);
      for (let i = 0; i < 10; i += 1) {
        await writeFile(join(root, "dsh", "client.mjs"), "export const MARK = " + i + ";\n", "utf8");
        await settled(10);
      }
      assert.ok(await waitFor(() => Promise.resolve(builds >= 2), 2000), "burst rebuild ran");
      await settled(500);
      assert.ok(builds <= 2, "initial plus at most one burst rebuild, saw " + builds);
    } finally {
      await h.stop();
      await settled(50);
      await rm(root, { recursive: true, force: true });
    }
  });
  it("rebuilds serialize with max one concurrent builder", { timeout: 60000 }, async () => {
    const mod = await import(pathToFileURL(DEVTOOLS).href);
    const stub = stubWatch();
    const builder = deferredBuilder();
    const ok = { code: 0, stdout: "", stderr: "" };
    let ready = false;
    const h = mod.runWatch({ argv: [], repoRoot: "/fake/root", print: () => {}, printError: () => {}, startBuild: builder.fn, watchFile: stub.fn, debounceMs: 10, onReady: () => { ready = true; } });
    assert.ok(await waitFor(() => Promise.resolve(builder.rec.count >= 1), 2000), "initial started");
    builder.rec.releases[0](ok);
    assert.ok(await waitFor(() => Promise.resolve(ready), 2000), "ready");
    for (let i = 0; i < 5; i += 1) { stub.rec.listeners[0]("change"); }
    assert.ok(await waitFor(() => Promise.resolve(builder.rec.count >= 2), 2000), "rebuild started");
    for (let i = 0; i < 3; i += 1) { stub.rec.listeners[1]("change"); }
    await settled(50);
    assert.equal(builder.rec.max, 1, "never overlapping");
    assert.equal(builder.rec.count, 2, "events during build collapse");
    builder.rec.releases[1](ok);
    assert.ok(await waitFor(() => Promise.resolve(builder.rec.count >= 3), 2000), "trailing rebuild ran");
    assert.equal(builder.rec.max, 1, "still serialized");
    builder.rec.releases[2](ok);
    await settled(50);
    assert.equal(builder.rec.count, 3, "one trailing build only");
    assert.equal(await h.stop(), 0, "clean stop");
  });
  it("one queued slot collapses many events", { timeout: 60000 }, async () => {
    const mod = await import(pathToFileURL(DEVTOOLS).href);
    const stub = stubWatch();
    const builder = deferredBuilder();
    const ok = { code: 0, stdout: "", stderr: "" };
    let ready = false;
    const h = mod.runWatch({ argv: [], repoRoot: "/fake/root", print: () => {}, printError: () => {}, startBuild: builder.fn, watchFile: stub.fn, debounceMs: 10, onReady: () => { ready = true; } });
    assert.ok(await waitFor(() => Promise.resolve(builder.rec.count >= 1), 2000), "initial started");
    builder.rec.releases[0](ok);
    assert.ok(await waitFor(() => Promise.resolve(ready), 2000), "ready");
    stub.rec.listeners[0]("change");
    assert.ok(await waitFor(() => Promise.resolve(builder.rec.count >= 2), 2000), "rebuild active");
    for (let i = 0; i < 10; i += 1) { stub.rec.listeners[0]("change"); stub.rec.listeners[1]("change"); }
    await settled(80);
    assert.equal(builder.rec.count, 2, "no extra builds while pending");
    builder.rec.releases[1](ok);
    assert.ok(await waitFor(() => Promise.resolve(builder.rec.count >= 3), 2000), "trailing ran");
    builder.rec.releases[2](ok);
    await settled(80);
    assert.equal(builder.rec.count, 3, "exactly one trailing build");
    assert.equal(await h.stop(), 0, "clean stop");
  });
  it("rebuild failure continues watching", { timeout: 60000 }, async () => {
    const mod = await import(pathToFileURL(DEVTOOLS).href);
    const stub = stubWatch();
    const codes = [{ code: 0, stdout: "", stderr: "" }, { code: 2, stdout: "", stderr: "boom-fail" }, { code: 0, stdout: "", stderr: "" }];
    let calls = 0;
    const prints = [];
    const errors = [];
    let ready = false;
    const h = mod.runWatch({ argv: [], repoRoot: "/fake/root", print: (m) => prints.push(m), printError: (m) => errors.push(m), startBuild: () => { const res = codes[Math.min(calls, 2)]; calls += 1; return { child: null, done: Promise.resolve(res) }; }, watchFile: stub.fn, debounceMs: 10, onReady: () => { ready = true; } });
    assert.ok(await waitFor(() => Promise.resolve(ready), 2000), "ready");
    assert.equal(calls, 1, "initial only");
    stub.rec.listeners[0]("change");
    assert.ok(await waitFor(() => Promise.resolve(calls >= 2), 2000), "failed rebuild ran");
    assert.ok(errors.join("\n").includes(FAILED_LINE), "failure line emitted");
    assert.ok(errors.join("\n").includes("boom-fail"), "builder output surfaced");
    stub.rec.listeners[0]("change");
    assert.ok(await waitFor(() => Promise.resolve(calls >= 3), 2000), "later rebuild ran");
    assert.ok(prints.includes(REBUILT_LINE), "success line after recovery");
    assert.equal(await h.stop(), 0, "clean stop");
  });
  it("successful rebuild message is exact", async () => {
    const mod = await import(pathToFileURL(DEVTOOLS).href);
    const stub = stubWatch();
    const prints = [];
    let ready = false;
    const h = mod.runWatch({ argv: [], repoRoot: "/fake/root", print: (m) => prints.push(m), printError: () => {}, startBuild: okBuilder(), watchFile: stub.fn, debounceMs: 10, onReady: () => { ready = true; } });
    assert.ok(await waitFor(() => Promise.resolve(ready), 2000), "ready");
    stub.rec.listeners[0]("change");
    assert.ok(await waitFor(() => Promise.resolve(prints.length >= 1), 2000), "rebuild printed");
    assert.deepEqual(prints, [REBUILT_LINE], "exactly one exact line");
    assert.equal(await h.stop(), 0, "clean stop");
  });
  it("failed rebuild message is exact", async () => {
    const mod = await import(pathToFileURL(DEVTOOLS).href);
    const stub = stubWatch();
    let calls = 0;
    const errors = [];
    let ready = false;
    const h = mod.runWatch({ argv: [], repoRoot: "/fake/root", print: () => {}, printError: (m) => errors.push(m), startBuild: () => { calls += 1; const res = calls === 1 ? { code: 0, stdout: "", stderr: "" } : { code: 1, stdout: "", stderr: "builder-nope" }; return { child: null, done: Promise.resolve(res) }; }, watchFile: stub.fn, debounceMs: 10, onReady: () => { ready = true; } });
    assert.ok(await waitFor(() => Promise.resolve(ready), 2000), "ready");
    stub.rec.listeners[1]("change");
    assert.ok(await waitFor(() => Promise.resolve(calls >= 2), 2000), "failed rebuild ran");
    assert.deepEqual(errors, ["builder-nope", FAILED_LINE], "output plus exact line");
    assert.equal(await h.stop(), 0, "clean stop");
  });
  it("stop closes owned resources only", async () => {
    const mod = await import(pathToFileURL(DEVTOOLS).href);
    const stub = stubWatch();
    let ready = false;
    let builds = 0;
    const h = mod.runWatch({ argv: [], repoRoot: "/fake/root", print: () => {}, printError: () => {}, startBuild: () => { builds += 1; return { child: null, done: Promise.resolve({ code: 0, stdout: "", stderr: "" }) }; }, watchFile: stub.fn, debounceMs: 10, onReady: () => { ready = true; } });
    assert.ok(await waitFor(() => Promise.resolve(ready), 2000), "ready");
    assert.equal(stub.rec.closed, 0, "open while running");
    assert.equal(await h.stop(), 0, "stop exits zero");
    assert.equal(stub.rec.closed, 2, "both watchers closed");
    stub.rec.listeners[0]("change");
    stub.rec.listeners[1]("change");
    await settled(80);
    assert.equal(builds, 1, "no build after stop");
  });
  it("stop during active build signals only the owned child", { timeout: 60000 }, async () => {
    const mod = await import(pathToFileURL(DEVTOOLS).href);
    const stub = stubWatch();
    const builder = deferredBuilder();
    const ok = { code: 0, stdout: "", stderr: "" };
    let ready = false;
    let owned = null;
    const h = mod.runWatch({ argv: [], repoRoot: "/fake/root", print: () => {}, printError: () => {}, startBuild: () => { const s = builder.fn(); owned = s.child; return s; }, watchFile: stub.fn, debounceMs: 10, onReady: () => { ready = true; } });
    assert.ok(await waitFor(() => Promise.resolve(builder.rec.count >= 1), 2000), "initial started");
    builder.rec.releases[0](ok);
    assert.ok(await waitFor(() => Promise.resolve(ready), 2000), "ready");
    stub.rec.listeners[0]("change");
    assert.ok(await waitFor(() => Promise.resolve(builder.rec.count >= 2), 2000), "rebuild active");
    const stopping = h.stop();
    await settled(20);
    assert.equal(owned.killed, 1, "owned child signaled once");
    assert.equal(builder.rec.max, 1, "no foreign build");
    builder.rec.releases[1](ok);
    assert.equal(await stopping, 0, "shutdown settles clean");
    assert.equal(stub.rec.closed, 2, "watchers closed");
  });
  it("zero DSH interaction", { timeout: 60000 }, async () => {
    const mod = await import(pathToFileURL(DEVTOOLS).href);
    const root = await makeWatchFixture();
    const prints = [];
    let builds = 0;
    const real = mod.startCanonicalBuild;
    const savedPath = process.env.PATH;
    const savedHome = process.env.DSH_HOME;
    const emptyDir = await mkdtemp(join(tmpdir(), "ocms-dx3empty-"));
    process.env.PATH = emptyDir;
    process.env.DSH_HOME = join(root, "no-home");
    const h = mod.runWatch({ argv: [], repoRoot: root, print: (m) => prints.push(m), printError: () => {}, startBuild: (r) => { builds += 1; return real(r); } });
    try {
      await settled(400);
      await writeFile(join(root, "dsh", "client.mjs"), "export const MARK = 9;\n", "utf8");
      assert.ok(await waitFor(() => Promise.resolve(prints.includes(REBUILT_LINE)), 2000), "rebuilds without DSH");
      assert.ok(builds >= 2, "builds ran");
    } finally {
      if (savedPath === undefined) { delete process.env.PATH; } else { process.env.PATH = savedPath; }
      if (savedHome === undefined) { delete process.env.DSH_HOME; } else { process.env.DSH_HOME = savedHome; }
      await h.stop();
      await settled(50);
      await rm(emptyDir, { recursive: true, force: true });
      await rm(root, { recursive: true, force: true });
    }
  });
});
