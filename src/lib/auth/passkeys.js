import crypto from "node:crypto";
import { shouldUseSecureCookie } from "./dashboardSession.js";

export const PASSKEY_CHALLENGE_COOKIE = "passkey_challenge";
export const PASSKEY_CHALLENGE_TTL_SECONDS = 300;

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

if (!globalThis.__orbitPasskeyChallenges) {
  globalThis.__orbitPasskeyChallenges = new Map();
}

const challenges = globalThis.__orbitPasskeyChallenges;

function cleanupExpiredChallenges() {
  const now = Date.now();
  for (const [id, challenge] of challenges.entries()) {
    if (challenge.expiresAt <= now) challenges.delete(id);
  }
}

function getRequestHostname(request) {
  const host = request.headers.get("host");
  if (!host) return null;
  try {
    return new URL(`http://${host}`).hostname.replace(/^\[|\]$/g, "").toLowerCase();
  } catch {
    return null;
  }
}

export function getPasskeyRequestContext(request) {
  const originHeader = request.headers.get("origin");
  const originUrl = new URL(originHeader || request.url);
  const hostname = originUrl.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const requestHostname = getRequestHostname(request);

  if (originHeader && requestHostname && hostname !== requestHostname) {
    throw new Error("Passkey origin does not match this dashboard");
  }

  if (originUrl.protocol !== "https:" && !LOOPBACK_HOSTS.has(hostname)) {
    throw new Error("Passkeys require HTTPS or localhost");
  }

  return { origin: originUrl.origin, rpID: hostname };
}

export function createPasskeyChallenge(type, data) {
  cleanupExpiredChallenges();
  const id = crypto.randomBytes(32).toString("base64url");
  challenges.set(id, {
    ...data,
    type,
    expiresAt: Date.now() + PASSKEY_CHALLENGE_TTL_SECONDS * 1000,
  });
  return id;
}

export function consumePasskeyChallenge(id, expectedType) {
  cleanupExpiredChallenges();
  if (!id) return null;
  const challenge = challenges.get(id);
  challenges.delete(id);
  if (!challenge || challenge.type !== expectedType || challenge.expiresAt <= Date.now()) return null;
  return challenge;
}

export function setPasskeyChallengeCookie(response, request, challengeId) {
  response.cookies.set(PASSKEY_CHALLENGE_COOKIE, challengeId, {
    httpOnly: true,
    secure: shouldUseSecureCookie(request),
    sameSite: "strict",
    path: "/api/auth/passkeys",
    maxAge: PASSKEY_CHALLENGE_TTL_SECONDS,
  });
  return response;
}

export function clearPasskeyChallengeCookie(response) {
  response.cookies.set(PASSKEY_CHALLENGE_COOKIE, "", {
    httpOnly: true,
    sameSite: "strict",
    path: "/api/auth/passkeys",
    maxAge: 0,
  });
  return response;
}

export function encodePasskeyPublicKey(publicKey) {
  return Buffer.from(publicKey).toString("base64url");
}

export function decodePasskeyPublicKey(publicKey) {
  return new Uint8Array(Buffer.from(publicKey, "base64url"));
}

export function assertPasskeyChallengeContext(request, challenge) {
  const current = getPasskeyRequestContext(request);
  if (current.origin !== challenge.origin || current.rpID !== challenge.rpID) {
    throw new Error("Passkey request context changed");
  }
  return current;
}
