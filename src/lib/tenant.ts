import { headers } from "next/headers";
import { getSession } from "@/lib/session";
import {
  DEFAULT_TENANT,
  TENANT_HEADER,
  TENANT_LOCK_HEADER,
  configuredTenants,
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

  // `headers()` is unavailable outside a request scope. Note what is *not*
  // caught here: when Next calls this during a static render, `headers()`
  // throws a bailout error that Next itself needs to see in order to mark the
  // route dynamic. Swallowing it would bake one organization's identity into a
  // page served to all of them, so anything with a `digest` — Next's marker for
  // its own control-flow errors — is rethrown.
  let store: Awaited<ReturnType<typeof headers>> | null = null;
  try {
    store = await headers();
  } catch (err) {
    if (err && typeof err === "object" && "digest" in err) throw err;
  }

  if (store) {
    const fromHeader = getTenant(store.get(TENANT_HEADER));
    if (fromHeader) return fromHeader;
  }

  const session = await getSession();
  if (session) return requireTenant(session.companyCode);

  return DEFAULT_TENANT;
}

/**
 * Did this request arrive with nothing at all to say which organization it is
 * for, on a deployment serving more than one?
 *
 * `currentTenant()` answers that case with the default tenant, which is right
 * for the original single-organization deployment and wrong the moment there
 * are two: a hostname somebody forgot to put in TENANT_HOSTS would quietly hand
 * a family the default club's form, and their child's details would be filed
 * under a club they have never heard of. Nobody would notice — the submission
 * succeeds, it just lands in the wrong database.
 *
 * So the login-free forms ask instead of guessing (see `OrganizationPicker`).
 * A signed-in user is never ambiguous, a dedicated deployment or domain is
 * never ambiguous, and a link carrying `?c=` is never ambiguous — this fires
 * only when a shared deployment genuinely cannot tell, which in a correct
 * configuration is never.
 */
export async function tenantIsAmbiguous(): Promise<boolean> {
  if (pinnedTenant()) return false;
  if (configuredTenants().length < 2) return false;

  // The middleware sets the header whenever it resolved a tenant from anything
  // at all, and deletes it otherwise — so its absence *is* "we do not know".
  try {
    const store = await headers();
    if (getTenant(store.get(TENANT_HEADER))) return false;
  } catch (err) {
    if (err && typeof err === "object" && "digest" in err) throw err;
    // Could not read the request. "Not ambiguous" would be a guess, and the
    // whole point of this question is to stop guessing — so answer the way that
    // asks the visitor rather than the way that files their data somewhere.
    return true;
  }

  return (await getSession()) == null;
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
  } catch (err) {
    // As above: Next's own bailout errors carry a `digest` and must reach it.
    if (err && typeof err === "object" && "digest" in err) throw err;
    return false;
  }
}
