/**
 * End-to-end check for the Vultr discovery route: GET /api/providers/[id]/models
 * must return only text-in/text-out models from the shared Vultr catalogue.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnectionById: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json(body, init = {}) {
      return new Response(JSON.stringify(body), {
        status: init.status || 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  },
}));

vi.mock("@/models", () => ({
  getProviderConnectionById: mocks.getProviderConnectionById,
  updateProviderConnection: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnectionById: mocks.getProviderConnectionById,
  updateProviderConnection: vi.fn(),
}));

const { GET: listProviderModels } = await import("../../src/app/api/providers/[id]/models/route.js");

const modality = (type) => ({ type, supported_inputs: {} });
const model = (id, input, output) => ({
  id,
  name: id,
  input_modalities: input.map(modality),
  output_modalities: output.map(modality),
});

const CATALOGUE = {
  data: [
    model("glm-5.3-flash", ["text", "image", "file", "video"], ["text"]),
    model("deepseek-v4.1-flash-1017", ["text"], ["text"]),
    model("chatterbox", ["text"], ["speech"]),
    model("whisper-large-v3-turbo", ["audio"], ["transcription"]),
    model("z-image-turbo", ["text"], ["image"]),
    model("qwen3-embedding-4b", ["text"], ["embeddings"]),
    model("bge-reranker-v2-m3", ["text"], ["rerank"]),
  ],
};

const request = () => new Request("http://localhost/api/providers/conn-vultr/models");

describe("GET /api/providers/[id]/models — vultr", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mocks.getProviderConnectionById.mockResolvedValue({
      id: "conn-vultr",
      provider: "vultr",
      apiKey: "sk-test",
      isActive: true,
    });
  });

  afterEach(() => { vi.restoreAllMocks(); });

  it("drops non-chat entries and keeps text-in/text-out models", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(CATALOGUE), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const response = await listProviderModels(request(), { params: Promise.resolve({ id: "conn-vultr" }) });
    const body = await response.json();

    expect(String(fetchSpy.mock.calls[0][0])).toBe("https://api.vultrinference.com/v1/models");
    expect(body.models.map((m) => m.id)).toEqual(["glm-5.3-flash", "deepseek-v4.1-flash-1017"]);
    // Full upstream entry survives the filter, so the dashboard still gets names/metadata.
    expect(body.models[0]).toMatchObject({ id: "glm-5.3-flash", name: "glm-5.3-flash" });
  });
});
