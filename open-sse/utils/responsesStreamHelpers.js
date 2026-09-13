// Helpers for OpenAI Responses API streaming termination + event framing
import { FORMATS } from "../translator/formats.js";
import { formatSSE } from "./streamHelpers.js";

// Responses API events that signal the stream has reached a terminal state
const OPENAI_RESPONSES_TERMINAL_EVENTS = new Set([
  "response.completed",
  "response.done",
  "response.failed",
  "error"
]);

export function getOpenAIResponsesEventName(eventName, chunk) {
  if (eventName) return eventName;
  if (chunk && typeof chunk.type === "string") return chunk.type;
  return null;
}

export function isOpenAIResponsesTerminalEvent(eventName, chunk) {
  const type = getOpenAIResponsesEventName(eventName, chunk);
  if (OPENAI_RESPONSES_TERMINAL_EVENTS.has(type)) return true;
  const status = chunk?.response?.status;
  return status === "completed" || status === "failed";
}

const sharedEncoder = new TextEncoder();

// Encoded response.failed + [DONE] payload for aborted/stalled Responses passthrough streams
export function buildAbortedResponsesTerminalBytes() {
  return sharedEncoder.encode(`${formatIncompleteOpenAIResponsesStreamFailure()}data: [DONE]\n\n`);
}

// Synthesize a response.failed event for streams that close without a terminal event
export function formatIncompleteOpenAIResponsesStreamFailure() {
  return formatSSE({
    event: "response.failed",
    data: {
      type: "response.failed",
      response: {
        id: `resp_${Date.now()}`,
        status: "failed",
        error: {
          type: "stream_error",
          code: "stream_disconnected",
          message: "stream closed before response.completed"
        }
      }
    }
  }, FORMATS.OPENAI_RESPONSES);
}

// --- Chat (OpenAI / Claude) abort terminals ---------------------------------
// Same idea as response.failed above, but for chat SSE: synthesize an explicit
// error payload when the upstream disconnects mid-stream (ECONNRESET, socket
// hang up, stall) before any terminal chunk (finish_reason / message_stop).
// Without this, clients (e.g. opencode SessionRetry) see a truncated stream
// followed by [DONE] and assume the turn completed, so they never retry.
// Only built for Muse Spark requests; the caller also enables
// surfaceMidStreamErrors so a transport error follows the payload.
const STREAM_DISCONNECTED_MESSAGE =
  "stream closed before terminal chunk (upstream disconnect/stall)";

function formatIncompleteOpenAIChatStreamFailure() {
  return `data: ${JSON.stringify({
    id: `chatcmpl-${Date.now().toString(36)}`,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    choices: [{ index: 0, delta: {}, finish_reason: "error" }],
    error: {
      message: STREAM_DISCONNECTED_MESSAGE,
      type: "server_error",
      code: "stream_disconnected",
    },
  })}\n\n`;
}

function formatIncompleteClaudeStreamFailure() {
  return `event: error\ndata: ${JSON.stringify({
    type: "error",
    error: { type: "api_error", message: STREAM_DISCONNECTED_MESSAGE },
  })}\n\n`;
}

// Encoded chat error payload for aborted/stalled chat streams. Takes the
// client sourceFormat so OpenAI clients get an OpenAI-shaped chunk and Claude
// clients get the standard Anthropic error event.
export function buildAbortedChatTerminalBytes(sourceFormat) {
  const payload =
    sourceFormat === FORMATS.CLAUDE
      ? formatIncompleteClaudeStreamFailure()
      : formatIncompleteOpenAIChatStreamFailure();
  return sharedEncoder.encode(payload);
}
