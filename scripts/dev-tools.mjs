import { spawn } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve, dirname, delimiter, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

const USAGE_REGISTER = "Usage: npm run register -- --profile <name>\n" + "  Register the local checkout into one explicit DSH profile.\n" + "  --profile <name>   required; an existing profile (never created here)";
const TARGET_PREFIX = "ocms-s register: target profile ";
const BACKSLASH = String.fromCharCode(92);
const PROFILE_PATTERN = /^[A-Za-z0-9._-]+$/;

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
  const cands = process.platform === "win32" ? ["dsh.cmd", "dsh.exe", "dsh.bat", "dsh"] : ["dsh"];
  const dirs = raw.split(delimiter);
  for (const dir of dirs) {
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

function defaultSpawn(file, args) {
  return new Promise((done) => {
    const child = spawn(file, args, { stdio: "inherit", shell: false });
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
      if (isAbsolute(binField) || binField.split("/").indexOf("..") !== -1) {
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
  if (pkgName !== "ocms-s") {
    printError("ocms-s register: unexpected package name for " + repoRoot);
    return 1;
  }
  const dshBin = await findDsh(env);
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
  if (!present) {
    printError("ocms-s register: profile " + JSON.stringify(profile) + " does not exist; refusing to create it (existing profiles only)");
    return 1;
  }
  const launch = await resolveLaunch(dshBin);
  if (!launch || launch.shell !== false || typeof launch.file !== "string" || !Array.isArray(launch.argsPrefix)) {
    printError("ocms-s register: dsh launcher is not a safely invocable installation; refusing without shell fallback");
    return 1;
  }
  return await spawnFn(launch.file, launch.argsPrefix.concat(["plugin", "--profile", profile, "add", repoRoot]));
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
const invokedAsMain = invokedPath === fileURLToPath(import.meta.url);
if (invokedAsMain) {
  const cliArgs = process.argv.slice(2);
  const sub = cliArgs[0];
  if (sub !== "register") {
    console.error("ocms-s dev-tools: unknown subcommand " + JSON.stringify(sub || "") + "\n" + USAGE_REGISTER);
    process.exitCode = 1;
  } else {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const code = await runRegister({ argv: cliArgs.slice(1), env: process.env, repoRoot: root });
    process.exitCode = code;
  }
}
