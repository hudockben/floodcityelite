"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import {
  deleteEventAction,
  setAttendanceAction,
  setEventAttendanceAllAction,
  setEventGroupsAction,
  updateEventAction,
  type FormState,
} from "./actions";
import ConfirmButton from "../teams/confirm-button";
import GroupsPanel from "./groups-panel";
import StatusSelect from "./status-select";
import {
  EVENT_FIELDS,
  STATUSES,
  STATUS_HEADER,
  formatDate,
  formatMoney,
  groupBaseline,
  resolveAttending,
  type EventField,
  type GroupPlayer,
  type ScheduleEventRow,
} from "./events";

const initialState: FormState = {};
const COL_SPAN = EVENT_FIELDS.length + 2; // event fields + status + actions

function displayValue(field: EventField, value: string | null): string {
  if (value == null || value === "") return "—";
  if (field.type === "date") return formatDate(value);
  if (field.type === "money") return formatMoney(value);
  return value;
}

function EditField({
  field,
  value,
  eventId,
}: {
  field: EventField;
  value: string | null;
  eventId: number;
}) {
  const id = `edit-${eventId}-${field.key}`;
  const defaultValue = value == null ? "" : String(value);

  return (
    <div className="field">
      <label htmlFor={id}>
        {field.label}
        {field.required ? " *" : ""}
      </label>
      <input
        id={id}
        name={field.key}
        type={field.type === "money" ? "number" : field.type}
        defaultValue={defaultValue}
        required={field.required}
        autoComplete="off"
        {...(field.type === "money" ? { min: 0, step: "0.01" } : {})}
      />
    </div>
  );
}

