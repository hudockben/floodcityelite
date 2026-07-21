import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";

const COOKIE_NAME = "fce_session";

async function hasValidSession(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const secret = process.env.SESSION_SECRET;
  if (!secret) return false;
  try {
    await jwtVerify(token, new TextEncoder().encode(secret), {
      algorithms: ["HS256"],
    });
    return true;
  } catch {
    return false;
  }
}

export async function middleware(req: NextRequest) {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  if (await hasValidSession(token)) {
    return NextResponse.next();
  }
  const url = req.nextUrl.clone();
  url.pathname = "/";
  return NextResponse.redirect(url);
}

// Protect every authenticated section. The login page ("/") is not matched.
export const config = {
  matcher: [
    "/homeplate/:path*",
    "/payment-tracker/:path*",
    "/budgets/:path*",
    "/schedules/:path*",
    "/contact-info/:path*",
    "/yard-tournaments/:path*",
    "/inventory/:path*",
  ],
};
