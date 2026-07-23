"use server";

import { revalidatePath } from "next/cache";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/session";
import { divisionLabel, isDivisionSlug, isSport } from "./divisions";
import {
  mapRows,
  nameKey,
  parseRosterFile,
  RosterImportError,
  teamKey,
  type ParsedPlayer,
} from "./roster-import";
import { ensureTeamsSchema } from "./schema";

export type FormState = { ok?: boolean; error?: string };

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

  if (!name) return { error: "Enter a team name." };
  if (!isDivisionSlug(division)) return { error: "Pick a valid division." };
  if (!isSport(sport)) return { error: "Pick a sport (baseball or softball)." };

  try {
    await ensureTeamsSchema();
    await sql()`
      INSERT INTO teams (company_id, name, division, sport)
      VALUES (${session.companyId}, ${name}, ${division}, ${sport})
    `;
  } catch (err) {
    console.error("createTeam error:", err);
    return { error: "Could not create the team. Please try again." };
  }

  revalidatePath("/teams");
  return { ok: true };
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
        primary_position, secondary_position, high_school,
        parent_phone, parent_email, parent_name, closest_facility
      ) VALUES (
        ${teamId},
        ${playerName},
        ${nonNegInt(formData, "grad_year")},
        ${isoDate(formData, "date_of_birth")},
        ${text(formData, "height")},
        ${nonNegInt(formData, "weight")},
        ${text(formData, "primary_position")},
        ${text(formData, "secondary_position")},
        ${text(formData, "high_school")},
        ${text(formData, "parent_phone")},
        ${text(formData, "parent_email")},
        ${text(formData, "parent_name")},
        ${text(formData, "closest_facility")}
      )
    `;
  } catch (err) {
    console.error("addPlayer error:", err);
    return { error: "Could not add the player. Please try again." };
  }

  revalidatePath("/teams");
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

  try {
    await ensureTeamsSchema();

    // Scope the update to a player whose team belongs to this company.
    const updated = await sql()`
      UPDATE players SET
        player_name        = ${playerName},
        grad_year          = ${nonNegInt(formData, "grad_year")},
        date_of_birth      = ${isoDate(formData, "date_of_birth")},
        height             = ${text(formData, "height")},
        weight             = ${nonNegInt(formData, "weight")},
        primary_position   = ${text(formData, "primary_position")},
        secondary_position = ${text(formData, "secondary_position")},
        high_school        = ${text(formData, "high_school")},
        parent_phone       = ${text(formData, "parent_phone")},
        parent_email       = ${text(formData, "parent_email")},
        parent_name        = ${text(formData, "parent_name")},
        closest_facility   = ${text(formData, "closest_facility")},
        updated_at         = now()
      WHERE id = ${playerId}
        AND team_id IN (SELECT id FROM teams WHERE company_id = ${session.companyId})
      RETURNING id
    `;
    if (updated.length === 0) return { error: "That player no longer exists." };
  } catch (err) {
    console.error("updatePlayer error:", err);
    return { error: "Could not save changes. Please try again." };
  }

  revalidatePath("/teams");
  return { ok: true };
}

// --- delete a player -------------------------------------------------------

export async function deletePlayerAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session) return;

  const playerId = Number.parseInt(String(formData.get("playerId") ?? ""), 10);
  if (!Number.isFinite(playerId)) return;

  // Scope the delete to a player whose team belongs to this company.
  await sql()`
    DELETE FROM players
    WHERE id = ${playerId}
      AND team_id IN (SELECT id FROM teams WHERE company_id = ${session.companyId})
  `;

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
      // Match each row's team name against all of this company's teams.
      const companyTeams = await sql()`
        SELECT id, name, division FROM teams WHERE company_id = ${session.companyId}
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
          SELECT team_id, player_name FROM players
          WHERE team_id IN (SELECT id FROM teams WHERE company_id = ${session.companyId})
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
              parent_phone, parent_email, parent_name, closest_facility
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
              ${a.player.closest_facility}
            )
          `,
        ),
      );
    }

    revalidatePath("/teams");

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

  revalidatePath("/teams");
}
