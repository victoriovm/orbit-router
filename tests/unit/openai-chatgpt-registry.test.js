import { describe, expect, it } from "vitest";
import provider from "../../open-sse/providers/registry/openai-chatgpt.js";
import { PROVIDERS, PROVIDER_OAUTH } from "../../open-sse/config/providers.js";
import { getProviderModels } from "../../open-sse/config/providerModels.js";
import { parseModel } from "../../open-sse/services/model.js";
import { getProviderIconSrc } from "../../src/shared/utils/providerIcon.js";
import { getThinkingLevels } from "../../open-sse/providers/thinkingLevels.js";

describe("OpenAI ChatGPT registration", () => {
  it("keeps subscription traffic on the public Responses API, separate from Codex and API keys", () => {
    expect(provider.display.name).toBe("OpenAI ChatGPT");
    expect(provider.category).toBe("oauth");
    expect(PROVIDERS[provider.id]).toMatchObject({
      baseUrl: "https://api.openai.com/v1/responses",
      format: "openai-responses",
      forceStream: true,
    });
    expect(PROVIDERS.codex.baseUrl).toContain("chatgpt.com/backend-api/codex");
    expect(PROVIDERS.openai.baseUrl).toBe("https://api.openai.com/v1/chat/completions");
    expect(PROVIDER_OAUTH[provider.id]).toMatchObject({ clientId: "dynamic_agent_client", refreshLeadMs: 180000 });
    expect(getProviderIconSrc(provider.id)).toBe("/providers/codex.png");
  });

  it("routes the new alias and exposes Pi OpenAI models without Codex review variants", async () => {
    expect(await parseModel("chatgpt/gpt-6.1-sol")).toMatchObject({ provider: "openai-chatgpt", model: "gpt-6.1-sol" });
    const models = getProviderModels("chatgpt");
    expect(models.some((model) => model.id === "gpt-5.3-codex")).toBe(true);
    expect(models.some((model) => model.id.endsWith("-review"))).toBe(false);
    expect(models.find((model) => model.id === "gpt-6.1-sol").thinkingLevels).toEqual(["low", "medium", "high", "xhigh", "max"]);
    expect(getThinkingLevels("openai-chatgpt", "gpt-6.1-sol")).toEqual(["low", "medium", "high", "xhigh", "max"]);
    expect(getThinkingLevels("openai-chatgpt", "gpt-5.4")).toEqual(["none", "low", "medium", "high", "xhigh"]);
  });
});
