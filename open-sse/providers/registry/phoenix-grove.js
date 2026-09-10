export default {
  id: "phoenix-grove",
  alias: "pgs",
  uiAlias: "pgs",
  display: {
    name: "Phoenix Grove",
    icon: "local_fire_department",
    color: "#F97316",
    textIcon: "PG",
    website: "https://pgsgrove.com",
  },
  category: "apikey",
  authType: "apikey",
  authModes: ["apikey"],
  transport: {
    baseUrl: "https://api.pgsgrove.com/v1/chat/completions",
    validateUrl: "https://api.pgsgrove.com/v1/models",
  },
  models: [],
  passthroughModels: true,
};
