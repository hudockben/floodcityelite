import { headers } from "next/headers";
import { getSession } from "@/lib/session";
import {
  DEFAULT_TENANT,
  TENANT_HEADER,
  TENANT_LOCK_HEADER,
  getTenant,
  pinnedTenant,
  requireTenant,
  type Tenant,
} from "@/lib/tenants";

// ---------------------------------------------------------------------------
// Which tenant is this request for?
//
// The middleware works this out once per request and hands the answer down in
// the `x-portal-tenant` header, so this is mostly a matter of reading it. The
// order below matters:
//
//   1. PORTAL_TENANT — a deployment dedicated to one organization. Nothing about
//      the request can override it.
//   2. The middleware's header. It has already weighed the domain against the
//      session (a domain belonging to one organization is a hard boundary: a
//      session for a different one is refused rather than honoured), and it
//      overwrites whatever header the caller sent, so a visitor cannot set it.
//   3. The session cookie, as a fallback for any request the middleware did not
//      run on. It is a signed JWT, so the company code inside it is not
//      something a visitor can edit. An unrecognised code throws rather than
//      falling back, so a stale cookie can never point a query at another
//      organization's database.
//
// With none of those, we serve the default tenant — which is what a bare visit
// to the original Flood City Elite deployment has always been.
// ---------------------------------------------------------------------------

export async function currentTenant(): Promise<Tenant> {
  const pinned = pinnedTenant();
  if (pinned) return pinned;

  try {
    const store = await headers();
    const fromHeader = getTenant(store.get(TENANT_HEADER));
    if (fromHeader) return fromHeader;
  } catch {
    // `headers()` is unavailable outside a request scope (e.g. during static
    // prerendering). Fall through to the session.
  }

  const session = await getSession();
  if (session) return requireTenant(session.companyCode);

  return DEFAULT_TENANT;
}

/**
 * Is the organization fixed for this request — decided by the deployment
 * (PORTAL_TENANT) or by the domain it arrived on, rather than by the visitor?
 *
 * When it is, the sign-in screen drops its company-code field and the login
 * action ignores any code that was posted: on their own domain, families should
 * see their club's portal, not a form asking which organization they belong to.
 */
export async function isTenantLocked(): Promise<boolean> {
  if (pinnedTenant()) return true;

  try {
    const store = await headers();
    return store.get(TENANT_LOCK_HEADER) === "1";
  } catch {
    return false;
  }
}
