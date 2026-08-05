import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";
import {
  TENANT_COOKIE,
  TENANT_HEADER,
  TENANT_LOCK_HEADER,
  TENANT_QUERY_PARAM,
  getSuppliedTenant,
  getTenant,
  pinnedTenant,
  tenantForHost,
  type Tenant,
} from "@/lib/tenants";

const COOKIE_NAME = "fce_session";

// Sections that require a signed-in user. Everything else the middleware sees
// (the sign-in screen, the two public forms, and the parents' message board) is
// reachable logged out — it runs on those routes only to work out which
// organization the visitor is on.
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
  "/dugout-admin",
  "/schedules",
  "/contact-info",
  "/hotels",
  "/inventory",
];

// The two login-free forms. They are the only pages that may be steered by a
// remembered cookie, since they are the only ones that take a submission from a
// visitor with no session to say who they are — the cookie exists to keep a
// form's POST on the organization its GET was rendered for.
//
// The public message board (/dugout) is deliberately not one of them. It writes
// nothing, so it has no POST to keep anywhere; it carries the organization in
// its own links instead, and a request that arrives naming nobody is asked
// rather than steered by a cookie some other page left behind.
const PUBLIC_FORM_PREFIXES = ["/payroll", "/roster-acceptance"];

function isPublicForm(pathname: string): boolean {
  return PUBLIC_FORM_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(prefix + "/"),
  );
}

/**
 * Is this the browser actually going to the page, rather than fetching it in
 * the background?
 *
 * Only a real navigation may leave a tenant cookie behind. An `<img>` pointed
 * at `/payroll?c=<other club>` on any page in the world gets a response, and so
 * does one of Next's own `<Link>` prefetches — neither involves a person
 * deciding anything, and both would otherwise plant a cookie that steers the
 * next family's submission. `Sec-Fetch-Dest` is set by the browser and cannot
 * be spoofed from page script; a client that omits it simply does not get the
 * cookie, which is the safe way to be wrong.
 */
function isDocumentNavigation(req: NextRequest): boolean {
  return (
    req.headers.get("sec-fetch-dest") === "document" &&
    req.headers.get("next-router-prefetch") == null
  );
}

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

  // `?c=` names the organization in a link. It is per-request and sits in plain
  // sight in the address bar, so it may be honoured anywhere.
  const fromQuery = getSuppliedTenant(
    req.nextUrl.searchParams.get(TENANT_QUERY_PARAM),
  );
  if (fromQuery) {
    return {
      tenant: fromQuery,
      locked: false,
      persist: isPublicForm(req.nextUrl.pathname) && isDocumentNavigation(req),
    };
  }

  // The cookie is different: it is remembered, so it decides requests that came
  // with nothing. It exists for exactly one job — keeping a form's POST on the
  // organization its GET was rendered for — so it is written and read only on
  // the two login-free forms. Consulted site-wide it was a hijack waiting to
  // happen: one visit to `/payroll?c=fennell`, which an image tag on any page
  // could cause, left a cookie that redirected the *next* family's submission
  // into the other club's database.
  if (isPublicForm(req.nextUrl.pathname)) {
    const fromCookie = getSuppliedTenant(req.cookies.get(TENANT_COOKIE)?.value);
    if (fromCookie) return { tenant: fromCookie, locked: false, persist: false };
  }

  return { tenant: null, locked: false, persist: false };
}

export async function middleware(req: NextRequest) {
  const session = await readSession(req.cookies.get(COOKIE_NAME)?.value);
  const { tenant, locked, persist } = resolveTenant(req, session);

  // A session counts only if it names an organization we still serve, and that
  // organization is the one this request resolved to.
  //
  // Both halves matter. The second is what makes a dedicated deployment or
  // domain a real boundary: a Flood City Elite cookie presented at Fennell's
  // address is not a login, it is somebody else's session, and it is dropped
  // rather than followed through to another club's portal. The first closes the
  // case of a session naming an organization that has since been removed from
  // the registry — those used to be treated as valid, which let one add
  // `?c=<other club>` to any page and browse that club's data behind a session
  // that no longer belonged anywhere.
  const sessionTenant = getTenant(session?.user?.companyCode);
  const sessionBelongs =
    session != null &&
    sessionTenant != null &&
    sessionTenant.code === tenant?.code;

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
    // No `maxAge`: a session cookie, gone when the browser closes. It only has
    // to survive the few seconds between a form rendering and being submitted,
    // and the longer it lives the longer it can point somebody's submission at
    // the wrong organization.
    res.cookies.set(TENANT_COOKIE, tenant.code, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
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
