// ---------------------------------------------------------------------------
// Flood City Elite — database setup & seed
//
//   npm run db:setup
//
// Creates the `companies` and `users` tables (if needed), ensures the Flood
// City Elite company exists (code: fce), and creates a default admin user
// with a bcrypt-hashed password. Safe to run more than once.
// ---------------------------------------------------------------------------

import { neon } from "@neondatabase/serverless";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";

// Load env from .env.local (preferred) or .env, if present.
for (const file of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(file);
    break;
  } catch {
    // file not present — ignore and try the next one
  }
}

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error(
    "\n✖  DATABASE_URL is not set.\n" +
      "   Copy .env.example to .env.local and paste your Neon connection string.\n",
  );
  process.exit(1);
}

const COMPANY_CODE = "fce";
const COMPANY_NAME = "Flood City Elite";
const ADMIN_USERNAME = process.env.SEED_ADMIN_USERNAME || "admin";

// No hardcoded default password. Use SEED_ADMIN_PASSWORD if provided,
// otherwise generate a strong random one and print it once.
let ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || "";
const ADMIN_PASSWORD_GENERATED = ADMIN_PASSWORD === "";
if (ADMIN_PASSWORD_GENERATED) {
  ADMIN_PASSWORD = randomBytes(18).toString("base64url");
}

const sql = neon(DATABASE_URL);

