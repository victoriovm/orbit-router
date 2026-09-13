// Sessão deslizante: o token tem exp de 30 dias, mas é reemitido após 24h de
// uso. Sem o rolling, um usuário ativo seria deslogado no 30º dia.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/localDb", () => ({
  getSettings: vi.fn(async () => ({ requireLogin: true })),
}));

process.env.JWT_SECRET = "sliding-session-test-secret";

const {
  createDashboardAuthToken,
  getDashboardAuthSession,
  refreshDashboardSessionIfStale,
  setDashboardAuthCookie,
  clearDashboardAuthCookie,
  SESSION_COOKIE_MAX_AGE_SEC,
  SESSION_REFRESH_AFTER_SEC,
} = await import("../../src/lib/auth/dashboardSession.js");

const DAY_MS = 24 * 60 * 60 * 1000;
const START = new Date("2030-01-01T00:00:00Z");

function fakeResponse() {
  const cookies = new Map();
  return {
    cookies: {
      set: vi.fn((name, value, options) => cookies.set(name, { value, options })),
      get: (name) => cookies.get(name),
    },
  };
}

function request(headers = {}) {
  return { headers: new Headers(headers) };
}

describe("dashboard session rolling", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: START });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps a session younger than 24h untouched", async () => {
    const response = fakeResponse();
    const session = { authenticated: true, iat: Math.floor(Date.now() / 1000) - 60 };

    const rolled = await refreshDashboardSessionIfStale(response, request(), session);

    expect(rolled).toBe(false);
    expect(response.cookies.set).not.toHaveBeenCalled();
  });

  it("re-issues the token with fresh iat/exp once the session passes 24h", async () => {
    const response = fakeResponse();
    const session = {
      authenticated: true,
      iat: Math.floor(Date.now() / 1000) - SESSION_REFRESH_AFTER_SEC - 5,
      saml: true,
      samlEmail: "ana@empresa.com",
      samlName: "Ana",
    };

    const rolled = await refreshDashboardSessionIfStale(response, request(), session);

    expect(rolled).toBe(true);
    const stored = response.cookies.get("auth_token");
    expect(stored.options).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_COOKIE_MAX_AGE_SEC,
    });

    const refreshed = await getDashboardAuthSession(stored.value);
    expect(refreshed).not.toBeNull();
    expect(refreshed.authenticated).toBe(true);
    expect(refreshed.saml).toBe(true);
    expect(refreshed.samlEmail).toBe("ana@empresa.com");
    expect(refreshed.samlName).toBe("Ana");
    expect(Math.floor(Date.now() / 1000) - refreshed.iat).toBeLessThan(SESSION_REFRESH_AFTER_SEC);
    expect(refreshed.exp - refreshed.iat).toBe(SESSION_COOKIE_MAX_AGE_SEC);
  });

  it("keeps an active session alive well past the 30-day token lifetime", async () => {
    let token = await createDashboardAuthToken({ passkey: true });
    expect(await getDashboardAuthSession(token)).not.toBeNull();

    for (let day = 0; day < 45; day += 1) {
      vi.advanceTimersByTime(DAY_MS);

      const session = await getDashboardAuthSession(token);
      expect(session).not.toBeNull();

      const response = fakeResponse();
      const rolled = await refreshDashboardSessionIfStale(response, request(), session);
      expect(rolled).toBe(true);
      token = response.cookies.get("auth_token").value;
    }

    const session = await getDashboardAuthSession(token);
    expect(session).not.toBeNull();
    expect(session.passkey).toBe(true);
  });

  it("expires a session left unused for more than 30 days", async () => {
    const token = await createDashboardAuthToken({ passkey: true });

    vi.advanceTimersByTime(31 * DAY_MS);

    expect(await getDashboardAuthSession(token)).toBeNull();
  });

  it("issues new sessions with the 30-day window and clears it only on logout", async () => {
    const store = { set: vi.fn() };

    await setDashboardAuthCookie(store, request(), { passkey: true });
    expect(store.set).toHaveBeenCalledWith(
      "auth_token",
      expect.any(String),
      expect.objectContaining({ maxAge: SESSION_COOKIE_MAX_AGE_SEC })
    );

    store.set.mockClear();
    clearDashboardAuthCookie(store);
    expect(store.set).toHaveBeenCalledWith(
      "auth_token",
      "",
      expect.objectContaining({ path: "/", maxAge: 0 })
    );
  });
});