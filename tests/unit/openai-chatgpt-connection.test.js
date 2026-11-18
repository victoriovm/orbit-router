import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getConnection: vi.fn(),
  updateConnection: vi.fn(),
  fetch: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("@/lib/localDb", () => ({ getProviderConnectionById: mocks.getConnection, updateProviderConnection: mocks.updateConnection }));
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: vi.fn().mockResolvedValue({}) }));
vi.mock("open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: mocks.fetch }));
vi.mock("open-sse/services/oauthCredentialManager.js", () => ({
  shouldRefreshCredentials: vi.fn((_, connection) => connection.expiresAt === "expired"),
  refreshProviderCredentials: mocks.refresh,
}));

const { testSingleConnection } = await import("../../src/app/api/providers/[id]/test/testUtils.js");

describe("OpenAI ChatGPT connection probe", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", mocks.fetch);
    mocks.getConnection.mockResolvedValue({ id: "chatgpt-1", provider: "openai-chatgpt", authType: "oauth", accessToken: "direct-token", refreshToken: "refresh", providerSpecificData: { oauthClientId: "issued-client" } });
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it("checks authentication at the Responses endpoint without spending generation quota", async () => {
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ error: { message: "Invalid model" } }), { status: 400 }));
    expect(await testSingleConnection("chatgpt-1")).toMatchObject({ valid: true });
    const [url, options] = mocks.fetch.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(options.headers.Authorization).toBe("Bearer direct-token");
    expect(JSON.parse(options.body)).toMatchObject({ model: "__auth_probe__", stream: true, store: false });
    expect(options.headers).not.toHaveProperty("originator");
  });

  it.each([401, 403])("does not accept authentication failure %s", async (status) => {
    mocks.fetch.mockResolvedValue(new Response("Unauthorized", { status }));
    mocks.refresh.mockResolvedValue(null);
    expect(await testSingleConnection("chatgpt-1")).toMatchObject({ valid: false });
  });

  it("refreshes with the full connection and preserves issued client metadata", async () => {
    const connection = await mocks.getConnection();
    connection.expiresAt = "expired";
    mocks.refresh.mockResolvedValue({ accessToken: "new-direct", refreshToken: "new-refresh", expiresIn: 3600, providerSpecificData: { oauthClientId: "issued-client", scopes: ["chatgpt.tokens.use.direct"] } });
    mocks.fetch.mockResolvedValue(new Response("Invalid model", { status: 400 }));
    expect(await testSingleConnection(connection.id)).toMatchObject({ valid: true, refreshed: true });
    expect(mocks.refresh).toHaveBeenCalledWith("openai-chatgpt", connection, expect.anything());
    expect(mocks.updateConnection).toHaveBeenCalledWith(connection.id, expect.objectContaining({ accessToken: "new-direct", providerSpecificData: expect.objectContaining({ oauthClientId: "issued-client" }) }));
  });
});
