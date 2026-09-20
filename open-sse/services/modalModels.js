// Modal endpoints are per-deployment: one Modal API token works across every
// endpoint of the account, but each OpenAI-compatible endpoint lives on its own
// hostname (https://<workspace>--<app>.modal.run/v1) and serves its own model
// catalog. A Modal connection therefore stores a LIST of base URLs plus a
// model → base map (built by /v1/models discovery), so a single token can route
// each model to the endpoint that actually serves it.

// Fallback only — used when a connection has no endpoint URL configured yet
// (the executor raises a descriptive error instead of silently hitting this).
export const MODAL_DEFAULT_BASE_URL = "https://api.modal.com/v1";

// Modal serves the OpenAI-compatible API under /v1, so a bare endpoint host is
// completed with it. An explicit version (…/v2, /v1beta) is left as typed.
const VERSION_SEGMENT_PATTERN = /\/v\d+(?:beta\d*)?$/i;

/** Normalize one user-entered endpoint into an OpenAI-compatible base (…/v1). */
export function normalizeModalBaseUrl(raw) {
  if (typeof raw !== "string") return "";
  let url = raw.trim();
  if (!url) return "";
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;

  // Separate a query/hash suffix before touching the path.
  let suffix = "";
  const queryIndex = url.search(/[?#]/);
  if (queryIndex !== -1) {
    suffix = url.slice(queryIndex);
    url = url.slice(0, queryIndex);
  }

  url = url.replace(/\/+$/, "");
  url = url.replace(/\/chat\/completions$/i, "");
  url = url.replace(/\/models$/i, "");
  url = url.replace(/\/+$/, "");

  if (!url) return suffix;
  return `${VERSION_SEGMENT_PATTERN.test(url) ? url : `${url}/v1`}${suffix}`;
}

/**
 * Bare token from whatever the user pasted: Modal tokens are frequently copied
 * together with the header ("Authorization: Bearer sk-…"), which would otherwise
 * be sent as "Bearer Authorization: Bearer sk-…".
 */
export function normalizeModalToken(raw) {
  if (typeof raw !== "string") return raw;
  let token = raw.trim();
  token = token.replace(/^authorization\s*[:=]\s*/i, "");
  token = token.replace(/^bearer\s+/i, "");
  return token.trim();
}

/** Accepts an array, or a newline/comma separated string (textarea input). */
export function parseModalBaseUrls(input) {
  const raw = Array.isArray(input)
    ? input
    : (typeof input === "string" ? input.split(/[\n,]/) : []);
  const out = [];
  for (const item of raw) {
    const normalized = normalizeModalBaseUrl(item);
    if (normalized && !out.includes(normalized)) out.push(normalized);
  }
  return out;
}

/** Base URLs configured on a connection (multi-URL field, then legacy single). */
export function listModalBaseUrls(credentials) {
  const psd = credentials?.providerSpecificData || {};
  const urls = parseModalBaseUrls(psd.baseUrls);
  if (urls.length) return urls;
  const single = normalizeModalBaseUrl(psd.baseUrl);
  return single ? [single] : [];
}

export function resolveModalModelsUrl(baseUrl) {
  return `${baseUrl}/models`;
}

// Thinking levels are appended as a trailing "(level)" suffix; the routing map
// stores bare model ids.
function bareModelId(model) {
  if (typeof model !== "string") return "";
  const suffix = model.match(/\([^()]*\)\s*$/);
  return suffix ? model.slice(0, suffix.index).trim() : model.trim();
}

/**
 * Client-facing model id: Modal catalogs publish author-prefixed ids
 * ("zai-org/GLM-5.3-Flash") while users address them by the bare name
 * ("glm-5.3-flash"). The upstream call keeps the original id.
 */
export function modalModelDisplayId(rawId) {
  if (typeof rawId !== "string") return "";
  const bare = rawId.trim();
  if (!bare) return "";
  const base = bare.split("/").filter(Boolean).pop() || bare;
  return base.toLowerCase();
}

// Lookup keys for a requested model id, most authoritative first: the display
// form discovery writes today, then the id as typed (older connections stored
// author-prefixed ids, and clients may also change the case).
function modelLookupKeys(model) {
  const bare = bareModelId(model);
  const display = modalModelDisplayId(bare);
  return display && display !== bare ? [display, bare] : [bare];
}

/**
 * Upstream model id for a requested model: a display id ("glm-5.3-flash") maps
 * back to the catalog id ("zai-org/GLM-5.3-Flash"). Author-prefixed requests are
 * used as typed, so an explicit full id always wins.
 */
export function resolveModalUpstreamModelId(credentials, model) {
  const map = credentials?.providerSpecificData?.modelUpstreamIds;
  if (!map || typeof map !== "object") return "";
  const bare = bareModelId(model);
  if (!bare || bare.includes("/")) return "";
  return map[bare] || map[bare.toLowerCase()] || "";
}

// Fresh model → endpoint maps, per connection + endpoint list. Routes are
// discovered from /models; keeping the map warm means a model always starts on
// the endpoint that serves it instead of falling back to the first URL.
const ROUTES_CACHE_TTL_MS = 60_000;
const routesCache = new Map();
const routesRefreshInFlight = new Map();

function routesCacheKey(credentials) {
  const connectionId = credentials?.connectionId || credentials?._connection?.id || "";
  return `${connectionId}|${listModalBaseUrls(credentials).join(",")}`;
}

/** Cached model → endpoint map for this connection, when it is still fresh. */
export function getCachedModalModelRoutes(credentials, { ttlMs = ROUTES_CACHE_TTL_MS } = {}) {
  const entry = routesCache.get(routesCacheKey(credentials));
  if (!entry || Date.now() - entry.at > ttlMs) return null;
  return entry.modelBaseUrls;
}

/**
 * Refresh the model → endpoint map in the background so later requests start on
 * the right endpoint. Never blocks a request and never rejects; returns the
 * in-flight/settled promise when a refresh actually ran.
 */
export function scheduleModalRoutesRefresh(credentials, options = {}) {
  if (!listModalBaseUrls(credentials).length) return null;
  if (getCachedModalModelRoutes(credentials)) return null;

  const key = routesCacheKey(credentials);
  const inFlight = routesRefreshInFlight.get(key);
  if (inFlight) return inFlight;

  const pending = fetchModalModels(credentials, options)
    .then((result) => {
      if (result.models.length) {
        routesCache.set(key, { at: Date.now(), modelBaseUrls: result.modelBaseUrls });
      }
      return result.modelBaseUrls;
    })
    .catch(() => null)
    .finally(() => routesRefreshInFlight.delete(key));

  routesRefreshInFlight.set(key, pending);
  return pending;
}

/** Endpoint discovered for `model`, when it is still among the configured ones. */
function mappedModalBaseUrl(credentials, model) {
  const map = getCachedModalModelRoutes(credentials) || credentials?.providerSpecificData?.modelBaseUrls;
  if (!map || typeof map !== "object") return "";
  const urls = listModalBaseUrls(credentials);
  const keys = modelLookupKeys(model);

  for (const key of keys) {
    const mapped = normalizeModalBaseUrl(map[key]);
    if (mapped && urls.includes(mapped)) return mapped;
  }

  // Forgiving fallback: match the id ignoring case (clients rewrite ids freely).
  const wanted = new Set(keys.map((key) => key.toLowerCase()));
  for (const [id, base] of Object.entries(map)) {
    if (!wanted.has(String(id).toLowerCase())) continue;
    const mapped = normalizeModalBaseUrl(base);
    if (mapped && urls.includes(mapped)) return mapped;
  }
  return "";
}

/**
 * Whether this connection is known to serve `model`, judged by its discovered
 * route map (fresh RAM cache first, then the persisted one):
 * - true  → the map has a route for the model.
 * - false → a catalog was discovered for these endpoints and the model is not
 *   in it. Per-app endpoints serve their own deployment regardless of the
 *   body's model field, so sending the request anyway would get it answered by
 *   whatever model the first endpoint hosts — while the router keeps logging
 *   the requested id. Callers must not route the request to this connection.
 * - null  → no catalog known (never discovered, or refresh pending); the
 *   endpoints must be probed as before.
 */
export function modalConnectionServesModel(credentials, model) {
  const map = getCachedModalModelRoutes(credentials) || credentials?.providerSpecificData?.modelBaseUrls;
  if (!map || typeof map !== "object") return null;
  const keys = modelLookupKeys(model);
  if (keys.some((key) => map[key])) return true;
  // Forgiving pass, same as mappedModalBaseUrl: clients rewrite ids freely.
  const wanted = new Set(keys.map((key) => key.toLowerCase()));
  return Object.keys(map).some((id) => wanted.has(String(id).toLowerCase()));
}

/**
 * Endpoints to try for `model`, in order: the endpoint discovered for it first
 * (when still configured), then the remaining configured endpoints. `mapped`
 * tells callers whether the first candidate is a discovered route — an
 * unreachable discovered route is a real failure, an unreachable candidate
 * while probing is not.
 */
export function modalEndpointCandidates(credentials, model) {
  const urls = listModalBaseUrls(credentials);
  if (!urls.length) {
    throw new Error("Modal needs at least one endpoint URL — edit the connection and add your Modal endpoint base URLs (e.g. https://your-app.modal.run/v1)");
  }
  const mapped = mappedModalBaseUrl(credentials, model);
  if (!mapped) return { mapped: false, candidates: urls };
  return { mapped: true, candidates: [mapped, ...urls.filter((url) => url !== mapped)] };
}

/** Base URL that serves `model` on this connection. */
export function resolveModalBaseUrl(credentials, model) {
  return modalEndpointCandidates(credentials, model).candidates[0];
}

export function resolveModalChatUrl(credentials, model) {
  return `${resolveModalBaseUrl(credentials, model)}/chat/completions`;
}

// An endpoint that does not host the requested model answers 404, or 400/422
// with a model-not-found message. Any other error is a real failure and must
// surface instead of being retried on another endpoint.
const MODEL_NOT_SERVED_PATTERN = /(model[^"']{0,40}(not found|does not exist|unknown|unsupported|not available|invalid)|(unknown|unsupported|invalid|no such)\s+model|model_not_found)/i;

async function readBody(response) {
  try {
    return await response.clone().text();
  } catch {
    return "";
  }
}

/**
 * Classify a failed endpoint answer:
 * - "model": the endpoint is reachable but does not host this model → the caller
 *   may try another endpoint of the account.
 * - "other": a real failure (wrong URL/path, auth, server error, invalid body) →
 *   the caller must surface it, so a broken endpoint gets parked instead of
 *   being silently skipped.
 */
export async function classifyEndpointMiss(response) {
  if (!response) return "other";
  if (response.status !== 404 && response.status !== 400 && response.status !== 422) return "other";
  // A bare "Not Found" (no model wording) means the endpoint path itself is
  // wrong — that is an endpoint failure, not a model miss.
  return MODEL_NOT_SERVED_PATTERN.test(await readBody(response)) ? "model" : "other";
}

/**
 * Every configured endpoint answered "no such model": the model simply isn't
 * deployed on this account. Reported instead of an arbitrary endpoint's 404 —
 * the wording is matched by errorConfig's noFallback rule, so it locks nothing
 * and counts no failure strike (a client-side model typo must not park accounts).
 */
export function buildModelNotServedResponse(model, candidateCount) {
  const message = `${bareModelId(model) || "model"} is not served by any configured endpoint of this account (${candidateCount} checked) — check the endpoint URLs or run "Discover Models"`;
  return new Response(JSON.stringify({
    error: { message, type: "invalid_request_error", code: "model_not_served" },
  }), { status: 404, headers: { "Content-Type": "application/json" } });
}

/** Drop discovered routes whose endpoint is no longer configured. */
export function pruneModalModelRoutes(providerSpecificData) {
  const psd = { ...(providerSpecificData || {}) };
  const map = psd.modelBaseUrls;
  if (!map || typeof map !== "object") return psd;

  const urls = listModalBaseUrls({ providerSpecificData: psd });
  const pruned = {};
  for (const [id, base] of Object.entries(map)) {
    const normalized = normalizeModalBaseUrl(base);
    if (normalized && urls.includes(normalized)) pruned[id] = normalized;
  }

  if (Object.keys(pruned).length) psd.modelBaseUrls = pruned;
  else delete psd.modelBaseUrls;

  // The upstream-id map only matters for models that still have a route.
  const upstream = psd.modelUpstreamIds;
  if (upstream && typeof upstream === "object") {
    const kept = {};
    for (const [id, rawId] of Object.entries(upstream)) {
      if (pruned[id]) kept[id] = rawId;
    }
    if (Object.keys(kept).length) psd.modelUpstreamIds = kept;
    else delete psd.modelUpstreamIds;
  }
  return psd;
}

function parseModelList(data) {
  if (Array.isArray(data)) return data;
  return data?.data || data?.models || data?.results || [];
}

/**
 * Fetch /models from every configured endpoint of a connection.
 * Requests run in parallel but merge in connection order, so a model exposed by
 * several endpoints always resolves to the first one listed by the user.
 *
 * Catalog ids are author-prefixed ("zai-org/GLM-5.3-Flash"); the returned models
 * carry the client-facing display id ("glm-5.3-flash") while `modelUpstreamIds`
 * keeps the id the endpoint expects in the request body.
 *
 * @returns {{models: {id:string,name:string,upstreamModelId:string}[], modelBaseUrls: Record<string,string>, modelUpstreamIds: Record<string,string>, errors: string[]}}
 */
export async function fetchModalModels(connection, { timeoutMs = 15000 } = {}) {
  const urls = listModalBaseUrls(connection);
  if (!urls.length) {
    return { models: [], modelBaseUrls: {}, modelUpstreamIds: {}, errors: ["No endpoint URL configured"] };
  }

  const apiKey = normalizeModalToken(connection?.apiKey || connection?.accessToken || "");

  const results = await Promise.all(urls.map(async (base) => {
    try {
      const response = await fetch(resolveModalModelsUrl(base), {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        console.log(`Error fetching models from ${base}:`, errorText || response.status);
        return { base, error: `HTTP ${response.status}` };
      }
      return { base, entries: parseModelList(await response.json()) };
    } catch (error) {
      console.log(`Error fetching models from ${base}:`, error.message);
      return { base, error: error.message };
    }
  }));

  const models = [];
  const seen = new Set();
  const errors = [];
  const modelBaseUrls = {};
  const modelUpstreamIds = {};
  for (const result of results) {
    if (result.error) {
      errors.push(`${result.base}: ${result.error}`);
      continue;
    }
    for (const entry of result.entries) {
      const upstreamModelId = typeof entry?.id === "string" ? entry.id.trim() : "";
      const id = modalModelDisplayId(upstreamModelId);
      if (!id || seen.has(id)) continue;
      // First endpoint listed by the user wins for a shared model id.
      seen.add(id);
      modelBaseUrls[id] = result.base;
      if (upstreamModelId !== id) modelUpstreamIds[id] = upstreamModelId;
      models.push({
        id,
        name: entry?.name || entry?.description || upstreamModelId,
        upstreamModelId,
      });
    }
  }

  // Endpoints that didn't answer this time keep their previous mapping when
  // they are still configured — an endpoint can be temporarily unreachable, and
  // dropping its models would break routing for requests that are still valid.
  const previous = connection?.providerSpecificData?.modelBaseUrls;
  if (previous && typeof previous === "object") {
    for (const [id, base] of Object.entries(previous)) {
      const normalized = normalizeModalBaseUrl(base);
      if (!modelBaseUrls[id] && normalized && urls.includes(normalized)) {
        modelBaseUrls[id] = normalized;
      }
    }
  }
  const previousUpstream = connection?.providerSpecificData?.modelUpstreamIds;
  if (previousUpstream && typeof previousUpstream === "object") {
    for (const [id, upstreamModelId] of Object.entries(previousUpstream)) {
      if (modelBaseUrls[id] && !modelUpstreamIds[id]) modelUpstreamIds[id] = upstreamModelId;
    }
  }

  return { models, modelBaseUrls, modelUpstreamIds, errors };
}

/**
 * fetchModalModels + optional persistence of the discovered routes (skipped when
 * unchanged). Callers pass `persist` so this module stays storage-free.
 */
export async function discoverModalModels(connection, { persist, ...options } = {}) {
  const result = await fetchModalModels(connection, options);
  if (persist && result.models.length) {
    const psd = connection?.providerSpecificData || {};
    const changed =
      JSON.stringify(psd.modelBaseUrls || {}) !== JSON.stringify(result.modelBaseUrls)
      || JSON.stringify(psd.modelUpstreamIds || {}) !== JSON.stringify(result.modelUpstreamIds);
    if (changed) {
      await persist({
        modelBaseUrls: result.modelBaseUrls,
        modelUpstreamIds: result.modelUpstreamIds,
      });
    }
  }
  return result;
}