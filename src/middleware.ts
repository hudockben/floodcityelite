import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";
import {
  TENANT_COOKIE,
  TENANT_HEADER,
  TENANT_QUERY_PARAM,
  getTenant,
  tenantForHost,
  type Tenant,
} from "@/lib/tenants";

const COOKIE_NAME = "fce_session";

// Sections that require a signed-in user. Everything else the middleware sees
// (the sign-in screen and the two public forms) is reachable logged out — it
// runs on those routes only to work out which organization the visitor is on.
const PROTECTED_PREFIXES = [
  "/homeplate",
  "/teams",
  "/roster-submissions",
  "/payment-tracker",
  "/budgets",
  "/fixed-cost",
  "/fundraiser-tracker",
  "/program-camps",
  "/payroll-admin",
  "/schedules",
  "/contact-info",
  "/hotels",
  "/inventory",
];

type SessionClaims = { user?: { companyCode?: string } };

async function readSession(
  token: string | undefined,
): Promise<SessionClaims | null> {
  if (!token) return null;
  const secret = process.env.SESSION_SECRET;
  if (!secret) return null;
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
      algorithms: ["HS256"],
    });
    return payload as SessionClaims;
  } catch {
    return null;
  }
}

/**
 * Work out which organization a request belongs to, most trustworthy source
 * first:
 *
 *   1. the signed session cookie — for anyone logged in this settles it;
 *   2. the hostname, so each organization can have its own domain;
 *   3. the `?c=` parameter, which is how a public link names its organization
 *      (e.g. `/roster-acceptance?c=fennell`);
 *   4. the tenant cookie, which remembers 2 or 3 across the form's POST.
 *
 * Returns the tenant along with whether it came from a source worth remembering
 * in a cookie. Nothing here reads the request body: a visitor cannot post their
 * way onto another organization's database.
 */
function resolveTenant(
  req: NextRequest,
  session: SessionClaims | null,
): { tenant: Tenant | null; persist: boolean } {
  const fromSession = getTenant(session?.user?.companyCode);
  if (fromSession) return { tenant: fromSession, persist: false };

  const fromHost = tenantForHost(req.headers.get("host") ?? req.nextUrl.host);
  if (fromHost) return { tenant: fromHost, persist: true };

  const fromQuery = getTenant(req.nextUrl.searchParams.get(TENANT_QUERY_PARAM));
  if (fromQuery) return { tenant: fromQuery, persist: true };

  const fromCookie = getTenant(req.cookies.get(TENANT_COOKIE)?.value);
  if (fromCookie) return { tenant: fromCookie, persist: false };

  return { tenant: null, persist: false };
}

export async function middleware(req: NextRequest) {
  const session = await readSession(req.cookies.get(COOKIE_NAME)?.value);
  const { tenant, persist } = resolveTenant(req, session);

  const { pathname } = req.nextUrl;
  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(prefix + "/"),
  );

  if (isProtected && !session) {
    const url = req.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // Hand the resolved tenant to the server components and actions downstream.
  // Always write the header (deleting it when there is no tenant) so a request
  // cannot smuggle one in by sending the header itself.
  const headers = new Headers(req.headers);
  if (tenant) headers.set(TENANT_HEADER, tenant.code);
  else headers.delete(TENANT_HEADER);

  const res = NextResponse.next({ request: { headers } });

  if (tenant && persist) {
    res.cookies.set(TENANT_COOKIE, tenant.code, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
  }

  return res;
}

// Run on every page and server action so the tenant header is always set — the
// public forms need it as much as the member area does. Static assets and the
// brand images are skipped.
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|brand/|favicon.ico|robots.txt|sitemap.xml).*)",
  ],
};
