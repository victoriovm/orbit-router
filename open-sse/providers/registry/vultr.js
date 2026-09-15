export default {
  id: "vultr",
  alias: "vultr",
  uiAlias: "vultr",
  display: {
    name: "Vultr",
    icon: "cloud",
    color: "#188CFD",
    textIcon: "VU",
    website: "https://www.vultr.com",
    notice: {
      apiKeyUrl: "https://my.vultr.com/settings/#settingsapi",
    },
  },
  category: "apikey",
  authType: "apikey",
  authModes: ["apikey"],
  transport: {
    baseUrl: "https://api.vultrinference.com/v1/chat/completions",
    validateUrl: "https://api.vultrinference.com/v1/models",
    // Vultr Inference expects an explicit output cap: max_tokens must be present
    // on every chat request. The executor fills it with the model's own ceiling
    // when the client sent none.
    quirks: { requireMaxTokens: true },
  },
  models: [],
  passthroughModels: true,
};
