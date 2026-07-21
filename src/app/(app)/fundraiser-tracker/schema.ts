import { sql } from "@/lib/db";
import { ensureTeamsSchema } from "../teams/schema";

// Ensure the `fundraisers` and `fundraiser_entries` tables exist before the
// Fundraiser Tracker tab reads or writes them. Like the other tabs' schema
// helpers, this lets the feature work on a database that predates it (e.g. a
// deployed Neon DB) without a separate migration step. The DDL mirrors
// db/schema.sql and db/setup.mjs and is idempotent.
//
// Memoized per server instance: the DDL runs once per cold start. If it fails
// (e.g. a transient connection error), the memo is cleared so a later request
// can retry.
let ensured: Promise<void> | null = null;

export function ensureFundraisersSchema(): Promise<void> {
  if (!ensured) {
    ensured = provision().catch((err) => {
      ensured = null;
      throw err;
    });
  }
  return ensured;
}

async function provision(): Promise<void> {
  // fundraiser_entries reference players (→ teams → companies) and fundraisers
  // reference companies, so make sure the roster tables (and companies) exist
  // first. ensureTeamsSchema is itself idempotent and memoized.
  await ensureTeamsSchema();

  const db = sql();

  // A fundraiser is a campaign/event owned by a company. Only the name is
  // required; goal and event_date are optional.
  await db`
    CREATE TABLE IF NOT EXISTS fundraisers (
      id          SERIAL        PRIMARY KEY,
      company_id  INTEGER       NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      name        VARCHAR(160)  NOT NULL,
      goal        NUMERIC(10,2),
      event_date  DATE,
      created_at  TIMESTAMPTZ   NOT NULL DEFAULT now(),
      updated_at  TIMESTAMPTZ   NOT NULL DEFAULT now()
    )
  `;

  await db`CREATE INDEX IF NOT EXISTS idx_fundraisers_company_id ON fundraisers (company_id)`;

  // A fundraiser entry ties an amount raised to a fundraiser and a team. For
  // player-based fundraisers it also references a specific player; team-based
  // fundraisers leave player_id NULL. team_id is stored directly (rather than
  // derived through the player) so both kinds share one query and both
  // cascade-delete with their team.
  await db`
    CREATE TABLE IF NOT EXISTS fundraiser_entries (
      id             SERIAL        PRIMARY KEY,
      fundraiser_id  INTEGER       NOT NULL REFERENCES fundraisers(id) ON DELETE CASCADE,
      team_id        INTEGER       NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      player_id      INTEGER       REFERENCES players(id) ON DELETE CASCADE,
      raised_on      DATE          NOT NULL DEFAULT CURRENT_DATE,
      amount         NUMERIC(10,2) NOT NULL DEFAULT 0,
      created_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),
      updated_at     TIMESTAMPTZ   NOT NULL DEFAULT now()
    )
  `;

  // Migrate databases whose fundraiser_entries predate team-level entries: the
  // table originally had player_id NOT NULL and no team_id. Add team_id,
  // backfill it from each existing entry's player, then relax player_id so
  // whole-team entries (player_id NULL) are allowed. All idempotent.
  await db`ALTER TABLE fundraiser_entries ADD COLUMN IF NOT EXISTS team_id INTEGER REFERENCES teams(id) ON DELETE CASCADE`;
  await db`
    UPDATE fundraiser_entries fe
    SET team_id = pl.team_id
    FROM players pl
    WHERE fe.player_id = pl.id AND fe.team_id IS NULL
  `;
  await db`ALTER TABLE fundraiser_entries ALTER COLUMN player_id DROP NOT NULL`;

  await db`CREATE INDEX IF NOT EXISTS idx_fundraiser_entries_fundraiser_id ON fundraiser_entries (fundraiser_id)`;
  await db`CREATE INDEX IF NOT EXISTS idx_fundraiser_entries_team_id ON fundraiser_entries (team_id)`;
  await db`CREATE INDEX IF NOT EXISTS idx_fundraiser_entries_player_id ON fundraiser_entries (player_id)`;
}
