// ---------------------------------------------------------------------------
// Roster acceptance — shared schema, data access, types, and formatters
//
// Two sides use this module:
//   • the public acceptance form at /roster-acceptance (no login) lets a parent
//     accept or decline their player's roster spot;
//   • the admin "Roster Submissions" tab at /roster-submissions reads the
//     submissions back.
//
// A *roster submission* is one parent's response to a roster offer: the
// accept/decline decision, the team the offer was for (recorded either way, so a
// decline shows which spot opened back up), the player's details, and the
// parent's contact info.
// When a parent ACCEPTS, the player is pushed straight onto the chosen team's
// roster (a `players` row) in the same write, and the submission records which
// player row it created so the admin tab can link back to it.
//
// Plain server-side module (uses the Neon client). Imported by both the public
// server action and the protected admin page/action.
// ---------------------------------------------------------------------------

import { sql } from "@/lib/db";
import { currentTenant } from "@/lib/tenant";

// Re-exported so existing importers keep resolving `formatRosterDate` from this
// module. The implementation lives in the DB-free `roster-format` module so
// client components can use it without bundling the Neon client.
export { formatRosterDate } from "@/lib/roster-format";

// A team offered in the public form's dropdown. `division` is the slug so the
// admin tab can link a submission back to the right Teams-tab division.
export type RosterTeamOption = {
  id: number;
  name: string;
  division: string;
  sport: string;
};

// A saved roster submission, as read by the admin tab. `current_*` columns come
// from a live join to `teams` — they're null when the team has since been
// deleted, in which case the snapshot `team_name` still shows what was chosen.
export type RosterSubmissionRow = {
  id: number;
  accepted: boolean;
  team_id: number | null;
  team_name: string | null; // snapshot at submit time
  division: string | null; // snapshot slug at submit time
  current_team_name: string | null; // live team name (null if team deleted)
  current_division: string | null; // live division slug (null if team deleted)
  current_season_year: number | null; // the team's season year (null if team deleted)
  player_id: number | null; // roster row created on accept (null on decline)
  player_name: string;
  email: string | null;
  returning_jersey: string | null;
  grad_year: number | null;
  date_of_birth: string | null; // YYYY-MM-DD
  parent_name: string | null;
  parent_phone: string | null;
  secondary_phone: string | null;
  height: string | null;
  weight: number | null;
  bats: string | null;
  throws: string | null;
  primary_position: string | null;
  secondary_position: string | null;
  high_school: string | null;
  jersey_option_1: string | null;
  jersey_option_2: string | null;
  jersey_option_3: string | null;
  played_fce_2026: boolean | null;
  hat_size: string | null;
  created_at: string;
};

// The fields the public form collects. Validation happens in the form's action;
// this module just persists what it's given.
export type RosterSubmissionInput = {
  companyId: number;
  accepted: boolean;
  // The team the offer was for — collected on accept AND decline. teamId is
  // validated + owned by the action; teamName/division snapshot it.
  teamId: number | null;
  teamName: string | null;
  division: string | null;
  playerName: string;
  email: string | null;
  returningJersey: string | null;
  gradYear: number | null;
  dateOfBirth: string | null; // YYYY-MM-DD
  parentName: string | null;
  parentPhone: string | null;
  secondaryPhone: string | null;
  height: string | null;
  weight: number | null;
  bats: string | null;
  throws: string | null;
  primaryPosition: string | null;
  secondaryPosition: string | null;
  highSchool: string | null;
  jerseyOption1: string | null;
  jerseyOption2: string | null;
  jerseyOption3: string | null;
  playedFce2026: boolean | null;
  hatSize: string | null;
};

// Ensure the `roster_submissions` table exists before it's read or written. Like
// the other tabs' schema helpers this lets the feature work on a database that
// predates it without a separate migration step. The DDL mirrors db/schema.sql
// and db/setup.mjs and is idempotent.
//
// Memoized per server instance: the DDL runs once per cold start. If it fails
// (e.g. a transient connection error) the memo is cleared so a later request
// can retry.
let ensured: Promise<void> | null = null;

