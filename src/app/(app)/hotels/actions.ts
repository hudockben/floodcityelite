"use server";

import { revalidatePath } from "next/cache";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/session";
import { matchKey, parseSheetFile, SheetImportError } from "@/lib/sheet-import";
import {
  MAX_ADDED_NAMES,
  MAX_DUPLICATE_NAMES,
  MAX_IMPORT_ROWS,
  MAX_UPLOAD_BYTES,
  type BulkImportState,
  type UnmatchedValue,
} from "../bulk-import";
import { isDivisionSlugFormat } from "../teams/divisions";
import { listDivisions } from "../teams/division-store";
import { HOTEL_FIELDS, KEEP_DIVISION, KEEP_EVENT } from "./hotels";
import {
  hotelDisplayName,
  hotelKey,
  mapHotelRows,
  type ParsedHotel,
} from "./hotel-import";
import { ensureHotelsSchema } from "./schema";

export type FormState = { ok?: boolean; error?: string };

// --- form-value helpers ----------------------------------------------------

// One HOTEL_FIELDS value off the form: trimmed, capped at the column's width,
// and null when blank so clearing an input clears the column.
function field(formData: FormData, key: string): string | null {
  const value = String(formData.get(key) ?? "").trim();
  if (value === "") return null;
  const max = HOTEL_FIELDS.find((f) => f.key === key)?.max ?? 160;
  return value.slice(0, max);
}

// The nightly rate: strips "$" and thousands separators, keeps two decimals,
// and rejects negatives. Returned as a fixed-2 string so Postgres stores it as
// NUMERIC(10,2) exactly, or null when blank. Mirrors the Fundraiser Tracker's
// money() helper, including the NUMERIC(10,2) ceiling.
function money(raw: unknown): string | null {
  const s = String(raw ?? "").trim().replace(/[$,]/g, "");
  if (s === "") return null;
  const n = Number.parseFloat(s);
  if (!Number.isFinite(n) || n < 0 || n > 99_999_999.99) return null;
  return n.toFixed(2);
}

// The optional division dropdown: one of this company's division slugs, null,
// or `keep`. Divisions are company rows now, so the slug is checked against the
// list rather than against a hardcoded set — a stale form or a hand-rolled POST
// naming a division that isn't there leaves the column blank instead of
// stamping the hotel with a division nobody runs.
//
// `keep` is the editor saying "this hotel's division was removed from the Teams
// tab; leave the column alone" — see KEEP_DIVISION. Only the update honours it;
// a brand-new hotel has no earlier value to hold on to.
async function division(
  companyId: number,
  formData: FormData,
): Promise<{ keep: boolean; slug: string | null }> {
  const value = String(formData.get("division") ?? "").trim();
  if (value === KEEP_DIVISION) return { keep: true, slug: null };
  if (value === "" || !isDivisionSlugFormat(value)) return { keep: false, slug: null };
  const divisions = await listDivisions(companyId);
  return {
    keep: false,
    slug: divisions.some((d) => d.slug === value) ? value : null,
  };
}

/**
 * Resolve the chosen tournament to (event_id, event_name), or to `keep` — the
 * editor's "still tied to the tournament it names" option for a stay whose
 * tournament has been deleted from the Schedules tab (see KEEP_EVENT).
 *
 * The name is read from the database rather than the form so a tampered or
 * stale submission can't label a stay with a tournament it isn't, and the
 * lookup is scoped through teams to this company so one company can't attach a
 * hotel to another's tournament. A blank choice — or an event that has since
 * been deleted — comes back as (null, null), which clears the tie.
 */
type ResolvedEvent = {
  keep: boolean;
  eventId: number | null;
  eventName: string | null;
};

const CLEARED: ResolvedEvent = { keep: false, eventId: null, eventName: null };

