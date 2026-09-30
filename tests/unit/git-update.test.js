import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getPm2ProcessName,
  getGitUpdateStatus,
  isGitUpdateRunning,
  reconcileRestartedOperation,
  readGitUpdateState,
  startGitUpdate,
  writeGitUpdateState,
} from "../../src/lib/gitUpdate.js";

let tempDir;
let statePath;
let logPath;

function commandResult(stdout = "") {
  return { stdout, stderr: "" };
}

function createGitCommandMock({ counts = "0\t2", porcelain = "" } = {}) {
  return vi.fn(async (_command, args) => {
    const key = args.join(" ");
    const results = {
      "rev-parse --show-toplevel": tempDir,
      "fetch --quiet --prune": "",
      "branch --show-current": "main",
      "rev-parse --abbrev-ref --symbolic-full-name @{upstream}": "origin/main",
      "rev-parse HEAD": "1111111111111111111111111111111111111111",
      "rev-parse @{upstream}": "2222222222222222222222222222222222222222",
      "rev-list --left-right --count HEAD...@{upstream}": counts,
      "status --porcelain -uno": porcelain,
      "log -1 --pretty=%s @{upstream}": "Remote update",
    };

    if (!(key in results)) throw new Error(`Unexpected Git command: ${key}`);
    return commandResult(results[key]);
  });
}

beforeEach(() => {
  vi.stubEnv("PM2_PROCESS", "");
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-git-update-"));
  statePath = path.join(tempDir, "state.json");
  logPath = path.join(tempDir, "update.log");
});

afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("getPm2ProcessName", () => {
  it("uses 9router by default", () => {
    expect(getPm2ProcessName()).toBe("9router");
  });

  it("reads the configured PM2 process", () => {
    vi.stubEnv("PM2_PROCESS", "router-production");

    expect(getPm2ProcessName()).toBe("router-production");
  });

  it("rejects unsupported process names before updating", () => {
    vi.stubEnv("PM2_PROCESS", "router & shutdown");

    expect(() => getPm2ProcessName()).toThrow("unsupported characters");
  });
});

describe("reconcileRestartedOperation", () => {
  it("marks a restarting operation successful when the commit matches the target", () => {
    const restartRequestedAt = Date.parse("2026-08-26T10:00:00.000Z");
    const state = {
      operationId: "operation-1",
      status: "running",
      phase: "restarting",
      message: "Restarting application...",
      startedAt: "2026-08-26T09:59:00.000Z",
      updatedAt: new Date(restartRequestedAt).toISOString(),
      finishedAt: null,
      targetCommit: "aaaa1111",
    };

    const result = reconcileRestartedOperation(
      state,
      statePath,
      restartRequestedAt + 10_000,
      restartRequestedAt + 5_000,
      { currentCommit: "aaaa1111", remoteCommit: "aaaa1111" },
    );

    expect(result).toMatchObject({
      status: "success",
      phase: "done",
      message: "Update completed successfully.",
    });
    expect(readGitUpdateState(statePath)).toEqual(result);
  });

  it("marks a legacy restarting operation successful when HEAD matches the remote", () => {
    const restartRequestedAt = Date.parse("2026-08-26T10:00:00.000Z");
    const state = {
      operationId: "operation-2",
      status: "running",
      phase: "restarting",
      startedAt: "2026-08-26T09:59:00.000Z",
      updatedAt: new Date(restartRequestedAt).toISOString(),
      finishedAt: null,
    };

    const result = reconcileRestartedOperation(
      state,
      statePath,
      restartRequestedAt + 10_000,
      restartRequestedAt + 5_000,
      { currentCommit: "bbbb2222", remoteCommit: "bbbb2222" },
    );

    expect(result).toMatchObject({ status: "success", phase: "done" });
  });

  it("keeps the operation running when the commit does not match the target", () => {
    const restartRequestedAt = Date.parse("2026-08-26T10:00:00.000Z");
    const state = {
      status: "running",
      phase: "restarting",
      updatedAt: new Date(restartRequestedAt).toISOString(),
      targetCommit: "aaaa1111",
    };

    const result = reconcileRestartedOperation(
      state,
      statePath,
      restartRequestedAt + 10_000,
      restartRequestedAt + 5_000,
      { currentCommit: "cccc3333", remoteCommit: "aaaa1111" },
    );

    expect(result).toBe(state);
    expect(fs.existsSync(statePath)).toBe(false);
  });

  it("keeps the operation running in the original application process", () => {
    const restartRequestedAt = Date.parse("2026-08-26T10:00:00.000Z");
    const state = {
      status: "running",
      phase: "restarting",
      updatedAt: new Date(restartRequestedAt).toISOString(),
    };

    const result = reconcileRestartedOperation(
      state,
      statePath,
      restartRequestedAt + 1_000,
      restartRequestedAt - 60_000,
    );

    expect(result).toBe(state);
    expect(fs.existsSync(statePath)).toBe(false);
  });
});

