export function parsePiChatGPTAuthorization(input) {
  let parsed;
  try {
    parsed = typeof input === "string" ? JSON.parse(input) : input;
  } catch {
    throw new Error("Invalid Pi authorization JSON");
  }
  const credential = parsed?.openai ?? parsed;
  if (!credential || typeof credential !== "object" || Array.isArray(credential) || credential.type !== "oauth") {
    throw new Error("Paste Pi's OpenAI OAuth entry or auth.json containing an openai entry (not openai-codex)");
  }
  for (const field of ["access", "refresh", "clientId"]) {
    if (typeof credential[field] !== "string" || !credential[field].trim()) {
      throw new Error(`Pi OpenAI authorization is missing ${field}`);
    }
  }
  if (credential.clientId === "dynamic_agent_client") throw new Error("Pi authorization must contain the issued clientId");
  if (!Number.isFinite(credential.expires) || credential.expires <= 0 || !Number.isFinite(new Date(credential.expires).getTime())) {
    throw new Error("Pi OpenAI authorization must contain expires as a Unix timestamp in milliseconds");
  }
  if (!Array.isArray(credential.scopes) || !credential.scopes.every((scope) => typeof scope === "string") || !credential.scopes.includes("chatgpt.tokens.use.direct")) {
    throw new Error("Pi OpenAI authorization must include the chatgpt.tokens.use.direct scope");
  }
  return {
    accessToken: credential.access.trim(),
    refreshToken: credential.refresh.trim(),
    expiresAt: new Date(credential.expires).toISOString(),
    providerSpecificData: {
      oauthClientId: credential.clientId.trim(),
      scopes: [...credential.scopes],
      authMethod: "pi_json",
    },
  };
}
