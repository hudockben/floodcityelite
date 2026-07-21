"use server";

import { revalidatePath } from "next/cache";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/session";
import { isDivisionSlug, isSport } from "./divisions";

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

  // Confirm the team exists and belongs to this company before inserting.
  const owned = await sql()`
    SELECT id FROM teams WHERE id = ${teamId} AND company_id = ${session.companyId}
  `;
  if (owned.length === 0) return { error: "That team no longer exists." };

  try {
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
