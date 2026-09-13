import { describe, expect, it } from "vitest";

import { openaiToOpenAIResponsesRequest } from "../../open-sse/translator/request/openai-responses.js";

describe("openaiToOpenAIResponsesRequest: synthetic user message handling", () => {
  it("skips trailing user messages that contain only <system-reminder> tags after tool results", () => {
    const body = {
      model: "muse-spark-1.3-contributor-free",
      messages: [
        { role: "user", content: "Read the file and edit it" },
        {
          role: "assistant",
          content: null,
          tool_calls: [
            { id: "call_123", type: "function", function: { name: "Read", arguments: '{"path":"file.txt"}' } },
          ],
        },
        { role: "tool", tool_call_id: "call_123", content: "file content here" },
        {
          role: "user",
          content: "<system-reminder>snip_id=6i5550; system-generated; for snip tool use only; do not discuss in thinking or responses.</system-reminder>",
        },
      ],
      tools: [
        { type: "function", function: { name: "Read", parameters: { type: "object", properties: {} } } },
        { type: "function", function: { name: "Edit", parameters: { type: "object", properties: {} } } },
      ],
    };

    const out = openaiToOpenAIResponsesRequest("muse-spark-1.3-contributor-free", body, true, null);

    // The input should end with function_call_output, NOT a fake user message
    const lastItem = out.input[out.input.length - 1];
    expect(lastItem.type).toBe("function_call_output");
    expect(lastItem.call_id).toBe("call_123");

    // No user message should have been emitted for the snip_id reminder
    const userMessages = out.input.filter((i) => i.role === "user");
    expect(userMessages).toHaveLength(1);
    expect(userMessages[0].content[0].text).toBe("Read the file and edit it");
  });

  it("strips client-side snip_id reminders from user messages with real text", () => {
    const body = {
      model: "muse-spark-1.3-contributor-free",
      messages: [
        {
          role: "user",
          content: "Faça o que te pedi\n<system-reminder>snip_id=d7fxje; system-generated; for snip tool use only; do not discuss in thinking or responses.</system-reminder>",
        },
      ],
    };

    const out = openaiToOpenAIResponsesRequest("muse-spark-1.3-contributor-free", body, true, null);

    const userMsg = out.input.find((i) => i.role === "user");
    expect(userMsg).toBeDefined();
    expect(userMsg.content[0].text).toBe("Faça o que te pedi");
    expect(userMsg.content[0].text).not.toContain("snip_id=");
  });

  it("preserves real user messages without system reminders", () => {
    const body = {
      model: "muse-spark-1.3-contributor-free",
      messages: [
        { role: "user", content: "Pode continuar" },
      ],
    };

    const out = openaiToOpenAIResponsesRequest("muse-spark-1.3-contributor-free", body, true, null);

    const userMsg = out.input.find((i) => i.role === "user");
    expect(userMsg).toBeDefined();
    expect(userMsg.content[0].text).toBe("Pode continuar");
  });

  it("does not skip user message if it is the only input item", () => {
    const body = {
      model: "muse-spark-1.3-contributor-free",
      messages: [
        {
          role: "user",
          content: "<system-reminder>initial reminder</system-reminder>",
        },
      ],
    };

    const out = openaiToOpenAIResponsesRequest("muse-spark-1.3-contributor-free", body, true, null);
    // When input is empty, don't drop the initial message so request doesn't have empty input
    expect(out.input.length).toBeGreaterThan(0);
  });

  it("keeps synthetic user messages and snip_id text for non-Muse-Spark models", () => {
    const body = {
      model: "big-pickle",
      messages: [
        { role: "user", content: "Read the file" },
        { role: "tool", tool_call_id: "call_123", content: "file content here" },
        {
          role: "user",
          content: "<system-reminder>snip_id=6i5550; system-generated; for snip tool use only.</system-reminder>",
        },
      ],
    };

    const out = openaiToOpenAIResponsesRequest("big-pickle", body, true, null);
    const lastItem = out.input[out.input.length - 1];
    expect(lastItem.type).toBe("message");
    expect(lastItem.role).toBe("user");
    expect(lastItem.content[0].text).toContain("snip_id=");
  });
});
