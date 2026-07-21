"use server";

import { revalidatePath } from "next/cache";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/session";
import { isEventStatus } from "./events";
import { ensureSchedulesSchema } from "./schema";

export type FormState = { ok?: boolean; error?: string };

// --- form-value helpers ----------------------------------------------------

function text(formData: FormData, key: string): string | null {
  const value = String(formData.get(key) ?? "").trim();
  return value === "" ? null : value;
}

// event_date comes from an <input type="date"> as "YYYY-MM-DD" (or empty).
function isoDate(formData: FormData, key: string): string | null {
  const raw = String(formData.get(key) ?? "").trim();
  if (raw === "") return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

// A money value: strips "$" and thousands separators, keeps two decimals, and
// rejects negatives. Returned as a fixed-2 string so Postgres stores it as
// NUMERIC(10,2) exactly.
function money(formData: FormData, key: string): string | null {
  const raw = String(formData.get(key) ?? "")
    .trim()
    .replace(/[$,]/g, "");
  if (raw === "") return null;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) && n >= 0 ? n.toFixed(2) : null;
}

// --- add an event/tournament to a team -------------------------------------

export async function addEventAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await getSession();
  if (!session) return { error: "Your session has expired. Please sign in again." };

  const teamId = Number.parseInt(String(formData.get("teamId") ?? ""), 10);
  const eventName = text(formData, "event_name");
  const statusRaw = String(formData.get("status") ?? "registered");
  const status = isEventStatus(statusRaw) ? statusRaw : "registered";

  if (!Number.isFinite(teamId)) return { error: "Choose a team for this event." };
  if (!eventName) return { error: "Enter the event name." };

  try {
    await ensureSchedulesSchema();

    // Confirm the team exists and belongs to this company before inserting.
    const owned = await sql()`
      SELECT id FROM teams WHERE id = ${teamId} AND company_id = ${session.companyId}
    `;
    if (owned.length === 0) return { error: "That team no longer exists." };

    await sql()`
      INSERT INTO schedule_events (
        team_id, event_host, event_date, event_name, location, cost, status
      ) VALUES (
        ${teamId},
        ${text(formData, "event_host")},
        ${isoDate(formData, "event_date")},
        ${eventName},
        ${text(formData, "location")},
        ${money(formData, "cost")},
        ${status}
      )
    `;
  } catch (err) {
    console.error("addEvent error:", err);
    return { error: "Could not add the event. Please try again." };
  }

  revalidatePath("/schedules");
  return { ok: true };
}

// --- update an event's info ------------------------------------------------

export async function updateEventAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await getSession();
  if (!session) return { error: "Your session has expired. Please sign in again." };

  const eventId = Number.parseInt(String(formData.get("eventId") ?? ""), 10);
  const eventName = text(formData, "event_name");
  const statusRaw = String(formData.get("status") ?? "registered");
  const status = isEventStatus(statusRaw) ? statusRaw : "registered";

  if (!Number.isFinite(eventId)) return { error: "Missing event." };
  if (!eventName) return { error: "Enter the event name." };

  try {
    await ensureSchedulesSchema();

    // Scope the update to an event whose team belongs to this company.
    const updated = await sql()`
      UPDATE schedule_events SET
        event_host = ${text(formData, "event_host")},
        event_date = ${isoDate(formData, "event_date")},
        event_name = ${eventName},
        location   = ${text(formData, "location")},
        cost       = ${money(formData, "cost")},
        status     = ${status},
        updated_at = now()
      WHERE id = ${eventId}
        AND team_id IN (SELECT id FROM teams WHERE company_id = ${session.companyId})
      RETURNING id
    `;
    if (updated.length === 0) return { error: "That event no longer exists." };
  } catch (err) {
    console.error("updateEvent error:", err);
    return { error: "Could not save changes. Please try again." };
  }

  revalidatePath("/schedules");
  return { ok: true };
}

// --- quick status change (inline dropdown) ---------------------------------

export async function updateStatusAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session) return;

  const eventId = Number.parseInt(String(formData.get("eventId") ?? ""), 10);
  const statusRaw = String(formData.get("status") ?? "");
  if (!Number.isFinite(eventId) || !isEventStatus(statusRaw)) return;

  // Scope the update to an event whose team belongs to this company.
  await sql()`
    UPDATE schedule_events SET status = ${statusRaw}, updated_at = now()
    WHERE id = ${eventId}
      AND team_id IN (SELECT id FROM teams WHERE company_id = ${session.companyId})
  `;

  revalidatePath("/schedules");
}

// --- delete an event -------------------------------------------------------

export async function deleteEventAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session) return;

  const eventId = Number.parseInt(String(formData.get("eventId") ?? ""), 10);
  if (!Number.isFinite(eventId)) return;

  // Scope the delete to an event whose team belongs to this company.
  await sql()`
    DELETE FROM schedule_events
    WHERE id = ${eventId}
      AND team_id IN (SELECT id FROM teams WHERE company_id = ${session.companyId})
  `;

  revalidatePath("/schedules");
}
