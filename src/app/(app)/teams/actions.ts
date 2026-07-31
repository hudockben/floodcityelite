"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/session";
import {
  divisionLabel,
  isDivisionSlug,
  isSport,
  parseRosterStatus,
  TEAM_NAME_MAX,
} from "./divisions";
import {
  mapRows,
  nameKey,
  parseRosterFile,
  RosterImportError,
  teamKey,
  type ParsedPlayer,
} from "./roster-import";
import { ensureTeamsSchema } from "./schema";
import {
  ensureRosterSubmissionsSchema,
  recomputeTeamJerseys,
} from "@/lib/roster-submissions";

export type FormState = { ok?: boolean; error?: string };

// --- jersey reconcile -------------------------------------------------------

// Re-run the acceptance form's jersey assignment for a team.
//
// An acceptance isn't the only thing that changes the answer: removing a player
// or clearing a number by hand frees a number that someone's submission asked
// for, and the automation deliberately leaves a player blank when the number
// they wanted is taken. Without this, that player stayed blank until the next
// parent happened to accept a spot on the team — a returner could sit numberless
// for weeks with their old number sitting free.
//
// Best-effort on purpose: whatever the coach asked for is already saved, so a
// reconcile hiccup must not surface as a failed edit. The schema helper is
// memoized and also creates the SQL function itself, so this works on a database
// that predates the automation.
async function reconcileJerseys(teamId: number): Promise<void> {
  try {
    await ensureRosterSubmissionsSchema();
    await recomputeTeamJerseys(teamId);
  } catch (err) {
    console.error("reconcileJerseys failed for team", teamId, err);
  }
}

// --- form-value helpers ----------------------------------------------------

function text(formData: FormData, key: string): string | null {
  const value = String(formData.get(key) ?? "").trim();
  return value === "" ? null : value;
}