export function ensureRosterSubmissionsSchema(): Promise<void> {
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

  // A roster submission is one parent's accept/decline response. `accepted`
  // gates the detail: a decline records the player's name and the team whose
  // spot was turned down, while an accept carries the full player + parent
  // detail and creates a roster row. `team_id`
  // is nulled if the team is later deleted (the snapshot `team_name`/`division`
  // preserve the choice); `player_id` links to the roster row an accept created.
  await db`
    CREATE TABLE IF NOT EXISTS roster_submissions (
      id                  SERIAL        PRIMARY KEY,
      company_id          INTEGER       NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      accepted            BOOLEAN       NOT NULL,
      team_id             INTEGER       REFERENCES teams(id) ON DELETE SET NULL,
      team_name           VARCHAR(120),
      division            VARCHAR(32),
      player_id           INTEGER       REFERENCES players(id) ON DELETE SET NULL,
      player_name         VARCHAR(160)  NOT NULL,
      email               VARCHAR(160),
      returning_jersey    VARCHAR(24),
      grad_year           SMALLINT,
      date_of_birth       DATE,
      parent_name         VARCHAR(160),
      parent_phone        VARCHAR(40),
      secondary_phone     VARCHAR(40),
      height              VARCHAR(24),
      weight              SMALLINT,
      bats                VARCHAR(8),
      throws              VARCHAR(8),
      primary_position    VARCHAR(48),
      secondary_position  VARCHAR(48),
      high_school         VARCHAR(160),
      jersey_option_1     VARCHAR(24),
      jersey_option_2     VARCHAR(24),
      jersey_option_3     VARCHAR(24),
      played_fce_2026     BOOLEAN,
      hat_size            VARCHAR(24),
      created_at          TIMESTAMPTZ   NOT NULL DEFAULT now()
    )
  `;

  await db`CREATE INDEX IF NOT EXISTS idx_roster_submissions_company_id ON roster_submissions (company_id)`;

  // Rename played_fce_2025 -> played_fce_2026 on databases created before the
  // question's year label rolled forward. Postgres has no RENAME COLUMN IF
  // EXISTS, so guard it: only rename when the old column is present and the new
  // one isn't. Idempotent — a no-op once the table already has the 2026 column.
  await db`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'roster_submissions'
                   AND column_name = 'played_fce_2025')
        AND NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'roster_submissions'
                   AND column_name = 'played_fce_2026')
      THEN
        ALTER TABLE roster_submissions RENAME COLUMN played_fce_2025 TO played_fce_2026;
      END IF;
    END $$;
  `;

  // High school and parent name were added to the form after the table shipped;
  // backfill them on existing databases. Each mirrors the players column an
  // accept copies it onto (players.high_school / players.parent_name).
  await db`ALTER TABLE roster_submissions ADD COLUMN IF NOT EXISTS high_school VARCHAR(160)`;
  await db`ALTER TABLE roster_submissions ADD COLUMN IF NOT EXISTS parent_name VARCHAR(160)`;

  // The jersey-assignment automation. Reconciles the whole team's
  // submission-linked jersey numbers in one atomic function under a per-team
  // advisory lock (races can't hand out duplicates). Idempotent via CREATE OR
  // REPLACE; mirrored in db/schema.sql and db/setup.mjs. Depends on
  // players.jersey_locked (added by ensureTeamsSchema, which runs first).
  await db`
    CREATE OR REPLACE FUNCTION fce_recompute_team_jerseys(p_team_id integer)
    RETURNS void
    LANGUAGE plpgsql
    AS $fn$
    DECLARE
      taken  text[];
      r      record;
      chosen text;
      opt    text;
    BEGIN
      -- Serialize concurrent recomputes for the same team (namespaced advisory
      -- lock held to end of this statement's implicit transaction).
      PERFORM pg_advisory_xact_lock(hashtext('fce_jersey_recompute'), p_team_id);

      -- Seed taken numbers with fixed holders: manual players (no submission)
      -- and coach-locked players.
      SELECT coalesce(array_agg(btrim(p.jersey_number)), ARRAY[]::text[])
        INTO taken
      FROM players p
      WHERE p.team_id = p_team_id
        AND p.jersey_number IS NOT NULL
        AND btrim(p.jersey_number) <> ''
        AND (p.jersey_locked
             OR NOT EXISTS (SELECT 1 FROM roster_submissions rs WHERE rs.player_id = p.id));

      -- Returners first (priority), oldest submission first, unlocked only.
      FOR r IN
        SELECT rs.player_id, btrim(rs.returning_jersey) AS num
        FROM roster_submissions rs
        JOIN players p ON p.id = rs.player_id
        WHERE rs.team_id = p_team_id AND rs.accepted AND rs.player_id IS NOT NULL
          AND rs.played_fce_2026 IS TRUE
          AND p.jersey_locked = false
        ORDER BY rs.created_at, rs.id
      LOOP
        IF r.num IS NOT NULL AND r.num <> '' AND NOT (r.num = ANY (taken)) THEN
          UPDATE players SET jersey_number = r.num, updated_at = now() WHERE id = r.player_id;
          taken := array_append(taken, r.num);
        ELSE
          UPDATE players SET jersey_number = NULL, updated_at = now() WHERE id = r.player_id;
        END IF;
      END LOOP;

      -- New players next, first-come, first free option; unlocked only.
      FOR r IN
        SELECT rs.player_id,
               btrim(rs.jersey_option_1) AS o1,
               btrim(rs.jersey_option_2) AS o2,
               btrim(rs.jersey_option_3) AS o3
        FROM roster_submissions rs
        JOIN players p ON p.id = rs.player_id
        WHERE rs.team_id = p_team_id AND rs.accepted AND rs.player_id IS NOT NULL
          AND rs.played_fce_2026 IS DISTINCT FROM TRUE
          AND p.jersey_locked = false
        ORDER BY rs.created_at, rs.id
      LOOP
        chosen := NULL;
        FOREACH opt IN ARRAY ARRAY[r.o1, r.o2, r.o3] LOOP
          IF opt IS NOT NULL AND opt <> '' AND NOT (opt = ANY (taken)) THEN
            chosen := opt;
            taken := array_append(taken, opt);
            EXIT;
          END IF;
        END LOOP;
        UPDATE players SET jersey_number = chosen, updated_at = now() WHERE id = r.player_id;
      END LOOP;
    END;
    $fn$
  `;
}

