import { NextResponse } from "next/server";
import { verifyRegistrationResponse } from "@simplewebauthn/server";
import { createPasskey, getPasskeyCount } from "@/lib/localDb";
import {
  PASSKEY_CHALLENGE_COOKIE,
  assertPasskeyChallengeContext,
  clearPasskeyChallengeCookie,
  consumePasskeyChallenge,
  encodePasskeyPublicKey,
} from "@/lib/auth/passkeys";

export async function POST(request) {
  const challengeId = request.cookies.get(PASSKEY_CHALLENGE_COOKIE)?.value;
  const challenge = consumePasskeyChallenge(challengeId, "registration");

  try {
    if (!challenge) throw new Error("Passkey registration expired. Try again.");
    assertPasskeyChallengeContext(request, challenge);

    const body = await request.json();
    const verification = await verifyRegistrationResponse({
      response: body.credential,
      expectedChallenge: challenge.challenge,
      expectedOrigin: challenge.origin,
      expectedRPID: challenge.rpID,
      requireUserVerification: true,
    });

    if (!verification.verified || !verification.registrationInfo) {
      throw new Error("Passkey registration could not be verified");
    }

    const count = await getPasskeyCount();
    const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
    const passkey = await createPasskey({
      id: credential.id,
      publicKey: encodePasskeyPublicKey(credential.publicKey),
      counter: credential.counter,
      transports: credential.transports || body.credential?.response?.transports || [],
      deviceType: credentialDeviceType,
      backedUp: credentialBackedUp,
      name: `Passkey ${count + 1}`,
      createdAt: new Date().toISOString(),
    });

    return clearPasskeyChallengeCookie(NextResponse.json({ passkey }, { status: 201 }));
  } catch (error) {
    console.warn("[Passkeys] Registration verification failed:", error.message);
    const status = /UNIQUE|constraint/i.test(error.message) ? 409 : 400;
    return clearPasskeyChallengeCookie(
      NextResponse.json({ error: status === 409 ? "This passkey is already registered" : error.message || "Failed to register passkey" }, { status })
    );
  }
}
