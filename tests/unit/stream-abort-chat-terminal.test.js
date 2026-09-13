import { describe, expect, it } from "vitest";

import { createDisconnectAwareStream, createStreamController, pipeWithDisconnect } from "../../open-sse/utils/streamHandler.js";
import { buildAbortedChatTerminalBytes } from "../../open-sse/utils/responsesStreamHelpers.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

// Muse Spark chat streams opt in to surfacing mid-stream failures this way.
const SURFACE = { surfaceMidStreamErrors: true };

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
      () => buildAbortedChatTerminalBytes(FORMATS.OPENAI),
      SURFACE
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
      () => buildAbortedChatTerminalBytes(FORMATS.CLAUDE),
      SURFACE
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
    ctl.isClientGone = () => false;
    const out = createDisconnectAwareStream(
      { readable: erroringUpstream("stream stall timeout"), writable: { getWriter: passthrough } },
      ctl,
      () => buildAbortedChatTerminalBytes(FORMATS.OPENAI),
      SURFACE
    );

    const { text, thrown } = await readUntilError(out);
    expect(text).toContain("stream_disconnected");
    expect(thrown?.message).toContain("stall timeout");
  });

  it("emits : ping heartbeats while upstream stays silent", async () => {
    const silentUpstream = new ReadableStream({});
    const out = createDisconnectAwareStream(
      { readable: silentUpstream, writable: { getWriter: passthrough } },
      makeController(),
      null,
      { heartbeatMs: 20 }
    );

    const reader = out.getReader();
    const first = await Promise.race([
      reader.read(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("heartbeat timeout")), 2000)),
    ]);
    expect(first.done).toBe(false);
    expect(new TextDecoder().decode(first.value)).toBe(": ping\n\n");
    await reader.cancel();
  });

  it("closes quietly when the client is already gone (no error noise)", async () => {
    const ctl = makeController();
    ctl.handleDisconnect("cancelled");
    ctl.isClientGone = () => true;
    ctl.isStalled = () => false;
    const out = createDisconnectAwareStream(
      { readable: erroringUpstream("socket hang up"), writable: { getWriter: passthrough } },
      ctl,
      () => buildAbortedChatTerminalBytes(FORMATS.OPENAI),
      SURFACE
    );

    // Client-initiated disconnect: terminal may flush, but the stream ends
    // cleanly instead of raising a transport error.
    const reader = out.getReader();
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
    expect(thrown).toBeNull();
  });

  it("keeps the legacy graceful close without an error terminal (non-Muse-Spark)", async () => {
    // No terminal builder = non-Muse-Spark request: network resets must keep
    // closing quietly instead of surfacing transport errors.
    const out = createDisconnectAwareStream(
      { readable: erroringUpstream("socket hang up"), writable: { getWriter: passthrough } },
      makeController(),
      null
    );

    const { text, thrown } = await readUntilError(out);
    expect(text).not.toContain("stream_disconnected");
    expect(thrown).toBeNull();
  });
});

describe("pipeWithDisconnect time-to-first-byte timeout", () => {
  it("aborts a prefill hang (no bytes) with a retryable stream error", async () => {
    const ctl = createStreamController({ provider: "test", model: "muse" });
    // Upstream never yields a byte: simulates a hung prefill behind a proxy.
    // Like a real fetch body, the stream errors when the abort signal fires.
    let bodyController;
    const body = new ReadableStream({ start(c) { bodyController = c; } });
    ctl.signal.addEventListener("abort", () => {
      bodyController.error(ctl.signal.reason || new Error("aborted"));
    });
    const providerResponse = new Response(body, {
      headers: { "content-type": "text/event-stream" },
    });
    const out = pipeWithDisconnect(
      providerResponse,
      new TransformStream(),
      ctl,
      () => buildAbortedChatTerminalBytes(FORMATS.OPENAI),
      5000, // stall budget (irrelevant: zero bytes)
      { firstChunkTimeoutMs: 30, surfaceMidStreamErrors: true }
    );

    const { text, thrown } = await readUntilError(out);
    expect(text).toContain("stream_disconnected");
    expect(thrown?.message).toMatch(/first-chunk|stall timeout/);
  }, 10000);
});
