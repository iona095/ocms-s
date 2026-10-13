import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execSync, spawnSync, spawn } from "node:child_process";
import { readFile, writeFile, mkdir, mkdtemp, rm, chmod, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { EventEmitter } from "node:events";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const CANONICAL_BUILD = "node scripts/dev-tools.mjs build";

function runNpmBuild(cwd) {
  return execSync("npm run build", { cwd, stdio: "pipe", encoding: "utf8", timeout: 90000 });
}

describe("DX-1 deterministic cross-platform build", () => {
  it("package exposes canonical build command", async () => {
    const raw = await readFile(join(ROOT, "package.json"), "utf8");
    const pkg = JSON.parse(raw);
    assert.equal(pkg.scripts && pkg.scripts.build, CANONICAL_BUILD, "scripts.build must delegate to the shared CLI");
  });

  it("build command is exactly the direct canonical invocation (structural safety)", async () => {
    const pkg = JSON.parse(await readFile(join(ROOT, "package.json"), "utf8"));
    const cmd = pkg.scripts && pkg.scripts.build;
    assert.equal(cmd, CANONICAL_BUILD, "build must equal shared CLI command");
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
      await mkdir(join(tmp, "scripts"), { recursive: true });
      const builder = await readFile(join(ROOT, "dsh", "build-client.mjs"), "utf8");
      await writeFile(join(tmp, "dsh", "build-client.mjs"), builder, "utf8");
      const cli = await readFile(join(ROOT, "scripts", "dev-tools.mjs"), "utf8");
      await writeFile(join(tmp, "scripts", "dev-tools.mjs"), cli, "utf8");
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
  it("empty build argv is valid", async () => {
    const mod = await import(pathToFileURL(join(ROOT, "scripts", "dev-tools.mjs")).href);
    assert.deepEqual(mod.parseBuildArgs([]), {}, "empty argv accepted");
  });
  it("any build argv is invalid", async () => {
    const mod = await import(pathToFileURL(join(ROOT, "scripts", "dev-tools.mjs")).href);
    assert.equal(typeof mod.parseBuildArgs, "function", "parser wired without execution");
    for (const argv of [["--profile", "web"], ["--anything"], ["--profile=web"], ["extra"]]) {
      assert.throws(() => mod.parseBuildArgs(argv), Error, "must reject " + JSON.stringify(argv));
    }
  });
  it("invalid build argv fails with zero side effects", async () => {
    const mod = await import(pathToFileURL(join(ROOT, "scripts", "dev-tools.mjs")).href);
    let spawns = 0;
    let usage = "";
    const code = await mod.runBuild({ argv: ["--profile", "web"], repoRoot: ROOT, print: () => {}, printError: (m) => { usage += m; }, startBuild: () => { spawns += 1; return { child: null, done: Promise.resolve({ code: 0, stdout: "", stderr: "" }) }; } });
    assert.notEqual(code, 0, "rejected argv fails");
    assert.ok(usage.includes("Usage"), "usage on stderr");
    assert.equal(spawns, 0, "zero builder spawns");
  });
  it("npm forwarding reaches the build parser", { timeout: 60000 }, async () => {
    const before = await readFile(join(ROOT, "dsh", "client.js"));
    let failed = false;
    try {
      execSync("npm run build -- --profile web", { cwd: ROOT, stdio: "pipe", encoding: "utf8", timeout: 60000 });
    } catch (err) {
      failed = true;
      const out = String((err.stdout || "") + (err.stderr || ""));
      assert.ok(out.includes("Usage"), "forwarded args reach the parser");
    }
    assert.ok(failed, "forwarded profile must fail");
    assert.ok((await readFile(join(ROOT, "dsh", "client.js"))).equals(before), "no output side effect");
  });
  it("forbidden args leave an isolated checkout untouched", { timeout: 120000 }, async () => {
    const pkg = JSON.parse(await readFile(join(ROOT, "package.json"), "utf8"));
    const tmp = await mkdtemp(join(tmpdir(), "ocms-r2-"));
    try {
      await mkdir(join(tmp, "dsh"), { recursive: true });
      await mkdir(join(tmp, "scripts"), { recursive: true });
      await writeFile(join(tmp, "dsh", "build-client.mjs"), await readFile(join(ROOT, "dsh", "build-client.mjs"), "utf8"), "utf8");
      await writeFile(join(tmp, "scripts", "dev-tools.mjs"), await readFile(join(ROOT, "scripts", "dev-tools.mjs"), "utf8"), "utf8");
      await writeFile(join(tmp, "dsh", "client.mjs"), "export const MARK = 1;\n", "utf8");
      const sentinel = "SENTINEL-BEFORE";
      await writeFile(join(tmp, "dsh", "client.js"), sentinel, "utf8");
      const beforeStat = await stat(join(tmp, "dsh", "client.js"));
      await writeFile(join(tmp, "package.json"), JSON.stringify({ name: "ocms-s", private: true, type: "module", scripts: { build: pkg.scripts.build } }) + "\n", "utf8");
      let failed = false;
      try {
        execSync("npm run build -- --profile web", { cwd: tmp, stdio: "pipe", encoding: "utf8", timeout: 60000 });
      } catch (err) {
        failed = true;
        assert.ok(String((err.stdout || "") + (err.stderr || "")).includes("Usage"), "usage before execution");
      }
      assert.ok(failed, "forbidden args fail");
      assert.equal(await readFile(join(tmp, "dsh", "client.js"), "utf8"), sentinel, "output bytes unchanged");
      assert.equal((await stat(join(tmp, "dsh", "client.js"))).mtimeMs, beforeStat.mtimeMs, "output untouched");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
  it("valid build invokes the canonical builder once", async () => {
    const mod = await import(pathToFileURL(join(ROOT, "scripts", "dev-tools.mjs")).href);
    const seen = [];
    const code = await mod.runBuild({ argv: [], repoRoot: ROOT, print: () => {}, printError: () => {}, startBuild: (r) => { seen.push(r); return { child: null, done: Promise.resolve({ code: 0, stdout: "", stderr: "" }) }; } });
    assert.equal(code, 0, "valid build succeeds");
    assert.deepEqual(seen, [ROOT], "exactly one builder start with the repo root");
  });
  it("builder non-zero exit propagates", async () => {
    const mod = await import(pathToFileURL(join(ROOT, "scripts", "dev-tools.mjs")).href);
    const code = await mod.runBuild({ argv: [], repoRoot: ROOT, print: () => {}, printError: () => {}, startBuild: () => ({ child: null, done: Promise.resolve({ code: 3, stdout: "", stderr: "broke" }) }) });
    assert.equal(code, 3, "exact builder code propagates");
  });
  it("builder output passes through", async () => {
    const mod = await import(pathToFileURL(join(ROOT, "scripts", "dev-tools.mjs")).href);
    const out = [];
    const errs = [];
    const code = await mod.runBuild({ argv: [], repoRoot: ROOT, print: (m) => out.push(m), printError: (m) => errs.push(m), startBuild: () => ({ child: null, done: Promise.resolve({ code: 0, stdout: "OUT-LINE\n", stderr: "" }) }) });
    assert.equal(code, 0, "success");
    assert.ok(out.join("\n").includes("OUT-LINE"), "stdout passes through");
    const code2 = await mod.runBuild({ argv: [], repoRoot: ROOT, print: (m) => out.push(m), printError: (m) => errs.push(m), startBuild: () => ({ child: null, done: Promise.resolve({ code: 1, stdout: "partial", stderr: "ERR-LINE" }) }) });
    assert.equal(code2, 1, "failure");
    assert.ok(errs.join("\n").includes("ERR-LINE"), "stderr passes through");
  });
  it("import has no build side effects", async () => {
    const beforeInt = process.listenerCount("SIGINT");
    const beforeTerm = process.listenerCount("SIGTERM");
    const mod = await import(pathToFileURL(join(ROOT, "scripts", "dev-tools.mjs")).href);
    assert.equal(typeof mod.runBuild, "function", "runBuild wired without execution");
    assert.equal(process.listenerCount("SIGINT"), beforeInt, "no SIGINT leak");
    assert.equal(process.listenerCount("SIGTERM"), beforeTerm, "no SIGTERM leak");
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
    const fake = await makeFakeBin();
    try {
      const r = runCli(["register", "--profile", "nope-missing-1"], { DSH_HOME: home, PATH: binFirst(fake.bin), OCMS_FAKE_DSH_LOG: fake.log });
      assert.notEqual(r.status, 0, "missing profile must fail");
      const out = String(r.stdout + r.stderr);
      assert.ok(out.includes("nope-missing-1"), "error names the profile");
      assert.ok(out.toLowerCase().includes("does not exist"), "clear not-found error");
      assert.ok(await dirAbsent(join(home, "profiles", "nope-missing-1")), "profile directory remains nonexistent");
      assert.ok(!out.includes("initialized profile"), "DSH auto-init must not have run");
      assert.ok(await dirAbsent(fake.log), "no DSH invocation for a missing profile");
    } finally {
      await rm(home, { recursive: true, force: true });
      await rm(fake.bin, { recursive: true, force: true });
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
    assert.ok(!src.includes(JSON.stringify("web")), "implementation carries no quoted web default");
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

describe("DX-4 safe explicit-profile dev web launcher", () => {
  const DEVTOOLS = join(ROOT, "scripts", "dev-tools.mjs");
  const CANONICAL_DEVWEB = "node scripts/dev-tools.mjs dev:web";
  const DEV_TARGET = "ocms-s dev:web: target profile ";
  const REG_TARGET = "ocms-s register: target profile ";
  async function dwHome() {
    return await mkdtemp(join(tmpdir(), "ocms-dx4-"));
  }
  async function dwAbsent(p) {
    try { await stat(p); return false; } catch { return true; }
  }
  async function dwProfile(home, name) {
    const dir = join(home, "profiles", name);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "package.json"), JSON.stringify({ name: "dsh-profile-" + name, private: true }) + "\n", "utf8");
    return dir;
  }
  async function dwFakeBin() {
    const bin = await mkdtemp(join(tmpdir(), "ocms-dx4bin-"));
    const log = join(bin, "argv.log");
    const pkgDir = join(bin, "node_modules", "@deepseek-ai", "dsh");
    await mkdir(join(pkgDir, "lib"), { recursive: true });
    const src = "const fs = require(" + JSON.stringify("node:fs") + ");\n"
      + "const out = process.env[" + JSON.stringify("OCMS_FAKE_DSH_LOG") + "];\n"
      + "const errText = process.env[" + JSON.stringify("OCMS_FAKE_DSH_STDERR") + "] || " + JSON.stringify("") + ";\n"
      + "const isWeb = process.argv.indexOf(" + JSON.stringify("--no-open") + ") !== -1;\n"
      + "if (isWeb && errText) { process.stderr.write(errText); }\n"
      + "const code = isWeb ? Number(process.env[" + JSON.stringify("OCMS_FAKE_DSH_EXIT") + "] || " + JSON.stringify("0") + ") : 0;\n"
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
  async function dwFixture() {
    const root = await mkdtemp(join(tmpdir(), "ocms-dx4root-"));
    await mkdir(join(root, "dsh"), { recursive: true });
    const builderSrc = await readFile(join(ROOT, "dsh", "build-client.mjs"), "utf8");
    await writeFile(join(root, "dsh", "build-client.mjs"), builderSrc, "utf8");
    await writeFile(join(root, "dsh", "client.mjs"), "export const MARK = 1;\n", "utf8");
    await writeFile(join(root, "package.json"), JSON.stringify({ name: "ocms-s", private: true, type: "module" }) + "\n", "utf8");
    return root;
  }
  function dwPathEnv(bin) {
    const sep = process.platform === "win32" ? ";" : ":";
    return bin + sep + process.env.PATH;
  }
  function dwEnv(home, fake, extra) {
    return Object.assign({}, process.env, { DSH_HOME: home, PATH: dwPathEnv(fake.bin), OCMS_FAKE_DSH_LOG: fake.log }, extra || {});
  }
  async function dwLoggedArgv(log) {
    const lines = (await readFile(log, "utf8")).trim().split("\n");
    return lines.map((l) => JSON.parse(l));
  }
  function dwDeferred() {
    const rec = { started: 0 };
    let rel = null;
    const done = new Promise((r) => { rel = r; });
    const child = { killed: 0, kill() { this.killed += 1; return true; } };
    const start = () => { rec.started += 1; return { child, done }; };
    const release = (res) => { rel(res); };
    return { rec, start, release, child };
  }
  it("package exposes dev:web command", async () => {
    const pkg = JSON.parse(await readFile(join(ROOT, "package.json"), "utf8"));
    assert.equal(pkg.scripts && pkg.scripts["dev:web"], CANONICAL_DEVWEB, "scripts.dev:web must be exactly the shared CLI");
  });
  it("missing profile fails before any stage", async () => {
    const mod = await import(pathToFileURL(DEVTOOLS).href);
    for (const argv of [[], ["--profile"]]) {
      let builds = 0;
      let usage = "";
      const h = mod.runDevWeb({ argv, repoRoot: ROOT, print: () => {}, printError: (m) => { usage += m; }, startBuild: () => { builds += 1; return { child: null, done: Promise.resolve({ code: 0, stdout: "", stderr: "" }) }; } });
      const code = await h;
      assert.notEqual(code, 0, "missing profile must fail");
      assert.ok(usage.includes("Usage"), "usage on missing profile");
      assert.equal(builds, 0, "no build without profile");
    }
  });
  it("malformed profile fails before any side effect", async () => {
    const mod = await import(pathToFileURL(DEVTOOLS).href);
    const home = await dwHome();
    try {
      for (const name of ["", "-x", ".", "..", "node_modules", "a/b", "desktop", "has space"]) {
        let builds = 0;
        const h = mod.runDevWeb({ argv: ["--profile", name], env: Object.assign({}, process.env, { DSH_HOME: home }), repoRoot: ROOT, print: () => {}, printError: () => {}, startBuild: () => { builds += 1; return { child: null, done: Promise.resolve({ code: 0, stdout: "", stderr: "" }) }; } });
        assert.notEqual(await h, 0, "must reject " + JSON.stringify(name));
        assert.equal(builds, 0, "no build for malformed profile");
      }
      assert.ok(await dwAbsent(join(home, "profiles")), "no profile created");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
  it("duplicate and unknown flags fail", async () => {
    const mod = await import(pathToFileURL(DEVTOOLS).href);
    for (const argv of [["--profile", "a", "--profile", "b"], ["--unknown"], ["--profile=a"], ["--profile", "dev-ocms", "--extra"]]) {
      let builds = 0;
      const h = mod.runDevWeb({ argv, repoRoot: ROOT, print: () => {}, printError: () => {}, startBuild: () => { builds += 1; return { child: null, done: Promise.resolve({ code: 0, stdout: "", stderr: "" }) }; } });
      assert.notEqual(await h, 0, "must reject " + JSON.stringify(argv));
      assert.equal(builds, 0, "no build on flag error");
    }
  });
  it("--profile web works only when explicitly typed", { timeout: 60000 }, async () => {
    const mod = await import(pathToFileURL(DEVTOOLS).href);
    const home = await dwHome();
    const fake = await dwFakeBin();
    const root = await dwFixture();
    try {
      await dwProfile(home, "web");
      const prints = [];
      const h = mod.runDevWeb({ argv: ["--profile", "web"], env: dwEnv(home, fake), repoRoot: root, print: (m) => prints.push(m), printError: () => {} });
      assert.equal(await h, 0, "explicit web succeeds");
      const calls = await dwLoggedArgv(fake.log);
      assert.deepEqual(calls[1], ["--profile", "web", "--no-open"], "literal web launch");
      assert.ok(prints.includes(DEV_TARGET + JSON.stringify("web")), "web target printed");
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(home, { recursive: true, force: true });
      await rm(fake.bin, { recursive: true, force: true });
    }
  });
  it("target printed before first action", async () => {
    const mod = await import(pathToFileURL(DEVTOOLS).href);
    const home = await dwHome();
    const fake = await dwFakeBin();
    const events = [];
    try {
    const h = mod.runDevWeb({ argv: ["--profile", "dev-ocms"], env: dwEnv(home, fake), repoRoot: "/fake/root", print: (m) => events.push("print:" + m), printError: () => {}, startBuild: () => { events.push("build-start"); return { child: null, done: Promise.resolve({ code: 0, stdout: "", stderr: "" }) }; }, registerStage: () => { events.push("register"); return { done: Promise.resolve({ code: 0 }) }; }, startLaunch: () => { events.push("launch"); return { child: null, done: Promise.resolve({ code: 0 }) }; } });
    assert.equal(await h, 0, "stubbed run succeeds");
    assert.ok(events[0] === "print:" + DEV_TARGET + JSON.stringify("dev-ocms"), "target first, saw " + JSON.stringify(events));
    assert.equal(events[1], "build-start", "build second");
    } finally {
      await rm(home, { recursive: true, force: true });
      await rm(fake.bin, { recursive: true, force: true });
    }
  });
  it("exactly one dev:web disclosure", { timeout: 60000 }, async () => {
    const mod = await import(pathToFileURL(DEVTOOLS).href);
    const home = await dwHome();
    const fake = await dwFakeBin();
    const root = await dwFixture();
    try {
      await dwProfile(home, "dev-ocms");
      const prints = [];
      const h = mod.runDevWeb({ argv: ["--profile", "dev-ocms"], env: dwEnv(home, fake), repoRoot: root, print: (m) => prints.push(m), printError: () => {} });
      assert.equal(await h, 0, "run succeeds");
      assert.equal(prints.filter((m) => m.startsWith(DEV_TARGET)).length, 1, "one dev:web line");
      assert.equal(prints.filter((m) => m.startsWith(REG_TARGET)).length, 1, "one register line");
      assert.ok(prints.includes(REG_TARGET + JSON.stringify("dev-ocms")), "same profile in register line");
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(home, { recursive: true, force: true });
      await rm(fake.bin, { recursive: true, force: true });
    }
  });
  it("exact ordered stage execution", { timeout: 60000 }, async () => {
    const mod = await import(pathToFileURL(DEVTOOLS).href);
    const home = await dwHome();
    const fake = await dwFakeBin();
    const root = await dwFixture();
    try {
      await dwProfile(home, "dev-ocms");
      let builds = 0;
      const real = mod.startCanonicalBuild;
      const prints = [];
      const h = mod.runDevWeb({ argv: ["--profile", "dev-ocms"], env: dwEnv(home, fake), repoRoot: root, print: (m) => prints.push(m), printError: () => {}, startBuild: (r) => { builds += 1; return real(r); } });
      assert.equal(await h, 0, "run succeeds");
      assert.equal(builds, 1, "one build");
      const calls = await dwLoggedArgv(fake.log);
      assert.deepEqual(calls, [["plugin", "--profile", "dev-ocms", "add", root], ["--profile", "dev-ocms", "--no-open"]], "register then launch");
      const devIdx = prints.indexOf(DEV_TARGET + JSON.stringify("dev-ocms"));
      const regIdx = prints.indexOf(REG_TARGET + JSON.stringify("dev-ocms"));
      assert.ok(devIdx !== -1 && regIdx !== -1 && devIdx < regIdx, "dev target before register target");
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(home, { recursive: true, force: true });
      await rm(fake.bin, { recursive: true, force: true });
    }
  });
  it("build failure prevents registration and launch", async () => {
    const mod = await import(pathToFileURL(DEVTOOLS).href);
    let regs = 0;
    let launches = 0;
    const h = mod.runDevWeb({ argv: ["--profile", "dev-ocms"], repoRoot: "/fake/root", print: () => {}, printError: () => {}, startBuild: () => ({ child: null, done: Promise.resolve({ code: 2, stdout: "", stderr: "build broke" }) }), registerStage: () => { regs += 1; return { done: Promise.resolve({ code: 0 }) }; }, startLaunch: () => { launches += 1; return { child: null, done: Promise.resolve({ code: 0 }) }; } });
    assert.equal(await h, 2, "build code propagates");
    assert.equal(regs, 0, "no register after build failure");
    assert.equal(launches, 0, "no launch after build failure");
  });
  it("register failure prevents launch", async () => {
    const mod = await import(pathToFileURL(DEVTOOLS).href);
    let launches = 0;
    const h = mod.runDevWeb({ argv: ["--profile", "dev-ocms"], repoRoot: "/fake/root", print: () => {}, printError: () => {}, startBuild: () => ({ child: null, done: Promise.resolve({ code: 0, stdout: "", stderr: "" }) }), registerStage: () => ({ done: Promise.resolve({ code: 4 }) }), startLaunch: () => { launches += 1; return { child: null, done: Promise.resolve({ code: 0 }) }; } });
    assert.equal(await h, 4, "register code propagates");
    assert.equal(launches, 0, "no launch after register failure");
  });
  it("missing DSH and unresolvable shim fail closed", { timeout: 60000 }, async () => {
    const mod = await import(pathToFileURL(DEVTOOLS).href);
    const root = await dwFixture();
    const home = await dwHome();
    const emptyBin = await mkdtemp(join(tmpdir(), "ocms-dx4empty-"));
    const lonely = await mkdtemp(join(tmpdir(), "ocms-dx4lone-"));
    try {
      await dwProfile(home, "dev-ocms");
      await writeFile(join(lonely, "dsh.cmd"), "@echo off\n", "utf8");
      const noDsh = Object.assign({}, process.env, { DSH_HOME: home, PATH: emptyBin, OCMS_FAKE_DSH_LOG: join(emptyBin, "n.log") });
      const h1 = mod.runDevWeb({ argv: ["--profile", "dev-ocms"], env: noDsh, repoRoot: root, print: () => {}, printError: () => {} });
      assert.notEqual(await h1, 0, "missing DSH fails");
      const sep = process.platform === "win32" ? ";" : ":";
      const loneEnv = Object.assign({}, process.env, { DSH_HOME: home, PATH: lonely + sep + emptyBin, OCMS_FAKE_DSH_LOG: join(emptyBin, "n.log") });
      const h2 = mod.runDevWeb({ argv: ["--profile", "dev-ocms"], env: loneEnv, repoRoot: root, print: () => {}, printError: () => {} });
      assert.notEqual(await h2, 0, "unresolvable shim fails");
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(home, { recursive: true, force: true });
      await rm(emptyBin, { recursive: true, force: true });
      await rm(lonely, { recursive: true, force: true });
    }
  });
  it("missing profile fails without creation", { timeout: 60000 }, async () => {
    const mod = await import(pathToFileURL(DEVTOOLS).href);
    const root = await dwFixture();
    const home = await dwHome();
    const fake = await dwFakeBin();
    try {
      let launches = 0;
      const out = [];
      const h = mod.runDevWeb({ argv: ["--profile", "nope-missing-9"], env: dwEnv(home, fake), repoRoot: root, print: () => {}, printError: (m) => out.push(m), startLaunch: () => { launches += 1; return { child: null, done: Promise.resolve({ code: 0 }) }; } });
      assert.notEqual(await h, 0, "missing profile fails");
      assert.ok(out.join("\n").toLowerCase().includes("does not exist"), "not-found error");
      assert.ok(await dwAbsent(join(home, "profiles", "nope-missing-9")), "profile not created");
      assert.equal(launches, 0, "no launch");
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(home, { recursive: true, force: true });
      await rm(fake.bin, { recursive: true, force: true });
    }
  });
  it("launch uses exact profile argv", { timeout: 60000 }, async () => {
    const mod = await import(pathToFileURL(DEVTOOLS).href);
    const home = await dwHome();
    const fake = await dwFakeBin();
    const root = await dwFixture();
    try {
      await dwProfile(home, "dev-ocms");
      const h = mod.runDevWeb({ argv: ["--profile", "dev-ocms"], env: dwEnv(home, fake), repoRoot: root, print: () => {}, printError: () => {} });
      assert.equal(await h, 0, "run succeeds");
      const calls = await dwLoggedArgv(fake.log);
      assert.equal(calls.length, 2, "register plus launch only");
      assert.deepEqual(calls[1], ["--profile", "dev-ocms", "--no-open"], "frozen launch argv");
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(home, { recursive: true, force: true });
      await rm(fake.bin, { recursive: true, force: true });
    }
  });
  async function dwSettled(ms) {
    await new Promise((r) => setTimeout(r, ms));
  }
  async function dwWaitCount(get, n) {
    const start = Date.now();
    while (get() < n && Date.now() - start < 2000) {
      await dwSettled(10);
    }
    return get() >= n;
  }
  it("no shell for shim installations", { timeout: 60000 }, async () => {
    const mod = await import(pathToFileURL(DEVTOOLS).href);
    const fake = await dwFakeBin();
    try {
      const shim = join(fake.bin, process.platform === "win32" ? "dsh.cmd" : "dsh");
      const launch = await mod.resolveDshLaunch(shim);
      assert.ok(launch, "shim resolves");
      assert.equal(launch.shell, false, "never shell");
      assert.ok(!launch.file.toLowerCase().endsWith(".cmd"), "does not execute shim text");
      assert.equal(launch.argsPrefix.length, 1, "single entry prefix");
      assert.ok(launch.argsPrefix[0].endsWith("bin.js"), "node entry carries the package bin");
    } finally {
      await rm(fake.bin, { recursive: true, force: true });
    }
  });
  it("normal web exit propagates zero", { timeout: 60000 }, async () => {
    const mod = await import(pathToFileURL(DEVTOOLS).href);
    const home = await dwHome();
    const fake = await dwFakeBin();
    const root = await dwFixture();
    try {
      await dwProfile(home, "dev-ocms");
      const h = mod.runDevWeb({ argv: ["--profile", "dev-ocms"], env: dwEnv(home, fake), repoRoot: root, print: () => {}, printError: () => {} });
      assert.equal(await h, 0, "exit zero propagates");
      assert.equal((await dwLoggedArgv(fake.log)).length, 2, "both stages ran");
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(home, { recursive: true, force: true });
      await rm(fake.bin, { recursive: true, force: true });
    }
  });
  it("non-zero web exit propagates exactly", { timeout: 60000 }, async () => {
    const mod = await import(pathToFileURL(DEVTOOLS).href);
    const home = await dwHome();
    const fake = await dwFakeBin();
    const root = await dwFixture();
    try {
      await dwProfile(home, "dev-ocms");
      const h = mod.runDevWeb({ argv: ["--profile", "dev-ocms"], env: dwEnv(home, fake, { OCMS_FAKE_DSH_EXIT: "5" }), repoRoot: root, print: () => {}, printError: () => {} });
      assert.equal(await h, 5, "exit code propagates exactly");
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(home, { recursive: true, force: true });
      await rm(fake.bin, { recursive: true, force: true });
    }
  });
  it("port conflict propagates without termination", { timeout: 60000 }, async () => {
    const mod = await import(pathToFileURL(DEVTOOLS).href);
    const home = await dwHome();
    const fake = await dwFakeBin();
    const root = await dwFixture();
    const foreign = { killed: 0, kill() { this.killed += 1; return true; } };
    try {
      await dwProfile(home, "dev-ocms");
      const h = mod.runDevWeb({ argv: ["--profile", "dev-ocms"], env: dwEnv(home, fake, { OCMS_FAKE_DSH_EXIT: "2", OCMS_FAKE_DSH_STDERR: "EADDRINUSE listen" }), repoRoot: root, print: () => {}, printError: () => {} });
      assert.equal(await h, 2, "conflict code propagates");
      assert.equal((await dwLoggedArgv(fake.log)).length, 2, "no retry, no recovery");
      assert.equal(foreign.killed, 0, "holder untouched");
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(home, { recursive: true, force: true });
      await rm(fake.bin, { recursive: true, force: true });
    }
  });
  it("shutdown during build stops only its child", { timeout: 60000 }, async () => {
    const mod = await import(pathToFileURL(DEVTOOLS).href);
    const build = dwDeferred();
    let regs = 0;
    const h = mod.runDevWeb({ argv: ["--profile", "dev-ocms"], repoRoot: "/fake/root", print: () => {}, printError: () => {}, startBuild: build.start, registerStage: () => { regs += 1; return { done: Promise.resolve({ code: 0 }) }; }, startLaunch: () => ({ child: null, done: Promise.resolve({ code: 0 }) }) });
    assert.ok(await dwWaitCount(() => build.rec.started, 1), "build active");
    const stopping = h.shutdown("SIGINT");
    await dwSettled(20);
    assert.equal(build.child.killed, 1, "owned build signaled once");
    build.release({ code: 0, stdout: "", stderr: "" });
    assert.equal(await stopping, 130, "signal status");
    assert.equal(regs, 0, "no register after cancel");
  });
  it("shutdown during register stops only its child", { timeout: 60000 }, async () => {
    const mod = await import(pathToFileURL(DEVTOOLS).href);
    const reg = dwDeferred();
    let launches = 0;
    const h = mod.runDevWeb({ argv: ["--profile", "dev-ocms"], repoRoot: "/fake/root", print: () => {}, printError: () => {}, startBuild: () => ({ child: null, done: Promise.resolve({ code: 0, stdout: "", stderr: "" }) }), registerStage: (a) => { const s = reg.start(); a.track(s.child); return { done: s.done }; }, startLaunch: () => { launches += 1; return { child: null, done: Promise.resolve({ code: 0 }) }; } });
    assert.ok(await dwWaitCount(() => reg.rec.started, 1), "register active");
    const stopping = h.shutdown("SIGINT");
    await dwSettled(20);
    assert.equal(reg.child.killed, 1, "owned register child signaled once");
    reg.release({ code: 0 });
    assert.equal(await stopping, 130, "signal status");
    assert.equal(launches, 0, "no launch after cancel");
  });
  it("shutdown during web waits owned settlement", { timeout: 60000 }, async () => {
    const mod = await import(pathToFileURL(DEVTOOLS).href);
    const home = await dwHome();
    const fake = await dwFakeBin();
    const web = dwDeferred();
    try {
    const h = mod.runDevWeb({ argv: ["--profile", "dev-ocms"], env: dwEnv(home, fake), repoRoot: "/fake/root", print: () => {}, printError: () => {}, startBuild: () => ({ child: null, done: Promise.resolve({ code: 0, stdout: "", stderr: "" }) }), registerStage: () => ({ done: Promise.resolve({ code: 0 }) }), startLaunch: () => web.start() });
    assert.ok(await dwWaitCount(() => web.rec.started, 1), "web active");
    const stopping = h.shutdown("SIGINT");
    await dwSettled(20);
    assert.equal(web.child.killed, 1, "owned web signaled once");
    web.release({ code: 0 });
    assert.equal(await stopping, 130, "signal status");
    } finally {
      await rm(home, { recursive: true, force: true });
      await rm(fake.bin, { recursive: true, force: true });
    }
  });
  it("repeated shutdown is idempotent", { timeout: 60000 }, async () => {
    const mod = await import(pathToFileURL(DEVTOOLS).href);
    const home = await dwHome();
    const fake = await dwFakeBin();
    const web = dwDeferred();
    try {
    const h = mod.runDevWeb({ argv: ["--profile", "dev-ocms"], env: dwEnv(home, fake), repoRoot: "/fake/root", print: () => {}, printError: () => {}, startBuild: () => ({ child: null, done: Promise.resolve({ code: 0, stdout: "", stderr: "" }) }), registerStage: () => ({ done: Promise.resolve({ code: 0 }) }), startLaunch: () => web.start() });
    assert.ok(await dwWaitCount(() => web.rec.started, 1), "web active");
    const s1 = h.shutdown("SIGINT");
    const s2 = h.shutdown("SIGINT");
    await dwSettled(20);
    assert.equal(web.child.killed, 1, "single signal");
    web.release({ code: 0 });
    assert.equal(await s1, 130, "first settles");
    assert.equal(await s2, 130, "second settles same");
    } finally {
      await rm(home, { recursive: true, force: true });
      await rm(fake.bin, { recursive: true, force: true });
    }
  });
  it("no foreign process is signaled", { timeout: 60000 }, async () => {
    const mod = await import(pathToFileURL(DEVTOOLS).href);
    const build = dwDeferred();
    const foreign = { killed: 0, kill() { this.killed += 1; return true; } };
    const h = mod.runDevWeb({ argv: ["--profile", "dev-ocms"], repoRoot: "/fake/root", print: () => {}, printError: () => {}, startBuild: build.start, registerStage: () => ({ done: Promise.resolve({ code: 0 }) }), startLaunch: () => ({ child: null, done: Promise.resolve({ code: 0 }) }) });
    assert.ok(await dwWaitCount(() => build.rec.started, 1), "build active");
    const stopping = h.shutdown("SIGINT");
    await dwSettled(20);
    build.release({ code: 0, stdout: "", stderr: "" });
    assert.equal(await stopping, 130, "settles");
    assert.equal(build.child.killed, 1, "owned signaled");
    assert.equal(foreign.killed, 0, "foreign untouched");
  });
  it("malformed paths mutate nothing", async () => {
    const mod = await import(pathToFileURL(DEVTOOLS).href);
    const home = await dwHome();
    try {
      for (const argv of [["--profile", "-bad"], ["--profile", "a/b"], ["--weird"]]) {
        let builds = 0;
        let regs = 0;
        let launches = 0;
        const h = mod.runDevWeb({ argv, env: Object.assign({}, process.env, { DSH_HOME: home }), repoRoot: ROOT, print: () => {}, printError: () => {}, startBuild: () => { builds += 1; return { child: null, done: Promise.resolve({ code: 0, stdout: "", stderr: "" }) }; }, registerStage: () => { regs += 1; return { done: Promise.resolve({ code: 0 }) }; }, startLaunch: () => { launches += 1; return { child: null, done: Promise.resolve({ code: 0 }) }; } });
        assert.notEqual(await h, 0, "must reject " + JSON.stringify(argv));
        assert.equal(builds + regs + launches, 0, "no stage runs");
      }
      assert.ok(await dwAbsent(join(home, "profiles")), "nothing created");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
  it("metacharacter paths stay literal", { timeout: 120000 }, async () => {
    const mod = await import(pathToFileURL(DEVTOOLS).href);
    const trap = "OCMS_DX4_SENTINEL";
    const nasty = "OCMS & Test (1) %" + trap + "%";
    const base = await mkdtemp(join(tmpdir(), "ocms-dx4m-"));
    const metaRoot = join(base, nasty, "ocms-s");
    const sentinelPath = join(base, "dx4-sentinel-marker");
    await mkdir(join(metaRoot, "dsh"), { recursive: true });
    const builderSrc = await readFile(join(ROOT, "dsh", "build-client.mjs"), "utf8");
    await writeFile(join(metaRoot, "dsh", "build-client.mjs"), builderSrc, "utf8");
    await writeFile(join(metaRoot, "dsh", "client.mjs"), "export const MARK = 1;\n", "utf8");
    await writeFile(join(metaRoot, "package.json"), JSON.stringify({ name: "ocms-s", private: true, type: "module" }) + "\n", "utf8");
    const home = await dwHome();
    const fake = await dwFakeBin();
    try {
      await dwProfile(home, "dev-ocms");
      const env = dwEnv(home, fake);
      env[trap] = "EXPANDED";
      const prints = [];
      const h = mod.runDevWeb({ argv: ["--profile", "dev-ocms"], env, repoRoot: metaRoot, print: (m) => prints.push(m), printError: () => {} });
      assert.equal(await h, 0, "metachar run succeeds");
      const calls = await dwLoggedArgv(fake.log);
      assert.deepEqual(calls, [["plugin", "--profile", "dev-ocms", "add", metaRoot], ["--profile", "dev-ocms", "--no-open"]], "literal metachar argv");
      assert.ok(await dwAbsent(sentinelPath), "sentinel absent");
    } finally {
      await rm(base, { recursive: true, force: true });
      await rm(home, { recursive: true, force: true });
      await rm(fake.bin, { recursive: true, force: true });
    }
  });
  it("import has zero CLI side effects", async () => {
    const beforeInt = process.listenerCount("SIGINT");
    const beforeTerm = process.listenerCount("SIGTERM");
    const mod = await import(pathToFileURL(DEVTOOLS).href);
    const home = await dwHome();
    const fake = await dwFakeBin();
    try {
    const h = mod.runDevWeb({ argv: ["--profile", "dev-ocms"], env: dwEnv(home, fake), repoRoot: "/fake/root", print: () => {}, printError: () => {}, startBuild: () => ({ child: null, done: Promise.resolve({ code: 0, stdout: "", stderr: "" }) }), registerStage: () => ({ done: Promise.resolve({ code: 0 }) }), startLaunch: () => ({ child: null, done: Promise.resolve({ code: 0 }) }) });
    assert.equal(await h, 0, "stubbed run succeeds");
    assert.equal(process.listenerCount("SIGINT"), beforeInt, "no SIGINT leak");
    assert.equal(process.listenerCount("SIGTERM"), beforeTerm, "no SIGTERM leak");
    } finally {
      await rm(home, { recursive: true, force: true });
      await rm(fake.bin, { recursive: true, force: true });
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

describe("R1 ownership and cancellation repair", () => {
  const DEVTOOLS = join(ROOT, "scripts", "dev-tools.mjs");
  async function r1Settled(ms) {
    await new Promise((r) => setTimeout(r, ms));
  }
  async function r1WaitCount(get, n) {
    const start = Date.now();
    while (get() < n && Date.now() - start < 2000) {
      await r1Settled(10);
    }
    return get() >= n;
  }
  async function r1Absent(p) {
    try { await stat(p); return false; } catch { return true; }
  }
  function r1Deferred() {
    const rec = { started: 0, max: 0, active: 0 };
    const queue = [];
    const child = { killed: 0, kill() { this.killed += 1; return true; } };
    const start = () => {
      rec.started += 1;
      rec.active += 1;
      if (rec.active > rec.max) { rec.max = rec.active; }
      let rel = null;
      const raw = new Promise((r) => { rel = r; });
      queue.push(rel);
      const done = raw.then((res) => { rec.active -= 1; return res; });
      return { child, done };
    };
    const release = (res) => { const rel = queue.shift(); if (rel) { rel(res); } };
    return { rec, start, release, child };
  }
  function r1EmitterWatch() {
    const rec = { paths: [], watchers: [], closed: 0 };
    const fn = (p, l) => {
      const em = new EventEmitter();
      em.on("change", l);
      em.close = () => { rec.closed += 1; };
      rec.paths.push(p);
      rec.watchers.push(em);
      return em;
    };
    return { rec, fn };
  }
  async function r1FixtureRoot() {
    const root = await mkdtemp(join(tmpdir(), "ocms-r1root-"));
    await mkdir(join(root, "dsh"), { recursive: true });
    const builderSrc = await readFile(join(ROOT, "dsh", "build-client.mjs"), "utf8");
    await writeFile(join(root, "dsh", "build-client.mjs"), builderSrc, "utf8");
    await writeFile(join(root, "dsh", "client.mjs"), "export const MARK = 1;\n", "utf8");
    await writeFile(join(root, "package.json"), JSON.stringify({ name: "ocms-s", private: true, type: "module" }) + "\n", "utf8");
    return root;
  }
  async function r1Profile(home, name) {
    const dir = join(home, "profiles", name);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "package.json"), JSON.stringify({ name: "dsh-profile-" + name, private: true }) + "\n", "utf8");
    return dir;
  }
  async function r1FakeBin() {
    const bin = await mkdtemp(join(tmpdir(), "ocms-r1bin-"));
    const log = join(bin, "argv.log");
    const pkgDir = join(bin, "node_modules", "@deepseek-ai", "dsh");
    await mkdir(join(pkgDir, "lib"), { recursive: true });
    const src = "const fs = require(" + JSON.stringify("node:fs") + ");\n"
      + "const out = process.env[" + JSON.stringify("OCMS_FAKE_DSH_LOG") + "];\n"
      + "const code = Number(process.env[" + JSON.stringify("OCMS_FAKE_DSH_EXIT") + "] || " + JSON.stringify("0") + ");\n"
      + "fs.appendFileSync(out, JSON.stringify(process.argv.slice(2)) + " + JSON.stringify("\n") + ");\n"
      + "process.exit(code);\n";
    await writeFile(join(pkgDir, "lib", "bin.js"), src, "utf8");
    await writeFile(join(pkgDir, "package.json"), JSON.stringify({ name: "@deepseek-ai/dsh", version: "0.0.0-test", bin: { dsh: "lib/bin.js" } }, null, 2) + "\n", "utf8");
    await writeFile(join(bin, "dsh.cmd"), "@echo off\nrem fake npm shim\n", "utf8");
    await writeFile(join(bin, "dsh"), "#!/bin/sh\n# fake shim\n", "utf8");
    try { await chmod(join(bin, "dsh"), 0o755); } catch { }
    return { bin, log };
  }
  function r1PathEnv(bin) {
    const sep = process.platform === "win32" ? ";" : ":";
    return bin + sep + process.env.PATH;
  }
  it("F1 stop during initial build settles owned child", async () => {
    const mod = await import(pathToFileURL(DEVTOOLS).href);
    const builder = r1Deferred();
    let watched = false;
    const h = mod.runWatch({ argv: [], repoRoot: "/fake/r1", print: () => {}, printError: () => {}, startBuild: builder.start, watchFile: () => { watched = true; return { close() {} }; }, onReady: () => {} });
    assert.ok(await r1WaitCount(() => builder.rec.started, 1), "initial build active");
    let stopSettled = false;
    const stopping = h.stop().then((c) => { stopSettled = true; return c; });
    await r1Settled(30);
    assert.equal(builder.child.killed, 1, "initial child signaled once");
    assert.ok(!stopSettled, "stop waits for settlement");
    builder.release({ code: 0, stdout: "", stderr: "" });
    assert.equal(await stopping, 0, "stop resolves zero after settlement");
    assert.ok(!watched, "no watchers installed");
    assert.equal(await h.stop(), 0, "repeated stop idempotent");
    assert.equal(builder.child.killed, 1, "no duplicate signal");
  });
  it("F1 real child signaled and settled", { timeout: 60000 }, async () => {
    const mod = await import(pathToFileURL(DEVTOOLS).href);
    const sleep = { started: false, child: null, exited: false };
    const realSleep = () => {
      sleep.started = true;
      const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 5000);"], { stdio: "ignore" });
      sleep.child = child;
      child.on("exit", () => { sleep.exited = true; });
      const done = new Promise((resolve) => {
        child.on("error", () => resolve({ code: 127, stdout: "", stderr: "" }));
        child.on("exit", (code) => resolve({ code: typeof code === "number" ? code : 1, stdout: "", stderr: "" }));
      });
      return { child, done };
    };
    const foreign = spawn(process.execPath, ["-e", "setTimeout(() => {}, 5000);"], { stdio: "ignore" });
    try {
      let watched = false;
      const h = mod.runWatch({ argv: [], repoRoot: "/fake/r1", print: () => {}, printError: () => {}, startBuild: realSleep, watchFile: () => { watched = true; return { close() {} }; } });
      assert.ok(await r1WaitCount(() => (sleep.started ? 1 : 0), 1), "sleep spawned");
      let stopDone = false;
      const stopping = h.stop().then((c) => { stopDone = true; return c; });
      await r1Settled(30);
      if (stopDone) { assert.ok(sleep.exited, "never resolves before exit"); }
      assert.equal(await stopping, 0, "stop resolves zero");
      assert.ok(sleep.exited, "owned child actually exited");
      assert.ok(!watched, "no watchers");
      assert.ok(foreign.exitCode === null && foreign.signalCode === null, "foreign alive");
    } finally {
      try { foreign.kill(); } catch { }
      await new Promise((r) => { if (foreign.exitCode !== null || foreign.signalCode !== null) { r(undefined); } else { foreign.on("exit", () => r(undefined)); } });
    }
  });
  it("F2 cancelled preflight never spawns", async () => {
    const mod = await import(pathToFileURL(DEVTOOLS).href);
    const home = await mkdtemp(join(tmpdir(), "ocms-r1-"));
    const root = await mkdtemp(join(tmpdir(), "ocms-r1root-"));
    await writeFile(join(root, "package.json"), JSON.stringify({ name: "ocms-s", private: true }) + "\n", "utf8");
    let releaseExists = null;
    const gate = new Promise((r) => { releaseExists = r; });
    let existsCalls = 0;
    let spawns = 0;
    let cancelled = false;
    const prints = [];
    const p = mod.runRegister({ argv: ["--profile", "dev-ocms"], env: Object.assign({}, process.env, { DSH_HOME: home }), repoRoot: root, print: (m) => prints.push(m), printError: () => {}, readPackageName: async () => "ocms-s", findDsh: async () => "/fake/dsh", profileExists: () => { existsCalls += 1; return gate.then(() => true); }, resolveLaunch: async () => ({ file: "/fake/dsh", argsPrefix: [], shell: false }), spawnFn: () => { spawns += 1; return Promise.resolve(0); }, isCancelled: () => cancelled });
    assert.ok(await r1WaitCount(() => existsCalls, 1), "preflight paused");
    assert.ok(prints.join("\n").includes("dev-ocms"), "target printed before cancel");
    assert.equal(spawns, 0, "no spawn yet");
    cancelled = true;
    releaseExists(undefined);
    assert.notEqual(await p, 0, "cancelled run fails");
    assert.equal(spawns, 0, "no spawn after cancellation");
    await rm(home, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  });
  it("F2 dev:web cancel during register preflight", { timeout: 60000 }, async () => {
    const mod = await import(pathToFileURL(DEVTOOLS).href);
    for (const sig of ["SIGINT", "SIGTERM"]) {
      const want = sig === "SIGTERM" ? 143 : 130;
      const root = await r1FixtureRoot();
      const home = await mkdtemp(join(tmpdir(), "ocms-r1-"));
      const fake = await r1FakeBin();
      await r1Profile(home, "dev-ocms");
      let releaseExists = null;
      const gate = new Promise((r) => { releaseExists = r; });
      const sep = process.platform === "win32" ? ";" : ":";
      const env = Object.assign({}, process.env, { DSH_HOME: home, PATH: fake.bin + sep + process.env.PATH, OCMS_FAKE_DSH_LOG: fake.log });
      const prints = [];
      let depCalls = 0;
      const h = mod.runDevWeb({ argv: ["--profile", "dev-ocms"], env, repoRoot: root, print: (m) => prints.push(m), printError: () => {}, registerDeps: { profileExists: () => { depCalls += 1; return gate.then(() => true); } } });
      assert.ok(await r1WaitCount(() => (prints.join("\n").includes("dev-ocms") ? 1 : 0), 1), "inside register preflight");
      assert.ok(await r1WaitCount(() => depCalls, 1), "injected preflight reached");
      const stopping = h.shutdown(sig);
      await r1Settled(20);
      releaseExists(undefined);
      assert.equal(await stopping, want, sig + " status");
      assert.ok(await r1Absent(fake.log), "plugin add never spawned");
      assert.deepEqual(await readdir(join(home, "profiles")), ["dev-ocms"], "no profile files touched");
      await rm(root, { recursive: true, force: true });
      await rm(home, { recursive: true, force: true });
      await rm(fake.bin, { recursive: true, force: true });
    }
  });
  it("F2 late child after cancel is adopted and settled", async () => {
    const mod = await import(pathToFileURL(DEVTOOLS).href);
    const late = { killed: 0, kill() { this.killed += 1; return true; } };
    let capturedTrack = null;
    let releaseReg = null;
    const regGate = new Promise((r) => { releaseReg = r; });
    const h = mod.runDevWeb({ argv: ["--profile", "dev-ocms"], repoRoot: "/fake/r1", print: () => {}, printError: () => {}, startBuild: () => ({ child: null, done: Promise.resolve({ code: 0, stdout: "", stderr: "" }) }), registerStage: (a) => { capturedTrack = a.track; return { done: regGate }; } });
    await r1Settled(20);
    const stopping = h.shutdown("SIGINT");
    await r1Settled(20);
    capturedTrack(late);
    assert.equal(late.killed, 1, "late child signaled once");
    releaseReg({ code: 0 });
    assert.equal(await stopping, 130, "cancel status wins");
    assert.equal(await h.shutdown("SIGINT"), 130, "idempotent");
    assert.equal(late.killed, 1, "no duplicate signal");
  });
  it("F3 fatal watcher error while idle", async () => {
    const mod = await import(pathToFileURL(DEVTOOLS).href);
    const stub = r1EmitterWatch();
    const errors = [];
    let ready = false;
    let builds = 0;
    const h = mod.runWatch({ argv: [], repoRoot: "/fake/r1", print: () => {}, printError: (m) => errors.push(m), startBuild: () => { builds += 1; return { child: null, done: Promise.resolve({ code: 0, stdout: "", stderr: "" }) }; }, watchFile: stub.fn, debounceMs: 10, onReady: () => { ready = true; } });
    assert.ok(await r1WaitCount(() => (ready ? 1 : 0), 1), "ready");
    stub.rec.watchers[0].emit("error", new Error("watcher exploded"));
    assert.equal(await h, 1, "fatal non-zero");
    assert.ok(errors.join("\n").includes("watcher exploded"), "diagnostic surfaced");
    assert.equal(stub.rec.closed, 2, "both watchers closed");
    stub.rec.watchers[0].emit("change");
    await r1Settled(60);
    assert.equal(builds, 1, "no further rebuild");
  });
  it("F3 fatal watcher error during active rebuild", { timeout: 60000 }, async () => {
    const mod = await import(pathToFileURL(DEVTOOLS).href);
    const stub = r1EmitterWatch();
    const builder = r1Deferred();
    const ok = { code: 0, stdout: "", stderr: "" };
    const errors = [];
    let ready = false;
    const h = mod.runWatch({ argv: [], repoRoot: "/fake/r1", print: () => {}, printError: (m) => errors.push(m), startBuild: builder.start, watchFile: stub.fn, debounceMs: 10, onReady: () => { ready = true; } });
    assert.ok(await r1WaitCount(() => builder.rec.started, 1), "initial started");
    builder.release(ok);
    assert.ok(await r1WaitCount(() => (ready ? 1 : 0), 1), "ready");
    stub.rec.watchers[0].emit("change");
    assert.ok(await r1WaitCount(() => builder.rec.started, 2), "rebuild active");
    let settledMain = false;
    const waiting = h.then((c) => { settledMain = true; return c; });
    stub.rec.watchers[1].emit("error", new Error("watcher broke"));
    await r1Settled(30);
    assert.equal(builder.child.killed, 1, "active child signaled once");
    assert.ok(!settledMain, "waits for settlement");
    builder.release(ok);
    assert.equal(await waiting, 1, "fatal outcome kept");
    assert.equal(stub.rec.closed, 2, "watchers closed");
    assert.equal(builder.child.killed, 1, "no double signal");
  });
  it("F3 setup failure after first watcher cleans up", async () => {
    const mod = await import(pathToFileURL(DEVTOOLS).href);
    const closed = [];
    let calls = 0;
    const h = mod.runWatch({ argv: [], repoRoot: "/fake/r1", print: () => {}, printError: () => {}, startBuild: () => ({ child: null, done: Promise.resolve({ code: 0, stdout: "", stderr: "" }) }), watchFile: (p) => { calls += 1; if (calls > 1) { throw new Error("second fails"); } return { close() { closed.push(p); } }; } });
    assert.equal(await h, 1, "setup failure non-zero");
    assert.equal(closed.length, 1, "first watcher closed");
  });
  it("F3 competing stop and fatal error settle once", { timeout: 60000 }, async () => {
    const mod = await import(pathToFileURL(DEVTOOLS).href);
    const stub = r1EmitterWatch();
    const builder = r1Deferred();
    const ok = { code: 0, stdout: "", stderr: "" };
    let ready = false;
    const h = mod.runWatch({ argv: [], repoRoot: "/fake/r1", print: () => {}, printError: () => {}, startBuild: builder.start, watchFile: stub.fn, debounceMs: 10, onReady: () => { ready = true; } });
    assert.ok(await r1WaitCount(() => builder.rec.started, 1), "initial started");
    builder.release(ok);
    assert.ok(await r1WaitCount(() => (ready ? 1 : 0), 1), "ready");
    stub.rec.watchers[0].emit("change");
    assert.ok(await r1WaitCount(() => builder.rec.started, 2), "rebuild active");
    const stopping = h.stop();
    stub.rec.watchers[1].emit("error", new Error("race broke"));
    await r1Settled(20);
    assert.equal(builder.child.killed, 1, "single signal across stop and fatal");
    builder.release(ok);
    assert.equal(await stopping, 1, "fatal outcome authoritative");
    assert.equal(await h, 1, "main agrees");
  });
  function dx5Section() {
    return readFile(join(ROOT, "README.md"), "utf8").then((text) => {
      const start = text.indexOf("## Developer commands");
      assert.notEqual(start, -1, "developer commands section exists");
      const rest = text.slice(start);
      const next = rest.slice(20).search(/\n##\s|\n---\n/);
      const section = (next === -1 ? rest : rest.slice(0, 20 + next)).toLowerCase();
      return { full: text, section };
    });
  }
  it("documents the four developer commands", async () => {
    const doc = await dx5Section();
    for (const cmd of ["npm run build", "npm run register", "npm run watch", "npm run dev:web"]) {
      assert.ok(doc.section.includes(cmd), "section documents " + cmd);
    }
    assert.ok(doc.section.includes("--profile"), "profile flag documented");
    assert.ok(doc.section.includes("dsh/build-client.mjs"), "canonical builder documented");
  });
  it("documents explicit-profile safety", async () => {
    const doc = await dx5Section();
    assert.ok(doc.section.includes("explicit"), "explicit profile required");
    assert.ok(doc.section.includes("existing profile"), "existing profile only");
    assert.ok(doc.section.includes("no implicit"), "no implicit web default");
  });
  it("documents watch isolation", async () => {
    const doc = await dx5Section();
    assert.ok(doc.section.includes("takes no profile"), "watch takes no profile");
    assert.ok(doc.section.includes("never interacts with dsh"), "watch never touches DSH");
    assert.ok(doc.section.includes("150 ms"), "debounce documented");
  });
  it("documents launch sequence and safety limits", async () => {
    const doc = await dx5Section();
    assert.ok(doc.section.includes("build -> register"), "stage order documented");
    assert.ok(doc.section.includes("foreground"), "foreground launch documented");
    assert.ok(doc.section.includes("--no-open"), "launch flag documented");
    assert.ok(doc.section.includes("never repaired"), "conflicts reported not repaired");
    assert.ok(doc.section.includes("no automatic process kill"), "no kill behavior");
    assert.ok(doc.section.includes("directly spawned child"), "owned-child scope");
    assert.ok(doc.section.includes("preview/apply"), "no Preview/Apply stated");
    assert.ok(doc.section.includes("plugin-add"), "profile change mechanism stated");
    assert.ok(doc.section.includes("post-v1.4.5"), "post-release scope stated");
    assert.ok(doc.section.includes("not part of the v1.4.5 release"), "not in release artifact");
  });
  it("stale watch-with-profile syntax is gone", async () => {
    const text = await readFile(join(ROOT, "README.md"), "utf8");
    assert.ok(!text.includes("npm run watch -- --profile"), "stale syntax removed");
  });
  it("package manifest whitelist unchanged", async () => {
    const pkg = JSON.parse(await readFile(join(ROOT, "package.json"), "utf8"));
    assert.deepEqual(pkg.files, ["sync.mjs", "ui.mjs", "ui/", "dsh/host.mjs", "dsh/lifecycle.mjs", "dsh/client.js", "cordis.patch.yml"], "files whitelist");
    assert.deepEqual(Object.keys(pkg.dependencies || {}), ["yaml", "node-html-parser"], "no new runtime dependency");
    assert.equal(pkg.version, "1.4.7-rc2", "version bump only by contract v1.4.7-rc2 \u00a78");
  });
});
