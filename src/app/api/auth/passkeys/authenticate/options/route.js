import { NextResponse } from "next/server";
import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { getPasskeys, getSettings } from "@/lib/localDb";
import { isOidcConfigured } from "@/lib/auth/oidc";
import { isSamlConfigured } from "@/lib/auth/saml.js";
import { checkLock, getClientIp } from "@/lib/auth/loginLimiter";
import {
  createPasskeyChallenge,
  getPasskeyRequestContext,
  setPasskeyChallengeCookie,
} from "@/lib/auth/passkeys";

function passkeyLoginDisabled(settings) {
  if (!["sso", "oidc", "saml"].includes(settings.authMode)) return false;
  const ssoType = settings.ssoType || (settings.authMode === "saml" ? "saml" : "oidc");
  return ssoType === "saml" ? isSamlConfigured(settings) : isOidcConfigured(settings);
}

export async function POST(request) {
  try {
    const lock = checkLock(getClientIp(request));
    if (lock.locked) {
      return NextResponse.json(
        { error: `Too many failed attempts. Try again in ${lock.retryAfter}s.`, retryAfter: lock.retryAfter },
        { status: 429, headers: { "Retry-After": String(lock.retryAfter) } }
      );
    }

    const settings = await getSettings();
    if (passkeyLoginDisabled(settings)) {
      return NextResponse.json({ error: "Passkey login is disabled while SSO-only mode is active" }, { status: 403 });
    }

    const passkeys = await getPasskeys();
    if (passkeys.length === 0) return NextResponse.json({ error: "No passkeys registered" }, { status: 404 });

    const { origin, rpID } = getPasskeyRequestContext(request);
    const options = await generateAuthenticationOptions({
      rpID,
      userVerification: "required",
      allowCredentials: passkeys.map((passkey) => ({
        id: passkey.id,
        transports: passkey.transports,
      })),
    });
    const challengeId = createPasskeyChallenge("authentication", {
      challenge: options.challenge,
      origin,
      rpID,
    });
    const response = NextResponse.json(options, { headers: { "Cache-Control": "no-store" } });
    return setPasskeyChallengeCookie(response, request, challengeId);
  } catch (error) {
    return NextResponse.json({ error: error.message || "Failed to start passkey login" }, { status: 400 });
  }
}
