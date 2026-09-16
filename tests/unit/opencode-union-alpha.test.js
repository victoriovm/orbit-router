import { describe, expect, it } from "vitest";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { PROVIDER_MODELS, getModelTargetFormat, getModelSupportedFormats } from "../../open-sse/config/providerModels.js";
import { getThinkingLevels } from "../../open-sse/providers/thinkingLevels.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { OpenCodeExecutor } from "../../open-sse/executors/opencode.js";
import { FILTERS } from "../../src/app/api/providers/suggested-models/filters.js";
import "../translator/registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";

const MODEL = "union-alpha";
const PROVIDER = "opencode";

describe("OpenCode Free Union Alpha", () => {
  it("is registered on the oc alias with the claude wire format", () => {
    expect(PROVIDER_MODELS.oc?.some((model) => model.id === MODEL)).toBe(true);
    expect(getModelTargetFormat("oc", MODEL)).toBe(FORMATS.CLAUDE);
    // Only the Anthropic endpoint serves this model (Zen endpoints table).
    expect(getModelSupportedFormats("oc", MODEL)).toEqual(["claude"]);
    // Other providers are unaffected by this entry.
    expect(getModelTargetFormat("openrouter", MODEL)).toBeNull();
  });

  it("advertises vision, tools and reasoning with the models.dev limits", () => {
    expect(getCapabilitiesForModel(PROVIDER, MODEL)).toMatchObject({
      vision: true,
      tools: true,
      reasoning: true,
      thinkingFormat: "claude-budget",
      contextWindow: 262144,
      maxOutput: 131072,
    });
    // Vendor-prefixed ids resolve to the same capabilities.
    expect(getCapabilitiesForModel(PROVIDER, `oc/${MODEL}`)).toMatchObject({
      vision: true,
      contextWindow: 262144,
      maxOutput: 131072,
    });
  });

  it("offers the claude-budget thinking levels", () => {
    expect(getThinkingLevels(PROVIDER, MODEL)).toEqual([
      "none",
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]);
  });

  it("routes to /zen/v1/messages and leaves the other endpoints alone", () => {
    const executor = new OpenCodeExecutor();
    expect(executor.buildUrl(MODEL)).toBe("https://opencode.ai/zen/v1/messages");
    expect(executor.buildUrl(`${MODEL}(high)`)).toBe("https://opencode.ai/zen/v1/messages");
    expect(executor.buildUrl("muse-spark-1.2-contributor-free")).toBe("https://opencode.ai/zen/v1/responses");
    expect(executor.buildUrl("big-pickle")).toBe("https://opencode.ai/zen/v1/chat/completions");
  });

  it("keeps the public-Bearer + opencode identity headers", () => {
    const executor = new OpenCodeExecutor();
    const headers = executor.buildHeaders({ connectionId: "union-alpha-test" }, true);
    expect(headers["Authorization"]).toBe("Bearer public");
    expect(headers["Anthropic-version"] ?? headers["anthropic-version"]).toBeUndefined();
    expect(headers["Content-Type"]).toBe("application/json");
    expect(typeof headers["x-opencode-session"]).toBe("string");
    expect(headers["x-opencode-session"]).toMatch(/^ses_/);
    expect(headers["Accept"]).toBe("text/event-stream");
  });

  it("translates an OpenAI chat request into the Anthropic shape for /messages", () => {
    const body = {
      model: `oc/${MODEL}`,
      messages: [
        { role: "system", content: "Be terse." },
        { role: "user", content: "What is 2 + 2?" },
      ],
      max_tokens: 2048,
      reasoning_effort: "high",
    };

    const translated = translateRequest(
      FORMATS.OPENAI,
      FORMATS.CLAUDE,
      MODEL,
      body,
      true,
      {},
      PROVIDER,
    );
    const out = new OpenCodeExecutor().transformRequest(MODEL, translated, true, {
      connectionId: "union-alpha-translation-test",
    });

    // Anthropic wire shape: system hoisted out of messages, thinking as a budget.
    // The translator prepends the Claude Code identity prompt, so the client's
    // own system text lands in a following block.
    const systemBlocks = Array.isArray(out.system) ? out.system : [{ text: out.system }];
    expect(systemBlocks.map((b) => b.text).join("\n")).toContain("Be terse.");
    expect(out.messages.some((m) => m.role === "system")).toBe(false);
    expect(out.thinking?.type).toBe("enabled");
    expect(typeof out.thinking?.budget_tokens).toBe("number");
    // The endpoint requires max_tokens and it must exceed the thinking budget.
    expect(out.max_tokens).toBeGreaterThan(out.thinking.budget_tokens);
    expect(out.max_tokens).toBeLessThanOrEqual(131072);
    expect(out.reasoning_effort).toBeUndefined();
  });

  it("preserves tool declarations for the Anthropic endpoint", () => {
    const body = {
      model: `oc/${MODEL}`,
      messages: [{ role: "user", content: "Weather in Paris?" }],
      max_tokens: 1024,
      tools: [
        {
          type: "function",
          function: {
            name: "get_weather",
            description: "Get weather",
            parameters: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
          },
        },
      ],
    };

    const translated = translateRequest(FORMATS.OPENAI, FORMATS.CLAUDE, MODEL, body, true, {}, PROVIDER);
    const tool = translated.tools?.[0];
    expect(tool?.name).toBe("get_weather");
    expect(tool?.input_schema?.properties?.city?.type).toBe("string");
  });

  it("surfaces union-alpha in the free OpenCode model suggestions", () => {
    const models = [
      { id: "union-alpha" },
      { id: "big-pickle" },
      { id: "muse-spark-1.3-contributor-free" },
      { id: "deepseek-v4-flash-free" },
      { id: "kimi-k3" },
    ];
    const suggested = FILTERS["opencode-free"](models).map((m) => m.id);
    expect(suggested).toContain("union-alpha");
    expect(suggested).toContain("big-pickle");
    expect(suggested).not.toContain("kimi-k3");
  });
});
