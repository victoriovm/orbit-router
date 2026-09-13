import { describe, expect, it } from "vitest";

import { createDisconnectAwareStream } from "../../open-sse/utils/streamHandler.js";
import {
  buildAbortedChatTerminalBytes,
  buildAbortedResponsesTerminalBytes,
} from "../../open-sse/utils/responsesStreamHelpers.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

// Minimal stream controller stub
function makeController() {
  let connected = true;
  return {
    signal: new AbortController().signal,
    startTime: Date.now(),
    isConnected: () => connected,
    handleComplete: () => { connected = false; },
    handleError: () => { connected = false; },
    handleDisconnect: () => { connected = false; },
    abort: () => { connected = false; },
  };
}

// Read chunks until the stream errors; return text received before the error.
async function readUntilError(stream) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let thrown = null;
  while (true) {
    try {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    } catch (e) {
      thrown = e;
      break;
    }
  }
  text += decoder.decode();
  return { text, thrown };
}

function erroringUpstream(message) {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("data: partial\n\n"));
      controller.error(new Error(message));
    },
  });
}

const passthrough = () => ({ abort: () => Promise.resolve() });

describe("Chat abort terminal synthesis", () => {
  it("emits an OpenAI error payload then errors for openai clients", async () => {
    const out = createDisconnectAwareStream(
      { readable: erroringUpstream("socket hang up"), writable: { getWriter: passthrough } },
      makeController(),
      () => buildAbortedChatTerminalBytes(FORMATS.OPENAI)
    );

    const { text, thrown } = await readUntilError(out);
    expect(text).toContain("stream_disconnected");
    expect(text).toContain('finish_reason');
    expect(thrown?.message).toContain("socket hang up");
  });

  it("emits an Anthropic error event for claude clients", async () => {
    const out = createDisconnectAwareStream(
      { readable: erroringUpstream("ECONNRESET"), writable: { getWriter: passthrough } },
      makeController(),
      () => buildAbortedChatTerminalBytes(FORMATS.CLAUDE)
    );

    const { text, thrown } = await readUntilError(out);
    expect(text).toContain("event: error");
    expect(text).toContain("stream closed before terminal chunk");
    expect(thrown?.message).toContain("ECONNRESET");
  });

  it("treats stall timeouts as errors even after disconnect was marked", async () => {
    // pipeWithDisconnect marks handleError (disconnected) before aborting the
    // fetch on stall — the stream must still surface an error, not clean EOF.
    const ctl = makeController();
    ctl.handleError(new Error("stream stall timeout"));
    ctl.isStalled = () => true;
    ctl.stallError = () => new Error("stream stall timeout");
    const out = createDisconnectAwareStream(
      { readable: erroringUpstream("stream stall timeout"), writable: { getWriter: passthrough } },
      ctl,
      () => buildAbortedChatTerminalBytes(FORMATS.OPENAI)
    );

    const { text, thrown } = await readUntilError(out);
    expect(text).toContain("stream_disconnected");
    expect(thrown?.message).toContain("stall timeout");
  });

  it("flags chat terminals as errors and Responses terminals as graceful", () => {
    expect(buildAbortedChatTerminalBytes.terminalIsError).toBe(true);
    expect(buildAbortedResponsesTerminalBytes.terminalIsError).toBe(false);
  });
});
