import { sql } from "@/lib/db";
import { currentTenant } from "@/lib/tenant";

// Ensure the `teams` and `players` tables exist before the Teams tab reads or
// writes them. This lets the feature work on a database that was set up before
// these tables existed (e.g. a deployed Neon DB) without a separate migration
// step. The DDL mirrors db/schema.sql and db/setup.mjs and is idempotent.
//
// Memoized per server instance and per organization: the DDL runs once per cold
// start per organization. The key matters because each organization has its own
// database — provision() runs against whichever one the request belongs to, so a
// single shared memo would let the organization that happened to warm the
// instance provision itself and hand every later request from the other one an
// already-resolved promise, skipping its DDL (and the backfills and unique
// indexes below) entirely. If a provision fails (e.g. a transient connection
// error), only that organization's memo is cleared, so it can retry on a later
// request without re-running the other's.
const ensured = new Map<string, Promise<void>>();

export async function ensureTeamsSchema(): Promise<void> {
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
      jersey_number       VARCHAR(24),
      jersey_locked       BOOLEAN      NOT NULL DEFAULT false,
      hat_size            VARCHAR(24),
      high_school         VARCHAR(160),
      parent_phone        VARCHAR(40),
      parent_email        VARCHAR(160),
      parent_name         VARCHAR(160),
      closest_facility    VARCHAR(160),
      is_paying           BOOLEAN      NOT NULL DEFAULT true,
      is_returning        BOOLEAN,
      created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
      updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now()
    )
  `;

  await db`CREATE INDEX IF NOT EXISTS idx_players_team_id ON players (team_id)`;

  // Backfill is_paying on databases whose `players` table predates it. Existing
  // rows default to paying, so the Budgets tab's paying-player count keeps
  // matching the full roster size until a coach unchecks someone.
  await db`ALTER TABLE players ADD COLUMN IF NOT EXISTS is_paying BOOLEAN NOT NULL DEFAULT true`;

  // The roster's New/Returning override. Nullable on purpose: null means "use
  // the acceptance form's answer", which is what every existing player wants.
  await db`ALTER TABLE players ADD COLUMN IF NOT EXISTS is_returning BOOLEAN`;

  // Roster groups (playing-time rotation). A team can be split into standing,
  // position-balanced groups; `roster_group_count` is how many groups the coach
  // has set up (0 = not using groups) and each player's `roster_group` is which
  // one they're in (null = ungrouped). Nullable/defaulted and idempotent so
  // databases predating the feature pick it up without a separate migration.
  await db`ALTER TABLE teams ADD COLUMN IF NOT EXISTS roster_group_count SMALLINT NOT NULL DEFAULT 0`;
  await db`ALTER TABLE players ADD COLUMN IF NOT EXISTS roster_group SMALLINT`;

  // Jersey number and hat size roster columns. Added after the initial roster
  // shipped, so backfill them on existing databases; both are optional free
  // text (jersey numbers can be "00", hat sizes "7 1/4"). Sized to match the
  // roster_submissions columns the acceptance form feeds them from.
  await db`ALTER TABLE players ADD COLUMN IF NOT EXISTS jersey_number VARCHAR(24)`;
  await db`ALTER TABLE players ADD COLUMN IF NOT EXISTS hat_size VARCHAR(24)`;

  // Whether a coach has pinned a player's jersey by hand (set on the Teams-tab
  // edit). Locked numbers are treated as fixed by the acceptance-form jersey
  // automation, so a manual assignment isn't overwritten on the next accept.
  await db`ALTER TABLE players ADD COLUMN IF NOT EXISTS jersey_locked BOOLEAN NOT NULL DEFAULT false`;

  // -------------------------------------------------------------------------
  // Seasons
  //
  // A season is one division's run in a given year — Spring/Summer Baseball
  // 2026, Softball 2027, and so on. Each division rolls over on its own
  // calendar, so a season is keyed by (company, division, year) and a team
  // belongs to exactly one season (teams.season_id). Rosters, schedules, and
  // budgets all hang off teams, so they inherit the season automatically. One
  // season per division is active at a time (is_active) — the one shown by
  // default. `label` is an optional custom name; when null the UI derives
  // "<year> <division>".
  // -------------------------------------------------------------------------
  await db`
    CREATE TABLE IF NOT EXISTS seasons (
      id          SERIAL PRIMARY KEY,
      company_id  INTEGER      NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      division    VARCHAR(32)  NOT NULL
                    CHECK (division IN ('spring-summer-baseball', 'softball', 'fall-baseball')),
      year        SMALLINT     NOT NULL,
      label       VARCHAR(120),
      is_active   BOOLEAN      NOT NULL DEFAULT true,
      created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
      UNIQUE (company_id, division, year)
    )
  `;

  await db`CREATE INDEX IF NOT EXISTS idx_seasons_company_division ON seasons (company_id, division)`;

  // Before enforcing one-active-per-division, demote any extra active seasons
  // (keep the newest year active) so the unique index below can always be
  // created — even on a database where an earlier, unsafe build briefly allowed
  // two active seasons. Idempotent: a no-op once each division has one active.
  await db`
    UPDATE seasons s SET is_active = false
    WHERE s.is_active
      AND EXISTS (
        SELECT 1 FROM seasons s2
        WHERE s2.company_id = s.company_id
          AND s2.division = s.division
          AND s2.is_active
          AND s2.year > s.year
      )
  `;

  // Enforce a single active season per (company, division) at the DB level, so
  // even a race in createSeasonAction can't persist two active seasons for a
  // division (which would, e.g., merge two years' teams into the public
  // roster-signup dropdown). Safe to create: the backfill below and
  // resolveSeason each make exactly one active season per division.
  await db`CREATE UNIQUE INDEX IF NOT EXISTS ux_seasons_one_active ON seasons (company_id, division) WHERE is_active`;

  // Link teams to their season. Nullable so the column can be added to an
  // already-populated table; the backfill below stamps every existing row, and
  // new teams are always created with a season by the app.
  await db`ALTER TABLE teams ADD COLUMN IF NOT EXISTS season_id INTEGER REFERENCES seasons(id) ON DELETE CASCADE`;

  // Backfill: existing teams predate seasons, so create a 2026 season for each
  // (company, division) that has teams but no matching season, then stamp those
  // teams into it. Existing data becomes the 2026 run of its division and
  // nothing disappears from the season-scoped views. Idempotent — once every
  // team has a season_id these are no-ops.
  await db`
    INSERT INTO seasons (company_id, division, year, is_active)
    SELECT DISTINCT t.company_id, t.division, 2026, true
    FROM teams t
    WHERE t.season_id IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM seasons s
        WHERE s.company_id = t.company_id
          AND s.division = t.division
          AND s.year = 2026
      )
    ON CONFLICT (company_id, division, year) DO NOTHING
  `;

  await db`
    UPDATE teams t
    SET season_id = s.id
    FROM seasons s
    WHERE t.season_id IS NULL
      AND s.company_id = t.company_id
      AND s.division = t.division
      AND s.year = 2026
  `;

  await db`CREATE INDEX IF NOT EXISTS idx_teams_season_id ON teams (season_id)`;
}
