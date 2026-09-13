import { getAdapter } from "@/lib/db/driver.js";
import { parseJson } from "@/lib/db/helpers/jsonCol.js";

// Lightweight home-page overview: everything the dashboard landing needs in
// ONE round-trip, with bounded SQL only (no full-table scans, no JSON-history
// walks). Hot paths use columns the usageHistory indexes cover (timestamp,
// connectionId) instead of parsing stored JSON blobs.
//
// Shape (stable contract for HomePageClient):
// {
//   providers: { providers, enabledAccounts, healthyAccounts, healthyProviders,
//                attentionProviders, disabledProviders, connections: [...] },
//   usage: { totalRequests, totalPromptTokens, totalCompletionTokens,
//            activeRequests, pending, errorProvider },
//   recentRequests: [...(max 6)],
//   modelsCount: number,
//   chart: [{ label, tokens, cost } x7]
// }
//
// modelsCount here is the LOCAL-tables answer only (no live /models discovery,
// no network): explicit enabledModels + static registry counts, computed from
// the already-fetched connections list. The exact live number still refreshes
// via /api/models/count in the background.

const RECENT_LIMIT = 6;

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function getEffectiveStatus(connection) {
  const now = Date.now();
  for (const [key, value] of Object.entries(connection)) {
    if (!key.startsWith("modelLock_") || !value) continue;
    if (new Date(value).getTime() > now) {
      return connection.testStatus;
    }
  }
  return connection.testStatus === "unavailable" ? "active" : connection.testStatus;
}

function rowToConnection(row) {
  if (!row) return null;
  const extra = parseJson(row.data, {});
  return {
    ...extra,
    id: row.id,
    provider: row.provider,
    name: row.name,
    isActive: row.isActive === 1 || row.isActive === true,
    testStatus: extra.testStatus ?? null,
  };
}

function summarizeProviders(connections) {
  const enabled = connections.filter((c) => c.isActive !== false);
  const healthy = enabled.filter((c) => {
    const status = getEffectiveStatus(c);
    return status === "active" || status === "success";
  });

  const byProvider = new Map();
  for (const c of connections) {
    if (!c.provider) continue;
    if (!byProvider.has(c.provider)) byProvider.set(c.provider, { enabled: 0, healthy: 0 });
    if (c.isActive === false) continue;
    const group = byProvider.get(c.provider);
    group.enabled += 1;
    const status = getEffectiveStatus(c);
    if (status === "active" || status === "success") group.healthy += 1;
  }

  let healthyProviders = 0;
  let attentionProviders = 0;
  let disabledProviders = 0;
  for (const group of byProvider.values()) {
    if (group.enabled === 0) disabledProviders += 1;
    else if (group.healthy > 0) healthyProviders += 1;
    else attentionProviders += 1;
  }

  // The home health card only needs per-connection status signals, not the
  // full credential-adjacent payload (enabledModels lists, proxy config…).
  const slim = connections.map((c) => {
    const locks = {};
    for (const [key, value] of Object.entries(c)) {
      if (key.startsWith("modelLock_")) locks[key] = value;
    }
    return {
      id: c.id,
      provider: c.provider,
      isActive: c.isActive,
      testStatus: c.testStatus ?? null,
      ...locks,
    };
  });

  return {
    providers: byProvider.size,
    enabledAccounts: enabled.length,
    healthyAccounts: healthy.length,
    healthyProviders,
    attentionProviders,
    disabledProviders,
    connections: slim,
  };
}

async function countLocalModels(connections) {
  const [{ getDisabledModels }, { PROVIDER_MODELS, PROVIDER_ID_TO_ALIAS }] = await Promise.all([
    import("./disabledModelsRepo.js"),
    import("@/shared/constants/models"),
  ]);
  let disabledByAlias = {};
  try {
    disabledByAlias = await getDisabledModels();
  } catch {}
  const isDisabled = (alias, modelId) =>
    Array.isArray(disabledByAlias[alias]) && disabledByAlias[alias].includes(modelId);

  let count = 0;
  for (const conn of connections) {
    if (conn.isActive === false || !conn.provider) continue;
    const staticModels = PROVIDER_MODELS[conn.provider]
      || PROVIDER_MODELS[PROVIDER_ID_TO_ALIAS[conn.provider]]
      || [];
    const enabled = conn.providerSpecificData?.enabledModels;
    const ids = Array.isArray(enabled) && enabled.length > 0
      ? enabled.filter((id) => typeof id === "string" && id.trim() !== "")
      : staticModels.map((m) => m.id);
    const aliases = [conn.provider, PROVIDER_ID_TO_ALIAS[conn.provider]].filter(Boolean);
    for (const id of ids) {
      if (aliases.some((alias) => isDisabled(alias, id))) continue;
      count += 1;
    }
  }
  return count;
}

