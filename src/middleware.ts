import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";
import {
  TENANT_COOKIE,
  TENANT_HEADER,
  TENANT_LOCK_HEADER,
  TENANT_QUERY_PARAM,
  getTenant,
  pinnedTenant,
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

type Resolution = {
  tenant: Tenant | null;
  /** The organization is fixed by the deployment or the domain, not the visitor. */
  locked: boolean;
  /** Worth remembering in a cookie so a form POST lands on the same organization. */
  persist: boolean;
};

/**
 * Work out which organization a request belongs to.
 *
 * Two of the sources are *boundaries* rather than hints — a deployment pinned
 * with PORTAL_TENANT, and a hostname belonging to one organization. Where one of
 * those applies, it is the answer, and it outranks the session: somebody
 * arriving at Fennell's domain carrying a Flood City Elite cookie is shown
 * Fennell's sign-in screen, not somebody else's portal. Their session is refused
 * for this request (see `middleware`), not honoured quietly.
 *
 * Failing a boundary, this is a shared deployment where the organization is
 * whatever the visitor is already associated with:
 *
 *   1. the signed session cookie — for anyone logged in this settles it;
 *   2. the `?c=` parameter, which is how a public link names its organization
 *      (e.g. `/roster-acceptance?c=fennell`);
 *   3. the tenant cookie, which remembers 2 across the form's POST.
 *
 * Nothing here reads the request body: a visitor cannot post their way onto
 * another organization's database.
 */
function resolveTenant(
  req: NextRequest,
  session: SessionClaims | null,
): Resolution {
  const pinned = pinnedTenant();
  if (pinned) return { tenant: pinned, locked: true, persist: false };

  const fromHost = tenantForHost(req.headers.get("host") ?? req.nextUrl.host);
  if (fromHost) return { tenant: fromHost, locked: true, persist: false };

  const fromSession = getTenant(session?.user?.companyCode);
  if (fromSession) return { tenant: fromSession, locked: false, persist: false };

  const fromQuery = getTenant(req.nextUrl.searchParams.get(TENANT_QUERY_PARAM));
  if (fromQuery) return { tenant: fromQuery, locked: false, persist: true };

  const fromCookie = getTenant(req.cookies.get(TENANT_COOKIE)?.value);
  if (fromCookie) return { tenant: fromCookie, locked: false, persist: false };

  return { tenant: null, locked: false, persist: false };
}

export async function middleware(req: NextRequest) {
  const session = await readSession(req.cookies.get(COOKIE_NAME)?.value);
  const { tenant, locked, persist } = resolveTenant(req, session);

  // A session only counts here if it belongs to the organization this request is
  // for. On a dedicated deployment or domain that is a real check: a Flood City
  // Elite cookie presented at Fennell's address is not a login, it is somebody
  // else's session, and it is dropped rather than followed to another portal.
  const sessionBelongs =
    session != null &&
    (!locked || session.user?.companyCode === tenant?.code);

  const { pathname } = req.nextUrl;
  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(prefix + "/"),
  );

  if (isProtected && !sessionBelongs) {
    const url = req.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    const redirect = NextResponse.redirect(url);
    // Clear the foreign session on the way out, so they land on a clean sign-in
    // screen for this organization instead of bouncing off the guard forever.
    if (session && !sessionBelongs) redirect.cookies.delete(COOKIE_NAME);
    return redirect;
  }

  // Hand the resolved tenant to the server components and actions downstream.
  // Always write these headers (deleting them when they do not apply) so a
  // request cannot smuggle either one in by sending it itself.
  const headers = new Headers(req.headers);
  if (tenant) headers.set(TENANT_HEADER, tenant.code);
  else headers.delete(TENANT_HEADER);
  if (locked) headers.set(TENANT_LOCK_HEADER, "1");
  else headers.delete(TENANT_LOCK_HEADER);

  const res = NextResponse.next({ request: { headers } });

  // A foreign session on an unprotected page (the sign-in screen itself, say)
  // is cleared too, so the visitor is not silently carrying it around.
  if (session && !sessionBelongs) res.cookies.delete(COOKIE_NAME);

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