describe("isGitUpdateRunning", () => {
  it("treats a worker that never left the starting phase as dead", () => {
    const startedAt = Date.now() - 45 * 1000;
    const state = {
      status: "running",
      phase: "starting",
      startedAt: new Date(startedAt).toISOString(),
      updatedAt: new Date(startedAt).toISOString(),
    };

    expect(isGitUpdateRunning(state)).toBe(false);
  });

  it("keeps a starting worker alive during its boot window", () => {
    const startedAt = Date.now() - 2 * 1000;
    const state = {
      status: "running",
      phase: "starting",
      startedAt: new Date(startedAt).toISOString(),
      updatedAt: new Date(startedAt).toISOString(),
    };

    expect(isGitUpdateRunning(state)).toBe(true);
  });

  it("does not expire a running operation that already published a later phase", () => {
    const startedAt = Date.now() - 45 * 1000;
    const state = {
      status: "running",
      phase: "building",
      startedAt: new Date(startedAt).toISOString(),
      updatedAt: new Date().toISOString(),
    };

    expect(isGitUpdateRunning(state)).toBe(true);
  });
});

describe("getGitUpdateStatus", () => {
  it("fetches and enables fast-forward updates when the upstream is ahead", async () => {
    const runCommand = createGitCommandMock();

    const status = await getGitUpdateStatus({ cwd: tempDir, runCommand, statePath });

    expect(status).toMatchObject({
      pm2Process: "9router",
      branch: "main",
      upstream: "origin/main",
      ahead: 0,
      behind: 2,
      dirty: false,
      updateAvailable: true,
      canUpdate: true,
    });
    expect(runCommand).toHaveBeenCalledWith(
      "git",
      ["fetch", "--quiet", "--prune"],
      { cwd: tempDir },
    );
  });

  it("blocks automatic updates when the working tree is dirty", async () => {
    const status = await getGitUpdateStatus({
      cwd: tempDir,
      runCommand: createGitCommandMock({ porcelain: " M package.json" }),
      statePath,
    });

    expect(status.updateAvailable).toBe(true);
    expect(status.canUpdate).toBe(false);
    expect(status.blockedReason).toContain("local changes");
  });

  it("blocks divergent branches", async () => {
    const status = await getGitUpdateStatus({
      cwd: tempDir,
      runCommand: createGitCommandMock({ counts: "1\t3" }),
      statePath,
    });

    expect(status).toMatchObject({ ahead: 1, behind: 3, canUpdate: false });
    expect(status.blockedReason).toContain("diverged");
  });

  it("skips fetch while an update operation is running", async () => {
    const startedAt = new Date().toISOString();
    writeGitUpdateState({ status: "running", startedAt }, statePath);
    const runCommand = createGitCommandMock();

    const status = await getGitUpdateStatus({ cwd: tempDir, runCommand, statePath });

    expect(status.updateInProgress).toBe(true);
    expect(status.canUpdate).toBe(false);
    expect(runCommand).not.toHaveBeenCalledWith(
      "git",
      ["fetch", "--quiet", "--prune"],
      expect.anything(),
    );
  });

  it("reports a worker stuck in the starting phase as failed", async () => {
    const startedAt = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    writeGitUpdateState({
      operationId: "operation-stuck",
      status: "running",
      phase: "starting",
      message: "Starting Git update...",
      startedAt,
      updatedAt: startedAt,
    }, statePath);

    const status = await getGitUpdateStatus({
      cwd: tempDir,
      runCommand: createGitCommandMock(),
      statePath,
    });

    expect(status.updateInProgress).toBe(false);
    expect(status.operation).toMatchObject({
      status: "error",
      phase: "error",
    });
    expect(readGitUpdateState(statePath)).toMatchObject({ status: "error" });
  });

  it("keeps a worker that just started inside its boot window", async () => {
    const startedAt = new Date().toISOString();
    writeGitUpdateState({
      operationId: "operation-booting",
      status: "running",
      phase: "starting",
      message: "Starting Git update...",
      startedAt,
      updatedAt: startedAt,
    }, statePath);

    const status = await getGitUpdateStatus({
      cwd: tempDir,
      runCommand: createGitCommandMock(),
      statePath,
    });

    expect(status.updateInProgress).toBe(true);
    expect(status.operation).toMatchObject({ status: "running" });
  });
});

