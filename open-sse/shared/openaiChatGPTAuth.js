import { PROVIDER_OAUTH } from "../config/providers.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";

export const CHATGPT_CONFIG = PROVIDER_OAUTH["openai-chatgpt"];
const DIRECT_SCOPE = "chatgpt.tokens.use.direct";

export async function requestChatGPTToken(params, clientId) {
  if (typeof clientId !== "string" || !clientId.trim() || clientId === CHATGPT_CONFIG.clientId) {
    throw new Error("Missing issued OpenAI client ID; reconnect ChatGPT");
  }
  const response = await proxyAwareFetch(CHATGPT_CONFIG.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ ...params, client_id: clientId, resource: CHATGPT_CONFIG.resource }),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`OpenAI token request failed (${response.status}); reconnect ChatGPT`);
  const token = await response.json();
  for (const field of ["access_token", "refresh_token", "scope"]) {
    if (typeof token?.[field] !== "string" || !token[field].trim()) throw new Error(`Invalid OpenAI token response: ${field}`);
  }
  if (!Number.isFinite(token.expires_in) || token.expires_in <= 0) throw new Error("Invalid OpenAI token expiration");
  const scopes = token.scope.trim().split(/\s+/);
  if (!scopes.includes(DIRECT_SCOPE)) throw new Error("OpenAI did not grant direct ChatGPT access");
  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    ...(token.id_token ? { idToken: token.id_token } : {}),
    expiresIn: token.expires_in,
    providerSpecificData: { oauthClientId: clientId, scopes },
  };
}

export async function refreshChatGPTToken(credentials, log) {
  try {
    return await requestChatGPTToken({ grant_type: "refresh_token", refresh_token: credentials.refreshToken }, credentials.providerSpecificData?.oauthClientId);
  } catch {
    log?.warn?.("TOKEN_REFRESH", "OpenAI ChatGPT refresh failed; reconnect if the grant was revoked");
    return null;
  }
}
