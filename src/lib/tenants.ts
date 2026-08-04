// ---------------------------------------------------------------------------
// Tenant registry
//
// The portal runs the same software for more than one organization. Each one is
// a *tenant*: its own login company code, its own branding, and — the point of
// the whole arrangement — its own Postgres database. Nothing is shared between
// tenants at the storage layer, so there is no query, however wrong, that can
// return one organization's rows to another's screen.
//
// This module is deliberately dependency-free (no `next/headers`, no database
// client) so it can be imported from the edge middleware, server components,
// server actions, and the `db/setup.mjs` seed script alike.
//
// Adding a tenant is three steps:
//   1. create a database for them and put its connection string in a new env
//      var (see `databaseUrlEnv` below),
//   2. add an entry to TENANTS here,
//   3. run `npm run db:setup -- --tenant <code>` against the new database.
// ---------------------------------------------------------------------------

/** An image brand mark shown next to (or instead of) the wordmark. */
export type TenantMark = {
  src: string;
  width: number;
  height: number;
  alt: string;
};

export type TenantBrand = {
  /** Text wordmark. Always rendered — it is the accessible name of the brand. */
  wordmark: string;
  /** Optional logo image shown beside the wordmark. */
  mark: TenantMark | null;
  /** Favicon path under /public, or null to leave the browser default. */
  icon: string | null;
  /** Apple touch icon path under /public, or null. */
  appleIcon: string | null;
  /** Sub-label under the logo on the sign-in screen. */
  tagline: string;
};

export type Tenant = {
  /** The company code typed on the sign-in form. Lowercase, stable. */
  code: string;
  /** Display name, e.g. on the print headers and the app bar. */
  name: string;
  /** Value of the `data-tenant` attribute driving the CSS theme. */
  theme: string;
  /**
   * Name of the environment variable holding this tenant's Postgres connection
   * string. Each tenant points at a *different* database — that separation is
   * what keeps their data apart, and `src/lib/db.ts` refuses to start a tenant
   * whose URL matches another's.
   */
  databaseUrlEnv: string;
  /**
   * Hostnames that belong to this organization. A request arriving on one of
   * them is theirs — see `tenantForHost`. Add production domains here, or set
   * them at deploy time with TENANT_HOSTS; both are read, and both are exact
   * matches. There is deliberately no pattern matching (see `tenantForHost`).
   */
  hosts: string[];
  brand: TenantBrand;
};

export const TENANTS: Record<string, Tenant> = {
  fce: {
    code: "fce",
    name: "Flood City Elite",
    theme: "flood-city",
    databaseUrlEnv: "DATABASE_URL",
    hosts: [],
    brand: {
      wordmark: "Flood City Elite",
      mark: null,
      icon: null,
      appleIcon: null,
      tagline: "Member Portal",
    },
  },
  fennell: {
    code: "fennell",
    name: "Fennell Bros.",
    theme: "fennell",
    databaseUrlEnv: "FENNELL_DATABASE_URL",
    hosts: [],
    brand: {
      wordmark: "Fennell Bros.",
      mark: {
        src: "/brand/fennell-mark.webp",
        width: 381,
        height: 420,
        alt: "Fennell Bros.",
      },
      icon: "/brand/fennell-icon.png",
      appleIcon: "/brand/fennell-icon-180.png",
      tagline: "Member Portal",
    },
  },
};

/** The tenant a request falls back to when nothing else identifies one. */
export const DEFAULT_TENANT_CODE = "fce";

export const DEFAULT_TENANT: Tenant = TENANTS[DEFAULT_TENANT_CODE];

/** Request header the middleware uses to hand the resolved tenant downstream. */
export const TENANT_HEADER = "x-portal-tenant";

/**
 * Request header marking the tenant as *fixed* for this request — decided by the
 * deployment or the domain rather than by anything the visitor did.
 *
 * When it is set, the portal stops behaving like a multi-organization login and
 * starts behaving like that one organization's own site: the sign-in form drops
 * its company-code field, and a session belonging to anybody else is refused.
 */
export const TENANT_LOCK_HEADER = "x-portal-tenant-locked";

