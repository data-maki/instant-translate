import { createHmac, timingSafeEqual } from "crypto";

export const AUTH_COOKIE = "cottonoha.session_token";

const SESSION_DAYS = 30;
const SESSION_SECONDS = SESSION_DAYS * 24 * 60 * 60;
const USER_ID = "env-user";

type AuthHeaders = {
  get(name: string): string | null;
};

export type SimpleSession = {
  session: {
    id: string;
    userId: string;
    token: string;
    ipAddress: string;
    userAgent: string;
    expiresAt: string;
    createdAt: string;
    updatedAt: string;
  };
  user: {
    id: string;
    email: string;
    name: string;
    image: string | null;
    emailVerified: boolean;
    createdAt: string;
    updatedAt: string;
  };
};

function configuredEmail() {
  return process.env.EMAIL?.trim().toLowerCase() || "";
}

function configuredPassword() {
  return process.env.PASSWORD || "";
}

function signingKey() {
  return process.env.PASSWORD || process.env.AUTH_SECRET || "dev-only-auth-secret";
}

function base64Url(input: string) {
  return Buffer.from(input).toString("base64url");
}

function sign(payload: string) {
  return createHmac("sha256", signingKey()).update(payload).digest("base64url");
}

function equal(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function cookieToken(cookieHeader: string | null) {
  if (!cookieHeader) return null;
  for (const cookie of cookieHeader.split(";")) {
    const [name, ...value] = cookie.trim().split("=");
    if (name === AUTH_COOKIE) return value.join("=");
  }
  return null;
}

function bearerToken(authorization: string | null) {
  if (!authorization?.startsWith("Bearer ")) return null;
  return authorization.slice("Bearer ".length).trim() || null;
}

export function validCredentials(email: string, password: string) {
  const expectedEmail = configuredEmail();
  const expectedPassword = configuredPassword();
  if (!expectedEmail || !expectedPassword) return false;
  return email.trim().toLowerCase() === expectedEmail && password === expectedPassword;
}

export function createSessionToken() {
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + SESSION_SECONDS;
  const payload = base64Url(JSON.stringify({
    sub: USER_ID,
    email: configuredEmail(),
    iat: now,
    exp: expiresAt
  }));
  return `${payload}.${sign(payload)}`;
}

function verifySessionToken(token: string | null) {
  if (!token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature || !equal(signature, sign(payload))) return null;

  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      email?: unknown;
      exp?: unknown;
      iat?: unknown;
      sub?: unknown;
    };
    if (data.sub !== USER_ID || data.email !== configuredEmail()) return null;
    if (typeof data.exp !== "number" || data.exp <= Math.floor(Date.now() / 1000)) return null;
    return {
      createdAt: typeof data.iat === "number" ? data.iat : Math.floor(Date.now() / 1000),
      email: data.email,
      expiresAt: data.exp
    };
  } catch {
    return null;
  }
}

export function userName(email = configuredEmail()) {
  return email.split("@")[0] || "User";
}

export function sessionFromToken(
  token: string,
  createdAtSeconds = Math.floor(Date.now() / 1000),
  expiresAtSeconds = createdAtSeconds + SESSION_SECONDS
): SimpleSession {
  const createdAt = new Date(createdAtSeconds * 1000).toISOString();
  const updatedAt = createdAt;
  const expiresAt = new Date(expiresAtSeconds * 1000).toISOString();
  const email = configuredEmail();

  return {
    session: {
      id: token,
      userId: USER_ID,
      token,
      ipAddress: "",
      userAgent: "",
      expiresAt,
      createdAt,
      updatedAt
    },
    user: {
      id: USER_ID,
      email,
      name: userName(email),
      image: null,
      emailVerified: true,
      createdAt,
      updatedAt
    }
  };
}

export function getSession(headers: AuthHeaders): SimpleSession | null {
  const token = bearerToken(headers.get("authorization")) || cookieToken(headers.get("cookie"));
  const verified = verifySessionToken(token);
  if (!token || !verified) return null;
  return sessionFromToken(token, verified.createdAt, verified.expiresAt);
}

export function sessionMaxAge() {
  return SESSION_SECONDS;
}
