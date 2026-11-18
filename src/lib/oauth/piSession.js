import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { PI_DIR, PI_MODULE, getPiStatus, isolatedPiEnv, reservePiLogin, releasePiLogin } from "./piRuntime.js";
import { PI_BRIDGE_SOURCE } from "./piBridge.js";
import { parsePiChatGPTAuthorization } from "./piChatGPTImport.js";

export function validatePiCallback(callbackUrl, authUrl) {
  let callback;
  try { callback = new URL(callbackUrl); } catch { throw new Error("Paste the complete Pi callback URL"); }
  if (callback.origin !== "http://127.0.0.1:1455" || callback.pathname !== "/auth/callback" || callback.username || callback.password) throw new Error("Invalid Pi callback URL");
  const expectedState = new URL(authUrl).searchParams.get("state");
  if (!expectedState || callback.searchParams.get("state") !== expectedState) throw new Error("Pi OAuth state mismatch");
  if (!callback.searchParams.get("code") || !callback.searchParams.get("client_id")) throw new Error("Pi callback must contain code and issued client_id");
  return callback.href;
}

export function createPiSessionManager({ saveConnection, spawnChild = spawn, status = getPiStatus, baseDir = PI_DIR, moduleDir = PI_MODULE, timeoutMs = 10 * 60 * 1000 } = {}) {
  const sessions = new Map();
  let active;
  const view = session => ({ sessionId: session.id, status: session.status, ...(session.authUrl ? { authUrl: session.authUrl } : {}), ...(session.error ? { error: session.error } : {}), ...(session.connection ? { connection: session.connection } : {}) });
  function get(id) {
    const session = sessions.get(id);
    if (!session) throw new Error("Pi login session not found; start a new login");
    return session;
  }
  async function finish(session, state, error) {
    if (session.finishing || ["done", "error"].includes(session.status)) return session.finishing;
    session.finishing = (async () => {
      session.error = error;
      clearTimeout(session.timer);
      if (session.child && session.child.exitCode === null) {
        await new Promise(resolve => {
          const child = session.child;
          const force = setTimeout(() => child.kill(), 1000);
          child.once("close", () => { clearTimeout(force); resolve(); });
          try { child.stdin.end(JSON.stringify({ type: "cancel" }) + "\n"); } catch { child.kill(); }
        });
      }
      try {
        if (session.dir) await fs.rm(session.dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
      } catch {
        state = "error";
        session.error = "Pi login ended, but temporary authorization cleanup failed; remove leftover login directories from the managed Pi data directory";
      }
      session.status = state;
      if (active === session.id) active = undefined;
      releasePiLogin();
      const expiry = setTimeout(() => sessions.delete(session.id), 5 * 60 * 1000);
      expiry.unref?.();
    })();
    return session.finishing;
  }
  async function consume(session, message) {
    if (session.finishing) return;
    if (message.type === "auth_url") {
      const url = new URL(message.url);
      if (url.origin !== "https://auth.openai.com" || url.pathname !== "/api/accounts/authorize") throw new Error("Unexpected Pi authorization URL");
      session.authUrl = url.href;
      session.status = "waiting";
    } else if (message.type === "completing") session.status = "completing";
    else if (message.type === "error") await finish(session, "error", message.error === "Port 1455 is in use; cancel other Pi or Codex logins and retry" ? message.error : "Pi login failed; restart login and check port 1455 and the callback URL");
    else if (message.type === "done") {
      session.status = "completing";
      const credentials = parsePiChatGPTAuthorization(await fs.readFile(path.join(session.dir, "auth.json"), "utf8"));
      if (session.finishing) return;
      const connection = await saveConnection({ provider: "openai-chatgpt", authType: "oauth", name: credentials.providerSpecificData.oauthClientId, ...credentials, testStatus: "unknown" });
      session.connection = { id: connection.id, provider: connection.provider };
      await finish(session, "done");
    }
  }
  async function launch(session) {
    try {
      if (!(await status()).installed) throw new Error("Pi is not installed; update Pi first");
      if (session.finishing) return;
      await fs.mkdir(baseDir, { recursive: true });
      if (session.finishing) return;
      session.dir = await fs.mkdtemp(path.join(baseDir, "login-"));
      await fs.chmod(session.dir, 0o700);
      await fs.writeFile(path.join(session.dir, "bridge.mjs"), PI_BRIDGE_SOURCE, { mode: 0o600 });
      if (session.finishing) { await fs.rm(session.dir, { recursive: true, force: true }); return; }
      const child = session.child = spawnChild(process.execPath, [path.join(session.dir, "bridge.mjs"), path.join(moduleDir, "dist", "bundle", "index.js")], { cwd: session.dir, env: isolatedPiEnv(session.dir), stdio: ["pipe", "pipe", "pipe"], shell: false, windowsHide: true });
      child.stdin.on("error", () => {});
      child.stderr.on("data", () => {}); // Drain, never log provider error bodies or secrets.
      let buffer = "";
      let pending = Promise.resolve();
      child.stdout.on("data", chunk => {
        buffer += chunk.toString("utf8");
        if (buffer.length > 65536) { void finish(session, "error", "Invalid Pi subprocess output"); return; }
        let newline;
        while ((newline = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
          pending = pending.then(() => consume(session, JSON.parse(line))).catch(() => finish(session, "error", "Could not import Pi authorization"));
        }
      });
      child.once("error", () => { void finish(session, "error", "Could not start Pi subprocess"); });
      child.once("close", () => { void pending.then(() => { if (!session.finishing) return finish(session, "error", "Pi exited before completing login"); }); });
    } catch (error) { await finish(session, "error", error.message === "Pi is not installed; update Pi first" ? error.message : "Could not start isolated Pi login"); }
  }
  return {
    start() {
      if (active) throw new Error("A Pi login is already running; finish or cancel it first");
      reservePiLogin();
      const session = { id: randomUUID(), status: "starting" };
      sessions.set(session.id, session); active = session.id;
      session.timer = setTimeout(() => { void finish(session, "error", "Pi login timed out"); }, timeoutMs);
      session.timer.unref?.();
      void launch(session);
      return view(session);
    },
    poll(id) { return view(get(id)); },
    complete(id, callbackUrl) {
      const session = get(id);
      if (session.finishing || session.status !== "waiting" || !session.authUrl || !session.child?.stdin.writable) throw new Error("Pi login is not waiting for a callback");
      const validated = validatePiCallback(callbackUrl, session.authUrl);
      session.child.stdin.write(JSON.stringify({ type: "callback", callbackUrl: validated }) + "\n");
      session.status = "completing";
      return view(session);
    },
    async cancel(id) { const session = get(id); await finish(session, "error", "Pi login cancelled"); return view(session); },
    isActive() { return Boolean(active); },
  };
}
