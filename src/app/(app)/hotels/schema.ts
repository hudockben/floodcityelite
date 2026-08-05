import { sql } from "@/lib/db";
import { currentTenant } from "@/lib/tenant";
import { ensureSchedulesSchema } from "../schedules/schema";

// Ensure the `hotels` table exists before the Hotels tab reads or writes it.
// Like the other tabs' schema helpers, this lets the feature work on a database
// that predates it (e.g. a deployed Neon DB) without a separate migration step.
// The DDL mirrors db/schema.sql and db/setup.mjs and is idempotent.
//
// Memoized per server instance, keyed by organization: the DDL runs once per
// cold start per organization. Each organization has its own database, so a
// single shared memo would provision whichever one happened to warm this
// instance and leave the other with nothing — it would get the already-resolved
// promise back and run no DDL at all against its own database, which surfaces
// later as an intermittent missing-table error rather than anything obvious. If
// a provision fails (e.g. a transient connection error), only that
// organization's entry is cleared, so it retries on a later request without
// disturbing the other's.
const ensured = new Map<string, Promise<void>>();

export async function ensureHotelsSchema(): Promise<void> {
  const { code } = await currentTenant();
  let pending = ensured.get(code);
  if (!pending) {
    pending = provision().catch((err) => {
      ensured.delete(code);
      throw err;
    });
    ensured.set(code, pending);
  }
  return pending;
}

async function provision(): Promise<void> {
  // hotels reference schedule_events (the tournament a stay is for), so make
  // sure the schedule tables — and the teams/companies they hang off — exist
  // first. ensureSchedulesSchema is itself idempotent and memoized.
  await ensureSchedulesSchema();

  const db = sql();

  // A hotel the program books for travel, owned by a company. Only the name is
  // required. `division` is a teams division slug (or null), and `event_id`
  // ties the stay to a Schedules-tab tournament — nulled if that tournament is
  // later deleted, which is why `event_name` snapshots what it was for.
  await db`
    CREATE TABLE IF NOT EXISTS hotels (
      id                  SERIAL        PRIMARY KEY,
      company_id          INTEGER       NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      name                VARCHAR(160)  NOT NULL,
      address             VARCHAR(300),
      city                VARCHAR(120),
      state               VARCHAR(40),
      division            VARCHAR(32),
      event_id            INTEGER       REFERENCES schedule_events(id) ON DELETE SET NULL,
      event_name          VARCHAR(200),
      avg_cost_per_night  NUMERIC(10,2),
      phone               VARCHAR(40),
      website             VARCHAR(300),
      notes               TEXT,
      created_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
      updated_at          TIMESTAMPTZ   NOT NULL DEFAULT now()
    )
  `;

  await db`CREATE INDEX IF NOT EXISTS idx_hotels_company_id ON hotels (company_id)`;
  await db`CREATE INDEX IF NOT EXISTS idx_hotels_event_id ON hotels (event_id)`;
}
