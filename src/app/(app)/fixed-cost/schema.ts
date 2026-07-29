import { sql } from "@/lib/db";
import { ensureTeamsSchema } from "../teams/schema";

// Ensure the fixed-cost tables exist before the Fixed Cost tab (or the Budgets
// tab, which reads the per-player figure) touches them. Like the other tabs'
// schema helpers, this lets the feature work on a database that predates it
// (e.g. a deployed Neon DB) without a separate migration step. The DDL mirrors
// db/schema.sql and db/setup.mjs and is idempotent.
//
// Memoized per server instance: the DDL runs once per cold start. If it fails
// (e.g. a transient connection error), the memo is cleared so a later request
// can retry.
let ensured: Promise<void> | null = null;

export function ensureFixedCostSchema(): Promise<void> {
  if (!ensured) {
    ensured = provision().catch((err) => {
      ensured = null;
      throw err;
    });
  }
  return ensured;
}

async function provision(): Promise<void> {
  // The player count the fixed cost divides across comes off the rosters, so
  // make sure teams/players (and companies) exist first. Idempotent and
  // memoized.
  await ensureTeamsSchema();

  const db = sql();

  // A user-named group of fixed costs ("Uniforms", "Insurance"). Program-wide:
  // these costs are paid once for the whole program, not per team.
  await db`
    CREATE TABLE IF NOT EXISTS fixed_cost_sections (
      id          SERIAL        PRIMARY KEY,
      company_id  INTEGER       NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      name        VARCHAR(160)  NOT NULL,
      created_at  TIMESTAMPTZ   NOT NULL DEFAULT now(),
      updated_at  TIMESTAMPTZ   NOT NULL DEFAULT now()
    )
  `;

  await db`CREATE INDEX IF NOT EXISTS idx_fixed_cost_sections_company_id ON fixed_cost_sections (company_id)`;

  // One line item inside a section. Deleting the section takes its items with
  // it, which is what "remove this section" means to the user.
  await db`
    CREATE TABLE IF NOT EXISTS fixed_cost_items (
      id          SERIAL        PRIMARY KEY,
      section_id  INTEGER       NOT NULL REFERENCES fixed_cost_sections(id) ON DELETE CASCADE,
      name        VARCHAR(160)  NOT NULL,
      amount      NUMERIC(12,2) NOT NULL DEFAULT 0,
      created_at  TIMESTAMPTZ   NOT NULL DEFAULT now(),
      updated_at  TIMESTAMPTZ   NOT NULL DEFAULT now()
    )
  `;

  await db`CREATE INDEX IF NOT EXISTS idx_fixed_cost_items_section_id ON fixed_cost_items (section_id)`;

  // One settings row per company. `player_count` is the optional manual
  // override for the number of players the fixed cost is split across; NULL
  // falls back to the players marked "Paying" on the active seasons' rosters.
  await db`
    CREATE TABLE IF NOT EXISTS fixed_cost_settings (
      company_id    INTEGER      PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
      player_count  INTEGER,
      created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
      updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
    )
  `;
}
