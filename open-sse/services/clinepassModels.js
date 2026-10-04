import { buildClineHeaders } from "../shared/clineAuth.js";

// ClinePass reads the authenticated account catalog (/api/v1/models) and keeps
// its `cline-pass/*` subscription tier.
const CLINEPASS_MODELS_ENDPOINT = "https://api.cline.bot/api/v1/models";
// Cline Free's model list is assembled from two public feeds, both called with
// only an Accept header — Cline's own SDK calls the recommended-models feed
// unauthenticated (sdk/packages/core/src/services/llms/cline-recommended-models.ts),
// and an Authorization header is at best ignored by both:
//   1. /ai/cline/models — OpenRouter-shaped catalog; free entries are the ones
//      whose id ends in the `:free` suffix ("qwen/qwen3.8-27b:free").
//   2. /ai/cline/recommended-models — curated feed whose `free[]` tier carries
//      the `cline-free/*` namespace the catalog never lists.
const CLINE_FREE_MODELS_ENDPOINT = "https://api.cline.bot/api/v1/ai/cline/models";
const CLINE_RECOMMENDED_MODELS_ENDPOINT = "https://api.cline.bot/api/v1/ai/cline/recommended-models";
const FETCH_TIMEOUT_MS = 5000;

/**
 * Build request headers for the ClinePass /models endpoint (Cline's upstream API).
 * - API keys are sent as plain Bearer tokens.
 * - OAuth access tokens must carry the WorkOS `workos:` prefix (handled by buildClineHeaders).
 */
function buildModelListHeaders(token, isApiKey) {
  if (isApiKey) {
    return {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    };
  }
  return buildClineHeaders(token, { Accept: "application/json" });
}

/**
 * GET a JSON document. Returns null on any failure (timeout, HTTP error, bad
 * JSON) — a dead feed must never take the rest of the model list down with it.
 */
async function fetchJson(url, headers = { Accept: "application/json" }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers,
      signal: controller.signal,
    });

    if (!response.ok) return null;

    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Internal: fetch the raw model list from Cline's /models endpoint.
 * Returns the parsed array or null on any failure.
 */
async function fetchClineRawModels(credentials) {
  const isApiKey = Boolean(credentials?.apiKey);
  const token = isApiKey ? credentials.apiKey : credentials?.accessToken;
  if (!token) return null;

  const json = await fetchJson(CLINEPASS_MODELS_ENDPOINT, buildModelListHeaders(token, isApiKey));
  const rawList = Array.isArray(json) ? json : json?.data;
  return Array.isArray(rawList) ? rawList : null;
}

/**
 * Fetch ClinePass live model catalog from Cline's /models endpoint.
 * Returns only models with the cline-pass/ prefix.
 *
 * @param {object} credentials - Connection credentials ({ accessToken, apiKey })
 * @returns {Promise<{ models: { id: string, name: string }[] } | null>}
 */
export async function resolveClinepassModels(credentials) {
  const rawList = await fetchClineRawModels(credentials);
  if (!rawList) return null;

  const models = rawList
    .filter((m) => typeof m?.id === "string" && m.id.startsWith("cline-pass/"))
    .map((m) => ({
      id: m.id,
      name: m.name || m.id,
    }));

  return models.length ? { models } : null;
}

function positiveInt(value) {
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * Map one OpenRouter-shaped catalog entry to the shared live-model shape.
 * Keeps the metadata the dashboard and /v1/models consume: token limits and the
 * `capabilities` block (contextWindow/maxOutput/vision/tools/reasoning), which
 * is what marks a live entry's context as actually known instead of a guess.
 * Returns null unless the id carries the `:free` suffix (the free-tier marker).
 */
function parseFreeCatalogModel(raw) {
  const id = nonEmptyString(raw?.id);
  if (!id || !id.endsWith(":free")) return null;

  const params = Array.isArray(raw.supported_parameters) ? raw.supported_parameters : [];
  const inputModalities = Array.isArray(raw.architecture?.input_modalities)
    ? raw.architecture.input_modalities
    : [];
  const contextLength = positiveInt(raw.context_length) ?? positiveInt(raw.top_provider?.context_length);
  const maxOutputTokens = positiveInt(raw.top_provider?.max_completion_tokens);
  const supportsImages = inputModalities.includes("image");
  const supportsTools = params.includes("tools");
  const supportsThinking = params.includes("reasoning") || params.includes("include_reasoning");

  const entry = {
    id,
    name: nonEmptyString(raw.name) || id,
    supportsTools,
    supportsImages,
    supportsThinking,
    capabilities: {
      ...(contextLength !== undefined ? { contextWindow: contextLength } : {}),
      ...(maxOutputTokens !== undefined ? { maxOutput: maxOutputTokens } : {}),
      vision: supportsImages,
      tools: supportsTools,
      reasoning: supportsThinking,
    },
  };
  const description = nonEmptyString(raw.description);
  if (description) entry.description = description;
  if (contextLength !== undefined) entry.contextLength = contextLength;
  if (maxOutputTokens !== undefined) entry.maxOutputTokens = maxOutputTokens;
  return entry;
}

/**
 * Map one recommended-models `free[]` entry ({id, name, description, tags}).
 * The feed publishes no token limits or capabilities, so none are invented.
 */
function parseFreeTierModel(raw) {
  const id = nonEmptyString(raw?.id);
  if (!id) return null;

  const entry = { id, name: nonEmptyString(raw.name) || id };
  const description = nonEmptyString(raw.description);
  if (description) entry.description = description;
  return entry;
}

/**
 * Feed 1 of the Cline Free list: /ai/cline/models entries whose id ends in `:free`.
 * @returns {Promise<object[] | null>}
 */
async function fetchClineFreeCatalogModels() {
  const json = await fetchJson(CLINE_FREE_MODELS_ENDPOINT);
  const rawList = Array.isArray(json) ? json : json?.data;
  if (!Array.isArray(rawList)) return null;

  const models = rawList.map(parseFreeCatalogModel).filter(Boolean);
  return models.length ? models : null;
}

/**
 * Feed 2 of the Cline Free list: the recommended-models `free[]` tier — the whole
 * category, not just the `cline-free/*` namespace. Returns null when the feed is
 * unusable; it is additive, so a dead feed never takes the catalog down with it.
 * @returns {Promise<object[] | null>}
 */
async function fetchClineFreeTierModels() {
  const json = await fetchJson(CLINE_RECOMMENDED_MODELS_ENDPOINT);
  const free = Array.isArray(json?.free) ? json.free : [];
  if (!free.length) return null;

  const models = free.map(parseFreeTierModel).filter(Boolean);
  return models.length ? models : null;
}

/**
 * Fetch the Cline Free (free tier) model list from its two public feeds:
 * every `:free` catalog entry plus the recommended-models `free[]` category.
 * First writer wins on a shared id so the catalog entry keeps the richer
 * token/capability metadata when both feeds list the model. Returns null when
 * both feeds are unusable, and callers fall back to the static catalog.
 *
 * @returns {Promise<{ models: object[] } | null>}
 */
export async function resolveClineModels() {
  const [catalog, freeTier] = await Promise.all([
    fetchClineFreeCatalogModels(),
    fetchClineFreeTierModels(),
  ]);
  if (!catalog && !freeTier) return null;

  const byId = new Map();
  for (const m of catalog || []) {
    if (!byId.has(m.id)) byId.set(m.id, m);
  }
  for (const m of freeTier || []) {
    if (!byId.has(m.id)) byId.set(m.id, m);
  }
  const merged = Array.from(byId.values());

  return merged.length ? { models: merged } : null;
}
