"use client";

import { useActionState, useEffect, useRef } from "react";
import { addPlayerAction, type FormState } from "./actions";
import {
  PLAYER_FIELDS,
  POSITIONS,
  sportLabel,
  type DivisionSlug,
  type PlayerField,
} from "./divisions";

const initialState: FormState = {};

type TeamOption = { id: number; name: string; sport: string };

function FieldInput({ field }: { field: PlayerField }) {
  const common = {
    id: `player-${field.key}`,
    name: field.key,
    required: field.required,
  };

  if (field.type === "position") {
    return (
      <input
        {...common}
        type="text"
        list="position-options"
        placeholder="e.g. SS"
        autoComplete="off"
      />
    );
  }

  return (
    <input
      {...common}
      type={field.type}
      placeholder={field.placeholder}
      autoComplete="off"
      {...(field.type === "number" ? { min: 0 } : {})}
    />
  );
}

export default function AddPlayerForm({
  division,
  teams,
}: {
  division: DivisionSlug;
  teams: TeamOption[];
}) {
  const [state, formAction, pending] = useActionState(
    addPlayerAction,
    initialState,
  );
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok) formRef.current?.reset();
  }, [state]);

  if (teams.length === 0) {
    return (
      <p className="muted-note">
        Create a team above, then you can start adding players to it.
      </p>
    );
  }

  return (
    <form ref={formRef} action={formAction} className="player-form">
      <input type="hidden" name="division" value={division} />

      {/* Shared list of common positions for the primary/secondary inputs. */}
      <datalist id="position-options">
        {POSITIONS.map((p) => (
          <option key={p} value={p} />
        ))}
      </datalist>

      <div className="player-grid">
        <div className="field">
          <label htmlFor="player-team">Team</label>
          <select id="player-team" name="teamId" defaultValue="" required>
            <option value="" disabled>
              Choose a team…
            </option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} · {sportLabel(t.sport)}
              </option>
            ))}
          </select>
        </div>

        {PLAYER_FIELDS.map((field) => (
          <div className="field" key={field.key}>
            <label htmlFor={`player-${field.key}`}>
              {field.label}
              {field.required ? " *" : ""}
            </label>
            <FieldInput field={field} />
          </div>
        ))}
      </div>

      <div className="player-form-actions">
        <button type="submit" className="btn" disabled={pending}>
          {pending ? "Adding…" : "Add player"}
        </button>
        {state?.error ? (
          <p className="error player-form-msg" role="alert">
            {state.error}
          </p>
        ) : null}
      </div>
    </form>
  );
}
