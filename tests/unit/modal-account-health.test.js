// Modal endpoints are user-operated apps: a failing endpoint must park the whole
// account (all of its URLs) for 30 minutes, and 3 failures in a row must disable
// the account. A model that no endpoint hosts is a request error instead — it
// must not lock anything nor count as a failure.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  updateProviderConnection: vi.fn(),
  getSettings: vi.fn(),
  getProxyPools: vi.fn(),
  resolveConnectionProxyConfig: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: dbMocks.getProviderConnections,
  updateProviderConnection: dbMocks.updateProviderConnection,
  getSettings: dbMocks.getSettings,
  getProxyPools: dbMocks.getProxyPools,
  validateApiKey: vi.fn(),
}));
vi.mock("@/lib/network/connectionProxy", () => ({
  pickProxyPoolId: vi.fn(),
  resolveConnectionProxyConfig: dbMocks.resolveConnectionProxyConfig,
}));
vi.mock("@/sse/utils/logger.js", () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn() }));

const { markAccountUnavailable, clearAccountError, getProviderCredentials } = await import("../../src/sse/services/auth.js");
const { checkFallbackError } = await import("../../open-sse/services/accountFallback.js");

const MODEL = "deepseek-ai/DeepSeek-V4.1-Flash";
const NOT_SERVED = `${MODEL} is not served by any configured endpoint of this account (2 checked) — check the endpoint URLs or run "Discover Models"`;
const DEEPSEEK_URL = "https://conta-um-deepseek.modal.run/v1";
const GLM_URL = "https://conta-um-glm.modal.run/v1";
const NOW = new Date("2026-09-14T12:00:00.000Z");
const THIRTY_MIN_MS = 30 * 60 * 1000;

const lastPatch = () => dbMocks.updateProviderConnection.mock.calls.at(-1)[1];

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  dbMocks.getSettings.mockResolvedValue({});
  dbMocks.getProxyPools.mockResolvedValue([]);
  dbMocks.resolveConnectionProxyConfig.mockResolvedValue({});
});

afterEach(() => {
  vi.useRealTimers();
});

describe("modal account cooldown", () => {
  it("parks the whole account for 30 minutes and counts a failure strike", async () => {
    dbMocks.getProviderConnections.mockResolvedValue([
      { id: "modal-a", provider: "modal", name: "conta-um", failureStrikes: 0 },
    ]);

    const { shouldFallback, cooldownMs } = await markAccountUnavailable(
      "modal-a", 502, "getaddrinfo ENOTFOUND superior-monkey-1339--ep-deepseek-v4-1-flash-server.us-west.modal.direct",
      "modal", MODEL,
    );

    expect(shouldFallback).toBe(true);
    expect(cooldownMs).toBe(THIRTY_MIN_MS);

    // The lock is stored on the connection — one account, every endpoint URL it
    // holds — so the failed URL parks the account instead of just itself.
    const patch = lastPatch();
    expect(Object.keys(patch).filter((key) => key.startsWith("modelLock_"))).toEqual([`modelLock_${MODEL}`]);
    expect(patch[`modelLock_${MODEL}`]).toBe(new Date(NOW.getTime() + THIRTY_MIN_MS).toISOString());
    expect(patch.failureStrikes).toBe(1);
    expect(patch.isActive).toBeUndefined();
    expect(patch.testStatus).toBe("unavailable");
  });

  it("raises rate-limit backoff to the same 30 minutes", async () => {
    dbMocks.getProviderConnections.mockResolvedValue([{ id: "modal-a", provider: "modal" }]);

    const { cooldownMs } = await markAccountUnavailable("modal-a", 429, "Rate limit reached", "modal", MODEL);

    expect(cooldownMs).toBe(THIRTY_MIN_MS);
    expect(lastPatch().backoffLevel).toBe(1);
  });

  it("disables the account on the third failure in a row", async () => {
    dbMocks.getProviderConnections.mockResolvedValue([
      { id: "modal-a", provider: "modal", name: "conta-um", failureStrikes: 2 },
    ]);

    await markAccountUnavailable("modal-a", 502, "endpoint down", "modal", MODEL);

    const patch = lastPatch();
    expect(patch.failureStrikes).toBe(3);
    expect(patch.isActive).toBe(false);
    expect(patch.lastError).toMatch(/Disabled after 3 failures/);
  });

  it("leaves providers without a health policy on the generic cooldown", async () => {
    dbMocks.getProviderConnections.mockResolvedValue([{ id: "ds-1", provider: "deepseek" }]);

    const { cooldownMs } = await markAccountUnavailable("ds-1", 502, "boom", "deepseek", "deepseek-chat");

    expect(cooldownMs).toBe(30 * 1000);
    expect(lastPatch().failureStrikes).toBeUndefined();
    expect(lastPatch().isActive).toBeUndefined();
  });
});

