"use client";

import { Fragment, useActionState, useEffect, useState } from "react";
import {
  deletePlayerAction,
  updatePlayerAction,
  type FormState,
} from "./actions";
import ConfirmButton from "./confirm-button";
import PayingToggle from "./paying-toggle";
import {
  PLAYER_FIELDS,
  type DivisionSlug,
  type PlayerField,
  type PlayerRow as PlayerRowData,
} from "./divisions";

const initialState: FormState = {};
// Columns: every player field, plus the "Paying" column and the actions column.
const COL_SPAN = PLAYER_FIELDS.length + 2;

function EditField({
  field,
  value,
  playerId,
}: {
  field: PlayerField;
  // Widened to the full PlayerRow value union (which now includes the boolean
  // is_paying). is_paying isn't a PLAYER_FIELD, so it never actually renders
  // here — this just keeps the indexed-access type happy.
  value: string | number | boolean | null;
  playerId: number;
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
    </div>
  );
}

export default function PlayerRow({
  player,
  division,
}: {
  player: PlayerRowData;
  division: DivisionSlug;
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

            <div className="player-grid">
              {PLAYER_FIELDS.map((f) => (
                <Fragment key={f.key}>
                  <EditField
                    field={f}
                    playerId={player.id}
                    value={player[f.key as keyof PlayerRowData]}
                  />
                  {f.key === "player_name" ? (
                    <div className="field field-check">
                      <label htmlFor={`edit-${player.id}-is_paying`}>Paying</label>
                      <label className="check-inline">
                        <input
                          id={`edit-${player.id}-is_paying`}
                          name="is_paying"
                          type="checkbox"
                          value="true"
                          defaultChecked={player.is_paying}
                        />
                        <span>Pays tuition / dues</span>
                      </label>
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
              {empty ? <span className="cell-empty">—</span> : String(value)}
            </td>
            {f.key === "player_name" ? (
              <td className="col-paying">
                <PayingToggle
                  playerId={player.id}
                  playerName={player.player_name}
                  value={player.is_paying}
                />
              </td>
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
