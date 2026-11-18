import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: mocks.fetch }));
const { requestChatGPTToken, refreshChatGPTToken } = await import("../../open-sse/shared/openaiChatGPTAuth.js");
const token = () => ({ access_token: "direct", refresh_token: "rotated", expires_in: 3600, scope: "openid chatgpt.tokens.use.direct" });

describe("Pi OpenAI ChatGPT credential refresh", () => {
  beforeEach(() => vi.clearAllMocks());
  it("refreshes with the issued client, not Codex or the registration placeholder", async () => {
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify(token())));
    expect(await refreshChatGPTToken({ refreshToken: "old", providerSpecificData: { oauthClientId: "issued" } })).toMatchObject({ refreshToken: "rotated" });
    expect(mocks.fetch.mock.calls[0][0]).toBe("https://auth.openai.com/api/accounts/oauth/token");
    expect(Object.fromEntries(mocks.fetch.mock.calls[0][1].body)).toMatchObject({ grant_type: "refresh_token", client_id: "issued", refresh_token: "old", resource: "https://api.openai.com/v1" });
    expect(await refreshChatGPTToken({ refreshToken: "old" })).toBeNull();
    expect(await refreshChatGPTToken({ refreshToken: "old", providerSpecificData: { oauthClientId: "dynamic_agent_client" } })).toBeNull();
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
  it.each([{ scope: "openid" }, { expires_in: 0 }, { access_token: "" }, { refresh_token: "" }])("rejects invalid refresh responses %j", async (override) => {
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ ...token(), ...override })));
    await expect(requestChatGPTToken({ grant_type: "refresh_token", refresh_token: "old" }, "issued")).rejects.toThrow();
  });
  it("never includes upstream token response content in errors", async () => {
    mocks.fetch.mockResolvedValue(new Response("secret-refresh-token", { status: 401 }));
    await expect(requestChatGPTToken({}, "issued")).rejects.toThrow("OpenAI token request failed (401)");
  });
});
