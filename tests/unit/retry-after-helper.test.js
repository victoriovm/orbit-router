import { describe, expect, it, vi, beforeEach } from "vitest";

import { MAX_RETRY_AFTER_MS, parseRetryAfterMs } from "../../open-sse/config/runtimeConfig.js";

const fetchMock = vi.fn();
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: (...args) => fetchMock(...args),
}));

const { OpenCodeExecutor } = await import("../../open-sse/executors/opencode.js");

// Muse Spark is the only scope for Zen Retry-After handling and 429 retries.
const MUSE = "muse-spark-1.3-contributor-free";

function res(status, headers = {}) {
  return { status, headers: new Headers(headers) };
}

beforeEach(() => fetchMock.mockReset());

describe("parseRetryAfterMs", () => {
  it("reads retry-after-ms (plain object and Headers)", () => {
    expect(parseRetryAfterMs({ "retry-after-ms": "250" })).toBe(250);
    expect(parseRetryAfterMs(new Headers({ "retry-after-ms": "250" }))).toBe(250);
  });

  it("converts retry-after seconds to ms", () => {
    expect(parseRetryAfterMs({ "retry-after": "2" })).toBe(2000);
  });

  it("parses retry-after HTTP dates", () => {
    const future = new Date(Date.now() + 5000).toUTCString();
    const parsed = parseRetryAfterMs({ "retry-after": future });
    expect(parsed).toBeGreaterThan(0);
    expect(parsed).toBeLessThanOrEqual(5000);
  });

  it("reads x-ratelimit-reset-after / x-ratelimit-reset", () => {
    expect(parseRetryAfterMs({ "x-ratelimit-reset-after": "3" })).toBe(3000);
    const epoch = String(Math.floor(Date.now() / 1000) + 4);
    expect(parseRetryAfterMs({ "x-ratelimit-reset": epoch })).toBeGreaterThan(0);
  });

  it("returns null when absent or invalid", () => {
    expect(parseRetryAfterMs(null)).toBeNull();
    expect(parseRetryAfterMs({})).toBeNull();
    expect(parseRetryAfterMs({ "retry-after": "not-a-date" })).toBeNull();
    expect(parseRetryAfterMs({ "retry-after": "-5" })).toBeNull();
  });
});

describe("OpenCodeExecutor.computeRetryDelay (Muse Spark scope)", () => {
  const ex = new OpenCodeExecutor();

  it("honors Retry-After within the cap for Muse Spark", async () => {
    const delay = await ex.computeRetryDelay(res(503, { "retry-after": "2" }), 1, 2000, MUSE);
    expect(delay).toBe(2000);
  });

  it("vetoes retry when Retry-After exceeds the cap", async () => {
    const delay = await ex.computeRetryDelay(
      res(429, { "retry-after": String(MAX_RETRY_AFTER_MS / 1000 + 60) }), 1, 2000, MUSE
    );
    expect(delay).toBe(false);
  });

  it("returns null without headers so static delayMs applies", async () => {
    await expect(ex.computeRetryDelay(res(502), 1, 3000, MUSE)).resolves.toBeNull();
  });

  it("ignores Retry-After for non-Muse-Spark models", async () => {
    await expect(
      ex.computeRetryDelay(res(503, { "retry-after": "2" }), 1, 2000, "big-pickle")
    ).resolves.toBeNull();
  });
});

describe("OpenCodeExecutor.execute — Muse Spark retry behavior", () => {
  const creds = { apiKey: "k" };

  it("retries 429 with the hinted delay for Muse Spark", async () => {
    fetchMock
      .mockResolvedValueOnce(res(429, { "retry-after-ms": "20" }))
      .mockResolvedValueOnce(res(200));
    const out = await new OpenCodeExecutor().execute({ model: MUSE, body: {}, stream: false, credentials: creds });
    expect(out.response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("vetoes retry on huge Retry-After and returns the response for account fallback", async () => {
    fetchMock.mockResolvedValueOnce(res(429, { "retry-after": "3600" }));
    const out = await new OpenCodeExecutor().execute({ model: MUSE, body: {}, stream: false, credentials: creds });
    expect(out.response.status).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry 429 for non-Muse-Spark models (global default unchanged)", async () => {
    fetchMock.mockResolvedValueOnce(res(429, { "retry-after": "2" }));
    const out = await new OpenCodeExecutor().execute({ model: "big-pickle", body: {}, stream: false, credentials: creds });
    expect(out.response.status).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("uses the longer connect budget only for Muse Spark", () => {
    const ex = new OpenCodeExecutor();
    expect(ex.getConnectTimeoutMs(MUSE)).toBe(120 * 1000);
    expect(ex.getConnectTimeoutMs("big-pickle")).toBe(60 * 1000);
  });
});
