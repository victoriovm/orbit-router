import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getProviderConnections, getCombos, getDisabledModels, getProviderNodes } = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  getCombos: vi.fn(),
  getDisabledModels: vi.fn(),
  getProviderNodes: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections,
  getCombos,
  getCustomModels: vi.fn(async () => []),
  getModelAliases: vi.fn(async () => ({})),
  getProviderNodes,
}));
vi.mock("@/lib/disabledModelsDb", () => ({
  getDisabledModels,
}));
vi.mock("@/sse/services/tokenRefresh", () => ({
  updateProviderCredentials: vi.fn(),
}));
vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: vi.fn(() => null),
}));

import { buildModelsList } from "../../src/app/api/v1/models/route.js";

describe("/v1/models owned_by_name", () => {
  beforeEach(() => {
    getCombos.mockResolvedValue([]);
    getDisabledModels.mockResolvedValue({});
    getProviderNodes.mockResolvedValue([]);
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("expands an abbreviated alias to the provider display name", async () => {
    getProviderConnections.mockResolvedValue([
      {
        id: "conn-1",
        provider: "github",
        isActive: true,
        providerSpecificData: { enabledModels: ["gpt-5.2"] },
      },
    ]);

    const models = await buildModelsList(["llm"], { skipDynamicFetch: true });
    const entry = models.find((model) => model.id === "gh/gpt-5.2");

    expect(entry).toMatchObject({ owned_by: "gh", owned_by_name: "GitHub Copilot" });
  });

  it("keeps the provider name when the connection overrides the output prefix", async () => {
    getProviderConnections.mockResolvedValue([
      {
        id: "conn-1",
        provider: "github",
        isActive: true,
        providerSpecificData: { prefix: "work", enabledModels: ["gpt-5.2"] },
      },
    ]);

    const models = await buildModelsList(["llm"], { skipDynamicFetch: true });
    const entry = models.find((model) => model.id === "work/gpt-5.2");

    expect(entry).toMatchObject({ owned_by: "work", owned_by_name: "GitHub Copilot" });
  });

  it("names a custom compatible provider after its node", async () => {
    getProviderConnections.mockResolvedValue([
      {
        id: "conn-1",
        provider: "openai-compatible-chat-abc123",
        isActive: true,
        providerSpecificData: { prefix: "vllm", baseUrl: "http://127.0.0.1:8000/v1", enabledModels: ["my-model"] },
      },
    ]);
    getProviderNodes.mockResolvedValue([
      { id: "openai-compatible-chat-abc123", type: "openai-compatible", name: "Local vLLM" },
    ]);

    const models = await buildModelsList(["llm"], { skipDynamicFetch: true });
    const entry = models.find((model) => model.id === "vllm/my-model");

    expect(entry).toMatchObject({ owned_by: "vllm", owned_by_name: "Local vLLM" });
  });

  it("labels combos", async () => {
    getCombos.mockResolvedValue([{ name: "fallback-combo", kind: "llm", models: [] }]);

    const models = await buildModelsList(["llm"], { skipDynamicFetch: true });
    const entry = models.find((model) => model.id === "fallback-combo");

    expect(entry).toMatchObject({ owned_by: "combo", owned_by_name: "Combo" });
  });

  it("names web search entries from providers with an abbreviated alias", async () => {
    getProviderConnections.mockResolvedValue([
      { id: "conn-1", provider: "brave-search", isActive: true, apiKey: "sk-x", providerSpecificData: {} },
    ]);

    const models = await buildModelsList(["webSearch", "webFetch"], { skipDynamicFetch: true });
    const entry = models.find((model) => model.id === "brave/search");

    expect(entry).toMatchObject({
      owned_by: "brave",
      owned_by_name: "Brave Search",
      kind: "webSearch",
    });
  });

  it("names every listed model", async () => {
    getProviderConnections.mockResolvedValue([
      {
        id: "conn-1",
        provider: "github",
        isActive: true,
        providerSpecificData: { enabledModels: ["gpt-5.2"] },
      },
    ]);
    getCombos.mockResolvedValue([{ name: "fallback-combo", kind: "llm", models: [] }]);

    const models = await buildModelsList(["llm"], { skipDynamicFetch: true });

    expect(models.length).toBeGreaterThan(0);
    for (const model of models) {
      expect(typeof model.owned_by_name).toBe("string");
      expect(model.owned_by_name.trim()).not.toBe("");
    }
    expect(models.find((model) => model.id === "gh/gpt-5.2").owned_by_name).toBe("GitHub Copilot");
    expect(models.find((model) => model.id === "fallback-combo").owned_by_name).toBe("Combo");
  });
});