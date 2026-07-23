"use server";

import { revalidatePath } from "next/cache";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/session";
import { isDivisionSlug, isSport } from "./divisions";
import {
  mapRows,
  nameKey,
  parseRosterFile,
  RosterImportError,
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

export type BulkUploadResult = {
  teamName: string;
  fileName: string;
  added: number;
  duplicatesExisting: number;
  duplicatesInFile: number;
  noName: number;
  totalRows: number;
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

export async function bulkUploadRosterAction(
  _prev: BulkUploadState,
  formData: FormData,
): Promise<BulkUploadState> {
  const session = await getSession();
  if (!session) return { error: "Your session has expired. Please sign in again." };

  const teamId = Number.parseInt(String(formData.get("teamId") ?? ""), 10);
  if (!Number.isFinite(teamId)) return { error: "Choose a team to import into." };

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

  try {
    await ensureTeamsSchema();

    // Confirm the team belongs to this company before touching its roster.
    const owned = await sql()`
      SELECT id, name FROM teams
      WHERE id = ${teamId} AND company_id = ${session.companyId}
    `;
    if (owned.length === 0) return { error: "That team no longer exists." };
    const teamName = String(owned[0].name);

    // 3) Dedupe: skip anyone already on this team's roster, and any repeats
    //    within the uploaded file itself.
    const existing = await sql()`
      SELECT player_name FROM players WHERE team_id = ${teamId}
    `;
    const existingKeys = new Set(
      existing.map((r) => nameKey(String((r as { player_name: string }).player_name))),
    );

    const seen = new Set<string>();
    const toInsert: ParsedPlayer[] = [];
    const addedNames: string[] = [];
    const duplicateNames: string[] = [];
    let duplicatesExisting = 0;
    let duplicatesInFile = 0;

    for (const p of mapped.players) {
      const key = nameKey(p.player_name);
      if (existingKeys.has(key)) {
        duplicatesExisting++;
        if (duplicateNames.length < 50) duplicateNames.push(p.player_name);
        continue;
      }
      if (seen.has(key)) {
        duplicatesInFile++;
        if (duplicateNames.length < 50) duplicateNames.push(p.player_name);
        continue;
      }
      seen.add(key);
      toInsert.push(p);
      if (addedNames.length < 100) addedNames.push(p.player_name);
    }

    if (toInsert.length > MAX_IMPORT_ROWS) {
      return {
        error: `This file has ${toInsert.length} new players, over the ${MAX_IMPORT_ROWS}-per-upload limit. Please split it into smaller files.`,
      };
    }

    // 4) Insert the new players in a single transaction.
    if (toInsert.length > 0) {
      await sql().transaction((txn) =>
        toInsert.map(
          (p) => txn`
            INSERT INTO players (
              team_id, player_name, grad_year, date_of_birth, height, weight,
              primary_position, secondary_position, high_school,
              parent_phone, parent_email, parent_name, closest_facility
            ) VALUES (
              ${teamId},
              ${p.player_name},
              ${p.grad_year},
              ${p.date_of_birth},
              ${p.height},
              ${p.weight},
              ${p.primary_position},
              ${p.secondary_position},
              ${p.high_school},
              ${p.parent_phone},
              ${p.parent_email},
              ${p.parent_name},
              ${p.closest_facility}
            )
          `,
        ),
      );
    }

    revalidatePath("/teams");
    return {
      ok: true,
      result: {
        teamName,
        fileName: file.name,
        added: toInsert.length,
        duplicatesExisting,
        duplicatesInFile,
        noName: mapped.noNameRows,
        totalRows: mapped.totalDataRows,
        addedNames,
        duplicateNames,
        ignoredColumns: mapped.unmatchedHeaders,
        warnings: mapped.warnings,
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
