"use client";

import { useActionState, useEffect, useState } from "react";
import ConfirmButton from "../teams/confirm-button";
import { SPORTS } from "../teams/divisions";
import {
  deleteCoachAction,
  updateCoachAction,
  type FormState,
} from "./actions";
import CoachFields from "./coach-fields";
import {
  COACH_FIELDS,
  coachValue,
  telHref,
  websiteHref,
  websiteLabel,
  type CoachField,
  type CoachRow as CoachRowData,
} from "./coaches";

const initialState: FormState = {};
// Every contact field, plus the actions column.
const COL_SPAN = COACH_FIELDS.length + 1;

// One cell's contents. Phone, email, and website become tap-to-use links so a
// contact can be called or opened straight from the table; the level renders as
// a pill so D1/D2/JUCO reads at a glance down the column.
function CoachCell({ field, value }: { field: CoachField; value: string | null }) {
  if (value == null) return <span className="cell-empty">—</span>;

  switch (field.key) {
    case "cell_phone": {
      const href = telHref(value);
      // Free text: only linkify what can actually be dialed (see telHref).
      return href ? (
        <a className="coach-link" href={href}>
          {value}
        </a>
      ) : (
        <>{value}</>
      );
    }
    case "email":
      return (
        <a className="coach-link" href={`mailto:${value}`}>
          {value}
        </a>
      );
    case "website": {
      const href = websiteHref(value);
      // Anything that isn't an http(s) link stays plain text (see websiteHref).
      return href ? (
        <a
          className="coach-link"
          href={href}
          target="_blank"
          rel="noopener noreferrer"
        >
          {websiteLabel(value)}
        </a>
      ) : (
        <>{value}</>
      );
    }
    case "division_level":
      return <span className="coach-badge">{value}</span>;
    default:
      return <>{value}</>;
  }
}

export default function CoachRow({ coach }: { coach: CoachRowData }) {
  const [editing, setEditing] = useState(false);
  const [state, formAction, pending] = useActionState(
    updateCoachAction,
    initialState,
  );

  // Collapse the editor once a save succeeds (fresh data arrives via
  // revalidation, so the display row shows the updated values).
  useEffect(() => {
    if (state?.ok) setEditing(false);
  }, [state]);

  if (editing) {
    return (
      <tr className="player-edit-row">
        <td colSpan={COL_SPAN}>
          <form action={formAction} className="player-edit-form">
            <input type="hidden" name="coachId" value={coach.id} />

            <div className="player-edit-head">
              Editing <strong>{coach.school_name}</strong>
            </div>

            <CoachFields
              idPrefix={`coach-edit-${coach.id}`}
              coach={coach}
              leading={
                // Editable here (and only here) so a contact filed under the
                // wrong sport can be moved to the other list.
                <div className="field">
                  <label htmlFor={`coach-edit-${coach.id}-sport`}>Sport</label>
                  <select
                    id={`coach-edit-${coach.id}-sport`}
                    name="sport"
                    defaultValue={coach.sport}
                  >
                    {SPORTS.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>
              }
            />

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
      {COACH_FIELDS.map((f) => {
        const value = coachValue(coach, f.key);
        const classes = [
          f.key === "school_name" ? "col-name" : null,
          f.type === "notes" ? "coach-notes" : null,
        ]
          .filter(Boolean)
          .join(" ");
        return (
          <td
            key={f.key}
            className={classes || undefined}
            title={f.type === "notes" && value ? value : undefined}
          >
            <CoachCell field={f} value={value} />
          </td>
        );
      })}
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
            action={deleteCoachAction}
            hidden={{ coachId: coach.id }}
            confirmText={`Remove ${coach.school_name} from the contact list?`}
            className="row-delete"
          >
            Remove
          </ConfirmButton>
        </div>
      </td>
    </tr>
  );
}
