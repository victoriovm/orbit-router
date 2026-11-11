// Claude Code 2.1.322 ships host-UI tools "ScheduleWakeup" and "ReportFindings".
// Declared together on the oc free lane, upstream answers 429
// FreeUsageLimitError in ~300ms even though each passes alone (live bisect
// 2026-11-11 against opencode.ai). For DETECTED Claude Code requests both
// names travel under aliases so the pair can never appear on the wire, with
// the caller's names restored in responses — the same class as the /terminal/i
// gate (#5319). Requests from any other client are left verbatim: the gate
// must not touch tools outside the Claude Code detection.
import { describe, it, expect } from "vitest";
import {
  GATED_TOOL_RULES,
  CLAUDE_CODE_GATED_TOOL_RULES,
  isClaudeCodeRequestBody,
  applyFingerprintTools,
  takeRenamedToolNames,
  restoreToolNames,
} from "../../open-sse/utils/opencodeFingerprint.js";

const CLAUDE_SYSTEM = "You are Claude Code, Anthropic's official CLI for Agent.";

const SCHEDULE = {
  type: "function",
  function: {
    name: "ScheduleWakeup",
    description: "Schedule when to resume work in /loop dynamic mode.",
    parameters: { type: "object", properties: { delaySeconds: { type: "integer" } }, required: ["delaySeconds"] },
  },
};
const REPORT = {
  type: "function",
  function: {
    name: "ReportFindings",
    description: "Report code-review findings as a typed list.",
    parameters: { type: "object", properties: { findings: { type: "array" } } },
  },
};
const BASH = {
  type: "function",
  function: {
    name: "Bash",
    description: "Executes a given bash command in a shell.",
    parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"] },
  },
};
const TERMINAL = {
  type: "function",
  function: {
    name: "RunTerminal",
    description: "Runs a terminal command.",
    parameters: { type: "object", properties: { cmd: { type: "string" } }, required: ["cmd"] },
  },
};

describe("Claude Code body detection", () => {
  it("detects the interactive CLI marker in string and block shapes", () => {
    expect(isClaudeCodeRequestBody({ system: CLAUDE_SYSTEM })).toBe(true);
    expect(isClaudeCodeRequestBody({ system: [{ type: "text", text: CLAUDE_SYSTEM }] })).toBe(true);
  });

  it("detects the headless/SDK marker (claude -p system prompt)", () => {
    expect(isClaudeCodeRequestBody({
      system: "You are a Claude agent, built on Anthropic's Claude Agent SDK.",
    })).toBe(true);
  });

  it("detects metadata.user_id markers (classic and 2.1.322 JSON forms)", () => {
    expect(isClaudeCodeRequestBody({ metadata: { user_id: "user_abc_account_x_session_y" } })).toBe(true);
    expect(isClaudeCodeRequestBody({
      metadata: { user_id: '{"device_id":"d","account_uuid":"","session_id":"s"}' },
    })).toBe(true);
  });

  it("does not flag other clients", () => {
    expect(isClaudeCodeRequestBody({ system: "You are a helpful assistant." })).toBe(false);
    expect(isClaudeCodeRequestBody({})).toBe(false);
    expect(isClaudeCodeRequestBody(null)).toBe(false);
  });
});

describe("gated tool names: ScheduleWakeup/ReportFindings pair (Claude Code only)", () => {
  it("declares the pair as Claude-Code-scoped gates and terminal as unconditional", () => {
    expect(GATED_TOOL_RULES.map((r) => r.re.source)).toContain("terminal");
    const sources = CLAUDE_CODE_GATED_TOOL_RULES.map((r) => r.re.source);
    expect(sources).toContain("^ScheduleWakeup$");
    expect(sources).toContain("^ReportFindings$");
  });

  it("aliases both names for a detected Claude Code request", () => {
    const body = { system: CLAUDE_SYSTEM, messages: [], tools: [BASH, SCHEDULE, REPORT] };
    const map = applyFingerprintTools(body, false);
    const names = body.tools.map((t) => t.function?.name || t.name);
    expect(names).toContain("schedule_wakeup");
    expect(names).toContain("report_findings");
    expect(names).not.toContain("ScheduleWakeup");
    expect(names).not.toContain("ReportFindings");
    expect(map.get("schedule_wakeup")).toBe("ScheduleWakeup");
    expect(map.get("report_findings")).toBe("ReportFindings");
    // definitions and descriptions survive the rename
    const sw = body.tools.find((t) => (t.function?.name || t.name) === "schedule_wakeup");
    expect(sw.function.description).toContain("/loop dynamic mode");
  });

  it("leaves a NON-Claude-Code request's tool names verbatim", () => {
    const body = { system: "You are a helpful assistant.", messages: [], tools: [BASH, SCHEDULE, REPORT] };
    applyFingerprintTools(body, false);
    const names = body.tools.map((t) => t.function?.name || t.name);
    expect(names).toContain("ScheduleWakeup");
    expect(names).toContain("ReportFindings");
    expect(names).not.toContain("schedule_wakeup");
    expect(names).not.toContain("report_findings");
  });

  it("aliases the terminal rule regardless of client", () => {
    for (const system of [CLAUDE_SYSTEM, "You are a helpful assistant."]) {
      const body = { system, messages: [], tools: [TERMINAL] };
      const map = applyFingerprintTools(body, false);
      const names = body.tools.map((t) => t.function?.name || t.name);
      expect(names).toContain("run_command");
      expect(map.get("run_command")).toBe("RunTerminal");
    }
  });

  it("suffixes aliases on collision instead of dropping tools", () => {
    const secondTerminal = { ...TERMINAL, function: { ...TERMINAL.function, name: "OtherTerminal" } };
    const body = { system: CLAUDE_SYSTEM, messages: [], tools: [TERMINAL, secondTerminal] };
    applyFingerprintTools(body, false);
    const names = body.tools.map((t) => t.function?.name || t.name);
    expect(names.filter((n) => n.startsWith("run_command"))).toHaveLength(2);
  });

  it("restores caller names from response payloads", () => {
    const body = { system: CLAUDE_SYSTEM, messages: [], tools: [SCHEDULE, REPORT] };
    applyFingerprintTools(body, false);
    const stored = takeRenamedToolNames(body);
    expect(stored).toBeTruthy();

    const chunk = {
      choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", type: "function", function: { name: "schedule_wakeup", arguments: "{}" } }] } }],
    };
    const restored = restoreToolNames(chunk, stored);
    expect(restored.choices[0].delta.tool_calls[0].function.name).toBe("ScheduleWakeup");
  });
});