async function resolveEvent(
  formData: FormData,
  companyId: number,
): Promise<ResolvedEvent> {
  const raw = String(formData.get("eventId") ?? "").trim();
  if (raw === "") return CLEARED;
  if (raw === KEEP_EVENT) return { keep: true, eventId: null, eventName: null };

  const eventId = Number.parseInt(raw, 10);
  if (!Number.isFinite(eventId)) return CLEARED;

  const rows = await sql()`
    SELECT ev.event_name
    FROM schedule_events ev
    JOIN teams t ON t.id = ev.team_id
    WHERE ev.id = ${eventId} AND t.company_id = ${companyId}
  `;
  if (rows.length === 0) return CLEARED;

  return {
    keep: false,
    eventId,
    eventName: String(rows[0].event_name).slice(0, 200),
  };
}

// --- add a hotel -----------------------------------------------------------

export async function addHotelAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await getSession();
  if (!session) return { error: "Your session has expired. Please sign in again." };

  const name = field(formData, "name");
  if (!name) return { error: "Enter the hotel's name." };

  // The rate is optional, but if something was typed it must be a valid amount.
  const rawCost = String(formData.get("avg_cost_per_night") ?? "").trim();
  const cost = money(rawCost);
  if (rawCost !== "" && cost === null) {
    return { error: "Enter a valid average cost per night." };
  }

  try {
    // Create the table on first use so the tab works even if the database
    // predates this feature. Idempotent and memoized.
    await ensureHotelsSchema();

    // A brand-new hotel has no earlier tie to keep, so `keep` can't apply here
    // — resolveEvent's null/null covers it either way.
    const { eventId, eventName } = await resolveEvent(formData, session.companyId);

    await sql()`
      INSERT INTO hotels (
        company_id, name, address, city, state, division, event_id, event_name,
        avg_cost_per_night, phone, website, notes
      ) VALUES (
        ${session.companyId},
        ${name},
        ${field(formData, "address")},
        ${field(formData, "city")},
        ${field(formData, "state")},
        ${(await division(session.companyId, formData)).slug},
        ${eventId},
        ${eventName},
        ${cost},
        ${field(formData, "phone")},
        ${field(formData, "website")},
        ${field(formData, "notes")}
      )
    `;
  } catch (err) {
    console.error("addHotel error:", err);
    return { error: "Could not add the hotel. Please try again." };
  }

  revalidatePath("/hotels");
  return { ok: true };
}

// --- update a hotel --------------------------------------------------------

export async function updateHotelAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await getSession();
  if (!session) return { error: "Your session has expired. Please sign in again." };

  const hotelId = Number.parseInt(String(formData.get("hotelId") ?? ""), 10);
  const name = field(formData, "name");

  if (!Number.isFinite(hotelId)) return { error: "Missing hotel." };
  if (!name) return { error: "Enter the hotel's name." };

  const rawCost = String(formData.get("avg_cost_per_night") ?? "").trim();
  const cost = money(rawCost);
  if (rawCost !== "" && cost === null) {
    return { error: "Enter a valid average cost per night." };
  }

  try {
    await ensureHotelsSchema();

    const { keep, eventId, eventName } = await resolveEvent(
      formData,
      session.companyId,
    );

    // The division select sends `keep` when this hotel's division has been
    // removed from the Teams tab, for the same reason the tournament one does.
    const chosenDivision = await division(session.companyId, formData);

    // Scope the update to a hotel owned by this company. When the editor sent
    // `keep`, the tournament and division columns are written back to
    // themselves so a stay whose tournament or division was deleted holds on to
    // what it was booked under.
    const updated = await sql()`
      UPDATE hotels SET
        name               = ${name},
        address            = ${field(formData, "address")},
        city               = ${field(formData, "city")},
        state              = ${field(formData, "state")},
        division           = CASE WHEN ${chosenDivision.keep} THEN division
                               ELSE ${chosenDivision.slug} END,
        event_id           = CASE WHEN ${keep} THEN event_id ELSE ${eventId} END,
        event_name         = CASE WHEN ${keep} THEN event_name ELSE ${eventName} END,
        avg_cost_per_night = ${cost},
        phone              = ${field(formData, "phone")},
        website            = ${field(formData, "website")},
        notes              = ${field(formData, "notes")},
        updated_at         = now()
      WHERE id = ${hotelId} AND company_id = ${session.companyId}
      RETURNING id
    `;
    if (updated.length === 0) return { error: "That hotel no longer exists." };
  } catch (err) {
    console.error("updateHotel error:", err);
    return { error: "Could not save changes. Please try again." };
  }

  revalidatePath("/hotels");
  return { ok: true };
}

