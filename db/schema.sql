-- ---------------------------------------------------------------------------
-- Portal — database schema
--
-- Applied once per organization, to that organization's own database. Every
-- organization on this portal is a tenant with its own database, so each one
-- gets its own copy of these tables — that separation is what makes it
-- impossible for a query to return one organization's rows to another's screen.
--
-- You can run this file directly in the Neon SQL Editor (connected to the
-- database of the organization you are setting up), or let the app do it for
-- you with:  npm run db:setup -- --tenant <code>
-- ---------------------------------------------------------------------------

-- Companies (tenants). Login requires a company code, e.g. "fce".
CREATE TABLE IF NOT EXISTS companies (
    id          SERIAL PRIMARY KEY,
    code        VARCHAR(32)  NOT NULL UNIQUE,
    name        VARCHAR(255) NOT NULL,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Users belong to a company. A username is unique *within* a company, so
-- different companies can each have their own "admin", "coach", etc.
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
);

CREATE INDEX IF NOT EXISTS idx_users_company_id ON users (company_id);

-- ---------------------------------------------------------------------------
-- Seasons
--
-- A season is one division's run in a given year (Spring/Summer Baseball 2026,
-- Softball 2027, …). Each division rolls over on its own calendar, so a season
-- is keyed by (company, division, year). A team belongs to one season via
-- teams.season_id, and rosters/schedules/budgets inherit it through the team.
-- One season per division is active (is_active) — the one shown by default.
-- `label` is an optional custom name; when null the app derives "<year>
-- <division>".
-- ---------------------------------------------------------------------------
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
);

CREATE INDEX IF NOT EXISTS idx_seasons_company_division ON seasons (company_id, division);

-- At most one active season per (company, division).
CREATE UNIQUE INDEX IF NOT EXISTS ux_seasons_one_active ON seasons (company_id, division) WHERE is_active;

-- ---------------------------------------------------------------------------
-- Teams & rosters
--
-- Top-down organization: a team belongs to a company, sits in a division
-- (Spring/Summer Baseball, Softball, or Fall Baseball), is assigned a sport
-- (baseball or softball), and belongs to a season (its division's run for a
-- year). Players (roster rows) belong to a team.
-- ---------------------------------------------------------------------------

-- A team belongs to a company. Divisions and sports are constrained to the
-- values the Teams tab offers.
CREATE TABLE IF NOT EXISTS teams (
    id          SERIAL PRIMARY KEY,
    company_id  INTEGER      NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name        VARCHAR(120) NOT NULL,
    division    VARCHAR(32)  NOT NULL
                  CHECK (division IN ('spring-summer-baseball', 'softball', 'fall-baseball')),
    sport       VARCHAR(16)  NOT NULL DEFAULT 'baseball'
                  CHECK (sport IN ('baseball', 'softball')),
    -- The season (division + year) this team belongs to. Rosters, schedules,
    -- and budgets all hang off the team, so they inherit the season through it.
    season_id   INTEGER      REFERENCES seasons(id) ON DELETE CASCADE,
    -- How many standing roster groups this team is split into (0 = not using
    -- groups). Powers the Schedules-tab group rotation.
    roster_group_count SMALLINT NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_teams_company_division ON teams (company_id, division);
CREATE INDEX IF NOT EXISTS idx_teams_season_id ON teams (season_id);

-- Players (roster rows) belong to a team. Only player_name is required; every
-- other column is optional so a coach can fill the roster out over time. The
-- columns mirror the Teams-tab roster headers. `is_paying` marks whether the
-- player pays tuition/dues — it defaults to true (everyone pays unless marked
-- otherwise) and drives the Budgets tab's paying-player count. `is_returning`
-- is the roster's New/Returning override: null falls back to the acceptance
-- form's "Did you play in 2026?" answer, and reads as unknown when there's no
-- submission behind the player either.
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
    -- Which standing roster group the player is in (1..team.roster_group_count),
    -- or null when ungrouped. Used by the Schedules-tab group rotation.
    roster_group        SMALLINT,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_players_team_id ON players (team_id);

-- Add the New/Returning override to a database whose `players` table predates
-- it (CREATE TABLE IF NOT EXISTS above leaves an existing table alone).
-- Nullable, so every existing player keeps falling back to the acceptance
-- form's answer until a coach sets one. Idempotent.
ALTER TABLE players ADD COLUMN IF NOT EXISTS is_returning BOOLEAN;

-- ---------------------------------------------------------------------------
-- Payments
--
-- Each payment is logged against a player (→ team → company) and powers the
-- Payment Tracker tab. A payment records the date it was received, the type
-- (check or cash), and the amount. Running and grand totals are computed from
-- these rows — the "accumulating amount of payments received".
-- ---------------------------------------------------------------------------
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
);