// Resolve the company id parents submit against. The public form has no
// session, so the organization is the tenant the request resolved to (its
// hostname, its `?c=` link, or the tenant cookie) — see lib/tenant. Mirrors the
// payroll form.
//
// Each organization has its own database, so `sql()` is already pointed at
// theirs and this is really "the company row in *this* database"; matching on
// the tenant's code keeps it exact rather than assuming the database holds
// exactly one company. Returns null when that row doesn't exist yet (before
// db:setup has been run against the database).
export async function getRosterCompanyId(): Promise<number | null> {
  const tenant = await currentTenant();
  const rows = await sql()`
    SELECT id FROM companies WHERE code = ${tenant.code} LIMIT 1
  `;
  return rows.length > 0 ? (rows[0].id as number) : null;
}

// The teams offered in the public form's dropdown: only those in each
// division's active season, so a parent signing up now is always placed on a
// current-season team (never last year's roster). Ordered by division then name
// so the form can group them under division headings. The caller ensures the
// teams schema (which creates `seasons`) before this runs.
export async function listRosterTeamOptions(
  companyId: number,
): Promise<RosterTeamOption[]> {
  const rows = await sql()`
    SELECT t.id, t.name, t.division, t.sport
    FROM teams t
    JOIN seasons s ON s.id = t.season_id
    WHERE t.company_id = ${companyId}
      AND s.is_active
    ORDER BY t.division, t.name
  `;
  return rows as RosterTeamOption[];
}

// Look up a team by id, scoped to the company, and (by default) to its active
// season. Used to validate the chosen team on a submission and snapshot its
// name/division. Null if the team doesn't exist, belongs to another company, or
// — when `requireActiveSeason` — is no longer in its division's active season.
//
// An ACCEPT requires the active season. The public form only offers
// active-season teams (listRosterTeamOptions), so we validate the same way: a
// stale/cached form that posts an archived-season team after a rollover is
// rejected (the action shows "no longer available") rather than silently adding
// the player to last year's roster, where the current-season views would never
// show them.
//
// A DECLINE passes requireActiveSeason: false. It creates no roster row, so
// there's nothing to misfile — and recording the team the offer was actually
// for beats rejecting the response, or pushing the parent to re-pick a
// current-season team, just because the season rolled over while they were
// deciding.
export async function getOwnedTeam(
  companyId: number,
  teamId: number,
  { requireActiveSeason = true }: { requireActiveSeason?: boolean } = {},
): Promise<{ id: number; name: string; division: string } | null> {
  const rows = requireActiveSeason
    ? await sql()`
        SELECT t.id, t.name, t.division
        FROM teams t
        JOIN seasons s ON s.id = t.season_id
        WHERE t.id = ${teamId} AND t.company_id = ${companyId} AND s.is_active
        LIMIT 1
      `
    : await sql()`
        SELECT t.id, t.name, t.division
        FROM teams t
        WHERE t.id = ${teamId} AND t.company_id = ${companyId}
        LIMIT 1
      `;
  if (rows.length === 0) return null;
  const t = rows[0] as { id: number; name: string; division: string };
  return { id: Number(t.id), name: String(t.name), division: String(t.division) };
}