describe("startGitUpdate", () => {
  it("persists state and starts a detached Node worker", () => {
    vi.stubEnv("PM2_PROCESS", "router-production");
    const scriptsDir = path.join(tempDir, "scripts");
    fs.mkdirSync(scriptsDir, { recursive: true });
    const workerPath = path.join(scriptsDir, "git-update-worker.mjs");
    fs.writeFileSync(workerPath, "", "utf8");
    const child = { once: vi.fn(), unref: vi.fn() };
    const spawnProcess = vi.fn(() => child);

    const operation = startGitUpdate({
      repoRoot: tempDir,
      spawnProcess,
      statePath,
      logPath,
      targetCommit: "2222222222222222222222222222222222222222",
    });

    expect(operation).toMatchObject({ status: "running", phase: "starting" });
    expect(readGitUpdateState(statePath)).toMatchObject({
      operationId: operation.operationId,
      status: "running",
      targetCommit: "2222222222222222222222222222222222222222",
    });
    expect(spawnProcess).toHaveBeenCalledWith(
      process.execPath,
      [workerPath, expect.any(String)],
      expect.objectContaining({ cwd: tempDir, detached: true, stdio: "ignore" }),
    );
    expect(child.unref).toHaveBeenCalled();

    const payload = spawnProcess.mock.calls[0][1][1];
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    expect(decoded).toMatchObject({
      repoRoot: tempDir,
      statePath,
      logPath,
      processName: "router-production",
      operation: { targetCommit: "2222222222222222222222222222222222222222" },
    });
  });

  it("rejects a second active update", () => {
    writeGitUpdateState({ status: "running", startedAt: new Date().toISOString() }, statePath);

    expect(() => startGitUpdate({ repoRoot: tempDir, statePath, logPath })).toThrow(
      "already in progress",
    );
  });
});

describe("git-update-worker", () => {
  // Resolve against this file, not cwd: the suite can be started from tests/ or
  // from the repository root.
  const workerPath = fileURLToPath(new URL("../../scripts/git-update-worker.mjs", import.meta.url));
  let server;
  let sockets;

  beforeAll(() => {
    // A missing script would also exit non-zero, making the assertions below pass
    // for the wrong reason.
    expect(fs.existsSync(workerPath)).toBe(true);
  });

  function buildOperation() {
    return {
      operationId: "operation-worker",
      status: "running",
      phase: "starting",
      message: "Starting Git update...",
      error: null,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      finishedAt: null,
      targetCommit: null,
    };
  }

  function startWorker({ statePath: workerStatePath = statePath, repoRoot = tempDir, prewrite = true } = {}) {
    const operation = buildOperation();
    if (prewrite) writeGitUpdateState(operation, workerStatePath);
    const payload = Buffer.from(JSON.stringify({
      repoRoot,
      statePath: workerStatePath,
      logPath,
      processName: "router-production",
      operation,
    })).toString("base64url");
    return spawn(process.execPath, [workerPath, payload], {
      cwd: repoRoot,
      stdio: "ignore",
      windowsHide: true,
    });
  }

  beforeAll(async () => {
    // A remote that accepts the connection and never answers keeps `git pull`
    // hanging, so the worker's boot announcement is what the poll observes.
    sockets = new Set();
    server = http.createServer(() => {});
    server.on("connection", (socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  });

  afterAll(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
  });

  it("publishes its real first phase without waiting for the first command", async () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "9router-worker-repo-"));
    const workerStatePath = path.join(repo, "state.json");
    const repository = path.join(repo, "repository");
    fs.mkdirSync(repository, { recursive: true });
    execFileSync("git", ["init", "-q"], { cwd: repository, windowsHide: true });
    execFileSync(
      "git",
      ["remote", "add", "origin", `http://127.0.0.1:${server.address().port}/repo.git`],
      { cwd: repository, windowsHide: true },
    );

    const child = startWorker({ statePath: workerStatePath, repoRoot: repository });
    const seen = [];
    try {
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        const state = readGitUpdateState(workerStatePath);
        if (state && state.phase !== "starting") {
          seen.push(state);
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    } finally {
      child.kill();
      fs.rmSync(repo, { recursive: true, force: true });
    }

    const state = seen[0];
    // The git pull is still hanging on the silent remote at this point.
    expect(state).toMatchObject({
      status: "running",
      phase: "pulling",
      message: "Downloading repository updates...",
      error: null,
    });
  }, 30000);

  it("reports a boot failure instead of exiting silently", async () => {
    // A file where the state directory should be makes every state write fail.
    const blockingFile = path.join(tempDir, "not-a-directory");
    fs.writeFileSync(blockingFile, "x", "utf8");
    const brokenStatePath = path.join(blockingFile, "state.json");

    const child = startWorker({ statePath: brokenStatePath, prewrite: false });
    const exitCode = await new Promise((resolve) => child.on("close", resolve));

    expect(exitCode).toBe(1);
  }, 30000);
});
