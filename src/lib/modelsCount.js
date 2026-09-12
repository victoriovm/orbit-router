// Model count for the dashboard counter, kept off the live-discovery path.
//
// The count comes from buildModelsList(), which on a cold cache waits on
// /models endpoints of every connected provider (3.5-5s of timeouts each) —
// too slow to paint a counter next to the SQLite-backed ones. So the count is
// persisted next to the database: a restart answers from the last known value,
// and only a first-ever run reads the local tables. The live build then runs in
// the background, so the next load shows the exact number.

import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./dataDir.js";
import { buildModelsList } from "@/app/api/v1/models/route";

const FILE = path.join(DATA_DIR, "models-count.json");
const FRESH_MS = 60_000;

// global: survives Next.js dev hot-reload
if (!global.__modelsCount) global.__modelsCount = { count: null, ts: 0, refreshing: null };
const state = global.__modelsCount;

function readPersisted() {
  try {
    const { count, ts } = JSON.parse(fs.readFileSync(FILE, "utf8"));
    return Number.isFinite(count) ? { count, ts: Number(ts) || 0 } : null;
  } catch {
    return null;
  }
}

function persist(count) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(`${FILE}.tmp`, JSON.stringify({ count, ts: Date.now() }));
    fs.renameSync(`${FILE}.tmp`, FILE);
  } catch {}
}

// Same rule the models page applies: disabled models are not available.
async function countModels(options) {
  const models = await buildModelsList(["llm"], options);
  return models.filter((model) => !model.disabled).length;
}

function refreshInBackground() {
  if (state.refreshing) return;
  state.refreshing = countModels({ includeDisabled: true })
    .then((count) => {
      state.count = count;
      state.ts = Date.now();
      persist(count);
    })
    .catch(() => {})
    .finally(() => { state.refreshing = null; });
}

export async function getModelsCount() {
  if (state.count === null) {
    const persisted = readPersisted();
    if (persisted) {
      state.count = persisted.count;
      state.ts = persisted.ts;
    }
  }

  if (state.count !== null) {
    if (Date.now() - state.ts > FRESH_MS) refreshInBackground();
    return state.count;
  }

  // First run ever: only the local tables answer instantly. Dynamic catalogs
  // (live resolvers, compatible /models) are picked up by the refresh below.
  try {
    state.count = await countModels({ includeDisabled: true, fast: true });
    state.ts = Date.now();
    persist(state.count);
  } catch {
    state.count = 0;
    state.ts = Date.now();
  }
  refreshInBackground();
  return state.count;
}