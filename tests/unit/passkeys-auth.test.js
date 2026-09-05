import { describe, expect, it } from "vitest";
import {
  consumePasskeyChallenge,
  createPasskeyChallenge,
  decodePasskeyPublicKey,
  encodePasskeyPublicKey,
  getPasskeyRequestContext,
} from "@/lib/auth/passkeys.js";

function request(url, headers = {}) {
  return { url, headers: new Headers(headers) };
}

describe("passkey authentication helpers", () => {
  it("allows HTTP on localhost", () => {
    const context = getPasskeyRequestContext(request("http://localhost:20127/api/auth/passkeys", {
      host: "localhost:20127",
      origin: "http://localhost:20127",
    }));

    expect(context).toEqual({ origin: "http://localhost:20127", rpID: "localhost" });
  });

  it("requires HTTPS outside loopback", () => {
    expect(() => getPasskeyRequestContext(request("http://router.example.com/api/auth/passkeys", {
      host: "router.example.com",
      origin: "http://router.example.com",
    }))).toThrow("Passkeys require HTTPS or localhost");
  });

  it("rejects a mismatched request origin", () => {
    expect(() => getPasskeyRequestContext(request("https://router.example.com/api/auth/passkeys", {
      host: "router.example.com",
      origin: "https://evil.example.com",
    }))).toThrow("Passkey origin does not match this dashboard");
  });

  it("consumes challenges only once", () => {
    const challengeId = createPasskeyChallenge("authentication", { challenge: "challenge" });
    expect(consumePasskeyChallenge(challengeId, "authentication")?.challenge).toBe("challenge");
    expect(consumePasskeyChallenge(challengeId, "authentication")).toBeNull();
  });

  it("round-trips public key bytes", () => {
    const publicKey = new Uint8Array([1, 2, 3, 254, 255]);
    expect(decodePasskeyPublicKey(encodePasskeyPublicKey(publicKey))).toEqual(publicKey);
  });
});
