// Cline Free's model list is assembled from two public feeds:
//   1. /ai/cline/models — OpenRouter-shaped catalog; free entries are the ones
//      whose id ends in the `:free` suffix.
//   2. /ai/cline/recommended-models — curated feed whose `free[]` tier is the
//      whole free category (ids may or may not use the `cline-free/` prefix).
// These tests pin the per-feed parsing and the merge (first writer wins so the
// catalog keeps its richer token/capability metadata on a shared id).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const CATALOG_URL = "https://api.cline.bot/api/v1/ai/cline/models";
const FEED_URL = "https://api.cline.bot/api/v1/ai/cline/recommended-models";

const CATALOG_RESPONSE = {
  data: [
    {
      id: "paid/claude-opus-5.5",
      name: "Paid: Claude Opus 5.5",
      context_length: 200000,
      top_provider: { context_length: 200000, max_completion_tokens: 64000 },
      architecture: { input_modalities: ["text"] },
      supported_parameters: ["tools", "reasoning"],
    },
    {
      id: "qwen/qwen3.8-27b:free",
      name: "Qwen: Qwen3.8 27B (free)",
      description: "Free Qwen",
      context_length: 262144,
      top_provider: { context_length: 262144, max_completion_tokens: 32768 },
      architecture: { input_modalities: ["text", "image"] },
      supported_parameters: ["tools", "reasoning", "temperature"],
    },
    {
      id: "liquid/lfm-2.5-2.6b:free",
      name: "LiquidAI: LFM2.5-2.6B (free)",
      context_length: 65536,
      top_provider: { context_length: 65536, max_completion_tokens: 8192 },
      architecture: { input_modalities: ["text"] },
      supported_parameters: ["temperature"],
    },
  ],
};

const FEED_RESPONSE = {
  recommended: [{ id: "anthropic/claude-opus-5", name: "claude-opus-5", description: "", tags: ["NEW"] }],
  free: [
    { id: "stealth/space-bunny-alpha", name: "Space Bunny Alpha", description: "Blazing fast", tags: [] },
    { id: "cline-free/muse-spark-1.3-contributor", name: "Muse Spark 1.3 Contributor", description: "", tags: [] },
    { id: "cline-free/deepseek-v4.1-flash", name: "Deepseek V4.1 Flash", description: "", tags: [] },
  ],
  clinePass: [{ id: "cline-pass/glm-5.3", name: "GLM-5.3", description: "", tags: [] }],
};

let fetchMock;

function jsonResponse(obj) {
  return { ok: true, status: 200, json: async () => obj, text: async () => JSON.stringify(obj) };
}

