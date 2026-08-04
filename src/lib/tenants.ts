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
  brand: TenantBrand;
};

export const TENANTS: Record<string, Tenant> = {
  fce: {
    code: "fce",
    name: "Flood City Elite",
    theme: "flood-city",
    databaseUrlEnv: "DATABASE_URL",
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
 * domain.
 *
 * Hosts are configured with the TENANT_HOSTS environment variable, a
 * comma-separated list of `code=hostname` pairs:
 *
 *   TENANT_HOSTS="fennell=portal.fennellbros.com,fce=portal.floodcityelite.com"
 *
 * With nothing configured we fall back to matching the tenant code against the
 * hostname's own labels (`fennell.example.com`, `fennell-portal.vercel.app`),
 * which covers preview deployments without any extra setup.
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

  // Fall back to the hostname's labels, e.g. "fennell.example.com" or
  // "fennell-portal.vercel.app". Matching whole dash/dot-separated words only,
  // so a code never matches a fragment of an unrelated domain.
  const labels = new Set(hostname.split(/[.-]/).filter(Boolean));
  for (const tenant of tenantList()) {
    if (labels.has(tenant.code)) return tenant;
  }

  return null;
}
