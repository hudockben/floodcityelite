"use client";

import { useActionState, useEffect, useState } from "react";
import {
  deleteTeamAction,
  renameTeamAction,
  type FormState,
} from "./actions";
import ConfirmButton from "./confirm-button";
import {
  sportLabel,
  TEAM_NAME_MAX,
  type DivisionSlug,
  type TeamRow,
} from "./divisions";

const initialState: FormState = {};

// One row of the "Manage teams in this division" list: the team's name, sport,
// and roster size, with Edit (rename in place) and Delete. Editing swaps the
// row for an inline name field — renaming keeps the team's id, so its roster
// stays put instead of having to be rebuilt on a new team.
export default function TeamChip({
  team,
  division,
}: {
  team: TeamRow;
  division: DivisionSlug;
}) {
  const [editing, setEditing] = useState(false);
  // Controlled so a rejected rename (duplicate name, say) keeps what was typed:
  // React resets an uncontrolled field once a form action settles.
  const [name, setName] = useState(team.name);
  const [state, formAction, pending] = useActionState(
    renameTeamAction,
    initialState,
  );
  // The action's state outlives the editor, so remember the result the row has
  // already shown — otherwise closing and reopening the editor greets the coach
  // with the error from the last attempt.
  const [seen, setSeen] = useState<FormState | null>(null);
  const error = state !== seen ? state?.error : undefined;

  const close = () => {
    setSeen(state);
    setEditing(false);
  };

  // Close the editor once a rename succeeds; the new name arrives with the
  // revalidated page.
  useEffect(() => {
    if (state?.ok) setEditing(false);
  }, [state]);

  if (editing) {
    const inputId = `team-rename-${team.id}`;
    return (
      <li className="team-chip team-chip-editing">
        <form action={formAction} className="team-chip-form">
          <input type="hidden" name="teamId" value={team.id} />
          <input type="hidden" name="division" value={division} />

          <label className="sr-only" htmlFor={inputId}>
            Team name
          </label>
          <input
            id={inputId}
            className="team-chip-input"
            name="name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={TEAM_NAME_MAX}
            autoComplete="off"
            required
            autoFocus
            // Escape backs out of the editor — the row goes back to showing
            // the saved name.
            onKeyDown={(e) => {
              if (e.key === "Escape") close();
            }}
          />

          <button type="submit" className="chip-save" disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            className="chip-cancel"
            onClick={close}
            disabled={pending}
          >
            Cancel
          </button>

          {error ? (
            <p className="error chip-form-msg" role="alert">
              {error}
            </p>
          ) : null}
        </form>
      </li>
    );
  }

  return (
    <li className="team-chip">
      <span className="team-chip-name">{team.name}</span>
      <span className={`sport-badge sport-${team.sport}`}>
        {sportLabel(team.sport)}
      </span>
      <span className="team-chip-count">
        {team.player_count} {team.player_count === 1 ? "player" : "players"}
      </span>
      <div className="team-chip-actions">
        <button
          type="button"
          className="chip-edit"
          onClick={() => {
            // Start from the name currently on the team, so reopening the
            // editor never shows a stale draft or a stale error.
            setName(team.name);
            setSeen(state);
            setEditing(true);
          }}
        >
          Edit
        </button>
        <ConfirmButton
          action={deleteTeamAction}
          hidden={{ teamId: team.id, division }}
          confirmText={`Delete "${team.name}" and its entire roster? This cannot be undone.`}
          className="chip-delete"
        >
          Delete
        </ConfirmButton>
      </div>
    </li>
  );
}
