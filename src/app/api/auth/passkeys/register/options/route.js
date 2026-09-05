import { NextResponse } from "next/server";
import { generateRegistrationOptions } from "@simplewebauthn/server";
import { getPasskeys } from "@/lib/localDb";
import {
  createPasskeyChallenge,
  getPasskeyRequestContext,
  setPasskeyChallengeCookie,
} from "@/lib/auth/passkeys";

const LOCAL_USER_ID = new TextEncoder().encode("orbit-router-local-user");

export async function POST(request) {
  try {
    const { origin, rpID } = getPasskeyRequestContext(request);
    const passkeys = await getPasskeys();
    const options = await generateRegistrationOptions({
      rpName: "Orbit Router",
      rpID,
      userID: LOCAL_USER_ID,
      userName: "local-user",
      userDisplayName: "Local User",
      attestationType: "none",
      excludeCredentials: passkeys.map((passkey) => ({
        id: passkey.id,
        transports: passkey.transports,
      })),
      authenticatorSelection: {
        residentKey: "required",
        userVerification: "required",
      },
    });

    const challengeId = createPasskeyChallenge("registration", {
      challenge: options.challenge,
      origin,
      rpID,
    });
    const response = NextResponse.json(options, { headers: { "Cache-Control": "no-store" } });
    return setPasskeyChallengeCookie(response, request, challengeId);
  } catch (error) {
    return NextResponse.json({ error: error.message || "Failed to start passkey registration" }, { status: 400 });
  }
}
