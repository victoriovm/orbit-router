import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createPiSessionManager, validatePiCallback } from "../../src/lib/oauth/piSession.js";
import { isolatedPiEnv } from "../../src/lib/oauth/piRuntime.js";

const authUrl = "https://auth.openai.com/api/accounts/authorize?state=expected";
const callbackUrl = "http://127.0.0.1:1455/auth/callback?code=code&state=expected&client_id=issued";
async function until(fn) { for (let i = 0; i < 200; i++) { if (await fn()) return; await new Promise(r => setTimeout(r, 10)); } throw new Error("Timed out"); }
async function fixture(timeoutMs = 5000) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-test-"));
  let child, cwd;
  const saveConnection = vi.fn(async () => ({ id: "connection", provider: "openai-chatgpt" }));
  const spawnChild = vi.fn((_exe, _args, options) => {
    cwd = options.cwd;
    child = new EventEmitter(); child.exitCode = null;
    child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.stdin = new Writable({ write(_chunk, _encoding, cb) { cb(); } });
    child.stdin.on("finish", () => { child.exitCode = 0; child.emit("close", 0); });
    child.kill = () => { child.exitCode = 1; child.emit("close", 1); };
    return child;
  });
  const manager = createPiSessionManager({ saveConnection, spawnChild, baseDir: dir, status: async () => ({ installed: true }), timeoutMs });
  return { manager, dir, saveConnection, spawnChild, child: () => child, cwd: () => cwd };
}
describe("managed Pi login", () => {
  it("validates complete callbacks and state, not Codex or arbitrary URLs", () => {
    expect(validatePiCallback(callbackUrl, authUrl)).toBe(callbackUrl);
    for (const value of ["code", callbackUrl.replace("expected", "wrong"), callbackUrl.replace("127.0.0.1", "localhost"), callbackUrl.replace("client_id=issued", "other=issued")]) expect(() => validatePiCallback(value, authUrl)).toThrow();
  });
  it("does not inherit user API keys or OAuth environment", () => {
    vi.stubEnv("OPENAI_API_KEY", "do-not-inherit");
    try {
      expect(isolatedPiEnv("private").OPENAI_API_KEY).toBeUndefined();
      expect(isolatedPiEnv("private").PI_CODING_AGENT_DIR).toBe("private");
    } finally { vi.unstubAllEnvs(); }
  });
  it("imports only auth.json after completion, never exposes credentials, cleans process and directory", async () => {
    const f = await fixture();
    const session = f.manager.start();
    await until(() => f.child());
    f.child().stdout.write(JSON.stringify({ type: "auth_url", url: authUrl }) + "\n");
    await until(() => f.manager.poll(session.sessionId).status === "waiting");
    f.manager.complete(session.sessionId, callbackUrl);
    await fs.writeFile(path.join(f.cwd(), "auth.json"), JSON.stringify({ openai: { type: "oauth", access: "SECRET", refresh: "REFRESH", expires: 1800000000000, clientId: "issued", scopes: ["chatgpt.tokens.use.direct"] } }));
    f.child().stdout.write('{"type":"done"}\n');
    await until(() => f.manager.poll(session.sessionId).status === "done");
    expect(f.saveConnection).toHaveBeenCalledOnce();
    expect(f.saveConnection.mock.calls[0][0].name).toBe("issued");
    expect(JSON.stringify(f.manager.poll(session.sessionId))).not.toContain("SECRET");
    await expect(fs.access(f.cwd())).rejects.toThrow();
    expect(f.child().exitCode).toBe(0);
    await fs.rm(f.dir, { recursive: true, force: true });
  });
  it("cancels and cleans a waiting process and serializes sessions", async () => {
    const f = await fixture(); const s = f.manager.start();
    expect(() => f.manager.start()).toThrow(/already running/);
    await until(() => f.child());
    await f.manager.cancel(s.sessionId);
    expect(f.manager.poll(s.sessionId).status).toBe("error");
    await expect(fs.access(f.cwd())).rejects.toThrow();
    expect(f.saveConnection).not.toHaveBeenCalled();
    await fs.rm(f.dir, { recursive: true, force: true });
  });
  it("times out and cleans its process and temporary auth directory", async () => {
    const f = await fixture(80); const s = f.manager.start();
    await until(() => f.manager.poll(s.sessionId).status === "error");
    expect(f.manager.poll(s.sessionId).error).toContain("timed out");
    expect(await fs.readdir(f.dir)).toEqual([]);
    expect(f.saveConnection).not.toHaveBeenCalled();
    await fs.rm(f.dir, { recursive: true, force: true });
  });
  it("rejects malformed protocol without exposing its contents and cleans up", async () => {
    const f = await fixture(); const s = f.manager.start(); await until(() => f.child());
    f.child().stdout.write("secret-not-json\n");
    await until(() => f.manager.poll(s.sessionId).status === "error");
    expect(JSON.stringify(f.manager.poll(s.sessionId))).not.toContain("secret-not-json");
    expect(await fs.readdir(f.dir)).toEqual([]);
    await fs.rm(f.dir, { recursive: true, force: true });
  });
  it("cancellation during preflight never launches or creates an orphan", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-race-"));
    let ready; const spawnChild = vi.fn();
    const manager = createPiSessionManager({ baseDir: dir, spawnChild, status: () => new Promise(r => { ready = r; }) });
    const s = manager.start(); await manager.cancel(s.sessionId); ready({ installed: true });
    await new Promise(r => setTimeout(r, 30));
    expect(spawnChild).not.toHaveBeenCalled(); expect(await fs.readdir(dir)).toEqual([]);
    await fs.rm(dir, { recursive: true, force: true });
  });
});