// --- bulk-upload the travel list from a CSV / Excel file -------------------

/**
 * Import a spreadsheet of hotels.
 *
 * Each row needs a hotel name; everything else fills in from whatever columns
 * the file has (see HOTEL_ALIASES). Two of those columns are looked up rather
 * than stored as typed: `division` is matched to a Teams division, and
 * `tournament` to one of this company's Schedules-tab events by name. A
 * tournament name that matches nothing still imports the hotel — it just comes
 * in untied, and the summary lists the names that didn't match so a typo is
 * obvious.
 *
 * Hotels already on the list are skipped rather than duplicated, so an updated
 * file can be re-uploaded safely. Nothing is overwritten: this only adds.
 */
export async function bulkUploadHotelsAction(
  _prev: BulkImportState,
  formData: FormData,
): Promise<BulkImportState> {
  const session = await getSession();
  if (!session) return { error: "Your session has expired. Please sign in again." };

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
    console.error("bulkUploadHotels parse error:", err);
    return {
      error:
        "Couldn't read that file. Make sure it's a valid CSV or Excel (.xlsx) file.",
    };
  }

  // 2) Match its columns onto the hotel fields. Division cells are matched
  //    against the company's own divisions, so a spreadsheet can name one added
  //    on the Teams tab. The lookup runs the teams DDL on a cold start and hits
  //    the database twice, so it needs the same "show the upload panel an error"
  //    treatment as every other failure here — outside a try it would reject the
  //    action instead, after the file had already been read successfully.
  let divisions;
  try {
    divisions = await listDivisions(session.companyId);
  } catch (err) {
    console.error("bulkUploadHotels divisions error:", err);
    return { error: "Couldn't read your divisions just now. Please try again." };
  }

  const mapped = mapHotelRows(rows, divisions);
  if (!mapped.hasNameColumn) {
    return {
      error:
        'Couldn’t find a hotel-name column. Include a "hotel" (or "hotel_name") column naming each property, then try again.',
    };
  }
  if (mapped.totalDataRows === 0) {
    return { error: "That file has a header row but no hotel rows." };
  }

  try {
    await ensureHotelsSchema();

    // 3) Resolve each row's tournament name against this company's events. The
    //    lookup is scoped through teams, so a file can't tie a stay to another
    //    company's tournament, and the stored name comes from the event rather
    //    than the file so it reads the same as one picked from the dropdown.
    const events = await sql()`
      SELECT ev.id, ev.event_name
      FROM schedule_events ev
      JOIN teams t ON t.id = ev.team_id
      WHERE t.company_id = ${session.companyId}
      ORDER BY ev.event_date DESC NULLS LAST, ev.id DESC
    `;
    const eventByName = new Map<string, { id: number; name: string }>();
    for (const row of events) {
      const e = row as { id: number; event_name: string };
      const key = matchKey(String(e.event_name));
      // Ordered newest-first above, so the first match for a repeated
      // tournament name is the most recent one — the weekend someone importing
      // a hotel list almost certainly means.
      if (!eventByName.has(key)) {
        eventByName.set(key, { id: Number(e.id), name: String(e.event_name) });
      }
    }

    const unmatchedEvents = new Map<string, number>();

    // 4) Skip anything already on the list, and repeats within the file itself.
    const existing = await sql()`
      SELECT name, city FROM hotels WHERE company_id = ${session.companyId}
    `;
    const seen = new Set<string>();
    for (const row of existing) {
      const h = row as { name: string; city: string | null };
      seen.add(hotelKey(String(h.name), h.city));
    }

    type Ready = { hotel: ParsedHotel; eventId: number | null; eventName: string | null };
    const toInsert: Ready[] = [];
    const addedNames: string[] = [];
    const duplicateNames: string[] = [];
    let duplicates = 0;

    for (const hotel of mapped.hotels) {
      const key = hotelKey(hotel.name, hotel.city);
      if (seen.has(key)) {
        duplicates++;
        if (duplicateNames.length < MAX_DUPLICATE_NAMES) {
          duplicateNames.push(hotelDisplayName(hotel));
        }
        continue;
      }
      seen.add(key);

      let eventId: number | null = null;
      let eventName: string | null = null;
      if (hotel.tournamentName) {
        const match = eventByName.get(matchKey(hotel.tournamentName));
        if (match) {
          eventId = match.id;
          eventName = match.name.slice(0, 200);
        } else {
          unmatchedEvents.set(
            hotel.tournamentName,
            (unmatchedEvents.get(hotel.tournamentName) ?? 0) + 1,
          );
        }
      }

      toInsert.push({ hotel, eventId, eventName });
      if (addedNames.length < MAX_ADDED_NAMES) {
        addedNames.push(hotelDisplayName(hotel));
      }
    }

    if (toInsert.length > MAX_IMPORT_ROWS) {
      return {
        error: `This file has ${toInsert.length} new hotels, over the ${MAX_IMPORT_ROWS}-per-upload limit. Please split it into smaller files.`,
      };
    }

    // 5) Insert them in one transaction, so a failure part-way leaves the list
    //    as it was rather than half-imported.
    if (toInsert.length > 0) {
      await sql().transaction((txn) =>
        toInsert.map(
          ({ hotel, eventId, eventName }) => txn`
            INSERT INTO hotels (
              company_id, name, address, city, state, division, event_id,
              event_name, avg_cost_per_night, phone, website, notes
            ) VALUES (
              ${session.companyId},
              ${hotel.name},
              ${hotel.address},
              ${hotel.city},
              ${hotel.state},
              ${hotel.division},
              ${eventId},
              ${eventName},
              ${hotel.avg_cost_per_night},
              ${hotel.phone},
              ${hotel.website},
              ${hotel.notes}
            )
          `,
        ),
      );
    }

    revalidatePath("/hotels");

    const unmatchedItems: UnmatchedValue[] = [...unmatchedEvents.entries()]
      .map(([name, count]) => ({ name, rows: count }))
      .sort((a, b) => b.rows - a.rows);

    return {
      ok: true,
      result: {
        fileName: file.name,
        added: toInsert.length,
        duplicates,
        missingRequired: mapped.noNameRows,
        totalRows: mapped.totalDataRows,
        addedNames,
        duplicateNames,
        ignoredColumns: mapped.unmatchedHeaders,
        warnings: mapped.warnings,
        unmatched:
          unmatchedItems.length > 0
            ? {
                label:
                  "These tournament names aren’t on the Schedules tab, so those hotels came in without a tournament:",
                note: "Add the tournament on the Schedules tab (or fix the spelling in the file), then tie the stay to it with Edit.",
                items: unmatchedItems,
              }
            : undefined,
      },
    };
  } catch (err) {
    console.error("bulkUploadHotels error:", err);
    return { error: "Could not import those hotels. Please try again." };
  }
}

// --- delete a hotel --------------------------------------------------------

export async function deleteHotelAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session) return;

  const hotelId = Number.parseInt(String(formData.get("hotelId") ?? ""), 10);
  if (!Number.isFinite(hotelId)) return;

  await sql()`
    DELETE FROM hotels
    WHERE id = ${hotelId} AND company_id = ${session.companyId}
  `;

  revalidatePath("/hotels");
}
