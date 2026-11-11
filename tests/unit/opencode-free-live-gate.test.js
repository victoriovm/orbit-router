// LIVE free-tier gate test (opt-in): proves a NON-OpenCode client can use an
// oc/*-free model through the real router pipeline — translator → executor →
// wreq-js → opencode.ai — with the fingerprint emulated by the router.
//
// The request is deliberately Claude-Code-shaped: system WITHOUT the <env>
// marker, tools WITHOUT read/shell, no x-opencode-* headers. If the router's
// emulation is broken, upstream answers 429 FreeUsageLimitError and this test
// fails — exactly the bug class reported from the field.
//
// Skipped unless OPENCODE_LIVE_GATE_TEST=1 (consumes one free-tier request;
// never runs in CI). Model is the cheapest free lane; prompt is tiny.
import { describe, it, expect } from "vitest";

const runs = process.env.OPENCODE_LIVE_GATE_TEST === "1";

describe.skipIf(!runs)("live opencode free gate (opt-in)", { timeout: 120000 }, () => {
  it("passes a non-OpenCode client through the free-tier gates", async () => {
    const { translateRequest, initState, translateResponse } = await import("../../open-sse/translator/index.js");
    const { FORMATS } = await import("../../open-sse/translator/formats.js");
    const { OpenCodeExecutor } = await import("../../open-sse/executors/opencode.js");

    const MODEL = "deepseek-v4.1-flash-free";
    const PROVIDER = "opencode";

    // Claude-Code-shaped request: no <env> marker, "Bash" instead of shell.
    const claudeBody = {
      model: MODEL,
      system: [{ type: "text", text: "You are Claude Code, Anthropic's official CLI for Agent. Keep replies short." }],
      messages: [{ role: "user", content: [{ type: "text", text: "Reply with exactly: OK" }] }],
      tools: [{
        name: "Bash",
        description: "Executes a given bash command in a shell.",
        input_schema: {
          type: "object",
          properties: { command: { type: "string", description: "The command to execute" } },
          required: ["command"],
        },
      }],
      max_tokens: 64,
      stream: true,
    };

    // Real-pipeline lane for oc/*-free models: provider opencode has no claude
    // transport and no model-level target, so chatCore resolves FORMATS.OPENAI
    // (getTargetFormat -> config.format || "openai") and the executor posts to
    // /inference/v1/chat/completions. Translating claude -> openai, then the
    // executor's transformRequest emulates the fingerprint on the chat shape.
    const translated = translateRequest(
      FORMATS.CLAUDE, FORMATS.OPENAI, MODEL, structuredClone(claudeBody),
      true, {}, PROVIDER, null, [], "live-gate-test", "claude"
    );

    // Fingerprint emulation happens at the executor boundary (transformRequest
    // inside execute), not during translation — assert on transformedBody below.

    const executor = new OpenCodeExecutor();
    const result = await executor.execute({
      model: MODEL,
      body: translated,
      stream: true,
      credentials: {},
      providerSessionId: "live-gate-test-session-0001",
      clientTool: "claude",
      signal: AbortSignal.timeout(90000),
      log: null,
      proxyOptions: null,
    });

    const { response, url, transformedBody } = result;
    expect(url).toContain("/inference/v1/chat/completions");
    // The gate verdict: anything but 200 means the emulation failed.
    if (response.status !== 200) {
      const text = await response.text().catch(() => "");
      throw new Error(`upstream ${response.status}: ${text.slice(0, 400)}`);
    }
    expect(response.status).toBe(200);
    // Chat lane: fingerprint tools ride as {type:"function", function:{name}};
    // the <env> marker is appended to the first system message.
    const sentToolNames = (transformedBody?.tools || []).map((t) => t.function?.name || t.name);
    expect(sentToolNames).toEqual(expect.arrayContaining(["read", "shell"]));
    const systemText = (transformedBody?.messages || [])
      .filter((m) => m.role === "system")
      .map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content)))
      .join("\n");
    expect(systemText).toContain("<env>");

    // Consume the stream through the real response translator (upstream SSE is
    // OpenAI chat; projecting to OPENAI is the identity for this client shape).
    const state = initState(FORMATS.OPENAI);
    let textOut = "";
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") continue;
        try {
          for (const item of translateResponse(FORMATS.OPENAI, FORMATS.OPENAI, JSON.parse(payload), state) || []) {
            const delta = item?.choices?.[0]?.delta;
            if (typeof delta?.content === "string") textOut += delta.content;
          }
        } catch { /* keepalive frame */ }
      }
    }
    expect(textOut).toContain("OK");
  });
});
