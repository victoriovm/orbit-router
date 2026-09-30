import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { calculateTokensPerSecond, calculateStreamTokensPerSecond } from "../../src/lib/db/repos/usageRepo.js";

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

describe("calculateStreamTokensPerSecond", () => {
  it("excludes the first delta from the numerator", () => {
    // 150 tokens total, first delta 3 of 150 chars, 2s between first and last
    // content. Old formula counted all 150 → 75 tok/s. Honest number: 147/2.
    expect(calculateStreamTokensPerSecond(150, 2000, 10, 3, 150)).toBe(73.5);
  });

  it("derives the first delta from the provider's real token count", () => {
    // Chars are a different scale than tokens; the ratio is applied to the real
    // outputTokens so the numerator never mixes scales.
    // 20 of 400 chars in the first chunk = 5% → 1000 * 0.95 = 950 tokens in 1s.
    expect(calculateStreamTokensPerSecond(1000, 1000, 5, 20, 400)).toBe(950);
  });

  it("rejects buffered streams where the first chunk carries half the answer", () => {
    // 280 of 300 chars arrived in the first chunk, 20ms apart. Time spent
    // generating those was never observed.
    expect(calculateStreamTokensPerSecond(300, 20, 2, 280, 300)).toBeUndefined();
  });

  it("rejects a first chunk at exactly the buffering threshold", () => {
    expect(calculateStreamTokensPerSecond(100, 1000, 2, 50, 100)).toBeUndefined();
  });

  it("accepts a first chunk just under the threshold", () => {
    expect(calculateStreamTokensPerSecond(100, 1000, 2, 49, 100)).toBe(51);
  });

  it("rejects single-delta streams", () => {
    expect(calculateStreamTokensPerSecond(100, 5000, 1, 10, 100)).toBeUndefined();
  });

  it("rejects a zero-length generation window instead of inventing one second", () => {
    // Two deltas in the same tick leave no measurable window. The old code
    // substituted 1000ms here, fabricating a number.
    expect(calculateStreamTokensPerSecond(10, 0, 2, 2, 10)).toBeUndefined();
  });

  it.each([
    [100, 1000, 2, 0, 0],       // no chars observed → no ratio to trust
    [100, 1000, 2, 0, undefined],
    [100, 1000, 2, undefined, 100],
    [0, 1000, 2, 10, 100],      // no tokens to divide
    [-1, 1000, 2, 10, 100],
    [100, -1, 2, 10, 100],
    [100, undefined, 2, 10, 100],
    [100, 1000, 0, 10, 100],
    [100, 1000, 1.5, 10, 100],
    [100, 1000, undefined, 10, 100],
    [100, 1000, 2, -1, 100],
  ])("rejects invalid inputs", (tokens, generationMs, deltas, firstChars, totalChars) => {
    expect(calculateStreamTokensPerSecond(tokens, generationMs, deltas, firstChars, totalChars)).toBeUndefined();
  });
});

describe("calculateTokensPerSecond (row-level dispatch)", () => {
  it("uses the streaming path when contentDeltaCount is present", () => {
    expect(calculateTokensPerSecond(150, { generationMs: 2000, contentDeltaCount: 10, firstDeltaChars: 3, totalOutputChars: 150 })).toBe(73.5);
  });

  it("hides legacy streaming rows timed with the old formula", () => {
    // Pre-migration rows carry generationMs but no delta count: they cannot
    // distinguish a slow provider from a buffering one.
    expect(calculateTokensPerSecond(150, { generationMs: 2000 })).toBeUndefined();
  });

  it("hides streaming rows that lack character counts", () => {
    expect(calculateTokensPerSecond(150, { generationMs: 2000, contentDeltaCount: 10 })).toBeUndefined();
  });

  it("falls back to end-to-end throughput for non-streaming rows", () => {
    expect(calculateTokensPerSecond(15, { latencyMs: 3000 })).toBe(5);
  });

  it.each([
    [0, { latencyMs: 1000 }],
    [-1, { latencyMs: 1000 }],
    [1, { latencyMs: -1 }],
    [1, {}],
    [Number.NaN, { latencyMs: 1000 }],
  ])("rejects invalid non-streaming inputs", (tokens, meta) => {
    expect(calculateTokensPerSecond(tokens, meta)).toBeUndefined();
  });
});

describe("usage throughput persistence", () => {
  it("prefers generation time over total request latency for streams", async () => {
    await db.saveRequestUsage({
      timestamp: "2026-09-07T12:00:00.000Z",
      provider: "openai",
      model: "gpt-throughput-generation",
      tokens: { prompt_tokens: 10, completion_tokens: 150 },
      latencyMs: 10000,
      generationMs: 2000,
      contentDeltaCount: 10,
      firstDeltaChars: 3,
      totalOutputChars: 150,
      status: "ok",
    });

    const stats = await db.getUsageStats("all");
    const request = stats.recentRequests.find((item) => item.model === "gpt-throughput-generation");
    expect(request?.tokensPerSecond).toBe(73.5);
  });

  it("does not show tok/s for buffered streams", async () => {
    await db.saveRequestUsage({
      timestamp: "2026-09-07T12:02:00.000Z",
      provider: "openai",
      model: "gpt-throughput-buffered",
      tokens: { prompt_tokens: 10, completion_tokens: 300 },
      latencyMs: 5000,
      generationMs: 20,
      contentDeltaCount: 2,
      firstDeltaChars: 280,
      totalOutputChars: 300,
      status: "ok",
    });

    const stats = await db.getUsageStats("all");
    const request = stats.recentRequests.find((item) => item.model === "gpt-throughput-buffered");
    expect(request?.tokensPerSecond).toBeUndefined();
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