import { NextResponse } from "next/server";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import { getPasskeyByCredentialId, getSettings, updatePasskeyUsage } from "@/lib/localDb";
import { isOidcConfigured } from "@/lib/auth/oidc";
import { isSamlConfigured } from "@/lib/auth/saml.js";
import { setDashboardAuthCookie } from "@/lib/auth/dashboardSession";
import { checkLock, getClientIp, recordFail, recordSuccess } from "@/lib/auth/loginLimiter";
import {
  PASSKEY_CHALLENGE_COOKIE,
  assertPasskeyChallengeContext,
  clearPasskeyChallengeCookie,
  consumePasskeyChallenge,
  decodePasskeyPublicKey,
} from "@/lib/auth/passkeys";

function passkeyLoginDisabled(settings) {
  if (!["sso", "oidc", "saml"].includes(settings.authMode)) return false;
  const ssoType = settings.ssoType || (settings.authMode === "saml" ? "saml" : "oidc");
  return ssoType === "saml" ? isSamlConfigured(settings) : isOidcConfigured(settings);
}

export async function POST(request) {
  const ip = getClientIp(request);
  const lock = checkLock(ip);
  if (lock.locked) {
    return NextResponse.json(
      { error: `Too many failed attempts. Try again in ${lock.retryAfter}s.`, retryAfter: lock.retryAfter },
      { status: 429, headers: { "Retry-After": String(lock.retryAfter) } }
    );
  }

  const challengeId = request.cookies.get(PASSKEY_CHALLENGE_COOKIE)?.value;
  const challenge = consumePasskeyChallenge(challengeId, "authentication");

  try {
    if (!challenge) throw new Error("Passkey request expired. Try again.");
    assertPasskeyChallengeContext(request, challenge);

    const settings = await getSettings();
    if (passkeyLoginDisabled(settings)) throw new Error("Passkey login is disabled while SSO-only mode is active");

    const body = await request.json();
    const passkey = await getPasskeyByCredentialId(body.credential?.id);
    if (!passkey) throw new Error("Passkey not recognized");

    const verification = await verifyAuthenticationResponse({
      response: body.credential,
      expectedChallenge: challenge.challenge,
      expectedOrigin: challenge.origin,
      expectedRPID: challenge.rpID,
      requireUserVerification: true,
      credential: {
        id: passkey.id,
        publicKey: decodePasskeyPublicKey(passkey.publicKey),
        counter: passkey.counter,
        transports: passkey.transports,
      },
    });

    if (!verification.verified) throw new Error("Passkey verification failed");

    await updatePasskeyUsage(passkey.id, {
      counter: verification.authenticationInfo.newCounter,
      deviceType: verification.authenticationInfo.credentialDeviceType,
      backedUp: verification.authenticationInfo.credentialBackedUp,
    });
    recordSuccess(ip);

    const response = NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
    await setDashboardAuthCookie(response.cookies, request, { passkey: true });
    return clearPasskeyChallengeCookie(response);
  } catch (error) {
    console.warn("[Passkeys] Authentication failed:", error.message);
    recordFail(ip);
    const postLock = checkLock(ip);
    const response = NextResponse.json(
      {
        error: postLock.locked
          ? `Too many failed attempts. Try again in ${postLock.retryAfter}s.`
          : error.message || "Passkey login failed",
        retryAfter: postLock.locked ? postLock.retryAfter : undefined,
      },
      { status: postLock.locked ? 429 : 401 }
    );
    return clearPasskeyChallengeCookie(response);
  }
}
