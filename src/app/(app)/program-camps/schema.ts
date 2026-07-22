import { sql } from "@/lib/db";

// Ensure the `camps`, `camp_players`, and `camp_payments` tables exist before
// the Program/Camps tab reads or writes them. Like the other tabs' schema
// helpers, this lets the feature work on a database that predates it (e.g. a
// deployed Neon DB) without a separate migration step. The DDL mirrors
// db/schema.sql and db/setup.mjs and is idempotent.
//
// Memoized per server instance: the DDL runs once per cold start. If it fails
// (e.g. a transient connection error), the memo is cleared so a later request
// can retry.
let ensured: Promise<void> | null = null;

export function ensureCampsSchema(): Promise<void> {
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

  // A camp is a program/clinic/camp owned by a company (e.g. "Winter Hitting
  // Clinic"). Only the name is required; location and event_date are optional.
  // Camps are independent of teams — a camp keeps its own roster of players.
  await db`
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

  await db`CREATE INDEX IF NOT EXISTS idx_camps_company_id ON camps (company_id)`;

  // A camp player is a registration on a camp's roster. Only player_name is
  // required; the parent's name, the parent's contact info, and a location can
  // be filled in over time. This roster is separate from the Teams roster.
  await db`
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

  await db`CREATE INDEX IF NOT EXISTS idx_camp_players_camp_id ON camp_players (camp_id)`;

  // A camp payment is logged against a camp player and mirrors the Payment
  // Tracker's `payments` table: the date received, the type (check or cash), an
  // optional check number, and the amount. Running and grand totals are
  // computed from these rows.
  await db`
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

  await db`CREATE INDEX IF NOT EXISTS idx_camp_payments_camp_player_id ON camp_payments (camp_player_id)`;
}
