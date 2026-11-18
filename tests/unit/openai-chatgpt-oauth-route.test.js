import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ generate: vi.fn(), create: vi.fn(), status: vi.fn(), update: vi.fn(), start: vi.fn(), poll: vi.fn(), complete: vi.fn(), cancel: vi.fn(), active: vi.fn() }));
vi.mock("@/lib/oauth/providers", () => ({ generateAuthData: mocks.generate, getProvider: vi.fn(), exchangeTokens: vi.fn(), requestDeviceCode: vi.fn(), pollForToken: vi.fn() }));
vi.mock("@/lib/oauth/piRuntime", () => ({ getPiStatus: mocks.status, updatePi: mocks.update }));
vi.mock("@/lib/oauth/piSession", () => ({ createPiSessionManager: () => ({ start: mocks.start, poll: mocks.poll, complete: mocks.complete, cancel: mocks.cancel, isActive: mocks.active }) }));
vi.mock("@/models", () => ({ createProviderConnection: mocks.create }));
vi.mock("@/lib/localDb", () => ({ getProviderConnections: vi.fn() }));
vi.mock("next/server", () => ({ NextResponse: { json: (body, init = {}) => new Response(JSON.stringify(body), { status: init.status || 200 }) } }));
const { GET, POST } = await import("../../src/app/api/oauth/[provider]/[action]/route.js");
const params = action => ({ params: Promise.resolve({ provider: "openai-chatgpt", action }) });
const post = (action, body) => POST(new Request(`http://localhost/api/oauth/openai-chatgpt/${action}`, { method: "POST", ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), params(action));
const get = action => GET(new Request(`http://localhost/api/oauth/openai-chatgpt/${action}`), params(action.split("?")[0]));
describe("managed Pi OAuth routes", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.status.mockResolvedValue({ installed: true, version: "1.5.2", updating: false }); mocks.active.mockReturnValue(false); });
  it("imports Pi JSON with clientId name without returning tokens", async () => {
    const credential = { type: "oauth", access: "secret-access", refresh: "secret-refresh", clientId: "issued", expires: 1800000000000, scopes: ["chatgpt.tokens.use.direct"] };
    mocks.create.mockResolvedValue({ id: "imported", provider: "openai-chatgpt" });
    const response = await post("import-pi", { authorization: { openai: credential } });
    expect(await response.json()).toEqual({ success: true, connection: { id: "imported", provider: "openai-chatgpt" } });
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ name: "issued", accessToken: "secret-access" }));
  });
  it("rejects malformed and null import payloads", async () => {
    for (const body of [null, { authorization: "not-json-secret" }]) {
      const response = await post("import-pi", body); expect(response.status).toBe(400); expect(await response.text()).not.toContain("not-json-secret");
    }
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("exposes installed status and empty-body latest update", async () => {
    expect(await (await get("pi-status")).json()).toEqual({ installed: true, version: "1.5.2", updating: false });
    mocks.update.mockResolvedValue({ installed: true, version: "1.5.2" });
    expect(await (await post("pi-update")).json()).toEqual({ installed: true, version: "1.5.2" });
  });
  it("starts login, polls session_id, forwards callback and cancellation", async () => {
    mocks.start.mockReturnValue({ sessionId: "s", status: "starting" });
    expect(await (await post("pi-login")).json()).toEqual({ sessionId: "s", status: "starting" });
    mocks.poll.mockReturnValue({ sessionId: "s", status: "waiting" }); await get("pi-poll?session_id=s"); expect(mocks.poll).toHaveBeenCalledWith("s");
    mocks.complete.mockReturnValue({ status: "completing" }); await post("pi-complete", { sessionId: "s", callbackUrl: "callback" }); expect(mocks.complete).toHaveBeenCalledWith("s", "callback");
    mocks.cancel.mockResolvedValue({ status: "error" }); await post("pi-cancel", { sessionId: "s" }); expect(mocks.cancel).toHaveBeenCalledWith("s");
  });
  it("rejects update during active login and login during update or absent install", async () => {
    mocks.active.mockReturnValue(true); expect((await post("pi-update")).status).toBe(409); expect(mocks.update).not.toHaveBeenCalled();
    mocks.status.mockResolvedValue({ installed: true, updating: true }); expect((await post("pi-login")).status).toBe(409);
    mocks.status.mockResolvedValue({ installed: false }); expect((await post("pi-login")).status).toBe(409); expect(mocks.start).not.toHaveBeenCalled();
  });
  it("rejects removed custom authorize/exchange login flows", async () => {
    expect((await get("authorize")).status).toBe(400);
    expect((await post("exchange", { code: "eyJ.fake.token" })).status).toBe(400);
    expect(mocks.generate).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled();
  });
});
