export default {
  id: "runanywhere",
  priority: 120,
  alias: "runanywhere",
  aliases: [
    "runa",
    "wally",
  ],
  uiAlias: "runanywhere",
  display: {
    name: "RunAnywhere (Wally)",
    icon: "cloud",
    color: "#FF6900",
    textIcon: "RA",
    website: "https://www.runanywhere.ai",
    notice: {
      text: "Hosted arm of RunAnywhere's Wally platform (OpenAI-compatible). Entitlement is per key and per environment, so a key that works in development can return 403 in production for the same model id — treat the /models response for your own key as the authority on what you can call.",
      apiKeyUrl: "https://console.runanywhere.ai/cloud",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://inference.runanywhere.ai/v1/chat/completions",
    validateUrl: "https://inference.runanywhere.ai/v1/models",
    retry: {
      429: 2,
    },
  },
  // Only the console default is published; the rest of the catalogue is scoped
  // to each key, so discovery is left to the live endpoint and any id is
  // accepted via passthroughModels.
  models: [
    { id: "glm-5.3-flash", name: "GLM 5.3 Flash" },
  ],
  modelsFetcher: { url: "https://inference.runanywhere.ai/v1/models", type: "openai" },
  passthroughModels: true,
};