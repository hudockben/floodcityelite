"use client";

import { Fragment, useActionState, useEffect, useState } from "react";
import {
  deletePlayerAction,
  movePlayerAction,
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
  sportLabel,
  type DivisionSlug,
  type PlayerField,
  type PlayerRow as PlayerRowData,
} from "./divisions";

const initialState: FormState = {};

// The teams a player can be moved to: this season's teams, as the page already
// lists them for the add-player form.
type TeamOption = { id: number; name: string; sport: string };

// Columns: every player field, plus the "Paying" and "New / Returning" columns
// and the actions column.
const COL_SPAN = PLAYER_FIELDS.length + 3;

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
  teams,
}: {
  player: PlayerRowData;
  division: DivisionSlug;
  /** This season's teams — the row's Move picker offers the other ones. */
  teams: TeamOption[];
}) {
  // Which of the row's two inline forms is open, if either. One state rather
  // than a flag each, so opening Move can't leave the editor open behind it.
  const [mode, setMode] = useState<"view" | "edit" | "move">("view");
  const [state, formAction, pending] = useActionState(
    updatePlayerAction,
    initialState,
  );
  const [moveState, moveAction, moving] = useActionState(
    movePlayerAction,
    initialState,
  );
  // The team picked in the Move form. Controlled so a rejected move keeps the
  // choice — React resets an uncontrolled field once a form action settles.
  const [targetTeam, setTargetTeam] = useState("");
  // The move action's state outlives the form, so remember the result the row
  // has already shown; otherwise reopening Move greets the coach with the error
  // from the last attempt. (Same reason as the team chip's rename.)
  const [seenMove, setSeenMove] = useState<FormState | null>(null);
  const moveError = moveState !== seenMove ? moveState?.error : undefined;

  const closeMove = () => {
    setSeenMove(moveState);
    setMode("view");
  };

  // Everywhere but the team they're already on.
  const moveTargets = teams.filter((t) => t.id !== player.team_id);

  // Both row buttons live in the actions column, at the far right of a roster
  // wide enough to scroll sideways — so the form that replaces the row opens
  // with its start off the left edge of the view. Take the table back to its
  // beginning along with it, so the form reads from its first field.
  const scrollRosterToStart = (button: HTMLElement) => {
    const scroller = button.closest(".roster-scroll");
    if (scroller) scroller.scrollLeft = 0;
  };

  // Collapse the editor once a save succeeds (fresh data arrives via
  // revalidation, so the display row shows the updated values).
  useEffect(() => {
    if (state?.ok) setMode("view");
  }, [state]);

  // A finished move takes the player off this team, so the row goes away when
  // the revalidated page lands. Close the form as soon as the action returns
  // rather than leaving it up for the round trip.
  useEffect(() => {
    if (moveState?.ok) setMode("view");
  }, [moveState]);

  if (mode === "edit") {
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
                onClick={() => setMode("view")}
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

  if (mode === "move") {
    const selectId = `move-${player.id}-team`;
    return (
      <tr className="player-edit-row">
        <td colSpan={COL_SPAN}>
          <form action={moveAction} className="player-edit-form">
            <input type="hidden" name="playerId" value={player.id} />

            <div className="player-edit-head">
              Moving <strong>{player.player_name}</strong> off{" "}
              <strong>{player.team_name}</strong>
            </div>

            <div className="field player-move-field">
              <label htmlFor={selectId}>New team</label>
              <select
                id={selectId}
                name="teamId"
                value={targetTeam}
                onChange={(e) => setTargetTeam(e.target.value)}
                required
              >
                <option value="" disabled>
                  Choose a team…
                </option>
                {moveTargets.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} · {sportLabel(t.sport)}
                  </option>
                ))}
              </select>
            </div>

            <p className="player-move-hint">
              Everything on the player comes along — their details, their jersey
              number, the payments logged against them, and the acceptance form
              they came in on. Their playing-time group is cleared, since groups
              are set per team.
            </p>

            <div className="player-form-actions">
              <button type="submit" className="btn" disabled={moving}>
                {moving ? "Moving…" : "Move player"}
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={closeMove}
                disabled={moving}
              >
                Cancel
              </button>
              {moveError ? (
                <p className="error player-form-msg" role="alert">
                  {moveError}
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
            onClick={(e) => {
              scrollRosterToStart(e.currentTarget);
              setMode("edit");
            }}
          >
            Edit
          </button>
          {/* Nowhere to move to on a one-team season, so the button stays off
              the row entirely rather than opening an empty picker. */}
          {moveTargets.length > 0 ? (
            <button
              type="button"
              className="row-move"
              onClick={(e) => {
                scrollRosterToStart(e.currentTarget);
                // Start clean: no stale choice, and no error from a previous
                // attempt showing on a freshly opened form.
                setTargetTeam("");
                setSeenMove(moveState);
                setMode("move");
              }}
            >
              Move
            </button>
          ) : null}
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
