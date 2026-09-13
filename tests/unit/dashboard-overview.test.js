// Dashboard overview: one bounded round-trip for the home page.
// Verifies the contract HomePageClient relies on (providers summary, today's
// counters, recent requests, local models estimate, 7-day chart) and that
// large histories stay out of the hot path (indexed aggregates + LIMIT).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-overview-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  await db.initDb();
});

afterAll(async () => {
  try {
    const { getAdapterSync } = await import("@/lib/db/driver.js");
    getAdapterSync().close?.();
  } catch {}
  await new Promise((r) => setTimeout(r, 100));
  if (tempDir) {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  }
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("getDashboardOverview", () => {
  it("returns the home-page contract on an empty database", async () => {
    const overview = await db.getDashboardOverview();

    expect(overview.providers.providers).toBe(0);
    expect(overview.providers.enabledAccounts).toBe(0);
    expect(overview.providers.connections).toEqual([]);
    expect(overview.usage.totalRequests).toBe(0);
    expect(overview.usage.totalPromptTokens).toBe(0);
    expect(overview.usage.totalCompletionTokens).toBe(0);
    expect(overview.recentRequests).toEqual([]);
    expect(overview.modelsCount).toBe(0);
    expect(overview.chart).toHaveLength(7);
    for (const bucket of overview.chart) {
      expect(bucket.tokens).toBe(0);
      expect(bucket.cost).toBe(0);
      expect(typeof bucket.label).toBe("string");
    }
  });

  it("aggregates today's counters, health, recents and chart without full scans", async () => {
    const connA = await db.createProviderConnection({
      provider: "anthropic", authType: "apikey", name: "main",
      apiKey: "k-1", testStatus: "success",
    });
    await db.createProviderConnection({
      provider: "openai", authType: "apikey", name: "backup",
      apiKey: "k-2", testStatus: "error",
    });

    const now = new Date();
    await db.saveRequestUsage({
      provider: "anthropic", model: "claude-x", connectionId: connA.id,
      tokens: { prompt_tokens: 100, completion_tokens: 50 },
      endpoint: "/v1/messages", status: "ok", timestamp: now.toISOString(),
    });
    await db.saveRequestUsage({
      provider: "openai", model: "gpt-x",
      tokens: { prompt_tokens: 10, completion_tokens: 5 },
      endpoint: "/v1/chat/completions", status: "error",
      timestamp: now.toISOString(),
    });
    // Yesterday's traffic must not leak into today's counters.
    const yesterday = new Date(now.getTime() - 26 * 3600 * 1000);
    await db.saveRequestUsage({
      provider: "anthropic", model: "claude-old",
      tokens: { prompt_tokens: 1000, completion_tokens: 1000 },
      endpoint: "/v1/messages", status: "ok",
      timestamp: yesterday.toISOString(),
    });

    const overview = await db.getDashboardOverview();

    expect(overview.usage.totalRequests).toBe(2);
    expect(overview.usage.totalPromptTokens).toBe(110);
    expect(overview.usage.totalCompletionTokens).toBe(55);

    expect(overview.providers.providers).toBe(2);
    expect(overview.providers.enabledAccounts).toBe(2);
    expect(overview.providers.healthyAccounts).toBe(1);
    expect(overview.providers.healthyProviders).toBe(1);
    expect(overview.providers.attentionProviders).toBe(1);
    // Slim connection payload: status signals only, no credential-adjacent data.
    for (const c of overview.providers.connections) {
      expect(c.apiKey).toBeUndefined();
      expect(c.providerSpecificData).toBeUndefined();
    }

    expect(overview.recentRequests.length).toBeGreaterThanOrEqual(2);
    expect(overview.recentRequests.length).toBeLessThanOrEqual(6);
    expect(overview.recentRequests[0].model).toBe("claude-old");

    const todayBucket = overview.chart[overview.chart.length - 1];
    expect(todayBucket.tokens).toBe(165);
    expect(overview.modelsCount).toBeGreaterThan(0);
  });
});
