import { describe, expect, it } from "vitest";

import { FORMATS } from "../../open-sse/translator/formats.js";
import { createSSETransformStreamWithLogger } from "../../open-sse/utils/stream.js";

async function runTranslate(input, targetFormat, sourceFormat) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(input));
      controller.close();
    },
  });

  const output = stream.pipeThrough(
    createSSETransformStreamWithLogger(
      targetFormat,
      sourceFormat,
      "opencode",
      null,
      null,
      "muse-spark-1.3-contributor-free",
    ),
  );

  const reader = output.getReader();
  const decoder = new TextDecoder();
  let text = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  return text;
}

const RESPONSES_TEXT_STREAM = [
  `event: response.created`,
  `data: ${JSON.stringify({ type: "response.created", response: { id: "resp_test", status: "in_progress" } })}`,
  "",
  `event: response.output_text.delta`,
  `data: ${JSON.stringify({ type: "response.output_text.delta", delta: "hello" })}`,
  "",
  `event: response.completed`,
  `data: ${JSON.stringify({ type: "response.completed", response: { id: "resp_test", status: "completed" } })}`,
  "",
].join("\n");

describe("translate-mode [DONE] sentinel", () => {
  it("terminates Responses → OpenAI streams with exactly one [DONE]", async () => {
    const output = await runTranslate(
      RESPONSES_TEXT_STREAM,
      FORMATS.OPENAI_RESPONSES,
      FORMATS.OPENAI
    );

    expect(output).toContain("hello");
    expect(output).toContain('"finish_reason":"stop"');
    expect(output.trimEnd().endsWith("data: [DONE]")).toBe(true);
    expect(output.match(/data: \[DONE\]/g)).toHaveLength(1);
  });

  it("does not append [DONE] for Claude clients (event framing is the terminator)", async () => {
    const claudeUpstream = [
      `event: response.created`,
      `data: ${JSON.stringify({ type: "response.created", response: { id: "r", status: "in_progress" } })}`,
      "",
      `event: response.completed`,
      `data: ${JSON.stringify({ type: "response.completed", response: { id: "r", status: "completed" } })}`,
      "",
    ].join("\n");
    const output = await runTranslate(
      claudeUpstream,
      FORMATS.OPENAI_RESPONSES,
      FORMATS.CLAUDE
    );

    expect(output).not.toContain("data: [DONE]");
  });
});
