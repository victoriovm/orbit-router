// LIVE end-to-end proof (opt-in): replay the REAL intercepted Claude Code
// request (56KB, 12 tools incl. the ScheduleWakeup+ReportFindings pair) through
// the full local pipeline — translateRequest(claude→openai) → executor
// transformRequest (fingerprint + gated-name aliases) → wreq-js → opencode.ai.
//
// Before the gated-name fix this exact body answered 429 FreeUsageLimitError
// in ~400ms (reproduced via router.servhub.xyz and directly). After it, the
// pair travels as schedule_wakeup/report_findings and the request must pass.
// Runs only with OPENCODE_LIVE_GATE_TEST=1 (one free-tier request).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";

const runs = process.env.OPENCODE_LIVE_GATE_TEST === "1";
const REAL_REQUEST_PATH = "/tmp/opencode/real-claude-request.json";

describe.skipIf(!runs)("live replay of the real Claude Code request (opt-in)", { timeout: 120000 }, () => {
  it("passes the gates with the gated names aliased", async () => {
    const { translateRequest, initState, translateResponse } = await import("../../open-sse/translator/index.js");
    const { FORMATS } = await import("../../open-sse/translator/formats.js");
    const { OpenCodeExecutor } = await import("../../open-sse/executors/opencode.js");

    const realBody = JSON.parse(readFileSync(REAL_REQUEST_PATH, "utf8"));
    const model = String(realBody.model || "").replace(/^oc\//, "");
    const translated = translateRequest(
      FORMATS.CLAUDE, FORMATS.OPENAI, model, realBody,
      true, {}, "opencode", null, [], "live-replay", "claude"
    );

    const executor = new OpenCodeExecutor();
    const result = await executor.execute({
      model,
      body: translated,
      stream: true,
      credentials: {},
      providerSessionId: "live-replay-session-0001",
      clientTool: "claude",
      signal: AbortSignal.timeout(90000),
      log: null,
      proxyOptions: null,
    });

    const { response, url, transformedBody } = result;
    const names = (transformedBody?.tools || []).map((t) => t.function?.name || t.name);
    expect(url).toContain("/inference/v1/chat/completions");
    expect(names).toContain("schedule_wakeup");
    expect(names).toContain("report_findings");
    expect(names).not.toContain("ScheduleWakeup");
    expect(names).not.toContain("ReportFindings");

    if (response.status !== 200) {
      const text = await response.text().catch(() => "");
      throw new Error(`upstream ${response.status}: ${text.slice(0, 400)}`);
    }
    expect(response.status).toBe(200);

    // Consume some of the stream and prove real model output arrives.
    const state = initState(FORMATS.OPENAI);
    let textOut = "";
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      for (const line of decoder.decode(value, { stream: true }).split("\n")) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          for (const item of translateResponse(FORMATS.OPENAI, FORMATS.OPENAI, JSON.parse(payload), state) || []) {
            const delta = item?.choices?.[0]?.delta;
            if (typeof delta?.content === "string") textOut += delta.content;
          }
        } catch { /* keepalive */ }
      }
      if (textOut.length > 30) break;
    }
    expect(textOut.length).toBeGreaterThan(0);
  });
});