CREATE INDEX IF NOT EXISTS idx_payments_player_id ON payments (player_id);

-- Team budgets
--
-- One budget row per team (team_id is the primary key). The Budgets tab reads
-- the paying-player count from the roster by default — the number of players
-- marked `is_paying` on the Teams tab; paying_players is an optional manual
-- override for the rare case that count needs adjusting by hand. Money columns
-- are stored as NUMERIC. Current balance / fundraising are derived downstream
-- from the Schedules tab and the fundraiser_entries credited to the team (see
-- Fundraisers below), so they aren't stored here.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS team_budgets (
    team_id                 INTEGER       PRIMARY KEY
                              REFERENCES teams(id) ON DELETE CASCADE,
    tuition_per_player      NUMERIC(12,2) NOT NULL DEFAULT 0,
    -- NULL means "derive it": tuition per player minus the fixed cost per
    -- player (see fixed_cost_* below). A number is a manual override.
    portion_to_team_budget  NUMERIC(12,2),
    paying_players          INTEGER,
    created_at              TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- Let the portion be NULL on a database whose team_budgets predates the Fixed
-- Cost tab, where the column was NOT NULL DEFAULT 0 (CREATE TABLE IF NOT EXISTS
-- above leaves an existing table alone). Saved numbers stay put as manual
-- overrides; clearing the field on the sheet derives it instead. Idempotent.
ALTER TABLE team_budgets ALTER COLUMN portion_to_team_budget DROP NOT NULL;
ALTER TABLE team_budgets ALTER COLUMN portion_to_team_budget DROP DEFAULT;

-- Team expenses
--
-- Ad-hoc costs logged against a team on the Budgets tab (a coach's hotel, gas,
-- gear, etc.). Each row records a date, the vendor, a total cost, and a status.
-- A 'paid' expense is deducted from the team's current balance; a 'refund' is
-- credited back to it; a 'not_paid' expense is tracked but leaves the balance
-- unchanged until it's marked paid. The per-team totals are computed at read
-- time, not stored.
-- ---------------------------------------------------------------------------
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
);

CREATE INDEX IF NOT EXISTS idx_team_expenses_team_id ON team_expenses (team_id);

-- ---------------------------------------------------------------------------
-- Schedules
--
-- A schedule event (a tournament/game/practice) belongs to a team. It carries
-- the columns shown on the Schedules tab: host, date, name, location, cost,
-- and a registration status. The per-team "total cost" is the sum of cost
-- across a team's events and is computed at read time, not stored.
-- ---------------------------------------------------------------------------

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
);

CREATE INDEX IF NOT EXISTS idx_schedule_events_team_id ON schedule_events (team_id);

-- Event groups (playing-time rotation)
--
-- Which roster players are attending a given tournament. To keep everyone
-- getting a fair share of playing time a coach may take, say, 12 of 15 to a
-- weekend. Rather than store a row per (event, player), we store only the
-- decisions that deviate from the default: a player is attending an event
-- unless a row marks them attending = false. That keeps the common case (bench
-- a few) to a handful of rows and lets a brand-new event start with the whole
-- roster attending. A player's total appearances (used to check everyone hits
-- the target number of tournaments) is derived from these rows at read time.
CREATE TABLE IF NOT EXISTS event_attendance (
    id          SERIAL      PRIMARY KEY,
    event_id    INTEGER     NOT NULL REFERENCES schedule_events(id) ON DELETE CASCADE,
    player_id   INTEGER     NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    attending   BOOLEAN     NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (event_id, player_id)
);

CREATE INDEX IF NOT EXISTS idx_event_attendance_event_id ON event_attendance (event_id);
CREATE INDEX IF NOT EXISTS idx_event_attendance_player_id ON event_attendance (player_id);

