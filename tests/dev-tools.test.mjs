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
