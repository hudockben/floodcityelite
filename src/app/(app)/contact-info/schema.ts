import { sql } from "@/lib/db";
import { currentTenant } from "@/lib/tenant";

// Ensure the `college_coaches` table exists before the Contact Info tab reads
// or writes it. Like the other tabs' schema helpers, this lets the feature work
// on a database that predates it (e.g. a deployed Neon DB) without a separate
// migration step. The DDL mirrors db/schema.sql and db/setup.mjs and is
// idempotent.
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

export async function ensureCoachesSchema(): Promise<void> {
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
  const db = sql();

  // A college coach contact owned by a company. `sport` splits the tab into its
  // Baseball and Softball lists and uses the same two values as teams.sport.
  // Only the school is required — the rest of the contact (coach, phone, email,
  // website, level, conference, location, notes) fills in over time.
  await db`
    CREATE TABLE IF NOT EXISTS college_coaches (
      id              SERIAL        PRIMARY KEY,
      company_id      INTEGER       NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      sport           VARCHAR(16)   NOT NULL DEFAULT 'baseball'
                        CHECK (sport IN ('baseball', 'softball')),
      school_name     VARCHAR(160)  NOT NULL,
      coach_name      VARCHAR(160),
      coach_title     VARCHAR(120),
      division_level  VARCHAR(40),
      conference      VARCHAR(120),
      cell_phone      VARCHAR(40),
      email           VARCHAR(160),
      website         VARCHAR(300),
      city            VARCHAR(120),
      state           VARCHAR(40),
      notes           TEXT,
      created_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
      updated_at      TIMESTAMPTZ   NOT NULL DEFAULT now()
    )
  `;

  // The tab always reads one company's list for one sport.
  await db`
    CREATE INDEX IF NOT EXISTS idx_college_coaches_company_sport
      ON college_coaches (company_id, sport)
  `;
}
