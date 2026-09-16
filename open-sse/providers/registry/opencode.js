export default {
  id: "opencode",
  priority: 40,
  hasFree: true,
  alias: "oc",
  uiAlias: "oc",
  display: {
    name: "OpenCode Free",
    icon: "terminal",
    color: "#E87040",
    textIcon: "OC",
  },
  category: "free",
  noAuth: true,
  transport: {
    baseUrl: "https://opencode.ai",
    headers: {
      "x-opencode-client": "desktop",
    },
    noAuth: true,
  },
  models: [
    // Muse Spark models are served by /zen/v1/responses; the rest stay on
    // /chat/completions, so the format is declared per-model, not per-provider.
    { id: "muse-spark-1.2-contributor-free", name: "Muse Spark 1.2 Contributor Free", targetFormat: "openai-responses" },
    { id: "muse-spark-1.3-contributor-free", name: "Muse Spark 1.3 Contributor Free", targetFormat: "openai-responses" },
    // Union Alpha is served by /zen/v1/messages only (Anthropic wire format) —
    // see https://opencode.ai/docs/zen. The per-model targetFormat is what
    // forces translation for clients whose wire format is not Claude: an OpenAI
    // client must be converted, never forwarded to /chat/completions.
    // supportedFormats is load-bearing for Responses clients: without it,
    // chatCore would match the provider-level openai-responses transport, set
    // targetFormat=openai-responses and put a Responses body on /messages.
    { id: "union-alpha", name: "Union Alpha Free", targetFormat: "claude", supportedFormats: ["claude"] },
  ],
  modelsFetcher: { url: "https://opencode.ai/zen/v1/models", type: "opencode-free" },
  passthroughModels: true,
  // Per-model endpoint overrides live in OpenCodeExecutor.buildUrl, not as a
  // generic `claude` transport: this provider accepts arbitrary passthrough ids
  // and the Zen endpoint table is per-model, so a provider-wide claude transport
  // would wrongly route e.g. big-pickle (chat/completions only) to /messages.
  // Auth is owned by OpenCodeExecutor.buildHeaders (Bearer public + opencode UA),
  // so no auth descriptor is needed here.
  transports: [
    { format: "openai-responses", baseUrl: "https://opencode.ai/zen/v1/responses" },
  ],
};
