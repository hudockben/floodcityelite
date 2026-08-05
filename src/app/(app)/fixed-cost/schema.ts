import { sql } from "@/lib/db";
import { currentTenant } from "@/lib/tenant";
import { ensureTeamsSchema } from "../teams/schema";

// Ensure the fixed-cost tables exist before the Fixed Cost tab (or the Budgets
// tab, which reads the per-player figure) touches them. Like the other tabs'
// schema helpers, this lets the feature work on a database that predates it
// (e.g. a deployed Neon DB) without a separate migration step. The DDL mirrors
// db/schema.sql and db/setup.mjs and is idempotent.
//
// Memoized per server instance, keyed by organization: the DDL runs once per
// cold start per organization. Each organization has its own database, so a
// single shared memo would provision whichever one happened to warm this
// instance and hand the other back an already-resolved promise, running nothing
// at all against its own database. That matters especially here, where the work
// below is not only CREATEs: the season_year backfills and the (company, year)
// unique index the settings upsert relies on would quietly be skipped for the
// second organization. If a provision fails (e.g. a transient connection
// error), only that organization's entry is cleared, so it retries on a later
// request without disturbing the other's.
const ensured = new Map<string, Promise<void>>();

export async function ensureFixedCostSchema(): Promise<void> {
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
  // The player count the fixed cost divides across comes off the rosters, so
  // make sure teams/players (and companies) exist first. Idempotent and
  // memoized.
  await ensureTeamsSchema();

  const db = sql();

  // A user-named group of fixed costs ("Uniforms", "Insurance"), for one season
  // year. Program-wide within that year: these costs are paid once for the whole
  // program rather than per team or per division, which is why the year is a
  // plain number here instead of a seasons(id) — a season row is per division.
  await db`
    CREATE TABLE IF NOT EXISTS fixed_cost_sections (
      id           SERIAL        PRIMARY KEY,
      company_id   INTEGER       NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      season_year  SMALLINT      NOT NULL DEFAULT EXTRACT(YEAR FROM now()),
      name         VARCHAR(160)  NOT NULL,
      created_at   TIMESTAMPTZ   NOT NULL DEFAULT now(),
      updated_at   TIMESTAMPTZ   NOT NULL DEFAULT now()
    )
  `;

  // Add the year to a database whose sections predate it, putting the existing
  // sheet on the company's active season year (falling back to this year) so
  // nothing disappears when the tab starts asking for a year.
  await db`ALTER TABLE fixed_cost_sections ADD COLUMN IF NOT EXISTS season_year SMALLINT`;
  await db`
    UPDATE fixed_cost_sections s
    SET season_year = COALESCE(
      (SELECT max(se.year) FROM seasons se
        WHERE se.company_id = s.company_id AND se.is_active),
      EXTRACT(YEAR FROM now())::smallint)
    WHERE s.season_year IS NULL
  `;
  await db`ALTER TABLE fixed_cost_sections ALTER COLUMN season_year SET DEFAULT EXTRACT(YEAR FROM now())`;
  await db`ALTER TABLE fixed_cost_sections ALTER COLUMN season_year SET NOT NULL`;

  await db`CREATE INDEX IF NOT EXISTS idx_fixed_cost_sections_company_year ON fixed_cost_sections (company_id, season_year)`;

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

  // One settings row per company *per year*. `player_count` is the optional
  // manual override for the number of players that year's fixed cost is split
  // across; NULL falls back to the players marked "Paying" on the rosters of
  // that year's seasons.
  await db`
    CREATE TABLE IF NOT EXISTS fixed_cost_settings (
      company_id    INTEGER      NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      season_year   SMALLINT     NOT NULL DEFAULT EXTRACT(YEAR FROM now()),
      player_count  INTEGER,
      created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
      updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
    )
  `;

  // Same migration for a settings table that predates the year: add it, put the
  // saved override on the active season year, then swap the company-only
  // primary key for a (company, year) unique index so each year can carry its
  // own count. Every step is idempotent.
  await db`ALTER TABLE fixed_cost_settings ADD COLUMN IF NOT EXISTS season_year SMALLINT`;
  await db`
    UPDATE fixed_cost_settings f
    SET season_year = COALESCE(
      (SELECT max(se.year) FROM seasons se
        WHERE se.company_id = f.company_id AND se.is_active),
      EXTRACT(YEAR FROM now())::smallint)
    WHERE f.season_year IS NULL
  `;
  await db`ALTER TABLE fixed_cost_settings ALTER COLUMN season_year SET DEFAULT EXTRACT(YEAR FROM now())`;
  await db`ALTER TABLE fixed_cost_settings ALTER COLUMN season_year SET NOT NULL`;
  await db`ALTER TABLE fixed_cost_settings DROP CONSTRAINT IF EXISTS fixed_cost_settings_pkey`;
  await db`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_fixed_cost_settings_company_year
      ON fixed_cost_settings (company_id, season_year)
  `;
}
