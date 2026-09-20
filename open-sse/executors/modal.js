import { DefaultExecutor } from "./default.js";
import {
  buildModelNotServedResponse,
  classifyEndpointMiss,
  modalConnectionServesModel,
  modalEndpointCandidates,
  normalizeModalToken,
  resolveModalUpstreamModelId,
  scheduleModalRoutesRefresh,
} from "../services/modalModels.js";

// A token pasted with its header prefix ("Authorization: Bearer sk-…") would
// otherwise be sent as "Bearer Authorization: Bearer sk-…". Belt and suspenders
// with the API-side cleanup: a stored token can predate it.
function withCleanModalToken(credentials) {
  if (!credentials || typeof credentials !== "object") return credentials;
  return {
    ...credentials,
    apiKey: normalizeModalToken(credentials.apiKey),
    accessToken: normalizeModalToken(credentials.accessToken),
  };
}

export class ModalExecutor extends DefaultExecutor {
  constructor() {
    super("modal");
  }

  buildHeaders(credentials, stream = true, url, model) {
    return super.buildHeaders(withCleanModalToken(credentials), stream, url, model);
  }

  // Modal is one token across many per-app endpoints, each serving its own
  // models. A request starts on the endpoint discovered for the model and moves
  // to another endpoint only when that one answers "no such model" — so a model
  // is never answered by an endpoint that does not host it. Anything else
  // (unreachable host, wrong path, auth, server error) is surfaced as a real
  // failure so a broken endpoint gets parked instead of silently skipped.
  async execute(options) {
    const { credentials, model } = options;
    // Keep the route map warm without adding latency to this request.
    scheduleModalRoutesRefresh(credentials);

    // A discovered catalog is authoritative: per-app endpoints serve their own
    // deployment regardless of the body's model field, so a request for a model
    // this account does not host would be answered by whichever endpoint comes
    // first — while the request keeps being logged as the requested model. When
    // no catalog is in cache yet, wait out the route refresh (one /models
    // round-trip) so a model deployed after the last discovery is not rejected
    // on a stale map.
    if (modalConnectionServesModel(credentials, model) !== true) {
      const refresh = scheduleModalRoutesRefresh(credentials, { timeoutMs: 5000 });
      if (refresh) await refresh;
      if (modalConnectionServesModel(credentials, model) === false) {
        const { candidates } = modalEndpointCandidates(credentials, model);
        return { response: buildModelNotServedResponse(model, candidates.length) };
      }
    }

    const { candidates } = modalEndpointCandidates(credentials, model);

    let lastResult = null;
    for (const baseUrl of candidates) {
      const result = await super.execute({
        ...options,
        credentials: { ...credentials, modalBaseUrlOverride: baseUrl },
      });
      if (result?.response?.ok) return result;
      if (await classifyEndpointMiss(result?.response) !== "model") return result;

      // This endpoint does not host the model — try the next configured one.
      lastResult = result;
    }

    // Every endpoint answered "no such model": report the account-level answer
    // rather than an arbitrary endpoint's 404 (see buildModelNotServedResponse).
    return lastResult
      ? { ...lastResult, response: buildModelNotServedResponse(model, candidates.length) }
      : lastResult;
  }

  buildUrl(model, stream, urlIndex = 0, credentials = null) {
    const baseUrl = credentials?.modalBaseUrlOverride
      || modalEndpointCandidates(credentials, model).candidates[0];
    return `${baseUrl}/chat/completions`;
  }

  // Catalogs publish author-prefixed ids ("zai-org/GLM-5.3-Flash") while users
  // address them by the bare name ("glm-5.3-flash"). Only the upstream request
  // body carries the catalog id — the router, the dashboard and the logs keep the
  // short one. An explicitly author-prefixed request is sent as typed.
  transformRequest(model, body, stream, credentials) {
    const transformed = super.transformRequest(model, body, stream, credentials);
    const upstreamModelId = resolveModalUpstreamModelId(credentials, model);
    if (upstreamModelId && transformed && typeof transformed === "object" && "model" in transformed) {
      return { ...transformed, model: upstreamModelId };
    }
    return transformed;
  }
}

export default ModalExecutor;