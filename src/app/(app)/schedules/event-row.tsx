"use client";

import { useActionState, useEffect, useState } from "react";
import {
  deleteEventAction,
  updateEventAction,
  type FormState,
} from "./actions";
import ConfirmButton from "../teams/confirm-button";
import StatusSelect from "./status-select";
import {
  EVENT_FIELDS,
  STATUSES,
  formatDate,
  formatMoney,
  type EventField,
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
}: {
  event: ScheduleEventRow;
  division: string;
}) {
  const [editing, setEditing] = useState(false);
  const [state, formAction, pending] = useActionState(
    updateEventAction,
    initialState,
  );

  // Collapse the editor once a save succeeds (fresh data arrives via
  // revalidation, so the display row shows the updated values).
  useEffect(() => {
    if (state?.ok) setEditing(false);
  }, [state]);

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
                  Registered/Paid/Waitlisted
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

  return (
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
}