export async function getDashboardOverview() {
  const db = await getAdapter();

  const todayIso = startOfToday().toISOString();

  // Connections drive both the health card and the local models estimate, so
  // fetch once and reuse. Bounded by account count (tens of rows), and the
  // providers page needs the same rows anyway.
  const connectionRows = db.all(`SELECT * FROM providerConnections`);
  const connections = connectionRows.map(rowToConnection).filter(Boolean);
  connections.sort((a, b) => (a.priority || 999) - (b.priority || 999));
  const providers = summarizeProviders(connections);

  // Today's counters as SQL aggregates — the indexed timestamp column bounds
  // the scan to today's rows instead of parsing every stored JSON blob.
  const today = db.get(
    `SELECT COUNT(*) AS requests,
            COALESCE(SUM(promptTokens), 0) AS promptTokens,
            COALESCE(SUM(completionTokens), 0) AS completionTokens
     FROM usageHistory WHERE timestamp >= ?`,
    [todayIso],
  );

  // Recent requests: single bounded indexed query. Tokens stay denormalized in
  // columns; stored JSON is only parsed for these 6 rows.
  const recentRows = db.all(
    `SELECT timestamp, provider, model, tokens, status
     FROM usageHistory ORDER BY id DESC LIMIT ?`,
    [RECENT_LIMIT * 4],
  );
  const seen = new Set();
  const recentRequests = [];
  for (const r of recentRows) {
    if (recentRequests.length >= RECENT_LIMIT) break;
    const t = parseJson(r.tokens, {}) || {};
    const promptTokens = t.prompt_tokens || t.input_tokens || 0;
    const completionTokens = t.completion_tokens || t.output_tokens || 0;
    if (promptTokens === 0 && completionTokens === 0) continue;
    const minute = r.timestamp ? r.timestamp.slice(0, 16) : "";
    const key = `${r.model}|${r.provider}|${promptTokens}|${completionTokens}|${minute}`;
    if (seen.has(key)) continue;
    seen.add(key);
    recentRequests.push({
      timestamp: r.timestamp,
      model: r.model,
      provider: r.provider || "",
      promptTokens,
      completionTokens,
      status: r.status || "ok",
    });
  }

  // 7-day chart from the pre-aggregated daily table: 7 indexed PK lookups,
  // no history scan at all.
  const chart = [];
  const todayDate = new Date();
  const dayRows = db.all(`SELECT dateKey, data FROM usageDaily`);
  const dayMap = new Map(dayRows.map((r) => [r.dateKey, parseJson(r.data, {})]));
  for (let i = 6; i >= 0; i--) {
    const d = new Date(todayDate);
    d.setDate(d.getDate() - i);
    const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const day = dayMap.get(dateKey);
    chart.push({
      label: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      tokens: day ? (day.promptTokens || 0) + (day.completionTokens || 0) : 0,
      cost: day ? day.cost || 0 : 0,
    });
  }

  // Active requests are in-memory counters (no SQL); the connection map comes
  // from the rows already fetched above instead of a second DB read.
  const { getActiveRequests } = await import("./usageRepo.js");
  const connectionMap = {};
  for (const c of connections) connectionMap[c.id] = c.name || c.email || c.id;
  const activeSnapshot = await getActiveRequests(connectionMap);

  const modelsCount = await countLocalModels(connections);

  return {
    providers,
    usage: {
      totalRequests: today?.requests || 0,
      totalPromptTokens: today?.promptTokens || 0,
      totalCompletionTokens: today?.completionTokens || 0,
      activeRequests: activeSnapshot.activeRequests,
      pending: activeSnapshot.pending,
      errorProvider: activeSnapshot.errorProvider,
    },
    recentRequests,
    modelsCount,
    chart,
  };
}
