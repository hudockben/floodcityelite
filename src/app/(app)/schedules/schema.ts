import { sql } from "@/lib/db";
import { ensureTeamsSchema } from "../teams/schema";

// Ensure the `schedule_events` table exists before the Schedules tab reads or
// writes it. Like the Teams tab's schema helper, this lets the feature work on
// a database that was set up before the table existed (e.g. a deployed Neon DB)
// without a separate migration step. The DDL mirrors db/schema.sql and
// db/setup.mjs and is idempotent.
//
// Memoized per server instance: the DDL runs once per cold start. If it fails
// (e.g. a transient connection error), the memo is cleared so a later request
// can retry.
let ensured: Promise<void> | null = null;

export function ensureSchedulesSchema(): Promise<void> {
  if (!ensured) {
    ensured = provision().catch((err) => {
      ensured = null;
      throw err;
    });
  }
  return ensured;
}

async function provision(): Promise<void> {
  // schedule_events references teams(id), so make sure teams (and its parent
  // companies) exist first.
  await ensureTeamsSchema();

  const db = sql();

  await db`
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
                        CHECK (status IN ('registered', 'paid', 'waitlisted')),
      created_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
      updated_at      TIMESTAMPTZ   NOT NULL DEFAULT now()
    )
  `;

  await db`CREATE INDEX IF NOT EXISTS idx_schedule_events_team_id ON schedule_events (team_id)`;

  // Add the tournament end date to databases whose schedule_events table
  // predates it. Nullable and idempotent, mirroring db/setup.mjs.
  await db`ALTER TABLE schedule_events ADD COLUMN IF NOT EXISTS event_end_date DATE`;
}
