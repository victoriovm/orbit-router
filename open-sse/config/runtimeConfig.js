// HTTP status codes
export const HTTP_STATUS = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  PAYMENT_REQUIRED: 402,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  NOT_ACCEPTABLE: 406,
  REQUEST_TIMEOUT: 408,
  RATE_LIMITED: 429,
  SERVER_ERROR: 500,
  BAD_GATEWAY: 502,
  SERVICE_UNAVAILABLE: 503,
  GATEWAY_TIMEOUT: 504
};

// Re-export error config (backward compat)
export { ERROR_TYPES, DEFAULT_ERROR_MESSAGES, BACKOFF_CONFIG, COOLDOWN_MS } from "./errorConfig.js";

// Cache TTLs (seconds)
export const CACHE_TTL = {
  userInfo: 300,    // 5 minutes
  modelAlias: 3600  // 1 hour
};

// Memory management config
export const MEMORY_CONFIG = {
  sessionTtlMs: 2 * 60 * 60 * 1000,
  sessionCleanupIntervalMs: 30 * 60 * 1000,
  dnsCacheTtlMs: 5 * 60 * 1000,
  proxyDispatchersMaxSize: 20,
};

// Parse a positive integer env override, falling back to a default.
function envMs(name, def) {
  const raw = process.env[name];
  if (raw == null || raw === "") return def;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : def;
}

function envUrl(name, def) {
  const raw = process.env[name]?.trim();
  return raw || def;
}

// SearXNG endpoint used by the unauthenticated web-search provider.
// Configure this for a separate Docker service or remote SearXNG instance.
export const SEARXNG_URL = envUrl("SEARXNG_URL", "http://localhost:8888/search");

// Inter-chunk stall timeout (once tokens are flowing). Generous headroom so
// slow reasoning models aren't aborted mid-stream. Env: STREAM_STALL_TIMEOUT_MS.
export const STREAM_STALL_TIMEOUT_MS = envMs("STREAM_STALL_TIMEOUT_MS", 360 * 1000);

// Time-to-first-token timeout (prompt prefill). Env: STREAM_FIRST_CHUNK_TIMEOUT_MS.
export const STREAM_FIRST_CHUNK_TIMEOUT_MS = envMs("STREAM_FIRST_CHUNK_TIMEOUT_MS", 200 * 1000);

// SSE heartbeat interval: comment ping sent while upstream is silent so
// nginx/Cloudflare don't kill idle downstream connections (Muse thinking
// and tool_use deltas can gap longer than middlebox idle timeouts).
// Env: SSE_HEARTBEAT_INTERVAL_MS.
export const SSE_HEARTBEAT_INTERVAL_MS = envMs("SSE_HEARTBEAT_INTERVAL_MS", 15 * 1000);

// Fetch connect timeout: abort if upstream doesn't return response headers within this duration.
// Reasoning models (o1/o3/Muse Spark) with large contexts (300k+ tokens) can take >60s for TTFT under load.
export const FETCH_CONNECT_TIMEOUT_MS = envMs("FETCH_CONNECT_TIMEOUT_MS", 120 * 1000);

// Gemini native TTS fetch timeout: abort if Google does not return response headers in time.
export const GEMINI_NATIVE_TTS_FETCH_TIMEOUT_MS = envMs("GEMINI_NATIVE_TTS_FETCH_TIMEOUT_MS", 45 * 1000);

// Default token limits
export const DEFAULT_MAX_TOKENS = 64000;
export const DEFAULT_MIN_TOKENS = 32000;

export const TOKEN_SAVER_HEADER = "x-9router-token-saver";

// Retry config for 429 responses (legacy - kept for backward compatibility)
export const RETRY_CONFIG = {
  maxAttempts: 2,
  delayMs: 2000
};

// Default retry config by status code: { attempts, delayMs }
// Backward compat: if value is a number, treated as attempts with RETRY_CONFIG.delayMs
export const DEFAULT_RETRY_CONFIG = {
  429: { attempts: 2, delayMs: 2000 },
  502: { attempts: 3, delayMs: 3000 },
  503: { attempts: 3, delayMs: 2000 },
  504: { attempts: 2, delayMs: 3000 }
};

// Cap for honoring upstream Retry-After delays: longer hints veto the retry
// (caller falls back to the next URL/account instead of sleeping for minutes).
// Env: MAX_RETRY_AFTER_MS.
export const MAX_RETRY_AFTER_MS = envMs("MAX_RETRY_AFTER_MS", 10 * 1000);

// Parse a retry delay hint from response headers (Headers instance or plain
// object). Checks retry-after-ms, retry-after (seconds or HTTP date),
// x-ratelimit-reset-after and x-ratelimit-reset (epoch seconds).
// Returns milliseconds, or null when absent/invalid.
export function parseRetryAfterMs(headers) {
  if (!headers) return null;
  const pick = (names) => {
    for (const name of names) {
      const value = typeof headers.get === "function"
        ? headers.get(name)
        : (headers[name] ?? headers[name.toLowerCase()]);
      if (value != null && value !== "") return value;
    }
    return null;
  };

  const afterMs = pick(["retry-after-ms", "x-retry-after-ms"]);
  if (afterMs != null) {
    const n = Number.parseFloat(afterMs);
    if (Number.isFinite(n) && n > 0) return n;
  }

  const after = pick(["retry-after", "x-ratelimit-reset-after"]);
  if (after != null) {
    const seconds = Number.parseFloat(after);
    if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
    const at = Date.parse(after);
    if (!Number.isNaN(at)) {
      const diff = at - Date.now();
      if (diff > 0) return diff;
    }
  }

  const resetEpoch = pick(["x-ratelimit-reset"]);
  if (resetEpoch != null) {
    const at = Number.parseFloat(resetEpoch) * 1000;
    if (Number.isFinite(at)) {
      const diff = at - Date.now();
      if (diff > 0) return diff;
    }
  }

  return null;
}

// Normalize a retry entry to { attempts, delayMs }
export function resolveRetryEntry(entry) {
  if (entry == null) return { attempts: 0, delayMs: RETRY_CONFIG.delayMs };
  if (typeof entry === "number") return { attempts: entry, delayMs: RETRY_CONFIG.delayMs };
  return {
    attempts: entry.attempts || 0,
    delayMs: entry.delayMs != null ? entry.delayMs : RETRY_CONFIG.delayMs
  };
}

// Requests containing these texts will bypass provider
export const SKIP_PATTERNS = [
  "Please write a 5-10 word title for the following conversation:"
];
