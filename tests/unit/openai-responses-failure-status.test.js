import { describe, expect, it } from "vitest";

import { openaiResponsesToOpenAIResponse } from "../../open-sse/translator/response/openai-responses.js";

// Upstream terminal events straight from a Responses API backend.
function completed(status, error) {
  return {
    type: "response.completed",
    response: { id: "resp_test", status, ...(error ? { error } : {}) },
  };
}

describe("Responses → OpenAI terminal status mapping", () => {
  it("maps completed status to a clean stop (regression guard)", () => {
    const out = openaiResponsesToOpenAIResponse(completed("completed"), {});
    expect(out.choices[0].finish_reason).toBe("stop");
    expect(out.error).toBeUndefined();
  });

  it("maps incomplete status to length instead of a fake clean stop", () => {
    const out = openaiResponsesToOpenAIResponse(completed("incomplete"), {});
    expect(out.choices[0].finish_reason).toBe("length");
    expect(out.error).toBeUndefined();
  });

  it("surfaces failed status as an error payload, not assistant text", () => {
    const out = openaiResponsesToOpenAIResponse(
      completed("failed", { message: "upstream blew up" }),
      {}
    );
    expect(out.choices[0].finish_reason).toBe("error");
    expect(out.error?.code).toBe("response_failed");
    expect(out.error?.message).toContain("upstream blew up");
    expect(JSON.stringify(out.choices[0].delta)).not.toContain("[Error]");
  });

  it("maps response.failed events to the same error payload", () => {
    const out = openaiResponsesToOpenAIResponse(
      { type: "response.failed", response: { error: { message: "nope" } } },
      {}
    );
    expect(out.choices[0].finish_reason).toBe("error");
    expect(out.error?.message).toContain("nope");
  });

  it("emits the error terminal only once for error + response.failed pairs", () => {
    const state = {};
    const first = openaiResponsesToOpenAIResponse(
      { type: "error", error: { message: "boom" } },
      state
    );
    expect(first?.error).toBeDefined();
    const second = openaiResponsesToOpenAIResponse(
      { type: "response.failed", response: { error: { message: "boom" } } },
      state
    );
    expect(second).toBeNull();
  });
});
