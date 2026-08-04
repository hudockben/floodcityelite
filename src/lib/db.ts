import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { currentTenant } from "@/lib/tenant";
import { tenantList, type Tenant } from "@/lib/tenants";

export type Db = NeonQueryFunction<false, false>;

// One Neon client per tenant, created lazily so a missing connection string
// only fails at request time (not at build time / module import).
const clients = new Map<string, Db>();

function connectionStringFor(tenant: Tenant): string {
  const url = process.env[tenant.databaseUrlEnv]?.trim();
  if (!url) {
    throw new Error(
      `${tenant.databaseUrlEnv} is not set, so the ${tenant.name} portal has no database. ` +
        `Add that organization's Neon connection string to .env.local (see .env.example).`,
    );
  }
  return url;
}

/**
 * Refuse to serve a tenant whose database is another tenant's database.
 *
 * Every organization on this portal gets its own set of tables. Pointing two of
 * them at one connection string would put their rows back together — the exact
 * blending the split exists to prevent — and it would do so silently, because
 * every query would still "work". A misconfigured environment has to be a hard
 * error, not a data leak.
 */
function assertIsolated(tenant: Tenant, url: string): void {
  for (const other of tenantList()) {
    if (other.code === tenant.code) continue;
    const otherUrl = process.env[other.databaseUrlEnv]?.trim();
    if (otherUrl && otherUrl === url) {
      throw new Error(
        `${tenant.databaseUrlEnv} and ${other.databaseUrlEnv} point at the same database. ` +
          `${tenant.name} and ${other.name} must each have their own, or their data would share tables.`,
      );
    }
  }
}

/**
 * The Neon client for a specific tenant. Use this where the tenant is already
 * known from something other than the request context — signing in, for
 * instance, where the company code comes off the login form.
 */
export function dbFor(tenant: Tenant): Db {
  const existing = clients.get(tenant.code);
  if (existing) return existing;

  const url = connectionStringFor(tenant);
  assertIsolated(tenant, url);
  const client = neon(url);
  clients.set(tenant.code, client);
  return client;
}

/**
 * The database for the tenant this request belongs to.
 *
 * Callers use it exactly like a Neon client — ``await sql()`SELECT …` `` — but
 * every query resolves its tenant first (see `currentTenant`) and runs against
 * that organization's own database. There is no ambient "current connection"
 * to get wrong: a query cannot be issued without a tenant having been resolved
 * for it, and each tenant's tables live somewhere the others cannot reach.
 */
export function sql(): Db {
  return lazyClient;
}

const lazyClient: Db = (() => {
  const run = async (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<unknown> => {
    const tenant = await currentTenant();
    const client = dbFor(tenant) as unknown as (
      strings: TemplateStringsArray,
      ...values: unknown[]
    ) => Promise<unknown>;
    return client(strings, ...values);
  };

  // `transaction()` is always called with a callback that receives the real
  // client's `txn` builder, so it delegates once the tenant is known.
  (run as unknown as { transaction: unknown }).transaction = async (
    ...args: unknown[]
  ): Promise<unknown> => {
    const tenant = await currentTenant();
    const client = dbFor(tenant) as unknown as {
      transaction: (...a: unknown[]) => Promise<unknown>;
    };
    return client.transaction(...args);
  };

  return run as unknown as Db;
})();
