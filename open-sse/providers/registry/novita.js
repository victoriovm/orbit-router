export default {
  id: "novita",
  alias: "nov",
  uiAlias: "nov",
  display: {
    name: "Novita",
    icon: "auto_awesome",
    color: "#23D57C",
    textIcon: "NO",
    website: "https://novita.ai",
    notice: {
      apiKeyUrl: "https://novita.ai/settings/key-management",
    },
  },
  category: "apikey",
  authType: "apikey",
  authModes: ["apikey"],
  transport: {
    baseUrl: "https://api.novita.ai/openai/chat/completions",
    validateUrl: "https://api.novita.ai/openai/models",
  },
  models: [],
  passthroughModels: true,
};
