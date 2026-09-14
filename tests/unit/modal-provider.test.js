// Modal is one API token over many per-app endpoints: each deployed app exposes
// its own OpenAI-compatible base URL (https://<workspace>--<app>.modal.run/v1)
// with its own model catalog. A single connection therefore stores a LIST of
// base URLs plus a model → base URL map (built from /models), and the executor
// routes every request to the endpoint that serves the requested model.
import { existsSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PROVIDERS, PROVIDER_MODELS } from "../../open-sse/providers/index.js";
import REGISTRY from "../../open-sse/providers/registry/index.js";
import { getExecutor } from "../../open-sse/executors/index.js";
import { ModalExecutor } from "../../open-sse/executors/modal.js";
import { parseModel, resolveProviderAlias } from "../../open-sse/services/model.js";
import {
  classifyEndpointMiss,
  discoverModalModels,
  fetchModalModels,
  listModalBaseUrls,
  modalEndpointCandidates,
  modalModelDisplayId,
  normalizeModalBaseUrl,
  normalizeModalToken,
  parseModalBaseUrls,
  pruneModalModelRoutes,
  resolveModalBaseUrl,
  resolveModalChatUrl,
  resolveModalUpstreamModelId,
  scheduleModalRoutesRefresh,
} from "../../open-sse/services/modalModels.js";
import { AI_PROVIDERS, APIKEY_PROVIDERS } from "../../src/shared/constants/providers.js";
import { normalizeProviderSpecificData } from "../../src/lib/providerNormalization.js";
import { planBulkAdd } from "../../src/shared/utils/bulkAdd.js";

// Executor tests script the upstream through the network layer (same pattern as
// base-executor-retry.test.js).
const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: (...args) => fetchMock(...args),
}));

const CONTA_UM_DEEPSEEK = "https://conta-um-deepseek.modal.run/v1";
const CONTA_UM_GLM = "https://conta-um-glm.modal.run/v1";
const CONTA_DOIS_GLM = "https://conta-dois-glm.modal.run/v1";

const connection = (providerSpecificData, extra = {}) => ({
  id: "conn-1",
  provider: "modal",
  authType: "apikey",
  apiKey: "ak-modal-token",
  providerSpecificData,
  ...extra,
});

