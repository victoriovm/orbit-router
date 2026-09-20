// Hourly pull of the full models.dev catalog (catalog.json).
//
// The file is stored verbatim so the sync that maps it onto the router's model
// data can read it later; this module only pulls it and records when it last
// did. Failures are swallowed on purpose: a failed pull leaves the previous
// file in place and the timer retries later.

import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "@/lib/dataDir.js";

export const CATALOG_URL = "https://models.dev/catalog.json";
export const CATALOG_PULL_FILE = path.join(DATA_DIR, "models-dev-catalog.json");
// Sidecar so status reads never parse the ~5MB catalog.
export const CATALOG_PULL_META_FILE = path.join(DATA_DIR, "models-dev-catalog.meta.json");
export const PULL_INTERVAL_MS = 60 * 60 * 1000;
const STARTUP_DELAY_MS = 60 * 1000;   // let the server boot and serve first requests
const RETRY_DELAY_MS = 10 * 60 * 1000;
const FETCH_TIMEOUT_MS = 120000;      // ~5MB; slow links need the headroom

const META_VERSION = 1;

let state = { running: false, lastPullAt: null, lastError: null, lastResult: null, etag: null };
let timer = null;

function writeAtomic(file, contents) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, contents, "utf8");
  fs.renameSync(`${file}.tmp`, file);
}

function readMeta() {
  try {
    return JSON.parse(fs.readFileSync(CATALOG_PULL_META_FILE, "utf8"));
  } catch {
    return null;
  }
}

export function getCatalogPullState() {
  return { ...state, file: CATALOG_PULL_FILE, url: CATALOG_URL, intervalMs: PULL_INTERVAL_MS, meta: readMeta() };
}

// Run one pull. Returns a summary, or null when it could not complete.
export async function pullModelCatalog() {
  if (state.running) return null;
  state.running = true;
  try {
    const headers = { accept: "application/json" };
    if (state.etag) headers["if-none-match"] = state.etag;
    const response = await fetch(CATALOG_URL, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });

    const previous = readMeta() || {};
    let result;
    let meta;
    if (response.status === 304) {
      result = { status: "unchanged" };
      meta = { ...previous, url: CATALOG_URL, pulledAt: Date.now() };
    } else if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    } else {
      const catalog = await response.json();
      if (!catalog || typeof catalog.models !== "object" || catalog.models === null) {
        throw new Error("unexpected payload");
      }
      const serialized = JSON.stringify(catalog);
      const etag = response.headers.get("etag") || null;

      writeAtomic(CATALOG_PULL_FILE, serialized);
      state.etag = etag;
      meta = {
        v: META_VERSION,
        url: CATALOG_URL,
        etag,
        pulledAt: Date.now(),
        models: Object.keys(catalog.models).length,
        providers: Object.keys(catalog.providers || {}).length,
        bytes: Buffer.byteLength(serialized),
      };
      result = {
        status: "updated",
        etag,
        bytes: meta.bytes,
        models: meta.models,
        providers: meta.providers,
      };
      console.log(`[modelCatalogPull] ${result.models} models, ${result.providers} providers, ${(result.bytes / 1024).toFixed(1)}KB`);
    }

    writeAtomic(CATALOG_PULL_META_FILE, JSON.stringify(meta));
    state.lastPullAt = meta.pulledAt;
    state.lastError = null;
    state.lastResult = result;
    return result;
  } catch (error) {
    state.lastError = error?.message || String(error);
    console.log(`[modelCatalogPull] pull failed: ${state.lastError}`);
    return null;
  } finally {
    state.running = false;
  }
}

// The etag lives in the sidecar we wrote, so a restart can resume from it
// instead of re-downloading 5MB to be told nothing changed.
function restoreState() {
  const meta = readMeta();
  state.etag = meta?.etag || null;
  state.lastPullAt = meta?.pulledAt || null;
  if (meta) state.lastResult = { status: "restored", models: meta.models, providers: meta.providers, bytes: meta.bytes };
}

// Schedule the recurring pull. Disable entirely with MODEL_CATALOG_PULL=off.
export function startModelCatalogPull() {
  if (timer) return;
  if (String(process.env.MODEL_CATALOG_PULL || "").toLowerCase() === "off") return;
  restoreState();

  const schedule = (delay) => {
    timer = setTimeout(async () => {
      const result = await pullModelCatalog();
      schedule(result ? PULL_INTERVAL_MS : RETRY_DELAY_MS);
    }, delay);
    timer.unref?.();
  };
  schedule(STARTUP_DELAY_MS);
}