-- Event groups (which standing roster groups play a given event)
--
-- When a coach splits the roster into groups (see teams.roster_group_count and
-- players.roster_group), each event travels a combination of them — Groups 1 &
-- 2 one weekend, 1 & 3 the next. The selected group numbers are stored here and
-- drive who's attending: a player plays when their roster_group is selected and
-- sits otherwise, unless an event_attendance row overrides them for that event.
-- An event with no rows keeps the default (whole roster attends unless benched).
CREATE TABLE IF NOT EXISTS event_groups (
    id            SERIAL      PRIMARY KEY,
    event_id      INTEGER     NOT NULL REFERENCES schedule_events(id) ON DELETE CASCADE,
    group_number  SMALLINT    NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (event_id, group_number)
);

CREATE INDEX IF NOT EXISTS idx_event_groups_event_id ON event_groups (event_id);

-- ---------------------------------------------------------------------------
-- Fundraisers
--
-- A fundraiser is a campaign/event owned by a company (e.g. "Spring Car
-- Wash"), optionally with a goal and a date. Each fundraiser_entry ties an
-- amount raised to a fundraiser and a team; player-based fundraisers also name
-- a specific player, while team-based fundraisers leave player_id NULL. The
-- Fundraiser Tracker tab shows per-fundraiser and grand totals from these
-- rows. Only the fundraiser name and an entry's amount are required.
--
-- Entries also feed the Budgets tab: a team's entries are summed and credited
-- to its current balance, so logging one is an uptick in that team's budget
-- (and shrinks the fundraising it still needs per player). team_id is what
-- scopes that credit — a team belongs to one season, so a season's budget sheet
-- only ever counts what was raised for it.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS fundraisers (
    id          SERIAL        PRIMARY KEY,
    company_id  INTEGER       NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name        VARCHAR(160)  NOT NULL,
    goal        NUMERIC(10,2),
    event_date  DATE,
    created_at  TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fundraisers_company_id ON fundraisers (company_id);

CREATE TABLE IF NOT EXISTS fundraiser_entries (
    id             SERIAL        PRIMARY KEY,
    fundraiser_id  INTEGER       NOT NULL REFERENCES fundraisers(id) ON DELETE CASCADE,
    team_id        INTEGER       NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    player_id      INTEGER       REFERENCES players(id) ON DELETE CASCADE,
    raised_on      DATE          NOT NULL DEFAULT CURRENT_DATE,
    amount         NUMERIC(10,2) NOT NULL DEFAULT 0,
    created_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fundraiser_entries_fundraiser_id ON fundraiser_entries (fundraiser_id);
CREATE INDEX IF NOT EXISTS idx_fundraiser_entries_team_id ON fundraiser_entries (team_id);
CREATE INDEX IF NOT EXISTS idx_fundraiser_entries_player_id ON fundraiser_entries (player_id);

-- ---------------------------------------------------------------------------
-- Programs / Camps
--
-- A camp is a program/clinic/camp owned by a company (e.g. "Winter Hitting
-- Clinic"), optionally with a location and a date. Each camp keeps its own
-- roster of camp_players (separate from the Teams roster), recording the
-- player's name, the parent's name, a parent contact, and a location. A
-- camp_payment is logged against a camp player and mirrors the payments table:
-- the date received, the type (check or cash), an optional check number, and an
-- amount. A camp_expense is what putting the camp on cost — umpire fees for a
-- showcase, field rental, gear — and mirrors the Budgets tab's team_expenses,
-- statuses included, so it comes off what the camp collected. The Program/Camps
-- tab shows per-player, per-camp, and net totals from these rows. Only the camp
-- name and a player's name are required.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS camps (
    id          SERIAL        PRIMARY KEY,
    company_id  INTEGER       NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name        VARCHAR(160)  NOT NULL,
    location    VARCHAR(200),
    event_date  DATE,
    created_at  TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_camps_company_id ON camps (company_id);

CREATE TABLE IF NOT EXISTS camp_players (
    id              SERIAL        PRIMARY KEY,
    camp_id         INTEGER       NOT NULL REFERENCES camps(id) ON DELETE CASCADE,
    player_name     VARCHAR(160)  NOT NULL,
    parent_name     VARCHAR(160),
    parent_contact  VARCHAR(200),
    location        VARCHAR(200),
    created_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_camp_players_camp_id ON camp_players (camp_id);

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
);

CREATE INDEX IF NOT EXISTS idx_camp_payments_camp_player_id ON camp_payments (camp_player_id);

CREATE TABLE IF NOT EXISTS camp_expenses (
    id            SERIAL        PRIMARY KEY,
    camp_id       INTEGER       NOT NULL REFERENCES camps(id) ON DELETE CASCADE,
    expense_date  DATE,
    vendor        VARCHAR(200),
    amount        NUMERIC(12,2) NOT NULL DEFAULT 0,
    status        VARCHAR(16)   NOT NULL DEFAULT 'paid'
                    CHECK (status IN ('paid', 'not_paid', 'refund')),
    created_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_camp_expenses_camp_id ON camp_expenses (camp_id);

-- ---------------------------------------------------------------------------
-- Fixed costs
--
-- What the program pays for up front regardless of which team a player lands
-- on: uniforms, insurance, facility time. Costs are grouped under sections the
-- user names, and the total divided by the player count is the *fixed cost per
-- player* the Budgets tab subtracts from each team's tuition to work out the
-- portion of a player's payment that reaches the team budget.
--
-- Costs are kept per season *year* (a season row is one division's run, but
-- insurance and uniforms are bought once for the whole program), so one year's
-- sheet feeds every division's budgets for that year.
-- `fixed_cost_settings.player_count` is an optional manual override for that
-- year's divisor; when NULL it falls back to the players marked "Paying" on the
-- rosters of that year's seasons.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fixed_cost_sections (
    id           SERIAL        PRIMARY KEY,
    company_id   INTEGER       NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    season_year  SMALLINT      NOT NULL DEFAULT EXTRACT(YEAR FROM now()),
    name         VARCHAR(160)  NOT NULL,
    created_at   TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- Add the season year to a database whose sections predate it, putting the
-- existing sheet on the company's active season year (falling back to this
-- year) so nothing disappears when the tab starts asking for a year. Runs
-- before the index below, which references the column. Idempotent.
ALTER TABLE fixed_cost_sections ADD COLUMN IF NOT EXISTS season_year SMALLINT;
UPDATE fixed_cost_sections s
SET season_year = COALESCE(
  (SELECT max(se.year) FROM seasons se WHERE se.company_id = s.company_id AND se.is_active),
  EXTRACT(YEAR FROM now())::smallint)
WHERE s.season_year IS NULL;
ALTER TABLE fixed_cost_sections ALTER COLUMN season_year SET DEFAULT EXTRACT(YEAR FROM now());
ALTER TABLE fixed_cost_sections ALTER COLUMN season_year SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_fixed_cost_sections_company_year ON fixed_cost_sections (company_id, season_year);

CREATE TABLE IF NOT EXISTS fixed_cost_items (
    id          SERIAL        PRIMARY KEY,
    section_id  INTEGER       NOT NULL REFERENCES fixed_cost_sections(id) ON DELETE CASCADE,
    name        VARCHAR(160)  NOT NULL,
    amount      NUMERIC(12,2) NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fixed_cost_items_section_id ON fixed_cost_items (section_id);

CREATE TABLE IF NOT EXISTS fixed_cost_settings (
    company_id    INTEGER      NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    season_year   SMALLINT     NOT NULL DEFAULT EXTRACT(YEAR FROM now()),
    player_count  INTEGER,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Same for the settings row, plus swapping its company-only primary key for a
-- (company, year) unique index so each year carries its own player count.
ALTER TABLE fixed_cost_settings ADD COLUMN IF NOT EXISTS season_year SMALLINT;
UPDATE fixed_cost_settings f
SET season_year = COALESCE(
  (SELECT max(se.year) FROM seasons se WHERE se.company_id = f.company_id AND se.is_active),
  EXTRACT(YEAR FROM now())::smallint)
WHERE f.season_year IS NULL;
ALTER TABLE fixed_cost_settings ALTER COLUMN season_year SET DEFAULT EXTRACT(YEAR FROM now());
ALTER TABLE fixed_cost_settings ALTER COLUMN season_year SET NOT NULL;
ALTER TABLE fixed_cost_settings DROP CONSTRAINT IF EXISTS fixed_cost_settings_pkey;
CREATE UNIQUE INDEX IF NOT EXISTS ux_fixed_cost_settings_company_year
  ON fixed_cost_settings (company_id, season_year);



-- ---------------------------------------------------------------------------
-- Contact Info (college coaches)
--
-- One college program's contact, owned by a company. `sport` splits the Contact
-- Info tab into its Baseball and Softball lists and uses the same two values as
-- teams.sport. Only the school is required — the coach, their title, cell,
-- email, website, division level, conference, location, and notes fill in as
-- the program gets recruited.
-- ---------------------------------------------------------------------------
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
);

CREATE INDEX IF NOT EXISTS idx_college_coaches_company_sport ON college_coaches (company_id, sport);

-- ---------------------------------------------------------------------------
-- Hotels (team travel)
--
-- A hotel the program books for travel, owned by a company. Only the name is
-- required. `division` is a teams division slug (or null), and `event_id` ties
-- the stay to a Schedules-tab tournament — set to null if that tournament is
-- later deleted, which is why `event_name` snapshots what the stay was booked
-- for. `avg_cost_per_night` is the nightly room rate the Hotels tab averages
-- across the list in view.
-- ---------------------------------------------------------------------------
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
);

CREATE INDEX IF NOT EXISTS idx_hotels_company_id ON hotels (company_id);
CREATE INDEX IF NOT EXISTS idx_hotels_event_id ON hotels (event_id);

-- ---------------------------------------------------------------------------
-- Payroll
--
-- A payroll submission is one employee's logged hours for a day, sent through
-- the public payroll form on the sign-in screen (no login required). It records
-- the employee's name, an optional role, an optional division (a teams division
-- slug, or null when unassigned), the date worked, the hours, an approval
-- `status` the admin sets (pending → approved/denied), and optional notes. The
-- admin "Payroll" tab lists these rows and totals the hours; its Reports subtab
-- filters them by date range, division, and status. Belongs to a company so
-- submissions are scoped like the rest of the app.
-- ---------------------------------------------------------------------------
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
);

CREATE INDEX IF NOT EXISTS idx_payroll_submissions_company_id ON payroll_submissions (company_id);

-- ---------------------------------------------------------------------------
-- Roster submissions (acceptance form)
--
-- One parent's response to a roster offer, sent through the public
-- roster-acceptance form on the sign-in screen (no login). `accepted` is the
-- decision: a decline records the player's name and the team whose spot was
-- turned down, while an accept carries the full player + parent detail (the
-- team is required either way). On an accept the player is also pushed onto
-- the chosen team's roster in the same write; `player_id` links to that
-- `players` row so the admin "Roster Submissions" tab can point back to it, and
-- `team_name`/`division` snapshot the choice so it survives the team being
-- deleted later (which nulls `team_id`). The extra tryout fields the roster
-- doesn't track (returning/option jersey numbers, secondary phone, bats/throws,
-- hat size, whether they played in 2025) live here on the submission.
-- ---------------------------------------------------------------------------
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
);

