import { createHash, randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { CHATGPT_CONFIG, CHATGPT_REDIRECT_URI, requestChatGPTToken } from "open-sse/shared/openaiChatGPTAuth.js";

const hostHex = createHash("sha256").update(`orbit-router:${hostname()}`).digest("hex").slice(0, 32);
const hostId = `${hostHex.slice(0, 8)}-${hostHex.slice(8, 12)}-4${hostHex.slice(13, 16)}-8${hostHex.slice(17, 20)}-${hostHex.slice(20)}`;

const provider = {
  config: CHATGPT_CONFIG,
  flowType: "authorization_code_pkce",
  fixedPort: CHATGPT_CONFIG.fixedPort,
  callbackPath: CHATGPT_CONFIG.callbackPath,
  buildAuthUrl(config, redirectUri, state, challenge) {
    if (redirectUri !== CHATGPT_REDIRECT_URI) throw new Error("Invalid ChatGPT callback URL");
    const params = new URLSearchParams({
      client_id: config.clientId,
      agent_name_hint: "Pi",
      ext_agent_host_id: `urn:uuid:${hostId}`,
      response_type: "code",
      redirect_uri: redirectUri,
      resource: config.resource,
      scope: config.scope,
      state,
      code_challenge: challenge,
      code_challenge_method: config.codeChallengeMethod,
      nonce: randomUUID(),
    });
    return `${config.authorizeUrl}?${params}`;
  },
  async exchangeToken(config, code, redirectUri, verifier, state, meta) {
    if (redirectUri !== CHATGPT_REDIRECT_URI || !state || !verifier) throw new Error("Invalid ChatGPT OAuth session");
    return requestChatGPTToken({ grant_type: "authorization_code", code, redirect_uri: redirectUri, code_verifier: verifier }, meta?.oauthClientId, true);
  },
  mapTokens: (tokens) => tokens,
};
export default provider;