/** Cookie that keeps a public (logged-out) visitor on the tenant they arrived at. */
export const TENANT_COOKIE = "portal_tenant";

/** Query parameter that points a public link at a tenant, e.g. `/payroll?c=fennell`. */
export const TENANT_QUERY_PARAM = "c";

export function tenantList(): Tenant[] {
  return Object.values(TENANTS);
}

/**
 * The tenants this deployment can actually serve — the ones whose database
 * connection string is set. A registry entry with no database behind it is not
 * something this deployment can be, which is what makes "is it obvious which
 * organization this request is for?" answerable (see `tenantIsAmbiguous`).
 */
export function configuredTenants(): Tenant[] {
  return tenantList().filter(
    (tenant) => (process.env[tenant.databaseUrlEnv] ?? "").trim() !== "",
  );
}

/**
 * The tenant this whole deployment is dedicated to, set with the PORTAL_TENANT
 * environment variable, or null when the deployment serves every organization.
 *
 * Set it and the build stops being a shared portal: every request belongs to
 * that one organization no matter what hostname it arrived on, the sign-in
 * screen never asks for a company code, and there is nothing on the site to
 * suggest anybody else uses the software. That is what running one Vercel
 * project per organization buys — the same repository deployed twice, each copy
 * pinned to its own tenant and its own database.
 */
export function pinnedTenant(): Tenant | null {
  return getTenant(process.env.PORTAL_TENANT);
}

/** Look a tenant up by company code. Returns null for anything unrecognised. */
export function getTenant(code: string | null | undefined): Tenant | null {
  if (!code) return null;
  return TENANTS[code.trim().toLowerCase()] ?? null;
}

/**
 * Look a tenant up by company code, throwing when it is unknown.
 *
 * Used on the paths where guessing would be dangerous — resolving the database
 * for an existing session, say. A stale cookie naming a tenant we no longer
 * have must fail the request, not quietly fall back to somebody else's data.
 */
export function requireTenant(code: string | null | undefined): Tenant {
  const tenant = getTenant(code);
  if (!tenant) {
    throw new Error(
      `Unknown tenant code ${JSON.stringify(code)}. Known codes: ${Object.keys(
        TENANTS,
      ).join(", ")}.`,
    );
  }
  return tenant;
}

/**
 * Map a request hostname to a tenant, so each organization can have its own
 * domain. Returns null for any hostname that was not explicitly configured.
 *
 * Hosts come from each tenant's `hosts` list and from the TENANT_HOSTS
 * environment variable, a comma-separated list of `code=hostname` pairs:
 *
 *   TENANT_HOSTS="fennell=portal.fennellbros.com,fce=portal.floodcityelite.com"
 *
 * **Exact matches only, by design.** An earlier version also matched a tenant's
 * code against the hostname's dot/dash-separated labels, to save configuring
 * preview deployments. Guessing turned out to be wrong in both directions:
 * `portal.fennellbros.com` does *not* contain the label `fennell`, so the
 * organization's real domain silently fell through to the default tenant and
 * would have filed their families' data under another club — while a Vercel
 * preview URL built from a branch named `…-fennell-bros-…` *does* contain it,
 * so Flood City Elite's own preview would have resolved to Fennell and opened
 * their database. Any hostname an attacker controls matched just as readily.
 * A hostname is a boundary between two organizations' data; it is not somewhere
 * to be clever.
 */
export function tenantForHost(host: string | null | undefined): Tenant | null {
  if (!host) return null;
  // Strip the port and normalise; hostnames are case-insensitive.
  const hostname = host.split(":")[0]!.trim().toLowerCase();
  if (!hostname) return null;

  for (const pair of (process.env.TENANT_HOSTS ?? "").split(",")) {
    const [rawCode, rawHost] = pair.split("=");
    if (!rawCode || !rawHost) continue;
    if (rawHost.trim().toLowerCase() === hostname) {
      const tenant = getTenant(rawCode);
      if (tenant) return tenant;
    }
  }

  for (const tenant of tenantList()) {
    if (tenant.hosts.some((h) => h.trim().toLowerCase() === hostname)) {
      return tenant;
    }
  }

  return null;
}
