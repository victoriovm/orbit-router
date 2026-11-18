import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ fetch: vi.fn(), exchange: vi.fn(), create: vi.fn() }));
vi.mock("open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: mocks.fetch }));
vi.mock("../../src/lib/oauth/providers/index.js", () => ({ exchangeTokens: mocks.exchange }));
vi.mock("@/models", () => ({ createProviderConnection: mocks.create }));
const { requestChatGPTToken, refreshChatGPTToken, CHATGPT_REDIRECT_URI } = await import("../../open-sse/shared/openaiChatGPTAuth.js");
const { default: provider } = await import("../../src/lib/oauth/providers/openai-chatgpt.js");
const { registerChatGPTSession, completeChatGPTSession, getChatGPTSessionStatus } = await import("../../src/lib/oauth/openaiChatGPTSession.js");
const token = () => ({ access_token: "direct", refresh_token: "rotated", expires_in: 3600, scope: "openid chatgpt.tokens.use.direct", id_token: "identity" });

describe("Pi OpenAI ChatGPT direct OAuth", () => {
  beforeEach(() => vi.clearAllMocks());
  it("requests the direct grant with PKCE, nonce, stable agent host and dynamic registration", () => {
    const first = new URL(provider.buildAuthUrl(provider.config, CHATGPT_REDIRECT_URI, "state", "challenge"));
    const second = new URL(provider.buildAuthUrl(provider.config, CHATGPT_REDIRECT_URI, "other", "challenge"));
    expect(first.origin + first.pathname).toBe("https://auth.openai.com/api/accounts/authorize");
    expect(first.searchParams.get("client_id")).toBe("dynamic_agent_client");
    expect(first.searchParams.get("agent_name_hint")).toBe("Pi");
    expect(first.searchParams.get("resource")).toBe("https://api.openai.com/v1");
    expect(first.searchParams.get("scope")).toContain("chatgpt.tokens.use.direct");
    expect(first.searchParams.get("ext_agent_host_id")).toMatch(/^urn:uuid:[a-f0-9-]{36}$/);
    expect(second.searchParams.get("ext_agent_host_id")).toBe(first.searchParams.get("ext_agent_host_id"));
    expect(second.searchParams.get("nonce")).not.toBe(first.searchParams.get("nonce"));
  });
  it("exchanges using the issued client and stores it for refresh", async () => {
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify(token())));
    const result = await provider.exchangeToken(provider.config, "code", CHATGPT_REDIRECT_URI, "verifier", "state", { oauthClientId: "issued-client" });
    expect(result).toMatchObject({ accessToken: "direct", refreshToken: "rotated", providerSpecificData: { oauthClientId: "issued-client" } });
    const [url, options] = mocks.fetch.mock.calls[0];
    expect(url).toBe("https://auth.openai.com/api/accounts/oauth/token");
    expect(Object.fromEntries(options.body)).toMatchObject({ client_id: "issued-client", code_verifier: "verifier", resource: "https://api.openai.com/v1" });
  });
  it("refreshes with the issued client, not Codex or the registration placeholder", async () => {
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify(token())));
    expect(await refreshChatGPTToken({ refreshToken: "old", providerSpecificData: { oauthClientId: "issued" } })).toMatchObject({ refreshToken: "rotated" });
    expect(Object.fromEntries(mocks.fetch.mock.calls[0][1].body)).toMatchObject({ grant_type: "refresh_token", client_id: "issued", refresh_token: "old", resource: "https://api.openai.com/v1" });
    expect(await refreshChatGPTToken({ refreshToken: "old" })).toBeNull();
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
  it.each([ { scope: "openid" }, { expires_in: 0 }, { access_token: "" }, { refresh_token: "" }, { id_token: "" } ])("rejects invalid grant responses %j", async (override) => {
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ ...token(), ...override })));
    await expect(requestChatGPTToken({ code: "code" }, "issued", true)).rejects.toThrow();
  });
  it("never includes upstream token response content in errors", async () => {
    mocks.fetch.mockResolvedValue(new Response("secret-refresh-token", { status: 401 }));
    await expect(requestChatGPTToken({}, "issued")).rejects.toThrow("OpenAI token request failed (401)");
  });
  it("uses server-held PKCE, rejects missing or unknown state, and consumes a session once", async () => {
    registerChatGPTSession({ state: "trusted-state", codeVerifier: "server-verifier", redirectUri: CHATGPT_REDIRECT_URI });
    mocks.exchange.mockResolvedValue({ accessToken: "direct", refreshToken: "refresh", expiresIn: 3600, providerSpecificData: { oauthClientId: "issued" } });
    mocks.create.mockResolvedValue({ id: "new-connection", provider: "openai-chatgpt" });
    await expect(completeChatGPTSession(`${CHATGPT_REDIRECT_URI}?code=c&client_id=issued`)).rejects.toThrow("state");
    await expect(completeChatGPTSession(`${CHATGPT_REDIRECT_URI}?code=c&state=unknown&client_id=issued`)).rejects.toThrow("expired");
    await expect(completeChatGPTSession(`http://evil.example/auth/callback?code=c&state=trusted-state&client_id=issued`)).rejects.toThrow("callback");
    await expect(completeChatGPTSession(`${CHATGPT_REDIRECT_URI}?code=c&state=trusted-state`)).rejects.toThrow("client_id");
    expect(await completeChatGPTSession(`${CHATGPT_REDIRECT_URI}?code=c&state=trusted-state&client_id=issued`)).toMatchObject({ success: true });
    expect(mocks.exchange).toHaveBeenCalledWith("openai-chatgpt", "c", CHATGPT_REDIRECT_URI, "server-verifier", "trusted-state", { oauthClientId: "issued" });
    expect(getChatGPTSessionStatus("trusted-state")).toEqual({ status: "done" });
    await expect(completeChatGPTSession(`${CHATGPT_REDIRECT_URI}?code=c&state=trusted-state&client_id=issued`)).rejects.toThrow("consumed");
  });
});
