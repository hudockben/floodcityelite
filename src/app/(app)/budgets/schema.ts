import { sql } from "@/lib/db";
import { currentTenant } from "@/lib/tenant";

// Ensure the `team_budgets` table exists before the Budgets tab reads or writes
// it. Like the Teams tab's ensureTeamsSchema, this lets the feature work on a
// database that predates it (e.g. a deployed Neon DB) without a separate
// migration step. The DDL mirrors db/schema.sql and db/setup.mjs and is
// idempotent.
//
// Memoized per server instance and per organization: the DDL runs once per cold
// start per organization. The key matters because each organization has its own
// database — provision() runs against whichever one the request belongs to, so a
// single shared memo would let the organization that happened to warm the
// instance provision itself and hand every later request from the other one an
// already-resolved promise, skipping its DDL (and the portion_to_team_budget
// relaxation below, which budgets/actions.ts depends on) entirely. If a
// provision fails (e.g. a transient connection error), only that organization's
// memo is cleared, so it can retry on a later request without re-running the
// other's.
const ensured = new Map<string, Promise<void>>();

export async function ensureBudgetsSchema(): Promise<void> {
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

  // One budget row per team (team_id is the primary key). Money columns are
  // stored as NUMERIC. Everything defaults to 0 / NULL so a team can be listed
  // before its budget has been filled in. Two columns are optional overrides:
  // paying_players (NULL falls back to the team's roster count) and
  // portion_to_team_budget (NULL derives it — tuition per player minus the
  // program's fixed cost per player, from the Fixed Cost tab).
  await db`
    CREATE TABLE IF NOT EXISTS team_budgets (
      team_id                 INTEGER       PRIMARY KEY
                                REFERENCES teams(id) ON DELETE CASCADE,
      tuition_per_player      NUMERIC(12,2) NOT NULL DEFAULT 0,
      portion_to_team_budget  NUMERIC(12,2),
      paying_players          INTEGER,
      created_at              TIMESTAMPTZ   NOT NULL DEFAULT now(),
      updated_at              TIMESTAMPTZ   NOT NULL DEFAULT now()
    )
  `;

  // Let the portion be NULL on databases whose team_budgets predates the Fixed
  // Cost tab, where the column was NOT NULL DEFAULT 0. Existing rows keep their
  // saved number — so those budgets carry on unchanged, as manual overrides —
  // and clearing the field on the sheet hands the row to the derivation.
  await db`ALTER TABLE team_budgets ALTER COLUMN portion_to_team_budget DROP NOT NULL`;
  await db`ALTER TABLE team_budgets ALTER COLUMN portion_to_team_budget DROP DEFAULT`;

  // Ad-hoc expenses logged against a team (a coach's hotel, gas, gear, etc.).
  // Each row carries a date, vendor, amount, and a status: 'paid' is deducted
  // from the team's current balance, 'refund' is credited back, and 'not_paid'
  // is tracked without touching the balance. Totals are computed at read time.
  await db`
    CREATE TABLE IF NOT EXISTS team_expenses (
      id            SERIAL        PRIMARY KEY,
      team_id       INTEGER       NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      expense_date  DATE,
      vendor        VARCHAR(200),
      amount        NUMERIC(12,2) NOT NULL DEFAULT 0,
      status        VARCHAR(16)   NOT NULL DEFAULT 'paid'
                      CHECK (status IN ('paid', 'not_paid', 'refund')),
      created_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
      updated_at    TIMESTAMPTZ   NOT NULL DEFAULT now()
    )
  `;

  await db`CREATE INDEX IF NOT EXISTS idx_team_expenses_team_id ON team_expenses (team_id)`;
}
