"use client";

import { Fragment, useActionState, useEffect, useState } from "react";
import {
  deletePlayerAction,
  updatePlayerAction,
  type FormState,
} from "./actions";
import ConfirmButton from "./confirm-button";
import PayingToggle from "./paying-toggle";
import RosterStatusBadge from "./roster-status-badge";
import {
  PLAYER_FIELDS,
  ROSTER_STATUS_OPTIONS,
  rosterStatusValue,
  type DivisionSlug,
  type PlayerField,
  type PlayerRow as PlayerRowData,
} from "./divisions";

const initialState: FormState = {};
// Columns: every player field, plus the "Paying" and "New / Returning" columns
// and the actions column.
const COL_SPAN = PLAYER_FIELDS.length + 3;

function EditField({
  field,
  value,
  playerId,
  hint,
}: {
  field: PlayerField;
  // Widened to the full PlayerRow value union (which includes the boolean
  // is_paying and the string[] jersey_requested). Neither is a PLAYER_FIELD, so
  // neither actually renders here — this just keeps the indexed-access type
  // happy.
  value: string | number | boolean | string[] | null;
  playerId: number;
  /** Optional note under the input (the jersey field explains an empty one). */
  hint?: string | null;
}) {
  const id = `edit-${playerId}-${field.key}`;
  const defaultValue = value == null ? "" : String(value);

  return (
    <div className="field">
      <label htmlFor={id}>
        {field.label}
        {field.required ? " *" : ""}
      </label>
      {field.type === "position" ? (
        <input
          id={id}
          name={field.key}
          type="text"
          list="position-options"
          defaultValue={defaultValue}
          autoComplete="off"
        />
      ) : (
        <input
          id={id}
          name={field.key}
          type={field.type}
          defaultValue={defaultValue}
          required={field.required}
          autoComplete="off"
          {...(field.type === "number" ? { min: 0 } : {})}
        />
      )}
      {hint ? <span className="field-hint">{hint}</span> : null}
    </div>
  );
}

/** Why this player's jersey cell is blank; null when it isn't (see jerseyGapNote). */
export type JerseyNote = { short: string; detail: string };

export default function PlayerRow({
  player,
  division,
  jerseyNote = null,
}: {
  player: PlayerRowData;
  division: DivisionSlug;
  jerseyNote?: JerseyNote | null;
}) {
  const [editing, setEditing] = useState(false);
  const [state, formAction, pending] = useActionState(
    updatePlayerAction,
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
            <input type="hidden" name="playerId" value={player.id} />
            <input type="hidden" name="division" value={division} />

            <div className="player-edit-head">
              Editing <strong>{player.player_name}</strong>
            </div>

            {/* is_paying is intentionally not edited here — the inline
                "Paying" toggle on the roster row is its single writer, so the
                editor can't resurrect a stale value over a just-made toggle. */}
            <div className="player-grid">
              {PLAYER_FIELDS.map((f) => (
                <Fragment key={f.key}>
                  <EditField
                    field={f}
                    playerId={player.id}
                    value={player[f.key as keyof PlayerRowData]}
                    // The jersey field explains itself when it's empty: this is
                    // where a coach comes to fix a missing number, so it's where
                    // the reason belongs. Typing one here pins it.
                    hint={
                      f.key === "jersey_number" ? jerseyNote?.detail : undefined
                    }
                  />
                  {f.key === "player_name" ? (
                    <div className="field">
                      <label htmlFor={`edit-${player.id}-roster_status`}>
                        New / Returning
                      </label>
                      <select
                        id={`edit-${player.id}-roster_status`}
                        name="roster_status"
                        defaultValue={rosterStatusValue(player.is_returning)}
                      >
                        {ROSTER_STATUS_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                      <span className="field-hint">
                        {player.played_last_season == null
                          ? "No acceptance form on file — set it here."
                          : `The form said ${player.played_last_season ? "returning" : "new"}.`}
                      </span>
                    </div>
                  ) : null}
                </Fragment>
              ))}
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
      {PLAYER_FIELDS.map((f) => {
        const value = player[f.key as keyof PlayerRowData];
        const empty = value == null || value === "";
        return (
          <Fragment key={f.key}>
            <td className={f.key === "player_name" ? "col-name" : undefined}>
              {empty ? (
                // A blank jersey is the one empty cell that has a reason worth
                // reading — the automation left it blank rather than nobody
                // filling it in. Say which, inline, with the full story on hover.
                f.key === "jersey_number" && jerseyNote ? (
                  <span className="cell-empty" title={jerseyNote.detail}>
                    — <span className="jersey-note">{jerseyNote.short}</span>
                  </span>
                ) : (
                  <span className="cell-empty">—</span>
                )
              ) : (
                String(value)
              )}
            </td>
            {f.key === "player_name" ? (
              <>
                <td className="col-paying">
                  <PayingToggle
                    playerId={player.id}
                    playerName={player.player_name}
                    value={player.is_paying}
                  />
                </td>
                <td className="col-roster-status">
                  <RosterStatusBadge
                    playedLastSeason={player.played_last_season}
                    override={player.is_returning}
                  />
                </td>
              </>
            ) : null}
          </Fragment>
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
            action={deletePlayerAction}
            hidden={{ playerId: player.id, division }}
            confirmText={`Remove ${player.player_name} from the roster?`}
            className="row-delete"
          >
            Remove
          </ConfirmButton>
        </div>
      </td>
    </tr>
  );
}
