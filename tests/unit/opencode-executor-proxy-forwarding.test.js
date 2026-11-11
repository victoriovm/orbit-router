// The executor must forward the proxy URL it is handed by proxyAwareFetch.
// Isolated from the transport tests: mocking opencodeTlsClient.js here would
// otherwise replace the real module under test in sibling suites.
import { describe, it, expect, vi } from "vitest";

const { tlsFetchMock } = vi.hoisted(() => ({ tlsFetchMock: vi.fn() }));

vi.mock("../../open-sse/services/opencodeTlsClient.js", () => ({
  opencodeTlsFetch: tlsFetchMock,
  OpencodeTlsUnavailableError: class extends Error {},
}));

describe("opencode executor forwards the resolved proxy", () => {
  it("passes the proxy URL through to opencodeTlsFetch", async () => {
    tlsFetchMock.mockReset().mockResolvedValue(new Response("ok", { status: 200 }));

    const { OpenCodeExecutor } = await import("../../open-sse/executors/opencode.js");
    const exec = new OpenCodeExecutor();

    try {
      await exec.execute({
        model: "oc/gpt-oss-120b",
        body: { messages: [{ role: "user", content: "hi" }] },
        stream: true,
        credentials: {},
        proxyOptions: { connectionProxyEnabled: true, connectionProxyUrl: "socks5://127.0.0.1:9050" },
      });
    } catch {
      // execute() talks to the real network upstream; the wiring assertion is
      // on the adapter call below, not on its outcome.
    }

    expect(tlsFetchMock).toHaveBeenCalled();
    const proxiedCall = tlsFetchMock.mock.calls.find((call) => call[2]?.proxyUrl === "socks5://127.0.0.1:9050");
    expect(proxiedCall).toBeTruthy();
  });
});