function nonNegInt(formData: FormData, key: string): number | null {
  const raw = String(formData.get(key) ?? "").trim();
  if (raw === "") return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// date_of_birth comes from an <input type="date"> as "YYYY-MM-DD" (or empty).
function isoDate(formData: FormData, key: string): string | null {
  const raw = String(formData.get(key) ?? "").trim();
  if (raw === "") return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

// The roster's New/Returning select: "returning"/"new" set the flag by hand,
// blank hands the row back to the acceptance form's answer. Deliberately kept
// off roster_submissions — that row records what the parent actually said, and
// the jersey automation reads it to decide who keeps a returning number.
function rosterStatus(formData: FormData): boolean | null {
  return parseRosterStatus(String(formData.get("roster_status") ?? "").trim());
}

// A checkbox is present in the submitted form only when it's checked, so a
// missing key means unchecked. Used for the roster's "Paying" flag.
function checkbox(formData: FormData, key: string): boolean {
  return formData.get(key) != null;
}

// --- create a team ---------------------------------------------------------

export async function createTeamAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await getSession();
  if (!session) return { error: "Your session has expired. Please sign in again." };

  const name = text(formData, "name");
  const division = String(formData.get("division") ?? "");
  const sport = String(formData.get("sport") ?? "");
  const seasonId = Number.parseInt(String(formData.get("seasonId") ?? ""), 10);

  if (!name) return { error: "Enter a team name." };
  if (!isDivisionSlug(division)) return { error: "Pick a valid division." };
  if (!isSport(sport)) return { error: "Pick a sport (baseball or softball)." };
  if (!Number.isFinite(seasonId)) return { error: "Pick a season first." };

  try {
    await ensureTeamsSchema();

    // The new team goes into the season being viewed. Confirm it belongs to
    // this company and division so a stale form can't drop a team into someone
    // else's (or the wrong division's) season.
    const okSeason = await sql()`
      SELECT 1 FROM seasons
      WHERE id = ${seasonId}
        AND company_id = ${session.companyId}
        AND division = ${division}
    `;
    if (okSeason.length === 0) return { error: "That season no longer exists." };

    await sql()`
      INSERT INTO teams (company_id, name, division, sport, season_id)
      VALUES (${session.companyId}, ${name}, ${division}, ${sport}, ${seasonId})
    `;
  } catch (err) {
    console.error("createTeam error:", err);
    return { error: "Could not create the team. Please try again." };
  }

  revalidatePath("/teams");
  return { ok: true };
}

// --- start a new season ----------------------------------------------------

// Creates (or re-activates) a division's run for a given year and makes it the
// active one, then redirects to it. A new season starts with no roster —
// "new season means new rosters" — unless "copy_teams" is set, which clones
// just the team names forward (empty rosters) from the season being viewed so
// the coach doesn't retype them. Void action + redirect, like deleteTeamAction.
export async function createSeasonAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session) redirect("/");

  const division = String(formData.get("division") ?? "");
  if (!isDivisionSlug(division)) redirect("/teams");

  // Clamp the year to a sane range; fall back to next calendar year on garbage.
  const rawYear = Number.parseInt(String(formData.get("year") ?? ""), 10);
  const year =
    Number.isFinite(rawYear) && rawYear >= 2000 && rawYear <= 2100
      ? rawYear
      : new Date().getFullYear() + 1;

  const copyTeams = formData.get("copy_teams") != null;
  const sourceSeasonId = Number.parseInt(
    String(formData.get("source_season_id") ?? ""),
    10,
  );

  let created = false;
  try {
    await ensureTeamsSchema();

    // Do the whole flip (+ optional copy) atomically in one transaction,
    // serialized per company by an advisory lock (same pattern as the jersey
    // automation). This keeps a concurrent or double-submitted "Start new
    // season" from leaving two active seasons in a division or duplicating the
    // copied-forward teams — neither of which the non-transactional, read-then-
    // write version prevented.
    await sql().transaction((txn) => {
      const stmts = [
        txn`SELECT pg_advisory_xact_lock(hashtext('fce_season_create'), ${session.companyId})`,
        // Exactly one active season per (company, division).
        txn`
          UPDATE seasons SET is_active = false
          WHERE company_id = ${session.companyId} AND division = ${division}
        `,
        txn`
          INSERT INTO seasons (company_id, division, year, is_active)
          VALUES (${session.companyId}, ${division}, ${year}, true)
          ON CONFLICT (company_id, division, year) DO UPDATE SET is_active = true
        `,
      ];

      // Optionally clone the team names forward with empty rosters. Resolve the
      // target season by its natural key (company, division, year) and skip any
      // name already present, so the copy is idempotent — re-submitting, or a
      // partially-applied prior run, never duplicates teams.
      if (copyTeams && Number.isFinite(sourceSeasonId)) {
        stmts.push(txn`
          INSERT INTO teams (company_id, name, division, sport, season_id)
          SELECT src.company_id, src.name, src.division, src.sport, tgt.id
          FROM teams src
          JOIN seasons tgt
            ON tgt.company_id = ${session.companyId}
           AND tgt.division = ${division}
           AND tgt.year = ${year}
          WHERE src.season_id = ${sourceSeasonId}
            AND src.company_id = ${session.companyId}
            AND NOT EXISTS (
              SELECT 1 FROM teams dst
              WHERE dst.season_id = tgt.id AND dst.name = src.name
            )
        `);
      }

      return stmts;
    });

    created = true;
  } catch (err) {
    console.error("createSeason error:", err);
  }

  revalidatePath("/teams");
  // On success land on the new season; on failure fall back to the division's
  // active season so we never navigate to a season that wasn't created.
  redirect(
    created
      ? `/teams?division=${division}&year=${year}`
      : `/teams?division=${division}`,
  );
}

// --- add a player to a team ------------------------------------------------

export async function addPlayerAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await getSession();
  if (!session) return { error: "Your session has expired. Please sign in again." };

  const teamId = Number.parseInt(String(formData.get("teamId") ?? ""), 10);
  const playerName = text(formData, "player_name");

  if (!Number.isFinite(teamId)) return { error: "Choose a team for this player." };
  if (!playerName) return { error: "Enter the player's name." };

  try {
    await ensureTeamsSchema();

    // Confirm the team exists and belongs to this company before inserting.
    const owned = await sql()`
      SELECT id FROM teams WHERE id = ${teamId} AND company_id = ${session.companyId}
    `;
    if (owned.length === 0) return { error: "That team no longer exists." };

    await sql()`
      INSERT INTO players (
        team_id, player_name, grad_year, date_of_birth, height, weight,
        primary_position, secondary_position, jersey_number, hat_size,
        high_school, parent_phone, parent_email, parent_name, closest_facility,
        is_paying, is_returning
      ) VALUES (
        ${teamId},
        ${playerName},
        ${nonNegInt(formData, "grad_year")},
        ${isoDate(formData, "date_of_birth")},
        ${text(formData, "height")},
        ${nonNegInt(formData, "weight")},
        ${text(formData, "primary_position")},
        ${text(formData, "secondary_position")},
        ${text(formData, "jersey_number")},
        ${text(formData, "hat_size")},
        ${text(formData, "high_school")},
        ${text(formData, "parent_phone")},
        ${text(formData, "parent_email")},
        ${text(formData, "parent_name")},
        ${text(formData, "closest_facility")},
        ${checkbox(formData, "is_paying")},
        ${rosterStatus(formData)}
      )
    `;
  } catch (err) {
    console.error("addPlayer error:", err);
    return { error: "Could not add the player. Please try again." };
  }

  // The roster's paying-player count feeds the Budgets tab, so refresh it too.
  revalidatePath("/teams");
  revalidatePath("/budgets");
  return { ok: true };
}

