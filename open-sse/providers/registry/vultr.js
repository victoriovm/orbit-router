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
  },
  models: [],
  passthroughModels: true,
};
