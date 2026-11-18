import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const root = "../../src/app/(dashboard)/dashboard/providers/[id]/";
const read = (name) => readFileSync(new URL(`${root}${name}`, import.meta.url), "utf8");
const modal = read("PiAuthModal.js");
const button = read("PiUpdateButton.js");
const page = read("page.js");

// Exercise the actual cleanup function without adding a DOM/test-renderer dependency.
const cleanupSource = modal.slice(modal.indexOf("function cancelAttempt("), modal.indexOf("export default function"));
const makeCleanup = (request) => new Function("request", "post", `${cleanupSource}; return cancelAttempt;`)(
  request,
  (body) => ({ method: "POST", body: JSON.stringify(body) }),
);
const attempt = (sessionId) => ({ active: true, sessionId, controller: new AbortController(), done: false });

describe("Pi authentication UI", () => {
  it("cancels each attempt at most once and stops its pending work", () => {
    const request = vi.fn().mockResolvedValue({});
    const cancel = makeCleanup(request);
    const session = attempt("session-one");
    cancel(session);
    cancel(session);
    expect(session.active).toBe(false);
    expect(session.controller.signal.aborted).toBe(true);
    expect(request).toHaveBeenCalledTimes(1);
    expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({ sessionId: "session-one" });
    expect(request.mock.calls[0][1].keepalive).toBe(true);
  });

  it("cancels a late start response without cancelling the new session", () => {
    const request = vi.fn().mockResolvedValue({});
    const cancel = makeCleanup(request);
    const oldSession = attempt(null);
    cancel(oldSession);
    expect(request).not.toHaveBeenCalled();
    const newSession = attempt("new-session");
    oldSession.sessionId = "late-old-session";
    cancel(oldSession);
    expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({ sessionId: "late-old-session" });
    expect(newSession.active).toBe(true);
    expect(newSession.controller.signal.aborted).toBe(false);
  });

  it("does not cancel a successfully imported session", () => {
    const request = vi.fn();
    const session = { ...attempt("done-session"), done: true };
    makeCleanup(request)(session);
    expect(request).not.toHaveBeenCalled();
    expect(session.controller.signal.aborted).toBe(true);
  });

  it("handles cancellation failures without an unhandled rejection", async () => {
    const request = vi.fn().mockRejectedValue(new Error("offline"));
    expect(() => makeCleanup(request)(attempt("session"))).not.toThrow();
    await Promise.resolve();
  });

  it("routes ChatGPT to the Pi modal and shows Update Pi in both connection states", () => {
    expect(page).toMatch(/providerId === "openai-chatgpt" \? \(\s*<PiAuthModal/);
    expect(page.match(/providerId === "openai-chatgpt" && <PiUpdateButton/g)).toHaveLength(2);
  });

  it("preserves the Pi contract, raw JSON import, and clientId spelling", () => {
    for (const endpoint of ["pi-status", "pi-login", "pi-complete", "pi-cancel", "import-pi"]) {
      expect(modal).toContain(`"${endpoint}"`);
    }
    expect(modal).toContain("pi-poll?session_id=${encodeURIComponent(attempt.sessionId)}");
    expect(modal).toContain("sessionId: attempt.sessionId, callbackUrl: callbackUrl.trim()");
    expect(modal).toContain("authorization: authorization.trim()");
    expect(modal).toContain('"clientId":"..."');
    expect(modal).toContain("Refresh tokens are shared");
    expect(modal).toContain('"starting", "waiting", "completing"');
  });

  it("guards stale responses and uses sequential polling with abortable requests", () => {
    expect(modal).toContain("mountedRef.current && attempt.active && attemptRef.current === attempt");
    expect(modal).toMatch(/attempt.sessionId = data.sessionId;\s*if \(!isCurrent\(attempt\)\) \{\s*cancelAttempt\(attempt\)/);
    expect(modal).toContain("setTimeout(() => poll(attempt), 1500)");
    expect(modal).not.toContain("setInterval");
    expect(modal).toContain("signal: attempt.controller.signal");
    expect(modal).toContain("if (attemptRef.current) cancelAttempt(attemptRef.current)");
  });

  it("masks the callback URL and directs failed starts to manual Update Pi", () => {
    expect(modal).toContain('id="pi-callback-url" type="password"');
    expect(modal).toContain('placeholder="http://127.0.0.1:1455/auth/callback?code=...&state=...&client_id=..."');
    expect(modal).toContain('setCallbackUrl("")');
    expect(modal).toContain("click Update Pi on the provider page");
    expect(modal).not.toContain("console.log");
  });

  it("updates only on explicit button click, not on mount", () => {
    expect(button).toContain('method: "POST"');
    expect(button).toContain("/api/oauth/openai-chatgpt/pi-update");
    expect(button).toContain("onClick={updatePi}");
    expect(button).not.toMatch(/useEffect\([\s\S]*?updatePi\(\)/);
    expect(button).toContain("if (requestRef.current) return");
    expect(button).toContain("!data.installed");
  });
});
