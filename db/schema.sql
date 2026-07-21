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
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_players_team_id ON players (team_id);

-- Seed the Flood City Elite company (code: fce). Idempotent.
INSERT INTO companies (code, name)
VALUES ('fce', 'Flood City Elite')
ON CONFLICT (code) DO NOTHING;
