import { sql } from "@/lib/db";
import { ensureTeamsSchema } from "../teams/schema";

// Ensure the `payments` table exists before the Payment Tracker tab reads or
// writes it. Mirrors db/schema.sql and db/setup.mjs so the feature works on a
// database that predates it (e.g. a deployed Neon DB) without a manual
// migration. Idempotent and memoized per server instance; the memo is cleared
// on failure so a later request can retry.
let ensured: Promise<void> | null = null;

export function ensurePaymentsSchema(): Promise<void> {
  if (!ensured) {
    ensured = provision().catch((err) => {
      ensured = null;
      throw err;
    });
  }
  return ensured;
}

async function provision(): Promise<void> {
  // Payments reference players (→ teams → companies), so make sure the roster
  // tables exist first. ensureTeamsSchema is itself idempotent and memoized.
  await ensureTeamsSchema();

  const db = sql();

  await db`
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

  await db`CREATE INDEX IF NOT EXISTS idx_payments_player_id ON payments (player_id)`;

  // Backfill check_number on databases that provisioned `payments` before this
  // column existed (e.g. an earlier deploy). ADD COLUMN IF NOT EXISTS is a no-op
  // once it's there, so this stays idempotent.
  await db`ALTER TABLE payments ADD COLUMN IF NOT EXISTS check_number VARCHAR(32)`;
}
