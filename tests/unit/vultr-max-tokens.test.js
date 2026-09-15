/**
 * Vultr Inference rejects chat requests that carry no output cap, so the
 * provider opts in via transport.quirks.requireMaxTokens and the executor fills
 * max_tokens with the model's own ceiling when the client sent none.
 */

import { describe, it, expect } from "vitest";

import { DefaultExecutor } from "../../open-sse/executors/default.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { PROVIDERS } from "../../open-sse/providers/index.js";
import vultr from "../../open-sse/providers/registry/vultr.js";

const executor = new DefaultExecutor("vultr");
const MODEL = "vultr/glm-5.3-flash";

function request(body = {}) {
  return executor.transformRequest(MODEL, { model: MODEL, messages: [{ role: "user", content: "hi" }], ...body });
}

describe("vultr — max_tokens is always sent", () => {
  it("declares the requireMaxTokens quirk in the registry and in PROVIDERS", () => {
    expect(vultr.transport.quirks).toEqual({ requireMaxTokens: true });
    expect(PROVIDERS.vultr.quirks.requireMaxTokens).toBe(true);
  });

  it("injects the model's ceiling when the client sent no cap", () => {
    const out = request();
    const ceiling = getCapabilitiesForModel("vultr", MODEL).maxOutput;

    expect(ceiling).toBeGreaterThan(0);
    expect(out.max_tokens).toBe(ceiling);
  });

  it("resolves the ceiling per model, not a fixed constant", () => {
    const small = request().max_tokens;
    const large = executor.transformRequest("vultr/deepseek-v4.1-flash", {
      model: "vultr/deepseek-v4.1-flash",
      messages: [],
    }).max_tokens;

    expect(large).toBe(getCapabilitiesForModel("vultr", "vultr/deepseek-v4.1-flash").maxOutput);
    expect(large).not.toBe(small);
  });

  it("keeps an explicit max_tokens instead of overwriting it", () => {
    expect(request({ max_tokens: 512 }).max_tokens).toBe(512);
  });

  it("honors max_completion_tokens as the client's cap", () => {
    const out = request({ max_completion_tokens: 777 });

    expect(out.max_tokens).toBe(777);
    expect(out.max_completion_tokens).toBe(777);
  });

  it("ignores a non-numeric cap and falls back to the ceiling", () => {
    const out = request({ max_tokens: null, max_completion_tokens: "lots" });

    expect(out.max_tokens).toBe(getCapabilitiesForModel("vultr", MODEL).maxOutput);
  });

  it("leaves providers without the quirk untouched", () => {
    const novita = new DefaultExecutor("novita");
    const out = novita.transformRequest("novita/example-model", { model: "novita/example-model", messages: [] });

    expect(out.max_tokens).toBeUndefined();
  });
});