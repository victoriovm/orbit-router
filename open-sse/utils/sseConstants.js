// Shared SSE primitives (no imports → safe for executors + stream.js)
export const SSE_DONE = "data: [DONE]\n\n";

// SSE comment heartbeat — ignored by event parsers, resets idle timers on
// nginx/Cloudflare and NATs while upstream reasoning stays silent.
export const SSE_HEARTBEAT = ": ping\n\n";

export const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  "Connection": "keep-alive"
};

// Variant for web-cookie executors behind nginx (disable proxy buffering)
export const SSE_HEADERS_NO_BUFFER = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  "X-Accel-Buffering": "no"
};

// Variant for client-facing SSE responses (adds permissive CORS).
// X-Accel-Buffering:no + no-transform keep long-lived streams flowing through
// nginx / Cloudflare instead of being buffered until completion (Muse thinking
// and tool_use deltas can leave the downstream idle long enough for middleboxes
// to kill the connection with ECONNRESET/socket hang up).
export const SSE_HEADERS_CORS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  "Connection": "keep-alive",
  "X-Accel-Buffering": "no",
  "Access-Control-Allow-Origin": "*"
};
