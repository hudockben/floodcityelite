-- ---------------------------------------------------------------------------
-- Flood City Elite — database schema
--
-- You can run this file directly in the Neon SQL Editor, or let the app do it
-- for you with:  npm run db:setup
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
-- Teams & rosters
--
-- Top-down organization: a team belongs to a company, sits in a division
-- (Spring/Summer Baseball, Softball, or Fall Baseball) and is assigned a sport
-- (baseball or softball). Players (roster rows) belong to a team.
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
    -- How many standing roster groups this team is split into (0 = not using
    -- groups). Powers the Schedules-tab group rotation.
    roster_group_count SMALLINT NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_teams_company_division ON teams (company_id, division);

-- Players (roster rows) belong to a team. Only player_name is required; every
-- other column is optional so a coach can fill the roster out over time. The
-- columns mirror the Teams-tab roster headers.
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
    -- Which standing roster group the player is in (1..team.roster_group_count),
    -- or null when ungrouped. Used by the Schedules-tab group rotation.
    roster_group        SMALLINT,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_players_team_id ON players (team_id);

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
-- the paying-player count from the roster (players) by default; paying_players
-- overrides that when not everyone on the roster pays. Money columns are
-- stored as NUMERIC. Current balance / fundraising are derived downstream from
-- the Schedules tab once that feature lands, so they aren't stored here.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS team_budgets (
    team_id                 INTEGER       PRIMARY KEY
                              REFERENCES teams(id) ON DELETE CASCADE,
    tuition_per_player      NUMERIC(12,2) NOT NULL DEFAULT 0,
    portion_to_team_budget  NUMERIC(12,2) NOT NULL DEFAULT 0,
    paying_players          INTEGER,
    created_at              TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ   NOT NULL DEFAULT now()
);

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
-- amount. The Program/Camps tab shows per-player and per-camp totals from these
-- rows. Only the camp name and a player's name are required.
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

-- Seed the Flood City Elite company (code: fce). Idempotent.
INSERT INTO companies (code, name)
VALUES ('fce', 'Flood City Elite')
ON CONFLICT (code) DO NOTHING;
