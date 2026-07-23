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
                        CHECK (status IN ('registered', 'paid', 'waitlisted', 'rainout', 'refund')),
      created_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
      updated_at      TIMESTAMPTZ   NOT NULL DEFAULT now()
    )
  `;

  await db`CREATE INDEX IF NOT EXISTS idx_schedule_events_team_id ON schedule_events (team_id)`;

  // Add the tournament end date to databases whose schedule_events table
  // predates it. Nullable and idempotent, mirroring db/setup.mjs.
  await db`ALTER TABLE schedule_events ADD COLUMN IF NOT EXISTS event_end_date DATE`;

  // Widen the status CHECK to allow the Rain Out / Refund options on databases
  // created before they existed. Postgres names an unnamed inline column CHECK
  // <table>_<column>_check, so drop that and re-add the full option list.
  await db`ALTER TABLE schedule_events DROP CONSTRAINT IF EXISTS schedule_events_status_check`;
  await db`
    ALTER TABLE schedule_events
      ADD CONSTRAINT schedule_events_status_check
      CHECK (status IN ('registered', 'paid', 'waitlisted', 'rainout', 'refund'))
  `;

  // Event groups (playing-time rotation). One row per (event, player) that has
  // been explicitly decided; a player is attending an event unless a row marks
  // them attending = false. Storing only the decisions keeps the common case
  // (bench a few players) cheap and lets a new event default to the full
  // roster. Cascades from both the event and the player.
  await db`
    CREATE TABLE IF NOT EXISTS event_attendance (
      id          SERIAL PRIMARY KEY,
      event_id    INTEGER     NOT NULL REFERENCES schedule_events(id) ON DELETE CASCADE,
      player_id   INTEGER     NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      attending   BOOLEAN     NOT NULL DEFAULT true,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (event_id, player_id)
    )
  `;

  await db`CREATE INDEX IF NOT EXISTS idx_event_attendance_event_id ON event_attendance (event_id)`;
  await db`CREATE INDEX IF NOT EXISTS idx_event_attendance_player_id ON event_attendance (player_id)`;

  // Which standing roster groups play a given event. When a coach picks, say,
  // Groups 1 & 2 for a weekend, those group numbers are stored here and drive
  // who's attending (players whose roster_group is selected play; the rest
  // sit), leaving event_attendance to hold only per-player exceptions. An event
  // with no rows keeps the legacy "whole roster attends unless benched"
  // behaviour. Cascades when the event is removed.
  await db`
    CREATE TABLE IF NOT EXISTS event_groups (
      id            SERIAL      PRIMARY KEY,
      event_id      INTEGER     NOT NULL REFERENCES schedule_events(id) ON DELETE CASCADE,
      group_number  SMALLINT    NOT NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (event_id, group_number)
    )
  `;

  await db`CREATE INDEX IF NOT EXISTS idx_event_groups_event_id ON event_groups (event_id)`;
}
