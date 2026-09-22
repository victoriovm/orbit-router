/**
 * `/v1/models` always emits a `context_length`, because clients that find none
 * guess the window from the model name and guess high. When nothing in the
 * capability tables matched the id, that number is only the 200k DEFAULT floor —
 * a value nobody declared, which for a local 32k model or an uncatalogued 1M one
 * is simply wrong. Those entries carry `context_misconfig: true` so a client can
 * tell a declared window from a stand-in.
 */

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
import { resolveModelCapabilities } from "../../open-sse/providers/capabilities.js";

describe("/v1/models context_misconfig", () => {
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

  it("flags a custom compatible model the tables know nothing about", async () => {
    getProviderConnections.mockResolvedValue([
      {
        id: "conn-1",
        provider: "openai-compatible-chat-abc123",
        isActive: true,
        providerSpecificData: { prefix: "vllm", baseUrl: "http://127.0.0.1:8000/v1", enabledModels: ["my-local-model-xyz"] },
      },
    ]);

    const models = await buildModelsList(["llm"], { skipDynamicFetch: true });
    const entry = models.find((model) => model.id === "vllm/my-local-model-xyz");

    expect(entry).toMatchObject({ context_misconfig: true, context_length: 200000 });
  });

  it("leaves a model a family pattern recognizes unmarked", async () => {
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

    expect(entry.context_misconfig).toBeUndefined();
    expect(entry.context_length).toBe(400000);
  });

  it("never marks a combo, which has no single context window", async () => {
    getCombos.mockResolvedValue([{ name: "fallback-combo", kind: "llm", models: [] }]);

    const models = await buildModelsList(["llm"], { skipDynamicFetch: true });
    const entry = models.find((model) => model.id === "fallback-combo");

    expect(entry.context_misconfig).toBeUndefined();
    expect(entry.context_length).toBeUndefined();
  });
});

describe("resolveModelCapabilities contextKnown", () => {
  it("reports a known model as known", () => {
    const resolved = resolveModelCapabilities("github", "gpt-5.2");
    expect(resolved.contextKnown).toBe(true);
    expect(resolved.caps.contextWindow).toBe(400000);
  });

  it("reports an unmatched id as unknown, leaving the floor in place", () => {
    const resolved = resolveModelCapabilities("openai-compatible-chat-abc123", "my-local-model-xyz");
    expect(resolved.contextKnown).toBe(false);
    expect(resolved.caps.contextWindow).toBe(200000);
  });

  it("reports a missing model as unknown", () => {
    expect(resolveModelCapabilities("github", "").contextKnown).toBe(false);
    expect(resolveModelCapabilities("github", undefined).contextKnown).toBe(false);
  });
});