// Persist a submission. The caller validates the input first (and, for an
// accept, has already confirmed the team is owned by the company).
//
// On ACCEPT the player is pushed onto the roster in the same statement: a
// data-modifying CTE inserts the `players` row and then inserts the submission
// carrying that new player's id, so the roster row and its submission link are
// created atomically. The mapped roster columns are the ones the Teams tab
// knows — name, grad year, DOB, height, weight, positions, hat size, and the
// parent's name/phone/email. The player's jersey number is left blank here and
// then assigned by recomputeTeamJerseys() (below), which reconciles the team's
// numbers from every accepted submission. The remaining tryout-only fields
// (secondary phone, bats/throws, played-in-2026, and the jersey preferences the
// recompute reads) live on the submission record. `is_paying` defaults to true.
export async function createRosterSubmission(
  input: RosterSubmissionInput,
): Promise<void> {
  if (input.accepted && input.teamId != null) {
    await sql()`
      WITH new_player AS (
        INSERT INTO players (
          team_id, player_name, grad_year, date_of_birth, height, weight,
          primary_position, secondary_position, high_school, hat_size,
          parent_name, parent_phone, parent_email
        ) VALUES (
          ${input.teamId},
          ${input.playerName},
          ${input.gradYear},
          ${input.dateOfBirth},
          ${input.height},
          ${input.weight},
          ${input.primaryPosition},
          ${input.secondaryPosition},
          ${input.highSchool},
          ${input.hatSize},
          ${input.parentName},
          ${input.parentPhone},
          ${input.email}
        )
        RETURNING id
      )
      INSERT INTO roster_submissions (
        company_id, accepted, team_id, team_name, division, player_id,
        player_name, email, returning_jersey, grad_year, date_of_birth,
        parent_name, parent_phone, secondary_phone, height, weight, bats, throws,
        primary_position, secondary_position, high_school, jersey_option_1, jersey_option_2,
        jersey_option_3, played_fce_2026, hat_size
      )
      SELECT
        ${input.companyId}, true, ${input.teamId}, ${input.teamName}, ${input.division}, new_player.id,
        ${input.playerName}, ${input.email}, ${input.returningJersey}, ${input.gradYear}, ${input.dateOfBirth},
        ${input.parentName}, ${input.parentPhone}, ${input.secondaryPhone}, ${input.height}, ${input.weight}, ${input.bats}, ${input.throws},
        ${input.primaryPosition}, ${input.secondaryPosition}, ${input.highSchool}, ${input.jerseyOption1}, ${input.jerseyOption2},
        ${input.jerseyOption3}, ${input.playedFce2026}, ${input.hatSize}
      FROM new_player
    `;

    // With the new player + submission committed, reconcile jersey numbers for
    // the whole team: returners keep their number (priority), then new players
    // take their first free option (first-come). Runs as a follow-up statement
    // because the assignment depends on every accepted submission for the team.
    // Best-effort: the submission + roster row are already saved, so a reconcile
    // hiccup must not fail the whole submission (which would push the parent to
    // resubmit into a duplicate). The next accept for the team reconciles again.
    try {
      await recomputeTeamJerseys(input.teamId);
    } catch (err) {
      console.error("recomputeTeamJerseys failed for team", input.teamId, err);
    }
    return;
  }

  // Decline (or an accept with no team, which the action rejects): record the
  // submission, including the team/division whose spot was declined. No roster
  // row is created.
  await sql()`
    INSERT INTO roster_submissions (
      company_id, accepted, team_id, team_name, division, player_id,
      player_name, email, returning_jersey, grad_year, date_of_birth,
      parent_name, parent_phone, secondary_phone, height, weight, bats, throws,
      primary_position, secondary_position, high_school, jersey_option_1, jersey_option_2,
      jersey_option_3, played_fce_2026, hat_size
    ) VALUES (
      ${input.companyId}, ${input.accepted}, ${input.teamId}, ${input.teamName}, ${input.division}, NULL,
      ${input.playerName}, ${input.email}, ${input.returningJersey}, ${input.gradYear}, ${input.dateOfBirth},
      ${input.parentName}, ${input.parentPhone}, ${input.secondaryPhone}, ${input.height}, ${input.weight}, ${input.bats}, ${input.throws},
      ${input.primaryPosition}, ${input.secondaryPosition}, ${input.highSchool}, ${input.jerseyOption1}, ${input.jerseyOption2},
      ${input.jerseyOption3}, ${input.playedFce2026}, ${input.hatSize}
    )
  `;
}

