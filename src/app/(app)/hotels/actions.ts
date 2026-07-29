"use server";

import { revalidatePath } from "next/cache";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/session";
import { isDivisionSlug } from "../teams/divisions";
import { HOTEL_FIELDS, KEEP_EVENT } from "./hotels";
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

// The optional division dropdown: a teams division slug, or null.
function division(formData: FormData): string | null {
  const value = String(formData.get("division") ?? "").trim();
  return value !== "" && isDivisionSlug(value) ? value : null;
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
        ${division(formData)},
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

    // Scope the update to a hotel owned by this company. When the editor sent
    // `keep`, the tournament columns are written back to themselves so a stay
    // whose tournament was deleted holds on to the name it was booked under.
    const updated = await sql()`
      UPDATE hotels SET
        name               = ${name},
        address            = ${field(formData, "address")},
        city               = ${field(formData, "city")},
        state              = ${field(formData, "state")},
        division           = ${division(formData)},
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
