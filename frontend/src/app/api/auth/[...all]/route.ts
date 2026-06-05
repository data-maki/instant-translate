import { NextRequest, NextResponse } from "next/server";
import {
  AUTH_COOKIE,
  createSessionToken,
  getSession,
  sessionFromToken,
  sessionMaxAge,
  validCredentials
} from "@/lib/auth";

function authPath(request: NextRequest) {
  return request.nextUrl.pathname.replace(/^\/api\/auth\/?/, "");
}

function authError(message: string, status = 401) {
  return NextResponse.json({ code: "AUTH_FAILED", message }, { status });
}

function setSessionCookie(response: NextResponse, token: string) {
  response.cookies.set(AUTH_COOKIE, token, {
    httpOnly: true,
    maxAge: sessionMaxAge(),
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production"
  });
}

async function readBody(request: NextRequest) {
  return await request.json().catch(() => ({})) as {
    email?: unknown;
    password?: unknown;
  };
}

async function handleEmailAuth(request: NextRequest) {
  const body = await readBody(request);
  const email = typeof body.email === "string" ? body.email : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!validCredentials(email, password)) {
    return authError("Invalid email or password.");
  }

  const token = createSessionToken();
  const session = sessionFromToken(token);
  const response = NextResponse.json({
    user: session.user,
    token,
    redirect: false,
    url: null
  });
  setSessionCookie(response, token);
  return response;
}

export async function GET(request: NextRequest) {
  if (authPath(request) !== "get-session") {
    return authError("Unknown auth route.", 404);
  }

  return NextResponse.json(getSession(request.headers));
}

export async function POST(request: NextRequest) {
  const path = authPath(request);

  if (path === "sign-in/email" || path === "sign-up/email") {
    return handleEmailAuth(request);
  }

  if (path === "sign-out") {
    const response = NextResponse.json({ success: true });
    response.cookies.delete(AUTH_COOKIE);
    return response;
  }

  return authError("Unknown auth route.", 404);
}
