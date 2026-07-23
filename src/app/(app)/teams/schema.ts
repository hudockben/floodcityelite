import { sql } from "@/lib/db";

// Ensure the `teams` and `players` tables exist before the Teams tab reads or
// writes them. This lets the feature work on a database that was set up before
// these tables existed (e.g. a deployed Neon DB) without a separate migration
// step. The DDL mirrors db/schema.sql and db/setup.mjs and is idempotent.
//
// Memoized per server instance: the DDL runs once per cold start. If it fails
// (e.g. a transient connection error), the memo is cleared so a later request
// can retry.
let ensured: Promise<void> | null = null;

export function ensureTeamsSchema(): Promise<void> {
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

  await db`
    CREATE TABLE IF NOT EXISTS teams (
      id          SERIAL PRIMARY KEY,
      company_id  INTEGER      NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      name        VARCHAR(120) NOT NULL,
      division    VARCHAR(32)  NOT NULL
                    CHECK (division IN ('spring-summer-baseball', 'softball', 'fall-baseball')),
      sport       VARCHAR(16)  NOT NULL DEFAULT 'baseball'
                    CHECK (sport IN ('baseball', 'softball')),
      created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
      updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
    )
  `;

  await db`CREATE INDEX IF NOT EXISTS idx_teams_company_division ON teams (company_id, division)`;

  await db`
    CREATE TABLE IF NOT EXISTS players (
      id                  SERIAL PRIMARY KEY,
      team_id             INTEGER      NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      player_name         VARCHAR(160) NOT NULL,
      grad_year           SMALLINT,
      date_of_birth       DATE,
      height              VARCHAR(24),
      weight              SMALLINT,
      primary_position    VARCHAR(48),
      secondary_position  VARCHAR(48),
      high_school         VARCHAR(160),
      parent_phone        VARCHAR(40),
      parent_email        VARCHAR(160),
      parent_name         VARCHAR(160),
      closest_facility    VARCHAR(160),
      is_paying           BOOLEAN      NOT NULL DEFAULT true,
      created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
      updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now()
    )
  `;

  await db`CREATE INDEX IF NOT EXISTS idx_players_team_id ON players (team_id)`;

  // Backfill is_paying on databases whose `players` table predates it. Existing
  // rows default to paying, so the Budgets tab's paying-player count keeps
  // matching the full roster size until a coach unchecks someone.
  await db`ALTER TABLE players ADD COLUMN IF NOT EXISTS is_paying BOOLEAN NOT NULL DEFAULT true`;

  // Roster groups (playing-time rotation). A team can be split into standing,
  // position-balanced groups; `roster_group_count` is how many groups the coach
  // has set up (0 = not using groups) and each player's `roster_group` is which
  // one they're in (null = ungrouped). Nullable/defaulted and idempotent so
  // databases predating the feature pick it up without a separate migration.
  await db`ALTER TABLE teams ADD COLUMN IF NOT EXISTS roster_group_count SMALLINT NOT NULL DEFAULT 0`;
  await db`ALTER TABLE players ADD COLUMN IF NOT EXISTS roster_group SMALLINT`;
}
