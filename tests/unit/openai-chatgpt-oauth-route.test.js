import { describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ generate: vi.fn(), register: vi.fn(), complete: vi.fn(), create: vi.fn() }));
vi.mock("@/lib/oauth/providers", () => ({ generateAuthData: mocks.generate, getProvider: vi.fn(), exchangeTokens: vi.fn(), requestDeviceCode: vi.fn(), pollForToken: vi.fn() }));
vi.mock("@/lib/oauth/openaiChatGPTSession", () => ({ registerChatGPTSession: mocks.register, completeChatGPTSession: mocks.complete, getChatGPTSessionStatus: vi.fn(), startChatGPTProxy: vi.fn(), stopChatGPTProxy: vi.fn() }));
vi.mock("@/models", () => ({ createProviderConnection: mocks.create }));
vi.mock("@/lib/localDb", () => ({ getProviderConnections: vi.fn() }));
vi.mock("next/server", () => ({ NextResponse: { json: (body, init = {}) => new Response(JSON.stringify(body), { status: init.status || 200 }) } }));
const { GET, POST } = await import("../../src/app/api/oauth/[provider]/[action]/route.js");
const params = (action) => ({ params: Promise.resolve({ provider: "openai-chatgpt", action }) });

describe("ChatGPT OAuth route safety", () => {
  it("registers server-held state and forces the exact loopback redirect", async () => {
    const auth = { state: "state", codeVerifier: "server-secret", redirectUri: "http://127.0.0.1:1455/auth/callback" };
    mocks.generate.mockResolvedValue(auth);
    const response = await GET(new Request("http://localhost/api/oauth/openai-chatgpt/authorize?redirect_uri=https://evil.example"), params("authorize"));
    expect(response.status).toBe(200);
    expect(mocks.generate).toHaveBeenCalledWith("openai-chatgpt", "http://127.0.0.1:1455/auth/callback");
    expect(mocks.register).toHaveBeenCalledWith(auth);
  });
  it("does not allow the legacy raw-JWT token-import bypass", async () => {
    const response = await POST(new Request("http://localhost/api/oauth/openai-chatgpt/exchange", { method: "POST", body: JSON.stringify({ code: "eyJ.fake.token" }) }), params("exchange"));
    expect(response.status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.complete).not.toHaveBeenCalled();
  });
  it("rejects a callback state inconsistent with the submitted attempt", async () => {
    const response = await POST(new Request("http://localhost/api/oauth/openai-chatgpt/exchange", { method: "POST", body: JSON.stringify({ state: "expected", callbackUrl: "http://127.0.0.1:1455/auth/callback?state=other&code=c&client_id=issued" }) }), params("exchange"));
    expect(response.status).toBe(400);
    expect(mocks.complete).not.toHaveBeenCalled();
  });
});