// Reassign the team's submission-linked jersey numbers from ALL accepted
// submissions, atomically and race-free. The entire read-compute-write runs
// inside one Postgres function (fce_recompute_team_jerseys, created in
// provision()) guarded by a per-team advisory lock, so two accepts for the same
// team can no longer interleave a stale read and hand out a duplicate number.
//
// Rules (implemented in the SQL function):
//   • Numbers held by MANUAL players (added on the Teams tab, no submission) and
//     by coach-LOCKED players (players.jersey_locked = true, set when a coach
//     saves a jersey on the Teams tab) are fixed — seeded as taken, never
//     reassigned by the automation.
//   • Returning players (played_fce_2026 = true) get their returning number with
//     priority; a tie or an already-taken number falls through to unassigned.
//   • New players are first-come (oldest submission first), taking the first of
//     their three options that's still free; none free -> unassigned (null),
//     which the coach can set by hand on the Teams tab (and it stays, being
//     locked).
async function recomputeTeamJerseys(teamId: number): Promise<void> {
  await sql()`SELECT fce_recompute_team_jerseys(${teamId})`;
}

// All submissions for a company, newest first. Joins to `teams` so the admin
// tab can link an accepted player to the (still-existing) team's roster.
export async function listRosterSubmissions(
  companyId: number,
): Promise<RosterSubmissionRow[]> {
  const rows = await sql()`
    SELECT
      rs.id,
      rs.accepted,
      rs.team_id,
      rs.team_name,
      rs.division,
      t.name       AS current_team_name,
      t.division   AS current_division,
      s.year       AS current_season_year,
      rs.player_id,
      rs.player_name,
      rs.email,
      rs.returning_jersey,
      rs.grad_year,
      rs.date_of_birth::text AS date_of_birth,
      rs.parent_name,
      rs.parent_phone,
      rs.secondary_phone,
      rs.height,
      rs.weight,
      rs.bats,
      rs.throws,
      rs.primary_position,
      rs.secondary_position,
      rs.high_school,
      rs.jersey_option_1,
      rs.jersey_option_2,
      rs.jersey_option_3,
      rs.played_fce_2026,
      rs.hat_size,
      -- created_at is TIMESTAMPTZ (stored UTC); convert to Eastern so the admin
      -- tab shows the correct calendar day. Without this an evening submission
      -- would slice to the next day's UTC date. The zone is fixed rather than
      -- per-tenant because Flood City Elite is in Johnstown, PA — onboarding an
      -- organization outside Eastern is what would make it worth varying.
      (rs.created_at AT TIME ZONE 'America/New_York')::text AS created_at
    FROM roster_submissions rs
    LEFT JOIN teams t ON t.id = rs.team_id AND t.company_id = rs.company_id
    LEFT JOIN seasons s ON s.id = t.season_id
    WHERE rs.company_id = ${companyId}
    ORDER BY rs.created_at DESC, rs.id DESC
  `;
  return rows as RosterSubmissionRow[];
}

// Delete a submission once it's been processed, scoped to the company so one
// company can't clear another's rows. Removing a submission leaves any roster
// row it created in place (the player has already joined the team).
export async function deleteRosterSubmission(
  companyId: number,
  id: number,
): Promise<void> {
  await sql()`
    DELETE FROM roster_submissions
    WHERE id = ${id} AND company_id = ${companyId}
  `;
}