CREATE INDEX IF NOT EXISTS idx_roster_submissions_company_id ON roster_submissions (company_id);

-- ---------------------------------------------------------------------------
-- Jersey-assignment automation
--
-- Reconciles a team's submission-linked jersey numbers from all of its accepted
-- roster submissions, atomically and race-free: the whole read-compute-write
-- runs in this one function under a per-team advisory lock. Returning players
-- (played_fce_2026 = true) get their returning number with priority; new players
-- are first-come (oldest submission first) and take the first of their three
-- options that's still free. Numbers held by manual players (no submission) or
-- coach-locked players (jersey_locked = true) are fixed and never reassigned.
-- Called on each acceptance. CREATE OR REPLACE keeps it idempotent.
-- ---------------------------------------------------------------------------
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
$fn$;

-- ---------------------------------------------------------------------------
-- The company row is deliberately NOT seeded here.
--
-- This file is applied to whichever organization's database is being set up,
-- and it has no way of knowing which one that is. A hardcoded company would
-- therefore create the *wrong* organization in someone else's database — and
-- silently, since every login and every query would still work, just against a
-- company nobody meant to create.
--
-- The row is seeded per database by the setup script instead, which takes the
-- code and name from the tenant registry in `src/lib/tenants.ts`:
--
--   npm run db:setup                       -- Flood City Elite (code: fce)
--   npm run db:setup -- --tenant fennell   -- Fennell Bros. (code: fennell)
--
-- Applying this schema by hand in the Neon SQL Editor? Insert the one row for
-- the organization *this* database belongs to, e.g.:
--
--   INSERT INTO companies (code, name) VALUES ('fennell', 'Fennell Bros.') ON CONFLICT (code) DO NOTHING;
-- ---------------------------------------------------------------------------
