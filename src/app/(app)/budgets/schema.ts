import { sql } from "@/lib/db";

// Ensure the `team_budgets` table exists before the Budgets tab reads or writes
// it. Like the Teams tab's ensureTeamsSchema, this lets the feature work on a
// database that predates it (e.g. a deployed Neon DB) without a separate
// migration step. The DDL mirrors db/schema.sql and db/setup.mjs and is
// idempotent.
//
// Memoized per server instance: the DDL runs once per cold start. If it fails
// (e.g. a transient connection error), the memo is cleared so a later request
// can retry.
let ensured: Promise<void> | null = null;

export function ensureBudgetsSchema(): Promise<void> {
  if (!ensured) {
    ensured = provision().catch((err) => {
      ensured = null;
      throw err;
    });
  }
  return ensured;
}

async function provision(): Promise<void> {
  const db = sql();

  // One budget row per team (team_id is the primary key). Money columns are
  // stored as NUMERIC. Everything defaults to 0 / NULL so a team can be listed
  // before its budget has been filled in. paying_players is an optional
  // override — when NULL the tab falls back to the team's roster count.
  await db`
    CREATE TABLE IF NOT EXISTS team_budgets (
      team_id                 INTEGER       PRIMARY KEY
                                REFERENCES teams(id) ON DELETE CASCADE,
      tuition_per_player      NUMERIC(12,2) NOT NULL DEFAULT 0,
      portion_to_team_budget  NUMERIC(12,2) NOT NULL DEFAULT 0,
      paying_players          INTEGER,
      created_at              TIMESTAMPTZ   NOT NULL DEFAULT now(),
      updated_at              TIMESTAMPTZ   NOT NULL DEFAULT now()
    )
  `;
}
