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

  // Players (roster rows) belong to a team. Only player_name is required.
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
      high_school         VARCHAR(160),
      parent_phone        VARCHAR(40),
      parent_email        VARCHAR(160),
      parent_name         VARCHAR(160),
      closest_facility    VARCHAR(160),
      created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
      updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now()
    )
  `;

  await sql`CREATE INDEX IF NOT EXISTS idx_players_team_id ON players (team_id)`;

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

  // One budget row per team. The paying-player count defaults to the roster
  // size (players); paying_players overrides it when not everyone pays.
  await sql`
    CREATE TABLE IF NOT EXISTS team_budgets (
      team_id                 INTEGER       PRIMARY KEY REFERENCES teams(id) ON DELETE CASCADE,
      tuition_per_player      NUMERIC(12,2) NOT NULL DEFAULT 0,
      portion_to_team_budget  NUMERIC(12,2) NOT NULL DEFAULT 0,
      paying_players          INTEGER,
      created_at              TIMESTAMPTZ   NOT NULL DEFAULT now(),
      updated_at              TIMESTAMPTZ   NOT NULL DEFAULT now()
    )
  `;

  // Schedule events (tournaments/games) belong to a team. Only event_name is
  // required; cost is optional and summed per team on the Schedules tab.
  await sql`
    CREATE TABLE IF NOT EXISTS schedule_events (
      id          SERIAL PRIMARY KEY,
      team_id     INTEGER       NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      event_host  VARCHAR(160),
      event_date  DATE,
      event_name  VARCHAR(200)  NOT NULL,
      location    VARCHAR(200),
      cost        NUMERIC(10, 2),
      status      VARCHAR(16)   NOT NULL DEFAULT 'registered'
                    CHECK (status IN ('registered', 'paid', 'waitlisted')),
      created_at  TIMESTAMPTZ   NOT NULL DEFAULT now(),
      updated_at  TIMESTAMPTZ   NOT NULL DEFAULT now()
    )
  `;

  await sql`CREATE INDEX IF NOT EXISTS idx_schedule_events_team_id ON schedule_events (team_id)`;

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
