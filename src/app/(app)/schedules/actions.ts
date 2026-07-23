"use server";

import { revalidatePath } from "next/cache";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/session";
import { groupBaseline, isEventStatus, MAX_ROSTER_GROUPS } from "./events";
import { ensureSchedulesSchema } from "./schema";

export type FormState = { ok?: boolean; error?: string };

// An event's cost and status feed the Budgets tab's scheduled cost (and the
// Homeplate "budgets at risk" figures), so anything that adds, edits, deletes,
// or re-statuses an event must refresh those routes too — otherwise a refund
// wouldn't credit back on the budget until it happened to re-fetch.
function revalidateScheduleAndBudget(): void {
  revalidatePath("/schedules");
  revalidatePath("/budgets");
  revalidatePath("/homeplate");
}

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
        team_id, event_host, event_date, event_end_date, event_name, location, cost, status
      ) VALUES (
        ${teamId},
        ${text(formData, "event_host")},
        ${isoDate(formData, "event_date")},
        ${isoDate(formData, "event_end_date")},
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

  revalidateScheduleAndBudget();
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
        event_host     = ${text(formData, "event_host")},
        event_date     = ${isoDate(formData, "event_date")},
        event_end_date = ${isoDate(formData, "event_end_date")},
        event_name     = ${eventName},
        location       = ${text(formData, "location")},
        cost           = ${money(formData, "cost")},
        status         = ${status},
        updated_at     = now()
      WHERE id = ${eventId}
        AND team_id IN (SELECT id FROM teams WHERE company_id = ${session.companyId})
      RETURNING id
    `;
    if (updated.length === 0) return { error: "That event no longer exists." };
  } catch (err) {
    console.error("updateEvent error:", err);
    return { error: "Could not save changes. Please try again." };
  }

  revalidateScheduleAndBudget();
  return { ok: true };
}

// --- quick status change (inline dropdown) ---------------------------------
//
// Called directly with typed args (not as a <form action>) from the inline
// StatusSelect. Submitting through a form action would make React 19 reset the
// form after the action resolved, snapping the controlled <select> back to its
// first option ("Registered") and desyncing it from the saved value.

export async function updateStatusAction(input: {
  eventId: number;
  status: string;
}): Promise<void> {
  const session = await getSession();
  if (!session) return;

  const eventId = Number(input?.eventId);
  const statusRaw = String(input?.status ?? "");
  if (!Number.isFinite(eventId) || !isEventStatus(statusRaw)) return;

  // Scope the update to an event whose team belongs to this company.
  await sql()`
    UPDATE schedule_events SET status = ${statusRaw}, updated_at = now()
    WHERE id = ${eventId}
      AND team_id IN (SELECT id FROM teams WHERE company_id = ${session.companyId})
  `;

  revalidateScheduleAndBudget();
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

  revalidateScheduleAndBudget();
}

// --- groups / playing-time rotation ----------------------------------------
//
// Two layers decide who plays an event:
//   • event_groups — which standing roster groups travel to the event. This is
//     the baseline: a player attends when their roster_group is selected.
//   • event_attendance — per-player exceptions on top of that baseline. We only
//     store a row when the coach's choice for a player deviates from the group
//     baseline, so exceptions stay minimal and re-picking groups automatically
//     re-derives everyone who has no explicit exception. With no groups picked
//     the baseline is "everyone attends" — the original whole-roster default.
//
// These actions are called directly from the Groups panel (typed args, not
// FormData) so a single toggle or a bulk change is one RPC.

// Set one player's attendance for one event. Scoped so the event and the player
// both belong to the same team within the signed-in company.
export async function setAttendanceAction(input: {
  eventId: number;
  playerId: number;
  attending: boolean;
}): Promise<void> {
  const session = await getSession();
  if (!session) return;

  const eventId = Number(input?.eventId);
  const playerId = Number(input?.playerId);
  const attending = Boolean(input?.attending);
  if (!Number.isFinite(eventId) || !Number.isFinite(playerId)) return;

  await ensureSchedulesSchema();

  // Confirm the event and player share a team owned by this company before
  // writing — this rejects benching a player from a different team — and pull
  // the player's roster group in the same round-trip.
  const owned = await sql()`
    SELECT p.roster_group
    FROM schedule_events e
    JOIN teams t ON t.id = e.team_id
    JOIN players p ON p.team_id = e.team_id
    WHERE e.id = ${eventId}
      AND p.id = ${playerId}
      AND t.company_id = ${session.companyId}
  `;
  if (owned.length === 0) return;
  const rosterGroup =
    owned[0].roster_group == null ? null : Number(owned[0].roster_group);

  // Work out the player's group baseline for this event, then store only a
  // deviation from it: matching the baseline means we can drop any existing row.
  const groupRows = await sql()`
    SELECT group_number FROM event_groups WHERE event_id = ${eventId}
  `;
  const selectedGroups = groupRows.map((r) => Number(r.group_number));
  const baseline = groupBaseline(rosterGroup, selectedGroups);

  if (attending === baseline) {
    await sql()`
      DELETE FROM event_attendance
      WHERE event_id = ${eventId} AND player_id = ${playerId}
    `;
  } else {
    await sql()`
      INSERT INTO event_attendance (event_id, player_id, attending)
      VALUES (${eventId}, ${playerId}, ${attending})
      ON CONFLICT (event_id, player_id)
      DO UPDATE SET attending = EXCLUDED.attending, updated_at = now()
    `;
  }

  revalidatePath("/schedules");
}

// Mark every roster player attending or benched for one event. Both are
// whole-roster overrides, so they clear the event's group selection first (the
// choice is no longer group-based). "All in" then drops every deviation (the
// no-groups baseline is "everyone attends"); "Sit all" benches the roster.
export async function setEventAttendanceAllAction(input: {
  eventId: number;
  attending: boolean;
}): Promise<void> {
  const session = await getSession();
  if (!session) return;

  const eventId = Number(input?.eventId);
  const attending = Boolean(input?.attending);
  if (!Number.isFinite(eventId)) return;

  await ensureSchedulesSchema();

  // Confirm the event belongs to this company.
  const owned = await sql()`
    SELECT 1
    FROM schedule_events e
    JOIN teams t ON t.id = e.team_id
    WHERE e.id = ${eventId}
      AND t.company_id = ${session.companyId}
  `;
  if (owned.length === 0) return;

  await sql()`DELETE FROM event_groups WHERE event_id = ${eventId}`;

  if (attending) {
    // Everyone attending is the default, so drop the event's deviations.
    await sql()`DELETE FROM event_attendance WHERE event_id = ${eventId}`;
  } else {
    // Bench the whole roster for this event.
    await sql()`
      INSERT INTO event_attendance (event_id, player_id, attending)
      SELECT e.id, p.id, false
      FROM schedule_events e
      JOIN players p ON p.team_id = e.team_id
      WHERE e.id = ${eventId}
      ON CONFLICT (event_id, player_id)
      DO UPDATE SET attending = false, updated_at = now()
    `;
  }

  revalidatePath("/schedules");
}

// Replace which standing roster groups play an event (e.g. Groups 1 & 2). This
// sets the attendance baseline; per-player exceptions in event_attendance are
// left untouched and still win. Group numbers are clamped to the team's
// configured group count and de-duplicated.
export async function setEventGroupsAction(input: {
  eventId: number;
  groups: number[];
}): Promise<void> {
  const session = await getSession();
  if (!session) return;

  const eventId = Number(input?.eventId);
  if (!Number.isFinite(eventId)) return;

  await ensureSchedulesSchema();

  // Confirm the event belongs to this company and read the team's group count
  // so out-of-range group numbers are rejected.
  const owned = await sql()`
    SELECT t.roster_group_count
    FROM schedule_events e
    JOIN teams t ON t.id = e.team_id
    WHERE e.id = ${eventId}
      AND t.company_id = ${session.companyId}
  `;
  if (owned.length === 0) return;
  const count = Number(owned[0].roster_group_count) || 0;

  const groups = [
    ...new Set(
      (Array.isArray(input?.groups) ? input.groups : [])
        .map((g) => Math.floor(Number(g)))
        .filter((g) => Number.isFinite(g) && g >= 1 && g <= count),
    ),
  ];

  // Replace the event's selection wholesale, in one transaction.
  await sql().transaction((txn) => [
    txn`DELETE FROM event_groups WHERE event_id = ${eventId}`,
    ...groups.map(
      (g) => txn`
        INSERT INTO event_groups (event_id, group_number)
        VALUES (${eventId}, ${g})
        ON CONFLICT (event_id, group_number) DO NOTHING
      `,
    ),
  ]);

  revalidatePath("/schedules");
}

// Assign a player to a standing roster group (1..team count), or null to
// un-assign. Scoped to a player whose team belongs to this company.
export async function setPlayerGroupAction(input: {
  playerId: number;
  group: number | null;
}): Promise<void> {
  const session = await getSession();
  if (!session) return;

  const playerId = Number(input?.playerId);
  if (!Number.isFinite(playerId)) return;

  await ensureSchedulesSchema();

  // Confirm the player belongs to this company and read the team's group count.
  const owned = await sql()`
    SELECT t.roster_group_count
    FROM players p
    JOIN teams t ON t.id = p.team_id
    WHERE p.id = ${playerId}
      AND t.company_id = ${session.companyId}
  `;
  if (owned.length === 0) return;
  const count = Number(owned[0].roster_group_count) || 0;

  // null clears the assignment; a number must land inside the configured range.
  let group: number | null = null;
  if (input?.group != null) {
    const g = Math.floor(Number(input.group));
    if (!Number.isFinite(g) || g < 1 || g > count) return;
    group = g;
  }

  await sql()`
    UPDATE players SET roster_group = ${group}, updated_at = now()
    WHERE id = ${playerId}
      AND team_id IN (SELECT id FROM teams WHERE company_id = ${session.companyId})
  `;

  revalidatePath("/schedules");
}

// Set how many standing groups a team is split into (0..MAX_ROSTER_GROUPS).
// Lowering the count retires the removed groups: it un-assigns any players in
// them and drops those group numbers from every event's selection.
export async function setTeamGroupCountAction(input: {
  teamId: number;
  count: number;
}): Promise<void> {
  const session = await getSession();
  if (!session) return;

  const teamId = Number(input?.teamId);
  if (!Number.isFinite(teamId)) return;

  const count = Math.max(
    0,
    Math.min(MAX_ROSTER_GROUPS, Math.floor(Number(input?.count) || 0)),
  );

  await ensureSchedulesSchema();

  // Confirm the team belongs to this company.
  const owned = await sql()`
    SELECT id FROM teams WHERE id = ${teamId} AND company_id = ${session.companyId}
  `;
  if (owned.length === 0) return;

  await sql().transaction((txn) => [
    txn`
      UPDATE teams SET roster_group_count = ${count}, updated_at = now()
      WHERE id = ${teamId}
    `,
    txn`
      UPDATE players SET roster_group = NULL, updated_at = now()
      WHERE team_id = ${teamId} AND roster_group > ${count}
    `,
    txn`
      DELETE FROM event_groups
      WHERE group_number > ${count}
        AND event_id IN (SELECT id FROM schedule_events WHERE team_id = ${teamId})
    `,
  ]);

  revalidatePath("/schedules");
}
