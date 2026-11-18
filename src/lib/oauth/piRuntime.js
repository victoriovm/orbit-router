import { promises as fs } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { DATA_DIR } from "../dataDir.js";

export const PI_PACKAGE = "@earendil-works/pi-coding-agent";
export const PI_DIR = path.join(DATA_DIR, "pi-runtime");
export const PI_MODULE = path.join(PI_DIR, "node_modules", PI_PACKAGE);
let updating;
let loginReserved = false;
export function reservePiLogin() {
  if (updating) throw new Error("Pi update is in progress");
  if (loginReserved) throw new Error("A Pi login is already running; finish or cancel it first");
  loginReserved = true;
}
export function releasePiLogin() { loginReserved = false; }

export function isolatedPiEnv(dir) {
  const env = {};
  for (const key of ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT", "TEMP", "TMP", "LANG", "LC_ALL"]) {
    if (process.env[key]) env[key] = process.env[key];
  }
  return { ...env, HOME: dir, USERPROFILE: dir, APPDATA: path.join(dir, "appdata"), LOCALAPPDATA: path.join(dir, "local"), PI_CODING_AGENT_DIR: dir, PI_OAUTH_CALLBACK_HOST: "127.0.0.1" };
}

export async function getPiStatus() {
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(PI_MODULE, "package.json"), "utf8"));
    await fs.access(path.join(PI_MODULE, "dist", "bundle", "index.js"));
    return { installed: true, version: pkg.version, updating: Boolean(updating) };
  } catch { return { installed: false, version: null, updating: Boolean(updating) }; }
}

async function npmCommand() {
  // Invoke npm's JS entry with Node, never a shell or a Windows .cmd shim.
  const candidates = [path.join(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js")];
  for (const dir of (process.env.PATH || process.env.Path || "").split(path.delimiter)) {
    candidates.push(path.join(dir, "node_modules/npm/bin/npm-cli.js"));
    try { candidates.push(await fs.realpath(path.join(dir, "npm"))); } catch { /* next */ }
  }
  for (const file of candidates) {
    try { if ((await fs.stat(file)).isFile()) return file; } catch { /* next */ }
  }
  throw new Error("npm was not found; install Node.js with npm to update Pi");
}

export function updatePi() {
  if (loginReserved) throw new Error("Finish or cancel the Pi login before updating");
  if (updating) return updating;
  updating = (async () => {
    await fs.mkdir(PI_DIR, { recursive: true });
    const home = path.join(PI_DIR, "install-home");
    await fs.mkdir(home, { recursive: true });
    const npm = await npmCommand();
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [npm, "install", "--prefix", PI_DIR, "--ignore-scripts", "--no-audit", "--no-fund", "--package-lock=false", `${PI_PACKAGE}@latest`], {
        cwd: PI_DIR, env: { ...isolatedPiEnv(home), npm_config_cache: path.join(PI_DIR, "npm-cache"), npm_config_userconfig: path.join(home, ".npmrc"), npm_config_globalconfig: path.join(home, "global-npmrc") },
        stdio: "ignore", windowsHide: true, shell: false,
      });
      const timer = setTimeout(() => { child.kill(); reject(new Error("Pi installation timed out")); }, 180000);
      child.once("error", error => { clearTimeout(timer); reject(error); });
      child.once("close", code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error("Pi installation failed; Node.js >=22.19 and registry connectivity are required")); });
    });
    const status = await getPiStatus();
    if (!status.installed) throw new Error("Pi installation is incomplete");
    return { installed: status.installed, version: status.version };
  })().finally(() => { updating = undefined; });
  return updating;
}
