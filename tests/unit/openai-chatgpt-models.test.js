import { describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ getConnection: vi.fn() }));
vi.mock("@/lib/localDb", () => ({
  getProviderConnectionById: mocks.getConnection,
  updateProviderCredentials: vi.fn(),
}));
vi.mock("next/server", () => ({ NextResponse: { json: (body, init = {}) => new Response(JSON.stringify(body), { status: init.status || 200, headers: { "Content-Type": "application/json" } }) } }));
const { GET } = await import("../../src/app/api/providers/[id]/models/route.js");

describe("OpenAI ChatGPT model discovery", () => {
  it("returns the Pi catalog without querying Codex or an API-key-only models endpoint", async () => {
    mocks.getConnection.mockResolvedValue({ id: "direct-1", provider: "openai-chatgpt", accessToken: "direct-token" });
    const fetch = vi.fn(() => { throw new Error("Unexpected network request"); });
    vi.stubGlobal("fetch", fetch);
    try {
      const response = await GET(new Request("http://localhost/api/providers/direct-1/models"), { params: Promise.resolve({ id: "direct-1" }) });
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.provider).toBe("openai-chatgpt");
      expect(body.models.some((model) => model.id === "gpt-6.1-sol")).toBe(true);
      expect(body.models.some((model) => model.id.endsWith("-review"))).toBe(false);
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
