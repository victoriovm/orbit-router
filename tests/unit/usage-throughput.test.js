import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { calculateTokensPerSecond } from "../../src/lib/db/repos/usageRepo.js";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-throughput-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  await db.initDb();
});

afterAll(() => {
  // The native SQLite adapter remains open in the shared DB singleton on Windows.
  // Restore process configuration; the OS cleans the isolated temp directory.
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("calculateTokensPerSecond", () => {
  it.each([
    [3, 1000, undefined, 3],
    [5, 2000, undefined, 2.5],
    [2, 1, undefined, 2000],
    [2, 0, undefined, 2],
    [10, undefined, 2000, 5],
  ])("calculates output throughput for %s tokens", (tokens, generationMs, latencyMs, expected) => {
    expect(calculateTokensPerSecond(tokens, generationMs, latencyMs)).toBe(expected);
  });

  it.each([
    [0, 1000, undefined],
    [-1, 1000, undefined],
    [1, -1, undefined],
    [1, undefined, undefined],
    [Number.NaN, 1000, undefined],
  ])("rejects invalid inputs", (tokens, generationMs, latencyMs) => {
    expect(calculateTokensPerSecond(tokens, generationMs, latencyMs)).toBeUndefined();
  });
});

describe("usage throughput persistence", () => {
  it("prefers generation time over total request latency", async () => {
    await db.saveRequestUsage({
      timestamp: "2026-09-07T12:00:00.000Z",
      provider: "openai",
      model: "gpt-throughput-generation",
      tokens: { prompt_tokens: 10, completion_tokens: 20 },
      latencyMs: 10000,
      generationMs: 2000,
      status: "ok",
    });

    const stats = await db.getUsageStats("all");
    const request = stats.recentRequests.find((item) => item.model === "gpt-throughput-generation");
    expect(request?.tokensPerSecond).toBe(10);
  });

  it("falls back to total latency for non-streaming and legacy rows", async () => {
    await db.saveRequestUsage({
      timestamp: "2026-09-07T12:01:00.000Z",
      provider: "openai",
      model: "gpt-throughput-latency",
      tokens: { prompt_tokens: 10, completion_tokens: 15 },
      latencyMs: 3000,
      status: "ok",
    });

    const stats = await db.getUsageStats("all");
    const request = stats.recentRequests.find((item) => item.model === "gpt-throughput-latency");
    expect(request?.tokensPerSecond).toBe(5);
  });
});