describe("model that no configured endpoint hosts", () => {
  it("is a request error: no cooldown, no strike, no account fallback", async () => {
    expect(checkFallbackError(404, NOT_SERVED)).toEqual({ shouldFallback: false, cooldownMs: 0 });

    const result = await markAccountUnavailable("modal-a", 404, NOT_SERVED, "modal", MODEL);

    expect(result).toEqual({ shouldFallback: false, cooldownMs: 0 });
    expect(dbMocks.updateProviderConnection).not.toHaveBeenCalled();
  });
});

describe("block scope is the account, not the endpoint", () => {
  it("skips the whole account for a parked model, whichever endpoint failed", async () => {
    const lockedUntil = new Date(NOW.getTime() + THIRTY_MIN_MS).toISOString();
    dbMocks.getProviderConnections.mockResolvedValue([
      {
        id: "modal-a",
        provider: "modal",
        name: "conta-um",
        apiKey: "sk-test",
        isActive: true,
        // Two endpoints, one route map — the lock has no endpoint dimension.
        providerSpecificData: { baseUrls: [DEEPSEEK_URL, GLM_URL], modelBaseUrls: { [MODEL]: DEEPSEEK_URL } },
        [`modelLock_${MODEL}`]: lockedUntil,
      },
      { id: "modal-b", provider: "modal", name: "conta-dois", apiKey: "sk-test-2", isActive: true },
    ]);

    const credentials = await getProviderCredentials("modal", null, MODEL);

    expect(credentials).toMatchObject({ connectionId: "modal-b" });
  });

  it("reports the retry time when the only account is parked", async () => {
    const lockedUntil = new Date(NOW.getTime() + THIRTY_MIN_MS).toISOString();
    dbMocks.getProviderConnections.mockResolvedValue([
      {
        id: "modal-a",
        provider: "modal",
        name: "conta-um",
        isActive: true,
        providerSpecificData: { baseUrls: [DEEPSEEK_URL, GLM_URL] },
        [`modelLock_${MODEL}`]: lockedUntil,
      },
    ]);

    await expect(getProviderCredentials("modal", null, MODEL)).resolves.toMatchObject({
      allRateLimited: true,
      retryAfter: lockedUntil,
    });
  });
});

describe("account health recovery", () => {
  it("a working request clears the accumulated strikes", async () => {
    const conn = {
      id: "modal-a",
      provider: "modal",
      failureStrikes: 2,
      testStatus: "unavailable",
      lastError: "endpoint down",
      [`modelLock_${MODEL}`]: new Date(NOW.getTime() + 60_000).toISOString(),
    };

    await clearAccountError("modal-a", { _connection: conn }, MODEL);

    const patch = lastPatch();
    expect(patch.failureStrikes).toBe(0);
    expect(patch.testStatus).toBe("active");
    expect(patch[`modelLock_${MODEL}`]).toBeNull();
  });

  it("writes nothing for a healthy connection", async () => {
    await clearAccountError("modal-a", {
      _connection: { id: "modal-a", provider: "modal", testStatus: "active" },
    }, MODEL);

    expect(dbMocks.updateProviderConnection).not.toHaveBeenCalled();
  });
});