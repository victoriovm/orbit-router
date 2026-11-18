import { describe, expect, it } from "vitest";
import { parsePiChatGPTAuthorization } from "../../src/lib/oauth/piChatGPTImport.js";

const credential = {
  type: "oauth", access: "access-secret", refresh: "refresh-secret", expires: 1800000000000,
  clientId: "issued-pi-client", scopes: ["openid", "chatgpt.tokens.use.direct"],
};

describe("Pi ChatGPT authorization import", () => {
  it.each([credential, { openai: credential, anthropic: { access: "unrelated-secret" } }])("accepts a Pi credential or complete auth.json", (input) => {
    const result = parsePiChatGPTAuthorization(JSON.stringify(input));
    expect(result).toEqual({ accessToken: "access-secret", refreshToken: "refresh-secret", expiresAt: new Date(credential.expires).toISOString(), providerSpecificData: { oauthClientId: "issued-pi-client", scopes: credential.scopes, authMethod: "pi_json" } });
    expect(JSON.stringify(result)).not.toContain("unrelated-secret");
  });
  it("preserves expired credentials so the normal refresh lifecycle can renew them", () => {
    expect(parsePiChatGPTAuthorization({ ...credential, expires: 1000 }).expiresAt).toBe(new Date(1000).toISOString());
  });
  it.each([
    null, [], {}, { "openai-codex": credential }, { ...credential, type: "api_key" },
    { ...credential, access: "" }, { ...credential, refresh: "" }, { ...credential, clientId: "" },
    { ...credential, clientId: "dynamic_agent_client" }, { ...credential, expires: "1800000000000" },
    { ...credential, expires: Infinity }, { ...credential, scopes: ["openid"] },
  ])("rejects incompatible or incomplete authorization", (input) => {
    expect(() => parsePiChatGPTAuthorization(input)).toThrow();
  });
  it("does not echo malformed JSON or tokens in errors", () => {
    try { parsePiChatGPTAuthorization('{"access":"secret"'); } catch (error) {
      expect(error.message).toBe("Invalid Pi authorization JSON");
      expect(error.message).not.toContain("secret");
    }
  });
});
