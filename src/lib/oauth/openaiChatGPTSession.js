import http from "node:http";
import { CHATGPT_REDIRECT_URI } from "open-sse/shared/openaiChatGPTAuth.js";

const sessions = new Map();
let server = null;
let serverTimer = null;
const TTL_MS = 10 * 60 * 1000;

export function registerChatGPTSession(authData) {
  for (const [state, session] of sessions) {
    if (Date.now() - session.createdAt > TTL_MS) sessions.delete(state);
  }
  sessions.set(authData.state, { ...authData, status: "pending", createdAt: Date.now() });
}

function getSession(state) {
  const session = sessions.get(state);
  if (!session || Date.now() - session.createdAt > TTL_MS) throw new Error("ChatGPT login expired; start again");
  return session;
}

export function getChatGPTSessionStatus(state) {
  const session = getSession(state);
  return { status: session.status, ...(session.error ? { error: session.error } : {}) };
}

export async function completeChatGPTSession(callbackUrl) {
  let url;
  try { url = new URL(callbackUrl); } catch { throw new Error("Paste the full ChatGPT callback URL"); }
  const expected = new URL(CHATGPT_REDIRECT_URI);
  if (url.origin !== expected.origin || url.pathname !== expected.pathname) throw new Error("Invalid ChatGPT callback URL");
  const state = url.searchParams.get("state");
  if (!state) throw new Error("Missing OAuth state");
  const session = getSession(state);
  if (session.status !== "pending") throw new Error("ChatGPT login already consumed");
  const code = url.searchParams.get("code");
  const clientId = url.searchParams.get("client_id")?.trim();
  if (url.searchParams.has("error")) throw new Error("ChatGPT authorization was declined");
  if (!code || !clientId) throw new Error("Missing authorization code or issued client_id");
  session.status = "exchanging";
  try {
    const { exchangeTokens } = await import("./providers/index.js");
    const { createProviderConnection } = await import("@/models");
    const tokenData = await exchangeTokens("openai-chatgpt", code, session.redirectUri, session.codeVerifier, state, { oauthClientId: clientId });
    const connection = await createProviderConnection({
      provider: "openai-chatgpt", authType: "oauth", ...tokenData,
      expiresAt: new Date(Date.now() + tokenData.expiresIn * 1000).toISOString(), testStatus: "active",
    });
    session.status = "done";
    return { success: true, connection: { id: connection.id, provider: connection.provider } };
  } catch {
    session.status = "error";
    session.error = "ChatGPT token exchange failed; start login again";
    throw new Error(session.error);
  } finally {
    delete session.codeVerifier;
  }
}

export function stopChatGPTProxy(state) {
  if (state) sessions.delete(state);
  if (serverTimer) { clearTimeout(serverTimer); serverTimer = null; }
  if (server) {
    server.close();
    server.closeAllConnections?.();
    server = null;
  }
}

export async function startChatGPTProxy(state) {
  const session = getSession(state);
  if (session.status !== "pending") throw new Error("ChatGPT login already consumed");
  if (server) return { success: true, serverSide: true };
  const listener = http.createServer(async (req, res) => {
    try {
      await completeChatGPTSession(new URL(req.url, CHATGPT_REDIRECT_URI).toString());
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end("<h1>ChatGPT connected</h1><p>You can close this window.</p>");
      setImmediate(() => stopChatGPTProxy());
    } catch {
      res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Invalid or expired ChatGPT callback. Return to the dashboard and retry.");
    }
  });
  return new Promise((resolve) => {
    listener.once("error", () => resolve({ success: false, serverSide: false, reason: "port_busy" }));
    listener.listen(1455, "127.0.0.1", () => {
      server = listener;
      listener.unref();
      serverTimer = setTimeout(() => stopChatGPTProxy(), TTL_MS);
      serverTimer.unref();
      resolve({ success: true, serverSide: true });
    });
  });
}
