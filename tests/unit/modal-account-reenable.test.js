// An auto-disabled Modal account must come back clean: re-enabling it in the
// dashboard is a fresh start, otherwise the leftover strikes would disable it
// again on the very next error.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const MODEL = "deepseek-ai/DeepSeek-V4.1-Flash";
const originalDataDir = process.env.DATA_DIR;
let tempDir;
let repo;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-modal-reenable-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  const { initDb } = await import("@/lib/db/index.js");
  await initDb();
  repo = await import("@/lib/db/repos/connectionsRepo.js");
});

afterAll(async () => {
  try {
    const { getAdapterSync } = await import("@/lib/db/driver.js");
    getAdapterSync().close?.();
  } catch { /* adapter already closed */ }
  await new Promise((resolve) => setTimeout(resolve, 100));
  if (tempDir) {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch { /* best effort */ }
  }
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("modal account re-enable", () => {
  it("clears locks, strikes and error state when the connection is re-enabled", async () => {
    const created = await repo.createProviderConnection({
      provider: "modal",
      authType: "apikey",
      name: "conta-um",
      apiKey: "sk-test",
      providerSpecificData: { baseUrls: ["https://conta-um-deepseek.modal.run/v1"] },
    });

    await repo.updateProviderConnection(created.id, {
      testStatus: "unavailable",
      isActive: false,
      failureStrikes: 3,
      [`modelLock_${MODEL}`]: new Date(Date.now() + 60_000).toISOString(),
      lastError: "Disabled after 3 failures in a row — last: endpoint down",
    });

    let conn = await repo.getProviderConnectionById(created.id);
    expect(conn.isActive).toBe(false);
    expect(conn.failureStrikes).toBe(3);

    await repo.updateProviderConnection(created.id, { isActive: true });

    conn = await repo.getProviderConnectionById(created.id);
    expect(conn.isActive).toBe(true);
    expect(conn.failureStrikes).toBe(0);
    expect(conn.testStatus).toBe("active");
    expect(conn.lastError).toBeNull();
    expect(conn[`modelLock_${MODEL}`]).toBeNull();
  });
});