// --- update a player's info -------------------------------------------------

export async function updatePlayerAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await getSession();
  if (!session) return { error: "Your session has expired. Please sign in again." };

  const playerId = Number.parseInt(String(formData.get("playerId") ?? ""), 10);
  const playerName = text(formData, "player_name");

  if (!Number.isFinite(playerId)) return { error: "Missing player." };
  if (!playerName) return { error: "Enter the player's name." };

  // A coach TYPING a jersey number here pins it: `jersey_locked` guards it from
  // the acceptance-form automation, which won't overwrite a locked number on a
  // later accept. Clearing the field unlocks it, handing the slot back to the
  // automation.
  //
  // "Typing" is the operative word, and the reason the lock is set by the CASE
  // below rather than from `jersey != null`. This form is prefilled with the
  // player's current number, so every save posts one back — including the saves
  // that only meant to fix a height or a phone number. Locking on those turned
  // an automation-assigned number into a coach-pinned one behind the coach's
  // back, and a pinned number is seeded as taken BEFORE the returning-player
  // pass: the next returner who wore it lost their own number to an edit nobody
  // made. So only a number the coach actually changed flips the lock; an
  // untouched one leaves it exactly as it was.
  const jersey = text(formData, "jersey_number");

  // Set only when this save actually changed the number, which is both when the
  // lock flips and when the team is worth reconciling (see below).
  let jerseyChangedOnTeam: number | null = null;
  try {
    await ensureTeamsSchema();

    // Scope the update to a player whose team belongs to this company. The
    // `before` CTE snapshots the row first — under the same snapshot as the
    // UPDATE, so it holds the pre-edit values — which is what lets the jersey
    // lock and the reconcile below key off "did this save change the number?"
    // rather than "did this save post a number?".
    const updated = await sql()`
      WITH before AS (
        SELECT id, jersey_number
        FROM players
        WHERE id = ${playerId}
          AND team_id IN (SELECT id FROM teams WHERE company_id = ${session.companyId})
        FOR UPDATE
      )
      UPDATE players p SET
        player_name        = ${playerName},
        grad_year          = ${nonNegInt(formData, "grad_year")},
        date_of_birth      = ${isoDate(formData, "date_of_birth")},
        height             = ${text(formData, "height")},
        weight             = ${nonNegInt(formData, "weight")},
        primary_position   = ${text(formData, "primary_position")},
        secondary_position = ${text(formData, "secondary_position")},
        jersey_locked      = CASE
                               WHEN ${jersey}::text IS DISTINCT FROM b.jersey_number
                                 THEN ${jersey}::text IS NOT NULL
                               ELSE p.jersey_locked
                             END,
        jersey_number      = ${jersey},
        hat_size           = ${text(formData, "hat_size")},
        high_school        = ${text(formData, "high_school")},
        parent_phone       = ${text(formData, "parent_phone")},
        parent_email       = ${text(formData, "parent_email")},
        parent_name        = ${text(formData, "parent_name")},
        closest_facility   = ${text(formData, "closest_facility")},
        is_returning       = ${rosterStatus(formData)},
        updated_at         = now()
      FROM before b
      WHERE p.id = b.id
      RETURNING
        p.id,
        p.team_id,
        (${jersey}::text IS DISTINCT FROM b.jersey_number) AS jersey_changed
    `;
    if (updated.length === 0) return { error: "That player no longer exists." };
    const row = updated[0] as { team_id: number; jersey_changed: boolean };
    if (row.jersey_changed) jerseyChangedOnTeam = Number(row.team_id);
  } catch (err) {
    console.error("updatePlayer error:", err);
    return { error: "Could not save changes. Please try again." };
  }

  // Clearing a number — or moving a player onto a different one — hands the old
  // one back, so reconcile the team: whoever asked for it on their acceptance
  // form can now be given it. The number this save set is locked, so the
  // reconcile can't walk over the edit that was just made. Skipped entirely when
  // the number didn't change, so saving an unrelated field (a height, a phone
  // number) never reshuffles anyone.
  if (jerseyChangedOnTeam != null) await reconcileJerseys(jerseyChangedOnTeam);

  // Note: the paying flag isn't edited here (the inline roster toggle owns it),
  // so this edit can't change the Budgets tab's paying-player count.
  revalidatePath("/teams");
  return { ok: true };
}

