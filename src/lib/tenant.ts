import { headers } from "next/headers";
import { getSession } from "@/lib/session";
import {
  DEFAULT_TENANT,
  TENANT_HEADER,
  getTenant,
  requireTenant,
  type Tenant,
} from "@/lib/tenants";

// ---------------------------------------------------------------------------
// Which tenant is this request for?
//
// Two sources, in order of trust:
//
//   1. The session cookie. It is a signed JWT, so the company code inside it is
//      not something a visitor can edit — for anyone logged in, this is the
//      whole answer. An unrecognised code throws rather than falling back, so a
//      stale cookie can never point a query at another organization's database.
//   2. The `x-portal-tenant` header the middleware sets from the hostname, the
//      `?c=` link parameter, or the tenant cookie. This is what the public,
//      login-free pages (payroll, roster acceptance) run on.
//
// With neither, we serve the default tenant — which is what a bare visit to the
// original Flood City Elite deployment has always been.
// ---------------------------------------------------------------------------

export async function currentTenant(): Promise<Tenant> {
  const session = await getSession();
  if (session) return requireTenant(session.companyCode);

  try {
    const store = await headers();
    const fromHeader = getTenant(store.get(TENANT_HEADER));
    if (fromHeader) return fromHeader;
  } catch {
    // `headers()` is unavailable outside a request scope (e.g. during static
    // prerendering). Fall through to the default tenant.
  }

  return DEFAULT_TENANT;
}
