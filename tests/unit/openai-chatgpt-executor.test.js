import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ fetch: vi.fn(), refresh: vi.fn() }));
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: mocks.fetch }));
vi.mock("../../open-sse/services/oauthCredentialManager.js", () => ({ refreshProviderCredentials: mocks.refresh, shouldRefreshCredentials: vi.fn() }));
const { OpenAIChatGPTExecutor } = await import("../../open-sse/executors/openai-chatgpt.js");

describe("Pi-compatible OpenAI ChatGPT executor", () => {
  beforeEach(() => vi.clearAllMocks());
  it("forces stateless streaming and omits fields rejected by the direct ChatGPT grant", () => {
    const executor = new OpenAIChatGPTExecutor();
    const input = [{ role: "user", content: [{ type: "input_image", image_url: "data:image/png;base64,abc" }] }, { type: "configuration_update", reasoning: { effort: "high" } }];
    const result = executor.transformRequest("gpt-6.1-sol", { input, instructions: "Be helpful", temperature: 0.2, max_output_tokens: 100, prompt_cache_retention: "24h", prompt_cache_options: {}, stream_options: {}, reasoning_effort: "max", prompt_cache_key: "session" }, false, {});
    expect(result).toMatchObject({ model: "gpt-6.1-sol", stream: true, store: false, reasoning: { effort: "max", summary: "auto" }, include: ["reasoning.encrypted_content"] });
    expect(result.input).toEqual([{ role: "developer", content: "Be helpful" }, input[0]]);
    for (const field of ["instructions", "temperature", "max_output_tokens", "prompt_cache_retention", "prompt_cache_options", "stream_options", "reasoning_effort"]) expect(result).not.toHaveProperty(field);
    expect(input).toHaveLength(2);
  });
  it("preserves encrypted reasoning, tool calls and results without Codex instructions", () => {
    const executor = new OpenAIChatGPTExecutor();
    const input = [{ type: "reasoning", encrypted_content: "opaque" }, { type: "function_call", call_id: "call_1", name: "read", arguments: "{}" }, { type: "function_call_output", call_id: "call_1", output: "ok" }];
    const tools = [{ type: "function", name: "read", parameters: { type: "object" } }];
    expect(executor.transformRequest("gpt-5.4", { input, tools }, true, {})).toMatchObject({ input, tools });
    expect(executor.transformRequest("gpt-5.4", { input }, true, {})).not.toHaveProperty("instructions");
  });
  it("sends the bearer token directly to OpenAI and keeps session headers request-local", async () => {
    const executor = new OpenAIChatGPTExecutor();
    mocks.fetch.mockImplementation(async () => new Response("data: {}\n\n", { headers: { "Content-Type": "text/event-stream" } }));
    await executor.execute({ model: "gpt-5.4", body: { input: "hello", prompt_cache_key: "first" }, stream: false, credentials: { accessToken: "direct" } });
    await executor.execute({ model: "gpt-5.4", body: { input: "hello", prompt_cache_key: "second" }, stream: true, credentials: { accessToken: "other" } });
    expect(mocks.fetch.mock.calls[0][0]).toBe("https://api.openai.com/v1/responses");
    const first = mocks.fetch.mock.calls[0][1];
    const second = mocks.fetch.mock.calls[1][1];
    expect(first.headers).toMatchObject({ Authorization: "Bearer direct", "session-id": "first", "x-client-request-id": "first", Accept: "text/event-stream" });
    expect(second.headers).toMatchObject({ Authorization: "Bearer other", "session-id": "second" });
    expect(first.headers).not.toHaveProperty("ChatGPT-Account-ID");
    expect(first.headers).not.toHaveProperty("originator");
    expect(JSON.parse(first.body)).toMatchObject({ stream: true, store: false });
  });
  it("uses the separate provider when refreshing credentials", async () => {
    const credentials = { refreshToken: "refresh", providerSpecificData: { oauthClientId: "issued" } };
    await new OpenAIChatGPTExecutor().refreshCredentials(credentials, console);
    expect(mocks.refresh).toHaveBeenCalledWith("openai-chatgpt", credentials, console);
  });
});