// --- toggle a player's paying status (inline roster checkbox) --------------

// The roster's "Paying" checkbox posts here on every change. The desired state
// arrives as the checkbox's presence: submitted (checked) → paying; omitted
// (unchecked) → not paying. Void action (no return) — the row reflects the new
// state optimistically while the page and the linked Budgets count revalidate.
export async function togglePlayerPayingAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session) return;

  const playerId = Number.parseInt(String(formData.get("playerId") ?? ""), 10);
  if (!Number.isFinite(playerId)) return;

  const isPaying = checkbox(formData, "is_paying");

  // Scope the update to a player whose team belongs to this company.
  await sql()`
    UPDATE players SET is_paying = ${isPaying}, updated_at = now()
    WHERE id = ${playerId}
      AND team_id IN (SELECT id FROM teams WHERE company_id = ${session.companyId})
  `;

  revalidatePath("/teams");
  revalidatePath("/budgets");
}

// --- delete a player -------------------------------------------------------

export async function deletePlayerAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session) return;

  const playerId = Number.parseInt(String(formData.get("playerId") ?? ""), 10);
  if (!Number.isFinite(playerId)) return;

  // Scope the delete to a player whose team belongs to this company.
  const removed = await sql()`
    DELETE FROM players
    WHERE id = ${playerId}
      AND team_id IN (SELECT id FROM teams WHERE company_id = ${session.companyId})
    RETURNING team_id
  `;

  // The removed player's number is free now, so reconcile the team: a player
  // the automation had left blank because they'd asked for it gets it. This
  // matters most for a duplicate submission — remove the extra roster row and
  // the real one is handed the number the duplicate was holding.
  if (removed.length > 0) {
    await reconcileJerseys(Number((removed[0] as { team_id: number }).team_id));
  }

  // Removing a player changes the roster's paying-player count on the Budgets tab.
  revalidatePath("/teams");
  revalidatePath("/budgets");
}

// --- re-run a team's jersey assignment -------------------------------------

// The roster's "Assign numbers" button. Runs the same reconcile an acceptance
// does, on demand, so a coach can fill the gaps the automation left without
// waiting for the next parent to accept a spot — after freeing up a number, or
// on a roster whose numbers were assigned before the automation shipped.
//
// Void action (no return): the roster revalidates and the new numbers appear.
// Locked and manual numbers are fixed, so this can never take a number a coach
// set by hand.
export async function reassignTeamJerseysAction(
  formData: FormData,
): Promise<void> {
  const session = await getSession();
  if (!session) return;

  const teamId = Number.parseInt(String(formData.get("teamId") ?? ""), 10);
  if (!Number.isFinite(teamId)) return;

  // Confirm the team belongs to this company before touching its roster.
  const owned = await sql()`
    SELECT id FROM teams WHERE id = ${teamId} AND company_id = ${session.companyId}
  `;
  if (owned.length === 0) return;

  await reconcileJerseys(teamId);

  revalidatePath("/teams");
}

// --- bulk-upload a roster from a CSV / Excel file --------------------------

// Per-destination-team tally shown in the import summary.
export type BulkTeamResult = {
  teamName: string;
  division: string; // display label
  added: number;
  duplicates: number;
};

// A team name from the file that couldn't be routed to one of your teams.
export type BulkUnmatchedTeam = { name: string; rows: number };