async function main() {
  console.log("→ Creating tables…");

  await sql`
    CREATE TABLE IF NOT EXISTS companies (
      id          SERIAL PRIMARY KEY,
      code        VARCHAR(32)  NOT NULL UNIQUE,
      name        VARCHAR(255) NOT NULL,
      created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id             SERIAL PRIMARY KEY,
      company_id     INTEGER      NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      username       VARCHAR(64)  NOT NULL,
      password_hash  TEXT         NOT NULL,
      full_name      VARCHAR(255),
      email          VARCHAR(255),
      role           VARCHAR(32)  NOT NULL DEFAULT 'member',
      is_active      BOOLEAN      NOT NULL DEFAULT true,
      created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
      last_login_at  TIMESTAMPTZ,
      UNIQUE (company_id, username)
    )
  `;

  await sql`CREATE INDEX IF NOT EXISTS idx_users_company_id ON users (company_id)`;

  // Teams belong to a company, live in a division, and are assigned a sport.
  await sql`
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

  await sql`CREATE INDEX IF NOT EXISTS idx_teams_company_division ON teams (company_id, division)`;

  // Seasons: one division's run in a given year (Spring/Summer Baseball 2026,
  // Softball 2027, …). Each division rolls over on its own calendar, so a season
  // is keyed by (company, division, year); a team belongs to one season via
  // teams.season_id and rosters/schedules/budgets inherit it. One season per
  // division is active at a time. Existing teams are backfilled into a 2026
  // season for their division so nothing disappears from the season-scoped views.
  await sql`
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

  await sql`CREATE INDEX IF NOT EXISTS idx_seasons_company_division ON seasons (company_id, division)`;

  // Demote any extra active seasons (keep the newest year) so the unique index
  // can always be created, then enforce one active season per (company,
  // division) at the DB level.
  await sql`
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
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS ux_seasons_one_active ON seasons (company_id, division) WHERE is_active`;

  await sql`ALTER TABLE teams ADD COLUMN IF NOT EXISTS season_id INTEGER REFERENCES seasons(id) ON DELETE CASCADE`;

  await sql`
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

  await sql`
    UPDATE teams t
    SET season_id = s.id
    FROM seasons s
    WHERE t.season_id IS NULL
      AND s.company_id = t.company_id
      AND s.division = t.division
      AND s.year = 2026
  `;

  await sql`CREATE INDEX IF NOT EXISTS idx_teams_season_id ON teams (season_id)`;

  // Players (roster rows) belong to a team. Only player_name is required.
  // `is_paying` marks whether the player pays tuition/dues and drives the
  // Budgets tab's paying-player count; it defaults to true.
  await sql`
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

  await sql`CREATE INDEX IF NOT EXISTS idx_players_team_id ON players (team_id)`;

  // Backfill is_paying on databases that created `players` before it existed.
  // Existing rows default to paying, matching the previous behavior where the
  // paying-player count was the full roster size.
  await sql`ALTER TABLE players ADD COLUMN IF NOT EXISTS is_paying BOOLEAN NOT NULL DEFAULT true`;

  // The New/Returning override a coach can set on the roster. Nullable, so
  // existing players keep falling back to the acceptance form's answer.
  await sql`ALTER TABLE players ADD COLUMN IF NOT EXISTS is_returning BOOLEAN`;

  // Roster groups: split a team into standing, position-balanced groups.
  // `teams.roster_group_count` is how many groups the coach set up (0 = off) and
  // `players.roster_group` is which one a player is in (null = ungrouped).
  // Nullable/defaulted and idempotent so older databases pick this up cleanly.
  await sql`ALTER TABLE teams ADD COLUMN IF NOT EXISTS roster_group_count SMALLINT NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE players ADD COLUMN IF NOT EXISTS roster_group SMALLINT`;

  // Jersey number and hat size roster columns (optional free text). Added after
  // the initial roster shipped, so backfill them on databases that predate them.
  await sql`ALTER TABLE players ADD COLUMN IF NOT EXISTS jersey_number VARCHAR(24)`;
  await sql`ALTER TABLE players ADD COLUMN IF NOT EXISTS hat_size VARCHAR(24)`;

  // Coach-pinned jersey flag: locked numbers are treated as fixed by the
  // acceptance-form jersey automation (not overwritten on the next accept).
  await sql`ALTER TABLE players ADD COLUMN IF NOT EXISTS jersey_locked BOOLEAN NOT NULL DEFAULT false`;

  // Payments are logged against a player (→ team → company) and power the
  // Payment Tracker tab.
  await sql`
    CREATE TABLE IF NOT EXISTS payments (
      id            SERIAL        PRIMARY KEY,
      player_id     INTEGER       NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      paid_on       DATE          NOT NULL DEFAULT CURRENT_DATE,
      payment_type  VARCHAR(16)   NOT NULL DEFAULT 'cash'
                      CHECK (payment_type IN ('check', 'cash')),
      check_number  VARCHAR(32),
      amount        NUMERIC(10,2) NOT NULL DEFAULT 0,
      created_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
      updated_at    TIMESTAMPTZ   NOT NULL DEFAULT now()
    )
  `;

  await sql`CREATE INDEX IF NOT EXISTS idx_payments_player_id ON payments (player_id)`;

  // Backfill check_number on databases that created `payments` before it existed.
  await sql`ALTER TABLE payments ADD COLUMN IF NOT EXISTS check_number VARCHAR(32)`;

  // One budget row per team. The paying-player count defaults to the number of
  // players marked is_paying on the roster; paying_players is an optional manual
  // override.
  await sql`
    CREATE TABLE IF NOT EXISTS team_budgets (
      team_id                 INTEGER       PRIMARY KEY REFERENCES teams(id) ON DELETE CASCADE,
      tuition_per_player      NUMERIC(12,2) NOT NULL DEFAULT 0,
      portion_to_team_budget  NUMERIC(12,2),
      paying_players          INTEGER,
      created_at              TIMESTAMPTZ   NOT NULL DEFAULT now(),
      updated_at              TIMESTAMPTZ   NOT NULL DEFAULT now()
    )
  `;

  // Ad-hoc team expenses logged on the Budgets tab (a coach's hotel, gas,
  // gear, etc.). A 'paid' row is deducted from the team's current balance, a
  // 'refund' is credited back, and a 'not_paid' row is tracked without changing
  // the balance until it's marked paid.
  await sql`
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

  await sql`CREATE INDEX IF NOT EXISTS idx_team_expenses_team_id ON team_expenses (team_id)`;

  // Let the portion be NULL on databases whose team_budgets predates the Fixed
  // Cost tab (it was NOT NULL DEFAULT 0). Saved numbers stay put as manual
  // overrides; clearing the field on the sheet derives it instead.
  await sql`ALTER TABLE team_budgets ALTER COLUMN portion_to_team_budget DROP NOT NULL`;
  await sql`ALTER TABLE team_budgets ALTER COLUMN portion_to_team_budget DROP DEFAULT`;

  // Schedule events (tournaments/games) belong to a team. Only event_name is
  // required; cost is optional and summed per team on the Schedules tab.
  await sql`
    CREATE TABLE IF NOT EXISTS schedule_events (
      id              SERIAL PRIMARY KEY,
      team_id         INTEGER       NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      event_host      VARCHAR(160),
      event_date      DATE,
      event_end_date  DATE,
      event_name      VARCHAR(200)  NOT NULL,
      location        VARCHAR(200),
      cost            NUMERIC(10, 2),
      status          VARCHAR(16)   NOT NULL DEFAULT 'registered'
                        CHECK (status IN ('registered', 'paid', 'waitlisted', 'rainout', 'refund')),
      created_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
      updated_at      TIMESTAMPTZ   NOT NULL DEFAULT now()
    )
  `;

  await sql`CREATE INDEX IF NOT EXISTS idx_schedule_events_team_id ON schedule_events (team_id)`;

  // Backfill event_end_date on databases that created `schedule_events` before
  // the tournament end date existed. The column is nullable, so single-day
  // events simply leave it empty.
  await sql`ALTER TABLE schedule_events ADD COLUMN IF NOT EXISTS event_end_date DATE`;

  // Widen the status CHECK on databases created before the Rain Out / Refund
  // options existed. An unnamed inline column CHECK is named
  // <table>_<column>_check by Postgres, so drop that and re-add the full list.
  await sql`ALTER TABLE schedule_events DROP CONSTRAINT IF EXISTS schedule_events_status_check`;
  await sql`
    ALTER TABLE schedule_events
      ADD CONSTRAINT schedule_events_status_check
      CHECK (status IN ('registered', 'paid', 'waitlisted', 'rainout', 'refund'))
  `;

  // Event groups (playing-time rotation): which roster players attend a given
  // tournament. Only deviations from the default are stored — a player attends
  // an event unless a row marks them attending = false — so benching a few
  // players costs a handful of rows and a new event starts with the full roster.
  await sql`
    CREATE TABLE IF NOT EXISTS event_attendance (
      id          SERIAL      PRIMARY KEY,
      event_id    INTEGER     NOT NULL REFERENCES schedule_events(id) ON DELETE CASCADE,
      player_id   INTEGER     NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      attending   BOOLEAN     NOT NULL DEFAULT true,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (event_id, player_id)
    )
  `;

  await sql`CREATE INDEX IF NOT EXISTS idx_event_attendance_event_id ON event_attendance (event_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_event_attendance_player_id ON event_attendance (player_id)`;

  // Event groups: which standing roster groups play a given event (e.g. Groups
  // 1 & 2 one weekend, 1 & 3 the next). The selected group numbers drive who's
  // attending, leaving event_attendance for per-player exceptions; an event
  // with no rows keeps the default full roster (minus anyone benched).
  await sql`
    CREATE TABLE IF NOT EXISTS event_groups (
      id            SERIAL      PRIMARY KEY,
      event_id      INTEGER     NOT NULL REFERENCES schedule_events(id) ON DELETE CASCADE,
      group_number  SMALLINT    NOT NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (event_id, group_number)
    )
  `;

  await sql`CREATE INDEX IF NOT EXISTS idx_event_groups_event_id ON event_groups (event_id)`;

  // Clear redundant attendance rows left by the earlier per-player toggle: an
  // attending = true row on an event with no group selection equals the "all
  // attend" baseline, so it's a no-op to resolve but would wrongly override a
  // group pick later. Per-player exceptions on events that DO have groups are
  // left alone. Safe to re-run (new writes never create a redundant true row).
  await sql`
    DELETE FROM event_attendance a
    WHERE a.attending = true
      AND NOT EXISTS (
        SELECT 1 FROM event_groups g WHERE g.event_id = a.event_id
      )
  `;

  // A fundraiser is a campaign/event owned by a company. Only the name is
  // required; goal and event_date are optional.
  await sql`
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

  await sql`CREATE INDEX IF NOT EXISTS idx_fundraisers_company_id ON fundraisers (company_id)`;

  // A fundraiser entry ties an amount raised to a fundraiser and a team;
  // player-based fundraisers also name a player, while team-based fundraisers
  // leave player_id NULL. Powers the Fundraiser Tracker tab's totals, and each
  // team's entries are credited to its budget on the Budgets tab.
  await sql`
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

  // Migrate fundraiser_entries created before team-level entries existed: add
  // team_id, backfill it from each entry's player, and relax player_id so
  // whole-team entries are allowed.
  await sql`ALTER TABLE fundraiser_entries ADD COLUMN IF NOT EXISTS team_id INTEGER REFERENCES teams(id) ON DELETE CASCADE`;
  await sql`
    UPDATE fundraiser_entries fe
    SET team_id = pl.team_id
    FROM players pl
    WHERE fe.player_id = pl.id AND fe.team_id IS NULL
  `;
  await sql`ALTER TABLE fundraiser_entries ALTER COLUMN player_id DROP NOT NULL`;

  await sql`CREATE INDEX IF NOT EXISTS idx_fundraiser_entries_fundraiser_id ON fundraiser_entries (fundraiser_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_fundraiser_entries_team_id ON fundraiser_entries (team_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_fundraiser_entries_player_id ON fundraiser_entries (player_id)`;

  // A camp is a program/clinic/camp owned by a company. Only the name is
  // required; location and event_date are optional. Camps keep their own
  // roster, separate from teams.
  await sql`
    CREATE TABLE IF NOT EXISTS camps (
      id          SERIAL        PRIMARY KEY,
      company_id  INTEGER       NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      name        VARCHAR(160)  NOT NULL,
      location    VARCHAR(200),
      event_date  DATE,
      created_at  TIMESTAMPTZ   NOT NULL DEFAULT now(),
      updated_at  TIMESTAMPTZ   NOT NULL DEFAULT now()
    )
  `;

  await sql`CREATE INDEX IF NOT EXISTS idx_camps_company_id ON camps (company_id)`;

  // A camp player is a roster row on a camp: the player's name plus the
  // parent's name, a parent contact, and a location. Only player_name required.
  await sql`
    CREATE TABLE IF NOT EXISTS camp_players (
      id              SERIAL        PRIMARY KEY,
      camp_id         INTEGER       NOT NULL REFERENCES camps(id) ON DELETE CASCADE,
      player_name     VARCHAR(160)  NOT NULL,
      parent_name     VARCHAR(160),
      parent_contact  VARCHAR(200),
      location        VARCHAR(200),
      created_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
      updated_at      TIMESTAMPTZ   NOT NULL DEFAULT now()
    )
  `;

  await sql`CREATE INDEX IF NOT EXISTS idx_camp_players_camp_id ON camp_players (camp_id)`;

  // A camp payment is logged against a camp player and mirrors `payments`.
  // Powers the Program/Camps tab's per-player and per-camp totals.
  await sql`
    CREATE TABLE IF NOT EXISTS camp_payments (
      id              SERIAL        PRIMARY KEY,
      camp_player_id  INTEGER       NOT NULL REFERENCES camp_players(id) ON DELETE CASCADE,
      paid_on         DATE          NOT NULL DEFAULT CURRENT_DATE,
      payment_type    VARCHAR(16)   NOT NULL DEFAULT 'cash'
                        CHECK (payment_type IN ('check', 'cash')),
      check_number    VARCHAR(32),
      amount          NUMERIC(10,2) NOT NULL DEFAULT 0,
      created_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
      updated_at      TIMESTAMPTZ   NOT NULL DEFAULT now()
    )
  `;

  await sql`CREATE INDEX IF NOT EXISTS idx_camp_payments_camp_player_id ON camp_payments (camp_player_id)`;

// Fixed costs: what the program pays up front (uniforms, insurance, facility
  // time), grouped under sections the user names. The total divided by the
  // player count is the fixed cost per player the Budgets tab subtracts from
  // each team's tuition. fixed_cost_settings.player_count is an optional
  // override for that divisor; NULL falls back to the players marked "Paying"
  // on the active seasons' rosters.
  await sql`
    CREATE TABLE IF NOT EXISTS fixed_cost_sections (
      id           SERIAL        PRIMARY KEY,
      company_id   INTEGER       NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      season_year  SMALLINT      NOT NULL DEFAULT EXTRACT(YEAR FROM now()),
      name         VARCHAR(160)  NOT NULL,
      created_at   TIMESTAMPTZ   NOT NULL DEFAULT now(),
      updated_at   TIMESTAMPTZ   NOT NULL DEFAULT now()
    )
  `;

  // Put an existing sheet on the company's active season year so nothing
  // disappears when the tab starts asking for a year. Idempotent.
  await sql`ALTER TABLE fixed_cost_sections ADD COLUMN IF NOT EXISTS season_year SMALLINT`;
  await sql`
    UPDATE fixed_cost_sections s
    SET season_year = COALESCE(
      (SELECT max(se.year) FROM seasons se WHERE se.company_id = s.company_id AND se.is_active),
      EXTRACT(YEAR FROM now())::smallint)
    WHERE s.season_year IS NULL
  `;
  await sql`ALTER TABLE fixed_cost_sections ALTER COLUMN season_year SET DEFAULT EXTRACT(YEAR FROM now())`;
  await sql`ALTER TABLE fixed_cost_sections ALTER COLUMN season_year SET NOT NULL`;

  await sql`CREATE INDEX IF NOT EXISTS idx_fixed_cost_sections_company_year ON fixed_cost_sections (company_id, season_year)`;

  await sql`
    CREATE TABLE IF NOT EXISTS fixed_cost_items (
      id          SERIAL        PRIMARY KEY,
      section_id  INTEGER       NOT NULL REFERENCES fixed_cost_sections(id) ON DELETE CASCADE,
      name        VARCHAR(160)  NOT NULL,
      amount      NUMERIC(12,2) NOT NULL DEFAULT 0,
      created_at  TIMESTAMPTZ   NOT NULL DEFAULT now(),
      updated_at  TIMESTAMPTZ   NOT NULL DEFAULT now()
    )
  `;

  await sql`CREATE INDEX IF NOT EXISTS idx_fixed_cost_items_section_id ON fixed_cost_items (section_id)`;

  await sql`
    CREATE TABLE IF NOT EXISTS fixed_cost_settings (
      company_id    INTEGER      NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      season_year   SMALLINT     NOT NULL DEFAULT EXTRACT(YEAR FROM now()),
      player_count  INTEGER,
      created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
      updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
    )
  `;

  // Same migration for the settings row, plus swapping its company-only primary
  // key for a (company, year) unique index so each year carries its own count.
  await sql`ALTER TABLE fixed_cost_settings ADD COLUMN IF NOT EXISTS season_year SMALLINT`;
  await sql`
    UPDATE fixed_cost_settings f
    SET season_year = COALESCE(
      (SELECT max(se.year) FROM seasons se WHERE se.company_id = f.company_id AND se.is_active),
      EXTRACT(YEAR FROM now())::smallint)
    WHERE f.season_year IS NULL
  `;
  await sql`ALTER TABLE fixed_cost_settings ALTER COLUMN season_year SET DEFAULT EXTRACT(YEAR FROM now())`;
  await sql`ALTER TABLE fixed_cost_settings ALTER COLUMN season_year SET NOT NULL`;
  await sql`ALTER TABLE fixed_cost_settings DROP CONSTRAINT IF EXISTS fixed_cost_settings_pkey`;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_fixed_cost_settings_company_year
      ON fixed_cost_settings (company_id, season_year)
  `;

  // A college coach contact owned by a company — the Contact Info tab. `sport`
  // splits the tab into its Baseball and Softball lists and uses the same two
  // values as teams.sport. Only the school is required; the coach, their title,
  // cell, email, website, division level, conference, location, and notes fill
  // in over time.
  await sql`
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

  await sql`CREATE INDEX IF NOT EXISTS idx_college_coaches_company_sport ON college_coaches (company_id, sport)`;

  // A hotel the program books for travel — the Hotels tab. Only the name is
  // required. `division` is a teams division slug (or null), and `event_id`
  // ties the stay to a Schedules-tab tournament; it's nulled if that tournament
  // is deleted, which is why `event_name` snapshots what it was booked for.
  await sql`
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

  await sql`CREATE INDEX IF NOT EXISTS idx_hotels_company_id ON hotels (company_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_hotels_event_id ON hotels (event_id)`;

  // A payroll submission is one employee's logged hours for a day, sent through
  // the public payroll form on the sign-in screen (no login). The admin
  // "Payroll" tab lists these and totals the hours; its Reports subtab filters
  // by date range, division, and status. Only the employee name, work date, and
  // hours are required; `division` (a teams division slug, or null) is optional
  // and `status` is the admin's approval decision (defaults to pending).
  await sql`
    CREATE TABLE IF NOT EXISTS payroll_submissions (
      id             SERIAL        PRIMARY KEY,
      company_id     INTEGER       NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      employee_name  VARCHAR(160)  NOT NULL,
      role           VARCHAR(120),
      division       VARCHAR(32),
      work_date      DATE          NOT NULL,
      hours          NUMERIC(6,2)  NOT NULL DEFAULT 0,
      status         VARCHAR(16)   NOT NULL DEFAULT 'pending',
      notes          TEXT,
      created_at     TIMESTAMPTZ   NOT NULL DEFAULT now()
    )
  `;

  // Add `division` and `status` to databases whose payroll_submissions table
  // predates them (status backfills existing rows to 'pending').
  await sql`ALTER TABLE payroll_submissions ADD COLUMN IF NOT EXISTS division VARCHAR(32)`;
  await sql`ALTER TABLE payroll_submissions ADD COLUMN IF NOT EXISTS status VARCHAR(16) NOT NULL DEFAULT 'pending'`;

  await sql`CREATE INDEX IF NOT EXISTS idx_payroll_submissions_company_id ON payroll_submissions (company_id)`;

  // A roster submission is one parent's accept/decline response to a roster
  // offer, sent through the public roster-acceptance form on the sign-in screen
  // (no login). On an accept the player is also added to the chosen team's
  // roster in the same write (player_id links to that row); team_name/division
  // snapshot the choice so it survives the team being deleted (which nulls
  // team_id). The admin "Roster Submissions" tab lists these responses.
  await sql`
    CREATE TABLE IF NOT EXISTS roster_submissions (
      id                  SERIAL        PRIMARY KEY,
      company_id          INTEGER       NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      accepted            BOOLEAN       NOT NULL,
      team_id             INTEGER       REFERENCES teams(id) ON DELETE SET NULL,
      team_name           VARCHAR(120),
      division            VARCHAR(32),
      player_id           INTEGER       REFERENCES players(id) ON DELETE SET NULL,
      player_name         VARCHAR(160)  NOT NULL,
      email               VARCHAR(160),
      returning_jersey    VARCHAR(24),
      grad_year           SMALLINT,
      date_of_birth       DATE,
      parent_name         VARCHAR(160),
      parent_phone        VARCHAR(40),
      secondary_phone     VARCHAR(40),
      height              VARCHAR(24),
      weight              SMALLINT,
      bats                VARCHAR(8),
      throws              VARCHAR(8),
      primary_position    VARCHAR(48),
      secondary_position  VARCHAR(48),
      high_school         VARCHAR(160),
      jersey_option_1     VARCHAR(24),
      jersey_option_2     VARCHAR(24),
      jersey_option_3     VARCHAR(24),
      played_fce_2026     BOOLEAN,
      hat_size            VARCHAR(24),
      created_at          TIMESTAMPTZ   NOT NULL DEFAULT now()
    )
  `;

  await sql`CREATE INDEX IF NOT EXISTS idx_roster_submissions_company_id ON roster_submissions (company_id)`;

  // Rename played_fce_2025 -> played_fce_2026 on databases created before the
  // question's year label rolled forward. Guarded (no RENAME COLUMN IF EXISTS in
  // Postgres) so it's idempotent: only when the old column exists and the new
  // one doesn't.
  await sql`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'roster_submissions'
                   AND column_name = 'played_fce_2025')
        AND NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'roster_submissions'
                   AND column_name = 'played_fce_2026')
      THEN
        ALTER TABLE roster_submissions RENAME COLUMN played_fce_2025 TO played_fce_2026;
      END IF;
    END $$;
  `;

  // High school and parent name were added to the acceptance form after the
  // table shipped; backfill them on existing databases (each mirrors the
  // players column an accept copies it onto).
  await sql`ALTER TABLE roster_submissions ADD COLUMN IF NOT EXISTS high_school VARCHAR(160)`;
  await sql`ALTER TABLE roster_submissions ADD COLUMN IF NOT EXISTS parent_name VARCHAR(160)`;

  // Jersey-assignment automation (see db/schema.sql for the annotated version):
  // reconciles a team's submission-linked jersey numbers atomically under a
  // per-team advisory lock. Returners get priority; new players are first-come
  // across their three options; manual/coach-locked numbers are fixed.
  await sql`
    CREATE OR REPLACE FUNCTION fce_recompute_team_jerseys(p_team_id integer)
    RETURNS void
    LANGUAGE plpgsql
    AS $fn$
    DECLARE
      taken  text[];
      r      record;
      chosen text;
      opt    text;
    BEGIN
      PERFORM pg_advisory_xact_lock(hashtext('fce_jersey_recompute'), p_team_id);

      SELECT coalesce(array_agg(btrim(p.jersey_number)), ARRAY[]::text[])
        INTO taken
      FROM players p
      WHERE p.team_id = p_team_id
        AND p.jersey_number IS NOT NULL
        AND btrim(p.jersey_number) <> ''
        AND (p.jersey_locked
             OR NOT EXISTS (SELECT 1 FROM roster_submissions rs WHERE rs.player_id = p.id));

      FOR r IN
        SELECT rs.player_id, btrim(rs.returning_jersey) AS num
        FROM roster_submissions rs
        JOIN players p ON p.id = rs.player_id
        WHERE rs.team_id = p_team_id AND rs.accepted AND rs.player_id IS NOT NULL
          AND rs.played_fce_2026 IS TRUE
          AND p.jersey_locked = false
        ORDER BY rs.created_at, rs.id
      LOOP
        IF r.num IS NOT NULL AND r.num <> '' AND NOT (r.num = ANY (taken)) THEN
          UPDATE players SET jersey_number = r.num, updated_at = now() WHERE id = r.player_id;
          taken := array_append(taken, r.num);
        ELSE
          UPDATE players SET jersey_number = NULL, updated_at = now() WHERE id = r.player_id;
        END IF;
      END LOOP;

      FOR r IN
        SELECT rs.player_id,
               btrim(rs.jersey_option_1) AS o1,
               btrim(rs.jersey_option_2) AS o2,
               btrim(rs.jersey_option_3) AS o3
        FROM roster_submissions rs
        JOIN players p ON p.id = rs.player_id
        WHERE rs.team_id = p_team_id AND rs.accepted AND rs.player_id IS NOT NULL
          AND rs.played_fce_2026 IS DISTINCT FROM TRUE
          AND p.jersey_locked = false
        ORDER BY rs.created_at, rs.id
      LOOP
        chosen := NULL;
        FOREACH opt IN ARRAY ARRAY[r.o1, r.o2, r.o3] LOOP
          IF opt IS NOT NULL AND opt <> '' AND NOT (opt = ANY (taken)) THEN
            chosen := opt;
            taken := array_append(taken, opt);
            EXIT;
          END IF;
        END LOOP;
        UPDATE players SET jersey_number = chosen, updated_at = now() WHERE id = r.player_id;
      END LOOP;
    END;
    $fn$
  `;

  console.log(`→ Ensuring company "${COMPANY_NAME}" (code: ${COMPANY_CODE})…`);
  const companyRows = await sql`
    INSERT INTO companies (code, name)
    VALUES (${COMPANY_CODE}, ${COMPANY_NAME})
    ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
    RETURNING id
  `;
  const companyId = companyRows[0].id;

  console.log(`→ Ensuring admin user "${ADMIN_USERNAME}"…`);
  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);
  const insertedUser = await sql`
    INSERT INTO users (company_id, username, password_hash, full_name, role)
    VALUES (${companyId}, ${ADMIN_USERNAME}, ${passwordHash}, 'Flood City Elite Admin', 'admin')
    ON CONFLICT (company_id, username) DO NOTHING
    RETURNING id
  `;

  console.log("\n✔  Database ready.\n");
  if (insertedUser.length > 0) {
    console.log("   Created the admin account. Log in with:");
    console.log(`     Company code:  ${COMPANY_CODE}`);
    console.log(`     Username:      ${ADMIN_USERNAME}`);
    console.log(`     Password:      ${ADMIN_PASSWORD}`);
    if (ADMIN_PASSWORD_GENERATED) {
      console.log(
        "\n   ^ This password was generated just now and is shown only once — save it.",
      );
    }
    console.log("   Change it after your first login.\n");
  } else {
    console.log(
      `   Admin user "${ADMIN_USERNAME}" already exists — left unchanged.`,
    );
    console.log(
      "   To reset it, delete that row and re-run with SEED_ADMIN_PASSWORD set.\n",
    );
  }
}

main().catch((err) => {
  console.error("\n✖  Setup failed:", err.message, "\n");
  process.exit(1);
});