export default function EventRow({
  event,
  division,
  players,
  groupCount,
  selectedGroups,
  overrides,
}: {
  event: ScheduleEventRow;
  division: string;
  players: GroupPlayer[];
  groupCount: number;
  selectedGroups: number[];
  overrides: { playerId: number; attending: boolean }[];
}) {
  const [editing, setEditing] = useState(false);
  const [groupsOpen, setGroupsOpen] = useState(false);
  // Which standing groups play this event (optimistic). Seeded from the server;
  // toggling a group re-derives who's attending on the spot.
  const [selected, setSelected] = useState<Set<number>>(
    () => new Set(selectedGroups),
  );
  // Per-player exceptions on top of the group baseline (optimistic). We store a
  // player here only when their state deviates from what the groups dictate.
  const [overrideMap, setOverrideMap] = useState<Map<number, boolean>>(
    () => new Map(overrides.map((o) => [o.playerId, o.attending])),
  );
  const [state, formAction, pending] = useActionState(
    updateEventAction,
    initialState,
  );

  // Collapse the editor once a save succeeds (fresh data arrives via
  // revalidation, so the display row shows the updated values).
  useEffect(() => {
    if (state?.ok) setEditing(false);
  }, [state]);

  // Add or remove a standing group from this event's selection.
  function toggleGroup(group: number) {
    const prev = selected;
    const next = new Set(prev);
    if (next.has(group)) next.delete(group);
    else next.add(group);
    setSelected(next);
    setEventGroupsAction({ eventId: event.id, groups: [...next] }).catch(() => {
      setSelected(prev);
    });
  }

  // Flip one player between attending and sitting. The stored value is a
  // deviation from the group baseline, so matching the baseline clears the
  // exception; reverts if the save fails.
  function toggleAttendance(playerId: number) {
    const player = players.find((p) => p.id === playerId);
    if (!player) return;
    const current = resolveAttending(
      player.roster_group,
      overrideMap.get(playerId),
      selected,
    );
    const desired = !current;
    const base = groupBaseline(player.roster_group, selected);
    const prev = overrideMap;
    setOverrideMap((prevMap) => {
      const next = new Map(prevMap);
      if (desired === base) next.delete(playerId);
      else next.set(playerId, desired);
      return next;
    });
    setAttendanceAction({
      eventId: event.id,
      playerId,
      attending: desired,
    }).catch(() => setOverrideMap(prev));
  }

  // Take the whole roster or sit everyone for this event. Both clear the group
  // selection (the choice is no longer group-based).
  function setAllAttendance(attending: boolean) {
    const prevSel = selected;
    const prevOv = overrideMap;
    setSelected(new Set());
    setOverrideMap(
      attending ? new Map() : new Map(players.map((p) => [p.id, false])),
    );
    setEventAttendanceAllAction({ eventId: event.id, attending }).catch(() => {
      setSelected(prevSel);
      setOverrideMap(prevOv);
    });
  }

  // View models for the panel: each player's resolved state and whether it's an
  // exception to their group baseline.
  const playerViews = useMemo(
    () =>
      players.map((p) => {
        const attending = resolveAttending(
          p.roster_group,
          overrideMap.get(p.id),
          selected,
        );
        return {
          id: p.id,
          player_name: p.player_name,
          primary_position: p.primary_position,
          roster_group: p.roster_group,
          attending,
          isException: attending !== groupBaseline(p.roster_group, selected),
        };
      }),
    [players, overrideMap, selected],
  );

  // How many players sit in each configured group (for the group chips).
  const groupSizes = useMemo(() => {
    const sizes = new Map<number, number>();
    for (const p of players) {
      if (p.roster_group != null && p.roster_group >= 1 && p.roster_group <= groupCount) {
        sizes.set(p.roster_group, (sizes.get(p.roster_group) ?? 0) + 1);
      }
    }
    return sizes;
  }, [players, groupCount]);

  const attendingCount = playerViews.filter((p) => p.attending).length;

  if (editing) {
    return (
      <tr className="sched-edit-row">
        <td colSpan={COL_SPAN}>
          <form action={formAction} className="sched-edit-form">
            <input type="hidden" name="eventId" value={event.id} />
            <input type="hidden" name="division" value={division} />

            <div className="sched-edit-head">
              Editing <strong>{event.event_name}</strong>
            </div>

            <div className="player-grid">
              {EVENT_FIELDS.map((f) => (
                <EditField
                  key={f.key}
                  field={f}
                  eventId={event.id}
                  value={event[f.key as keyof ScheduleEventRow] as string | null}
                />
              ))}

              <div className="field">
                <label htmlFor={`edit-${event.id}-status`}>
                  {STATUS_HEADER}
                </label>
                <select
                  id={`edit-${event.id}-status`}
                  name="status"
                  defaultValue={event.status}
                >
                  {STATUSES.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="player-form-actions">
              <button type="submit" className="btn" disabled={pending}>
                {pending ? "Saving…" : "Save changes"}
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setEditing(false)}
                disabled={pending}
              >
                Cancel
              </button>
              {state?.error ? (
                <p className="error player-form-msg" role="alert">
                  {state.error}
                </p>
              ) : null}
            </div>
          </form>
        </td>
      </tr>
    );
  }

  const displayRow = (
    <tr>
      {EVENT_FIELDS.map((f) => {
        const raw = event[f.key as keyof ScheduleEventRow] as string | null;
        const empty = raw == null || raw === "";
        return (
          <td
            key={f.key}
            className={
              f.key === "event_name"
                ? "col-name"
                : f.type === "money"
                  ? "col-cost"
                  : undefined
            }
          >
            {empty ? (
              <span className="cell-empty">—</span>
            ) : (
              displayValue(f, raw)
            )}
          </td>
        );
      })}
      <td className="col-status">
        <StatusSelect eventId={event.id} value={event.status} />
      </td>
      <td className="col-actions">
        <div className="row-actions">
          <button
            type="button"
            className={`row-groups${groupsOpen ? " is-open" : ""}`}
            onClick={() => setGroupsOpen((v) => !v)}
            aria-expanded={groupsOpen}
          >
            Groups
            {players.length > 0 ? (
              <span className="row-groups-badge">
                {attendingCount}/{players.length}
              </span>
            ) : null}
          </button>
          <button
            type="button"
            className="row-edit"
            onClick={() => setEditing(true)}
          >
            Edit
          </button>
          <ConfirmButton
            action={deleteEventAction}
            hidden={{ eventId: event.id, division }}
            confirmText={`Remove "${event.event_name}" from the schedule?`}
            className="row-delete"
          >
            Remove
          </ConfirmButton>
        </div>
      </td>
    </tr>
  );

  if (!groupsOpen) return displayRow;

  // Expanded: the event row followed by a full-width Groups panel row.
  return (
    <>
      {displayRow}
      <tr className="groups-row">
        <td colSpan={COL_SPAN}>
          <GroupsPanel
            players={playerViews}
            groupCount={groupCount}
            groupSizes={groupSizes}
            selectedGroups={selected}
            division={division}
            onToggleGroup={toggleGroup}
            onToggle={toggleAttendance}
            onSetAll={setAllAttendance}
          />
        </td>
      </tr>
    </>
  );
}
