import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const payload = process.argv[2];
if (!payload) process.exit(2);

const config = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
const { repoRoot, statePath, logPath, processName, operation } = config;
let state = { ...operation };

fs.mkdirSync(path.dirname(statePath), { recursive: true });
fs.mkdirSync(path.dirname(logPath), { recursive: true });
fs.writeFileSync(logPath, `[${new Date().toISOString()}] Git update started\n`, "utf8");

// Keeps updatedAt fresh so the main app can tell a live worker from a crashed one.
const heartbeat = setInterval(() => {
  try {
    writeState({});
  } catch {
    // transient write errors are retried on the next tick
  }
}, 30000);
heartbeat.unref?.();

// This worker is spawned by the running app, so it inherits that process's env.
// Next's standalone server.js sets __NEXT_PRIVATE_STANDALONE_CONFIG (and friends)
// at runtime; the build then skips config defaults and crashes with
// "TypeError: generate is not a function" because generateBuildId is undefined.
// Child builds must start from a clean Next environment.
function buildEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("__NEXT_PRIVATE") || key === "__NEXT_PROCESSED_ENV") delete env[key];
  }
  return env;
}

function writeState(patch) {
  state = { ...state, ...patch, updatedAt: new Date().toISOString() };
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2), "utf8");
}

function appendLog(message) {
  fs.appendFileSync(logPath, message, "utf8");
}

function commandSpec(command, args) {
  if (process.platform !== "win32" || command === "git") {
    return { executable: command, args };
  }

  // Bare name through cmd.exe: PATH + PATHEXT resolve both npm-style shims
  // (pm2.cmd) and standalone binaries (bun.exe) that ship without a .cmd.
  const tokens = [command, ...args];
  if (tokens.some((token) => !/^[a-zA-Z0-9._:@/+\-]+$/.test(token))) {
    throw new Error(`Unsafe ${command} command argument`);
  }

  return {
    executable: process.env.ComSpec || "cmd.exe",
    args: ["/d", "/s", "/c", tokens.join(" ")],
  };
}

function run(command, args, { phase, message, timeoutMs, captureStdout = false }) {
  writeState({ phase, message, error: null });
  appendLog(`\n[${new Date().toISOString()}] $ ${command} ${args.join(" ")}\n`);
  const invocation = commandSpec(command, args);

  return new Promise((resolve, reject) => {
    const child = spawn(invocation.executable, invocation.args, {
      cwd: repoRoot,
      windowsHide: true,
      shell: false,
      env: buildEnv(),
    });

    let stdout = "";
    let output = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`${command} timed out`));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      output += chunk.toString();
      appendLog(chunk.toString());
    });
    child.stderr.on("data", (chunk) => {
      output += chunk.toString();
      appendLog(chunk.toString());
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(captureStdout ? stdout : undefined);
        return;
      }
      // The bare exit code is useless in the dashboard, so carry the tail of the
      // command output into the state the panel renders.
      const tail = output
        .replace(/\u001b\[[0-9;]*m/g, "")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(-4)
        .join(" | ")
        .slice(0, 400);
      reject(new Error(`${command} exited with code ${code}${tail ? `: ${tail}` : ""}`));
    });
  });
}

try {
  await run("git", ["pull", "--ff-only"], {
    phase: "pulling",
    message: "Downloading repository updates...",
    timeoutMs: 2 * 60 * 1000,
  });
  const installedCommit = await run("git", ["rev-parse", "HEAD"], {
    phase: "pulling",
    message: "Verifying downloaded repository updates...",
    timeoutMs: 2 * 60 * 1000,
    captureStdout: true,
  });
  writeState({ targetCommit: installedCommit.trim() });
  try {
    await run("bun", ["--version"], {
      phase: "building",
      message: "Checking the Bun runtime...",
      timeoutMs: 30 * 1000,
    });
  } catch {
    throw new Error("Bun was not found on this machine. Install Bun (https://bun.sh) to build updates.");
  }
  // Runs the `build:bun` script plus its `postbuild:bun` hook (standalone assets).
  await run("bun", ["run", "build:bun"], {
    phase: "building",
    message: "Building the updated application with Bun...",
    timeoutMs: 30 * 60 * 1000,
  });
  await run("pm2", ["restart", processName], {
    phase: "restarting",
    message: "Restarting application...",
    timeoutMs: 60 * 1000,
  });

  const finishedAt = new Date().toISOString();
  writeState({
    status: "success",
    phase: "done",
    message: "Update completed successfully.",
    error: null,
    finishedAt,
  });
  appendLog(`\n[${finishedAt}] Update completed successfully\n`);
  process.exit(0);
} catch (error) {
  const finishedAt = new Date().toISOString();
  const message = String(error?.message || error);
  writeState({
    status: "error",
    phase: "error",
    message: "Update failed.",
    error: message,
    finishedAt,
  });
  appendLog(`\n[${finishedAt}] ERROR: ${message}\n`);
  process.exit(1);
}
