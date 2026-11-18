import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { refreshProviderCredentials } from "../services/oauthCredentialManager.js";
import { resolveSessionId } from "../utils/sessionManager.js";
import { ROLE } from "../translator/schema/index.js";

const UNSUPPORTED_FIELDS = [
  "max_output_tokens", "max_completion_tokens", "max_tokens", "temperature",
  "prompt_cache_retention", "prompt_cache_options", "stream_options", "reasoning_effort",
];

export class OpenAIChatGPTExecutor extends BaseExecutor {
  constructor() {
    super("openai-chatgpt", PROVIDERS["openai-chatgpt"]);
  }

  transformRequest(model, body, stream, credentials) {
    const result = { ...body, model, stream: true, store: false };
    if (typeof body.reasoning_effort === "string") {
      result.reasoning = { ...body.reasoning, effort: body.reasoning_effort };
    }
    for (const field of UNSUPPORTED_FIELDS) delete result[field];
    if (Array.isArray(body.input)) {
      result.input = body.input.filter((item) => item?.type !== "configuration_update");
    }
    if (result.instructions) {
      const input = typeof result.input === "string"
        ? [{ role: ROLE.USER, content: result.input }]
        : (result.input || []);
      result.input = [{ role: ROLE.DEVELOPER, content: result.instructions }, ...input];
      delete result.instructions;
    }
    if (result.reasoning?.effort && result.reasoning.effort !== "none") {
      result.reasoning = { summary: "auto", ...result.reasoning };
      result.include = [...new Set([...(result.include || []), "reasoning.encrypted_content"])];
    }
    const sessionId = result.prompt_cache_key || resolveSessionId({
      headers: credentials?.rawHeaders,
      body,
      connectionId: credentials?.connectionId,
      workspaceId: credentials?.providerSpecificData?.workspaceId,
      scope: "openai-chatgpt",
    });
    if (sessionId) result.prompt_cache_key = String(sessionId).slice(0, 64);
    return result;
  }

  buildHeaders(credentials, stream = true, url = null, model = null, body = null) {
    const headers = super.buildHeaders(credentials, true);
    const sessionId = body?.prompt_cache_key;
    if (sessionId) {
      headers["session-id"] = sessionId;
      headers["x-client-request-id"] = sessionId;
    }
    return headers;
  }

  async refreshCredentials(credentials, log) {
    return refreshProviderCredentials(this.provider, credentials, log);
  }
}