/** Stub global.fetch with one catalog per endpoint URL. */
function stubCatalogs(catalogs) {
  vi.stubGlobal("fetch", vi.fn(async (url) => {
    const base = String(url).replace(/\/models$/, "");
    const entries = catalogs[base];
    if (!entries) return new Response("nope", { status: 500 });
    return new Response(JSON.stringify({ object: "list", data: entries }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("modal provider registration", () => {
  const entry = REGISTRY.find((provider) => provider.id === "modal");

  it("is registered as an API-key provider with passthrough models", () => {
    expect(entry).toMatchObject({
      id: "modal",
      alias: "modal",
      category: "apikey",
      authType: "apikey",
      authModes: ["apikey"],
      hasProviderSpecificData: true,
      passthroughModels: true,
      models: [],
    });
    expect(APIKEY_PROVIDERS.modal).toBeDefined();
    expect(AI_PROVIDERS.modal).toMatchObject({ name: "Modal", alias: "modal", passthroughModels: true });
  });

  it("routes the modal/ prefix and keeps slashed model ids intact", () => {
    expect(resolveProviderAlias("modal")).toBe("modal");
    expect(parseModel("modal/deepseek-ai/DeepSeek-V3")).toEqual({
      provider: "modal",
      model: "deepseek-ai/DeepSeek-V3",
      isAlias: false,
      providerAlias: "modal",
    });
  });

  it("has no static catalog or base URL — endpoints are per connection", () => {
    expect(PROVIDER_MODELS.modal).toEqual([]);
    expect(PROVIDERS.modal.baseUrl).toBeUndefined();
    expect(PROVIDERS.modal.format).toBe("openai");
  });

  it("ships an icon", () => {
    expect(existsSync(new URL("../../public/providers/modal.png", import.meta.url))).toBe(true);
  });
});

describe("modal endpoint resolution", () => {
  it("normalizes endpoint input (scheme, trailing slash, chat/models path)", () => {
    expect(normalizeModalBaseUrl("conta-um-deepseek.modal.run/v1")).toBe(CONTA_UM_DEEPSEEK);
    expect(normalizeModalBaseUrl(`${CONTA_UM_DEEPSEEK}/`)).toBe(CONTA_UM_DEEPSEEK);
    expect(normalizeModalBaseUrl(`${CONTA_UM_DEEPSEEK}/chat/completions`)).toBe(CONTA_UM_DEEPSEEK);
    expect(normalizeModalBaseUrl(`${CONTA_UM_DEEPSEEK}/models`)).toBe(CONTA_UM_DEEPSEEK);
    expect(normalizeModalBaseUrl("")).toBe("");
  });

  it("appends /v1 to a bare endpoint host (keeping an explicit version as typed)", () => {
    expect(normalizeModalBaseUrl("https://conta-um-deepseek.modal.run"))
      .toBe(CONTA_UM_DEEPSEEK);
    expect(normalizeModalBaseUrl("conta-um-deepseek.modal.run/"))
      .toBe(CONTA_UM_DEEPSEEK);
    expect(normalizeModalBaseUrl("https://conta-um-deepseek.modal.run/v2"))
      .toBe("https://conta-um-deepseek.modal.run/v2");
    expect(normalizeModalBaseUrl("https://conta-um-deepseek.modal.run/v1/chat/completions?x=1"))
      .toBe(`${CONTA_UM_DEEPSEEK}?x=1`);
  });

  it("strips the header prefix when the token is pasted with it", () => {
    expect(normalizeModalToken("Authorization: Bearer sk-modal-token")).toBe("sk-modal-token");
    expect(normalizeModalToken("Bearer sk-modal-token")).toBe("sk-modal-token");
    expect(normalizeModalToken("  bearer   sk-modal-token  ")).toBe("sk-modal-token");
    expect(normalizeModalToken("sk-modal-token")).toBe("sk-modal-token");
    expect(normalizeModalToken("")).toBe("");
    expect(normalizeModalToken(undefined)).toBe(undefined);
  });

  it("parses the textarea form and de-duplicates URLs", () => {
    expect(parseModalBaseUrls(`${CONTA_UM_DEEPSEEK}\n${CONTA_UM_GLM}\n${CONTA_UM_DEEPSEEK}`))
      .toEqual([CONTA_UM_DEEPSEEK, CONTA_UM_GLM]);
    expect(parseModalBaseUrls([CONTA_UM_GLM, ""])).toEqual([CONTA_UM_GLM]);
  });

  it("reads baseUrls first and still accepts the single baseUrl field", () => {
    expect(listModalBaseUrls(connection({ baseUrls: [CONTA_UM_GLM, CONTA_UM_DEEPSEEK] })))
      .toEqual([CONTA_UM_GLM, CONTA_UM_DEEPSEEK]);
    expect(listModalBaseUrls(connection({ baseUrl: CONTA_UM_GLM }))).toEqual([CONTA_UM_GLM]);
    expect(listModalBaseUrls(connection({}))).toEqual([]);
  });

  it("routes each model to the endpoint discovered for it", () => {
    const credentials = connection({
      baseUrls: [CONTA_UM_DEEPSEEK, CONTA_UM_GLM],
      modelBaseUrls: {
        "deepseek-ai/DeepSeek-V3": CONTA_UM_DEEPSEEK,
        "zai-org/GLM-4.6": CONTA_UM_GLM,
      },
    });
    expect(resolveModalChatUrl(credentials, "zai-org/GLM-4.6")).toBe(`${CONTA_UM_GLM}/chat/completions`);
    expect(resolveModalChatUrl(credentials, "deepseek-ai/DeepSeek-V3")).toBe(`${CONTA_UM_DEEPSEEK}/chat/completions`);
  });

  it("ignores the thinking-level suffix and stale mappings", () => {
    const credentials = connection({
      baseUrls: [CONTA_UM_DEEPSEEK],
      modelBaseUrls: { "zai-org/GLM-4.6": CONTA_UM_GLM },
    });
    // mapped endpoint no longer configured → falls back to the first URL
    expect(resolveModalBaseUrl(credentials, "zai-org/GLM-4.6")).toBe(CONTA_UM_DEEPSEEK);
    // "model(high)" still resolves through the map
    const withMap = connection({
      baseUrls: [CONTA_UM_DEEPSEEK, CONTA_UM_GLM],
      modelBaseUrls: { "zai-org/GLM-4.6": CONTA_UM_GLM },
    });
    expect(resolveModalBaseUrl(withMap, "zai-org/GLM-4.6(high)")).toBe(CONTA_UM_GLM);
  });

  it("falls back to the first endpoint for undiscovered models", () => {
    const credentials = connection({ baseUrls: [CONTA_UM_DEEPSEEK, CONTA_UM_GLM] });
    expect(resolveModalBaseUrl(credentials, "unknown/model")).toBe(CONTA_UM_DEEPSEEK);
  });

  it("raises a descriptive error when no endpoint is configured", () => {
    expect(() => resolveModalBaseUrl(connection({}), "any")).toThrow(/endpoint URL/i);
  });

  it("uses the Modal executor", () => {
    expect(getExecutor("modal")).toBeInstanceOf(ModalExecutor);
    expect(ModalExecutor.prototype.buildUrl.call(
      { config: {} },
      "zai-org/GLM-4.6",
      true,
      0,
      connection({ baseUrls: [CONTA_UM_GLM] }),
    )).toBe(`${CONTA_UM_GLM}/chat/completions`);
  });
});

describe("modal model naming (author prefix stripped for clients)", () => {
  it("derives the client-facing id from a catalog id", () => {
    expect(modalModelDisplayId("zai-org/GLM-5.3-Flash")).toBe("glm-5.3-flash");
    expect(modalModelDisplayId("deepseek-ai/DeepSeek-V4.1-Flash")).toBe("deepseek-v4.1-flash");
    expect(modalModelDisplayId("glm-5.3-flash")).toBe("glm-5.3-flash");
    expect(modalModelDisplayId("")).toBe("");
  });

  it("maps a bare id back to the catalog id it came from", () => {
    const credentials = connection({ modelUpstreamIds: { "glm-5.3-flash": "zai-org/GLM-5.3-Flash" } });

    expect(resolveModalUpstreamModelId(credentials, "glm-5.3-flash")).toBe("zai-org/GLM-5.3-Flash");
    expect(resolveModalUpstreamModelId(credentials, "GLM-5.3-Flash")).toBe("zai-org/GLM-5.3-Flash");
    // Explicitly author-prefixed requests are sent as typed.
    expect(resolveModalUpstreamModelId(credentials, "zai-org/GLM-5.3-Flash")).toBe("");
    expect(resolveModalUpstreamModelId(credentials, "unknown-model")).toBe("");
    expect(resolveModalUpstreamModelId(connection(), "glm-5.3-flash")).toBe("");
  });

  it("routes a bare id to its endpoint even when the client changes its case", () => {
    const credentials = connection({
      baseUrls: [CONTA_UM_DEEPSEEK, CONTA_UM_GLM],
      modelBaseUrls: { "glm-5.3-flash": CONTA_UM_GLM },
    });

    expect(modalEndpointCandidates(credentials, "glm-5.3-flash").candidates[0]).toBe(CONTA_UM_GLM);
    expect(modalEndpointCandidates(credentials, "GLM-5.3-Flash").candidates[0]).toBe(CONTA_UM_GLM);
    // Author-prefixed (legacy custom models) still resolve through the same route.
    expect(modalEndpointCandidates(credentials, "zai-org/GLM-5.3-Flash").candidates[0]).toBe(CONTA_UM_GLM);
  });
});

describe("modal model discovery", () => {
  it("exposes bare model ids and keeps the catalog id for the upstream call", async () => {
    stubCatalogs({
      [CONTA_UM_DEEPSEEK]: [{ id: "deepseek-ai/DeepSeek-V3", name: "DeepSeek V3" }],
      [CONTA_UM_GLM]: [{ id: "zai-org/GLM-4.6" }],
    });

    const result = await fetchModalModels(connection({ baseUrls: [CONTA_UM_DEEPSEEK, CONTA_UM_GLM] }));

    expect(result.models).toEqual([
      { id: "deepseek-v3", name: "DeepSeek V3", upstreamModelId: "deepseek-ai/DeepSeek-V3" },
      { id: "glm-4.6", name: "zai-org/GLM-4.6", upstreamModelId: "zai-org/GLM-4.6" },
    ]);
    expect(result.modelBaseUrls).toEqual({
      "deepseek-v3": CONTA_UM_DEEPSEEK,
      "glm-4.6": CONTA_UM_GLM,
    });
    expect(result.modelUpstreamIds).toEqual({
      "deepseek-v3": "deepseek-ai/DeepSeek-V3",
      "glm-4.6": "zai-org/GLM-4.6",
    });
    expect(result.errors).toEqual([]);
  });

  it("lets the first listed endpoint win for a model exposed by several", async () => {
    stubCatalogs({
      [CONTA_UM_GLM]: [{ id: "zai-org/GLM-4.6" }],
      [CONTA_DOIS_GLM]: [{ id: "zai-org/GLM-4.6" }],
    });

    const result = await fetchModalModels(connection({ baseUrls: [CONTA_UM_GLM, CONTA_DOIS_GLM] }));

    expect(result.models).toEqual([{ id: "glm-4.6", name: "zai-org/GLM-4.6", upstreamModelId: "zai-org/GLM-4.6" }]);
    expect(result.modelBaseUrls["glm-4.6"]).toBe(CONTA_UM_GLM);
  });

  it("reports failing endpoints but keeps the reachable catalogs", async () => {
    stubCatalogs({ [CONTA_UM_GLM]: [{ id: "zai-org/GLM-4.6" }] });

    const result = await fetchModalModels(connection({ baseUrls: [CONTA_UM_DEEPSEEK, CONTA_UM_GLM] }));

    expect(result.models.map((model) => model.id)).toEqual(["glm-4.6"]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain(CONTA_UM_DEEPSEEK);
  });

  it("keeps previous mappings (including author-prefixed ones) for configured endpoints", async () => {
    stubCatalogs({ [CONTA_UM_GLM]: [{ id: "zai-org/GLM-4.6" }] });

    const result = await fetchModalModels(connection({
      baseUrls: [CONTA_UM_DEEPSEEK, CONTA_UM_GLM],
      modelBaseUrls: { "deepseek-ai/DeepSeek-V3": CONTA_UM_DEEPSEEK },
    }));

    expect(result.modelBaseUrls["deepseek-ai/DeepSeek-V3"]).toBe(CONTA_UM_DEEPSEEK);
    expect(result.modelBaseUrls["glm-4.6"]).toBe(CONTA_UM_GLM);
  });

  it("sends the connection token and persists both maps only when they changed", async () => {
    stubCatalogs({ [CONTA_UM_GLM]: [{ id: "zai-org/GLM-4.6" }] });
    const persist = vi.fn();
    const conn = connection({ baseUrls: [CONTA_UM_GLM] });

    await discoverModalModels(conn, { persist });

    expect(persist).toHaveBeenCalledWith({
      modelBaseUrls: { "glm-4.6": CONTA_UM_GLM },
      modelUpstreamIds: { "glm-4.6": "zai-org/GLM-4.6" },
    });
    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe(`${CONTA_UM_GLM}/models`);
    expect(options.headers.Authorization).toBe("Bearer ak-modal-token");

    persist.mockClear();
    await discoverModalModels(
      connection({
        baseUrls: [CONTA_UM_GLM],
        modelBaseUrls: { "glm-4.6": CONTA_UM_GLM },
        modelUpstreamIds: { "glm-4.6": "zai-org/GLM-4.6" },
      }),
      { persist },
    );
    expect(persist).not.toHaveBeenCalled();
  });

  it("reports a missing endpoint instead of calling fetch", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const result = await fetchModalModels(connection({}));

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.errors).toEqual(["No endpoint URL configured"]);
  });
});

describe("modal connection input", () => {
  it("normalizes baseUrls from the add-connection payload", () => {
    const psd = normalizeProviderSpecificData("modal", {}, {
      baseUrls: `${CONTA_UM_DEEPSEEK}\nconta-um-glm.modal.run/v1`,
    });
    expect(psd.baseUrls).toEqual([CONTA_UM_DEEPSEEK, CONTA_UM_GLM]);
  });

  it("folds a legacy single baseUrl into the list", () => {
    const psd = normalizeProviderSpecificData("modal", { baseUrl: `${CONTA_UM_GLM}/` }, null);
    expect(psd.baseUrls).toEqual([CONTA_UM_GLM]);
    expect(psd.baseUrl).toBeUndefined();
  });

  it("bulk-add accepts name|apiKey|url1,url2", () => {
    const out = planBulkAdd([
      `account-1|sk-a|${CONTA_UM_DEEPSEEK},${CONTA_UM_GLM}`,
      "account-2|sk-b",
    ], [], { isModal: true });

    expect(out).toEqual([
      { name: "account-1 1", apiKey: "sk-a", skipped: false, providerSpecificData: { baseUrls: [CONTA_UM_DEEPSEEK, CONTA_UM_GLM] } },
      { name: "account-2 1", apiKey: "sk-b", skipped: false },
    ]);
  });
});

// ─── Request-time routing ────────────────────────────────────────────────────
// A model must never be answered by an endpoint that does not host it: the
// request starts on the discovered endpoint and only moves on when an endpoint
// explicitly answers "no such model". Broken endpoints stay visible.

/** Minimal upstream response for the executor's fetch layer. */
function fakeResponse(status, body = "") {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: () => "application/json" },
    clone: () => fakeResponse(status, text),
    text: async () => text,
    json: async () => JSON.parse(text || "{}"),
  };
}

/** Executor with retry delays disabled so tests stay fast. */
function fastExecutor() {
  const executor = new ModalExecutor();
  executor.config = { ...executor.config, retry: { 429: { attempts: 0 }, 502: { attempts: 0 } } };
  return executor;
}

const MODEL = "deepseek-ai/DeepSeek-V3";
const MODEL_NOT_FOUND_BODY = { error: { message: `The model \`${MODEL}\` does not exist.` } };

describe("modal endpoint candidates", () => {
  it("starts on the discovered endpoint, keeping the others as fallback", () => {
    const credentials = connection({
      baseUrls: [CONTA_UM_GLM, CONTA_UM_DEEPSEEK],
      modelBaseUrls: { [MODEL]: CONTA_UM_DEEPSEEK },
    });

    expect(modalEndpointCandidates(credentials, MODEL)).toEqual({
      mapped: true,
      candidates: [CONTA_UM_DEEPSEEK, CONTA_UM_GLM],
    });
    expect(modalEndpointCandidates(credentials, "unknown/model")).toEqual({
      mapped: false,
      candidates: [CONTA_UM_GLM, CONTA_UM_DEEPSEEK],
    });
  });

  it("ignores a discovered route whose endpoint was removed from the connection", () => {
    const credentials = connection({
      baseUrls: [CONTA_UM_DEEPSEEK],
      modelBaseUrls: { "zai-org/GLM-4.6": CONTA_UM_GLM },
    });

    expect(modalEndpointCandidates(credentials, "zai-org/GLM-4.6")).toEqual({
      mapped: false,
      candidates: [CONTA_UM_DEEPSEEK],
    });
  });
});

describe("modal request routing", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    // The background route refresh must not reach the network in these tests.
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
  });

  it("sends the catalog model id upstream while the client uses the bare id", async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(200, { choices: [] }));

    const credentials = connection({
      baseUrls: [CONTA_UM_GLM],
      modelBaseUrls: { "glm-5.3-flash": CONTA_UM_GLM },
      modelUpstreamIds: { "glm-5.3-flash": "zai-org/GLM-5.3-Flash" },
    });
    const result = await fastExecutor().execute({
      model: "glm-5.3-flash",
      body: { model: "glm-5.3-flash", messages: [] },
      stream: false,
      credentials,
    });

    expect(result.url).toBe(`${CONTA_UM_GLM}/chat/completions`);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).model).toBe("zai-org/GLM-5.3-Flash");
  });

  it("keeps an explicitly author-prefixed request as typed", async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(200, { choices: [] }));

    const credentials = connection({
      baseUrls: [CONTA_UM_GLM],
      modelBaseUrls: { "glm-5.3-flash": CONTA_UM_GLM },
      modelUpstreamIds: { "glm-5.3-flash": "zai-org/GLM-5.3-Flash" },
    });
    await fastExecutor().execute({
      model: "zai-org/GLM-5.3-Flash",
      body: { model: "zai-org/GLM-5.3-Flash", messages: [] },
      stream: false,
      credentials,
    });

    expect(JSON.parse(fetchMock.mock.calls[0][1].body).model).toBe("zai-org/GLM-5.3-Flash");
  });

  it("fails over to the endpoint that hosts the model when the route is wrong", async () => {
    fetchMock
      .mockResolvedValueOnce(fakeResponse(404, MODEL_NOT_FOUND_BODY))
      .mockResolvedValueOnce(fakeResponse(200, { choices: [] }));

    const credentials = connection({
      baseUrls: [CONTA_UM_GLM, CONTA_UM_DEEPSEEK],
      modelBaseUrls: { [MODEL]: CONTA_UM_GLM },
    });
    const result = await fastExecutor().execute({
      model: MODEL, body: { messages: [] }, stream: false, credentials,
    });

    expect(result.response.status).toBe(200);
    expect(result.url).toBe(`${CONTA_UM_DEEPSEEK}/chat/completions`);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      `${CONTA_UM_GLM}/chat/completions`,
      `${CONTA_UM_DEEPSEEK}/chat/completions`,
    ]);
  });

  it("finds the hosting endpoint for a model that was never discovered", async () => {
    fetchMock
      .mockResolvedValueOnce(fakeResponse(400, { error: { message: "unknown model: deepseek-ai/DeepSeek-V3" } }))
      .mockResolvedValueOnce(fakeResponse(200, { choices: [] }));

    const credentials = connection({ baseUrls: [CONTA_UM_GLM, CONTA_UM_DEEPSEEK] });
    const result = await fastExecutor().execute({
      model: MODEL, body: { messages: [] }, stream: false, credentials,
    });

    expect(result.response.status).toBe(200);
    expect(result.url).toBe(`${CONTA_UM_DEEPSEEK}/chat/completions`);
  });

  it("reports an account-level error when no endpoint hosts the model", async () => {
    fetchMock.mockResolvedValue(fakeResponse(404, MODEL_NOT_FOUND_BODY));

    const credentials = connection({ baseUrls: [CONTA_UM_GLM, CONTA_UM_DEEPSEEK] });
    const result = await fastExecutor().execute({
      model: MODEL, body: { messages: [] }, stream: false, credentials,
    });

    expect(result.response.status).toBe(404);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // Stable wording: errorConfig's noFallback rule matches it, so a model typo
    // never locks the account nor counts a failure strike.
    const body = await result.response.json();
    expect(body.error.message).toContain("is not served by any configured endpoint");
  });

  it("surfaces a wrong endpoint path instead of treating it as a model miss", async () => {
    fetchMock.mockResolvedValue(fakeResponse(404, { detail: "Not Found" }));

    const credentials = connection({ baseUrls: [CONTA_UM_GLM, CONTA_UM_DEEPSEEK] });
    const result = await fastExecutor().execute({
      model: MODEL, body: { messages: [] }, stream: false, credentials,
    });

    // A bare 404 means the URL itself is wrong: that is an endpoint failure and
    // must be reported (so the account gets parked), not skipped as "no model".
    expect(result.response.status).toBe(404);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = await result.response.json();
    expect(body.detail).toBe("Not Found");
  });

  it("does not swap endpoints when an endpoint is unreachable", async () => {
    fetchMock.mockRejectedValueOnce(new Error("getaddrinfo ENOTFOUND conta-um-deepseek.modal.run"));

    const credentials = connection({ baseUrls: [CONTA_UM_DEEPSEEK, CONTA_UM_GLM] });
    await expect(fastExecutor().execute({
      model: MODEL, body: { messages: [] }, stream: false, credentials,
    })).rejects.toThrow(/ENOTFOUND/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not swap endpoints on a real upstream error", async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(500, { error: { message: "internal error" } }));

    const credentials = connection({ baseUrls: [CONTA_UM_GLM, CONTA_UM_DEEPSEEK] });
    const result = await fastExecutor().execute({
      model: MODEL, body: { messages: [] }, stream: false, credentials,
    });

    expect(result.response.status).toBe(500);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("modal route freshness", () => {
  it("refreshes the route map in the background so later requests start on the right endpoint", async () => {
    stubCatalogs({ [CONTA_UM_DEEPSEEK]: [{ id: MODEL }] });
    const credentials = connection({ baseUrls: [CONTA_UM_DEEPSEEK, CONTA_UM_GLM] }, { connectionId: "conn-refresh" });

    // Stale map: the model looks like it belongs to the GLM endpoint.
    credentials.providerSpecificData.modelBaseUrls = { [MODEL]: CONTA_UM_GLM };
    expect(modalEndpointCandidates(credentials, MODEL).candidates[0]).toBe(CONTA_UM_GLM);

    await scheduleModalRoutesRefresh(credentials);

    expect(modalEndpointCandidates(credentials, MODEL)).toEqual({
      mapped: true,
      candidates: [CONTA_UM_DEEPSEEK, CONTA_UM_GLM],
    });
  });

  it("skips the refresh while the cached map is fresh", async () => {
    stubCatalogs({ [CONTA_UM_GLM]: [{ id: "zai-org/GLM-4.6" }] });
    const credentials = connection({ baseUrls: [CONTA_UM_GLM, CONTA_DOIS_GLM] }, { connectionId: "conn-fresh" });

    await scheduleModalRoutesRefresh(credentials);
    const callsAfterFirst = fetch.mock.calls.length;

    expect(scheduleModalRoutesRefresh(credentials)).toBeNull();
    expect(fetch.mock.calls.length).toBe(callsAfterFirst);
  });
});

describe("modal route pruning", () => {
  it("drops routes whose endpoint is no longer configured", () => {
    const psd = pruneModalModelRoutes({
      baseUrls: [CONTA_UM_DEEPSEEK],
      modelBaseUrls: { [MODEL]: CONTA_UM_DEEPSEEK, "zai-org/GLM-4.6": CONTA_UM_GLM },
    });

    expect(psd).toEqual({
      baseUrls: [CONTA_UM_DEEPSEEK],
      modelBaseUrls: { [MODEL]: CONTA_UM_DEEPSEEK },
    });
  });

  it("removes the map entirely when no route is left", () => {
    const psd = pruneModalModelRoutes({
      baseUrls: [CONTA_UM_DEEPSEEK],
      modelBaseUrls: { "zai-org/GLM-4.6": CONTA_UM_GLM },
    });

    expect(psd).toEqual({ baseUrls: [CONTA_UM_DEEPSEEK] });
  });
});

describe("endpoint miss classification", () => {
  it("treats a model wording in the body as 'this endpoint does not host the model'", async () => {
    expect(await classifyEndpointMiss(fakeResponse(400, MODEL_NOT_FOUND_BODY))).toBe("model");
    expect(await classifyEndpointMiss(fakeResponse(422, { detail: "Unknown model: deepseek-ai/DeepSeek-V3" }))).toBe("model");
    expect(await classifyEndpointMiss(fakeResponse(404, MODEL_NOT_FOUND_BODY))).toBe("model");
  });

  it("treats a bare 404, other statuses and missing responses as real failures", async () => {
    expect(await classifyEndpointMiss(fakeResponse(404, { detail: "Not Found" }))).toBe("other");
    expect(await classifyEndpointMiss(fakeResponse(500, "internal error"))).toBe("other");
    expect(await classifyEndpointMiss(fakeResponse(400, { error: { message: "invalid temperature" } }))).toBe("other");
    expect(await classifyEndpointMiss(undefined)).toBe("other");
  });
});