export type BulkUploadResult = {
  mode: "auto" | "team";
  fileName: string;
  added: number;
  duplicates: number;
  noName: number;
  unmatchedTeamRows: number;
  blankTeamRows: number;
  totalRows: number;
  perTeam: BulkTeamResult[];
  unmatchedTeams: BulkUnmatchedTeam[];
  addedNames: string[];
  duplicateNames: string[];
  ignoredColumns: string[];
  warnings: string[];
};

export type BulkUploadState = {
  ok?: boolean;
  error?: string;
  result?: BulkUploadResult;
};

const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB
const MAX_IMPORT_ROWS = 500; // new players per upload
const MAX_ACTION_WARNINGS = 25;

type Assignment = { player: ParsedPlayer; teamId: number };

export async function bulkUploadRosterAction(
  _prev: BulkUploadState,
  formData: FormData,
): Promise<BulkUploadState> {
  const session = await getSession();
  if (!session) return { error: "Your session has expired. Please sign in again." };

  // teamId is either "auto"/"" (route each row by its team column) or a team id.
  const teamSel = String(formData.get("teamId") ?? "").trim();
  const autoMode = teamSel === "" || teamSel === "auto";
  let explicitTeamId = 0;
  if (!autoMode) {
    explicitTeamId = Number.parseInt(teamSel, 10);
    if (!Number.isFinite(explicitTeamId)) {
      return { error: "Choose a team to import into, or pick auto-assign." };
    }
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a CSV or Excel file to upload." };
  }
  if (file.size > MAX_FILE_BYTES) {
    return { error: "That file is too large. Please upload a file under 5 MB." };
  }

  // 1) Parse the file into rows of strings.
  let rows: string[][];
  try {
    const buffer = await file.arrayBuffer();
    rows = await parseRosterFile(file.name, buffer);
  } catch (err) {
    if (err instanceof RosterImportError) return { error: err.message };
    console.error("bulkUpload parse error:", err);
    return {
      error: "Couldn't read that file. Make sure it's a valid CSV or Excel (.xlsx) file.",
    };
  }

  // 2) Map columns onto our roster fields.
  const mapped = mapRows(rows);
  if (mapped.nameMode === "none") {
    return {
      error:
        'Couldn’t find a player-name column. Include "player_first" and "player_last" (or a single "player_name") column, then try again.',
    };
  }
  if (mapped.totalDataRows === 0) {
    return { error: "That file has a header row but no player rows." };
  }
  if (autoMode && !mapped.hasTeamColumn) {
    return {
      error:
        'To auto-assign, include a "team" column in the file so each row can be matched to a team by name — or pick a specific team above.',
    };
  }

  try {
    await ensureTeamsSchema();

    const warnings = [...mapped.warnings];
    const addWarn = (m: string) => {
      if (warnings.length < MAX_ACTION_WARNINGS) warnings.push(m);
    };

    // 3) Resolve each row to a destination team.
    const teamById = new Map<number, { name: string; division: string }>();
    const unmatched = new Map<string, number>(); // display name -> row count
    let unmatchedTeamRows = 0;
    let blankTeamRows = 0;
    const bumpUnmatched = (display: string) => {
      unmatchedTeamRows++;
      unmatched.set(display, (unmatched.get(display) ?? 0) + 1);
    };

    let resolveTeamId: (rowTeam: string | null) => number | null;

    if (autoMode) {
      // Match each row's team name against this company's ACTIVE-season teams
      // across divisions ("the current rosters"). Scoping by is_active — not by
      // a shared calendar year — is what keeps an import off an archived season:
      // divisions roll over independently, so the same year can be active in one
      // division and archived in another.
      const companyTeams = await sql()`
        SELECT t.id, t.name, t.division
        FROM teams t
        JOIN seasons s ON s.id = t.season_id
        WHERE t.company_id = ${session.companyId} AND s.is_active
      `;
      if (companyTeams.length === 0) {
        return {
          error:
            "You don't have any teams yet. Create a team first, then auto-assign can match rows to it by name.",
        };
      }
      const byKey = new Map<string, number[]>();
      for (const row of companyTeams) {
        const t = row as { id: number; name: string; division: string };
        const id = Number(t.id);
        teamById.set(id, { name: String(t.name), division: String(t.division) });
        const k = teamKey(String(t.name));
        const ids = byKey.get(k);
        if (ids) ids.push(id);
        else byKey.set(k, [id]);
      }
      const ambiguousWarned = new Set<string>();
      resolveTeamId = (rowTeam) => {
        const raw = (rowTeam ?? "").trim();
        if (!raw) {
          blankTeamRows++;
          return null;
        }
        const ids = byKey.get(teamKey(raw));
        if (!ids || ids.length === 0) {
          bumpUnmatched(raw);
          return null;
        }
        if (ids.length > 1) {
          const k = teamKey(raw);
          if (!ambiguousWarned.has(k)) {
            ambiguousWarned.add(k);
            addWarn(
              `"${raw}" matches more than one of your teams — those players were skipped. Rename the teams so their names are unique.`,
            );
          }
          bumpUnmatched(raw);
          return null;
        }
        return ids[0];
      };
    } else {
      // A specific team was chosen: every row goes there.
      const owned = await sql()`
        SELECT id, name, division FROM teams
        WHERE id = ${explicitTeamId} AND company_id = ${session.companyId}
      `;
      if (owned.length === 0) return { error: "That team no longer exists." };
      const t = owned[0] as { id: number; name: string; division: string };
      const id = Number(t.id);
      teamById.set(id, { name: String(t.name), division: String(t.division) });
      resolveTeamId = () => id;
    }

    const assignments: Assignment[] = [];
    mapped.players.forEach((p, i) => {
      const tid = resolveTeamId(autoMode ? mapped.teamNames[i] : null);
      if (tid != null) assignments.push({ player: p, teamId: tid });
    });

    // 4) Dedupe against each destination team's existing roster, and against
    //    repeats within the uploaded file (per team — the same name on two
    //    different teams is not a duplicate).
    const existing = autoMode
      ? await sql()`
          SELECT p.team_id, p.player_name FROM players p
          JOIN teams t ON t.id = p.team_id
          JOIN seasons s ON s.id = t.season_id
          WHERE t.company_id = ${session.companyId} AND s.is_active
        `
      : await sql()`
          SELECT team_id, player_name FROM players WHERE team_id = ${explicitTeamId}
        `;
    const existingByTeam = new Map<number, Set<string>>();
    for (const row of existing) {
      const r = row as { team_id: number; player_name: string };
      const tid = Number(r.team_id);
      const key = nameKey(String(r.player_name));
      const set = existingByTeam.get(tid);
      if (set) set.add(key);
      else existingByTeam.set(tid, new Set([key]));
    }

    const seen = new Set<string>(); // `${teamId} ${nameKey}`
    const toInsert: Assignment[] = [];
    const addedNames: string[] = [];
    const duplicateNames: string[] = [];
    let duplicates = 0;
    const perTeamTally = new Map<number, { added: number; duplicates: number }>();
    const tallyOf = (tid: number) => {
      let t = perTeamTally.get(tid);
      if (!t) {
        t = { added: 0, duplicates: 0 };
        perTeamTally.set(tid, t);
      }
      return t;
    };

    for (const a of assignments) {
      const key = nameKey(a.player.player_name);
      const composite = `${a.teamId} ${key}`;
      const tally = tallyOf(a.teamId);
      const onRoster = existingByTeam.get(a.teamId)?.has(key) ?? false;
      if (onRoster || seen.has(composite)) {
        duplicates++;
        tally.duplicates++;
        if (duplicateNames.length < 50) duplicateNames.push(a.player.player_name);
        continue;
      }
      seen.add(composite);
      toInsert.push(a);
      tally.added++;
      if (addedNames.length < 100) addedNames.push(a.player.player_name);
    }

    if (toInsert.length > MAX_IMPORT_ROWS) {
      return {
        error: `This file has ${toInsert.length} new players, over the ${MAX_IMPORT_ROWS}-per-upload limit. Please split it into smaller files.`,
      };
    }

    // 5) Insert the new players (each with its resolved team) in one transaction.
    if (toInsert.length > 0) {
      await sql().transaction((txn) =>
        toInsert.map(
          (a) => txn`
            INSERT INTO players (
              team_id, player_name, grad_year, date_of_birth, height, weight,
              primary_position, secondary_position, high_school,
              parent_phone, parent_email, parent_name, closest_facility, is_paying
            ) VALUES (
              ${a.teamId},
              ${a.player.player_name},
              ${a.player.grad_year},
              ${a.player.date_of_birth},
              ${a.player.height},
              ${a.player.weight},
              ${a.player.primary_position},
              ${a.player.secondary_position},
              ${a.player.high_school},
              ${a.player.parent_phone},
              ${a.player.parent_email},
              ${a.player.parent_name},
              ${a.player.closest_facility},
              ${a.player.is_paying}
            )
          `,
        ),
      );
    }

    revalidatePath("/teams");
    revalidatePath("/budgets");

    const perTeam: BulkTeamResult[] = [...perTeamTally.entries()]
      .map(([tid, t]) => {
        const info = teamById.get(tid);
        return {
          teamName: info?.name ?? `Team ${tid}`,
          division: divisionLabel(info?.division ?? ""),
          added: t.added,
          duplicates: t.duplicates,
        };
      })
      .sort((a, b) => a.teamName.localeCompare(b.teamName));

    const unmatchedTeams: BulkUnmatchedTeam[] = [...unmatched.entries()]
      .map(([name, count]) => ({ name, rows: count }))
      .sort((a, b) => b.rows - a.rows);

    return {
      ok: true,
      result: {
        mode: autoMode ? "auto" : "team",
        fileName: file.name,
        added: toInsert.length,
        duplicates,
        noName: mapped.noNameRows,
        unmatchedTeamRows,
        blankTeamRows,
        totalRows: mapped.totalDataRows,
        perTeam,
        unmatchedTeams,
        addedNames,
        duplicateNames,
        ignoredColumns: mapped.unmatchedHeaders,
        warnings,
      },
    };
  } catch (err) {
    console.error("bulkUpload insert error:", err);
    return { error: "Could not import the roster. Please try again." };
  }
}

