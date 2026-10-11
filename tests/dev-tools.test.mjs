import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { readFile, writeFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
