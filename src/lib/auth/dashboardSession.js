import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DATA_DIR } from "@/lib/dataDir";
import { getSettings } from "@/lib/localDb";

const DEFAULT_PASSWORD = "123456";
// Sessão deslizante: o token vale 30 dias, mas é reemitido (rolling) quando
// passa de 24h de uso. Com uso constante a sessão nunca expira — o logout é
// sempre explícito, pelo botão Sair. Sem uso por 30 dias, expira.
const SESSION_COOKIE_MAX_AGE_SEC = 30 * 24 * 60 * 60;
const SESSION_REFRESH_AFTER_SEC = 24 * 60 * 60;
// Claims de controle do JWT que não devem ser copiadas ao reemitir o token.
const RESERVED_JWT_CLAIMS = new Set(["iat", "exp", "nbf", "iss", "aud", "jti", "sub"]);

function loadJwtSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const file = path.join(DATA_DIR, "jwt-secret");
  try {
    return fs.readFileSync(file, "utf8").trim();
  } catch {}
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const generated = crypto.randomBytes(32).toString("hex");
  fs.writeFileSync(file, generated, { mode: 0o600 });
  return generated;
}

// Lê o segredo sob demanda em vez de congelar no import: se o arquivo
// jwt-secret for regenerado (ex.: DATA_DIR resolveu diferente entre boots),
// o processo passa a validar com o segredo atual em vez de derrubar todas
// as sessões ativas de uma vez.
let cachedSecret = null;
let cachedSecretKey = null;
function getSecret() {
  if (process.env.JWT_SECRET) return new TextEncoder().encode(process.env.JWT_SECRET);
  const file = path.join(DATA_DIR, "jwt-secret");
  try {
    const mtimeMs = fs.statSync(file).mtimeMs;
    if (!cachedSecret || cachedSecretKey !== `${file}:${mtimeMs}`) {
      cachedSecret = new TextEncoder().encode(fs.readFileSync(file, "utf8").trim());
      cachedSecretKey = `${file}:${mtimeMs}`;
    }
    return cachedSecret;
  } catch {
    cachedSecret = new TextEncoder().encode(loadJwtSecret());
    try {
      cachedSecretKey = `${file}:${fs.statSync(file).mtimeMs}`;
    } catch {
      cachedSecretKey = null;
    }
    return cachedSecret;
  }
}

export function shouldUseSecureCookie(request) {
  const forceSecureCookie = process.env.AUTH_COOKIE_SECURE === "true";
  const forwardedProto = request?.headers?.get?.("x-forwarded-proto");
  const isHttpsRequest = forwardedProto === "https";
  return forceSecureCookie || isHttpsRequest;
}

export async function createDashboardAuthToken(claims = {}) {
  return new SignJWT({ authenticated: true, ...claims })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_COOKIE_MAX_AGE_SEC}s`)
    .sign(getSecret());
}

export async function verifyDashboardAuthToken(token) {
  if (!token) return false;
  try {
    await jwtVerify(token, getSecret());
    return true;
  } catch {
    return false;
  }
}

export async function getDashboardAuthSession(token) {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSecret());
    return payload;
  } catch {
    return null;
  }
}

// Rolling session: passado o limiar, reemite o token com iat/exp novos
// (preservando os claims de login) e renova o cookie. Um usuário ativo
// renova antes do vencimento, então a sessão só termina no logout.
export async function refreshDashboardSessionIfStale(response, request, session) {
  const iat = Number(session?.iat);
  if (!Number.isFinite(iat)) return false;
  if (Math.floor(Date.now() / 1000) - iat < SESSION_REFRESH_AFTER_SEC) return false;

  const claims = {};
  for (const [key, value] of Object.entries(session)) {
    if (!RESERVED_JWT_CLAIMS.has(key)) claims[key] = value;
  }

  const token = await createDashboardAuthToken(claims);
  response.cookies.set("auth_token", token, {
    httpOnly: true,
    secure: shouldUseSecureCookie(request),
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_COOKIE_MAX_AGE_SEC,
  });
  return true;
}

export async function setDashboardAuthCookie(cookieStore, request, claims = {}) {
  const token = await createDashboardAuthToken(claims);
  cookieStore.set("auth_token", token, {
    httpOnly: true,
    secure: shouldUseSecureCookie(request),
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_COOKIE_MAX_AGE_SEC,
  });
}

export function clearDashboardAuthCookie(cookieStore) {
  cookieStore.set("auth_token", "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

export { SESSION_COOKIE_MAX_AGE_SEC, SESSION_REFRESH_AFTER_SEC };

// Verify the current dashboard password (re-auth for sensitive actions).
export async function verifyDashboardPassword(password) {
  if (typeof password !== "string" || !password) return false;
  const settings = await getSettings();
  const storedHash = settings?.password;
  if (storedHash) return bcrypt.compare(password, storedHash);
  const initialPassword = process.env.INITIAL_PASSWORD || DEFAULT_PASSWORD;
  return password === initialPassword;
}
