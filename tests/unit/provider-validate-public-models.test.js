import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "../../src/app/api/providers/validate/route.js";

// These providers serve /models publicly (any key → 200), so the generic models probe
// can't vet a key. The validate route must POST to the chat endpoint instead.
const PUBLIC_MODELS_PROVIDERS = [
  { id: "phoenix-grove", chatUrl: "https://api.pgsgrove.com/v1/chat/completions", badKeyStatus: 401 },
  { id: "vultr", chatUrl: "https://api.vultrinference.com/v1/chat/completions", badKeyStatus: 422 },
  { id: "novita", chatUrl: "https://api.novita.ai/openai/chat/completions", badKeyStatus: 401 },
];

const request = (body) => ({ json: async () => body });

function stubChatResponse(status, payload = {}) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
    new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } })
  );
}

describe("provider validation — providers whose /models is public", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it.each(PUBLIC_MODELS_PROVIDERS)("$id probes the chat endpoint, not /models", async ({ id, chatUrl }) => {
    const fetchSpy = stubChatResponse(400, { error: { message: "model not found" } });
    const json = await (await POST(request({ provider: id, apiKey: "sk-test" }))).json();
    const [url, opts] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe(chatUrl);
    expect(opts.method).toBe("POST");
    expect(opts.headers.Authorization).toBe("Bearer sk-test");
    // 400 = unknown model, which still proves the key was accepted
    expect(json.valid).toBe(true);
  });

  it.each(PUBLIC_MODELS_PROVIDERS)("$id rejects auth errors from the chat probe", async ({ id, badKeyStatus }) => {
    stubChatResponse(badKeyStatus, { message: "Invalid API key" });
    const json = await (await POST(request({ provider: id, apiKey: "bad" }))).json();
    expect(json.valid).toBe(false);
  });
});
