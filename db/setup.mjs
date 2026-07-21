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
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || "FloodCity2026!";

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
  await sql`
    INSERT INTO users (company_id, username, password_hash, full_name, role)
    VALUES (${companyId}, ${ADMIN_USERNAME}, ${passwordHash}, 'Flood City Elite Admin', 'admin')
    ON CONFLICT (company_id, username) DO NOTHING
  `;

  console.log("\n✔  Database ready.\n");
  console.log("   Log in with:");
  console.log(`     Company code:  ${COMPANY_CODE}`);
  console.log(`     Username:      ${ADMIN_USERNAME}`);
  console.log(`     Password:      ${ADMIN_PASSWORD}`);
  console.log("\n   (Change this password after your first login.)\n");
}

main().catch((err) => {
  console.error("\n✖  Setup failed:", err.message, "\n");
  process.exit(1);
});
