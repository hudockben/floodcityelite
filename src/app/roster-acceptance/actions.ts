"use server";

import {
  createRosterSubmission,
  ensureRosterSubmissionsSchema,
  getOwnedTeam,
  getRosterCompanyId,
} from "@/lib/roster-submissions";
import { ensureTeamsSchema } from "@/app/(app)/teams/schema";

// `accepted` tells the form which confirmation banner to show after a reset.
export type RosterFormState = {
  ok?: boolean;
  accepted?: boolean;
  error?: string;
};

// --- form-value helpers ----------------------------------------------------

// Trim a form value; return null when empty. Slices to the column's max length
// so an over-long value can't blow up the insert (Postgres 22001).
function text(formData: FormData, key: string, max: number): string | null {
  const value = String(formData.get(key) ?? "").trim();
  if (value === "") return null;
  return value.slice(0, max);
}

// A non-negative integer field (grad year, weight), or null when empty/invalid.
// grad_year and weight are SMALLINT columns (max 32767), so a value over that
// ceiling is treated as absent rather than allowed through to abort the whole
// insert with a 22003 overflow — the numeric analogue of text() slicing to the
// column's max length.
function nonNegInt(formData: FormData, key: string): number | null {
  const raw = String(formData.get(key) ?? "").trim();
  if (raw === "") return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 && n <= 32767 ? n : null;
}

// date_of_birth comes from an <input type="date"> as "YYYY-MM-DD" (or empty).
function isoDate(formData: FormData, key: string): string | null {
  const raw = String(formData.get(key) ?? "").trim();
  if (raw === "") return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

// Constrain a value to an allowed set (e.g. bats/throws "L"/"R"); null otherwise.
function oneOf(formData: FormData, key: string, allowed: string[]): string | null {
  const raw = String(formData.get(key) ?? "").trim().toUpperCase();
  return allowed.includes(raw) ? raw : null;
}

// A yes/no select → boolean, or null when left blank.
function yesNo(formData: FormData, key: string): boolean | null {
  const raw = String(formData.get(key) ?? "").trim().toLowerCase();
  if (raw === "yes") return true;
  if (raw === "no") return false;
  return null;
}

// Handle a public roster-acceptance submission. No session — anyone with the
// link (from the Roster Spot card on the sign-in screen) can respond. A decline
// records just the response; an accept also pushes the player onto the roster.
export async function submitRosterAcceptanceAction(
  _prev: RosterFormState,
  formData: FormData,
): Promise<RosterFormState> {
  const choice = String(formData.get("accepted") ?? "").trim().toLowerCase();
  if (choice !== "yes" && choice !== "no") {
    return { error: "Please choose whether you're accepting or declining the spot." };
  }
  const accepted = choice === "yes";

  const playerName = text(formData, "player_name", 160);
  if (!playerName) return { error: "Enter the player's name." };

  try {
    // roster_submissions has FKs to teams(id) and players(id), so those tables
    // must exist before its CREATE TABLE runs. Ensure them first (matching the
    // public page's ordering) so a cold serverless instance that never rendered
    // the form page can still provision the table.
    await ensureTeamsSchema();
    await ensureRosterSubmissionsSchema();

    const companyId = await getRosterCompanyId();
    if (companyId == null) {
      // The company row is missing (database hasn't been set up yet).
      return { error: "This form isn't set up yet. Please check back soon." };
    }

    // Resolve + validate the chosen team only when accepting.
    let teamId: number | null = null;
    let teamName: string | null = null;
    let division: string | null = null;

    if (accepted) {
      const rawTeam = String(formData.get("teamId") ?? "").trim();
      const parsed = Number.parseInt(rawTeam, 10);
      if (!Number.isFinite(parsed)) {
        return { error: "Choose the team you're accepting a spot on." };
      }
      const team = await getOwnedTeam(companyId, parsed);
      if (!team) {
        return {
          error: "That team is no longer available. Please refresh the page and try again.",
        };
      }
      teamId = team.id;
      teamName = team.name;
      division = team.division;
    }

    await createRosterSubmission({
      companyId,
      accepted,
      teamId,
      teamName,
      division,
      playerName,
      email: text(formData, "email", 160),
      returningJersey: text(formData, "returning_jersey", 24),
      gradYear: nonNegInt(formData, "grad_year"),
      dateOfBirth: isoDate(formData, "date_of_birth"),
      parentPhone: text(formData, "parent_phone", 40),
      secondaryPhone: text(formData, "secondary_phone", 40),
      height: text(formData, "height", 24),
      weight: nonNegInt(formData, "weight"),
      bats: oneOf(formData, "bats", ["L", "R", "S"]),
      throws: oneOf(formData, "throws", ["L", "R"]),
      primaryPosition: text(formData, "primary_position", 48),
      secondaryPosition: text(formData, "secondary_position", 48),
      jerseyOption1: text(formData, "jersey_option_1", 24),
      jerseyOption2: text(formData, "jersey_option_2", 24),
      jerseyOption3: text(formData, "jersey_option_3", 24),
      playedFce2025: yesNo(formData, "played_fce_2025"),
      hatSize: text(formData, "hat_size", 24),
    });
  } catch (err) {
    console.error("submitRosterAcceptance error:", err);
    return { error: "Could not submit your response. Please try again." };
  }

  return { ok: true, accepted };
}