// --- rename a team ---------------------------------------------------------

// Fixing a team's name in place, so a typo doesn't cost the coach the roster:
// the team keeps its id, and everything hanging off it (players, schedule,
// budget, past submissions) follows the new name automatically.
export async function renameTeamAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await getSession();
  if (!session) return { error: "Your session has expired. Please sign in again." };

  const teamId = Number.parseInt(String(formData.get("teamId") ?? ""), 10);
  const name = text(formData, "name");

  if (!Number.isFinite(teamId)) return { error: "Missing team." };
  if (!name) return { error: "Enter a team name." };
  // teams.name is VARCHAR(120); catch it here so an over-long name reads as a
  // form error instead of a database failure.
  if (name.length > TEAM_NAME_MAX) {
    return { error: `Team names are limited to ${TEAM_NAME_MAX} characters.` };
  }

  try {
    await ensureTeamsSchema();

    // Two teams sharing a name inside one season make the bulk import's team
    // column ambiguous (those rows get skipped) and block the copy-forward a
    // new season does, so refuse the collision — matched case- and
    // whitespace-insensitively, the same way the importer matches names.
    const siblings = await sql()`
      SELECT id, name FROM teams
      WHERE company_id = ${session.companyId}
        AND season_id = (
          SELECT season_id FROM teams
          WHERE id = ${teamId} AND company_id = ${session.companyId}
        )
    `;
    const key = teamKey(name);
    const clash = siblings.some((row) => {
      const t = row as { id: number; name: string };
      return Number(t.id) !== teamId && teamKey(String(t.name)) === key;
    });
    if (clash) {
      return { error: "Another team in this season already has that name." };
    }

    // Scope the update to this company so a stale form can't rename someone
    // else's team.
    const updated = await sql()`
      UPDATE teams SET name = ${name}, updated_at = now()
      WHERE id = ${teamId} AND company_id = ${session.companyId}
      RETURNING id
    `;
    if (updated.length === 0) return { error: "That team no longer exists." };
  } catch (err) {
    console.error("renameTeam error:", err);
    return { error: "Could not rename the team. Please try again." };
  }

  // The name is shown on the Schedules and Budgets tabs too.
  revalidatePath("/teams");
  revalidatePath("/schedules");
  revalidatePath("/budgets");
  return { ok: true };
}

// --- delete a team (and its roster) ----------------------------------------

export async function deleteTeamAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session) return;

  const teamId = Number.parseInt(String(formData.get("teamId") ?? ""), 10);
  if (!Number.isFinite(teamId)) return;

  // ON DELETE CASCADE removes the team's players too.
  await sql()`
    DELETE FROM teams WHERE id = ${teamId} AND company_id = ${session.companyId}
  `;

  // The team (and its budget row) drop off the Budgets tab as well.
  revalidatePath("/teams");
  revalidatePath("/budgets");
}
