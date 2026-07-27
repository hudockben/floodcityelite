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

    // Parse the player + parent detail fields.
    const email = text(formData, "email", 160);
    const gradYear = nonNegInt(formData, "grad_year");
    const dateOfBirth = isoDate(formData, "date_of_birth");
    const parentPhone = text(formData, "parent_phone", 40);
    const secondaryPhone = text(formData, "secondary_phone", 40);
    const height = text(formData, "height", 24);
    const weight = nonNegInt(formData, "weight");
    const bats = oneOf(formData, "bats", ["L", "R", "S"]);
    const throwsWith = oneOf(formData, "throws", ["L", "R"]);
    const primaryPosition = text(formData, "primary_position", 48);
    const secondaryPosition = text(formData, "secondary_position", 48);
    const hatSize = text(formData, "hat_size", 24);
    const played = yesNo(formData, "played_fce_2026");
    const returningJersey = text(formData, "returning_jersey", 24);
    const jerseyOption1 = text(formData, "jersey_option_1", 24);
    const jerseyOption2 = text(formData, "jersey_option_2", 24);
    const jerseyOption3 = text(formData, "jersey_option_3", 24);

    // On accept every field is required (the form enforces it client-side; this
    // backs it up server-side). Report the first gap so the parent knows what to
    // fix. A decline only needs the player name, already checked above.
    if (accepted) {
      const firstMissing = !email
        ? "an email address"
        : gradYear == null
          ? "the grad year"
          : !dateOfBirth
            ? "the date of birth"
            : !parentPhone
              ? "the parent's cell phone number"
              : !secondaryPhone
                ? "a secondary cell phone number"
                : !height
                  ? "the height"
                  : weight == null
                    ? "the weight"
                    : !bats
                      ? "which side the player bats from"
                      : !throwsWith
                        ? "which hand the player throws with"
                        : !primaryPosition
                          ? "the primary position"
                          : !secondaryPosition
                            ? "the secondary position"
                            : !hatSize
                              ? "the hat size"
                              : played == null
                                ? "whether the player played in 2026"
                                : null;
      if (firstMissing) {
        return { error: `Please fill in ${firstMissing} before accepting.` };
      }
      // Jersey inputs depend on the returning-player answer.
      if (played === true && !returningJersey) {
        return { error: "Enter the returning player's jersey number." };
      }
      if (played === false && (!jerseyOption1 || !jerseyOption2 || !jerseyOption3)) {
        return {
          error: "Enter all three jersey number options in order of preference.",
        };
      }
    }

    // Keep the stored jersey data consistent with the returning-player answer —
    // returners give one number, new players give three ranked options — so the
    // record matches the form and the jersey automation reads clean inputs.
    const isReturner = played === true;

    await createRosterSubmission({
      companyId,
      accepted,
      teamId,
      teamName,
      division,
      playerName,
      email,
      returningJersey: isReturner ? returningJersey : null,
      gradYear,
      dateOfBirth,
      parentPhone,
      secondaryPhone,
      height,
      weight,
      bats,
      throws: throwsWith,
      primaryPosition,
      secondaryPosition,
      jerseyOption1: isReturner ? null : jerseyOption1,
      jerseyOption2: isReturner ? null : jerseyOption2,
      jerseyOption3: isReturner ? null : jerseyOption3,
      playedFce2026: played,
      hatSize,
    });
  } catch (err) {
    console.error("submitRosterAcceptance error:", err);
    return { error: "Could not submit your response. Please try again." };
  }

  return { ok: true, accepted };
}
