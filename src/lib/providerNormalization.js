import { AI_PROVIDERS } from "../shared/constants/providers.js";
import { parseModalBaseUrls } from "open-sse/services/modalModels.js";

/**
 * Detect xAI Grok models by id pattern (grok-*, Grok_*, etc).
 * @param {string} modelId
 * @returns {boolean}
 */
export function isXaiModel(modelId) {
  return typeof modelId === "string" && /^grok[-_]/i.test(modelId.trim());
}

export function normalizeProviderId(provider) {
  if (typeof provider !== "string") return provider;

  const trimmed = provider.trim();
  if (AI_PROVIDERS[trimmed]) return trimmed;

  const slug = trimmed.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (AI_PROVIDERS[slug]) return slug;

  const providerByName = Object.values(AI_PROVIDERS).find(
    (entry) => entry.name?.toLowerCase() === trimmed.toLowerCase()
  );
  return providerByName?.id || trimmed;
}

export function normalizeProviderSpecificData(provider, body = {}, providerSpecificData = null) {
  const next = providerSpecificData && typeof providerSpecificData === "object"
    ? { ...providerSpecificData }
    : {};

  if (provider === "ollama-local") {
    const baseUrl = (
      next.baseUrl ||
      body.baseUrl ||
      body.baseURL ||
      body.ollamaHostUrl ||
      ""
    ).trim();

    if (baseUrl) next.baseUrl = baseUrl;
  }

  // Modal: one token over many per-app endpoints. Accepts an array or a
  // newline/comma separated string from the add/edit textarea, and keeps the
  // single baseUrl field usable as a legacy alias.
  if (provider === "modal") {
    const urls = parseModalBaseUrls([
      ...parseModalBaseUrls(next.baseUrls),
      ...parseModalBaseUrls(body.baseUrls),
      ...parseModalBaseUrls(next.baseUrl),
      ...parseModalBaseUrls(body.baseUrl),
    ]);

    delete next.baseUrl;
    delete next.baseURL;
    if (urls.length) next.baseUrls = urls;
  }

  return Object.keys(next).length > 0 ? next : null;
}
