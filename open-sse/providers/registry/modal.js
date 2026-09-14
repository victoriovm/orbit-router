export default {
  id: "modal",
  alias: "modal",
  uiAlias: "modal",
  display: {
    name: "Modal",
    icon: "bolt",
    color: "#7FEE64",
    textIcon: "MO",
    website: "https://modal.com",
    notice: {
      text: "Modal endpoints are per-deployment: every app you deploy exposes its own OpenAI-compatible base URL (https://<workspace>--<app>.<region>.modal.direct/v1) with its own model list. Add all of the account's endpoint URLs to one connection — a single Modal API token works across every endpoint — then use Discover Models to map each model to its endpoint.",
      apiKeyUrl: "https://modal.com/settings/tokens",
    },
  },
  category: "apikey",
  authType: "apikey",
  authModes: ["apikey"],
  hasProviderSpecificData: true,
  // Endpoints are per connection (providerSpecificData.baseUrls) — the executor
  // resolves the chat URL per model, so no static baseUrl/validateUrl here.
  transport: {
    format: "openai",
    // User-deployed endpoints don't recover from a blip mid-request: park the
    // account's models for 30 min on failure, and disable the account after 3
    // failures in a row (a success, or re-enabling it in the dashboard, resets
    // the count). Locks live on the connection, so every endpoint it holds is
    // parked together, never just the URL that failed.
    health: {
      cooldownMs: 30 * 60 * 1000,
      disableAfterStrikes: 3,
    },
  },
  models: [],
  passthroughModels: true,
};