beforeEach(() => {
  fetchMock = vi.fn(async (url) => {
    if (String(url) === CATALOG_URL) return jsonResponse(CATALOG_RESPONSE);
    if (String(url) === FEED_URL) return jsonResponse(FEED_RESPONSE);
    throw new Error("unexpected fetch: " + url);
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

describe("resolveClineModels free-tier sources", () => {
  it("includes only the :free catalog entries", async () => {
    const { resolveClineModels } = await import("../../open-sse/services/clinepassModels.js");
    const result = await resolveClineModels();
    const ids = result.models.map((m) => m.id);
    expect(ids).toContain("qwen/qwen3.8-27b:free");
    expect(ids).toContain("liquid/lfm-2.5-2.6b:free");
    expect(ids).not.toContain("paid/claude-opus-5.5");
  });

  it("includes every recommended-models free[] entry", async () => {
    const { resolveClineModels } = await import("../../open-sse/services/clinepassModels.js");
    const result = await resolveClineModels();
    const ids = result.models.map((m) => m.id);
    expect(ids).toContain("stealth/space-bunny-alpha");
    expect(ids).toContain("cline-free/muse-spark-1.3-contributor");
    expect(ids).toContain("cline-free/deepseek-v4.1-flash");
  });

  it("parses catalog metadata: token limits and capabilities", async () => {
    const { resolveClineModels } = await import("../../open-sse/services/clinepassModels.js");
    const result = await resolveClineModels();
    const entry = result.models.find((m) => m.id === "qwen/qwen3.8-27b:free");
    expect(entry.name).toBe("Qwen: Qwen3.8 27B (free)");
    expect(entry.description).toBe("Free Qwen");
    expect(entry.contextLength).toBe(262144);
    expect(entry.maxOutputTokens).toBe(32768);
    expect(entry.supportsImages).toBe(true);
    expect(entry.supportsTools).toBe(true);
    expect(entry.supportsThinking).toBe(true);
    expect(entry.capabilities).toMatchObject({
      contextWindow: 262144,
      maxOutput: 32768,
      vision: true,
      tools: true,
      reasoning: true,
    });
  });

  it("parses a text-only catalog entry without inventing vision support", async () => {
    const { resolveClineModels } = await import("../../open-sse/services/clinepassModels.js");
    const result = await resolveClineModels();
    const entry = result.models.find((m) => m.id === "liquid/lfm-2.5-2.6b:free");
    expect(entry.supportsImages).toBe(false);
    expect(entry.supportsTools).toBe(false);
    expect(entry.supportsThinking).toBe(false);
    expect(entry.capabilities).toMatchObject({ vision: false, tools: false, reasoning: false });
  });

  it("returns {id, name} for feed entries", async () => {
    const { resolveClineModels } = await import("../../open-sse/services/clinepassModels.js");
    const result = await resolveClineModels();
    const entry = result.models.find((m) => m.id === "cline-free/muse-spark-1.3-contributor");
    expect(entry.name).toBe("Muse Spark 1.3 Contributor");
  });

  it("keeps the catalog entry when both feeds list the same id (first writer wins)", async () => {
    fetchMock.mockImplementation(async (url) => {
      if (String(url) === CATALOG_URL) {
        return jsonResponse({
          data: [
            {
              id: "stealth/space-bunny-alpha:free",
              name: "Catalog: Space Bunny (free)",
              context_length: 1000000,
              top_provider: { context_length: 1000000, max_completion_tokens: 64000 },
              architecture: { input_modalities: ["text"] },
              supported_parameters: ["tools"],
            },
          ],
        });
      }
      return jsonResponse({
        free: [{ id: "stealth/space-bunny-alpha:free", name: "Feed: Space Bunny", description: "", tags: [] }],
      });
    });
    const { resolveClineModels } = await import("../../open-sse/services/clinepassModels.js");
    const result = await resolveClineModels();
    const entries = result.models.filter((m) => m.id === "stealth/space-bunny-alpha:free");
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe("Catalog: Space Bunny (free)");
    expect(entries[0].contextLength).toBe(1000000);
  });

  it("survives a failing catalog and still returns the feed's free tier", async () => {
    fetchMock.mockImplementation(async (url) => {
      if (String(url) === FEED_URL) return jsonResponse(FEED_RESPONSE);
      return { ok: false, status: 503, json: async () => ({}), text: async () => "" };
    });
    const { resolveClineModels } = await import("../../open-sse/services/clinepassModels.js");
    const result = await resolveClineModels();
    expect(result.models.map((m) => m.id)).toEqual([
      "stealth/space-bunny-alpha",
      "cline-free/muse-spark-1.3-contributor",
      "cline-free/deepseek-v4.1-flash",
    ]);
  });

  it("survives a failing feed and still returns the :free catalog entries", async () => {
    fetchMock.mockImplementation(async (url) => {
      if (String(url) === CATALOG_URL) return jsonResponse(CATALOG_RESPONSE);
      return { ok: false, status: 503, json: async () => ({}), text: async () => "" };
    });
    const { resolveClineModels } = await import("../../open-sse/services/clinepassModels.js");
    const result = await resolveClineModels();
    expect(result.models.map((m) => m.id)).toEqual([
      "qwen/qwen3.8-27b:free",
      "liquid/lfm-2.5-2.6b:free",
    ]);
  });

  it("returns null when both feeds are unusable (callers fall back to static)", async () => {
    fetchMock.mockImplementation(async () => ({ ok: false, status: 503, json: async () => ({}), text: async () => "" }));
    const { resolveClineModels } = await import("../../open-sse/services/clinepassModels.js");
    expect(await resolveClineModels()).toBeNull();
  });

  it("does not leak the recommended or clinePass categories into the free list", async () => {
    const { resolveClineModels } = await import("../../open-sse/services/clinepassModels.js");
    const result = await resolveClineModels();
    const ids = result.models.map((m) => m.id);
    expect(ids).not.toContain("anthropic/claude-opus-5");
    expect(ids).not.toContain("cline-pass/glm-5.3");
  });
});

describe("resolveClinepassModels catalog filter", () => {
  it("keeps only cline-pass/* entries from /api/v1/models", async () => {
    fetchMock.mockImplementation(async (url) => {
      if (String(url) === "https://api.cline.bot/api/v1/models") {
        return jsonResponse([
          { id: "cline-pass/glm-5.3", name: "GLM-5.3" },
          { id: "paid/claude-opus-5.5", name: "Claude Opus 5.5" },
        ]);
      }
      return jsonResponse(FEED_RESPONSE);
    });
    const { resolveClinepassModels } = await import("../../open-sse/services/clinepassModels.js");
    const result = await resolveClinepassModels({ accessToken: "test-token" });
    expect(result.models.map((m) => m.id)).toEqual(["cline-pass/glm-5.3"]);
  });
});

describe("free model pricing", () => {
  it("bills cline-free/* at zero", async () => {
    const { getPricingForModel } = await import("../../open-sse/providers/pricing.js");
    const pricing = getPricingForModel("cline", "cline-free/deepseek-v4.1-flash");
    expect(pricing).toMatchObject({
      input: 0, output: 0, cached: 0, reasoning: 0, cache_creation: 0,
    });
  });

  it("bills :free-suffixed catalog ids at zero", async () => {
    const { getPricingForModel } = await import("../../open-sse/providers/pricing.js");
    expect(getPricingForModel("cline", "qwen/qwen3.8-27b:free").input).toBe(0);
    expect(getPricingForModel("openrouter", "nvidia/nemotron-3-ultra-550b-a55b:free").input).toBe(0);
  });

  it("still bills the paid twin at its published rate", async () => {
    const { getPricingForModel } = await import("../../open-sse/providers/pricing.js");
    expect(getPricingForModel("cline", "deepseek/deepseek-v4.1-flash").input).toBe(0.14);
  });

  it("zero price survives cost calculation over a large usage", async () => {
    const { getPricingForModel, calculateCostFromTokens } = await import("../../open-sse/providers/pricing.js");
    const pricing = getPricingForModel("cline", "cline-free/deepseek-v4.1-flash");
    const cost = calculateCostFromTokens(
      { prompt_tokens: 1_000_000, completion_tokens: 1_000_000, reasoning_tokens: 500_000 },
      pricing
    );
    expect(cost).toBe(0);
  });
});
