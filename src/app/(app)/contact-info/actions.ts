"use server";

import { revalidatePath } from "next/cache";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/session";
import { isSport } from "../teams/divisions";
import { COACH_FIELDS } from "./coaches";
import { ensureCoachesSchema } from "./schema";

export type FormState = { ok?: boolean; error?: string };

// --- form-value helpers ----------------------------------------------------

// One COACH_FIELDS value off the form: trimmed, capped at the column's width,
// and null when blank so clearing an input clears the column.
function field(formData: FormData, key: string): string | null {
  const value = String(formData.get(key) ?? "").trim();
  if (value === "") return null;
  const max = COACH_FIELDS.find((f) => f.key === key)?.max ?? 160;
  return value.slice(0, max);
}

// --- add a college coach contact -------------------------------------------

export async function addCoachAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await getSession();
  if (!session) return { error: "Your session has expired. Please sign in again." };

  const sport = String(formData.get("sport") ?? "");
  const schoolName = field(formData, "school_name");

  if (!isSport(sport)) return { error: "Pick a sport (baseball or softball)." };
  if (!schoolName) return { error: "Enter the school's name." };

  try {
    // Create the table on first use so the tab works even if the database
    // predates this feature. Idempotent and memoized.
    await ensureCoachesSchema();

    await sql()`
      INSERT INTO college_coaches (
        company_id, sport, school_name, coach_name, coach_title, division_level,
        conference, cell_phone, email, website, city, state, notes
      ) VALUES (
        ${session.companyId},
        ${sport},
        ${schoolName},
        ${field(formData, "coach_name")},
        ${field(formData, "coach_title")},
        ${field(formData, "division_level")},
        ${field(formData, "conference")},
        ${field(formData, "cell_phone")},
        ${field(formData, "email")},
        ${field(formData, "website")},
        ${field(formData, "city")},
        ${field(formData, "state")},
        ${field(formData, "notes")}
      )
    `;
  } catch (err) {
    console.error("addCoach error:", err);
    return { error: "Could not add the contact. Please try again." };
  }

  revalidatePath("/contact-info");
  return { ok: true };
}

// --- update a contact ------------------------------------------------------

export async function updateCoachAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await getSession();
  if (!session) return { error: "Your session has expired. Please sign in again." };

  const coachId = Number.parseInt(String(formData.get("coachId") ?? ""), 10);
  // The editor can move a misfiled contact to the other sport's list.
  const sport = String(formData.get("sport") ?? "");
  const schoolName = field(formData, "school_name");

  if (!Number.isFinite(coachId)) return { error: "Missing contact." };
  if (!isSport(sport)) return { error: "Pick a sport (baseball or softball)." };
  if (!schoolName) return { error: "Enter the school's name." };

  try {
    await ensureCoachesSchema();

    // Scope the update to a contact owned by this company.
    const updated = await sql()`
      UPDATE college_coaches SET
        sport          = ${sport},
        school_name    = ${schoolName},
        coach_name     = ${field(formData, "coach_name")},
        coach_title    = ${field(formData, "coach_title")},
        division_level = ${field(formData, "division_level")},
        conference     = ${field(formData, "conference")},
        cell_phone     = ${field(formData, "cell_phone")},
        email          = ${field(formData, "email")},
        website        = ${field(formData, "website")},
        city           = ${field(formData, "city")},
        state          = ${field(formData, "state")},
        notes          = ${field(formData, "notes")},
        updated_at     = now()
      WHERE id = ${coachId} AND company_id = ${session.companyId}
      RETURNING id
    `;
    if (updated.length === 0) return { error: "That contact no longer exists." };
  } catch (err) {
    console.error("updateCoach error:", err);
    return { error: "Could not save changes. Please try again." };
  }

  revalidatePath("/contact-info");
  return { ok: true };
}

// --- delete a contact ------------------------------------------------------

export async function deleteCoachAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session) return;

  const coachId = Number.parseInt(String(formData.get("coachId") ?? ""), 10);
  if (!Number.isFinite(coachId)) return;

  await sql()`
    DELETE FROM college_coaches
    WHERE id = ${coachId} AND company_id = ${session.companyId}
  `;

  revalidatePath("/contact-info");
}
