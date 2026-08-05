import { sql } from "@/lib/db";
import { currentTenant } from "@/lib/tenant";
import { ensureTeamsSchema } from "../teams/schema";

// Ensure the `payments` table exists before the Payment Tracker tab reads or
// writes it. Mirrors db/schema.sql and db/setup.mjs so the feature works on a
// database that predates it (e.g. a deployed Neon DB) without a manual
// migration. Idempotent and memoized per server instance and per organization,
// so the DDL runs once per cold start per organization. The key matters because
// each organization has its own database — provision() runs against whichever
// one the request belongs to, so a single shared memo would let the organization
// that happened to warm the instance provision itself and hand every later
// request from the other one an already-resolved promise, skipping its DDL (and
// the check_number backfill below) entirely. On failure only that organization's
// memo is cleared, so it can retry on a later request without re-running the
// other's.
const ensured = new Map<string, Promise<void>>();

export async function ensurePaymentsSchema(): Promise<void> {
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
