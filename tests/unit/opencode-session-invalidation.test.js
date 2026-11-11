// Free-tier quota is accounted per x-opencode-session id. The executor pins one
// canonical (and one translated) id per identity and reuses it — mirroring the
// real CLI — but once upstream flags that id, every later request answers 429
// FreeUsageLimitError in ~300ms until restart (#5559). resetOpencodeSessionCaches
// must drop both caches so the next request mints fresh ids.
import { describe, it, expect } from "vitest";
import {
  stableSessionId,
  translateSessionId,
  resetOpencodeSessionCaches,
} from "../../open-sse/executors/opencode.js";

const credentials = { connectionId: "conn-test-5559" };

describe("opencode session cache invalidation (#5559)", () => {
  it("re-mints the stable canonical session after invalidation", () => {
    const first = stableSessionId(credentials);
    // Reuse before invalidation keeps the same id (that is the point of the pin).
    expect(stableSessionId(credentials)).toBe(first);

    resetOpencodeSessionCaches({ credentials });

    const second = stableSessionId(credentials);
    expect(second).not.toBe(first);
  });

  it("re-mints the translated session for a hinted id + client tool", () => {
    const hint = "client-session-5559";
    const tool = "claude";
    const first = translateSessionId(hint, tool);

    resetOpencodeSessionCaches({ credentials: {}, providerSessionId: hint, clientTool: tool });

    const second = translateSessionId(hint, tool);
    expect(second).not.toBe(first);
  });

  it("leaves an untouched identity's stable session alone", () => {
    const other = { connectionId: "conn-test-5559-other" };
    const before = stableSessionId(other);
    resetOpencodeSessionCaches({ credentials }); // different identity key
    expect(stableSessionId(other)).toBe(before);
  });

  it("fails open on surprising shapes", () => {
    expect(() => resetOpencodeSessionCaches({ credentials: { rawHeaders: null } })).not.toThrow();
    expect(() => resetOpencodeSessionCaches(null)).not.toThrow();
    expect(() => resetOpencodeSessionCaches()).not.toThrow();
  });
});
