"use server";

import { revalidatePath } from "next/cache";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/session";
import { parseSheetFile, SheetImportError } from "@/lib/sheet-import";
import {
  MAX_ADDED_NAMES,
  MAX_DUPLICATE_NAMES,
  MAX_IMPORT_ROWS,
  MAX_UPLOAD_BYTES,
  type BulkImportState,
} from "../bulk-import";
import { isSport } from "../teams/divisions";
import { COACH_FIELDS } from "./coaches";
import {
  coachDisplayName,
  coachKey,
  mapCoachRows,
  type ParsedCoach,
} from "./coach-import";
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

// --- bulk-upload contacts from a CSV / Excel file --------------------------

/**
 * Import a spreadsheet of college contacts.
 *
 * Each row needs a school; everything else fills in from whatever columns the
 * file has (see COACH_ALIASES). A row can name its own `sport` to land on the
 * other list — a single file can fill both — and without that column rows go to
 * the list the upload was started from.
 *
 * Contacts already on the list are skipped rather than duplicated, so an
 * updated file can be re-uploaded safely. Nothing is overwritten: this only
 * adds, and editing an existing contact stays a job for the row editor.
 */
export async function bulkUploadCoachesAction(
  _prev: BulkImportState,
  formData: FormData,
): Promise<BulkImportState> {
  const session = await getSession();
  if (!session) return { error: "Your session has expired. Please sign in again." };

  const defaultSportRaw = String(formData.get("sport") ?? "");
  if (!isSport(defaultSportRaw)) {
    return { error: "Pick a sport (baseball or softball)." };
  }
  const defaultSport = defaultSportRaw;

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a CSV or Excel file to upload." };
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return { error: "That file is too large. Please upload a file under 5 MB." };
  }

  // 1) Read the file into rows of strings.
  let rows: string[][];
  try {
    rows = await parseSheetFile(file.name, await file.arrayBuffer());
  } catch (err) {
    if (err instanceof SheetImportError) return { error: err.message };
    console.error("bulkUploadCoaches parse error:", err);
    return {
      error:
        "Couldn't read that file. Make sure it's a valid CSV or Excel (.xlsx) file.",
    };
  }

  // 2) Match its columns onto the contact fields.
  const mapped = mapCoachRows(rows, defaultSport);
  if (!mapped.hasSchoolColumn) {
    return {
      error:
        'Couldn’t find a school column. Include a "school" (or "school_name") column naming each college, then try again.',
    };
  }
  if (mapped.totalDataRows === 0) {
    return { error: "That file has a header row but no contact rows." };
  }

  try {
    await ensureCoachesSchema();

    // 3) Skip anything already on the list, and repeats within the file itself.
    const existing = await sql()`
      SELECT sport, school_name, coach_name FROM college_coaches
      WHERE company_id = ${session.companyId}
    `;
    const seen = new Set<string>();
    for (const row of existing) {
      const r = row as {
        sport: string;
        school_name: string;
        coach_name: string | null;
      };
      seen.add(coachKey(String(r.sport), String(r.school_name), r.coach_name));
    }

    const toInsert: ParsedCoach[] = [];
    const addedNames: string[] = [];
    const duplicateNames: string[] = [];
    let duplicates = 0;

    for (const coach of mapped.coaches) {
      const key = coachKey(coach.sport, coach.school_name, coach.coach_name);
      if (seen.has(key)) {
        duplicates++;
        if (duplicateNames.length < MAX_DUPLICATE_NAMES) {
          duplicateNames.push(coachDisplayName(coach));
        }
        continue;
      }
      seen.add(key);
      toInsert.push(coach);
      if (addedNames.length < MAX_ADDED_NAMES) {
        addedNames.push(coachDisplayName(coach));
      }
    }

    if (toInsert.length > MAX_IMPORT_ROWS) {
      return {
        error: `This file has ${toInsert.length} new contacts, over the ${MAX_IMPORT_ROWS}-per-upload limit. Please split it into smaller files.`,
      };
    }

    // 4) Insert them in one transaction, so a failure part-way leaves the list
    //    as it was rather than half-imported.
    if (toInsert.length > 0) {
      await sql().transaction((txn) =>
        toInsert.map(
          (c) => txn`
            INSERT INTO college_coaches (
              company_id, sport, school_name, coach_name, coach_title,
              division_level, conference, cell_phone, email, website, city,
              state, notes
            ) VALUES (
              ${session.companyId},
              ${c.sport},
              ${c.school_name},
              ${c.coach_name},
              ${c.coach_title},
              ${c.division_level},
              ${c.conference},
              ${c.cell_phone},
              ${c.email},
              ${c.website},
              ${c.city},
              ${c.state},
              ${c.notes}
            )
          `,
        ),
      );
    }

    revalidatePath("/contact-info");

    return {
      ok: true,
      result: {
        fileName: file.name,
        added: toInsert.length,
        duplicates,
        missingRequired: mapped.noSchoolRows,
        totalRows: mapped.totalDataRows,
        addedNames,
        duplicateNames,
        ignoredColumns: mapped.unmatchedHeaders,
        warnings: mapped.warnings,
      },
    };
  } catch (err) {
    console.error("bulkUploadCoaches error:", err);
    return { error: "Could not import those contacts. Please try again." };
  }
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
