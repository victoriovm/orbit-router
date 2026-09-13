import { describe, expect, it } from "vitest";

import { openaiResponsesToOpenAIResponse } from "../../open-sse/translator/response/openai-responses.js";

const MUSE = "muse-spark-1.3-contributor-free";

// Upstream terminal events straight from a Responses API backend.
function completed(status, error) {
  return {
    type: "response.completed",
    response: { id: "resp_test", status, ...(error ? { error } : {}) },
  };
}

const museState = () => ({ model: MUSE });
const otherState = () => ({ model: "big-pickle" });

describe("Responses → OpenAI terminal status mapping (Muse Spark)", () => {
  it("maps completed status to a clean stop (regression guard)", () => {
    const out = openaiResponsesToOpenAIResponse(completed("completed"), museState());
    expect(out.choices[0].finish_reason).toBe("stop");
    expect(out.error).toBeUndefined();
  });

  it("maps incomplete status to length instead of a fake clean stop", () => {
    const out = openaiResponsesToOpenAIResponse(completed("incomplete"), museState());
    expect(out.choices[0].finish_reason).toBe("length");
    expect(out.error).toBeUndefined();
  });

  it("surfaces failed status as an error payload, not assistant text", () => {
    const out = openaiResponsesToOpenAIResponse(
      completed("failed", { message: "upstream blew up" }),
      museState()
    );
    expect(out.choices[0].finish_reason).toBe("error");
    expect(out.error?.code).toBe("response_failed");
    expect(out.error?.message).toContain("upstream blew up");
    expect(JSON.stringify(out.choices[0].delta)).not.toContain("[Error]");
  });

  it("maps response.failed events to the same error payload", () => {
    const out = openaiResponsesToOpenAIResponse(
      { type: "response.failed", response: { error: { message: "nope" } } },
      museState()
    );
    expect(out.choices[0].finish_reason).toBe("error");
    expect(out.error?.message).toContain("nope");
  });

  it("emits the error terminal only once for error + response.failed pairs", () => {
    const state = museState();
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

describe("Responses → OpenAI terminal status mapping (other models keep legacy)", () => {
  it("keeps a clean stop for failed status", () => {
    const out = openaiResponsesToOpenAIResponse(
      completed("failed", { message: "upstream blew up" }),
      otherState()
    );
    expect(out.choices[0].finish_reason).toBe("stop");
    expect(out.error).toBeUndefined();
  });

  it("keeps a clean stop for incomplete status", () => {
    const out = openaiResponsesToOpenAIResponse(completed("incomplete"), otherState());
    expect(out.choices[0].finish_reason).toBe("stop");
    expect(out.error).toBeUndefined();
  });

  it("keeps the legacy [Error] assistant text for error events", () => {
    const out = openaiResponsesToOpenAIResponse(
      { type: "response.failed", response: { error: { message: "nope" } } },
      otherState()
    );
    expect(out.choices[0].finish_reason).toBe("stop");
    expect(out.choices[0].delta.content).toBe("[Error] nope");
    expect(out.error).toBeUndefined();
  });
});