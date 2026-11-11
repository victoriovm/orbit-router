// Claude Code 2.1.322 ships host-UI tools "ScheduleWakeup" and "ReportFindings".
// Declared together on the oc free lane, upstream answers 429
// FreeUsageLimitError in ~300ms even though each passes alone (live bisect
// 2026-11-11 against opencode.ai). Both names must travel under aliases so the
// pair can never appear on the wire, with the caller's names restored in
// responses — the same class as the /terminal/i gate (#5319).
import { describe, it, expect } from "vitest";
import {
  GATED_TOOL_RULES,
  applyFingerprintTools,
  takeRenamedToolNames,
  restoreToolNames,
} from "../../open-sse/utils/opencodeFingerprint.js";

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

describe("gated tool names: ScheduleWakeup/ReportFindings pair (#free-lane)", () => {
  it("declares the two Claude Code host-UI names as gates", () => {
    const rules = GATED_TOOL_RULES.map((r) => r.re.source);
    expect(rules).toContain("^ScheduleWakeup$");
    expect(rules).toContain("^ReportFindings$");
    expect(rules).toContain("terminal");
  });

  it("aliases both names so the pair never reaches the wire together", () => {
    const body = { messages: [], tools: [BASH, SCHEDULE, REPORT] };
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

  it("aliases the terminal rule exactly as before", () => {
    const body = { messages: [], tools: [TERMINAL] };
    const map = applyFingerprintTools(body, false);
    const names = body.tools.map((t) => t.function?.name || t.name);
    expect(names).toContain("run_command");
    expect(map.get("run_command")).toBe("RunTerminal");
  });

  it("suffixes aliases on collision instead of dropping tools", () => {
    const secondTerminal = { ...TERMINAL, function: { ...TERMINAL.function, name: "OtherTerminal" } };
    const body = { messages: [], tools: [TERMINAL, secondTerminal] };
    applyFingerprintTools(body, false);
    const names = body.tools.map((t) => t.function?.name || t.name);
    expect(names.filter((n) => n.startsWith("run_command"))).toHaveLength(2);
  });

  it("restores caller names from response payloads", () => {
    const body = { messages: [], tools: [SCHEDULE, REPORT] };
    const map = applyFingerprintTools(body, false);
    const stored = takeRenamedToolNames(body);
    expect(stored).toBeTruthy();

    const chunk = {
      choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", type: "function", function: { name: "schedule_wakeup", arguments: "{}" } }] } }],
    };
    const restored = restoreToolNames(chunk, stored);
    expect(restored.choices[0].delta.tool_calls[0].function.name).toBe("ScheduleWakeup");
  });
});
