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

-- Seed the Flood City Elite company (code: fce). Idempotent.
INSERT INTO companies (code, name)
VALUES ('fce', 'Flood City Elite')
ON CONFLICT (code) DO NOTHING;
